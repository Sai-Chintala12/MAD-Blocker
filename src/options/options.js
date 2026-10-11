// Options page: manage per-site settings, export / import. textContent only.
import { MODES, MAX_IMPORT_BYTES } from '../shared/settings.js';
import { needsPopupPermission } from '../shared/popups.js';
import { requestPopupPermission } from '../shared/permissions.js';

const $ = (id) => document.getElementById(id);
const LABELS = {
  default: 'Default',
  'allow-popups': 'Allow pop-ups',
  aggressive: 'Block more aggressively',
  paused: 'Paused'
};
let settings = null;
let popupControl = 'needs-permission';

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) throw new Error((response && response.error) || 'Request failed');
  settings = response.settings;
  popupControl = response.popupControl;
}

// Asks for the optional pop-up permission when a pop-up mode is chosen.
// Call it first in a click or change handler. Throws if the user says no.
async function ensurePermissionFor(mode) {
  if (!needsPopupPermission(mode)) return;
  if (!(await requestPopupPermission())) {
    throw new Error('Pop-up control needs permission, so nothing was changed.');
  }
}

function showStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function render() {
  const body = $('sites');
  body.replaceChildren();
  const sites = [...settings.sites].sort((a, b) => a.host.localeCompare(b.host));
  $('empty').hidden = sites.length > 0;

  const usesPopupModes = sites.some((s) => needsPopupPermission(s.mode));
  const notice = $('popupNotice');
  notice.hidden = !(usesPopupModes && popupControl !== 'ready');
  notice.textContent = popupControl === 'needs-permission'
    ? 'Some sites use pop-up settings that are not active yet, because the pop-up permission was not granted. Choose a pop-up setting again and allow the request.'
    : 'Some sites use pop-up settings that are not active yet. Reload the extension in chrome://extensions.';

  for (const site of sites) {
    const tr = document.createElement('tr');

    const hostCell = document.createElement('td');
    hostCell.className = 'host';
    hostCell.textContent = site.host;

    const modeCell = document.createElement('td');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Setting for ${site.host}`);
    for (const mode of MODES.filter((m) => m !== 'default')) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = LABELS[mode];
      option.selected = mode === site.mode;
      select.append(option);
    }
    select.addEventListener('change', () => {
      const mode = select.value; // read before awaiting, keep the click gesture
      return run(async () => {
        await ensurePermissionFor(mode);
        await send({ type: 'setSiteMode', host: site.host, mode });
      });
    });
    modeCell.append(select);

    const actionCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${site.host}`);
    remove.addEventListener('click', () => run(() => send({ type: 'removeSite', host: site.host })));
    actionCell.append(remove);

    tr.append(hostCell, modeCell, actionCell);
    body.append(tr);
  }
}

async function run(action, okText = '') {
  try {
    await action();
    showStatus(okText);
  } catch (err) {
    showStatus(err instanceof Error ? err.message : 'Something went wrong', true);
  }
  render();
}

function exportSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mad-blocker-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File is too large');
  await send({ type: 'importSettings', text: await file.text() });
}

async function init() {
  await send({ type: 'getSettings' });
  render();

  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const host = $('newHost').value;
    const mode = $('newMode').value;
    run(async () => {
      await ensurePermissionFor(mode);
      await send({ type: 'setSiteMode', host, mode });
      $('newHost').value = '';
    }, 'Saved. Reload open tabs of that site for the change to apply.');
  });

  $('export').addEventListener('click', exportSettings);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    run(() => importFile(file), 'Imported.');
  });
  $('reset').addEventListener('click', () => {
    if (confirm('Remove all website settings?')) run(() => send({ type: 'resetSites' }), 'All sites removed.');
  });
}

init().catch((err) => showStatus(err instanceof Error ? err.message : 'Could not load settings', true));
