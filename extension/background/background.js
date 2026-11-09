/**
 * The service worker: builds the tab right-click menu (with its "Open workspace" submenu), keeps
 * its live labels up to date, runs the actions from the menu and keyboard shortcuts, closes unused
 * tabs automatically when that's on (auto-close.js), tracks the recently used tabs for "Switch to
 * last used tab", and starts the light/dark toolbar glyph.
 *
 * @module background/background
 */
import { browserApis, MANAGE_WORKSPACES, menuEntries, menuState, runAction, WORKSPACE_ITEM_PREFIX } from '../shared/actions.js';
import { settingsStore } from '../shared/settings.js';
import { closedCount } from '../shared/undo.js';
import { loadWorkspaces, WORKSPACES_KEY } from '../shared/workspaces.js';
import { forget, lastUsed, loadRecent, noteUsed, RECENT_KEY } from './recent.js';
import { AUTO_CLOSE_ALARM, closeUnusedTabs, scheduleAutoClose } from './auto-close.js';
import { startToolbarTheme } from '../vendor/extension-kit/index.js';

/** @import { MenuEntry } from '../shared/actions.js' */

const PARENT_ID = 'more-tab-actions';
/** The shortcut-only command "Switch to last used tab". */
const SWITCH_LAST = 'switch-last-tab';
const browser = browserApis(chrome);

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
 * The submenu as it should look now: the settings, the open tabs, the closed batch, the focused
 * window and the saved workspaces.
 *
 * @returns {Promise<MenuEntry[]>} The entries.
 */
async function currentMenu() {
  const [settings, tabs, count, [focused], workspaces] = await Promise.all([
    settingsStore.load(chrome.storage),
    chrome.tabs.query({}),
    closedCount(chrome.storage.session),
    // The group items describe the window the user is in: a right-click lands there.
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    loadWorkspaces(chrome.storage.local),
  ]);
  return menuEntries(settings, menuState(tabs, count, chrome.runtime.id, focused?.windowId, workspaces));
}

/** @param {chrome.contextMenus.CreateProperties & {id: string}} props - One menu item. */
const createItem = (props) =>
  chrome.contextMenus.create({ contexts: ['tab'], ...props }, logError(`Creating "${props.id}"`));

/**
 * Add entries to the menu under `parentId`, submenus included.
 *
 * @param {readonly MenuEntry[]} entries - The entries.
 * @param {string} parentId - The item they go under.
 */
function addItems(entries, parentId) {
  entries.forEach((entry, i) => {
    if (entry.separator) {
      createItem({ id: `${parentId}-separator-${i}`, parentId, type: 'separator' });
      return;
    }
    createItem({ id: entry.id, parentId, title: entry.title, enabled: entry.enabled });
    if (entry.children) addItems(entry.children, entry.id);
  });
}

/** @type {Promise<void>} */
let menuBuilt = Promise.resolve();
/**
 * Build the tab right-click menu: one "More tab actions" submenu holding the visible actions.
 * Builds run one after another, so two quick ones can't mix their items.
 *
 * @returns {Promise<void>} Settles once built (errors are logged, not thrown).
 */
function buildMenu() {
  menuBuilt = menuBuilt.then(async () => {
    await chrome.contextMenus.removeAll();
    const entries = await currentMenu();
    if (!entries.length) return; // Everything hidden: no menu at all.
    createItem({ id: PARENT_ID, title: 'More tab actions' });
    addItems(entries, PARENT_ID);
  }).catch((error) => console.error('Building the menu:', error));
  return menuBuilt;
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
 * @param {string} [workspaceId] - For "open-workspace", the workspace; the latest when left out.
 * @returns {Promise<number[]>} The IDs of the tabs it acted on.
 */
async function run(id, tab, workspaceId) {
  const settings = await settingsStore.load(chrome.storage);
  return runAction(id, tab, browser, { settings, extensionId: chrome.runtime.id, workspaceId });
}
// The same handler the menu and shortcuts use, for the service worker's console and the
// Playwright check (test/e2e/groups.mjs).
Object.assign(globalThis, { runMenuAction: run });

// Listeners are registered at top level so they attach every time the service worker wakes.

// Menu items persist, so build them on install/update, on startup (the closed batch is gone
// after a restart) and when settings change. Any settings change Chrome Sync refused earlier (kept
// on this computer) is tried again first.
/** Start or stop the automatic-closing alarm to match the settings. */
async function schedule() {
  await scheduleAutoClose(chrome.alarms, await settingsStore.load(chrome.storage))
    .catch((error) => console.error('Scheduling automatic closing:', error));
}

/** Retry refused settings writes, then build the menu and schedule automatic closing. */
async function startUp() {
  await settingsStore.retryUnsynced(chrome.storage).catch((error) => console.error('Retrying settings sync:', error));
  await Promise.all([buildMenu(), schedule()]);
}
chrome.runtime.onInstalled.addListener(startUp);
chrome.runtime.onStartup.addListener(startUp);
// Settings changed here, in another tab or on another computer (through Chrome Sync).
// A workspace saved, renamed or deleted here or on the settings page changes the "Open workspace" submenu.
chrome.storage.onChanged.addListener((changes, area) => {
  const settingsChanged = settingsStore.changed(changes, area).length > 0;
  if (settingsChanged || (area === 'local' && WORKSPACES_KEY in changes)) buildMenu();
  if (settingsChanged) schedule();
  if (area === 'session') refreshMenu();
});

// "Close unused tabs automatically": each check closes what has gone unused (auto-close.js).
chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== AUTO_CLOSE_ALARM) return;
  const settings = await settingsStore.load(chrome.storage);
  await closeUnusedTabs(browser, settings, Date.now()).catch((error) => console.error('Closing unused tabs:', error));
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

// Tab right-click menu: acts on the tab that was right-clicked. "Open workspace" items open their
// workspace; "Manage workspaces" opens the settings page at its Workspaces card.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === MANAGE_WORKSPACES) chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#workspaces') });
  else if (id.startsWith(WORKSPACE_ITEM_PREFIX)) run('open-workspace', tab, id.slice(WORKSPACE_ITEM_PREFIX.length));
  else if (tab) run(id, tab);
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
