import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { blankPlatform, mergePlatform, platformHandleKey, platformTargets, samePlatformHandle, sumObservations } from './platforms.js';
import { appendHistory, chooseRate, historyPoint, measuredRate } from './project.js';
import { aggregate, DEFAULT_FILTER } from './aggregate.js';
import { collectYouTube, youtubeEnabled } from '../collector/youtube.js';
import { collectInstagram, instagramEnabled, instagramApiEnabled } from '../collector/instagram.js';
import { collectX, xEnabled, xApiEnabled } from '../collector/x.js';
import { ytDlpBin } from '../collector/public.js';
import { collectTikTok, tiktokEnabled, tiktokPublicEnabled } from '../collector/tiktok.js';
import { collectFacebook, facebookEnabled } from '../collector/facebook.js';
import { apifyEnabled } from '../collector/apify-tiktok.js';

export async function loadConfig() {
  const text = await readFile(path.join(process.cwd(), 'accounts.json'), 'utf8');
  const config = JSON.parse(text);
  if (!Array.isArray(config.accounts)) throw new Error('accounts.json is missing an accounts array');
  return config;
}

export function collectorStatus(env = process.env) {
  return {
    youtube: env.YOUTUBE_API_KEY
      ? { enabled: true, mode: 'youtube-data-api-v3' }
      : youtubeEnabled(env) ? { enabled: true, mode: 'public-channel-page' } : { enabled: false, reason: 'YouTube collection is off.' },
    instagram: instagramApiEnabled(env)
      ? { enabled: true, mode: 'instagram-graph-business-discovery' }
      : instagramEnabled(env) ? { enabled: true, mode: 'public-profile-followers' } : { enabled: false, reason: 'Instagram collection is off.' },
    x: xApiEnabled(env)
      ? { enabled: true, mode: 'x-api-v2' }
      : xEnabled(env) ? { enabled: true, mode: 'public-profile-followers' } : { enabled: false, reason: 'X collection is off.' },
    tiktok: tiktokEnabled(env)
      ? { enabled: true, mode: [tiktokPublicEnabled(env) ? 'public-profile' : null, tiktokPublicEnabled(env) && ytDlpBin(env) ? 'ytdlp' : null, apifyEnabled(env) ? 'apify' : null].filter(Boolean).join('+') }
      : { enabled: false, reason: 'TikTok collection is off.' },
    facebook: facebookEnabled(env)
      ? { enabled: true, mode: 'public-page' }
      : { enabled: false, reason: 'Facebook collection is off.' },
  };
}

const COLLECTORS = {
  youtube: { enabled: youtubeEnabled, collect: collectYouTube },
  instagram: { enabled: instagramEnabled, collect: collectInstagram },
  x: { enabled: xEnabled, collect: collectX },
  tiktok: { enabled: tiktokEnabled, collect: collectTikTok },
  facebook: { enabled: facebookEnabled, collect: collectFacebook },
};

function previousAccount(previous, id) {
  return previous?.accounts?.find((account) => account.id === id) || null;
}

export async function collectAll({ env = process.env, config, previous, onAccount, delayMs = 250 } = {}) {
  const checkedAt = new Date().toISOString();
  const status = collectorStatus(env);
  const warnings = [];
  const accounts = [];
  for (const account of config.accounts) {
    const prior = previousAccount(previous, account.id);
    const platforms = {};
    for (const [platformId, spec] of Object.entries(account.platforms || {})) {
      const collector = COLLECTORS[platformId];
      const targets = platformTargets(platformId, spec);
      const handleKey = platformHandleKey(platformId, spec);
      const links = targets.map((target) => ({ handle: target.handle, url: target.url })).filter((item) => item.url);
      const url = links[0]?.url || null;
      const stored = prior?.platforms?.[platformId] || null;
      const priorPlatform = stored && samePlatformHandle(stored, handleKey) ? stored : null;
      if (!collector) {
        platforms[platformId] = { ...blankPlatform(handleKey, url), links };
        continue;
      }
      if (!collector.enabled(env)) {
        platforms[platformId] = priorPlatform
          ? { ...priorPlatform, handle: handleKey || priorPlatform.handle, url: url || priorPlatform.url, links }
          : { ...blankPlatform(handleKey, url), links };
        continue;
      }
      const observations = [];
      for (const target of targets) {
        const one = {
          ...account,
          platforms: {
            ...account.platforms,
            [platformId]: { handle: target.handle, url: target.url, id: target.id },
          },
        };
        try {
          observations.push(await collector.collect(one, env));
        } catch (error) {
          observations.push({ ok: false, error: error.message });
        }
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const observation = sumObservations(observations);
      if (!observation?.ok) warnings.push(`${account.id} ${platformId}: ${observation?.error || 'failed'}`);
      else if (observations.some((item) => !item?.ok)) {
        warnings.push(`${account.id} ${platformId}: ${observations.filter((item) => !item?.ok).map((item) => item?.error).filter(Boolean).join('; ')}`);
      }
      platforms[platformId] = {
        ...mergePlatform(priorPlatform, observation, { handle: handleKey, url, checkedAt }),
        links,
      };
    }
    const next = {
      id: account.id,
      handle: account.handle,
      name: account.name,
      category: account.category,
      notes: account.notes || null,
      platforms,
    };
    accounts.push(next);
    if (onAccount) await onAccount(next, accounts);
  }
  const history = appendHistory(previous?.history, historyPoint(accounts, checkedAt));
  const snapshot = {
    schemaVersion: 1,
    checkedAt,
    snapshotUpdatedAt: checkedAt,
    feedMode: 'published',
    meaning: 'Recorded views, likes, comments, and followers. Not unique people. A missing or unconnected platform is left out of every total and is never stored as zero. Partial view counts are real sums of the public posts that were readable, not lifetime totals. The live estimate, when shown, adds the measured growth rate to the last recorded total and is not itself an observation.',
    collectors: status,
    warnings,
    coverage: emptyCoverage(),
    projection: emptyProjection(),
    accounts,
    history,
  };
  const view = aggregate(snapshot, DEFAULT_FILTER);
  snapshot.coverage = {
    accounts: config.accounts.length,
    defaultCohort: view.matched,
    withViews: view.withViews,
    partial: view.viewsPartial,
    complete: view.withViews === view.matched && view.matched > 0 && !view.viewsPartial,
  };
  const rate = measuredRate(history, config, DEFAULT_FILTER);
  const chosen = chooseRate(rate.perSecond, view.velocityPerSecond);
  snapshot.projection = {
    version: 1,
    cohort: 'all accounts, all platforms',
    recorded: view.views,
    perSecond: chosen.perSecond,
    anchorAt: rate.anchorAt || checkedAt,
    basis: chosen.source === 'measured' ? rate.basis : chosen.source === 'video-velocity' ? 'Average play rate of recent public videos, used until two snapshots show growth.' : rate.basis,
    basisStart: rate.basisStart,
    basisEnd: rate.basisEnd,
  };
  return snapshot;
}

function emptyCoverage() {
  return { accounts: 0, defaultCohort: 0, withViews: 0, partial: false, complete: false };
}

function emptyProjection() {
  return { version: 1, cohort: 'all accounts, all platforms', recorded: null, perSecond: null, anchorAt: null, basis: null, basisStart: null, basisEnd: null };
}
