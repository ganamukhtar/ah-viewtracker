import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { num } from '../lib/num.js';
import { fetchText, fetchJson } from './http.js';

/** "1.45K" -> 1450, "297K" -> 297000, "1,181,322" -> 1181322. Returns null when unreadable. */
export function parseCount(text) {
  if (text == null) return null;
  const match = String(text).replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*([KMB])?/i);
  if (!match) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[String(match[2] || '').toUpperCase()] || 1;
  return num(Number(match[1]) * scale);
}

// ---------- yt-dlp (TikTok full video list) ----------

export function ytDlpBin(env = process.env) {
  if (env.YTDLP_BIN) return env.YTDLP_BIN;
  const local = path.join(os.homedir(), '.local', 'bin', 'yt-dlp');
  if (existsSync(local)) return local;
  for (const dir of String(env.PATH || '').split(':')) {
    if (dir && existsSync(path.join(dir, 'yt-dlp'))) return path.join(dir, 'yt-dlp');
  }
  return null;
}

export function runYtDlp(url, env = process.env, timeoutMs = 120000) {
  const bin = ytDlpBin(env);
  if (!bin) return Promise.resolve({ ok: false, error: 'yt-dlp is not installed' });
  return new Promise((resolve) => {
    const child = spawn(bin, ['--flat-playlist', '-J', '--no-warnings', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, error: (err.trim().split('\n').pop() || `yt-dlp exited ${code}`).slice(0, 200) });
      try { resolve({ ok: true, data: JSON.parse(out) }); } catch { resolve({ ok: false, error: 'yt-dlp output was not JSON' }); }
    });
  });
}

/** Sum every public TikTok video's plays, likes and comments via yt-dlp. */
export async function collectTikTokYtDlp(handle, env = process.env) {
  const name = String(handle).replace(/^@/, '');
  let res = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
    res = await runYtDlp(`https://www.tiktok.com/@${encodeURIComponent(name)}`, env, 150000);
    if (res.ok && (res.data?.entries || []).length) break;
  }
  if (!res.ok) return { ok: false, error: `yt-dlp: ${res.error}` };
  const byId = new Map();
  for (const item of res.data?.entries || []) {
    if (!item?.id || typeof item.view_count !== 'number' || item.view_count < 0) continue;
    const prev = byId.get(String(item.id));
    if (!prev || item.view_count > prev.view_count) byId.set(String(item.id), item);
  }
  const entries = [...byId.values()];
  const sum = (key) => entries.reduce((total, item) => total + (typeof item[key] === 'number' ? item[key] : 0), 0);
  const videos = entries.map((item) => ({ id: item.id, playCount: item.view_count, createdAt: item.timestamp ? item.timestamp * 1000 : null }));
  return {
    ok: true,
    source: 'tiktok-ytdlp',
    counted: entries.length,
    plays: sum('view_count'),
    videoLikes: sum('like_count'),
    comments: sum('comment_count'),
    videos,
  };
}

// ---------- YouTube public channel page ----------

export async function collectYouTubePublic(spec) {
  const handle = spec?.handle ? String(spec.handle).replace(/^@/, '') : null;
  const url = spec?.id ? `https://www.youtube.com/channel/${spec.id}/about` : `https://www.youtube.com/@${encodeURIComponent(handle)}/about`;
  let res;
  try { res = await fetchText(url, { headers: { 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1' } }); }
  catch (error) { return { ok: false, error: `YouTube request failed (${error.message})` }; }
  if (res.status === 404) return { ok: false, error: 'YouTube channel not found' };
  if (!res.ok) return { ok: false, error: `YouTube HTTP ${res.status}` };
  const pick = (key) => {
    const match = res.text.match(new RegExp(`"${key}":"([^"]*)"`));
    return match ? match[1] : null;
  };
  const viewText = pick('viewCountText');
  const subText = pick('subscriberCountText');
  const videoText = pick('videoCountText');
  const views = viewText && /view/i.test(viewText) ? (/no views/i.test(viewText) ? 0 : parseCount(viewText)) : null;
  const followers = subText ? parseCount(subText) : null;
  if (views == null && followers == null) return { ok: false, error: 'YouTube about page had no public counts' };
  return {
    ok: true,
    source: 'youtube-public-page',
    views,
    followers,
    likes: null,
    comments: null,
    viewsComplete: views != null,
    viewsListed: videoText ? parseCount(videoText) : null,
    viewsMethod: views != null ? 'youtube_channel_total_views' : null,
    viewsNote: views != null ? 'Lifetime channel views from the public channel page.' : null,
  };
}

// ---------- Instagram public profile (followers) ----------

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CRAWLER_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export function instagramProfileCounts(html, handle) {
  const canonical = html.match(/<meta property="og:url" content="https:\/\/www\.instagram\.com\/([^/"?]+)\/?"/i);
  if (canonical?.[1]?.toLowerCase() !== handle.toLowerCase()) {
    return { ok: false, error: 'Instagram did not return the requested public profile' };
  }
  const exact = html.match(/"edge_followed_by":\{"count":(\d+)\}/);
  const description = html.match(/<meta property="og:description" content="([^"]*)"/i)?.[1] || '';
  const count = (label) => {
    const match = description.match(new RegExp('([0-9.,]+[KMB]?)\\s+' + label + '\\b', 'i'));
    return match ? parseCount(match[1]) : null;
  };
  const followers = exact ? num(exact[1]) : count('Followers?');
  if (followers == null) return { ok: false, error: 'Public follower count unavailable' };
  return {
    ok: true,
    source: 'instagram-public-profile',
    followers,
    views: null,
    likes: null,
    comments: null,
    posts: count('Posts?'),
    viewsListed: count('Posts?'),
    viewsNote: exact ? null : 'Follower count is the rounded public preview. An exact count was not in the page.',
  };
}

function mediaTotals(edges) {
  let views = 0;
  let likes = 0;
  let comments = 0;
  let viewPosts = 0;
  let likePosts = 0;
  let commentPosts = 0;
  for (const edge of edges || []) {
    const node = edge?.node || edge;
    if (!node) continue;
    const view = num(node.video_play_count ?? node.video_view_count);
    const like = num(node.edge_liked_by?.count ?? node.like_count);
    const comment = num(node.edge_media_to_comment?.count ?? node.comment_count);
    if (view != null) { views += view; viewPosts += 1; }
    if (like != null) { likes += like; likePosts += 1; }
    if (comment != null) { comments += comment; commentPosts += 1; }
  }
  return { views, likes, comments, viewPosts, likePosts, commentPosts };
}

/** Map a web_profile_info user to counts. Followers never become views. */
export function instagramFromProfile(user, edges = user?.edge_owner_to_timeline_media?.edges || []) {
  const followers = num(user?.edge_followed_by?.count);
  const listed = num(user?.edge_owner_to_timeline_media?.count);
  const totals = mediaTotals(edges);
  const result = {
    ok: true,
    source: 'instagram-web-profile',
    followers,
    views: null,
    likes: null,
    comments: null,
    viewsListed: listed,
    viewsComplete: false,
    viewsCounted: totals.viewPosts || null,
    viewsMethod: null,
    viewsNote: null,
  };
  if (totals.viewPosts) {
    result.views = totals.views;
    result.viewsComplete = listed != null && totals.viewPosts >= listed;
    result.viewsMethod = 'sum_of_public_posts';
    result.viewsNote = result.viewsComplete
      ? `Sum of public play counts on ${totals.viewPosts} posts.`
      : `Sum of public play counts on ${totals.viewPosts}${listed != null ? ` of ${listed}` : ''} posts. The unread posts are not estimated.`;
  }
  if (totals.likePosts) result.likes = totals.likes;
  if (totals.commentPosts) result.comments = totals.comments;
  if (!result.viewsNote && (totals.likePosts || totals.commentPosts)) {
    result.viewsNote = `Likes and comments are the sum of ${edges.length} public posts${listed != null ? ` of ${listed}` : ''}. Not a lifetime total.`;
  }
  return result;
}

export async function collectInstagramPublic(handle) {
  const name = String(handle).replace(/^@/, '');
  let lastError = 'Instagram profile was not readable';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
    const info = await fetchJson(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(name)}`, {
      headers: {
        'user-agent': BROWSER_UA,
        'x-ig-app-id': '936619743392459',
        referer: `https://www.instagram.com/${encodeURIComponent(name)}/`,
        accept: '*/*',
      },
      timeoutMs: 25000,
    }).catch((error) => ({ ok: false, status: 0, body: { message: error.message } }));
    const user = info.body?.data?.user;
    if (info.status === 404 || user === null) return { ok: false, error: 'Instagram profile not found' };
    if (info.status === 429) return { ok: false, error: 'Instagram HTTP 429' };
    if (info.ok && user?.username && String(user.username).toLowerCase() === name.toLowerCase()) {
      let edges = user.edge_owner_to_timeline_media?.edges || [];
      let page = user.edge_owner_to_timeline_media?.page_info;
      for (let extra = 0; extra < 4 && page?.has_next_page && page.end_cursor && user.id; extra += 1) {
        const more = await fetchInstagramPage(user.id, page.end_cursor);
        if (!more?.edges?.length) break;
        edges = edges.concat(more.edges);
        page = more.page_info;
      }
      const result = instagramFromProfile(user, edges);
      if (result.followers == null && result.views == null) {
        lastError = 'Instagram profile had no public counts';
        continue;
      }
      return result;
    }
    lastError = info.body?.message || `Instagram HTTP ${info.status || 'error'}`;
    let res;
    try { res = await fetchText(`https://www.instagram.com/${encodeURIComponent(name)}/`, { headers: { 'user-agent': attempt % 2 ? BROWSER_UA : CRAWLER_UA } }); }
    catch (error) { lastError = `Instagram request failed (${error.message})`; continue; }
    if (res.status === 404) return { ok: false, error: 'Instagram profile not found' };
    if (!res.ok) { lastError = `Instagram HTTP ${res.status}`; continue; }
    const exact = res.text.match(/"edge_followed_by":\{"count":(\d+)\}/);
    const meta = res.text.match(/<meta property="og:description" content="([^"]*)"/);
    if (exact) {
      return {
        ok: true,
        source: 'instagram-public-profile',
        followers: num(exact[1]),
        views: null,
        likes: null,
        comments: null,
        viewsListed: meta ? (meta[1].match(/([0-9.,]+[KMB]?)\s+Posts/i) ? parseCount(meta[1].match(/([0-9.,]+[KMB]?)\s+Posts/i)[1]) : null) : null,
      };
    }
    if (!meta) { lastError = 'Instagram profile did not include public counts'; continue; }
    const followers = meta[1].match(/([0-9.,]+[KMB]?)\s+Followers/i);
    const posts = meta[1].match(/([0-9.,]+[KMB]?)\s+Posts/i);
    if (!followers) { lastError = 'Instagram follower count missing'; continue; }
    const parsed = instagramProfileCounts(res.text, name);
    if (parsed.ok) return parsed;
    lastError = parsed.error || lastError;
  }
  return { ok: false, error: lastError };
}

async function fetchInstagramPage(userId, after) {
  const variables = JSON.stringify({ id: userId, first: 12, after });
  for (const queryHash of ['69cba40317214236af40e7efa697781d', 'e769aa130647d2354c40ea6a439bfc08']) {
    const response = await fetchJson(`https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(variables)}`, {
      headers: {
        'user-agent': BROWSER_UA,
        'x-ig-app-id': '936619743392459',
        accept: '*/*',
      },
      timeoutMs: 15000,
    }).catch(() => null);
    const media = response?.body?.data?.user?.edge_owner_to_timeline_media;
    if (media?.edges?.length) return media;
  }
  return null;
}

// ---------- X public profile (followers) ----------

export async function collectXPublic(handle) {
  const name = String(handle).replace(/^@/, '');
  let res = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    try { res = await fetchJson(`https://api.fxtwitter.com/${encodeURIComponent(name)}`, { headers: { 'user-agent': 'ah-viewtracker/1.0' } }); }
    catch (error) { res = { ok: false, status: 0, body: { message: error.message } }; }
    if (res.ok && res.body?.user) break;
  }
  const user = res.body?.user;
  if (!res.ok || !user) return { ok: false, error: res.body?.message || `X HTTP ${res.status}` };
  if (String(user.screen_name || '').toLowerCase() !== name.toLowerCase()) return { ok: false, error: `X resolved @${name} to @${user.screen_name}` };
  return { ok: true, source: 'x-public-profile', followers: num(user.followers) };
}
