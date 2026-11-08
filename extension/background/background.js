/**
 * The service worker: builds the tab right-click menu, keeps its live labels up to date, runs
 * the actions from the menu and keyboard shortcuts, tracks the recently used tabs for "Switch to
 * last used tab", and starts the light/dark toolbar glyph.
 *
 * @module background/background
 */
import { menuEntries, menuState, runAction } from '../shared/actions.js';
import { settingsStore } from '../shared/settings.js';
import { closedCount } from '../shared/undo.js';
import { forget, lastUsed, loadRecent, noteUsed, RECENT_KEY } from './recent.js';
import { startToolbarTheme } from '../vendor/extension-kit/index.js';

/** @import { MenuEntry } from '../shared/actions.js' */

const PARENT_ID = 'more-tab-actions';
/** The shortcut-only command "Switch to last used tab". */
const SWITCH_LAST = 'switch-last-tab';
const browser = { tabs: chrome.tabs, windows: chrome.windows, session: chrome.storage.session, tabGroups: chrome.tabGroups };

/**
 * A callback for `chrome.contextMenus.create` (it has no promise form) that logs a failure.
 *
 * @param {string} what - What was being done, for the message.
 * @returns {() => void} The callback.
 */
const logError = (what) => () => {
  if (chrome.runtime.lastError) console.error(`${what}:`, chrome.runtime.lastError.message);
};

/**
 * The submenu as it should look now: the settings, the open tabs, the closed batch and the
 * focused window.
 *
 * @returns {Promise<MenuEntry[]>} The entries.
 */
async function currentMenu() {
  const [settings, tabs, count, [focused]] = await Promise.all([
    settingsStore.load(chrome.storage),
    chrome.tabs.query({}),
    closedCount(chrome.storage.session),
    // The group items describe the window the user is in: a right-click lands there.
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
  ]);
  return menuEntries(settings, menuState(tabs, count, chrome.runtime.id, focused?.windowId));
}

/** Build the tab right-click menu: one "More tab actions" submenu holding the visible actions. */
async function buildMenu() {
  await chrome.contextMenus.removeAll();
  const entries = await currentMenu();
  if (!entries.length) return; // Everything hidden: no menu at all.

  /** @param {chrome.contextMenus.CreateProperties & {id: string}} props */
  const create = (props) =>
    chrome.contextMenus.create({ contexts: ['tab'], ...props }, logError(`Creating "${props.id}"`));

  create({ id: PARENT_ID, title: 'More tab actions' });
  entries.forEach((entry, i) => {
    if (entry.separator) {
      create({ id: `separator-${i}`, parentId: PARENT_ID, type: 'separator' });
    } else {
      create({ id: entry.id, parentId: PARENT_ID, title: entry.title, enabled: entry.enabled });
    }
  });
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let refreshTimer;
/**
 * Update labels and greyed-out items that depend on live state ("Reopen 3 closed tabs", "Unmute tabs",
 * nothing left to group) without a rebuild. Bursts of tab events make one update.
 */
function refreshMenu() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    for (const entry of await currentMenu()) {
      if (entry.separator) continue;
      chrome.contextMenus.update(entry.id, { title: entry.title, enabled: entry.enabled }).catch(() => {});
    }
  }, 100);
}

/**
 * Run an action with the stored settings.
 *
 * @param {string} id - The action's id.
 * @param {chrome.tabs.Tab} [tab] - The clicked tab; the active tab when left out.
 * @returns {Promise<number[]>} The IDs of the tabs it acted on.
 */
async function run(id, tab) {
  const settings = await settingsStore.load(chrome.storage);
  return runAction(id, tab, browser, { settings, extensionId: chrome.runtime.id });
}
// The same handler the menu and shortcuts use, for the service worker's console and the
// Playwright check (test/e2e/groups.mjs).
Object.assign(globalThis, { runMenuAction: run });

// Listeners are registered at top level so they attach every time the service worker wakes.

// Menu items persist, so build them on install/update, on startup (the closed batch is gone
// after a restart) and when settings change. Any settings change Chrome Sync refused earlier (kept
// on this computer) is tried again first.
/** Retry refused settings writes, then build the menu. */
async function startUp() {
  await settingsStore.retryUnsynced(chrome.storage).catch((error) => console.error('Retrying settings sync:', error));
  await buildMenu();
}
chrome.runtime.onInstalled.addListener(startUp);
chrome.runtime.onStartup.addListener(startUp);
// Settings changed here, in another tab or on another computer (through Chrome Sync).
chrome.storage.onChanged.addListener((changes, area) => {
  if (settingsStore.changed(changes, area).length) buildMenu();
  if (area === 'session') refreshMenu();
});

// Keep "Mute other tabs" / "Unmute tabs" in step with what's actually muted, and the group items
// with what the focused window holds (tabs grouped, pinned, opened, closed or moved between windows).
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.mutedInfo || 'groupId' in changeInfo || 'pinned' in changeInfo) refreshMenu();
});
chrome.tabs.onRemoved.addListener(refreshMenu);
chrome.tabs.onCreated.addListener(refreshMenu);
chrome.tabs.onAttached.addListener(refreshMenu);
chrome.tabs.onDetached.addListener(refreshMenu);
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshMenu();
});

// Tab right-click menu: acts on the tab that was right-clicked.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab) run(String(info.menuItemId), tab);
});

// Toolbar icon: open the settings page.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// The toolbar glyph follows light and dark mode, reported by the options page and an offscreen
// watcher. Every start: Chrome shows the manifest's light glyph after a restart or re-enable, and
// closes the offscreen watcher on quit.
startToolbarTheme(chrome);

// Keyboard shortcuts (command names match action IDs): act on the active tab.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === SWITCH_LAST) switchToLastUsed(tab).catch((error) => console.error('Switching tabs:', error));
  else run(command, tab);
});

// "Switch to last used tab" (shortcut only): every tab brought to the front, in any window, goes
// to the top of the recent list. Updates are chained so quick switching can't lose one.
/** @type {Promise<void>} */
let recentWrite = Promise.resolve();
/**
 * Change the recent list, after any change still being written.
 *
 * @param {(list: number[]) => number[]} change - The new list from the stored one.
 * @returns {Promise<void>} Settles once written (errors are logged, not thrown).
 */
function updateRecent(change) {
  recentWrite = recentWrite
    .then(async () => chrome.storage.session.set({ [RECENT_KEY]: change(await loadRecent(chrome.storage.session)) }))
    .catch((error) => console.error('Recent tabs:', error));
  return recentWrite;
}
chrome.tabs.onActivated.addListener(({ tabId }) => updateRecent((list) => noteUsed(list, tabId)));
chrome.tabs.onRemoved.addListener((tabId) => updateRecent((list) => forget(list, tabId)));
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // Chrome lost focus: nothing was used.
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) updateRecent((list) => noteUsed(list, tab.id));
});

/**
 * Bring the last used tab (and its window) to the front. Pressed again, it comes back.
 *
 * @param {chrome.tabs.Tab} [current] - The tab the shortcut was pressed on.
 * @returns {Promise<void>}
 */
async function switchToLastUsed(current) {
  // Record the tab being left first: if Chrome missed a focus event, the next press still
  // comes straight back here.
  await updateRecent((list) => noteUsed(list, current?.id));
  const [list, tabs] = await Promise.all([loadRecent(chrome.storage.session), chrome.tabs.query({})]);
  const target = lastUsed(list, current?.id, tabs);
  if (target?.id === undefined) return;
  const targetId = target.id;
  await chrome.windows.update(target.windowId, { focused: true });
  await chrome.tabs.update(targetId, { active: true });
  // Switching to a tab that was already active in its window fires no onActivated: note it here.
  await updateRecent((list) => noteUsed(list, targetId));
}
