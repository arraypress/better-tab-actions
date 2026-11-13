/**
 * The options page: which actions the menu shows, the saved workspaces
 * (workspaces-section.js) and whether their groups reopen, the snapshots
 * (snapshots-section.js) and whether they're taken automatically, how closing works
 * (automatic closing and its never-close sites, the kit's site list), the
 * keyboard shortcuts that are set, and the About card. Changes show at
 * once and are written once the clicks stop (Chrome Sync allows 120 writes a
 * minute).
 *
 * @module options/options
 */

import {
  byId, createSettingsSaver, createSiteList, make, setAboutLinks, setShortcuts, setUpPage, siteHost, statusFlasher,
  valueRow, withoutSite, withSite, withSiteReplaced,
} from '../vendor/extension-kit/index.js';
import { ABOUT_LINKS } from './about-links.js';
import { ACTIONS, GROUPS, MENU_MESSAGE, menuTitle, SWITCH_LAST, SWITCH_LAST_MESSAGE } from '../shared/actions.js';
import { AUTO_CLOSE_HOURS, normalizeSettings, settingsStore, SNAPSHOT_MINUTES } from '../shared/settings.js';
import { MAX_AUTO } from '../shared/snapshots.js';
import { duration, minutesText } from '../shared/text.js';
import { MAX_WORKSPACES } from '../shared/workspaces.js';
import { startSnapshots } from './snapshots-section.js';
import { startWorkspaces } from './workspaces-section.js';

/** @import { Action } from '../shared/actions.js' */
/** @import { Settings } from '../shared/settings.js' */
/** @import { Words } from '../shared/text.js' */

// The page's words (its data-i18n text and title filled in), and its light or dark scheme reported
// for the toolbar glyph. Messages that name the extension (“$NAME$ settings”) get extShortName.
const t = setUpPage(chrome, { title: 'optionsTitle' });
/** @type {Words} */
const words = { t, lang: chrome.i18n.getUILanguage() };

const windowScope = byId('windowScope', HTMLSelectElement);
const inactiveDays = byId('inactiveDays', HTMLInputElement);
const includeGroupedTabs = byId('includeGroupedTabs', HTMLInputElement);
const reopenGroups = byId('reopenGroups', HTMLInputElement);
const autoClose = byId('autoClose', HTMLInputElement);
const autoCloseHours = byId('autoCloseHours', HTMLSelectElement);
autoCloseHours.append(...AUTO_CLOSE_HOURS.map((hours) => new Option(duration(hours, words), String(hours))));
const autoSnapshot = byId('autoSnapshot', HTMLInputElement);
const snapshotMinutes = byId('snapshotMinutes', HTMLSelectElement);
snapshotMinutes.append(...SNAPSHOT_MINUTES.map((minutes) => new Option(minutesText(minutes, words), String(minutes))));
byId('snapshot-every-sub').textContent = t('optionsSnapshotEverySub', [String(MAX_AUTO)]);

let settings = await settingsStore.load(chrome.storage);
const flash = statusFlasher(byId('status'), 1500);
const saver = createSettingsSaver(settingsStore, chrome.storage, { onSaved: () => flash(t('optionsSaved')) });

// "Never close tabs from these sites", as chrome://settings/performance lists the sites Memory Saver
// keeps active: Add asks in a dialog; each site has a ⋮ menu with Edit and Remove.
const keepSites = createSiteList({
  list: byId('site-list'),
  empty: byId('no-sites'),
  addButton: byId('add-site'),
  parse: siteHost,
  add: (site) => save({ keepSites: withSite(settings.keepSites, site) }),
  remove: (site) => save({ keepSites: withoutSite(settings.keepSites, site) }),
  replace: (site, edited) => save({ keepSites: withSiteReplaced(settings.keepSites, site, edited) }),
  t,
});

/**
 * Show a message that names things in Chrome's menus, each name in bold.
 *
 * @param {HTMLElement} element - Where it goes.
 * @param {string} key - The message; its placeholders are the names, in order.
 * @param {readonly string[]} names - The names (“More tab actions”).
 */
function showWithNames(element, key, names) {
  // Each name's place is marked, the message cut there, and the names put back as <strong>.
  const parts = t(key, names.map((_, i) => `\u0001${i}\u0001`)).split('\u0001');
  element.replaceChildren(...parts.map((part, i) => (i % 2 ? make('strong', '', names[Number(part)]) : part)));
}
showWithNames(byId('menu-intro'), 'optionsMenuIntro', [t(MENU_MESSAGE)]);
showWithNames(byId('no-workspaces-text'), 'optionsNoWorkspaces', [t(MENU_MESSAGE), t('actionSaveWorkspace')]);
byId('workspaces-full-text').textContent = t('optionsWorkspacesFull', [String(MAX_WORKSPACES)]);

/**
 * The Menu card's rows, one per action in the order the menu reads (the everyday ones, then each
 * submenu's under its name): a label and its switch. Made once and
 * updated in place, so a switch keeps the keyboard focus when it's turned on or off.
 *
 * @type {{action: Action, text: HTMLSpanElement, toggle: HTMLInputElement}[]}
 */
const menuRows = ACTIONS.map((action) => {
  const toggle = make('input', 'switch');
  toggle.type = 'checkbox';
  toggle.setAttribute('role', 'switch');
  toggle.addEventListener('change', () => {
    const hidden = new Set(settings.hiddenActions);
    if (toggle.checked) hidden.delete(action.id);
    else hidden.add(action.id);
    save({ hiddenActions: [...hidden] });
  });
  const text = make('span', 'label');
  const row = make('label', 'row');
  row.append(text, toggle);
  // The menu's own submenus are named above their actions, so the list reads as the menu does.
  const group = GROUPS.find((g) => g.group === action.group);
  if (group && ACTIONS.find((other) => other.group === action.group) === action) {
    const heading = make('p', 'row text menu-group');
    heading.append(make('span', 'label secondary', t(group.message)));
    byId('menu-items').append(heading);
  }
  byId('menu-items').append(row);
  return { action, text, toggle };
});

/** Show each action's title (it can depend on the settings: the number of days) and whether it's in the menu. */
function renderMenuItems() {
  for (const { action, text, toggle } of menuRows) {
    text.textContent = menuTitle(action, words, settings);
    toggle.checked = !settings.hiddenActions.includes(action.id);
  }
}

/**
 * The shortcuts that are set, straight from Chrome, then the link row to
 * chrome://extensions/shortcuts (where they're changed). With none set, the
 * link row says so.
 */
async function renderShortcuts() {
  // "Switch to last used tab" is a shortcut only (no menu item), listed first.
  const commands = [{ id: SWITCH_LAST, message: SWITCH_LAST_MESSAGE }, ...ACTIONS].map(({ id, message }) => ({ id, title: t(message) }));
  const shortcuts = setShortcuts(commands, await chrome.commands.getAll());
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
  render();
}

/** Show the settings: the Menu card's switches, and the Workspaces, Snapshots and Closing tabs cards' controls. */
function render() {
  renderMenuItems();
  windowScope.value = settings.windowScope;
  // What's being typed is left alone: the field shows the stored (clamped) number once it's left.
  if (document.activeElement !== inactiveDays) inactiveDays.value = String(settings.inactiveDays);
  byId('days-unit').textContent = settings.inactiveDays === 1 ? t('optionsDayUnitOne') : t('optionsDayUnit');
  includeGroupedTabs.checked = settings.includeGroupedTabs;
  reopenGroups.checked = settings.reopenGroups;
  autoClose.checked = settings.autoClose;
  autoCloseHours.value = String(settings.autoCloseHours);
  byId('auto-close-options').hidden = !settings.autoClose;
  keepSites.render(settings.keepSites);
  autoSnapshot.checked = settings.autoSnapshot;
  snapshotMinutes.value = String(settings.snapshotMinutes);
  byId('auto-snapshot-options').hidden = !settings.autoSnapshot;
}

windowScope.addEventListener('change', () => save({ windowScope: windowScope.value }));
includeGroupedTabs.addEventListener('change', () => save({ includeGroupedTabs: includeGroupedTabs.checked }));
reopenGroups.addEventListener('change', () => save({ reopenGroups: reopenGroups.checked }));
autoClose.addEventListener('change', () => save({ autoClose: autoClose.checked }));
autoCloseHours.addEventListener('change', () => save({ autoCloseHours: autoCloseHours.value }));
autoSnapshot.addEventListener('change', () => save({ autoSnapshot: autoSnapshot.checked }));
snapshotMinutes.addEventListener('change', () => save({ snapshotMinutes: snapshotMinutes.value }));
byId('memory-saver').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://settings/performance' });
});
inactiveDays.addEventListener('change', () => {
  // An emptied field (or one Chrome can't read a number from) keeps the number it had.
  if (inactiveDays.value.trim() !== '') save({ inactiveDays: inactiveDays.value });
  inactiveDays.value = String(settings.inactiveDays); // Show the stored (clamped) number.
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
// Changes made here and not yet written stay on top (the saver lays them over what storage holds).
saver.follow((changed) => {
  settings = changed;
  render();
}, chrome.storage.onChanged);

// About card: the version Chrome loaded, and the links from about-links.js.
byId('version').textContent = t('optionsVersion', [chrome.runtime.getManifest().version]);
setAboutLinks(ABOUT_LINKS);

render();
renderShortcuts();
startSnapshots(() => settings, words, await startWorkspaces(() => settings, words));
