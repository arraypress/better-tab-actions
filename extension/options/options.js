import { ABOUT_LINKS } from './about-links.js';
import { ACTIONS, menuTitle } from '../shared/actions.js';
import { changedSettings, loadSettings, normalizeSettings, settingsSaver } from '../shared/settings.js';
import { setShortcuts } from './shortcuts.js';
import { watchColorScheme } from '../shared/toolbar-scheme.js';

const storage = chrome.storage;
const $ = (id) => document.getElementById(id);

// The toolbar glyph follows this page's light or dark scheme (toolbar-theme.js).
watchColorScheme().catch((error) => console.debug('Reporting the colour scheme:', error));

let settings = await loadSettings(storage);
// Changes show at once and are written once the clicks stop (Chrome Sync allows 120 writes a minute).
const saver = settingsSaver(storage, { onSaved: showSaved });

function row(labelText, control) {
  const label = document.createElement('label');
  label.className = 'row';
  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = labelText;
  label.append(text, control);
  return label;
}

/** One switch per action, in menu order, all in the Menu card. */
function renderMenuItems() {
  const list = $('menu-items');
  list.replaceChildren();
  for (const action of ACTIONS) {
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'switch';
    toggle.setAttribute('role', 'switch');
    toggle.checked = !settings.hiddenActions.includes(action.id);
    toggle.addEventListener('change', () => {
      const hidden = new Set(settings.hiddenActions);
      toggle.checked ? hidden.delete(action.id) : hidden.add(action.id);
      save({ hiddenActions: [...hidden] });
    });
    list.append(row(menuTitle(action, settings), toggle));
  }
}

/**
 * The shortcuts that are set, straight from Chrome, then the link row to
 * chrome://extensions/shortcuts (where they're changed). With none set, the
 * link row says so.
 */
async function renderShortcuts() {
  // "Switch to last used tab" is a shortcut only (no menu item), listed first like on Chrome's page.
  const shortcuts = setShortcuts([{ id: 'switch-last-tab', title: 'Switch to last used tab' }, ...ACTIONS], await chrome.commands.getAll());
  $('shortcuts').replaceChildren(...shortcuts.map(({ title, shortcut }) => {
    const div = document.createElement('div');
    div.className = 'row';
    const text = document.createElement('span');
    text.className = 'label';
    text.textContent = title;
    const key = document.createElement('span');
    key.className = 'row-value';
    key.textContent = shortcut;
    div.append(text, key);
    return div;
  }));
  $('edit-shortcuts').classList.toggle('first', shortcuts.length === 0);
  $('no-shortcuts').hidden = shortcuts.length > 0;
}

let statusTimer;
function save(changes) {
  settings = normalizeSettings({ ...settings, ...changes });
  saver.save(changes);
  renderMenuItems(); // Titles can depend on settings (e.g. the number of days).
}

function showSaved() {
  const status = $('status');
  status.textContent = 'Saved';
  status.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.classList.remove('show'), 1500);
}

function renderForm() {
  $('windowScope').value = settings.windowScope;
  $('inactiveDays').value = settings.inactiveDays;
  $('includeGroupedTabs').checked = settings.includeGroupedTabs;
}

$('windowScope').addEventListener('change', (e) => save({ windowScope: e.target.value }));
$('includeGroupedTabs').addEventListener('change', (e) => save({ includeGroupedTabs: e.target.checked }));
$('inactiveDays').addEventListener('change', (e) => {
  save({ inactiveDays: e.target.value });
  e.target.value = settings.inactiveDays; // Show the clamped value.
});
$('edit-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Shortcuts may be changed in another tab; refresh when the user comes back. Leaving the page
// writes any change still waiting.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderShortcuts();
  else saver.flush();
});
addEventListener('pagehide', () => saver.flush());

// Settings can change without this page: from another computer, through sync, or in another tab.
// Changes made here and not yet written stay on top.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (!changedSettings(changes, area).length) return;
  settings = normalizeSettings({ ...(await loadSettings(storage)), ...saver.pending });
  renderForm();
  renderMenuItems();
});

/** About card: the version Chrome loaded, and the links from about-links.js. */
function renderAbout() {
  $('version').textContent = `Version ${chrome.runtime.getManifest().version}`;
  $('help').href = ABOUT_LINKS.help;
  $('report-issue').href = ABOUT_LINKS.reportIssue;
  $('privacy-policy').href = ABOUT_LINKS.privacyPolicy;
}

renderForm();
renderMenuItems();
renderShortcuts();
renderAbout();
