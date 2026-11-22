import { parseCount } from './public.js';
import { fetchText } from './http.js';
import { platformUrl } from '../lib/platforms.js';

const CRAWLER_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export function facebookEnabled(env = process.env) {
  return env.FACEBOOK_PUBLIC !== '0';
}

export function facebookPageUrl(spec) {
  if (!spec) return null;
  if (spec.url) return spec.url;
  return platformUrl('facebook', spec.handle);
}

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex) => {
      const code = Number.parseInt(hex, 16);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : entity; } catch { return entity; }
    })
    .replace(/&#(\d+);/g, (entity, num) => {
      const code = Number(num);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : entity; } catch { return entity; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'");
}

/** Public follower and page-like counts from a Facebook og:description. Missing counts stay null. */
export function parseFacebookCounts(html) {
  const meta = String(html || '').match(/<meta property="og:description" content="([^"]*)"/i);
  if (!meta) return { followers: null, likes: null };
  const description = decodeEntities(meta[1]);
  const followers = description.match(/([0-9][0-9.,]*\s*[KMB]?)\s+followers/i);
  const likes = description.match(/([0-9][0-9.,]*\s*[KMB]?)\s+likes/i);
  return {
    followers: followers ? parseCount(followers[1]) : null,
    likes: likes ? parseCount(likes[1]) : null,
  };
}

export async function collectFacebook(account) {
  const spec = account.platforms?.facebook;
  const url = facebookPageUrl(spec);
  if (!url) return { ok: false, error: 'No Facebook page configured' };
  let res;
  try {
    res = await fetchText(url, { timeoutMs: 30000, headers: { 'user-agent': CRAWLER_UA } });
  } catch (error) {
    return { ok: false, error: `Facebook request failed (${error.message})` };
  }
  if (!res.ok) return { ok: false, error: `Facebook HTTP ${res.status}` };
  const counts = parseFacebookCounts(res.text);
  const followers = counts.followers ?? counts.likes;
  if (typeof followers !== 'number') return { ok: false, error: 'Facebook page had no public follower or like count' };
  return {
    ok: true,
    source: 'facebook-public-page',
    followers,
    likes: null,
    comments: null,
    views: null,
    viewsNote: counts.followers != null
      ? 'Followers from the public Facebook page.'
      : 'The public Facebook page published a like count and no follower count. That like count is stored as followers.',
  };
}
