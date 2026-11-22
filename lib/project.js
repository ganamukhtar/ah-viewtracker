import { activePlatformIds, matchesAccount, normalizeFilter } from './aggregate.js';
import { sumNumbers } from './num.js';

export const ESTIMATE_HORIZON_MS = 48 * 60 * 60 * 1000;

function viewsAt(point, configById, filter) {
  if (!point?.accounts) return null;
  const values = [];
  for (const [id, platforms] of Object.entries(point.accounts)) {
    const account = configById.get(id);
    if (!account) continue;
    const shaped = {
      ...account,
      platforms: Object.fromEntries(Object.entries(platforms).map(([key, metrics]) => [key, metrics])),
    };
    if (!matchesAccount(shaped, filter)) continue;
    values.push(sumNumbers(activePlatformIds(filter).map((key) => platforms[key]?.views)));
  }
  return sumNumbers(values);
}

export function configMap(config) {
  return new Map((config?.accounts || []).map((account) => [account.id, account]));
}

/** Rate between the latest snapshot and an earlier one at least a minute before it. */
export function measuredRate(history, config, filter) {
  const selected = normalizeFilter(filter);
  const map = configMap(config);
  const points = (history || [])
    .map((point) => ({ ...point, t: Date.parse(point.checkedAt) }))
    .filter((point) => Number.isFinite(point.t))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) {
    return { perSecond: null, recorded: null, anchorAt: null, basis: 'Waiting for a second snapshot before a growth rate can be measured.', basisStart: null, basisEnd: null };
  }
  const end = points[points.length - 1];
  let start = null;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    if (end.t - points[i].t >= 60 * 1000) {
      start = points[i];
      break;
    }
  }
  const recorded = viewsAt(end, map, selected);
  if (!start) {
    return { perSecond: null, recorded, anchorAt: end.checkedAt, basis: 'The newest snapshots are less than a minute apart, so no rate is applied.', basisStart: null, basisEnd: end.checkedAt };
  }
  const previous = viewsAt(start, map, selected);
  if (recorded == null || previous == null) {
    return { perSecond: null, recorded, anchorAt: end.checkedAt, basis: 'One of the snapshots in this window has no recorded views, so no rate is applied.', basisStart: start.checkedAt, basisEnd: end.checkedAt };
  }
  const perSecond = (recorded - previous) / ((end.t - start.t) / 1000);
  return {
    perSecond,
    recorded,
    anchorAt: end.checkedAt,
    basisStart: start.checkedAt,
    basisEnd: end.checkedAt,
    basis: 'Latest recorded view total minus the prior snapshot, divided by elapsed seconds.',
  };
}

export function estimateAt(rate, recorded, nowMs, reducedMotion = false) {
  if (typeof recorded !== 'number') return { value: null, mode: 'none' };
  if (reducedMotion || rate?.perSecond == null || rate.perSecond <= 0) {
    return {
      value: recorded,
      mode: rate?.perSecond != null && rate.perSecond <= 0 ? 'flat' : 'recorded',
      recorded,
      perSecond: rate?.perSecond ?? null,
    };
  }
  const anchor = Date.parse(rate.anchorAt);
  if (!Number.isFinite(anchor)) return { value: recorded, mode: 'recorded', recorded, perSecond: null };
  const elapsed = Math.min(Math.max(0, nowMs - anchor), ESTIMATE_HORIZON_MS);
  const capped = nowMs - anchor > ESTIMATE_HORIZON_MS;
  return {
    value: Math.floor(recorded + rate.perSecond * (elapsed / 1000)),
    mode: capped ? 'capped' : 'estimate',
    recorded,
    perSecond: rate.perSecond,
    anchorAt: rate.anchorAt,
  };
}

export function historyPoint(accounts, checkedAt) {
  const point = { checkedAt, accounts: {} };
  for (const account of accounts) {
    const row = {};
    for (const [id, platform] of Object.entries(account.platforms || {})) {
      const metrics = {};
      for (const key of ['views', 'likes', 'comments', 'followers']) {
        if (typeof platform[key] === 'number') metrics[key] = platform[key];
      }
      if (Object.keys(metrics).length) row[id] = metrics;
    }
    if (Object.keys(row).length) point.accounts[account.id] = row;
  }
  return point;
}

export function appendHistory(history, point, { minGapMs = 15 * 60 * 1000, cap = 120 } = {}) {
  const prev = Array.isArray(history) ? history.slice() : [];
  const last = prev[prev.length - 1];
  if (last && JSON.stringify(last.accounts) === JSON.stringify(point.accounts)) {
    const gap = Date.parse(point.checkedAt) - Date.parse(last.checkedAt);
    if (Number.isFinite(gap) && gap < minGapMs) return prev;
  }
  prev.push(point);
  return prev.slice(-cap);
}

export function chooseRate(measuredPerSecond, velocityPerSecond) {
  if (typeof measuredPerSecond === 'number' && measuredPerSecond > 0) {
    return { perSecond: measuredPerSecond, source: 'measured' };
  }
  if (typeof velocityPerSecond === 'number' && velocityPerSecond > 0) {
    return { perSecond: velocityPerSecond, source: 'video-velocity' };
  }
  return { perSecond: 0, source: 'none' };
}
