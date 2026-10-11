// Validates rule lists (bundled today, downloaded filter lists in the future)
// BEFORE they are used. Deliberately strict: least privilege for rules.
//  - no regexFilter (regex can be slow or abusive)
//  - no redirect / modifyHeaders / upgradeScheme actions
//  - block rules must be targeted and may never block top-level page loads
import { normalizeHost } from './settings.js';

export const MAX_RULES = 5000;
export const MAX_DOMAINS_PER_RULE = 1000;
export const MAX_URL_FILTER_LENGTH = 200;

const ACTIONS = ['block', 'allow', 'allowAllRequests'];
const RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'
];
const CONDITION_KEYS = [
  'urlFilter', 'requestDomains', 'excludedRequestDomains', 'initiatorDomains',
  'excludedInitiatorDomains', 'resourceTypes', 'excludedResourceTypes', 'domainType'
];
const DOMAIN_KEYS = [
  'requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains'
];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Returns a list of human-readable problems. Empty list means the rules are acceptable. */
export function validateRuleList(rules) {
  const errors = [];
  if (!Array.isArray(rules)) return ['Rules must be an array'];
  if (rules.length > MAX_RULES) errors.push(`Too many rules (max ${MAX_RULES})`);

  const ids = new Set();
  rules.slice(0, MAX_RULES).forEach((rule, i) => {
    const at = `rule[${i}]`;
    if (!isObj(rule)) return errors.push(`${at}: not an object`);

    if (!Number.isInteger(rule.id) || rule.id < 1) errors.push(`${at}: id must be a positive integer`);
    else if (ids.has(rule.id)) errors.push(`${at}: duplicate id ${rule.id}`);
    else ids.add(rule.id);

    if (!Number.isInteger(rule.priority) || rule.priority < 1) errors.push(`${at}: priority must be a positive integer`);

    const type = isObj(rule.action) ? rule.action.type : undefined;
    if (!ACTIONS.includes(type)) errors.push(`${at}: action type "${String(type)}" is not allowed`);

    const cond = rule.condition;
    if (!isObj(cond)) return errors.push(`${at}: condition missing`);

    for (const key of Object.keys(cond)) {
      if (!CONDITION_KEYS.includes(key)) errors.push(`${at}: condition key "${key}" is not allowed`);
    }

    for (const key of DOMAIN_KEYS) {
      if (cond[key] === undefined) continue;
      if (!Array.isArray(cond[key]) || cond[key].length === 0 || cond[key].length > MAX_DOMAINS_PER_RULE) {
        errors.push(`${at}: ${key} must be a non-empty array (max ${MAX_DOMAINS_PER_RULE})`);
        continue;
      }
      for (const d of cond[key]) {
        if (normalizeHost(d) !== d) errors.push(`${at}: invalid domain in ${key}`);
      }
    }

    for (const key of ['resourceTypes', 'excludedResourceTypes']) {
      if (cond[key] === undefined) continue;
      if (!Array.isArray(cond[key]) || !cond[key].every((t) => RESOURCE_TYPES.includes(t))) {
        errors.push(`${at}: invalid ${key}`);
      }
    }

    if (cond.urlFilter !== undefined) {
      if (typeof cond.urlFilter !== 'string' || cond.urlFilter.length === 0 || cond.urlFilter.length > MAX_URL_FILTER_LENGTH) {
        errors.push(`${at}: urlFilter must be a string up to ${MAX_URL_FILTER_LENGTH} characters`);
      } else if (/^[|*^]*$/.test(cond.urlFilter)) {
        errors.push(`${at}: urlFilter is too broad`);
      }
    }

    if (type === 'block') {
      if (!Array.isArray(cond.resourceTypes) || cond.resourceTypes.length === 0) {
        errors.push(`${at}: block rules must list resourceTypes`);
      } else if (cond.resourceTypes.includes('main_frame')) {
        errors.push(`${at}: block rules must not block main_frame (page navigation)`);
      }
      if (!cond.urlFilter && !cond.requestDomains && !cond.initiatorDomains) {
        errors.push(`${at}: block rules must be targeted (urlFilter, requestDomains or initiatorDomains)`);
      }
    }
  });
  return errors;
}
