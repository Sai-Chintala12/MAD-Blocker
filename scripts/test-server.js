// Tiny local server for manually testing pop-up behaviour. No dependencies.
// Listens on 127.0.0.1 only (not reachable from other computers).
// Run:  npm run test:popups   then open  http://popup.test:8080/
// (see docs/TESTING.md for the one-line hosts file change that makes popup.test work)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const page = readFileSync(fileURLToPath(new URL('../tests/manual/popup-test.html', import.meta.url)));
const target = '<!doctype html><meta charset="utf-8"><title>Pop-up opened</title><h1>I am the pop-up.</h1><p>You can close this window.</p>';

const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (path === '/') {
    res.writeHead(200, headers);
    res.end(page);
  } else if (path === '/target') {
    res.writeHead(200, headers);
    res.end(target);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(8080, '127.0.0.1', () => {
  console.log('Pop-up test page: http://popup.test:8080/   (press Ctrl+C to stop)');
});
