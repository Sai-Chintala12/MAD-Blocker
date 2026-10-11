import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSettings, normalizeHost, setSiteMode, removeSite, parseImport,
  createDefaultSettings, MAX_SITES, MAX_IMPORT_BYTES
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
  assert.deepEqual(Object.keys(s).sort(), ['enabled', 'placeholder', 'sites', 'version']);
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
    version: 1, enabled: false, placeholder: 'black', sites: [{ host: 'example.com', mode: 'paused' }]
  });
});

test('import: prototype pollution payload has no effect', () => {
  const result = parseImport('{"__proto__":{"enabled":false,"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
  assert.equal(result.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(result.settings.enabled, true);
  assert.equal(Object.hasOwn(result.settings, 'polluted'), false);
});
