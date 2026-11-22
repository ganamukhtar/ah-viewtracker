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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
    res = await runYtDlp(`https://www.tiktok.com/@${encodeURIComponent(name)}`, env, 240000);
    if (res.ok && (res.data?.entries || []).length) break;
  }
  if (!res.ok) return { ok: false, error: `yt-dlp: ${res.error}` };
  const entries = (res.data?.entries || []).filter((item) => item && typeof item.view_count === 'number');
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

const CRAWLER_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export async function collectInstagramPublic(handle) {
  const name = String(handle).replace(/^@/, '');
  let lastError = 'Instagram profile was not readable';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
    let res;
    try { res = await fetchText(`https://www.instagram.com/${encodeURIComponent(name)}/`, { headers: { 'user-agent': CRAWLER_UA } }); }
    catch (error) { lastError = `Instagram request failed (${error.message})`; continue; }
    if (res.status === 404) return { ok: false, error: 'Instagram profile not found' };
    if (!res.ok) { lastError = `Instagram HTTP ${res.status}`; continue; }
    const meta = res.text.match(/<meta property="og:description" content="([^"]*)"/);
    if (!meta) { lastError = 'Instagram profile did not include public counts'; continue; }
    const followers = meta[1].match(/([0-9.,]+[KMB]?)\s+Followers/i);
    const posts = meta[1].match(/([0-9.,]+[KMB]?)\s+Posts/i);
    if (!followers) { lastError = 'Instagram follower count missing'; continue; }
    return {
      ok: true,
      source: 'instagram-public-profile',
      followers: parseCount(followers[1]),
      viewsListed: posts ? parseCount(posts[1]) : null,
    };
  }
  return { ok: false, error: lastError };
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
