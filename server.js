// Minimal zero-dependency static server for TakeOff Pro.
// Serves ./public and exposes the PDF.js build from node_modules at /vendor/pdfjs/.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const mounts = [
  { prefix: '/vendor/pdfjs/', dir: resolve(root, 'node_modules/pdfjs-dist/build') },
  { prefix: '/', dir: resolve(root, 'public') },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function resolvePath(urlPath) {
  for (const { prefix, dir } of mounts) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = normalize(decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html');
    const full = resolve(dir, rel);
    if (full !== dir && !full.startsWith(dir + sep)) return null; // path traversal
    return full;
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    let file = resolvePath(pathname);
    if (!file) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

const port = Number(process.env.PORT) || 5173;
server.listen(port, () => {
  console.log(`TakeOff Pro running at http://localhost:${port}`);
});
