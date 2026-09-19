import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/dialogue.js', ['dialogue.js', 'text/javascript; charset=utf-8']],
]);
const port = Number(process.env.WEB_DEMO_PORT || 4175);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid WEB_DEMO_PORT');
createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
  }
  let pathname;
  try { pathname = new URL(request.url, 'http://localhost').pathname; }
  catch { response.writeHead(400).end(); return; }
  const asset = assets.get(pathname);
  if (!asset) { response.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(new URL(asset[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(500).end('Unable to load page'); }
}).listen(port, '127.0.0.1', () => console.log(`Episode 5 demo: http://127.0.0.1:${port}`));
