import { num } from '../lib/num.js';
import { fetchJson } from './http.js';

export function apifyEnabled(env) {
  return Boolean(env.APIFY_TOKEN);
}

export function interpretApifyItems(items) {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'Apify returned no items' };
  const followers = firstNum(items, ['followerCount', 'followers', 'fans', 'authorMeta.fans', 'authorMeta.followers', 'authorStats.followerCount']);
  const profileLikes = firstNum(items, ['heartCount', 'heart', 'authorMeta.heart', 'authorStats.heartCount']);
  const listed = firstNum(items, ['videoCount', 'videos', 'authorMeta.video', 'authorStats.videoCount']);
  const videoItems = items.filter((item) => num(item.playCount ?? item.plays ?? item.videoMeta?.playCount ?? item.stats?.playCount) != null);
  let views = null;
  let viewsCounted = null;
  let comments = null;
  let videoLikes = null;
  if (videoItems.length) {
    views = videoItems.reduce((sum, item) => sum + num(item.playCount ?? item.plays ?? item.videoMeta?.playCount ?? item.stats?.playCount), 0);
    viewsCounted = videoItems.length;
    const commentValues = videoItems.map((item) => num(item.commentCount ?? item.comments ?? item.stats?.commentCount));
    const likeValues = videoItems.map((item) => num(item.diggCount ?? item.likes ?? item.stats?.diggCount));
    if (commentValues.every((value) => value != null)) comments = commentValues.reduce((sum, value) => sum + value, 0);
    if (likeValues.every((value) => value != null)) videoLikes = likeValues.reduce((sum, value) => sum + value, 0);
  } else {
    views = firstNum(items, ['playCount', 'plays', 'views']);
  }
  const complete = views != null && (videoItems.length === 0 || (typeof listed === 'number' && videoItems.length >= listed));
  const likes = profileLikes != null ? profileLikes : (complete ? videoLikes : null);
  if (followers == null && likes == null && views == null) return { ok: false, error: 'Apify items did not include follower, like, or play counts' };
  return {
    ok: true,
    source: 'apify-tiktok',
    followers,
    likes,
    comments: complete ? comments : null,
    views,
    viewsComplete: views != null && complete,
    viewsCounted,
    viewsListed: listed,
    viewsMethod: videoItems.length ? 'apify_sum_of_returned_videos' : 'apify_profile_field',
    viewsNote: views == null ? null : (complete
      ? 'Play counts returned by the configured Apify actor.'
      : `Apify returned play counts for ${viewsCounted || 'some'} videos${listed != null ? ` of ${listed}` : ''}. Not treated as a lifetime total.`),
  };
}

function dig(obj, path) {
  return path.split('.').reduce((value, key) => (value == null ? null : value[key]), obj);
}

function firstNum(items, paths) {
  for (const item of items) {
    for (const path of paths) {
      const value = num(dig(item, path));
      if (value != null) return value;
    }
  }
  return null;
}

export async function collectTikTokApify(handle, env) {
  const actor = env.APIFY_TIKTOK_ACTOR || 'clockworks/tiktok-scraper';
  const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(actor).replace('%2F', '~')}/run-sync-get-dataset-items?token=${encodeURIComponent(env.APIFY_TOKEN)}&timeout=90`;
  const response = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profiles: [String(handle).replace(/^@/, '')],
      resultsPerPage: 30,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
    }),
    timeoutMs: 100000,
  });
  if (!response.ok) {
    const message = response.body?.error?.message || response.body?.message || `HTTP ${response.status}`;
    return { ok: false, error: `Apify ${message}` };
  }
  return interpretApifyItems(response.body);
}
