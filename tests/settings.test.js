import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSettings, normalizeHost, setSiteMode, removeSite, parseImport,
  createDefaultSettings, MAX_SITES, MAX_IMPORT_BYTES, MAX_CUSTOM, MAX_CUSTOM_PER_SITE,
  addCustomSelector, removeCustomSelector, setFeature, FEATURES, summarizeSettings
} from '../src/shared/settings.js';

test('garbage input falls back to safe defaults', () => {
  for (const bad of [undefined, null, 5, 'text', [], true, () => {}]) {
    assert.deepEqual(validateSettings(bad), createDefaultSettings());
  }
});

test('wrong types for known fields are replaced by defaults', () => {
  const s = validateSettings({ enabled: 'yes', placeholder: 'red', sites: 'nope' });
  assert.equal(s.enabled, true);
  assert.equal(s.placeholder, 'collapse');
  assert.deepEqual(s.sites, []);
});

test('unknown keys are dropped', () => {
  const s = validateSettings({ enabled: false, evil: 'x', extra: { a: 1 } });
  assert.deepEqual(Object.keys(s).sort(), ['custom', 'enabled', 'features', 'placeholder', 'sites', 'version']);
  assert.equal(s.enabled, false);
});

test('invalid hosts and modes are rejected', () => {
  const s = validateSettings({
    sites: [
      { host: 'javascript:alert(1)', mode: 'paused' },
      { host: 'a b.com', mode: 'paused' },
      { host: 'localhost', mode: 'paused' },
      { host: '127.0.0.1', mode: 'paused' },
      { host: 'a..com', mode: 'paused' },
      { host: '*.example.com', mode: 'paused' },
      { host: 'example.com:8080', mode: 'paused' },
      { host: 'example.com/path', mode: 'paused' },
      { host: 'x'.repeat(300) + '.com', mode: 'paused' },
      { host: '__proto__', mode: 'paused' },
      { host: 'ok.example.com', mode: 'launch-missiles' },
      { host: 'ok.example.com', mode: 'default' },
      { host: 123, mode: 'paused' },
      'string',
      null
    ]
  });
  assert.deepEqual(s.sites, []);
});

test('valid hosts are normalized and de-duplicated', () => {
  const s = validateSettings({
    sites: [
      { host: 'Example.COM', mode: 'paused' },
      { host: 'example.com', mode: 'aggressive' },
      { host: 'https://News.Example.org/path?q=1', mode: 'allow-popups' }
    ]
  });
  assert.deepEqual(s.sites, [
    { host: 'example.com', mode: 'paused' },
    { host: 'news.example.org', mode: 'allow-popups' }
  ]);
});

test('site list is capped', () => {
  const sites = Array.from({ length: MAX_SITES + 200 }, (_, i) => ({ host: `site${i}.example.com`, mode: 'paused' }));
  assert.equal(validateSettings({ sites }).sites.length, MAX_SITES);
});

test('normalizeHost accepts real hosts and rejects junk', () => {
  assert.equal(normalizeHost('  www.Example.com. '), 'www.example.com');
  assert.equal(normalizeHost('xn--bcher-kva.example'), 'xn--bcher-kva.example');
  assert.equal(normalizeHost('ftp://example.com'), null);
  assert.equal(normalizeHost(''), null);
  assert.equal(normalizeHost(undefined), null);
});

test('setSiteMode adds, changes and removes entries immutably', () => {
  const base = createDefaultSettings();
  const paused = setSiteMode(base, 'example.com', 'paused');
  assert.deepEqual(base.sites, []);
  assert.deepEqual(paused.sites, [{ host: 'example.com', mode: 'paused' }]);
  const changed = setSiteMode(paused, 'example.com', 'aggressive');
  assert.deepEqual(changed.sites, [{ host: 'example.com', mode: 'aggressive' }]);
  assert.deepEqual(removeSite(changed, 'example.com').sites, []);
  assert.deepEqual(setSiteMode(changed, 'example.com', 'default').sites, []);
});

test('setSiteMode throws on bad input', () => {
  const base = createDefaultSettings();
  assert.throws(() => setSiteMode(base, 'not a host', 'paused'));
  assert.throws(() => setSiteMode(base, 'example.com', 'nope'));
});

test('import: invalid JSON, wrong shape and oversize files are refused', () => {
  assert.equal(parseImport('{not json').ok, false);
  assert.equal(parseImport('[1,2,3]').ok, false);
  assert.equal(parseImport('"text"').ok, false);
  assert.equal(parseImport(42).ok, false);
  assert.equal(parseImport(' '.repeat(MAX_IMPORT_BYTES + 1)).ok, false);
});

test('import: valid files are sanitized', () => {
  const result = parseImport(JSON.stringify({
    enabled: false, placeholder: 'black', hacked: true,
    sites: [{ host: 'example.com', mode: 'paused' }, { host: '<script>', mode: 'paused' }]
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.settings, {
    version: 1, enabled: false, placeholder: 'black', sites: [{ host: 'example.com', mode: 'paused' }], custom: [],
    features: { youtubeNetwork: true, youtubeSkip: true, streaming: true }
  });
});

test('import: prototype pollution payload has no effect', () => {
  const result = parseImport('{"__proto__":{"enabled":false,"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
  assert.equal(result.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(result.settings.enabled, true);
  assert.equal(Object.hasOwn(result.settings, 'polluted'), false);
});

// --- custom per-site rules ---------------------------------------------------

test('custom rules: valid entries are kept, bad ones are dropped', () => {
  const s = validateSettings({
    custom: [
      { host: 'Example.com', selector: '#top-banner' },
      { host: 'example.com', selector: '#top-banner' },           // duplicate
      { host: 'example.com', selector: '} body { display:none' }, // CSS injection
      { host: 'example.com', selector: 'body' },                  // too broad
      { host: 'example.com', selector: '.a, .b' },                // not one selector
      { host: 'not a host', selector: '.ok' },
      { host: 'example.com', selector: 42 },
      { host: 'example.com' },
      null, 'x', []
    ]
  });
  assert.deepEqual(s.custom, [{ host: 'example.com', selector: '#top-banner' }]);
});

test('custom rules: wrong shape or missing field falls back to an empty list', () => {
  assert.deepEqual(validateSettings({ custom: 'nope' }).custom, []);
  assert.deepEqual(validateSettings({ custom: { host: 'a.com', selector: '.x' } }).custom, []);
  assert.deepEqual(validateSettings({}).custom, []);
});

test('custom rules: totals and per-site limits are enforced', () => {
  const perSite = Array.from({ length: MAX_CUSTOM_PER_SITE + 10 }, (_, i) => ({ host: 'a.example.com', selector: `.x${i}` }));
  assert.equal(validateSettings({ custom: perSite }).custom.length, MAX_CUSTOM_PER_SITE);
  const total = Array.from({ length: MAX_CUSTOM + 100 }, (_, i) => ({ host: `site${i}.example.com`, selector: '.x' }));
  assert.equal(validateSettings({ custom: total }).custom.length, MAX_CUSTOM);
});

test('addCustomSelector and removeCustomSelector work immutably', () => {
  const base = createDefaultSettings();
  const added = addCustomSelector(base, 'https://News.Example.com/page', '  .promo  ');
  assert.deepEqual(base.custom, []);
  assert.deepEqual(added.custom, [{ host: 'news.example.com', selector: '.promo' }]);
  assert.deepEqual(addCustomSelector(added, 'news.example.com', '.promo').custom, added.custom); // no duplicate
  assert.deepEqual(removeCustomSelector(added, 'news.example.com', '.promo').custom, []);
});

test('addCustomSelector explains why a selector is refused', () => {
  const base = createDefaultSettings();
  assert.throws(() => addCustomSelector(base, 'example.com', 'body'), /not allowed/);
  assert.throws(() => addCustomSelector(base, 'example.com', '.a{}'), /not allowed/);
  assert.throws(() => addCustomSelector(base, 'example.com', ''), /not allowed/);
  assert.throws(() => addCustomSelector(base, 'not a host', '.ok'), /website/);
  assert.throws(() => addCustomSelector(base, 'example.com', undefined), /not allowed/);
});

test('addCustomSelector refuses to go over the limits', () => {
  let s = createDefaultSettings();
  for (let i = 0; i < MAX_CUSTOM_PER_SITE; i++) s = addCustomSelector(s, 'a.example.com', `.x${i}`);
  assert.throws(() => addCustomSelector(s, 'a.example.com', '.one-too-many'), /Too many/);
});

test('import keeps valid custom rules and drops hostile ones', () => {
  const result = parseImport(JSON.stringify({
    custom: [{ host: 'example.com', selector: '.ok' }, { host: 'example.com', selector: '}*{display:none' }]
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.settings.custom, [{ host: 'example.com', selector: '.ok' }]);
});

test('site mode changes keep custom rules', () => {
  const s = addCustomSelector(createDefaultSettings(), 'example.com', '.promo');
  assert.deepEqual(setSiteMode(s, 'example.com', 'paused').custom, s.custom);
});

// --- protections (feature toggles) ---------------------------------------------

test('protections default to on and only accept booleans for known names', () => {
  assert.deepEqual(createDefaultSettings().features, { youtubeNetwork: true, youtubeSkip: true, streaming: true });
  const s = validateSettings({ features: { youtubeNetwork: false, youtubeSkip: 'no', streaming: 0, evil: true, __proto__: { x: 1 } } });
  assert.deepEqual(s.features, { youtubeNetwork: false, youtubeSkip: true, streaming: true });
  assert.deepEqual(validateSettings({ features: 'x' }).features, createDefaultSettings().features);
  assert.deepEqual(validateSettings({ features: [false, false] }).features, createDefaultSettings().features);
});

test('setFeature switches one protection immutably and refuses bad input', () => {
  const base = createDefaultSettings();
  const off = setFeature(base, 'youtubeSkip', false);
  assert.equal(base.features.youtubeSkip, true);
  assert.deepEqual(off.features, { youtubeNetwork: true, youtubeSkip: false, streaming: true });
  assert.throws(() => setFeature(base, 'nope', true), /Unknown/);
  assert.throws(() => setFeature(base, 'streaming', 'yes'), /Bad value/);
  assert.deepEqual(FEATURES, ['youtubeNetwork', 'youtubeSkip', 'streaming']);
});

test('import keeps valid protections and ignores the rest', () => {
  const r = parseImport(JSON.stringify({ features: { streaming: false, hacked: false } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.settings.features, { youtubeNetwork: true, youtubeSkip: true, streaming: false });
});

// --- import preview -------------------------------------------------------------------------

test('summarizeSettings says what an import would do, in plain text lines', () => {
  const text = summarizeSettings(validateSettings({
    enabled: false, placeholder: 'black', features: { streaming: false },
    sites: [{ host: 'a.example.com', mode: 'paused' }, { host: 'b.example.com', mode: 'allow-popups' }, { host: 'c.example.com', mode: 'aggressive' }],
    custom: [{ host: 'a.example.com', selector: '#top-banner' }]
  })).join('\n');
  assert.match(text, /OFF/);
  assert.match(text, /black/);
  assert.match(text, /switched off: streaming/);
  assert.match(text, /Paused.*\(1\): a\.example\.com/);
  assert.match(text, /Pop-ups allowed \(1\): b\.example\.com/);
  assert.match(text, /more aggressively \(1\): c\.example\.com/);
  assert.match(text, /a\.example\.com: #top-banner/);
});

test('summarizeSettings shows "none" for empty settings and caps long lists', () => {
  assert.deepEqual(summarizeSettings(createDefaultSettings()), [
    'MAD Blocker: on. Ad space style: collapse.',
    'Websites with special settings: none.',
    'Custom hide rules: none.'
  ]);
  const many = validateSettings({
    sites: Array.from({ length: 30 }, (_, i) => ({ host: `site${i}.example.com`, mode: 'paused' })),
    custom: Array.from({ length: 40 }, (_, i) => ({ host: 'a.example.com', selector: `.ad${i}` }))
  });
  const lines = summarizeSettings(many);
  assert.ok(lines.length <= 14, `too long: ${lines.length} lines`);
  assert.ok(lines.some((l) => l.includes('and 22 more')), 'hosts are capped');
  assert.ok(lines.some((l) => l.includes('and 32 more')), 'rules are capped');
});

test('summarizeSettings accepts anything, always returns plain strings', () => {
  for (const junk of [undefined, null, 5, 'x', [], { sites: 'x', custom: 7 }, { __proto__: { enabled: false } }]) {
    const lines = summarizeSettings(junk);
    assert.ok(Array.isArray(lines) && lines.length >= 3 && lines.every((l) => typeof l === 'string'));
  }
});
