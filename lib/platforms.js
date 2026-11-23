export const PLATFORM_ORDER = ['tiktok', 'instagram', 'youtube', 'x', 'facebook'];

export const PLATFORM_LABELS = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
  facebook: 'Facebook',
};

const METRICS = ['views', 'likes', 'comments', 'followers'];

export function platformUrl(platform, handle) {
  if (!handle) return null;
  const name = String(handle).replace(/^@/, '');
  if (platform === 'tiktok') return `https://www.tiktok.com/@${encodeURIComponent(name)}`;
  if (platform === 'instagram') return `https://www.instagram.com/${encodeURIComponent(name)}/`;
  if (platform === 'youtube') return `https://www.youtube.com/@${encodeURIComponent(name)}`;
  if (platform === 'x') return `https://x.com/${encodeURIComponent(name)}`;
  if (platform === 'facebook') {
    if (/^\d+$/.test(name)) return `https://www.facebook.com/profile.php?id=${name}`;
    return `https://www.facebook.com/${encodeURIComponent(name)}`;
  }
  return null;
}

/** One platform can list several pages. Each becomes its own read, then the numbers are summed. */
export function platformTargets(platform, spec = {}) {
  const urls = Array.isArray(spec.urls) ? spec.urls.filter(Boolean) : [];
  const handles = Array.isArray(spec.handles) ? spec.handles.filter(Boolean) : [];
  if (urls.length) {
    return urls.map((url, index) => ({
      handle: handles[index] || spec.handle || null,
      url,
      id: spec.id || null,
    }));
  }
  const list = handles.length ? handles : (spec.handle ? [spec.handle] : []);
  return list.map((handle) => ({
    handle,
    url: list.length === 1 ? (spec.url || platformUrl(platform, handle)) : platformUrl(platform, handle),
    id: spec.id || null,
  }));
}

export function platformHandleKey(platform, spec = {}) {
  const targets = platformTargets(platform, spec);
  return targets.map((item) => item.handle).filter(Boolean).join('+') || null;
}

export function sumObservations(results) {
  const ok = (results || []).filter((item) => item?.ok);
  if (!ok.length) {
    return { ok: false, error: (results || []).map((item) => item?.error).filter(Boolean).join('; ') || 'No page configured' };
  }
  const add = (key) => {
    const values = ok.map((item) => item[key]).filter((value) => typeof value === 'number' && Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const viewParts = ok.filter((item) => typeof item.views === 'number');
  return {
    ok: true,
    source: [...new Set(ok.map((item) => item.source).filter(Boolean))].join('+'),
    followers: add('followers'),
    posts: add('posts'),
    recentNote: ok.map(item => item.recentNote).filter(Boolean).join(' '),
    likes: add('likes'),
    comments: add('comments'),
    views: viewParts.length ? viewParts.reduce((sum, item) => sum + item.views, 0) : null,
    viewsComplete: viewParts.length === results.length && results.every((item) => item?.ok && item.viewsComplete === true),
    viewsCounted: add('viewsCounted'),
    viewsListed: add('viewsListed'),
    viewsMethod: ok.find((item) => item.viewsMethod)?.viewsMethod || null,
    viewsNote: ok.map((item) => item.viewsNote).filter(Boolean).join(' '),
    viewsPerSecond: add('viewsPerSecond'),
  };
}

/** A previous reading belongs to this page only when the handle is the same. */
export function samePlatformHandle(prev, handle) {
  const left = String(prev?.handle || '').replace(/^@/, '').toLowerCase();
  const right = String(handle || '').replace(/^@/, '').toLowerCase();
  return Boolean(left) && left === right;
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

  // A shorter embed must not replace a fuller reading. A count above the profile's
  // own video total is not a fuller reading; it can double-count, so a new sum may replace it.
  const overCount = typeof base.viewsCounted === 'number' && typeof base.viewsListed === 'number'
    && base.viewsListed > 0 && base.viewsCounted > Math.ceil(base.viewsListed * 1.02);
  const shorterList = typeof result.views === 'number' && typeof base.views === 'number'
    && result.viewsComplete !== true
    && !overCount
    && typeof base.viewsCounted === 'number' && typeof result.viewsCounted === 'number'
    && result.viewsCounted < base.viewsCounted;
  const skip = shorterList ? new Set(['views', 'comments', 'viewsPerSecond']) : new Set();
  for (const key of [...METRICS, 'posts', 'recentLikes', 'recentComments', 'viewsPerSecond']) {
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
