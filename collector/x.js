import { num } from '../lib/num.js';
import { fetchJson } from './http.js';
import { collectXPublic } from './public.js';

export function xEnabled(env) {
  return env.X_PUBLIC !== '0' || xApiEnabled(env);
}

export function xApiEnabled(env) {
  return Boolean(env.X_BEARER_TOKEN);
}

export async function collectX(account, env) {
  const handle = account.platforms?.x?.handle;
  if (!handle) return { ok: false, error: 'No X handle configured' };
  const username = String(handle).replace(/^@/, '');
  if (!xApiEnabled(env)) return collectXPublic(username);
  const headers = { authorization: `Bearer ${env.X_BEARER_TOKEN}` };
  const userRes = await fetchJson(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics`,
    { headers },
  );
  if (userRes.status === 404 || userRes.body?.errors) {
    return { ok: false, error: userRes.body?.errors?.[0]?.detail || userRes.body?.detail || 'X user not found' };
  }
  if (!userRes.ok) return { ok: false, error: userRes.body?.detail || userRes.body?.title || `X HTTP ${userRes.status}` };
  const user = userRes.body?.data;
  if (!user?.id) return { ok: false, error: 'X user payload was missing' };
  const metrics = user.public_metrics || {};
  const followers = num(metrics.followers_count);
  const tweetCount = num(metrics.tweet_count);
  const posts = await collectPostMetrics(user.id, headers, tweetCount);
  return {
    ok: true,
    source: 'x-api-v2',
    followers,
    likes: posts.likes,
    comments: posts.comments,
    views: posts.impressions,
    viewsComplete: posts.complete && posts.impressions != null,
    viewsCounted: posts.counted,
    viewsListed: tweetCount,
    viewsMethod: posts.impressions != null ? 'sum_of_post_impressions' : null,
    viewsNote: posts.note,
  };
}

async function collectPostMetrics(userId, headers, tweetCount) {
  const posts = [];
  let token = null;
  let pages = 0;
  while (pages < 5) {
    const params = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'public_metrics',
      exclude: 'retweets',
    });
    if (token) params.set('pagination_token', token);
    const response = await fetchJson(`https://api.x.com/2/users/${userId}/tweets?${params}`, { headers });
    if (!response.ok) {
      return {
        likes: null,
        comments: null,
        impressions: null,
        counted: posts.length,
        complete: false,
        note: `Post metrics stopped early (${response.body?.detail || response.body?.title || `HTTP ${response.status}`}). Follower count is unaffected. Incomplete like, reply, and impression sums are not recorded.`,
      };
    }
    posts.push(...(response.body?.data || []));
    token = response.body?.meta?.next_token || null;
    pages += 1;
    if (!token) break;
  }
  const impressionValues = posts.map((post) => num(post.public_metrics?.impression_count));
  const likeValues = posts.map((post) => num(post.public_metrics?.like_count));
  const replyValues = posts.map((post) => num(post.public_metrics?.reply_count));
  const reachedEnd = !token;
  const coversAll = reachedEnd && (tweetCount == null || posts.length >= tweetCount);
  const impressions = impressionValues.length && impressionValues.every((value) => value != null) && coversAll
    ? impressionValues.reduce((sum, value) => sum + value, 0)
    : null;
  const likes = likeValues.length && likeValues.every((value) => value != null) && coversAll
    ? likeValues.reduce((sum, value) => sum + value, 0)
    : null;
  const comments = replyValues.length && replyValues.every((value) => value != null) && coversAll
    ? replyValues.reduce((sum, value) => sum + value, 0)
    : null;
  let note = 'Followers come from X user public_metrics.';
  if (impressions == null) {
    note += impressionValues.some((value) => value == null)
      ? ' impression_count was missing on one or more posts, so views were not recorded.'
      : ' Post impressions were not summed because the timeline was incomplete or capped.';
  } else note += ' Views are the sum of public impression_count on returned posts.';
  if (likes == null) note += ' Like and reply sums are omitted unless every returned post has them and the timeline was fully read.';
  return { likes, comments, impressions, counted: posts.length, complete: coversAll, note };
}
