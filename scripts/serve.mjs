// Tiny static server for local preview: `npm run serve` → http://localhost:4321
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = process.env.PORT || 4321;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript',
  '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = normalize(join(root, p));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end('no'); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404');
  }
}).listen(PORT, () => console.log(`▶ http://localhost:${PORT}`));
