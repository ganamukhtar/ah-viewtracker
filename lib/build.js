import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { blankPlatform, mergePlatform, platformUrl } from './platforms.js';
import { appendHistory, historyPoint, measuredRate } from './project.js';
import { aggregate, DEFAULT_FILTER } from './aggregate.js';
import { collectYouTube, youtubeEnabled } from '../collector/youtube.js';
import { collectInstagram, instagramEnabled } from '../collector/instagram.js';
import { collectX, xEnabled } from '../collector/x.js';
import { collectTikTok, tiktokEnabled, tiktokPublicEnabled } from '../collector/tiktok.js';
import { apifyEnabled } from '../collector/apify-tiktok.js';

export async function loadConfig() {
  const text = await readFile(path.join(process.cwd(), 'accounts.json'), 'utf8');
  const config = JSON.parse(text);
  if (!Array.isArray(config.accounts)) throw new Error('accounts.json is missing an accounts array');
  return config;
}

export function collectorStatus(env = process.env) {
  return {
    youtube: youtubeEnabled(env)
      ? { enabled: true, mode: 'youtube-data-api-v3' }
      : { enabled: false, reason: 'Set YOUTUBE_API_KEY to collect channel views and subscribers.' },
    instagram: instagramEnabled(env)
      ? { enabled: true, mode: 'instagram-graph-business-discovery' }
      : { enabled: false, reason: 'Set IG_BUSINESS_ACCOUNT_ID and IG_ACCESS_TOKEN to collect Instagram.' },
    x: xEnabled(env)
      ? { enabled: true, mode: 'x-api-v2' }
      : { enabled: false, reason: 'Set X_BEARER_TOKEN to collect X followers and post metrics.' },
    tiktok: tiktokEnabled(env)
      ? { enabled: true, mode: [tiktokPublicEnabled(env) ? 'public-profile' : null, apifyEnabled(env) ? 'apify' : null].filter(Boolean).join('+') }
      : { enabled: false, reason: 'Set TIKTOK_PUBLIC=1 and/or APIFY_TOKEN. There is no free official TikTok API for third-party accounts.' },
  };
}

const COLLECTORS = {
  youtube: { enabled: youtubeEnabled, collect: collectYouTube },
  instagram: { enabled: instagramEnabled, collect: collectInstagram },
  x: { enabled: xEnabled, collect: collectX },
  tiktok: { enabled: tiktokEnabled, collect: collectTikTok },
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
      const url = platformUrl(platformId, spec.handle);
      const priorPlatform = prior?.platforms?.[platformId] || null;
      if (!collector) {
        platforms[platformId] = blankPlatform(spec.handle, url);
        continue;
      }
      if (!collector.enabled(env)) {
        platforms[platformId] = priorPlatform
          ? { ...priorPlatform, handle: spec.handle || priorPlatform.handle, url: url || priorPlatform.url }
          : blankPlatform(spec.handle, url);
        continue;
      }
      let observation;
      try {
        observation = await collector.collect(account, env);
      } catch (error) {
        observation = { ok: false, error: error.message };
      }
      if (!observation?.ok) warnings.push(`${account.id} ${platformId}: ${observation?.error || 'failed'}`);
      platforms[platformId] = mergePlatform(priorPlatform, observation, {
        handle: spec.handle,
        url,
        checkedAt,
      });
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
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
  snapshot.projection = {
    version: 1,
    cohort: 'quests and fan pages, all platforms, creators excluded',
    recorded: view.views,
    perSecond: rate.perSecond,
    anchorAt: rate.anchorAt || checkedAt,
    basis: rate.basis,
    basisStart: rate.basisStart,
    basisEnd: rate.basisEnd,
  };
  return snapshot;
}

function emptyCoverage() {
  return { accounts: 0, defaultCohort: 0, withViews: 0, partial: false, complete: false };
}

function emptyProjection() {
  return { version: 1, cohort: 'quests and fan pages, all platforms, creators excluded', recorded: null, perSecond: null, anchorAt: null, basis: null, basisStart: null, basisEnd: null };
}
