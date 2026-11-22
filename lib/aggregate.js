import { sumNumbers } from './num.js';
import { PLATFORM_ORDER } from './platforms.js';

export const CATEGORY_IDS = ['quests', 'fan', 'creators'];

export const DEFAULT_FILTER = {
  categories: ['quests', 'fan'],
  platforms: ['all'],
  query: '',
};

export function categoryOf(account) {
  return account?.category === 'personal' ? 'creators' : account?.category;
}

/** All is exclusive. An empty selection falls back to All. */
export function toggleSelection(current, id) {
  const list = Array.isArray(current) && current.length ? current : ['all'];
  if (id === 'all') return ['all'];
  const withoutAll = list.filter((item) => item !== 'all');
  const next = withoutAll.includes(id) ? withoutAll.filter((item) => item !== id) : [...withoutAll, id];
  return next.length ? next : ['all'];
}

export function normalizeFilter(filter = {}) {
  let categories = filter.categories;
  if (!categories) {
    if (!filter.category || filter.category === 'all') categories = filter.includePersonal ? ['all'] : ['quests', 'fan'];
    else categories = [filter.category === 'personal' ? 'creators' : filter.category];
  }
  categories = categories.map((item) => (item === 'personal' ? 'creators' : item));
  let platforms = filter.platforms;
  if (!platforms) platforms = !filter.platform || filter.platform === 'all' ? ['all'] : [filter.platform];
  if (!categories.length || categories.includes('all')) categories = ['all'];
  if (!platforms.length || platforms.includes('all')) platforms = ['all'];
  return { categories, platforms, query: filter.query || '' };
}

export function activePlatformIds(filter) {
  const { platforms } = normalizeFilter(filter);
  return platforms.includes('all') ? PLATFORM_ORDER : platforms;
}

export function matchesAccount(account, filter) {
  const selected = normalizeFilter(filter);
  if (!selected.categories.includes('all') && !selected.categories.includes(categoryOf(account))) return false;
  if (!selected.platforms.includes('all') && !selected.platforms.some((id) => account.platforms?.[id])) return false;
  const query = selected.query.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    account.name,
    account.handle,
    account.id,
    ...Object.values(account.platforms || {}).map((item) => item?.handle || ''),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function platformList(account, filter) {
  return activePlatformIds(filter)
    .map((id) => account.platforms?.[id] ? { id, ...account.platforms[id] } : null)
    .filter(Boolean);
}

function metricOf(platforms, key) {
  return sumNumbers(platforms.map((item) => item[key]));
}

export function presentAccount(account, filter) {
  const platforms = platformList(account, filter);
  const views = metricOf(platforms, 'views');
  const likes = metricOf(platforms, 'likes');
  const comments = metricOf(platforms, 'comments');
  const followers = metricOf(platforms, 'followers');
  const partial = platforms.some((item) => typeof item.views === 'number' && item.viewsComplete === false);
  return {
    ...account,
    rowPlatforms: platforms,
    views,
    likes,
    comments,
    followers,
    viewsPartial: partial && typeof views === 'number',
  };
}

export function aggregate(snapshot, filter = DEFAULT_FILTER) {
  const accounts = (snapshot?.accounts || [])
    .filter((account) => matchesAccount(account, filter))
    .map((account) => presentAccount(account, filter));
  const views = sumNumbers(accounts.map((account) => account.views));
  const likes = sumNumbers(accounts.map((account) => account.likes));
  const comments = sumNumbers(accounts.map((account) => account.comments));
  const followers = sumNumbers(accounts.map((account) => account.followers));
  const viewsPartial = accounts.some((account) => account.viewsPartial);
  const velocityPerSecond = sumNumbers(accounts.flatMap((account) => account.rowPlatforms.map((item) => item.viewsPerSecond)));
  const platformTotals = {};
  const visiblePlatforms = activePlatformIds(filter);
  for (const id of visiblePlatforms) {
    const rows = accounts.map((account) => account.platforms?.[id]).filter(Boolean);
    platformTotals[id] = {
      views: sumNumbers(rows.map((item) => item.views)),
      likes: sumNumbers(rows.map((item) => item.likes)),
      comments: sumNumbers(rows.map((item) => item.comments)),
      followers: sumNumbers(rows.map((item) => item.followers)),
      partial: rows.some((item) => typeof item.views === 'number' && item.viewsComplete === false),
      connected: rows.some((item) => ['available', 'partial', 'stale'].includes(item.status) && (
        typeof item.views === 'number' || typeof item.likes === 'number'
        || typeof item.comments === 'number' || typeof item.followers === 'number'
      )),
    };
  }
  return {
    accounts,
    views,
    likes,
    comments,
    followers,
    viewsPartial,
    velocityPerSecond,
    platformTotals,
    matched: accounts.length,
    withViews: accounts.filter((account) => typeof account.views === 'number').length,
  };
}

export function historyMetric(point, accountId, metric, platform) {
  const row = point?.accounts?.[accountId];
  if (!row) return null;
  const ids = !platform || platform === 'all' ? PLATFORM_ORDER : (Array.isArray(platform) ? platform : [platform]);
  return sumNumbers(ids.map((id) => row[id]?.[metric]));
}

export function growthFor(history, account, metric, platform, nowMs) {
  const ids = !platform || platform === 'all' ? null : (Array.isArray(platform) ? platform : [platform]);
  const current = ids ? sumNumbers(ids.map((id) => account.platforms?.[id]?.[metric])) : account[metric];
  if (typeof current !== 'number' || !Array.isArray(history) || !history.length || !Number.isFinite(nowMs)) return null;
  const target = nowMs - 24 * 60 * 60 * 1000;
  const points = history
    .map((point) => ({
      t: Date.parse(point.checkedAt),
      v: historyMetric(point, account.id, metric, platform),
    }))
    .filter((point) => Number.isFinite(point.t) && typeof point.v === 'number' && point.t <= nowMs - 60 * 1000)
    .sort((a, b) => a.t - b.t);
  let past = null;
  for (const point of points) if (point.t <= target) past = point;
  if (!past) return null;
  return {
    delta: current - past.v,
    from: past.t,
    hours: (nowMs - past.t) / 3600000,
  };
}

export { PLATFORM_ORDER };
