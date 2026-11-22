export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function fetchText(url, { timeoutMs = 20000, headers = {} } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text, url: response.url };
}

export async function fetchJson(url, options = {}) {
  const { timeoutMs = 20000, signal, headers, ...rest } = options;
  const response = await fetch(url, {
    ...rest,
    headers: { accept: 'application/json', ...(headers || {}) },
    signal: signal || AbortSignal.timeout(timeoutMs),
  });
  let body = null;
  const text = await response.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
  return { ok: response.ok, status: response.status, body };
}
