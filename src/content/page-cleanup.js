// Content script: reads settings and sets three attributes on <html>.
// The hiding itself is done by page-cleanup.css, so there is no DOM scanning,
// no MutationObserver and no CPU cost per page element. Ads inserted later are
// handled by the browser's own CSS matching.
//
//   data-mad="on"        filtering is active on this page
//   data-mad-ph="..."    ad-space style: black, white or collapse
//   data-mad-host="..."  the site's name and its parent domains, so per-site
//                        rules in the stylesheet can match (e.g. "www.a.com a.com")
//   data-mad-yt="on"     only on YouTube: in-player ad skipping may run (see youtube.js)
//
// It also applies the custom "hide this element" rules the user added for the
// current site, as one small stylesheet (still CSS, still no scanning).
//
// It reads storage only. It sends no messages, makes no network requests, and
// never reads page content, forms, cookies or passwords.
// (Content scripts cannot import ES modules, so two small pieces of shared logic
// are repeated here: the site matching from shared/popup-policy.js and the selector
// check from shared/selector.js. tests/content-script.test.js proves they agree.)
(() => {
  'use strict';

  const PLACEHOLDERS = ['black', 'white', 'collapse'];
  const MAX_CUSTOM_PER_SITE = 50;
  const root = document.documentElement;
  if (!root) return;

  // Same declarations as RENDER in shared/cosmetic.js.
  const RENDER = {
    collapse: 'display: none !important;',
    black: 'background: #000 !important; filter: brightness(0) !important; pointer-events: none !important;',
    white: 'background: #000 !important; filter: brightness(0) invert(1) !important; pointer-events: none !important;'
  };

  // Copy of the STRICT selectorProblem() in shared/selector.js. Keep them identical.
  const SAFE_CHARS = /^[A-Za-z0-9_\-.#[\]=^$*~|:>+ ()"'/%]+$/;
  const ATTRIBUTE_RE = /\[\s*([^\]=~|^$*\s]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s"']*))\s*(?:[iIsS]\s*)?)?\]/g;
  function selectorProblem(selector) {
    if (typeof selector !== 'string') return 'not a string';
    if (selector.length === 0 || selector.length > 200) return 'wrong length';
    if (selector !== selector.trim()) return 'has leading or trailing spaces';
    if (!SAFE_CHARS.test(selector)) return 'contains a character that is not allowed';
    if (selector.includes('/*') || selector.includes('*/')) return 'contains a comment marker';
    if (/url\s*\(|expression\s*\(|javascript:/i.test(selector)) return 'contains a forbidden word';
    const bare = selector.replace(/"[^"]*"|'[^']*'/g, 'Q');
    if (/["']/.test(bare)) return 'has an unclosed quote';
    let square = 0;
    let round = 0;
    for (const ch of bare) {
      if (ch === '[') square++;
      else if (ch === ']') square--;
      else if (ch === '(') round++;
      else if (ch === ')') round--;
      if (square < 0 || round < 0) return 'has unbalanced brackets';
    }
    if (square !== 0 || round !== 0) return 'has unbalanced brackets';
    if (/(^|[\s>+~(])(html|body|\*)(?![\w-])/i.test(bare)) return 'targets the whole page';
    if (!/[.#[]/.test(bare) && !/(^|[\s>+~])[a-z]+-[a-z-]+(?![\w-])/.test(bare)) {
      return 'is too broad (add a class, id or attribute)';
    }
    if (bare.includes(':')) return 'uses a pseudo-class';
    const attributes = [...selector.matchAll(ATTRIBUTE_RE)];
    if (attributes.length !== (bare.match(/\[/g) ?? []).length) return 'has an attribute check in a form that is not allowed';
    if (/data-mad/i.test(selector)) return 'refers to the extension\'s own markers';
    for (const m of attributes) {
      if (m[2] === undefined) return 'has an attribute check without a value';
      const value = m[3] ?? m[4] ?? m[5] ?? '';
      if (m[2] !== '=' && value.length < 3) return 'has a too-short attribute value';
    }
    const parts = bare.replace(/\[[^\]]*\]/g, '[]').split(/\s*[>+~]\s*|\s+/);
    if (parts.length > 5) return 'has too many parts';
    const last = parts[parts.length - 1];
    if (!/[.#[]/.test(last) && !/^[a-z][a-z0-9]*-[a-z0-9-]*$/i.test(last)) return 'must end with a class, id or attribute';
    return null;
  }

  // The site the user sees in the address bar, also for ads inside iframes.
  // Trailing dots ("example.com.") are removed, as normalizeHost does for settings.
  function topHost() {
    try {
      const origins = location.ancestorOrigins;
      const origin = origins && origins.length ? origins[origins.length - 1] : location.origin;
      return new URL(origin).hostname.toLowerCase().replace(/\.+$/, '');
    } catch {
      return location.hostname.toLowerCase().replace(/\.+$/, '');
    }
  }

  // "www.news.example.com" -> ["www.news.example.com", "news.example.com", "example.com"]
  function hostTokens(host) {
    const labels = host.split('.');
    const tokens = [];
    for (let i = 0; i < labels.length - 1; i++) tokens.push(labels.slice(i).join('.'));
    return tokens;
  }

  function isPaused(sites, host) {
    if (!Array.isArray(sites)) return false;
    let best = null;
    for (const entry of sites) {
      if (!entry || typeof entry.host !== 'string') continue;
      if (host === entry.host || host.endsWith('.' + entry.host)) {
        if (!best || entry.host.length > best.host.length) best = entry;
      }
    }
    return best !== null && best.mode === 'paused';
  }

  // --- custom rules ---------------------------------------------------------
  // Added as a constructed stylesheet, which page security policies (CSP) do not block.
  let customSheet = null;

  function removeCustomRules() {
    if (!customSheet) return;
    try {
      document.adoptedStyleSheets = Array.from(document.adoptedStyleSheets).filter((s) => s !== customSheet);
    } catch {
      // nothing to do: the sheet is already gone
    }
    customSheet = null;
  }

  function applyCustomRules(entries, host, placeholder) {
    removeCustomRules();
    if (!Array.isArray(entries)) return;
    const tokens = hostTokens(host);
    const selectors = [];
    for (const entry of entries) {
      if (selectors.length >= MAX_CUSTOM_PER_SITE) break;
      if (!entry || typeof entry.host !== 'string' || !tokens.includes(entry.host)) continue;
      if (selectorProblem(entry.selector) !== null) continue; // stored data is never trusted
      selectors.push(entry.selector);
    }
    if (selectors.length === 0) return;
    if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
    try {
      const sheet = new CSSStyleSheet();
      for (const selector of selectors) {
        try {
          sheet.insertRule(`html[data-mad="on"] :is(${selector}):not(body):not(html) { ${RENDER[placeholder]} }`);
        } catch {
          // The browser rejected this one selector. The others still apply.
        }
      }
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      customSheet = sheet;
    } catch {
      // Constructed stylesheets are unavailable here: custom rules are skipped.
    }
  }

  function apply(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const host = topHost();
    const active = s.enabled !== false && !isPaused(s.sites, host);
    const placeholder = PLACEHOLDERS.includes(s.placeholder) ? s.placeholder : 'collapse';
    if (active) {
      root.setAttribute('data-mad', 'on');
      root.setAttribute('data-mad-ph', placeholder);
      const tokens = hostTokens(host);
      root.setAttribute('data-mad-host', tokens.join(' '));
      const skipAllowed = !(s.features && s.features.youtubeSkip === false);
      if (tokens.includes('youtube.com') && skipAllowed) root.setAttribute('data-mad-yt', 'on');
      else root.removeAttribute('data-mad-yt');
      applyCustomRules(s.custom, host, placeholder);
    } else {
      root.removeAttribute('data-mad');
      root.removeAttribute('data-mad-ph');
      root.removeAttribute('data-mad-host');
      root.removeAttribute('data-mad-yt');
      removeCustomRules();
    }
    const onYouTube = hostTokens(host).includes('youtube.com');
    const pruneAllowed = 
      active && !(s.features && s.features.youtubeSkip === false);
    if (onYouTube && !pruneAllowed)
      root.setAttribute('data-mad-yt-off', '');
    else {
      root.removeAttribute('data-mad-yt-off');
    }
  }

  chrome.storage.local.get('settings').then((r) => apply(r.settings)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue);
  });
})();
