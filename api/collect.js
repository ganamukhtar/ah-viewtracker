import { loadDotEnv } from '../lib/env.js';
import { collectAndStore } from '../collector/run.js';

loadDotEnv();

export const maxDuration = 60;

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function collectAuthorized(req, env = process.env) {
  const secret = env.CRON_SECRET;
  if (!secret) return true;
  const authorization = header(req, 'authorization') || '';
  const alternate = header(req, 'x-cron-secret') || '';
  return authorization === `Bearer ${secret}` || alternate === secret;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, POST');
    res.end('Method not allowed');
    return;
  }
  if (!collectAuthorized(req)) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unauthorized collector request.' }));
    return;
  }
  try {
    const { snapshot, stored } = await collectAndStore();
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      checkedAt: snapshot.checkedAt,
      recordedViews: snapshot.projection.recorded,
      partial: snapshot.coverage.partial,
      withViews: snapshot.coverage.withViews,
      warnings: snapshot.warnings,
      persisted: stored,
      collectors: snapshot.collectors,
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: error.message || 'Collect failed' }));
  }
}
