import { readSnapshot } from '../lib/store.js';

export default async function handler(_req, res) {
  try {
    const { snapshot, source } = await readSnapshot();
    if (!snapshot) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'No snapshot has been collected yet.' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=30, stale-while-revalidate=60');
    res.setHeader('x-snapshot-source', source || 'unknown');
    res.end(JSON.stringify(snapshot));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'The view feed could not be read.' }));
  }
}
