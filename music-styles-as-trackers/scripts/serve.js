#!/usr/bin/env node
/**
 * A tiny static server for the browser player: `npm run web`, then open
 * http://localhost:8080/engine/web/ . No dependencies, serves this repo folder.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const port = parseInt(process.env.PORT || '8080', 10);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain', '.m8s': 'application/octet-stream', '.mid': 'audio/midi' };

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error('outside root');
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(301, { Location: path + '/' }); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`not found: ${req.url}`);
  }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}/engine/web/`));
