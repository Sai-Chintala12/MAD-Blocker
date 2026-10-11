// MAD Blocker background service worker (event-driven, no timers, no network calls).
import {
  validateSettings, setSiteMode, removeSite, normalizeHost, parseImport,
  createDefaultSettings, PLACEHOLDERS, MODES
} from '../shared/settings.js';
import { buildDynamicRules } from '../shared/rules.js';
import { planPopupSettings, POPUP_PERMISSION } from '../shared/popups.js';

const STORAGE_KEY = 'settings';
const RULESET_ID = 'default_rules';

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return validateSettings(stored[STORAGE_KEY]);
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

// 'ready' | 'needs-permission' | 'unavailable'
async function popupControlState() {
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ permissions: [POPUP_PERMISSION] });
  } catch {
    granted = false;
  }
  if (!granted) return 'needs-permission';
  return chrome.contentSettings && chrome.contentSettings.popups ? 'ready' : 'unavailable';
}

// Tell Chrome's own pop-up blocker what the user decided for each site.
async function applyPopupSettings(settings) {
  if ((await popupControlState()) !== 'ready') return;
  await chrome.contentSettings.popups.clear({ scope: 'regular' }); // removes only our own rules
  for (const { pattern, setting } of planPopupSettings(settings)) {
    try {
      await chrome.contentSettings.popups.set({ primaryPattern: pattern, setting, scope: 'regular' });
    } catch {
      // Skip a pattern Chrome refuses; the rest still apply.
    }
  }
}

// Push settings into Chrome's native network filtering and pop-up blocker.
async function applySettings(settings) {
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    settings.enabled
      ? { enableRulesetIds: [RULESET_ID] }
      : { disableRulesetIds: [RULESET_ID] }
  );
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: buildDynamicRules(settings)
  });
  await applyPopupSettings(settings);
}

// All changes run one at a time so quick clicks cannot overwrite each other.
let queue = Promise.resolve();
function change(mutator) {
  const run = queue.then(async () => {
    const next = validateSettings(mutator(await loadSettings()));
    await saveSettings(next);
    await applySettings(next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

async function handle(message) {
  if (message === null || typeof message !== 'object') throw new Error('Bad request');
  switch (message.type) {
    case 'getSettings':
      return await loadSettings();
    case 'setEnabled':
      if (typeof message.value !== 'boolean') throw new Error('Bad value');
      return await change((s) => ({ ...s, enabled: message.value }));
    case 'setPlaceholder':
      if (!PLACEHOLDERS.includes(message.value)) throw new Error('Bad value');
      return await change((s) => ({ ...s, placeholder: message.value }));
    case 'setSiteMode': {
      const host = normalizeHost(message.host);
      if (!host || !MODES.includes(message.mode)) throw new Error('Bad value');
      return await change((s) => setSiteMode(s, host, message.mode));
    }
    case 'removeSite': {
      const host = normalizeHost(message.host);
      if (!host) throw new Error('Bad value');
      return await change((s) => removeSite(s, host));
    }
    case 'resetSites':
      return await change((s) => ({ ...s, sites: [] }));
    case 'importSettings': {
      const parsed = parseImport(message.text);
      if (!parsed.ok) throw new Error(parsed.error);
      return await change(() => parsed.settings);
    }
    default:
      throw new Error('Unknown request');
  }
}

// Only MAD Blocker's own pages (popup, options) may talk to this worker.
// Web pages cannot message it: the manifest has no externally_connectable.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const ownPage = sender.id === chrome.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''));
  if (!ownPage) return false;

  handle(message)
    .then(async (settings) => sendResponse({ ok: true, settings, popupControl: await popupControlState() }))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Failed' }));
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] ? validateSettings(stored[STORAGE_KEY]) : createDefaultSettings();
  await saveSettings(settings);
  await applySettings(settings);
});

chrome.runtime.onStartup.addListener(async () => {
  await applySettings(await loadSettings());
});

// When the user grants the pop-up permission, apply the saved choices right away.
chrome.permissions.onAdded.addListener(async () => {
  try {
    await applySettings(await loadSettings());
  } catch {
    // Ignore: the next settings change will apply them.
  }
});
