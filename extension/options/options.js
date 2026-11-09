/**
 * The options page: which actions the menu shows, the saved workspaces
 * (workspaces-section.js) and whether their groups reopen, how closing works
 * (automatic closing and its never-close sites, keep-sites.js, included), the
 * keyboard shortcuts that are set, and the About card. Changes show at
 * once and are written once the clicks stop (Chrome Sync allows 120 writes a
 * minute).
 *
 * @module options/options
 */

import {
  byId, createSettingsSaver, setAboutLinks, setShortcuts, statusFlasher, valueRow, watchColorScheme,
} from '../vendor/extension-kit/index.js';
import { ABOUT_LINKS } from './about-links.js';
import { ACTIONS, menuTitle } from '../shared/actions.js';
import { AUTO_CLOSE_HOURS, normalizeSettings, settingsStore } from '../shared/settings.js';
import { duration } from '../shared/text.js';
import { renderSites, startSites } from './keep-sites.js';
import { startWorkspaces } from './workspaces-section.js';

/** @import { Settings } from '../shared/settings.js' */

const windowScope = byId('windowScope', HTMLSelectElement);
const inactiveDays = byId('inactiveDays', HTMLInputElement);
const includeGroupedTabs = byId('includeGroupedTabs', HTMLInputElement);
const reopenGroups = byId('reopenGroups', HTMLInputElement);
const autoClose = byId('autoClose', HTMLInputElement);
const autoCloseHours = byId('autoCloseHours', HTMLSelectElement);
autoCloseHours.append(...AUTO_CLOSE_HOURS.map((hours) => new Option(duration(hours), String(hours))));

// The toolbar glyph follows this page's light or dark scheme.
watchColorScheme(chrome).catch((error) => console.debug('Reporting the colour scheme:', error));

let settings = await settingsStore.load(chrome.storage);
const flash = statusFlasher(byId('status'), 1500);
const saver = createSettingsSaver(settingsStore, chrome.storage, { onSaved: () => flash('Saved') });

/**
 * A settings row: a label and its control.
 *
 * @param {string} labelText - What the row says.
 * @param {HTMLElement} control - Its switch.
 * @returns {HTMLLabelElement} The row.
 */
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
  const list = byId('menu-items');
  list.replaceChildren();
  for (const action of ACTIONS) {
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'switch';
    toggle.setAttribute('role', 'switch');
    toggle.checked = !settings.hiddenActions.includes(action.id);
    toggle.addEventListener('change', () => {
      const hidden = new Set(settings.hiddenActions);
      if (toggle.checked) hidden.delete(action.id);
      else hidden.add(action.id);
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
  byId('shortcuts').replaceChildren(...shortcuts.map(({ title, shortcut }) => valueRow(title, shortcut)));
  byId('edit-shortcuts').classList.toggle('first', shortcuts.length === 0);
  byId('no-shortcuts').hidden = shortcuts.length > 0;
}

/**
 * Apply `changes` here at once, and queue them for storage.
 *
 * @param {Partial<Record<keyof Settings, unknown>>} changes - Raw values; normalised on the way.
 */
function save(changes) {
  settings = normalizeSettings({ ...settings, ...changes });
  saver.save(/** @type {Partial<Settings>} */ (changes));
  renderMenuItems(); // Titles can depend on settings (e.g. the number of days).
  renderForm();
}

/** Show the settings in the Closing tabs and Workspaces cards' controls. */
function renderForm() {
  windowScope.value = settings.windowScope;
  inactiveDays.value = String(settings.inactiveDays);
  includeGroupedTabs.checked = settings.includeGroupedTabs;
  reopenGroups.checked = settings.reopenGroups;
  autoClose.checked = settings.autoClose;
  autoCloseHours.value = String(settings.autoCloseHours);
  byId('auto-close-options').hidden = !settings.autoClose;
  renderSites(settings.keepSites);
}

windowScope.addEventListener('change', () => save({ windowScope: windowScope.value }));
includeGroupedTabs.addEventListener('change', () => save({ includeGroupedTabs: includeGroupedTabs.checked }));
reopenGroups.addEventListener('change', () => save({ reopenGroups: reopenGroups.checked }));
autoClose.addEventListener('change', () => save({ autoClose: autoClose.checked }));
autoCloseHours.addEventListener('change', () => save({ autoCloseHours: autoCloseHours.value }));
startSites(() => settings, (keepSites) => save({ keepSites }));
byId('memory-saver').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://settings/performance' });
});
inactiveDays.addEventListener('change', () => {
  save({ inactiveDays: inactiveDays.value });
  inactiveDays.value = String(settings.inactiveDays); // Show the clamped value.
});
byId('edit-shortcuts').addEventListener('click', () => {
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
  if (!settingsStore.changed(changes, area).length) return;
  settings = normalizeSettings({ ...(await settingsStore.load(chrome.storage)), ...saver.pending });
  renderForm();
  renderMenuItems();
});

// About card: the version Chrome loaded, and the links from about-links.js.
byId('version').textContent = `Version ${chrome.runtime.getManifest().version}`;
setAboutLinks(ABOUT_LINKS);

renderForm();
renderMenuItems();
renderShortcuts();
startWorkspaces(() => settings);
