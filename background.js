import { menuEntries, menuState, runAction } from './actions.js';
import { changedSettings, loadSettings } from './settings.js';
import { closedCount } from './undo.js';
import { forget, lastUsed, loadRecent, noteUsed, RECENT_KEY } from './recent.js';
import { moveSettingsToSync } from './migrate.js';
import { createToolbarTheme, watchFromOffscreen } from './toolbar-theme.js';

const PARENT_ID = 'more-tab-actions';
const browser = { tabs: chrome.tabs, windows: chrome.windows, session: chrome.storage.session, tabGroups: chrome.tabGroups };

const logError = (what) => () => {
  if (chrome.runtime.lastError) console.error(`${what}:`, chrome.runtime.lastError.message);
};

async function currentMenu() {
  const [settings, tabs, count, [focused]] = await Promise.all([
    loadSettings(chrome.storage),
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

/**
 * Update labels and greyed-out items that depend on live state ("Reopen 3 closed tabs", "Unmute tabs",
 * nothing left to group) without a rebuild.
 */
let refreshTimer;
function refreshMenu() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    for (const entry of await currentMenu()) {
      if (entry.separator) continue;
      chrome.contextMenus.update(entry.id, { title: entry.title, enabled: entry.enabled }).catch(() => {});
    }
  }, 100);
}

async function run(id, tab) {
  const settings = await loadSettings(chrome.storage);
  return runAction(id, tab, browser, { settings, extensionId: chrome.runtime.id });
}
// The same handler the menu and shortcuts use, for the service worker's console and the
// Playwright check (e2e/groups.mjs).
globalThis.runMenuAction = run;

// Listeners are registered at top level so they attach every time the service worker wakes.

// Menu items persist, so build them on install/update, on startup (the closed batch is gone
// after a restart) and when settings change. Settings live in Chrome Sync (settings.js); older
// installs' are moved there first, and anything sync refused earlier is tried again.
async function startUp() {
  await moveSettingsToSync(chrome.storage).catch((error) => console.error('Moving settings to sync:', error));
  await buildMenu();
}
chrome.runtime.onInstalled.addListener(startUp);
chrome.runtime.onStartup.addListener(startUp);
// Settings changed here, in another tab or on another computer (through Chrome Sync).
chrome.storage.onChanged.addListener((changes, area) => {
  if (changedSettings(changes, area).length) buildMenu();
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

// The toolbar glyph follows light and dark mode (toolbar-theme.js). Every start: Chrome shows the
// manifest's light glyph after a restart or re-enable, and closes the offscreen watcher on quit.
const toolbarTheme = createToolbarTheme({ storage: chrome.storage.local, action: chrome.action, extensionId: chrome.runtime.id });
toolbarTheme.restore();
watchFromOffscreen({ offscreen: chrome.offscreen, runtime: chrome.runtime })
  .catch((error) => console.error('Opening the colour scheme watcher:', error));
chrome.runtime.onMessage.addListener((message, sender) => {
  toolbarTheme.onMessage(message, sender);
  return false;
});

// Keyboard shortcuts (command names match action IDs): act on the active tab.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === SWITCH_LAST) switchToLastUsed(tab).catch((error) => console.error('Switching tabs:', error));
  else run(command, tab);
});

// "Switch to last used tab" (shortcut only): every tab brought to the front, in any window, goes
// to the top of the recent list. Updates are chained so quick switching can't lose one.
const SWITCH_LAST = 'switch-last-tab';
let recentWrite = Promise.resolve();
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

/** Bring the last used tab (and its window) to the front. Pressed again, it comes back. */
async function switchToLastUsed(current) {
  // Record the tab being left first: if Chrome missed a focus event, the next press still
  // comes straight back here.
  await updateRecent((list) => noteUsed(list, current?.id));
  const [list, tabs] = await Promise.all([loadRecent(chrome.storage.session), chrome.tabs.query({})]);
  const target = lastUsed(list, current?.id, tabs);
  if (!target) return;
  await chrome.windows.update(target.windowId, { focused: true });
  await chrome.tabs.update(target.id, { active: true });
  // Switching to a tab that was already active in its window fires no onActivated: note it here.
  await updateRecent((list) => noteUsed(list, target.id));
}
