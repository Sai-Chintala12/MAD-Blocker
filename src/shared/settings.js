// Settings schema, validation and pure helpers.
// Everything here is pure (no chrome.* calls) so it can be unit-tested in Node.
// RULE: all data from storage, messages or imported files goes through
// validateSettings() before it is used. It never throws and never trusts input.

export const SETTINGS_VERSION = 1;
export const MODES = Object.freeze(['default', 'allow-popups', 'aggressive', 'paused']);
export const PLACEHOLDERS = Object.freeze(['black', 'white', 'collapse']);
export const MAX_SITES = 500;
export const MAX_IMPORT_BYTES = 100_000;

// Lowercase hostname with at least one dot, labels 1-63 chars, alphabetic TLD start.
// Punycode (xn--) is allowed. IP addresses, "localhost" and anything with
// slashes, spaces, ports or wildcards are rejected on purpose.
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

export function createDefaultSettings() {
  return { version: SETTINGS_VERSION, enabled: true, placeholder: 'collapse', sites: [] };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Returns a normalized hostname, or null if the input is not a valid host. */
export function normalizeHost(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.length === 0 || s.length > 2048) return null;
  if (s.includes('://')) {
    try {
      const url = new URL(s);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      s = url.hostname;
    } catch {
      return null;
    }
  }
  if (s.endsWith('.')) s = s.slice(0, -1);
  return HOST_RE.test(s) ? s : null;
}

/** Builds a clean settings object from untrusted input. Never throws. */
export function validateSettings(raw) {
  const out = createDefaultSettings();
  if (!isPlainObject(raw)) return out;

  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (PLACEHOLDERS.includes(raw.placeholder)) out.placeholder = raw.placeholder;

  if (Array.isArray(raw.sites)) {
    const seen = new Set();
    const limit = Math.min(raw.sites.length, MAX_SITES * 4);
    for (let i = 0; i < limit && out.sites.length < MAX_SITES; i++) {
      const item = raw.sites[i];
      if (!isPlainObject(item)) continue;
      const host = normalizeHost(item.host);
      if (!host || seen.has(host)) continue;
      if (!MODES.includes(item.mode) || item.mode === 'default') continue;
      seen.add(host);
      out.sites.push({ host, mode: item.mode });
    }
  }
  return out;
}

/** Returns new settings with the site's mode changed. 'default' removes the entry. */
export function setSiteMode(settings, host, mode) {
  const h = normalizeHost(host);
  if (!h) throw new Error('Invalid website name');
  if (!MODES.includes(mode)) throw new Error('Invalid mode');
  const sites = settings.sites.filter((s) => s.host !== h);
  if (mode !== 'default') {
    if (sites.length >= MAX_SITES) throw new Error('Too many site settings');
    sites.push({ host: h, mode });
  }
  return validateSettings({ ...settings, sites });
}

export function removeSite(settings, host) {
  return setSiteMode(settings, host, 'default');
}

/** Parses an imported settings file. Size-capped, JSON-only, then validated. */
export function parseImport(text) {
  if (typeof text !== 'string') return { ok: false, error: 'Not a text file' };
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'File is too large' };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'File is not valid JSON' };
  }
  if (!isPlainObject(data)) return { ok: false, error: 'Unexpected file format' };
  return { ok: true, settings: validateSettings(data) };
}
