// Runs the real content script against a tiny fake page, so its matching logic
// stays in sync with shared/popup-policy.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { selectorProblem } from '../src/shared/selector.js';
import { customRuleCss } from '../src/shared/cosmetic.js';

const source = readFileSync(fileURLToPath(new URL('../src/content/page-cleanup.js', import.meta.url)), 'utf8');

function run({ origin = 'https://www.news.example.com', ancestors = [], settings }) {
  const attrs = new Map();
  const listeners = [];
  const sandbox = {
    URL,
    document: {
      documentElement: {
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k)
      }
    },
    location: { origin, hostname: new URL(origin).hostname, ancestorOrigins: ancestors },
    chrome: {
      storage: {
        local: { get: async () => ({ settings }) },
        onChanged: { addListener: (fn) => listeners.push(fn) }
      }
    }
  };
  vm.runInNewContext(source, sandbox);
  return { attrs, listeners, ready: () => new Promise((r) => setImmediate(r)) };
}

test('active page gets the three attributes, with parent domains for per-site rules', async () => {
  const page = run({ settings: { enabled: true, placeholder: 'black', sites: [] } });
  await page.ready();
  assert.equal(page.attrs.get('data-mad'), 'on');
  assert.equal(page.attrs.get('data-mad-ph'), 'black');
  assert.equal(page.attrs.get('data-mad-host'), 'www.news.example.com news.example.com example.com');
});

test('nothing is set while MAD Blocker is off', async () => {
  const page = run({ settings: { enabled: false, placeholder: 'black', sites: [] } });
  await page.ready();
  assert.equal(page.attrs.size, 0);
});

test('paused sites, including subdomains, get no attributes; look-alikes do', async () => {
  const sites = [{ host: 'example.com', mode: 'paused' }];
  const paused = run({ settings: { enabled: true, sites } });
  await paused.ready();
  assert.equal(paused.attrs.size, 0);

  const lookalike = run({ origin: 'https://badexample.com', settings: { enabled: true, sites } });
  await lookalike.ready();
  assert.equal(lookalike.attrs.get('data-mad'), 'on');
});

test('ads inside iframes use the top page host (so pausing a site pauses its ad frames)', async () => {
  const sites = [{ host: 'example.com', mode: 'paused' }];
  const frame = run({
    origin: 'https://ads.network.net',
    ancestors: ['https://ads.network.net', 'https://example.com'],
    settings: { enabled: true, sites }
  });
  await frame.ready();
  assert.equal(frame.attrs.size, 0);
});

test('hostile or missing settings fall back safely', async () => {
  const bad = run({ settings: { enabled: 'x', placeholder: '<script>', sites: 'nope' } });
  await bad.ready();
  assert.equal(bad.attrs.get('data-mad-ph'), 'collapse');
  const none = run({ settings: undefined });
  await none.ready();
  assert.equal(none.attrs.get('data-mad'), 'on');
});

test('changing settings later updates the page without a reload', async () => {
  const page = run({ settings: { enabled: true, placeholder: 'collapse', sites: [] } });
  await page.ready();
  assert.equal(page.attrs.get('data-mad-ph'), 'collapse');
  page.listeners[0]({ settings: { newValue: { enabled: true, placeholder: 'white', sites: [] } } }, 'local');
  assert.equal(page.attrs.get('data-mad-ph'), 'white');
  page.listeners[0]({ settings: { newValue: { enabled: false } } }, 'local');
  assert.equal(page.attrs.size, 0);
  page.listeners[0]({ settings: { newValue: { enabled: true } } }, 'sync'); // wrong area is ignored
  assert.equal(page.attrs.size, 0);
});

// --- custom per-site rules ----------------------------------------------------

function runWithSheets({ origin = 'https://news.example.com', settings }) {
  const attrs = new Map();
  const listeners = [];
  const created = [];
  class FakeSheet {
    constructor() { this.rules = []; created.push(this); }
    insertRule(text) { this.rules.push(text); return this.rules.length - 1; }
  }
  const document = {
    adoptedStyleSheets: [],
    documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) }
  };
  const sandbox = {
    URL, Array, CSSStyleSheet: FakeSheet, document,
    location: { origin, hostname: new URL(origin).hostname, ancestorOrigins: [] },
    chrome: {
      storage: { local: { get: async () => ({ settings }) }, onChanged: { addListener: (fn) => listeners.push(fn) } }
    }
  };
  vm.runInNewContext(source, sandbox);
  // Array.from: the script runs in its own realm, so copy into this realm's arrays before comparing.
  const rules = () => Array.from(document.adoptedStyleSheets).flatMap((sh) => Array.from(sh.rules));
  return { attrs, listeners, document, rules, created, ready: () => new Promise((r) => setImmediate(r)) };
}

const custom = (...pairs) => pairs.map(([host, selector]) => ({ host, selector }));

test('custom rules for the current site become one stylesheet, in the chosen ad-space style', async () => {
  for (const mode of ['collapse', 'black', 'white']) {
    const page = runWithSheets({ settings: { enabled: true, placeholder: mode, sites: [], custom: custom(['example.com', '#top-banner']) } });
    await page.ready();
    assert.deepEqual(page.rules(), [customRuleCss('#top-banner', mode)], mode);
  }
});

test('custom rules only apply to their own site and its subdomains', async () => {
  const settings = {
    enabled: true, placeholder: 'collapse', sites: [],
    custom: custom(['example.com', '.mine'], ['other.com', '.theirs'], ['badexample.com', '.lookalike'], ['news.example.com', '.exact'])
  };
  const page = runWithSheets({ settings });
  await page.ready();
  assert.deepEqual(page.rules().map((r) => r.match(/:is\((.*?)\)/)[1]).sort(), ['.exact', '.mine']);
});

test('the content script accepts exactly the selectors the shared validator accepts', async () => {
  const corpus = [
    'ins.adsbygoogle', '#sidebar-ad', '[id^="div-gpt-ad"]', 'amp-ad', 'div.banner[data-slot="top"]', 'iframe[src*="ads.example.com/"]',
    "div[data-x='y']", '.a:not(.b)', 'div > .promo', '.a + .b',
    '} body { display:none', 'a{color:red}', 'div.x; background:red', '.a, .b', '.a\\{', '*', 'body', 'html', 'div', 'a', 'span',
    'body .ad', 'div > body.x', '* .ad', '.ad /* x */', '.ad[x="url(a)"]', '[id^="unclosed]', '[id="a"', '.a)', '(.a', '.a]',
    ' .ad', '.ad ', '', 'x'.repeat(201), '.' + 'x'.repeat(199), '.a<script>', '@import "x"', 'a:hover{}',
    '.a:not(.b)', '.ad:has(img)', ':root .ad', '.a::before', '[data-x]', '.a[data-x]', '[class*=a]', '[class^="ab"]', '[class*="ad"]', '[class="a"]',
    '[data-slot=top]', 'a[href*="http://ads.example.com/"]', 'BODY .ad', 'Body > .x', 'HTML .y', '.ad[data-x="a" i]', '.ad[ data-x = "abc" ]',
    '.ad[x="javascript:alert(1)"]', '.ad:expression(1)', '.a\nb', '.a\tb', '.a\u0000b', '.\u00e9', '#a#b',
    123, null, undefined, {}, [], true
  ];
  for (const selector of corpus) {
    const page = runWithSheets({ settings: { enabled: true, placeholder: 'collapse', sites: [], custom: [{ host: 'example.com', selector }] } });
    await page.ready();
    const accepted = page.rules().length === 1;
    assert.equal(accepted, selectorProblem(selector) === null, `disagreement on ${JSON.stringify(selector)}`);
  }
});

test('tampered storage cannot inject CSS through custom rules', async () => {
  const evil = [
    '} body { display: none !important; } .x',
    '.a { background: url(https://evil.example/x) }',
    '*', 'body',
    '.a /* */ .b'
  ];
  const page = runWithSheets({ settings: { enabled: true, placeholder: 'collapse', sites: [], custom: evil.map((selector) => ({ host: 'example.com', selector })) } });
  await page.ready();
  assert.equal(page.rules().length, 0);
  assert.equal(page.created.length, 0, 'no stylesheet is even created for rejected rules');
});

test('malformed custom data is ignored without errors', async () => {
  for (const bad of ['text', 5, {}, null, [null, 5, 'x', [], { host: 5, selector: '.a' }, { host: 'example.com' }, { selector: '.a' }]]) {
    const page = runWithSheets({ settings: { enabled: true, placeholder: 'collapse', sites: [], custom: bad } });
    await page.ready();
    assert.equal(page.rules().length, 0);
    assert.equal(page.attrs.get('data-mad'), 'on');
  }
});

test('no more than 50 custom rules are applied for one site', async () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ host: 'example.com', selector: `.ad${i}` }));
  const page = runWithSheets({ settings: { enabled: true, placeholder: 'collapse', sites: [], custom: many } });
  await page.ready();
  assert.equal(page.rules().length, 50);
});

test('custom rules are removed when MAD Blocker is turned off or the site is paused', async () => {
  const base = { enabled: true, placeholder: 'collapse', sites: [], custom: custom(['example.com', '.promo']) };
  const page = runWithSheets({ settings: base });
  await page.ready();
  assert.equal(page.rules().length, 1);

  page.listeners[0]({ settings: { newValue: { ...base, enabled: false } } }, 'local');
  assert.equal(page.document.adoptedStyleSheets.length, 0);

  page.listeners[0]({ settings: { newValue: base } }, 'local');
  assert.equal(page.rules().length, 1);

  page.listeners[0]({ settings: { newValue: { ...base, sites: [{ host: 'example.com', mode: 'paused' }] } } }, 'local');
  assert.equal(page.document.adoptedStyleSheets.length, 0);
});

test('changing custom rules replaces the stylesheet instead of piling up new ones', async () => {
  const base = { enabled: true, placeholder: 'collapse', sites: [] };
  const page = runWithSheets({ settings: { ...base, custom: custom(['example.com', '.one']) } });
  await page.ready();
  page.listeners[0]({ settings: { newValue: { ...base, custom: custom(['example.com', '.two']) } } }, 'local');
  page.listeners[0]({ settings: { newValue: { ...base, placeholder: 'black', custom: custom(['example.com', '.two']) } } }, 'local');
  assert.equal(page.document.adoptedStyleSheets.length, 1);
  assert.deepEqual(page.rules(), [customRuleCss('.two', 'black')]);
});

test('other stylesheets on the page are never touched', async () => {
  const page = runWithSheets({ settings: { enabled: true, placeholder: 'collapse', sites: [], custom: custom(['example.com', '.promo']) } });
  const pageSheet = { rules: ['pre-existing'] };
  page.document.adoptedStyleSheets.push(pageSheet);
  page.listeners[0]({ settings: { newValue: { enabled: false } } }, 'local');
  assert.ok(page.document.adoptedStyleSheets.includes(pageSheet));
});

// --- YouTube switch ------------------------------------------------------------

test('YouTube pages get data-mad-yt only while skipping is allowed and the site is active', async () => {
  const yt = (settings, origin = 'https://www.youtube.com') => run({ origin, settings });

  const on = yt({ enabled: true, sites: [] });
  await on.ready();
  assert.equal(on.attrs.get('data-mad-yt'), 'on');

  const noFeatures = yt({ enabled: true, sites: [], features: { youtubeSkip: false } });
  await noFeatures.ready();
  assert.equal(noFeatures.attrs.get('data-mad'), 'on');
  assert.equal(noFeatures.attrs.has('data-mad-yt'), false);

  const stillOn = yt({ enabled: true, sites: [], features: { youtubeNetwork: false, streaming: false } });
  await stillOn.ready();
  assert.equal(stillOn.attrs.get('data-mad-yt'), 'on', 'other protections do not affect skipping');

  const paused = yt({ enabled: true, sites: [{ host: 'youtube.com', mode: 'paused' }] });
  await paused.ready();
  assert.equal(paused.attrs.has('data-mad-yt'), false);

  const off = yt({ enabled: false, sites: [] });
  await off.ready();
  assert.equal(off.attrs.has('data-mad-yt'), false);
});

test('data-mad-yt is never set on other sites, including look-alikes', async () => {
  for (const origin of ['https://example.com', 'https://notyoutube.com', 'https://youtube.com.evil.net', 'https://youtube.example.com']) {
    const page = run({ origin, settings: { enabled: true, sites: [] } });
    await page.ready();
    assert.equal(page.attrs.has('data-mad-yt'), false, origin);
  }
});

test('the switch follows later setting changes without a reload', async () => {
  const page = run({ origin: 'https://m.youtube.com', settings: { enabled: true, sites: [] } });
  await page.ready();
  assert.equal(page.attrs.get('data-mad-yt'), 'on');
  page.listeners[0]({ settings: { newValue: { enabled: true, sites: [], features: { youtubeSkip: false } } } }, 'local');
  assert.equal(page.attrs.has('data-mad-yt'), false);
  page.listeners[0]({ settings: { newValue: { enabled: true, sites: [] } } }, 'local');
  assert.equal(page.attrs.get('data-mad-yt'), 'on');
});
