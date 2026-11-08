import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  selectorProblem, validateCosmeticConfig, buildCss, adDomainsFromRules,
  iframeSelectorsForDomains, MAX_PER_SITE
} from '../src/shared/cosmetic.js';

const read = (p) => readFileSync(fileURLToPath(new URL('../' + p, import.meta.url)), 'utf8');
const config = JSON.parse(read('rules/cosmetic.json'));
const rules = JSON.parse(read('rules/default-rules.json'));

test('the bundled cosmetic list is valid', () => {
  assert.deepEqual(validateCosmeticConfig(config), []);
});

test('the committed stylesheet matches the lists (run "npm run build" if this fails)', () => {
  assert.equal(read('src/content/page-cleanup.css'), buildCss(config, adDomainsFromRules(rules)));
});

test('good selectors are accepted (strict mode: anything typed or imported)', () => {
  for (const s of [
    'ins.adsbygoogle', '#sidebar-ad', '[id^="div-gpt-ad"]', 'amp-ad', 'div.banner[data-slot="top"]',
    'iframe[src*="ads.example.com/"]', 'a[href*="http://ads.example.com/"]', '[class*="advert"]',
    '[data-slot=top]', '[class="a"]', ".promo[data-x='y']"
  ]) {
    assert.equal(selectorProblem(s), null, s);
  }
});

test('the bundled list may use pseudo-classes and bare attribute checks; typed or imported rules may not', () => {
  for (const s of ['ins.adsbygoogle[data-anchor-status]', 'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)']) {
    assert.equal(selectorProblem(s, { allowPseudo: true }), null, s);
    assert.notEqual(selectorProblem(s), null, s);
  }
});

test('strict mode refuses rules that can match far more than intended', () => {
  const tooMuch = [
    '.a:not(.b)', '.ad:has(img)', '.ad:is(.x)', ':root .ad', '.a::before',   // pseudo-classes and pseudo-elements
    '[data-x]', '.a[data-x]',                                                // attribute check without a value
    '[class*=a]', '[class^="ab"]', '[class*="ad"]', 'div.x[href$=".c"]',     // substring check shorter than 3 characters
    'BODY .ad', 'Body > .x', 'HTML .y'                                       // page names in any letter case
  ];
  for (const s of tooMuch) assert.notEqual(selectorProblem(s), null, s);
  // exact-value checks of any length are fine, and so are colons inside quoted values
  assert.equal(selectorProblem('[class="a"]'), null);
  assert.equal(selectorProblem('[href*="http://x.example"]'), null);
});

test('selectors that could break out of the rule or hit the whole page are refused', () => {
  const bad = [
    '} body { display:none',            // breaks out of the rule
    'a{color:red}',                      // braces
    'div.x; background:red',             // semicolon
    '.a, .b',                            // comma (one selector per entry)
    '.a\\{',                             // backslash
    '*', 'body', 'html', 'div', 'a', 'span',  // far too broad
    'body .ad', 'div > body.x', '* .ad',
    '.ad /* x */', '.ad[x="url(a)"]',    // comment marker, forbidden word
    '[id^="unclosed]', '[id="a"', '.a)', '(.a', '.a]',   // unbalanced
    ' .ad', '.ad ',                      // stray spaces
    '', 'x'.repeat(201), '.' + 'x'.repeat(200),
    '.a<script>', '@import "x"', 'a:hover{}',
    123, null, undefined, {}, []
  ];
  for (const s of bad) assert.notEqual(selectorProblem(s), null, String(s));
});

test('config validation reports bad shapes, duplicates, bad hosts and size limits', () => {
  assert.notEqual(validateCosmeticConfig(null).length, 0);
  assert.notEqual(validateCosmeticConfig([]).length, 0);
  assert.notEqual(validateCosmeticConfig({ generic: 'x' }).length, 0);
  assert.notEqual(validateCosmeticConfig({ generic: ['.ad', '.ad'] }).length, 0);
  assert.notEqual(validateCosmeticConfig({ generic: [], sites: { 'Bad Host': ['.ad'] } }).length, 0);
  assert.notEqual(validateCosmeticConfig({ generic: [], sites: { 'a.com': 'x' } }).length, 0);
  const tooMany = Array.from({ length: MAX_PER_SITE + 1 }, (_, i) => `.ad${i}`);
  assert.notEqual(validateCosmeticConfig({ generic: [], sites: { 'a.com': tooMany } }).length, 0);
  assert.deepEqual(validateCosmeticConfig({ generic: ['.ad'], overlays: [], sites: { 'a.com': ['.x1'] } }), []);
});

test('generated CSS has one rule per style and never injects unexpected text', () => {
  const css = buildCss({ generic: ['.promo'], overlays: ['.sticky-ad'], sites: { 'news.example.com': ['#top-banner'] } }, ['ads.example.net']);
  for (const mode of ['collapse', 'black', 'white']) {
    assert.ok(css.includes(`html[data-mad="on"][data-mad-ph="${mode}"] .promo`), mode);
    assert.ok(css.includes(`html[data-mad="on"][data-mad-ph="${mode}"][data-mad-host~="news.example.com"] #top-banner`), mode);
  }
  assert.ok(css.includes('iframe[src*="ads.example.net/"]'));
  // overlays must always collapse, even in black or white mode
  const overlayRule = css.split('\n\n').find((b) => b.includes('.sticky-ad'));
  assert.ok(overlayRule.includes('display: none'));
  assert.ok(!overlayRule.includes('data-mad-ph'));
  // every rule starts from the "on" attribute, so nothing applies when MAD Blocker is off or paused
  const selectorLines = css.split('\n').filter((l) => l.startsWith('html['));
  assert.ok(selectorLines.length > 0 && selectorLines.every((l) => l.startsWith('html[data-mad="on"]')));
});

test('ad iframe selectors come from blocking rules that include sub_frame', () => {
  const domains = adDomainsFromRules(rules);
  assert.ok(domains.includes('doubleclick.net'));
  assert.ok(!domains.includes('google-analytics.com'), 'tracker-only domains do not produce iframe rules');
  assert.deepEqual(iframeSelectorsForDomains(['b.com', 'a.com', 'a.com']), ['iframe[src*="a.com/"]', 'iframe[src*="b.com/"]']);
});

test('the stylesheet uses plain selector lists, never :is() (which makes Chrome 8 times slower)', () => {
  const css = read('src/content/page-cleanup.css');
  assert.ok(!css.includes(':is('), 'page-cleanup.css must not wrap its selectors in :is(). See the comment above group() in cosmetic.js');
  // every selector line starts with the on-attribute, so every selector is fully prefixed
  const selectorLines = css.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('/*') && !l.startsWith(' *') && !/^\s*(display|background|filter|pointer-events)/.test(l) && l !== '}' );
  for (const line of selectorLines) assert.ok(line.startsWith('html[data-mad="on"]'), line);
});

test('the generated stylesheet has one rule per group and every selector is listed', () => {
  const css = buildCss({ generic: ['.a1', '.a2'], overlays: ['.o1'], sites: { 'x.example.com': ['.s1', '.s2'] } }, []);
  const rules = css.split('}').filter((b) => b.includes('{')).length;
  assert.equal(rules, 1 + 3 + 3, 'one overlay rule, one per style, and one per style for the site');
  for (const mode of ['collapse', 'black', 'white']) {
    assert.ok(css.includes(`html[data-mad="on"][data-mad-ph="${mode}"] .a1,\nhtml[data-mad="on"][data-mad-ph="${mode}"] .a2 {`), mode);
  }
});
