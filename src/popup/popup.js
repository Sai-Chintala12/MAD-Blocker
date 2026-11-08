// Toolbar popup. Uses textContent only (never innerHTML) and talks to the
// service worker through validated messages.
import { findSiteEntry, getSitePolicy } from '../shared/popup-policy.js';
import { normalizeHost } from '../shared/settings.js';
import { needsPopupPermission } from '../shared/popups.js';
import { requestPopupPermission } from '../shared/permissions.js';

const $ = (id) => document.getElementById(id);
let settings = null;
let popupControl = 'needs-permission';
let host = null;
let tabId = null;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) throw new Error((response && response.error) || 'Request failed');
  settings = response.settings;
  popupControl = response.popupControl;
  return settings;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return { host: null, tabId: null };
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { host: null, tabId: null };
    return { host: normalizeHost(url.hostname), tabId: typeof tab.id === 'number' ? tab.id : null };
  } catch {
    return { host: null, tabId: null };
  }
}

// On YouTube, shows real numbers from the page: ad breaks handled, or a warning if it gave up.
async function showYoutubeStatus() {
  const note = $('ytNote');
  note.hidden = true;
  note.classList.remove('error');
  const onYoutube = host === 'youtube.com' || (host !== null && host.endsWith('.youtube.com'));
  if (!onYoutube || tabId === null || !settings.enabled || getSitePolicy(settings, host).filtering === false) return;

  if (!settings.features.youtubeSkip) {
    note.textContent = 'YouTube ad skipping is switched off (settings page, Protections).';
    note.hidden = false;
    return;
  }
  try {
    const status = await chrome.tabs.sendMessage(tabId, { type: 'ytStatus' });
    if (!status || status.ok !== true) return;
    if (status.gaveUp) {
      note.textContent = 'Ad skipping paused on this page because playback looked stuck. If videos will not play, pause MAD Blocker on this site or switch off YouTube ad skipping in the settings page.';
      note.classList.add('error');
    } else {
      note.textContent = `Ad breaks skipped on this page: ${Number.isInteger(status.adBreaks) ? status.adBreaks : 0}`;
    }
    note.hidden = false;
  } catch {
    // The page has no YouTube script running (not loaded yet). Show nothing.
  }
}

function showStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function describe(entry) {
  if (!settings.enabled) return 'MAD Blocker is off everywhere.';
  const parts = [];
  if (entry && entry.host !== host) {
    parts.push(`This setting comes from ${entry.host} and covers its subdomains.`);
  }
  const mode = entry ? entry.mode : 'default';
  if (mode === 'paused') parts.push('Paused here. Reload the page to apply.');
  if (mode === 'allow-popups') parts.push('Pop-ups from this site are allowed. Ads are still blocked.');
  if (mode === 'aggressive') parts.push("Chrome's pop-up blocker is kept on here, with extra pop-under rules. Pop-ups from your own clicks still open.");
  if (needsPopupPermission(mode) && popupControl !== 'ready') {
    parts.push(popupControl === 'needs-permission'
      ? 'Not active yet: pop-up permission was not granted.'
      : 'Not active yet: reload the extension in chrome://extensions.');
  }
  return parts.join(' ');
}

function render() {
  $('enabled').checked = settings.enabled;
  for (const radio of document.querySelectorAll('input[name="placeholder"]')) {
    radio.checked = radio.value === settings.placeholder;
  }

  const select = $('siteMode');
  const note = $('modeNote');

  if (!host) {
    $('host').textContent = 'MAD Blocker does not run on this page.';
    select.disabled = true;
    select.value = 'default';
    note.textContent = '';
    $('summary').textContent = settings.enabled ? 'Active' : 'Off';
    return;
  }

  const entry = findSiteEntry(settings, host);
  const policy = getSitePolicy(settings, host);
  $('host').textContent = host;
  select.disabled = !settings.enabled;
  select.value = entry ? entry.mode : 'default';
  note.textContent = describe(entry);

  if (!settings.enabled) $('summary').textContent = 'Off';
  else if (policy.reason === 'paused') $('summary').textContent = 'Paused on this site';
  else $('summary').textContent = 'Active on this site';
}

async function run(action) {
  try {
    await action();
    showStatus('');
  } catch (err) {
    showStatus(err instanceof Error ? err.message : 'Something went wrong', true);
  }
  render();
}

async function init() {
  ({ host, tabId } = await getActiveTab());
  await send({ type: 'getSettings' });
  render();
  await showYoutubeStatus();

  $('enabled').addEventListener('change', (e) =>
    run(() => send({ type: 'setEnabled', value: e.target.checked })));

  for (const radio of document.querySelectorAll('input[name="placeholder"]')) {
    radio.addEventListener('change', (e) =>
      run(() => send({ type: 'setPlaceholder', value: e.target.value })));
  }

  $('siteMode').addEventListener('change', async (e) => {
    // (the YouTube note is refreshed after the change below)
    const mode = e.target.value;
    const entry = findSiteEntry(settings, host);
    const target = entry ? entry.host : host; // edit the rule that actually applies

    // Must be the first await in this handler so Chrome still sees the user's click.
    if (needsPopupPermission(mode)) {
      const granted = await requestPopupPermission();
      if (!granted) {
        showStatus('Pop-up control needs permission, so nothing was changed.', true);
        render();
        return;
      }
    }
    await run(() => send({ type: 'setSiteMode', host: target, mode }));
    await showYoutubeStatus();
  });

  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

init().catch((err) => showStatus(err instanceof Error ? err.message : 'Could not load settings', true));
