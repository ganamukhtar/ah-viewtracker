import { num } from '../lib/num.js';
import { fetchText } from './http.js';
import { collectTikTokApify, apifyEnabled } from './apify-tiktok.js';
import { collectTikTokYtDlp, ytDlpBin } from './public.js';

export function parseTikTokProfile(html) {
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return { ok: false, error: 'TikTok profile did not include public user data' };
  let data;
  try { data = JSON.parse(match[1]); } catch { return { ok: false, error: 'TikTok profile data was not valid JSON' }; }
  const info = data?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
  if (!info) return { ok: false, error: 'TikTok profile payload was missing' };
  if (info.statusCode && info.statusCode !== 0) {
    return { ok: false, error: info.statusMsg || `TikTok profile status ${info.statusCode}` };
  }
  const user = info.userInfo?.user;
  const stats = info.userInfo?.stats || info.userInfo?.statsV2;
  if (!user?.uniqueId || !stats) return { ok: false, error: 'TikTok profile stats were missing' };
  return {
    ok: true,
    uniqueId: user.uniqueId,
    nickname: user.nickname || null,
    privateAccount: Boolean(user.privateAccount),
    followers: num(stats.followerCount),
    likes: num(stats.heartCount ?? stats.heart),
    videoCount: num(stats.videoCount),
  };
}

export function tiktokCreatedAt(id) {
  try {
    const ms = Number(BigInt(id) >> 32n) * 1000;
    if (!Number.isFinite(ms) || ms < Date.UTC(2016, 0, 1) || ms > Date.now() + 86400000) return null;
    return ms;
  } catch {
    return null;
  }
}

/** Average play rate of readable videos. Very new posts are skipped so a one-hour spike does not set the pace. */
export function velocityFromVideos(videos, now = Date.now()) {
  const maxAge = 45 * 24 * 3600 * 1000;
  const minAge = 30 * 60 * 1000;
  let rate = 0;
  let used = 0;
  const older = [];
  for (const video of videos || []) {
    const plays = typeof video?.playCount === 'number' ? video.playCount : null;
    const created = video?.createdAt || tiktokCreatedAt(video?.id);
    if (plays == null || plays < 0 || !created) continue;
    const age = now - created;
    if (age < minAge) continue;
    if (age <= maxAge) {
      rate += plays / (age / 1000);
      used += 1;
    } else older.push({ plays, age });
  }
  if (!used && older.length) {
    for (const video of older.sort((a, b) => a.age - b.age).slice(0, 8)) {
      rate += 0.25 * video.plays / (video.age / 1000);
      used += 1;
    }
  }
  return used ? rate : null;
}

export function parseTikTokEmbed(html) {
  const match = html.match(/<script id="__FRONTITY_CONNECT_STATE__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return { ok: false, error: 'TikTok embed did not include public video data' };
  let data;
  try { data = JSON.parse(match[1]); } catch { return { ok: false, error: 'TikTok embed data was not valid JSON' }; }
  const nodes = Object.values(data?.source?.data || {});
  const block = nodes.find((node) => node && Array.isArray(node.videoList));
  if (!block) return { ok: false, error: 'TikTok embed did not list videos' };
  const videos = block.videoList.filter((video) => video && typeof video.playCount === 'number' && video.playCount >= 0).map((video) => ({
    id: video.id || null,
    playCount: video.playCount,
    createdAt: tiktokCreatedAt(video.id),
  }));
  const plays = videos.reduce((sum, video) => sum + video.playCount, 0);
  return {
    ok: true,
    counted: videos.length,
    plays: videos.length ? plays : (block.videoList.length === 0 ? 0 : null),
    videos,
    viewsPerSecond: velocityFromVideos(videos),
    followers: num(block.userInfo?.followerCount),
    likes: num(block.userInfo?.heartCount),
  };
}

export function combineTikTok(profile, embed) {
  if (!profile?.ok) return { ok: false, error: profile?.error || 'TikTok profile failed' };
  const result = {
    ok: true,
    source: 'tiktok-public-profile',
    followers: profile.followers,
    likes: profile.likes,
    comments: null,
    views: null,
    viewsComplete: false,
    viewsCounted: null,
    viewsListed: profile.videoCount,
    viewsMethod: null,
    viewsNote: null,
  };
  if (!embed?.ok) {
    result.viewsNote = embed?.error ? `Play counts were not readable (${embed.error}). Followers and likes are from the public profile.` : null;
    return result;
  }
  if (profile.videoCount === 0) {
    result.views = 0;
    result.viewsComplete = true;
    result.viewsCounted = 0;
    result.viewsMethod = 'sum_of_public_embed_videos';
    result.viewsNote = 'The public profile lists no videos, so recorded plays are 0.';
    return result;
  }
  if (!embed?.ok || !embed.counted) {
    result.viewsNote = embed?.error
      ? `Play counts were not readable (${embed.error}). Followers and likes are from the public profile.`
      : 'The public embed did not list videos, so play counts were not recorded. Followers and likes are from the public profile.';
    return result;
  }
  if (typeof embed.plays === 'number') {
    result.views = embed.plays;
    result.viewsCounted = embed.counted;
    result.viewsMethod = 'sum_of_public_embed_videos';
    const listed = profile.videoCount;
    result.viewsComplete = typeof listed === 'number' && embed.counted >= listed;
    result.viewsNote = result.viewsComplete
      ? `Sum of play counts on ${embed.counted} public videos.`
      : `Sum of play counts on ${embed.counted} of ${listed ?? 'the'} videos TikTok's public embed returned. Not a lifetime total.`;
    if (typeof embed.viewsPerSecond === 'number') result.viewsPerSecond = embed.viewsPerSecond;
  }
  return result;
}

export function tiktokPublicEnabled(env) {
  return env.TIKTOK_PUBLIC !== '0' && env.TIKTOK_PUBLIC !== 'false';
}

export async function collectTikTokPublic(handle) {
  const name = String(handle).replace(/^@/, '');
  const profileUrl = `https://www.tiktok.com/@${encodeURIComponent(name)}`;
  let profileRes;
  try {
    profileRes = await fetchText(profileUrl, { headers: { accept: 'text/html' } });
  } catch (error) {
    return { ok: false, error: `TikTok profile request failed (${error.message})` };
  }
  if (profileRes.status === 404) return { ok: false, error: 'TikTok profile not found' };
  if (!profileRes.ok) return { ok: false, error: `TikTok profile HTTP ${profileRes.status}` };
  const profile = parseTikTokProfile(profileRes.text);
  if (!profile.ok) return profile;
  if (profile.uniqueId && profile.uniqueId.toLowerCase() !== name.toLowerCase()) {
    return { ok: false, error: `TikTok resolved @${name} to @${profile.uniqueId}` };
  }

  let embed = { ok: false, error: 'Embed was not requested' };
  if (profile.videoCount === 0) {
    embed = { ok: true, counted: 0, plays: 0 };
  } else {
    try {
      const embedRes = await fetchText(`https://www.tiktok.com/embed/@${encodeURIComponent(name)}`, { headers: { accept: 'text/html' } });
      embed = embedRes.ok ? parseTikTokEmbed(embedRes.text) : { ok: false, error: `TikTok embed HTTP ${embedRes.status}` };
    } catch (error) {
      embed = { ok: false, error: `TikTok embed request failed (${error.message})` };
    }
  }
  return combineTikTok(profile, embed);
}

function preferViews(current, incoming) {
  if (!incoming || typeof incoming.views !== 'number') return current;
  if (!current || typeof current.views !== 'number') return incoming;
  if (incoming.viewsComplete && !current.viewsComplete) return incoming;
  if (current.viewsComplete && !incoming.viewsComplete) return current;
  const incomingCoverage = incoming.viewsCounted ?? 0;
  const currentCoverage = current.viewsCounted ?? 0;
  return incomingCoverage > currentCoverage ? incoming : current;
}

export function mergeTikTokObservations(publicResult, apifyResult) {
  const usable = [publicResult, apifyResult].filter((item) => item?.ok);
  if (!usable.length) {
    return {
      ok: false,
      error: [publicResult?.error, apifyResult?.error].filter(Boolean).join('; ') || 'TikTok produced no data',
    };
  }
  const merged = {
    ok: true,
    source: usable.map((item) => item.source).filter(Boolean).join('+'),
    followers: null,
    likes: null,
    comments: null,
    views: null,
    viewsComplete: false,
    viewsCounted: null,
    viewsListed: null,
    viewsMethod: null,
    viewsNote: null,
    viewsPerSecond: null,
  };
  for (const item of usable) {
    if (merged.followers == null && typeof item.followers === 'number') merged.followers = item.followers;
    if (merged.likes == null && typeof item.likes === 'number') merged.likes = item.likes;
    if (merged.comments == null && typeof item.comments === 'number') merged.comments = item.comments;
    if (merged.viewsListed == null && typeof item.viewsListed === 'number') merged.viewsListed = item.viewsListed;
    if (merged.viewsPerSecond == null && typeof item.viewsPerSecond === 'number') merged.viewsPerSecond = item.viewsPerSecond;
  }
  const bestViews = usable.reduce((best, item) => preferViews(best, item), null);
  if (bestViews && typeof bestViews.views === 'number') {
    merged.views = bestViews.views;
    merged.viewsComplete = bestViews.viewsComplete === true;
    merged.viewsCounted = bestViews.viewsCounted ?? null;
    merged.viewsListed = bestViews.viewsListed ?? merged.viewsListed;
    merged.viewsMethod = bestViews.viewsMethod || null;
    merged.viewsNote = bestViews.viewsNote || null;
    if (bestViews.source) merged.source = usable.length > 1 ? merged.source : bestViews.source;
  }
  const notes = usable.map((item) => item.error).filter(Boolean);
  if (notes.length && !merged.viewsNote) merged.viewsNote = notes.join(' ');
  return merged;
}

export function tiktokEnabled(env) {
  return tiktokPublicEnabled(env) || apifyEnabled(env);
}

export async function collectTikTok(account, env) {
  const handle = account.platforms?.tiktok?.handle;
  if (!handle) return { ok: false, error: 'No TikTok handle configured' };
  let apify = null;
  let pub = null;
  if (apifyEnabled(env)) {
    try { apify = await collectTikTokApify(handle, env); }
    catch (error) { apify = { ok: false, error: error.message }; }
  }
  if (tiktokPublicEnabled(env) || (apify && apify.ok === false)) {
    pub = await collectTikTokPublic(handle);
    if (pub?.ok && ytDlpBin(env) && env.TIKTOK_YTDLP !== '0') {
      pub = withFullVideoList(pub, await collectTikTokYtDlp(handle, env));
    }
  }
  return mergeTikTokObservations(pub, apify);
}

/** Replace the short embed list with yt-dlp's full public video list when it read at least as many videos. */
export function withFullVideoList(pub, full) {
  if (!full?.ok || !full.counted) return pub;
  if (typeof pub.viewsCounted === 'number' && full.counted < pub.viewsCounted) return pub;
  const listed = typeof pub.viewsListed === 'number' ? pub.viewsListed : null;
  return {
    ...pub,
    source: 'tiktok-public-profile+ytdlp',
    views: full.plays,
    comments: full.comments,
    likes: typeof pub.likes === 'number' ? Math.max(pub.likes, full.videoLikes) : full.videoLikes,
    viewsComplete: listed == null || full.counted >= Math.floor(listed * 0.98),
    viewsCounted: full.counted,
    viewsMethod: 'sum_of_all_public_videos',
    viewsNote: `Sum of play counts on ${full.counted} public videos.`,
    viewsPerSecond: velocityFromVideos(full.videos) ?? pub.viewsPerSecond ?? null,
  };
}
