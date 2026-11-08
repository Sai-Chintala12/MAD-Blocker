// Measures what MAD Blocker costs and saves, in a real Chromium. Run with:  npm run perf
//
// It launches TWO browsers side by side, one with the extension and one without, and loads the
// same local test pages in turns (A, B, A, B...) so that slow moments on your computer hit both
// equally. Everything is served from your own machine; nothing goes on the internet.
//
//   "clean" page: 5,000 elements and no ads.  It shows the pure COST of having the extension.
//   "ads" page:   2,000 elements, 40 ad slots, 12 ad requests, and ad slots added while it loads.
//                 It shows what blocking changes. The ad scripts here are fake and burn a fixed
//                 15 ms of CPU each, so the SAVINGS are only as realistic as that guess. The COST
//                 numbers on the clean page are the trustworthy ones.
//
// Environment variables (all optional):
//   PERF_RUNS=20           loads per page and browser (default 20)
//   PERF_IDLE_SECONDS=15   how long to watch the extension while it is idle (default 15)
//   PERF_JSON=file.json    also write the numbers to a file
//   PERF_ADS_PARTS=...     which ad parts the "ads" page has: frames,scripts,images,dynamic (default all four)
//   CHROME_PATH=...        use a specific Chrome or Chromium
//   PLAYWRIGHT_DIR=...     where to find Playwright (see scripts/e2e.mjs)
//
// Honest limits: numbers depend on your computer and are noisy; the browser is headless; a video
// test here only plays a tiny clip. For real playback, CPU and temperature, also watch Chrome's
// Task Manager (Shift+Esc) and Windows Task Manager while you browse (see docs/PERFORMANCE.md).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const RUNS = Number(process.env.PERF_RUNS ?? 20);
const IDLE_SECONDS = Number(process.env.PERF_IDLE_SECONDS ?? 15);
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

// ---- test pages ------------------------------------------------------------------------------
const AD_HOSTS = ['ads.doubleclick.net', 'pagead2.googlesyndication.com', 'cdn.taboola.com', 'widgets.outbrain.com'];
const adHit = { count: 0 };
const PARTS = new Set((process.env.PERF_ADS_PARTS ?? 'frames,scripts,images,dynamic').split(','));

function cleanPage() {
  let body = '';
  for (let i = 0; i < 1000; i++) {
    body += `<div class="card item-${i % 20}"><h3 class="title">Article ${i}</h3><p class="text">Some ordinary text for item ${i}. <a href="/x${i}">read more</a></p><span class="meta">by someone</span></div>\n`;
  }
  return `<!doctype html><meta charset="utf-8"><title>clean</title><style>.card{padding:4px;border-bottom:1px solid #ddd}.title{margin:0;font:16px sans-serif}</style><body>${body}`;
}

function adsPage(port) {
  let body = '';
  for (let i = 0; i < 400; i++) body += `<div class="card"><h3 class="title">Story ${i}</h3><p>Text ${i}</p></div>\n`;
  let ads = '';
  for (let i = 0; i < 10; i++) ads += `<ins class="adsbygoogle" style="display:block;height:90px;background:#fc0">ad</ins>`;
  for (let i = 0; i < 10; i++) ads += `<div id="div-gpt-ad-${i}" style="height:90px;background:#fc0">ad</div>`;
  for (let i = 0; i < 5; i++) ads += `<div class="OUTBRAIN" style="height:60px">ad</div><div id="taboola-${i}" style="height:60px">ad</div>`;
  if (PARTS.has('frames')) for (let i = 0; i < 5; i++) ads += `<iframe src="http://ads.doubleclick.net:${port}/frame?i=${i}" width="300" height="100"></iframe>`;
  let requests = '';
  if (PARTS.has('scripts')) {
    for (let i = 0; i < 4; i++) requests += `<script src="http://ads.doubleclick.net:${port}/ad${i}.js"></script>`;
    for (let i = 0; i < 2; i++) requests += `<script src="http://cdn.taboola.com:${port}/t${i}.js"></script>`;
    for (let i = 0; i < 2; i++) requests += `<script src="http://widgets.outbrain.com:${port}/o${i}.js"></script>`;
  }
  if (PARTS.has('images')) for (let i = 0; i < 4; i++) requests += `<img src="http://pagead2.googlesyndication.com:${port}/p${i}.gif" width="1" height="1">`;
  const dynamic = `<script>
    let n = 0;
    const timer = setInterval(() => {
      for (let i = 0; i < 20; i++) {
        const d = document.createElement('div');
        if (i % 2) { d.className = 'adsbygoogle'; d.style.height = '20px'; d.textContent = 'ad'; } else { d.className = 'card'; d.textContent = 'content ' + n; }
        document.body.appendChild(d);
      }
      if (++n >= 15) clearInterval(timer);
    }, 30);
  </script>`;
  return `<!doctype html><meta charset="utf-8"><title>ads</title><style>.card{padding:4px}</style><body>${ads}${requests}${body}${PARTS.has('dynamic') ? dynamic : ''}`;
}

const videoPage = '<!doctype html><meta charset="utf-8"><title>video</title><video id="v" src="/clip.webm" width="320" height="180" muted loop></video>';

const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  const url = new URL(req.url, 'http://x');
  const isAd = AD_HOSTS.includes(host);
  if (isAd) adHit.count++;
  const send = (type, body, delay = 0) => setTimeout(() => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); }, delay);
  if (isAd && url.pathname.endsWith('.js')) return send('text/javascript', 'const t=Date.now();while(Date.now()-t<15);', 20);
  if (isAd && url.pathname.endsWith('.gif')) return send('image/gif', Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'), 20);
  if (isAd) return send('text/html', '<title>ad frame</title><p>ad</p>', 20);
  if (url.pathname === '/clip.webm') {
    res.writeHead(200, { 'content-type': 'video/webm', 'content-length': statSync(fixture).size });
    return createReadStream(fixture).pipe(res);
  }
  if (url.pathname === '/clean') return send('text/html; charset=utf-8', cleanPage());
  if (url.pathname === '/ads') return send('text/html; charset=utf-8', adsPage(server.address().port));
  if (url.pathname === '/video') return send('text/html; charset=utf-8', videoPage);
  send('text/plain', 'ok');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---- browsers --------------------------------------------------------------------------------
const work = mkdtempSync(path.join(os.tmpdir(), 'mad-perf-'));
const ext = path.join(work, 'ext');
for (const item of ['manifest.json', 'rules', 'src', 'icons']) cpSync(path.join(project, item), path.join(ext, item), { recursive: true });

const mapping = [...AD_HOSTS, 'app.test'].map((h) => `MAP ${h} 127.0.0.1`).join(', ');
const baseArgs = ['--headless=new', '--no-sandbox', '--no-proxy-server', `--host-resolver-rules=${mapping}`, '--autoplay-policy=no-user-gesture-required'];
const { chromium } = await loadPlaywright();
const launch = (name, withExtension) => chromium.launchPersistentContext(path.join(work, name), {
  headless: false,
  executablePath: process.env.CHROME_PATH || undefined,
  args: withExtension ? [...baseArgs, `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] : baseArgs
});
const browsers = { without: await launch('profile-without', false), with: await launch('profile-with', true) };

// ---- helpers ---------------------------------------------------------------------------------
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const p90 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)] : NaN; };
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CPU ticks (10 ms each) of one browser and ALL its child processes, Linux only. The page's own
// thread numbers miss work that moves to other processes (ad frames live in their own process), so
// this is the fair measure of "how much total CPU did loading this page cost".
function treeTicks(rootPid) {
  if (!rootPid || !existsSync('/proc/self/stat')) return null;
  const parentOf = new Map();
  const ticksOf = new Map();
  for (const pid of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
      parentOf.set(Number(pid), Number(f[1]));
      ticksOf.set(Number(pid), Number(f[11]) + Number(f[12])); // utime + stime
    } catch { /* process ended */ }
  }
  const inTree = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of parentOf) if (!inTree.has(pid) && inTree.has(ppid)) { inTree.add(pid); grew = true; }
  }
  return new Map([...inTree].filter((p) => ticksOf.has(p)).map((p) => [p, ticksOf.get(p)]));
}

// The main process of one of our two browsers (its command line ends with the profile folder name).
function findBrowserRoot(profileName) {
  if (!existsSync('/proc/self/stat')) return null;
  const re = new RegExp(`--user-data-dir=[^\\0]*/${profileName}\\0`);
  for (const pid of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (re.test(cmd) && !cmd.includes('--type=')) return Number(pid);
    } catch { /* process ended */ }
  }
  return null;
}

async function measureLoad(context, route, rootPid = null) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = adHit.count;
  const cpuBefore = treeTicks(rootPid);
  await page.goto(`http://app.test:${port}${route}`, { waitUntil: 'load' });
  await sleep(700); // let dynamic ads finish
  const cpuAfter = treeTicks(rootPid);
  let cpuMs = NaN;
  if (cpuBefore && cpuAfter) {
    cpuMs = 0;
    for (const [pid, t] of cpuAfter) cpuMs += (t - (cpuBefore.get(pid) ?? 0)) * 10;
  }
  const nav = await page.evaluate(() => { const t = performance.getEntriesByType('navigation')[0]; return { load: t.loadEventEnd, dcl: t.domContentLoadedEventEnd }; });
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const adSlotsVisible = await page.evaluate(() => [...document.querySelectorAll('.adsbygoogle,[id^="div-gpt-ad"],.OUTBRAIN,[id^="taboola-"]')]
    .filter((e) => getComputedStyle(e).display !== 'none').length);
  const result = {
    loadMs: nav.load, dclMs: nav.dcl,
    taskMs: m.TaskDuration * 1000, scriptMs: m.ScriptDuration * 1000, styleMs: m.RecalcStyleDuration * 1000, layoutMs: m.LayoutDuration * 1000,
    heapMB: m.JSHeapUsedSize / 1048576, cpuMs, adRequests: adHit.count - before, adSlotsVisible
  };
  await page.close();
  return result;
}

// Memory of one process in MB (Linux only). PSS splits memory that processes share (program code,
// libraries) between them, so it is much closer to what Chrome's Task Manager calls "memory
// footprint" than resident memory (RSS) is. Falls back to RSS where PSS is unavailable.
function memoryMB(pid) {
  try {
    const pss = /Pss:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
    if (pss) return Number(pss[1]) / 1024;
  } catch { /* not available */ }
  return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) / 1024;
}

// Memory of the renderer of an empty tab in the browser WITHOUT the extension (Linux only), for comparison.
function emptyTabMemoryMB() {
  if (!existsSync('/proc/self/stat')) return null;
  const sizes = [];
  for (const pid of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmd.includes('--type=renderer') || cmd.includes('--extension-process') || !cmd.includes('profile-without')) continue;
      sizes.push(memoryMB(pid));
    } catch { /* process ended */ }
  }
  return sizes.length ? Math.min(...sizes) : null;
}

// Extension processes on Linux: sum CPU ticks and memory from /proc. Other systems: skipped.
function extensionProcesses() {
  if (!existsSync('/proc/self/stat')) return null;
  const found = [];
  for (const pid of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmd.includes('--extension-process') || !cmd.includes(work)) continue;
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      const ticks = Number(stat[11]) + Number(stat[12]); // utime + stime
      const rss = memoryMB(pid);
      found.push({ pid, ticks, rssMB: rss });
    } catch { /* process ended */ }
  }
  return found;
}

const report = { runs: RUNS, pages: {}, idle: null, rules: null, css: null, video: null, notes: [] };

try {
  // warm up both browsers (first load is always slower)
  for (const c of Object.values(browsers)) { await measureLoad(c, '/clean'); await measureLoad(c, '/ads'); }

  const roots = { without: findBrowserRoot('profile-without'), with: findBrowserRoot('profile-with') };
  if (!roots.with || !roots.without) report.notes.push('Total CPU across all browser processes is measured on Linux only. On Windows use Task Manager while browsing.');
  const samples = { clean: { with: [], without: [] }, ads: { with: [], without: [] } };
  for (let i = 0; i < RUNS; i++) {
    for (const route of ['clean', 'ads']) {
      const order = i % 2 === 0 ? ['without', 'with'] : ['with', 'without'];
      for (const name of order) samples[route][name].push(await measureLoad(browsers[name], `/${route}`, roots[name]));
    }
  }
  const summarize = (list, key) => ({ median: median(list.map((x) => x[key])), p90: p90(list.map((x) => x[key])) });
  for (const route of ['clean', 'ads']) {
    report.pages[route] = {};
    for (const name of ['without', 'with']) {
      report.pages[route][name] = {};
      for (const key of ['loadMs', 'dclMs', 'taskMs', 'scriptMs', 'styleMs', 'layoutMs', 'heapMB', 'cpuMs', 'adRequests', 'adSlotsVisible']) report.pages[route][name][key] = summarize(samples[route][name], key);
    }
  }

  // rule counts, as Chrome sees them
  const [worker] = browsers.with.serviceWorkers().length ? browsers.with.serviceWorkers() : [await browsers.with.waitForEvent('serviceworker')];
  const extId = new URL(worker.url()).host;
  const control = await browsers.with.newPage();
  await control.goto(`chrome-extension://${extId}/src/options/options.html`);
  report.rules = await control.evaluate(async () => {
    const dnr = chrome.declarativeNetRequest;
    return {
      enabledRulesets: (await dnr.getEnabledRulesets()),
      availableStaticRules: await dnr.getAvailableStaticRuleCount(),
      guaranteedMinimumStaticRules: dnr.GUARANTEED_MINIMUM_STATIC_RULES,
      maxEnabledStaticRulesets: dnr.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS
    };
  });
  const countRules = (f) => JSON.parse(readFileSync(path.join(project, 'rules', f), 'utf8')).length;
  report.rules.rulesInFiles = { 'default-rules.json': countRules('default-rules.json'), 'youtube-rules.json': countRules('youtube-rules.json'), 'streaming-rules.json': countRules('streaming-rules.json') };
  const css = readFileSync(path.join(project, 'src/content/page-cleanup.css'), 'utf8');
  report.css = { bytes: Buffer.byteLength(css), selectorLines: css.split('\n').filter((l) => /^\s+\S.*,?$/.test(l) && !l.startsWith('/*') && !l.includes('{') && !l.startsWith('}') && !l.startsWith('html[')).length };
  await control.close();

  // video playback of the small test clip
  report.video = {};
  for (const name of ['without', 'with']) {
    const page = await browsers[name].newPage();
    await page.goto(`http://app.test:${port}/video`);
    await page.evaluate(() => document.getElementById('v').play());
    await sleep(4000);
    report.video[name] = await page.evaluate(() => { const q = document.getElementById('v').getVideoPlaybackQuality(); return { played: q.totalVideoFrames, dropped: q.droppedVideoFrames, seconds: document.getElementById('v').currentTime }; });
    await page.close();
  }

  // idle watch of the extension (Linux only)
  for (const p of browsers.without.pages()) await p.close().catch(() => {});
  await browsers.without.newPage().then((p) => p.goto('about:blank'));
  await sleep(500);
  const emptyTabMB = emptyTabMemoryMB();
  for (const p of browsers.with.pages()) await p.close().catch(() => {});
  await browsers.with.newPage().then((p) => p.goto('about:blank'));
  const start = extensionProcesses();
  if (start === null) {
    report.notes.push('Idle CPU and memory of the extension are measured on Linux only. On Windows, open Chrome Task Manager (Shift+Esc) and look at the "Extension: MAD Blocker" row.');
  } else {
    await sleep(IDLE_SECONDS * 1000);
    const end = extensionProcesses();
    const tick = 100; // Linux clock ticks per second
    const byPid = new Map(start.map((p) => [p.pid, p]));
    let cpuSeconds = 0;
    for (const p of end) { const s = byPid.get(p.pid); if (s) cpuSeconds += (p.ticks - s.ticks) / tick; }
    report.idle = { seconds: IDLE_SECONDS, extensionProcesses: end.length, cpuPercentOfOneCore: (cpuSeconds / IDLE_SECONDS) * 100, rssMB: end.reduce((a, p) => a + p.rssMB, 0), emptyTabMB };
  }
} catch (err) {
  console.error('The performance run crashed:', err);
  process.exitCode = 1;
} finally {
  for (const c of Object.values(browsers)) await c.close().catch(() => {});
  server.close();
  rmSync(work, { recursive: true, force: true });
}

// ---- report ----------------------------------------------------------------------------------
if (report.pages.clean) {
  const line = (label, w, wo, key, unit, digits = 1) => {
    const a = report.pages[label].with[key].median, b = report.pages[label].without[key].median;
    return `${key.padEnd(14)} without ${fmt(b, digits).padStart(8)}${unit}   with ${fmt(a, digits).padStart(8)}${unit}   difference ${(a - b >= 0 ? '+' : '') + fmt(a - b, digits)}${unit}`;
  };
  console.log(`\nMAD Blocker performance (median of ${RUNS} loads each, browsers alternated)\n${'='.repeat(70)}`);
  const hasCpu = Number.isFinite(report.pages.clean.with.cpuMs.median);
  console.log('\nCLEAN PAGE (5,000 elements, no ads): the cost of having the extension');
  if (hasCpu) console.log('  ' + line('clean', 0, 0, 'cpuMs', ' ms') + '   <- total CPU, all browser processes');
  for (const k of ['loadMs', 'taskMs', 'scriptMs', 'styleMs', 'layoutMs']) console.log('  ' + line('clean', 0, 0, k, ' ms'));
  console.log('  ' + line('clean', 0, 0, 'heapMB', ' MB'));
  console.log('\nADS PAGE (40 ad slots, 17 ad requests, ads added while loading; fake ad scripts)');
  if (hasCpu) console.log('  ' + line('ads', 0, 0, 'cpuMs', ' ms') + '   <- total CPU, all browser processes');
  for (const k of ['loadMs', 'taskMs', 'scriptMs', 'styleMs', 'layoutMs']) console.log('  ' + line('ads', 0, 0, k, ' ms'));
  console.log('  (taskMs counts only the page\'s own main thread. Blocked ad frames are drawn there, while real ad frames run in other processes, so use cpuMs to compare.)');
  console.log('  ' + line('ads', 0, 0, 'adRequests', '', 0));
  console.log('  ' + line('ads', 0, 0, 'adSlotsVisible', '', 0));
  console.log(`\nSpread (90th percentile, loadMs): clean without ${fmt(report.pages.clean.without.loadMs.p90)} / with ${fmt(report.pages.clean.with.loadMs.p90)};  ads without ${fmt(report.pages.ads.without.loadMs.p90)} / with ${fmt(report.pages.ads.with.loadMs.p90)}`);
  console.log(`\nRules: enabled ${report.rules.enabledRulesets.join(', ')}; ${JSON.stringify(report.rules.rulesInFiles)}; Chrome still has room for ${report.rules.availableStaticRules} more static rules (guaranteed minimum ${report.rules.guaranteedMinimumStaticRules}).`);
  console.log(`Stylesheet: ${report.css.bytes} bytes.`);
  console.log(`Video (4 s of a tiny clip): without ${JSON.stringify(report.video.without)}  with ${JSON.stringify(report.video.with)}`);
  if (report.idle) console.log(`Extension idle for ${report.idle.seconds} s: ${fmt(report.idle.cpuPercentOfOneCore, 2)} % of one CPU core, ${fmt(report.idle.rssMB, 0)} MB of memory (proportional, PSS) in the extension process (${report.idle.extensionProcesses} process). An empty tab in the other browser uses ${fmt(report.idle.emptyTabMB, 0)} MB the same way. The extension process also holds Chrome's own extension machinery, so this is an upper bound for MAD Blocker's share. Check Chrome's Task Manager (Shift+Esc), row "Extension: MAD Blocker", on your PC for the real figure.`);
  for (const n of report.notes) console.log('Note: ' + n);
  console.log('\nTimes are noisy. A difference smaller than the 90th-percentile spread is not a real difference.');
}
if (process.env.PERF_JSON) writeFileSync(process.env.PERF_JSON, JSON.stringify(report, null, 2));
