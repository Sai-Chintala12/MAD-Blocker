// Content script: reads settings and flips two attributes on <html>.
// The actual hiding is done by page-cleanup.css, so there is no DOM scanning,
// no MutationObserver and no CPU cost per page element.
//
// It reads storage only. It sends no messages, makes no network requests, and
// never touches page content, forms, cookies or passwords.
// (Content scripts cannot import ES modules, so the small matching logic from
// shared/popup-policy.js is repeated here. Keep the two in sync.)
(() => {
  'use strict';

  const PLACEHOLDERS = ['black', 'white', 'collapse'];
  const root = document.documentElement;
  if (!root) return;

  // The site the user sees in the address bar, also for ads in iframes.
  function topHost() {
    try {
      const origins = location.ancestorOrigins;
      const origin = origins && origins.length ? origins[origins.length - 1] : location.origin;
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return location.hostname.toLowerCase();
    }
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

  function apply(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const active = s.enabled !== false && !isPaused(s.sites, topHost());
    const placeholder = PLACEHOLDERS.includes(s.placeholder) ? s.placeholder : 'collapse';
    if (active) {
      root.setAttribute('data-mad', 'on');
      root.setAttribute('data-mad-ph', placeholder);
    } else {
      root.removeAttribute('data-mad');
      root.removeAttribute('data-mad-ph');
    }
  }

  chrome.storage.local.get('settings').then((r) => apply(r.settings)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue);
  });
})();
