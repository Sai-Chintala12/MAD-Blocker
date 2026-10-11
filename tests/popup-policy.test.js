import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSitePolicy, findSiteEntry } from '../src/shared/popup-policy.js';
import { validateSettings } from '../src/shared/settings.js';

const make = (sites, enabled = true) => validateSettings({ enabled, sites });

test('default site: filtering on, default pop-up handling', () => {
  assert.deepEqual(getSitePolicy(make([]), 'example.com'), { filtering: true, popups: 'default', reason: 'default' });
});

test('global off disables everything', () => {
  const p = getSitePolicy(make([{ host: 'example.com', mode: 'aggressive' }], false), 'example.com');
  assert.equal(p.filtering, false);
  assert.equal(p.reason, 'disabled');
});

test('each site mode maps to the right policy', () => {
  assert.equal(getSitePolicy(make([{ host: 'a.com', mode: 'paused' }]), 'a.com').filtering, false);
  assert.equal(getSitePolicy(make([{ host: 'a.com', mode: 'allow-popups' }]), 'a.com').popups, 'allow');
  assert.equal(getSitePolicy(make([{ host: 'a.com', mode: 'aggressive' }]), 'a.com').popups, 'strict');
});

test('a parent-domain rule applies to subdomains, but not to look-alikes', () => {
  const s = make([{ host: 'example.com', mode: 'paused' }]);
  assert.equal(getSitePolicy(s, 'www.example.com').reason, 'paused');
  assert.equal(getSitePolicy(s, 'badexample.com').reason, 'default');
  assert.equal(getSitePolicy(s, 'example.com.evil.net').reason, 'default');
});

test('the most specific rule wins', () => {
  const s = make([
    { host: 'example.com', mode: 'paused' },
    { host: 'shop.example.com', mode: 'aggressive' }
  ]);
  assert.equal(findSiteEntry(s, 'shop.example.com').mode, 'aggressive');
  assert.equal(findSiteEntry(s, 'a.shop.example.com').mode, 'aggressive');
  assert.equal(findSiteEntry(s, 'www.example.com').mode, 'paused');
});

test('missing host returns no entry', () => {
  assert.equal(findSiteEntry(make([{ host: 'a.com', mode: 'paused' }]), ''), null);
  assert.equal(findSiteEntry(make([]), undefined), null);
});
