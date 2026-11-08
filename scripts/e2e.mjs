// End-to-end check: loads the real extension in Chromium and tests it on a local page.
// Not part of "npm test" because it needs a browser. Run it with:  npm run e2e
//
// It needs Playwright, which this project does not depend on (zero dependencies is
// a security choice). Install it somewhere outside the project, or point to it:
//   PLAYWRIGHT_DIR=/path/to/node_modules/playwright npm run e2e
// Optional: CHROME_PATH=/path/to/chrome to use a specific Chrome or Chromium.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
// Load a temporary copy, because Chrome writes cache folders next to the files it loads.
const extensionDir = mkdtempSync(path.join(os.tmpdir(), 'mad-ext-'));
for (const item of ['manifest.json', 'rules', 'src', 'icons']) cpSync(path.join(project, item), path.join(extensionDir, item), { recursive: true });

async function loadPlaywright() {
  const candidates = ['playwright'];
  if (process.env.PLAYWRIGHT_DIR) candidates.push(pathToFileURL(path.join(process.env.PLAYWRIGHT_DIR, 'index.mjs')).href);
  for (const c of candidates) {
    try { return await import(c); } catch { /* try the next one */ }
  }
  console.error('Playwright was not found. See the comment at the top of scripts/e2e.mjs.');
  process.exit(2);
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>MAD Blocker e2e page</title>
<body style="margin:0;font:16px sans-serif">
<div id="content" style="height:40px">Real content</div>
<ins class="adsbygoogle" id="ad1" style="display:block;width:300px;height:90px;background:#f90">AD</ins>
<div id="div-gpt-ad-top" style="height:50px;background:#f90">AD</div>
<div id="my-banner" style="height:60px;background:#0af">Custom banner</div>
<img id="pixel" width="1" height="1" src="https://doubleclick.net/pixel.gif">
<p id="footer">Footer</p>`;

const server = http.createServer((req, res) => {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  // csp.test sends a strict Content-Security-Policy, like many banking and news sites do.
  if ((req.headers.host ?? '').startsWith('csp.test')) {
    headers['content-security-policy'] = "default-src 'none'; style-src 'none'; img-src 'none'";
  }
  res.writeHead(200, headers);
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = (host) => `http://${host}:${port}/`;

const { chromium } = await loadPlaywright();
const profile = mkdtempSync(path.join(os.tmpdir(), 'mad-e2e-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false, // the new headless mode is enabled through the argument below
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    '--headless=new', '--no-sandbox',
    `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`,
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

  // An extension page, used to send settings messages the same way the popup does.
  const control = await context.newPage();
  const pageErrors = [];
  control.on('pageerror', (e) => pageErrors.push(String(e)));
  await control.goto(`chrome-extension://${extId}/src/options/options.html`);
  const send = (message) => control.evaluate(async (m) => chrome.runtime.sendMessage(m), message);

  check('settings page loads without errors', pageErrors.length === 0, pageErrors.join('; '));
  // Every rule in the generated stylesheet must be accepted by Chrome. In a plain selector list one
  // selector Chrome cannot parse would silently drop the WHOLE rule, so count the rules it keeps.
  const sheetCheck = await control.evaluate(async () => {
    const css = await (await fetch(chrome.runtime.getURL('src/content/page-cleanup.css'))).text();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return { expected: (css.match(/\{/g) || []).length, accepted: sheet.cssRules.length };
  });
  check('Chrome accepts every rule of the generated stylesheet', sheetCheck.expected > 0 && sheetCheck.expected === sheetCheck.accepted, JSON.stringify(sheetCheck));

  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('pageerror', (e) => popupErrors.push(String(e)));
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await popup.waitForTimeout(300);
  check('popup loads without errors', popupErrors.length === 0, popupErrors.join('; '));
  await popup.close();

  const open = async (host = 'news.test') => {
    const page = await context.newPage();
    const failures = [];
    page.on('requestfailed', (r) => failures.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
    await page.goto(url(host), { waitUntil: 'load' });
    await page.waitForTimeout(250);
    return { page, failures };
  };
  const style = (page, sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
  const height = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().height, sel);

  // 1. Defaults: network blocking and collapse mode
  await send({ type: 'setPlaceholder', value: 'collapse' });
  let { page, failures } = await open();
  check('ad request is blocked by Chrome (ERR_BLOCKED_BY_CLIENT)',
    failures.some((f) => f.url.includes('doubleclick.net') && f.error.includes('BLOCKED_BY_CLIENT')), JSON.stringify(failures));
  check('page itself loads normally', (await page.title()) === 'MAD Blocker e2e page');
  check('collapse: ad container is removed', (await style(page, '#ad1', 'display')) === 'none');
  check('collapse: Google ad slot is removed', (await style(page, '#div-gpt-ad-top', 'display')) === 'none');
  check('real content is untouched', (await style(page, '#content', 'display')) === 'block' && (await height(page, '#content')) === 40);
  check('unrelated banner is untouched', (await style(page, '#my-banner', 'display')) === 'block');
  await page.close();

  // 2. Black and white keep the space
  for (const mode of ['black', 'white']) {
    await send({ type: 'setPlaceholder', value: mode });
    ({ page } = await open());
    const filter = await style(page, '#ad1', 'filter');
    check(`${mode}: space is kept (90px)`, (await height(page, '#ad1')) === 90, String(await height(page, '#ad1')));
    check(`${mode}: ad is painted flat`, filter.includes('brightness(0)') && (mode === 'white' ? filter.includes('invert(1)') : !filter.includes('invert')), filter);
    if (process.env.E2E_SHOTS) {
      mkdirSync(process.env.E2E_SHOTS, { recursive: true });
      await page.locator('#ad1').screenshot({ path: path.join(process.env.E2E_SHOTS, `ad-${mode}.png`) });
    }
    await page.close();
  }
  await send({ type: 'setPlaceholder', value: 'collapse' });

  // 3. Pause a site: nothing is blocked or hidden there, other sites unaffected
  await send({ type: 'setSiteMode', host: 'news.test', mode: 'paused' });
  ({ page, failures } = await open('news.test'));
  check('paused site: ad request is not blocked', !failures.some((f) => f.error.includes('BLOCKED_BY_CLIENT')), JSON.stringify(failures));
  check('paused site: ad container stays visible', (await style(page, '#ad1', 'display')) === 'block');
  await page.close();
  ({ page, failures } = await open('other.test'));
  check('other sites stay protected', failures.some((f) => f.error.includes('BLOCKED_BY_CLIENT')) && (await style(page, '#ad1', 'display')) === 'none');
  await page.close();

  // 4. Remove the pause again, then turn the whole extension off
  await send({ type: 'removeSite', host: 'news.test' });
  ({ page, failures } = await open('news.test'));
  check('pause removed: blocking is back', failures.some((f) => f.error.includes('BLOCKED_BY_CLIENT')));
  await page.close();
  await send({ type: 'setEnabled', value: false });
  ({ page, failures } = await open('news.test'));
  check('switched off: nothing blocked or hidden',
    !failures.some((f) => f.error.includes('BLOCKED_BY_CLIENT')) && (await style(page, '#ad1', 'display')) === 'block');
  await page.close();
  await send({ type: 'setEnabled', value: true });

  // 5. Extra checks (custom rules etc.) are added in scripts/e2e-custom.mjs when present
  const extra = await import('./e2e-custom.mjs').catch(() => null);
  if (extra) await extra.run({ context, send, open, style, height, check, control, extId });
} catch (err) {
  failed++;
  console.log('FAIL  the test run crashed:', err);
} finally {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(extensionDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
