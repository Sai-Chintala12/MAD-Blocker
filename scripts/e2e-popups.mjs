// Real-browser check of the pop-up modes (Phase 3). Run with:  npm run e2e:popups
// Chrome only shows its permission prompt to a human, so this test loads a temporary
// COPY of the extension in which the optional "contentSettings" permission is already
// granted. Nothing in the real project is changed. Playwright is found as in e2e.mjs.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));

async function loadPlaywright() {
  const candidates = ['playwright'];
  if (process.env.PLAYWRIGHT_DIR) candidates.push(pathToFileURL(path.join(process.env.PLAYWRIGHT_DIR, 'index.mjs')).href);
  for (const c of candidates) {
    try { return await import(c); } catch { /* try the next one */ }
  }
  console.error('Playwright was not found. See the comment at the top of scripts/e2e.mjs.');
  process.exit(2);
}

// Temporary copy with the optional permission moved to the granted list.
const work = mkdtempSync(path.join(os.tmpdir(), 'mad-popups-'));
const copy = path.join(work, 'ext');
for (const item of ['manifest.json', 'rules', 'src', 'icons']) cpSync(path.join(project, item), path.join(copy, item), { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(copy, 'manifest.json'), 'utf8'));
manifest.permissions = [...manifest.permissions, ...(manifest.optional_permissions ?? [])];
delete manifest.optional_permissions;
writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(manifest, null, 2));

const PAGE = `<!doctype html><meta charset="utf-8"><title>popup test</title>
<button id="b" onclick="window.__opened = !!window.open('/target', '_blank', 'width=300,height=200')">open on click</button>
<script src="/ads/popunder.js"></script>`;
const server = http.createServer((req, res) => {
  if (req.url.includes('popunder')) {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end('window.__popunder = true;');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const { chromium } = await loadPlaywright();
const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  headless: false,
  executablePath: process.env.CHROME_PATH || undefined,
  // Playwright normally turns Chrome's pop-up blocker off. We need it ON.
  ignoreDefaultArgs: ['--disable-popup-blocking'],
  args: [
    '--headless=new', '--no-sandbox',
    `--disable-extensions-except=${copy}`, `--load-extension=${copy}`,
    '--host-resolver-rules=MAP *.test 127.0.0.1'
  ]
});

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? `  (${detail})` : ''}`);
};

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extId}/src/options/options.html`);
  const send = (m) => control.evaluate(async (msg) => chrome.runtime.sendMessage(msg), m);

  const state = await send({ type: 'getSettings' });
  check('pop-up control is ready (permission present)', state.popupControl === 'ready', JSON.stringify(state.popupControl));

  // Returns what Chrome did with a script-opened window and with one opened by a click.
  const probe = async (host) => {
    const page = await context.newPage();
    await page.goto(`http://${host}:${port}/`);
    // page.evaluate() runs with a simulated user gesture, which would make every pop-up look
    // user-initiated. The DevTools protocol lets us switch the gesture off.
    const cdp = await context.newCDPSession(page);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: "!!window.open('/target', '_blank', 'width=300,height=200')",
      userGesture: false
    });
    const unsolicited = result.value === true;
    // What Chrome itself reports as the pop-up setting for this site.
    const chromeSetting = await control.evaluate(
      (u) => new Promise((resolve) => chrome.contentSettings.popups.get({ primaryUrl: u }, (d) => resolve(d?.setting ?? 'unknown'))),
      `http://${host}:${port}/`);
    await page.click('#b');
    await page.waitForTimeout(150);
    const onClick = await page.evaluate(() => window.__opened === true);
    const popunderLoaded = await page.evaluate(() => window.__popunder === true);
    for (const p of context.pages()) if (p !== control) await p.close().catch(() => {});
    return { unsolicited, onClick, chromeSetting, popunderLoaded };
  };
  const show = (label, r) => console.log(`      ${label}: unsolicited ${r.unsolicited ? 'OPENED' : 'blocked'}, on click ${r.onClick ? 'OPENED' : 'blocked'}, Chrome setting: ${r.chromeSetting}, pop-under script ${r.popunderLoaded ? 'loaded' : 'blocked'}`);

  let r = await probe('news.test');
  show('default', r);
  check('default: Chrome blocks an unsolicited pop-up', r.unsolicited === false);
  check('default: a pop-up from a click is allowed', r.onClick === true);
  check('default: pop-under script is not blocked', r.popunderLoaded === true);

  await send({ type: 'setSiteMode', host: 'news.test', mode: 'allow-popups' });
  r = await probe('news.test');
  show('allow-popups', r);
  check('allow-popups: unsolicited pop-up opens', r.unsolicited === true);
  check('allow-popups: click pop-up opens', r.onClick === true);
  r = await probe('www.news.test');
  check('allow-popups covers subdomains', r.unsolicited === true);
  r = await probe('other.test');
  check('allow-popups does not leak to other sites', r.unsolicited === false);

  await send({ type: 'setSiteMode', host: 'news.test', mode: 'aggressive' });
  r = await probe('news.test');
  show('aggressive', r);
  check('aggressive: unsolicited pop-up is blocked', r.unsolicited === false);
  check('aggressive: a pop-up from your own click still opens (logins and payments keep working)', r.onClick === true);
  check('aggressive: pop-under script is blocked', r.popunderLoaded === false);
  r = await probe('www.news.test');
  check('aggressive covers subdomains', r.unsolicited === false && r.popunderLoaded === false);
  r = await probe('other.test');
  check('aggressive does not affect other sites', r.popunderLoaded === true);

  // Aggressive mode forces Chrome's blocker ON for the site, even if the user's own Chrome
  // setting for all sites allows pop-ups. (Simulated here by an all-sites "allow" from the extension.)
  await control.evaluate(() => new Promise((resolve) =>
    chrome.contentSettings.popups.set({ primaryPattern: '<all_urls>', setting: 'allow', scope: 'regular' }, resolve)));
  r = await probe('other.test');
  check('(setup) with "allow pop-ups everywhere", other sites are open', r.unsolicited === true);
  r = await probe('news.test');
  check('aggressive: blocker stays on for this site even then', r.unsolicited === false);

  await send({ type: 'removeSite', host: 'news.test' });
  r = await probe('news.test');
  show('removed', r);
  check('removing the site restores Chrome\'s normal behaviour', r.unsolicited === false && r.onClick === true);

  await send({ type: 'setSiteMode', host: 'news.test', mode: 'allow-popups' });
  await send({ type: 'setEnabled', value: false });
  r = await probe('news.test');
  check('turning MAD Blocker off clears pop-up settings', r.unsolicited === false);
  await send({ type: 'setEnabled', value: true });
  r = await probe('news.test');
  check('turning it back on restores them', r.unsolicited === true);
  await send({ type: 'resetSites' });
} catch (err) {
  failed++;
  console.log('FAIL  the test run crashed:', err);
} finally {
  await context.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
