// Builds the dynamic (per-site) network rules from settings. Pure and testable.
import { MAX_SITES } from './settings.js';

export const ALLOW_RULE_PRIORITY = 100; // must be higher than static block rules (priority 1)
export const AGGRESSIVE_RULE_PRIORITY = 2;
export const AGGRESSIVE_BASE_ID = 1000; // allow rules use ids 1..MAX_SITES, so these never collide

// URL fragments that pop-under and click-under ad scripts commonly use.
// Deliberately narrow, to avoid breaking real sites.
export const AGGRESSIVE_URL_FILTERS = Object.freeze(['/popunder', '/pop-under', '/clickunder']);

/**
 * For every paused site, an "allowAllRequests" rule lets all requests made by
 * that site's pages through. Chrome evaluates it when the page loads, so the
 * page must be reloaded after the setting changes.
 */
export function buildAllowRules(settings) {
  const rules = [];
  for (const site of settings.sites) {
    if (site.mode !== 'paused') continue;
    if (rules.length >= MAX_SITES) break;
    rules.push({
      id: rules.length + 1,
      priority: ALLOW_RULE_PRIORITY,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: [site.host], resourceTypes: ['main_frame', 'sub_frame'] }
    });
  }
  return rules;
}

/**
 * Extra blocking only for sites set to "Block more aggressively": scripts and
 * frames whose URL looks like a pop-under, requested by those sites' pages.
 */
export function buildAggressiveRules(settings) {
  const hosts = settings.sites.filter((s) => s.mode === 'aggressive').map((s) => s.host).slice(0, MAX_SITES);
  if (hosts.length === 0) return [];
  return AGGRESSIVE_URL_FILTERS.map((urlFilter, i) => ({
    id: AGGRESSIVE_BASE_ID + i,
    priority: AGGRESSIVE_RULE_PRIORITY,
    action: { type: 'block' },
    condition: { urlFilter, initiatorDomains: hosts, resourceTypes: ['script', 'sub_frame'] }
  }));
}

/** Everything that goes into Chrome's dynamic rule set. Nothing when MAD Blocker is off. */
export function buildDynamicRules(settings) {
  if (!settings.enabled) return [];
  return [...buildAllowRules(settings), ...buildAggressiveRules(settings)];
}
