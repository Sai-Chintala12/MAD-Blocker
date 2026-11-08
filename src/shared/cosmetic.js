// Cosmetic filter list: validation and CSS generation. Pure, no browser APIs.
//
// Why CSS and not a script that scans the page: the browser applies CSS rules
// to every element, including ads that appear later, without any JavaScript
// running per element. That keeps CPU use close to zero and needs no
// MutationObserver. Every selector is validated first, so a bad list can never
// break out of its rule or reach into unrelated page content.
import { normalizeHost } from './settings.js';
import { selectorProblem, MAX_SELECTOR_LENGTH } from './selector.js';

export const MAX_GENERIC = 500;
export const MAX_SITES = 200;
export const MAX_PER_SITE = 50;

// The selector check lives in selector.js so settings can share it. Re-exported
// here because the bundled-list tooling and tests import it from this module.
export { selectorProblem, MAX_SELECTOR_LENGTH };

export const MODES = Object.freeze(['collapse', 'black', 'white']);

/** Returns a list of readable problems. Empty means the config is acceptable. */
export function validateCosmeticConfig(config) {
  const errors = [];
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return ['Config must be an object'];
  }

  const checkList = (name, list, max) => {
    if (!Array.isArray(list)) return errors.push(`${name} must be an array`);
    if (list.length > max) errors.push(`${name} has too many selectors (max ${max})`);
    const seen = new Set();
    list.slice(0, max).forEach((sel, i) => {
      const problem = selectorProblem(sel, { allowPseudo: true }); // the bundled list is code-reviewed and uses :has
      if (problem) errors.push(`${name}[${i}]: ${problem}`);
      else if (seen.has(sel)) errors.push(`${name}[${i}]: duplicate selector`);
      else seen.add(sel);
    });
  };

  checkList('generic', config.generic, MAX_GENERIC);
  checkList('overlays', config.overlays ?? [], MAX_GENERIC);

  const sites = config.sites ?? {};
  if (sites === null || typeof sites !== 'object' || Array.isArray(sites)) {
    errors.push('sites must be an object');
  } else {
    const hosts = Object.keys(sites);
    if (hosts.length > MAX_SITES) errors.push(`sites has too many entries (max ${MAX_SITES})`);
    for (const host of hosts.slice(0, MAX_SITES)) {
      if (normalizeHost(host) !== host) errors.push(`sites: "${host}" is not a valid lowercase host name`);
      checkList(`sites["${host}"]`, sites[host], MAX_PER_SITE);
    }
  }
  return errors;
}

/** iframe selectors for ad-network domains, so blocked frames do not leave blank holes. */
export function iframeSelectorsForDomains(domains) {
  return [...new Set(domains)].sort().map((d) => `iframe[src*="${d}/"]`);
}

export const RENDER = {
  collapse: 'display: none !important;',
  // Black and white keep the space. Background plus a colour filter turns the
  // whole ad, including cross-origin iframes, into a flat colour. Clicks are disabled.
  black: 'background: #000 !important; filter: brightness(0) !important; pointer-events: none !important;',
  white: 'background: #000 !important; filter: brightness(0) invert(1) !important; pointer-events: none !important;'
};

/**
 * One custom (user or imported) hide rule as a stylesheet rule. Used by the content script;
 * tests prove its copy produces exactly this text. ":not(body):not(html)" guarantees that a
 * custom rule can never hide the whole page, whatever the selector matches.
 */
export function customRuleCss(selector, mode) {
  return `html[data-mad="on"] :is(${selector}):not(body):not(html) { ${RENDER[mode]} }`;
}

// One plain selector list, with the prefix written in front of EVERY selector.
// Do not wrap the list in :is(...). It is shorter, but Chrome cannot index a rule whose last part
// is :is(), so it tests every selector against every element: measured on a 5,000-element page it
// cost 12.8 ms of style calculation, against 1.7 ms for the plain list (scripts/perf.mjs).
// The trade-off: in a plain list ONE selector Chrome cannot parse drops the WHOLE rule, so
// tests/cosmetic.test.js and the real-browser test check that Chrome accepts every generated rule.
const group = (prefix, selectors) => selectors.map((s) => `${prefix} ${s}`).join(',\n');

/** Builds the stylesheet. Deterministic, so the committed file can be checked against it. */
export function buildCss(config, adDomains = []) {
  const generic = [...config.generic, ...iframeSelectorsForDomains(adDomains)];
  const overlays = config.overlays ?? [];
  const sites = config.sites ?? {};
  const base = 'html[data-mad="on"]';
  const out = [
    '/* GENERATED FILE: do not edit by hand.',
    ' * Source: rules/cosmetic.json and rules/default-rules.json. Regenerate with: npm run build',
    ' * Rules only apply when page-cleanup.js has set data-mad="on" on <html>,',
    ' * which happens only while MAD Blocker is on and the site is not paused. */',
    ''
  ];

  if (overlays.length > 0) {
    out.push('/* Overlays always collapse, because a black or white overlay would cover the page. */');
    out.push(`${group(base, overlays)} {\n  ${RENDER.collapse}\n}\n`);
  }

  for (const mode of MODES) {
    out.push(`/* Ad containers, style: ${mode} */`);
    out.push(`${group(`${base}[data-mad-ph="${mode}"]`, generic)} {\n  ${RENDER[mode]}\n}\n`);
  }

  for (const host of Object.keys(sites).sort()) {
    if (sites[host].length === 0) continue;
    for (const mode of MODES) {
      out.push(`/* ${host}, style: ${mode} */`);
      out.push(`${group(`${base}[data-mad-ph="${mode}"][data-mad-host~="${host}"]`, sites[host])} {\n  ${RENDER[mode]}\n}\n`);
    }
  }
  return out.join('\n');
}

/** Ad-network domains from the bundled network rules (rule groups that block visible ads). */
export function adDomainsFromRules(rules) {
  const domains = [];
  for (const rule of rules) {
    const types = rule.condition?.resourceTypes ?? [];
    if (rule.action?.type === 'block' && types.includes('sub_frame')) {
      domains.push(...(rule.condition.requestDomains ?? []));
    }
  }
  return domains;
}
