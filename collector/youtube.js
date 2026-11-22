import { num } from '../lib/num.js';
import { fetchJson } from './http.js';

export function youtubeEnabled(env) {
  return Boolean(env.YOUTUBE_API_KEY);
}

export async function collectYouTube(account, env) {
  const spec = account.platforms?.youtube;
  if (!spec?.handle && !spec?.id) return { ok: false, error: 'No YouTube handle configured' };
  const key = env.YOUTUBE_API_KEY;
  const params = new URLSearchParams({ part: 'statistics,snippet', key });
  if (spec.id) params.set('id', spec.id);
  else params.set('forHandle', String(spec.handle).replace(/^@/, ''));
  const channel = await fetchJson(`https://www.googleapis.com/youtube/v3/channels?${params}`);
  if (!channel.ok) return { ok: false, error: youtubeError(channel, 'channels.list') };
  const item = channel.body?.items?.[0];
  if (!item) return { ok: false, error: 'YouTube channel not found' };
  const stats = item.statistics || {};
  const result = {
    ok: true,
    source: 'youtube-data-api-v3',
    views: num(stats.viewCount),
    followers: stats.hiddenSubscriberCount ? null : num(stats.subscriberCount),
    likes: null,
    comments: null,
    viewsComplete: num(stats.viewCount) != null,
    viewsMethod: 'youtube_channel_statistics',
    viewsNote: 'Lifetime channel views from YouTube Data API channels.list statistics.',
    recentLikes: null,
    recentComments: null,
    recentNote: null,
  };
  if (env.YOUTUBE_RECENT_ENGAGEMENT === '0') return result;
  try {
    const recent = await recentEngagement(item.id, key);
    result.recentLikes = recent.likes;
    result.recentComments = recent.comments;
    result.recentNote = recent.note;
  } catch (error) {
    result.recentNote = `Recent video likes and comments were not collected (${error.message}). Channel views are unaffected.`;
  }
  return result;
}

async function recentEngagement(channelId, key) {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'date',
    maxResults: '10',
    key,
  });
  const search = await fetchJson(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
  if (!search.ok) throw new Error(youtubeError(search, 'search.list'));
  const ids = (search.body?.items || []).map((item) => item.id?.videoId).filter(Boolean);
  if (!ids.length) return { likes: null, comments: null, note: 'No recent public videos were listed.' };
  const videoParams = new URLSearchParams({ part: 'statistics', id: ids.join(','), key });
  const videos = await fetchJson(`https://www.googleapis.com/youtube/v3/videos?${videoParams}`);
  if (!videos.ok) throw new Error(youtubeError(videos, 'videos.list'));
  const items = videos.body?.items || [];
  const likes = items.map((item) => num(item.statistics?.likeCount));
  const comments = items.map((item) => num(item.statistics?.commentCount));
  return {
    likes: likes.every((value) => value != null) ? likes.reduce((sum, value) => sum + value, 0) : null,
    comments: comments.every((value) => value != null) ? comments.reduce((sum, value) => sum + value, 0) : null,
    note: `Sum of like and comment counts on the ${items.length} most recent public videos. Not a lifetime total, and not included in the likes or comments columns.`,
  };
}

function youtubeError(response, method) {
  const message = response.body?.error?.message || response.body?.error?.errors?.[0]?.message;
  return message ? `YouTube ${method}: ${message}` : `YouTube ${method} HTTP ${response.status}`;
}
