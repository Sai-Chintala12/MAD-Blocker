// Randomised robustness tests. Seeded, so every run is identical and a failure can be reproduced.
// They throw thousands of hostile inputs at the code that handles untrusted data:
//   1. The two copies of the selector check (shared/selector.js and the content script) must agree.
//   2. Whatever the strict check accepts must satisfy basic safety properties on its own.
//   3. Settings, rule lists and imported files must never crash the code, and never change anything
//      outside their own result (no prototype pollution).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { selectorProblem } from '../src/shared/selector.js';
import { customRuleCss } from '../src/shared/cosmetic.js';
import { validateSettings, parseImport, addCustomSelector, createDefaultSettings, MAX_CUSTOM_PER_SITE } from '../src/shared/settings.js';
import { validateRuleList } from '../src/shared/rules-validate.js';
import { validateCosmeticConfig } from '../src/shared/cosmetic.js';
import { buildDynamicRules } from '../src/shared/rules.js';
import { planPopupSettings } from '../src/shared/popups.js';
import { SEED, rng, pick, randomSelector } from './helpers/random-selectors.js';

// --- running the real content script ------------------------------------------------------------

const contentSource = readFileSync(fileURLToPath(new URL('../src/content/page-cleanup.js', import.meta.url)), 'utf8');

/** Runs the content script once with these custom rules and returns the selectors it applied. */
async function acceptedByContentScript(selectors, mode = 'collapse') {
  const inserted = [];
  class FakeSheet { insertRule(text) { inserted.push(text); return inserted.length - 1; } }
  const document = {
    adoptedStyleSheets: [],
    documentElement: { setAttribute() {}, removeAttribute() {} }
  };
  const sandbox = {
    URL, Array, CSSStyleSheet: FakeSheet, document,
    location: { origin: 'https://example.com', hostname: 'example.com', ancestorOrigins: [] },
    chrome: {
      storage: {
        local: { get: async () => ({ settings: { enabled: true, placeholder: mode, sites: [], custom: selectors.map((selector) => ({ host: 'example.com', selector })) } }) },
        onChanged: { addListener() {} }
      }
    }
  };
  vm.runInNewContext(contentSource, sandbox);
  await new Promise((resolve) => setImmediate(resolve));
  return inserted;
}

const CASES = 4000;
const BATCH = 50; // the content script applies at most 50 custom rules for one site

test(`the content script and the shared check agree on ${CASES} random and mutated selectors`, async () => {
  const r = rng(SEED);
  const all = Array.from({ length: CASES }, () => randomSelector(r));
  let accepted = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const expected = batch.filter((s) => selectorProblem(s) === null);
    const applied = await acceptedByContentScript(batch);
    // each applied rule is exactly the shared helper's text, in order
    assert.deepEqual(Array.from(applied), expected.map((s) => customRuleCss(s, 'collapse')),
      `disagreement in batch starting at case ${i}`);
    accepted += expected.length;
  }
  assert.ok(accepted > 50, `the generator should produce some valid selectors (got ${accepted})`);
});

test('every selector the strict check accepts is safe to put inside a stylesheet rule', () => {
  const r = rng(SEED + 1);
  let accepted = 0;
  for (let i = 0; i < 20000; i++) {
    const s = randomSelector(r);
    if (selectorProblem(s) !== null) continue;
    accepted++;
    const bare = s.replace(/"[^"]*"|'[^']*'/g, 'Q');
    assert.ok(s.length >= 1 && s.length <= 200, s);
    // (">" is the child combinator and is allowed; "<" is not)
    assert.ok(!/[{};\\,<@\n\r\t\0]/.test(s), `forbidden character in ${JSON.stringify(s)}`);
    assert.ok(!s.includes('/*') && !s.includes('*/'), s);
    assert.ok(!/url\s*\(|expression\s*\(|javascript:/i.test(s), s);
    assert.ok(!bare.includes(':'), `pseudo-class got through: ${JSON.stringify(s)}`);
    assert.ok(!/(^|[\s>+~(])(html|body|\*)(?![\w-])/i.test(bare), `names the whole page: ${JSON.stringify(s)}`);
    assert.ok(s === s.trim(), s);
    // brackets and quotes are balanced
    const depth = (open, close) => [...bare].reduce((d, c) => (d < 0 ? d : d + (c === open) - (c === close)), 0);
    assert.equal(depth('[', ']'), 0, s);
    assert.equal(depth('(', ')'), 0, s);
    assert.ok(!/["']/.test(bare), s);
    // the finished rule text contains exactly one block
    const css = customRuleCss(s, 'collapse');
    assert.equal(css.split('{').length, 2, css);
    assert.equal(css.split('}').length, 2, css);
  }
  assert.ok(accepted > 200, `the generator should produce many valid selectors (got ${accepted})`);
});

test('the selector check is fast even on its worst inputs (no catastrophic regex backtracking)', () => {
  const nasty = [
    '['.repeat(200), ']'.repeat(200), '('.repeat(200), '[a'.repeat(100), '[a=b'.repeat(50), '"'.repeat(200), "'".repeat(199),
    '.a '.repeat(66), '[a="' + 'b'.repeat(190), '[' + 'a'.repeat(198), '[a~' + '='.repeat(190), '[ '.repeat(100),
    '[a="b" ' + 'i '.repeat(90), '.' + 'a-'.repeat(99), '*'.repeat(200), '^'.repeat(200), '[a*=' + '"'.repeat(190)
  ];
  const start = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) for (const s of nasty) selectorProblem(s);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms for ${200 * nasty.length} checks`);
});

// --- random settings, rules and imports -----------------------------------------------------------

function randomValue(r, depth = 0) {
  const kind = Math.floor(r() * 12);
  if (depth > 3 && kind > 6) return Math.floor(r() * 1000);
  switch (kind) {
    case 0: return null;
    case 1: return r() < 0.5;
    case 2: return Math.floor(r() * 1e6) - 500000;
    case 3: return pick(r, [NaN, Infinity, -0, 1e308, 2 ** 53]);
    case 4: return pick(r, ['', 'example.com', 'ADS.Example.COM', 'a'.repeat(300), '__proto__', 'constructor', '<script>', 'paused', 'aggressive', 'allow-popups', 'default', 'black', '.ad', '#x', 'https://a.example.com/x']);
    case 5: return randomSelector(r);
    case 6: return undefined;
    case 7: case 8: return Array.from({ length: Math.floor(r() * 6) }, () => randomValue(r, depth + 1));
    default: {
      const o = {};
      const keys = ['enabled', 'placeholder', 'sites', 'custom', 'features', 'host', 'mode', 'selector', 'version',
        'youtubeNetwork', 'youtubeSkip', 'streaming', '__proto__', 'constructor', 'prototype', 'polluted', 'id', 'priority', 'action', 'condition', 'type'];
      for (let i = 0; i < Math.floor(r() * 6); i++) o[pick(r, keys)] = randomValue(r, depth + 1);
      return o;
    }
  }
}

function plainShape(settings) {
  assert.deepEqual(Object.keys(settings).sort(), ['custom', 'enabled', 'features', 'placeholder', 'sites', 'version']);
  assert.equal(typeof settings.enabled, 'boolean');
  assert.ok(['black', 'white', 'collapse'].includes(settings.placeholder));
  assert.deepEqual(Object.keys(settings.features).sort(), ['streaming', 'youtubeNetwork', 'youtubeSkip']);
  for (const v of Object.values(settings.features)) assert.equal(typeof v, 'boolean');
  for (const s of settings.sites) assert.ok(['allow-popups', 'aggressive', 'paused'].includes(s.mode) && /^[a-z0-9.-]+$/.test(s.host), JSON.stringify(s));
  for (const c of settings.custom) assert.equal(selectorProblem(c.selector), null, c.selector);
  const perHost = {};
  for (const c of settings.custom) perHost[c.host] = (perHost[c.host] ?? 0) + 1;
  for (const n of Object.values(perHost)) assert.ok(n <= MAX_CUSTOM_PER_SITE);
}

test('validateSettings turns any junk into a well-formed settings object, without throwing', () => {
  const r = rng(SEED + 2);
  for (let i = 0; i < 5000; i++) {
    let raw = randomValue(r);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) raw = { sites: raw, custom: randomValue(r), features: randomValue(r) };
    const settings = validateSettings(raw);
    plainShape(settings);
    // whatever the settings are, everything built from them stays valid and bounded
    const rules = buildDynamicRules(settings);
    assert.deepEqual(validateRuleList(rules), [], JSON.stringify(raw));
    for (const p of planPopupSettings(settings)) assert.match(p.pattern, /^https?:\/\/(\*\.)?[a-z0-9.-]+\/\*$/);
  }
  assert.equal(({}).polluted, undefined);
});

test('imported files: junk text and junk JSON never throw and never change shared objects', () => {
  const r = rng(SEED + 3);
  const texts = ['', ' ', '{', '[', 'null', '0', '"x"', '{"__proto__":{"polluted":1}}', '{"constructor":{"prototype":{"polluted":1}}}', '[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[['];
  for (let i = 0; i < 3000; i++) texts.push(JSON.stringify(randomValue(r)) ?? 'undefined');
  for (let i = 0; i < 1000; i++) texts.push(String.fromCharCode(...Array.from({ length: 1 + Math.floor(r() * 40) }, () => Math.floor(r() * 256))));
  for (const text of texts) {
    const result = parseImport(text);
    assert.equal(typeof result.ok, 'boolean');
    if (result.ok) plainShape(result.settings);
    else assert.equal(typeof result.error, 'string');
  }
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('rule and list validators never throw on junk', () => {
  const r = rng(SEED + 4);
  for (let i = 0; i < 4000; i++) {
    const value = randomValue(r);
    const list = Array.isArray(value) ? value : [value];
    assert.doesNotThrow(() => validateRuleList(list));
    assert.doesNotThrow(() => validateRuleList(list, { allowMainFrameBlock: true }));
    assert.doesNotThrow(() => validateCosmeticConfig(value));
    assert.ok(Array.isArray(validateRuleList(list)));
  }
});

test('addCustomSelector only ever returns valid settings or throws a readable error', () => {
  const r = rng(SEED + 5);
  let settings = createDefaultSettings();
  for (let i = 0; i < 2000; i++) {
    try {
      settings = addCustomSelector(settings, pick(r, ['example.com', 'a.example.com', 'bad host', 'https://news.example.org/x', 5, null]), randomSelector(r));
    } catch (err) {
      assert.ok(err instanceof Error && typeof err.message === 'string' && err.message.length > 0);
    }
    plainShape(settings);
  }
});
