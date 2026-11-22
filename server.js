import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import feed from './api/views-feed.js';
import collect from './api/collect.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8741);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const adapter = {
    method: req.method,
    headers: req.headers,
    statusCode: 200,
    setHeader(name, value) { res.setHeader(name, value); },
    end(body) { if (!res.writableEnded) res.end(body); },
  };
  Object.defineProperty(adapter, 'statusCode', {
    set(value) { res.statusCode = value; },
    get() { return res.statusCode; },
  });
  try {
    if (url.pathname === '/api/views-feed') return await feed(adapter, adapter);
    if (url.pathname === '/api/collect') return await collect(adapter, adapter);
    const route = url.pathname === '/accounts' || url.pathname === '/accounts/' ? '/accounts.html' : url.pathname;
    const requested = decodeURIComponent(route === '/' ? '/index.html' : route);
    const filePath = path.normalize(path.join(root, requested));
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
    await access(filePath);
    res.setHeader('content-type', types[path.extname(filePath)] || 'application/octet-stream');
    if (path.extname(filePath) === '.html') res.setHeader('cache-control', 'no-cache');
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') send(res, 404, 'Not found');
    else {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Server error');
      else res.end();
    }
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Aggregated views listening on http://127.0.0.1:${port}`);
});
