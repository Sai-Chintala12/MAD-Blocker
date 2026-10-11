import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPopupSettings, needsPopupPermission, POPUP_PERMISSION } from '../src/shared/popups.js';
import { validateSettings } from '../src/shared/settings.js';

const make = (sites, enabled = true) => validateSettings({ enabled, sites });

test('default and paused sites never change Chrome pop-up settings', () => {
  assert.deepEqual(planPopupSettings(make([])), []);
  assert.deepEqual(planPopupSettings(make([{ host: 'a.example.com', mode: 'paused' }])), []);
});

test('allow-popups maps to allow, aggressive maps to block', () => {
  const plan = planPopupSettings(make([
    { host: 'good.example.com', mode: 'allow-popups' },
    { host: 'bad.example.net', mode: 'aggressive' }
  ]));
  assert.ok(plan.filter((p) => p.pattern.includes('good.example.com')).every((p) => p.setting === 'allow'));
  assert.ok(plan.filter((p) => p.pattern.includes('bad.example.net')).every((p) => p.setting === 'block'));
});

test('each site gets exact-host and subdomain patterns for http and https', () => {
  const plan = planPopupSettings(make([{ host: 'example.com', mode: 'allow-popups' }]));
  assert.deepEqual(plan.map((p) => p.pattern).sort(), [
    'http://*.example.com/*',
    'http://example.com/*',
    'https://*.example.com/*',
    'https://example.com/*'
  ]);
});

test('patterns only ever contain a validated host (no injection)', () => {
  const plan = planPopupSettings(make([
    { host: 'evil.com/*', mode: 'aggressive' },
    { host: '*', mode: 'aggressive' },
    { host: 'a.com', mode: 'aggressive' }
  ]));
  assert.ok(plan.length > 0);
  for (const p of plan) assert.match(p.pattern, /^https?:\/\/(\*\.)?a\.com\/\*$/);
});

test('turning MAD Blocker off clears all pop-up settings', () => {
  assert.deepEqual(planPopupSettings(make([{ host: 'a.example.com', mode: 'aggressive' }], false)), []);
});

test('only pop-up modes need the optional permission', () => {
  assert.equal(needsPopupPermission('allow-popups'), true);
  assert.equal(needsPopupPermission('aggressive'), true);
  assert.equal(needsPopupPermission('paused'), false);
  assert.equal(needsPopupPermission('default'), false);
  assert.equal(POPUP_PERMISSION, 'contentSettings');
});
