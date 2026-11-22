export const PLATFORM_ORDER = ['tiktok', 'instagram', 'youtube', 'x'];

export const PLATFORM_LABELS = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
};

const METRICS = ['views', 'likes', 'comments', 'followers'];

export function platformUrl(platform, handle) {
  if (!handle) return null;
  const name = String(handle).replace(/^@/, '');
  if (platform === 'tiktok') return `https://www.tiktok.com/@${encodeURIComponent(name)}`;
  if (platform === 'instagram') return `https://www.instagram.com/${encodeURIComponent(name)}/`;
  if (platform === 'youtube') return `https://www.youtube.com/@${encodeURIComponent(name)}`;
  if (platform === 'x') return `https://x.com/${encodeURIComponent(name)}`;
  return null;
}

export function blankPlatform(handle, url) {
  return {
    handle: handle || null,
    url: url || null,
    status: 'unavailable',
    views: null,
    likes: null,
    comments: null,
    followers: null,
    viewsComplete: null,
    viewsCounted: null,
    viewsListed: null,
    viewsMethod: null,
    viewsNote: null,
    recentLikes: null,
    recentComments: null,
    recentNote: null,
    viewsPerSecond: null,
    observedAt: null,
    checkedAt: null,
    source: null,
    error: null,
  };
}

export function hasMetric(platform) {
  if (!platform) return false;
  return METRICS.some((key) => typeof platform[key] === 'number')
    || typeof platform.recentLikes === 'number'
    || typeof platform.recentComments === 'number';
}

/**
 * Merge a collector result onto the last good reading.
 * A failure, or a null field, never replaces a number with zero or null.
 * An explicit 0 is kept — that is an observation, not a missing source.
 */
export function mergePlatform(prev, result, context = {}) {
  const base = prev ? { ...blankPlatform(), ...prev } : blankPlatform(context.handle, context.url);
  if (context.handle) base.handle = context.handle;
  if (context.url) base.url = context.url;
  base.checkedAt = context.checkedAt || base.checkedAt;

  if (!result || result.ok === false) {
    base.status = hasMetric(base) ? 'stale' : 'unavailable';
    base.error = result?.error || 'Collector failed';
    return base;
  }

  // A shorter video list (e.g. the embed fallback) must not replace a fuller earlier reading.
  const shorterList = typeof result.views === 'number' && typeof base.views === 'number'
    && result.viewsComplete !== true
    && typeof base.viewsCounted === 'number' && typeof result.viewsCounted === 'number'
    && result.viewsCounted < base.viewsCounted;
  const skip = shorterList ? new Set(['views', 'comments', 'viewsPerSecond']) : new Set();
  for (const key of [...METRICS, 'recentLikes', 'recentComments', 'viewsPerSecond']) {
    if (skip.has(key)) continue;
    if (typeof result[key] === 'number' && Number.isFinite(result[key])) base[key] = result[key];
  }
  if (typeof result.views === 'number' && !shorterList) {
    base.viewsComplete = result.viewsComplete === true;
    base.viewsCounted = typeof result.viewsCounted === 'number' ? result.viewsCounted : null;
    base.viewsListed = typeof result.viewsListed === 'number' ? result.viewsListed : null;
    base.viewsMethod = result.viewsMethod || null;
    base.viewsNote = result.viewsNote || null;
  }
  if (result.recentNote) base.recentNote = result.recentNote;
  if (result.source) base.source = result.source;
  base.observedAt = context.checkedAt || new Date().toISOString();
  base.error = null;
  if (typeof base.views === 'number' && base.viewsComplete === false) base.status = 'partial';
  else if (hasMetric(base)) base.status = 'available';
  else base.status = 'unavailable';
  return base;
}

export function accountViews(platforms) {
  const parts = PLATFORM_ORDER.map((id) => platforms?.[id]).filter(Boolean);
  const views = sumDefined(parts.map((item) => item.views));
  const partial = parts.some((item) => typeof item.views === 'number' && item.viewsComplete === false);
  return { views, partial };
}

function sumDefined(values) {
  let total = 0;
  let any = false;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      any = true;
    }
  }
  return any ? total : null;
}

export { METRICS };
