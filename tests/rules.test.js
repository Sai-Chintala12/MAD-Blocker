import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRuleList, MAX_RULES } from '../src/shared/rules-validate.js';
import {
  buildAllowRules, buildAggressiveRules, buildDynamicRules,
  ALLOW_RULE_PRIORITY, AGGRESSIVE_BASE_ID, AGGRESSIVE_URL_FILTERS, rulesetPlan, STATIC_RULESETS
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

// --- YouTube and streaming rule files ----------------------------------------------

const manifest = read('../manifest.json');
const ruleFile = (id) => manifest.declarative_net_request.rule_resources.find((r) => r.id === id).path;

test('every static ruleset in the manifest is known to rulesetPlan, and the other way round', () => {
  const ids = manifest.declarative_net_request.rule_resources.map((r) => r.id).sort();
  assert.deepEqual(ids, Object.keys(STATIC_RULESETS).sort());
});

test('YouTube rules pass the strict validator and only target YouTube addresses', () => {
  const rules = read('../' + ruleFile('youtube_rules'));
  assert.deepEqual(validateRuleList(rules), []);
  assert.ok(rules.length > 0);
  for (const r of rules) {
    assert.match(r.condition.urlFilter, /^\|\|youtube\.com\//, 'YouTube rules must be anchored to youtube.com');
    assert.ok(!r.condition.resourceTypes.includes('main_frame') && !r.condition.resourceTypes.includes('media'),
      'YouTube rules must never block page loads or the video stream itself');
  }
});

test('streaming rules are valid only with the bundled-list option, and name their domains', () => {
  const rules = read('../' + ruleFile('streaming_rules'));
  assert.deepEqual(validateRuleList(rules, { allowMainFrameBlock: true }), []);
  assert.ok(validateRuleList(rules).some((e) => e.includes('main_frame')), 'the strict validator still refuses them');
  for (const r of rules) assert.ok(Array.isArray(r.condition.requestDomains) && r.condition.requestDomains.length > 0);
});

test('the main_frame option still demands named domains and does not widen anything else', () => {
  const noDomains = { id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||example.com/x', resourceTypes: ['main_frame'] } };
  assert.ok(validateRuleList([noDomains], { allowMainFrameBlock: true }).some((e) => e.includes('requestDomains')));
  const regex = { id: 1, priority: 1, action: { type: 'block' }, condition: { regexFilter: '.*', requestDomains: ['a.example.com'], resourceTypes: ['main_frame'] } };
  assert.ok(validateRuleList([regex], { allowMainFrameBlock: true }).some((e) => e.includes('regexFilter')));
  const redirect = { id: 1, priority: 1, action: { type: 'redirect' }, condition: { requestDomains: ['a.example.com'], resourceTypes: ['main_frame'] } };
  assert.ok(validateRuleList([redirect], { allowMainFrameBlock: true }).some((e) => e.includes('not allowed')));
});

test('streaming list never names a site people browse on purpose', () => {
  const domains = read('../' + ruleFile('streaming_rules')).flatMap((r) => r.condition.requestDomains);
  for (const safe of ['youtube.com', 'google.com', 'googlevideo.com', 'netflix.com', 'wikipedia.org', 'github.com', 'amazon.com']) {
    assert.ok(!domains.includes(safe), safe);
  }
  assert.equal(new Set(domains).size, domains.length, 'no duplicates');
});

test('rulesetPlan follows the on/off switch and each protection', () => {
  const all = validateSettings({});
  assert.deepEqual(rulesetPlan(all), { enable: ['default_rules', 'youtube_rules', 'streaming_rules'], disable: [] });
  const noYt = validateSettings({ features: { youtubeNetwork: false } });
  assert.deepEqual(rulesetPlan(noYt), { enable: ['default_rules', 'streaming_rules'], disable: ['youtube_rules'] });
  const noStream = validateSettings({ features: { streaming: false } });
  assert.deepEqual(rulesetPlan(noStream), { enable: ['default_rules', 'youtube_rules'], disable: ['streaming_rules'] });
  const off = validateSettings({ enabled: false });
  assert.deepEqual(rulesetPlan(off), { enable: [], disable: ['default_rules', 'youtube_rules', 'streaming_rules'] });
  // the skipper switch does not touch network rules
  assert.deepEqual(rulesetPlan(validateSettings({ features: { youtubeSkip: false } })), rulesetPlan(all));
});
