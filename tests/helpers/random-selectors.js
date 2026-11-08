// Seeded random inputs for the fuzz tests and the real-browser property test. Deterministic:
// the same seed always gives the same sequence, so a failure can be reproduced.

export const SEED = 20261018;
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, list) => list[Math.floor(r() * list.length)];

// --- random selectors --------------------------------------------------------------------------

const TOKENS = [
  '.', '#', 'a', 'ad', 'ads', 'banner', 'div', 'span', 'body', 'html', 'BODY', 'Html', '*', ' ', ' ', '>', '+', '~',
  '[', ']', '(', ')', '"', "'", '=', '^=', '$=', '*=', '~=', '|=', '^', '$', '|', ':', '::', ':not(', ':has(', ':is(', ':root',
  '-', '_', '{', '}', ';', ',', '\\', '/', '/*', '*/', '@', 'url(', 'expression(', 'javascript:', '<', '>', '\n', '\t', '\0',
  'x', 'data-x', 'class', 'id', 'href', 'src', '0', '9', 'é', 'amp-ad', 'google_ads', 'div-gpt-ad', ' i', ' s'
];
const SEEDS = [
  'ins.adsbygoogle', '#sidebar-ad', '[id^="div-gpt-ad"]', 'amp-ad', 'div.banner[data-slot="top"]',
  'iframe[src*="ads.example.com/"]', '.promo[data-x=\'y\']', '[class*="advert"]', 'div > .promo', '.a + .b'
];

export function randomSelector(r) {
  const mode = r();
  if (mode < 0.5) {
    let s = '';
    const n = 1 + Math.floor(r() * 12);
    for (let i = 0; i < n; i++) s += pick(r, TOKENS);
    return s;
  }
  // mutate a good selector a few times: insert, delete or replace pieces
  let s = pick(r, SEEDS);
  const edits = 1 + Math.floor(r() * 3);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(r() * (s.length + 1));
    const kind = r();
    if (kind < 0.4) s = s.slice(0, at) + pick(r, TOKENS) + s.slice(at);
    else if (kind < 0.7) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(r() * 3));
    else s = s.slice(0, at) + pick(r, TOKENS) + s.slice(at + 1);
  }
  return s;
}
