// Decides how MAD Blocker should treat a website. Pure and unit-tested.
//
// Phase 1 only acts on "paused". "allow-popups" and "aggressive" are stored and
// reported here so the UI and tests are ready; they take effect in Phase 3.

/** Most specific site entry that matches `host` (exact or parent domain). */
export function findSiteEntry(settings, host) {
  if (typeof host !== 'string' || host === '') return null;
  let best = null;
  for (const entry of settings.sites) {
    if (host === entry.host || host.endsWith('.' + entry.host)) {
      if (!best || entry.host.length > best.host.length) best = entry;
    }
  }
  return best;
}

export function getSitePolicy(settings, host) {
  if (!settings.enabled) return { filtering: false, popups: 'browser', reason: 'disabled' };
  const entry = findSiteEntry(settings, host);
  switch (entry ? entry.mode : 'default') {
    case 'paused':
      return { filtering: false, popups: 'browser', reason: 'paused' };
    case 'allow-popups':
      return { filtering: true, popups: 'allow', reason: 'allow-popups' };
    case 'aggressive':
      return { filtering: true, popups: 'strict', reason: 'aggressive' };
    default:
      return { filtering: true, popups: 'default', reason: 'default' };
  }
}
