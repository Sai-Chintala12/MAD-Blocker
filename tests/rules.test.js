import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRuleList, MAX_RULES } from '../src/shared/rules-validate.js';
import {
  buildAllowRules, buildAggressiveRules, buildDynamicRules,
  ALLOW_RULE_PRIORITY, AGGRESSIVE_BASE_ID, AGGRESSIVE_URL_FILTERS
} from '../src/shared/rules.js';
import { validateSettings } from '../src/shared/settings.js';

const read = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));

const goodBlock = () => ({
  id: 1, priority: 1, action: { type: 'block' },
  condition: { requestDomains: ['ads.example.com'], resourceTypes: ['script'] }
});

test('bundled default rules pass the validator', () => {
  assert.deepEqual(validateRuleList(read('../rules/default-rules.json')), []);
});

test('a good rule passes', () => {
  assert.deepEqual(validateRuleList([goodBlock()]), []);
});

test('non-array input is rejected', () => {
  assert.notEqual(validateRuleList({}).length, 0);
  assert.notEqual(validateRuleList('x').length, 0);
});

test('regexFilter is refused', () => {
  const r = goodBlock();
  r.condition.regexFilter = '^(a+)+$';
  assert.ok(validateRuleList([r]).some((e) => e.includes('regexFilter')));
});

test('redirect, modifyHeaders and upgradeScheme actions are refused', () => {
  for (const type of ['redirect', 'modifyHeaders', 'upgradeScheme']) {
    const r = goodBlock();
    r.action = { type };
    assert.ok(validateRuleList([r]).some((e) => e.includes('not allowed')), type);
  }
});

test('block rules cannot block page navigation or be untargeted', () => {
  const nav = goodBlock();
  nav.condition.resourceTypes = ['main_frame'];
  assert.ok(validateRuleList([nav]).some((e) => e.includes('main_frame')));

  const wide = goodBlock();
  wide.condition = { resourceTypes: ['script'] };
  assert.ok(validateRuleList([wide]).some((e) => e.includes('targeted')));

  const star = goodBlock();
  star.condition = { urlFilter: '*', resourceTypes: ['script'] };
  assert.ok(validateRuleList([star]).some((e) => e.includes('too broad')));
});

test('duplicate ids, bad domains and bad resource types are refused', () => {
  assert.ok(validateRuleList([goodBlock(), goodBlock()]).some((e) => e.includes('duplicate')));

  const badDomain = goodBlock();
  badDomain.condition.requestDomains = ['not a domain'];
  assert.ok(validateRuleList([badDomain]).some((e) => e.includes('invalid domain')));

  const badType = goodBlock();
  badType.condition.resourceTypes = ['script', 'teleport'];
  assert.ok(validateRuleList([badType]).some((e) => e.includes('resourceTypes')));
});

test('oversized rule lists are refused', () => {
  const many = Array.from({ length: MAX_RULES + 1 }, (_, i) => ({ ...goodBlock(), id: i + 1 }));
  assert.ok(validateRuleList(many).some((e) => e.includes('Too many')));
});

test('malformed rule entries do not throw', () => {
  assert.doesNotThrow(() => validateRuleList([null, 5, 'x', [], { id: 1 }, { condition: 3 }]));
});

test('allow rules are generated only for paused sites and are valid', () => {
  const settings = validateSettings({
    sites: [
      { host: 'a.example.com', mode: 'paused' },
      { host: 'b.example.com', mode: 'aggressive' },
      { host: 'c.example.com', mode: 'paused' }
    ]
  });
  const rules = buildAllowRules(settings);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map((r) => r.id), [1, 2]);
  assert.ok(rules.every((r) => r.priority === ALLOW_RULE_PRIORITY && r.action.type === 'allowAllRequests'));
  assert.deepEqual(validateRuleList(rules), []);
});

test('aggressive rules exist only when a site uses aggressive mode, and are valid', () => {
  assert.deepEqual(buildAggressiveRules(validateSettings({ sites: [{ host: 'a.example.com', mode: 'paused' }] })), []);

  const settings = validateSettings({
    sites: [
      { host: 'a.example.com', mode: 'aggressive' },
      { host: 'b.example.com', mode: 'paused' },
      { host: 'c.example.com', mode: 'aggressive' }
    ]
  });
  const rules = buildAggressiveRules(settings);
  assert.equal(rules.length, AGGRESSIVE_URL_FILTERS.length);
  assert.ok(rules.every((r) => r.id >= AGGRESSIVE_BASE_ID && r.action.type === 'block'));
  assert.ok(rules.every((r) => r.condition.initiatorDomains.join() === 'a.example.com,c.example.com'));
  assert.deepEqual(validateRuleList(rules), []);
});

test('dynamic rules combine allow and aggressive rules without id clashes', () => {
  const settings = validateSettings({
    sites: [
      { host: 'a.example.com', mode: 'paused' },
      { host: 'b.example.com', mode: 'aggressive' }
    ]
  });
  const rules = buildDynamicRules(settings);
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  assert.deepEqual(validateRuleList(rules), []);
});

test('no dynamic rules at all while MAD Blocker is off', () => {
  const settings = validateSettings({
    enabled: false,
    sites: [{ host: 'a.example.com', mode: 'aggressive' }, { host: 'b.example.com', mode: 'paused' }]
  });
  assert.deepEqual(buildDynamicRules(settings), []);
});
