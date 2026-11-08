// Settings schema, validation and pure helpers.
// Everything here is pure (no chrome.* calls) so it can be unit-tested in Node.
// RULE: all data from storage, messages or imported files goes through
// validateSettings() before it is used. It never throws and never trusts input.
import { selectorProblem } from './selector.js';

export const SETTINGS_VERSION = 1;
export const MODES = Object.freeze(['default', 'allow-popups', 'aggressive', 'paused']);
export const PLACEHOLDERS = Object.freeze(['black', 'white', 'collapse']);
export const MAX_SITES = 500;
// Separately switchable protections, so a rule that breaks a site can be turned off on its own.
export const FEATURES = Object.freeze(['youtubeNetwork', 'youtubeSkip', 'streaming']);
export const MAX_CUSTOM = 200; // custom hide-this-element rules in total
export const MAX_CUSTOM_PER_SITE = 50;
export const MAX_IMPORT_BYTES = 100_000;

// Lowercase hostname with at least one dot, labels 1-63 chars, alphabetic TLD start.
// Punycode (xn--) is allowed. IP addresses, "localhost" and anything with
// slashes, spaces, ports or wildcards are rejected on purpose.
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

export function createDefaultSettings() {
  return {
    version: SETTINGS_VERSION, enabled: true, placeholder: 'collapse', sites: [], custom: [],
    features: { youtubeNetwork: true, youtubeSkip: true, streaming: true }
  };
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
  if (isPlainObject(raw.features)) {
    for (const name of FEATURES) {
      if (typeof raw.features[name] === 'boolean') out.features[name] = raw.features[name];
    }
  }

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

  // Custom "hide this element" rules the user added for a specific site.
  if (Array.isArray(raw.custom)) {
    const seen = new Set();
    const perSite = new Map();
    const limit = Math.min(raw.custom.length, MAX_CUSTOM * 4);
    for (let i = 0; i < limit && out.custom.length < MAX_CUSTOM; i++) {
      const item = raw.custom[i];
      if (!isPlainObject(item)) continue;
      const host = normalizeHost(item.host);
      if (!host || selectorProblem(item.selector) !== null) continue;
      const key = `${host}\n${item.selector}`;
      if (seen.has(key)) continue;
      const count = perSite.get(host) ?? 0;
      if (count >= MAX_CUSTOM_PER_SITE) continue;
      seen.add(key);
      perSite.set(host, count + 1);
      out.custom.push({ host, selector: item.selector });
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

/** Adds a custom hide rule for a site. Throws an error with a readable message if it is not allowed. */
export function addCustomSelector(settings, host, selector) {
  const h = normalizeHost(host);
  if (!h) throw new Error('Invalid website name');
  const text = typeof selector === 'string' ? selector.trim() : selector;
  const problem = selectorProblem(text);
  if (problem) throw new Error(`That selector is not allowed: it ${problem}`);
  const existing = settings.custom ?? [];
  if (existing.some((c) => c.host === h && c.selector === text)) return validateSettings(settings);
  if (existing.length >= MAX_CUSTOM) throw new Error('Too many custom rules');
  if (existing.filter((c) => c.host === h).length >= MAX_CUSTOM_PER_SITE) {
    throw new Error(`Too many custom rules for ${h}`);
  }
  return validateSettings({ ...settings, custom: [...existing, { host: h, selector: text }] });
}

export function removeCustomSelector(settings, host, selector) {
  const h = normalizeHost(host);
  if (!h) throw new Error('Invalid website name');
  const custom = (settings.custom ?? []).filter((c) => !(c.host === h && c.selector === selector));
  return validateSettings({ ...settings, custom });
}

/** Returns new settings with one protection switched on or off. */
export function setFeature(settings, name, value) {
  if (!FEATURES.includes(name)) throw new Error('Unknown protection');
  if (typeof value !== 'boolean') throw new Error('Bad value');
  return validateSettings({ ...settings, features: { ...settings.features, [name]: value } });
}

const MODE_LABELS = { paused: 'Paused (MAD Blocker does nothing there)', 'allow-popups': 'Pop-ups allowed', aggressive: 'Blocked more aggressively' };
const listCapped = (items, max) => (items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`);

/**
 * A short plain-text description of a settings object. The settings page shows it before an
 * imported file is applied, so a file from somebody else cannot quietly pause protection on a
 * website or hide something you need. Always returns plain strings (never HTML). Never throws.
 */
export function summarizeSettings(settings, maxRules = 8) {
  const s = validateSettings(settings);
  const lines = [`MAD Blocker: ${s.enabled ? 'on' : 'OFF'}. Ad space style: ${s.placeholder}.`];
  const off = FEATURES.filter((name) => s.features[name] === false);
  if (off.length > 0) lines.push(`Protections switched off: ${off.join(', ')}.`);
  if (s.sites.length === 0) lines.push('Websites with special settings: none.');
  for (const mode of ['paused', 'allow-popups', 'aggressive']) {
    const hosts = s.sites.filter((site) => site.mode === mode).map((site) => site.host);
    if (hosts.length > 0) lines.push(`${MODE_LABELS[mode]} (${hosts.length}): ${listCapped(hosts, 8)}`);
  }
  if (s.custom.length === 0) {
    lines.push('Custom hide rules: none.');
  } else {
    lines.push(`Custom hide rules (${s.custom.length}):`);
    for (const rule of s.custom.slice(0, maxRules)) lines.push(`  ${rule.host}: ${rule.selector}`);
    if (s.custom.length > maxRules) lines.push(`  ...and ${s.custom.length - maxRules} more`);
  }
  return lines;
}

