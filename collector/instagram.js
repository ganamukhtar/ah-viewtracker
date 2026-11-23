import { num } from '../lib/num.js';
import { fetchJson } from './http.js';
import { collectInstagramPublic } from './public.js';

export function instagramEnabled(env) {
  return env.INSTAGRAM_PUBLIC !== '0' || instagramApiEnabled(env);
}

export function instagramApiEnabled(env) {
  return Boolean(env.IG_BUSINESS_ACCOUNT_ID && env.IG_ACCESS_TOKEN);
}

const FIELD_SETS = [
  'followers_count,media_count,media.limit(50){like_count,comments_count,view_count}',
  'followers_count,media_count,media.limit(50){like_count,comments_count}',
  'followers_count,media_count',
];

export async function collectInstagram(account, env) {
  const handle = account.platforms?.instagram?.handle;
  if (!handle) return { ok: false, error: 'No Instagram handle configured' };
  const username = String(handle).replace(/^@/, '');
  if (!instagramApiEnabled(env)) return collectInstagramPublic(username);
  let discovery = null;
  let lastError = 'Instagram Business Discovery failed';
  for (const fields of FIELD_SETS) {
    const params = new URLSearchParams({
      fields: `business_discovery.username(${username}){${fields}}`,
      access_token: env.IG_ACCESS_TOKEN,
    });
    const response = await fetchJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(env.IG_BUSINESS_ACCOUNT_ID)}?${params}`);
    if (response.ok && response.body?.business_discovery) {
      discovery = response.body.business_discovery;
      break;
    }
    lastError = response.body?.error?.message || `Instagram HTTP ${response.status}`;
    if (response.status === 400 && /unknown/i.test(lastError) && fields !== FIELD_SETS.at(-1)) continue;
    if (!response.ok && fields === FIELD_SETS.at(-1)) return { ok: false, error: lastError };
  }
  if (!discovery) return { ok: false, error: lastError };

  const mediaCount = num(discovery.media_count);
  const media = [];
  let page = discovery.media;
  const visited = new Set();
  const ids = new Set();
  while (page) {
    for (const item of page.data || []) {
      if (!item.id || ids.has(item.id)) continue;
      ids.add(item.id);
      media.push(item);
    }
    const next = page.paging?.next;
    if (!next || visited.has(next) || (mediaCount != null && media.length >= mediaCount)) break;
    visited.add(next);
    const response = await fetchJson(next);
    if (!response.ok) break;
    page = response.body;
  }

  const followers = num(discovery.followers_count);
  const viewsValues = media.map((item) => num(item.view_count));
  const likeValues = media.map((item) => num(item.like_count));
  const commentValues = media.map((item) => num(item.comments_count));
  const fetchedAll = mediaCount != null && media.length >= mediaCount;
  const views = everyNumber(viewsValues) && fetchedAll ? viewsValues.reduce((sum, value) => sum + value, 0) : null;
  const likes = everyNumber(likeValues) && fetchedAll ? likeValues.reduce((sum, value) => sum + value, 0) : null;
  const comments = everyNumber(commentValues) && fetchedAll ? commentValues.reduce((sum, value) => sum + value, 0) : null;
  return {
    ok: true,
    source: 'instagram-graph-business-discovery',
    followers,
    posts: mediaCount,
    likes,
    comments,
    views,
    viewsComplete: views != null,
    viewsCounted: media.filter((item) => num(item.view_count) != null).length,
    viewsListed: mediaCount,
    viewsMethod: views != null ? 'sum_of_business_discovery_media' : null,
    viewsNote: views != null
      ? 'Sum of view_count on media returned by Instagram Business Discovery.'
      : 'Followers come from Business Discovery. View, like, or comment sums are omitted unless every media item was returned with that count.',
  };
}

function everyNumber(values) {
  return values.length > 0 && values.every((value) => typeof value === 'number');
}
