// Real-browser checks for Phase 4: YouTube and streaming-site protection. Run with:
//   npm run e2e:streaming
//
// IMPORTANT: this uses a MOCK YouTube page that copies the player markup MAD Blocker looks for.
// It proves MAD Blocker's own logic (skipping, restoring your volume and speed, giving up when
// stuck, the on/off switches, the network rules and the hide rules). It CANNOT prove that the
// real YouTube still uses those class names today, because YouTube changes its page often.
// Check the real site by hand (docs/TESTING.md).
//
// How: a local HTTPS server answers for www.youtube.com, exoclick.com and *.test (Chrome is told
// to send those names to it), with a throw-away self-signed certificate. A temporary COPY of the
// extension is loaded, with two test-only changes: the "tabs" permission (so the popup can read the
// tab address when it is not opened by a click) and a 3-second "stuck" limit instead of 45 seconds.
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(project, 'tests/fixtures/mock-ad.webm');

async function loadPlaywright() {
  const candidates = ['playwright'];
  if (process.env.PLAYWRIGHT_DIR) candidates.push(pathToFileURL(path.join(process.env.PLAYWRIGHT_DIR, 'index.mjs')).href);
  for (const c of candidates) {
    try { return await import(c); } catch { /* try the next one */ }
  }
  console.error('Playwright was not found. See the comment at the top of scripts/e2e.mjs.');
  process.exit(2);
}

const work = mkdtempSync(path.join(os.tmpdir(), 'mad-stream-'));

// Throw-away certificate for the test names.
const key = path.join(work, 'key.pem');
const cert = path.join(work, 'cert.pem');
const ssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
  '-subj', '/CN=mad-test', '-addext', 'subjectAltName=DNS:youtube.com,DNS:*.youtube.com,DNS:exoclick.com,DNS:*.test'], { encoding: 'utf8' });
if (ssl.status !== 0) {
  console.error('This test needs the "openssl" command to make a temporary certificate.\n' + (ssl.stderr || ssl.error));
  process.exit(2);
}

// Temporary copy of the extension with the two test-only changes.
const copy = path.join(work, 'ext');
for (const item of ['manifest.json', 'rules', 'src', 'icons']) cpSync(path.join(project, item), path.join(copy, item), { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(copy, 'manifest.json'), 'utf8'));
manifest.permissions = [...manifest.permissions, 'tabs', ...(manifest.optional_permissions ?? [])];
delete manifest.optional_permissions;
writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(manifest, null, 2));
const ytScript = path.join(copy, 'src/content/youtube.js');
const ytSource = readFileSync(ytScript, 'utf8');
if (!ytSource.includes('const STUCK_MS = 45000;')) throw new Error('youtube.js changed: update the test patch');
writeFileSync(ytScript, ytSource.replace('const STUCK_MS = 45000;', 'const STUCK_MS = 3000;'));

// ---- the mock site -------------------------------------------------------------------------
const hits = []; // every request that reached the server: "host/path"

const adParts = (skippable) => `<div class="ytp-ad-player-overlay-layout"><span class="ytp-ad-text">Ad 1 of 1</span>${
  skippable ? '<div class="ytp-ad-skip-button-container"><button class="ytp-skip-ad-button" id="skip">Skip</button></div>' : ''}</div>`;

function youtubePage(mode) {
  const withAd = ['ad', 'skippable', 'stuck'].includes(mode);
  const stale = mode === 'stale';
  return `<!doctype html><meta charset="utf-8"><title>mock youtube ${mode}</title>
<style>ytd-ad-slot-renderer, ytd-rich-item-renderer { display: block; height: 20px; }</style>
<body style="margin:0">
<div id="movie_player" class="html5-video-player${withAd || stale ? ' ad-showing' : ''}">
  <video class="html5-main-video" id="v" width="320" height="180" ${mode === 'stuck' ? '' : 'src="/ad.webm"'}></video>
  <div class="video-ads">${withAd ? adParts(mode === 'skippable') : ''}</div>
</div>
<ytd-ad-slot-renderer id="adslot">sponsored</ytd-ad-slot-renderer>
<ytd-rich-item-renderer id="rich"><ytd-ad-slot-renderer>sponsored</ytd-ad-slot-renderer></ytd-rich-item-renderer>
<ytd-rich-item-renderer id="real">a real video</ytd-rich-item-renderer>
<script>
  const player = document.getElementById('movie_player');
  const v = document.getElementById('v');
  window.__skipClicks = 0;
  v.volume = 0.7; v.muted = false; v.playbackRate = 1;
  const endAd = () => { player.classList.remove('ad-showing'); document.querySelector('.video-ads').innerHTML = ''; window.__adEnded = performance.now(); };
  v.addEventListener('ended', () => { if (player.classList.contains('ad-showing')) endAd(); });
  const skip = document.getElementById('skip');
  if (skip) skip.addEventListener('click', () => { window.__skipClicks++; endAd(); });
  if (v.getAttribute('src')) v.play().catch(() => {});
</script>`;
}

const streamPage = `<!doctype html><meta charset="utf-8"><title>mock streaming site</title>
<body><button id="go" onclick="window.open('https://exoclick.com/landing')">Play</button>
<a id="next" href="/next">next page</a>
<script src="https://exoclick.com/ad.js"></script>
<ytd-ad-slot-renderer id="adslot">not on youtube</ytd-ad-slot-renderer>`;

const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  const url = new URL(req.url, 'https://x');
  hits.push(`${host}${url.pathname}`);
  if (url.pathname === '/ad.webm') {
    const size = statSync(fixture).size;
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      return createReadStream(fixture, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'content-length': size });
    return createReadStream(fixture).pipe(res);
  }
  if (url.pathname.endsWith('.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end('window.__adScriptLoaded = true;');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  if (host.endsWith('youtube.com')) return res.end(url.pathname === '/watch' ? youtubePage(url.searchParams.get('mode') ?? 'none') : '<title>youtube</title>ok');
  if (host === 'exoclick.com') return res.end('<title>ad landing</title>an ad landing page');
  return res.end(url.pathname === '/' ? streamPage : '<title>next</title>the next page');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const mapping = ['www.youtube.com', 'youtube.com', 'exoclick.com', '*.test'].map((h) => `MAP ${h} 127.0.0.1:${port}`).join(', ');

// ---- browser -------------------------------------------------------------------------------
const { chromium } = await loadPlaywright();
const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  headless: false,
  executablePath: process.env.CHROME_PATH || undefined,
  ignoreHTTPSErrors: true,
  ignoreDefaultArgs: ['--disable-popup-blocking'],
  args: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors',
    `--disable-extensions-except=${copy}`, `--load-extension=${copy}`, `--host-resolver-rules=${mapping}`]
});

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extId}/src/options/options.html`);
  const send = (m) => control.evaluate(async (msg) => chrome.runtime.sendMessage(msg), m);
  await send({ type: 'resetSites' });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);

  const state = (page) => page.evaluate(() => {
    const v = document.getElementById('v');
    return { muted: v.muted, rate: v.playbackRate, volume: v.volume, time: v.currentTime, ended: window.__adEnded !== undefined, endedAt: window.__adEnded,
      clicks: window.__skipClicks, adShowing: document.getElementById('movie_player').classList.contains('ad-showing') };
  });
  const display = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, sel);
  const openYoutube = async (mode) => {
    const page = await context.newPage();
    await page.goto(`https://www.youtube.com/watch?mode=${mode}`, { waitUntil: 'load' });
    return page;
  };
  // Shows the popup for the tab that is in front, the way a user would see it.
  const popupNote = async (page) => {
    await page.bringToFront();
    await popup.reload();
    await popup.waitForTimeout(500);
    return { text: await popup.textContent('#ytNote'), hidden: await popup.$eval('#ytNote', (e) => e.hidden), host: await popup.textContent('#host') };
  };

  // 1. A non-skippable ad is cut short, and the viewer's own volume and speed come back
  let page = await openYoutube('ad');
  await page.waitForFunction(() => window.__adEnded !== undefined, null, { timeout: 8000 }).catch(() => {});
  let s = await state(page);
  check('non-skippable ad: finished within seconds of page load instead of the ad\'s 20', s.ended && s.endedAt < 6000, JSON.stringify(s));
  check('your own volume and speed are put back', s.muted === false && s.rate === 1 && s.volume === 0.7, JSON.stringify(s));
  let note = await popupNote(page);
  check('popup shows the real count of ad breaks skipped', !note.hidden && /skipped on this page: 1/.test(note.text), JSON.stringify(note));
  check('popup knows the page is YouTube', note.host.includes('www.youtube.com'), note.host);
  await page.close();

  // 2. A skippable ad: the Skip button is clicked and the video is left alone
  page = await openYoutube('skippable');
  await page.waitForFunction(() => window.__adEnded !== undefined, null, { timeout: 8000 }).catch(() => {});
  s = await state(page);
  check('skippable ad: Skip was clicked once', s.clicks === 1 && s.ended, JSON.stringify(s));
  check('skippable ad: video was not muted or sped up', s.muted === false && s.rate === 1, JSON.stringify(s));
  await page.close();

  // 3. "ad-showing" without any ad parts: leave the video completely alone
  page = await openYoutube('stale');
  await page.waitForTimeout(2500);
  s = await state(page);
  check('stale ad class without ad parts: nothing is touched', s.muted === false && s.rate === 1 && s.clicks === 0 && !s.ended, JSON.stringify(s));
  await page.close();

  // 4. An ad that never ends: give up after the limit, restore everything, tell the user
  page = await openYoutube('stuck');
  await page.waitForTimeout(5500);
  s = await state(page);
  check('stuck ad: volume and speed are restored after giving up', s.muted === false && s.rate === 1, JSON.stringify(s));
  note = await popupNote(page);
  check('stuck ad: popup warns that skipping paused', !note.hidden && /paused on this page/.test(note.text), JSON.stringify(note));
  await page.close();

  // 5. Each switch stops it
  const untouched = async (label) => {
    const p = await openYoutube('ad');
    await p.waitForTimeout(3000);
    const st = await state(p);
    check(`${label}: the ad is left alone`, !st.ended && st.muted === false && st.rate === 1 && st.time > 1, JSON.stringify(st));
    const n = await popupNote(p);
    await p.close();
    return n;
  };
  await send({ type: 'setFeature', name: 'youtubeSkip', value: false });
  note = await untouched('"YouTube ad skipping" switched off');
  check('popup says skipping is switched off', /switched off/.test(note.text), JSON.stringify(note));
  await send({ type: 'setFeature', name: 'youtubeSkip', value: true });
  await send({ type: 'setSiteMode', host: 'youtube.com', mode: 'paused' });
  await untouched('site paused');
  await send({ type: 'removeSite', host: 'youtube.com' });
  await send({ type: 'setEnabled', value: false });
  await untouched('MAD Blocker off');
  await send({ type: 'setEnabled', value: true });
  page = await openYoutube('ad');
  await page.waitForFunction(() => window.__adEnded !== undefined, null, { timeout: 8000 }).catch(() => {});
  check('switching everything back on works again', (await state(page)).ended);
  await page.close();

  // 5b. Idle cost: with no ad showing, the handler uses almost no CPU
  page = await openYoutube('none');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const scriptSeconds = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'ScriptDuration').value;
  await page.waitForTimeout(1500);
  const s0 = await scriptSeconds();
  await page.waitForTimeout(5000);
  const idleMs = ((await scriptSeconds()) - s0) * 1000;
  check('no ad showing: the YouTube handler uses almost no CPU while idle (under 30 ms of script time in 5 s)', idleMs < 30, `${idleMs.toFixed(1)} ms`);
  await page.close();

  // 6. YouTube network rules: ad requests are blocked, the video itself is not
  const probe = async () => {
    const p = await context.newPage();
    const failed = [];
    p.on('requestfailed', (r) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
    await p.goto('https://www.youtube.com/watch?mode=none');
    await p.evaluate(() => Promise.allSettled([
      fetch('/pagead/ads?x=1'), fetch('/api/stats/ads?x=1'), fetch('/ptracking?x=1'), fetch('/youtubei/v1/player/ad_break'), fetch('/youtubei/v1/player'), fetch('/videoplayback?x=1')
    ]));
    await p.waitForTimeout(300);
    await p.close();
    return failed.filter((f) => f.error.includes('BLOCKED_BY_CLIENT')).map((f) => new URL(f.url).pathname);
  };
  let blocked = await probe();
  check('YouTube ad requests are blocked', ['/pagead/ads', '/api/stats/ads', '/ptracking', '/youtubei/v1/player/ad_break'].every((x) => blocked.includes(x)), JSON.stringify(blocked));
  check('YouTube player and video requests are NOT blocked', !blocked.includes('/youtubei/v1/player') && !blocked.includes('/videoplayback'), JSON.stringify(blocked));
  await send({ type: 'setFeature', name: 'youtubeNetwork', value: false });
  blocked = await probe();
  check('"YouTube network rules" switched off: nothing is blocked', blocked.length === 0, JSON.stringify(blocked));
  await send({ type: 'setFeature', name: 'youtubeNetwork', value: true });

  // 7. Ad slots in the YouTube page are hidden on YouTube only
  page = await openYoutube('none');
  check('YouTube ad slot is hidden', (await display(page, '#adslot')) === 'none');
  check('the empty grid cell around an ad is hidden too', (await display(page, '#rich')) === 'none');
  check('a real video tile is untouched', (await display(page, '#real')) === 'block');
  await page.close();
  page = await context.newPage();
  await page.goto('https://stream.test/');
  check('the same markup on another site is untouched', (await display(page, '#adslot')) !== 'none');

  // 8. Streaming sites: click-under tabs to known ad networks are blocked
  const clickUnder = async () => {
    hits.length = 0;
    const p = await context.newPage();
    await p.goto('https://stream.test/');
    await p.waitForTimeout(300);
    const [tab] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), p.click('#go')]);
    await sleep(800);
    const reached = hits.some((h) => h.startsWith('exoclick.com/landing'));
    const scriptReached = hits.some((h) => h.startsWith('exoclick.com/ad.js'));
    const scriptRan = await p.evaluate(() => window.__adScriptLoaded === true);
    if (tab) await tab.close().catch(() => {});
    await p.close();
    return { reached, scriptReached, scriptRan, opened: tab !== null };
  };
  let r = await clickUnder();
  check('click on the page opens a tab (Chrome allows clicks)', r.opened, JSON.stringify(r));
  check('click-under to a known ad network never reaches the network', r.reached === false, JSON.stringify(r));
  check('ad network script is blocked', r.scriptReached === false && r.scriptRan === false, JSON.stringify(r));
  await send({ type: 'setSiteMode', host: 'stream.test', mode: 'paused' });
  r = await clickUnder();
  check('pausing a site does not let click-unders to ad networks through', r.reached === false, JSON.stringify(r));
  await send({ type: 'removeSite', host: 'stream.test' });
  page = await context.newPage();
  await page.goto('https://stream.test/');
  await page.click('#next');
  await page.waitForLoadState();
  check('normal links on the site still work', (await page.title()) === 'next', await page.title());
  await page.close();
  await send({ type: 'setFeature', name: 'streaming', value: false });
  r = await clickUnder();
  check('"Streaming-site ad networks" switched off: opening the ad network page is allowed again', r.reached === true, JSON.stringify(r));
  check('...but its scripts stay blocked by the main list, which has no switch', r.scriptRan === false, JSON.stringify(r));
  await send({ type: 'setFeature', name: 'streaming', value: true });
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
