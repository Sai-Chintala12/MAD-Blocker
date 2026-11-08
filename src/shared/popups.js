// Pop-up handling policy. Pure and unit-tested.
//
// How it works (and why it is honest about limits):
// Chrome has no event that tells an extension "this pop-up was unwanted". So
// MAD Blocker does not guess. It uses Chrome's own pop-up blocker and tells it,
// per site, what you decided:
//   Default       -> nothing is changed, Chrome's normal pop-up blocker decides
//   Allow pop-ups -> Chrome is told to allow pop-ups for that site
//   Aggressive    -> Chrome's pop-up blocker is forced on for that site (even if the
//                    user allowed pop-ups everywhere), and extra rules block well-known
//                    pop-under script and frame URLs. Chrome's blocker never stops a
//                    pop-up the user opened with a click, so logins and payments work.
//   Paused        -> MAD Blocker steps aside completely (see rules.js)
//
// Changing Chrome's pop-up setting needs the optional "contentSettings"
// permission, which is requested only when you first choose one of these modes.

export const POPUP_PERMISSION = 'contentSettings';

export function needsPopupPermission(mode) {
  return mode === 'allow-popups' || mode === 'aggressive';
}

/**
 * Returns the Chrome pop-up settings to apply, as
 * [{ pattern, setting: 'allow' | 'block' }]. Patterns are built only from
 * hosts that already passed validation, with explicit http and https schemes.
 */
export function planPopupSettings(settings) {
  if (!settings.enabled) return [];
  const plan = [];
  const allowing = settings.sites.filter((s) => s.mode === 'allow-popups');
  for (const site of settings.sites) {
    let setting = null;
    if (site.mode === 'allow-popups') setting = 'allow';
    else if (site.mode === 'aggressive') setting = 'block';
    else if (site.mode === 'paused' && allowing.some((p) => site.host.endsWith('.' + p.host))) {
      // Chrome applies a parent's "*.parent.com" pattern to every subdomain. A paused subdomain
      // must not inherit "allow", so it gets Chrome's own default (the blocker on). Under an
      // aggressive parent nothing is needed: that already is "block".
      setting = 'block';
    }
    if (!setting) continue;
    for (const scheme of ['http', 'https']) {
      plan.push({ pattern: `${scheme}://${site.host}/*`, setting });
      plan.push({ pattern: `${scheme}://*.${site.host}/*`, setting });
    }
  }
  return plan;
}
