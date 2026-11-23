import { readFile } from 'node:fs/promises';
import { fetchText } from './http.js';

const ledger = new URL('../data/brandon-youtube-likes.json', import.meta.url);
const handle = 'BrandonLConceicao';

export async function addBrandonLikes(result, channel) {
  if (channel?.toLowerCase() !== handle.toLowerCase()) return result;
  const readings = JSON.parse(await readFile(ledger, 'utf8'));
  const snapshot = JSON.parse(await readFile(new URL('../data/snapshot.json', import.meta.url), 'utf8'));
  Object.assign(readings, snapshot.accounts.find(a => a.id === 'brandon_conceicao')?.platforms?.youtube?.videoLikesById);
  const ids = new Set();
  for (const tab of ['videos', 'shorts', 'streams']) {
    const page = await fetchText(`https://www.youtube.com/@${handle}/${tab}`, { timeoutMs: 8000 }).catch(() => null);
    if (page?.ok) {
      for (const match of page.text.matchAll(/"videoId":"([\w-]{11})"/g)) ids.add(match[1]);
    }
  }
  for (const id of Object.keys(readings)) ids.add(id);
  const today = new Date().toISOString();
  const oldest = [...ids].sort((a, b) => (readings[a]?.checked || '').localeCompare(readings[b]?.checked || ''));
  for (const id of oldest.slice(0, 12)) {
    const page = await fetchText(`https://www.youtube.com/watch?v=${id}`, { timeoutMs: 8000 }).catch(() => null);
    readings[id] = { ...readings[id], checked: today };
    if (!page?.ok || !/"ownerProfileUrl":"https?:\/\/www\.youtube\.com\/@BrandonLConceicao"/i.test(page.text)) continue;
    const count = page.text.match(/"accessibilityText":"like this video along with ([\d,]+) other (?:people|person)/i);
    if (count) readings[id].likes = Number(count[1].replaceAll(',', ''));
  }

  const counts = Object.values(readings).map(item => item.likes).filter(Number.isFinite);
  if (!counts.length) return result;
  return { ...result, ok: true, videoLikesById: readings, likes: counts.reduce((a,b) => a+b, 0), recentNote: `Public YouTube likes recorded across ${counts.length} distinct uploads. Some readings may be older than the latest channel check.` };
}
