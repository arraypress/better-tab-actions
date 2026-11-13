/**
 * What the service worker does, wired to `chrome` by {@link startWorker}: builds the tab
 * right-click menu (menu.js) and keeps its live labels up to date, runs the actions from the menu
 * and keyboard shortcuts, closes unused tabs automatically when that's on (auto-close.js), and
 * tracks the recently used tabs for "Switch to last used tab" (recent.js).
 *
 * Nothing that matters is kept in the worker's memory, which Chrome drops after 30 idle seconds:
 * the menu's items are Chrome's, the closed batch and the recent tabs are in
 * `chrome.storage.session`, the check for unused tabs is a `chrome.alarms` alarm. The queues here
 * only put work started in one run of the worker in order.
 *
 * @module background/worker
 */
import {
  browserApis, MANAGE_WORKSPACES, menuEntries, menuState, runAction, SWITCH_LAST, WORKSPACE_ITEM_PREFIX,
} from '../shared/actions.js';
import { settingsStore } from '../shared/settings.js';
import { CLOSED_KEY, closedCount } from '../shared/undo.js';
import { loadWorkspaces, WORKSPACES_KEY } from '../shared/workspaces.js';
import { AUTO_CLOSE_ALARM, closeUnusedTabs, scheduleAutoClose } from './auto-close.js';
import { createMenuKeeper } from './menu.js';
import { forget, lastUsed, loadRecent, noteUsed, RECENT_KEY } from './recent.js';

/** @import { MenuEntry } from '../shared/actions.js' */

/** The settings page's Workspaces card, where "Manage workspaces" goes. */
export const WORKSPACES_PAGE = 'options/options.html#workspaces';

/**
 * What a menu click and a keyboard shortcut call, for the test hook (test/e2e/hook.js): Chrome's
 * native menu and shortcuts can't be driven headlessly.
 *
 * @typedef {object} WorkerHandlers
 * @property {(info: Pick<chrome.contextMenus.OnClickData, 'menuItemId'>, tab?: chrome.tabs.Tab) => Promise<number[]>} handleMenuClick
 *   A click in the tab menu; resolves to the ids of the tabs it acted on.
 * @property {(command: string, tab?: chrome.tabs.Tab) => Promise<number[]>} handleCommand
 *   A keyboard shortcut; resolves to the ids of the tabs it acted on.
 */

/**
 * A handler for a rejected promise that logs it, so a failed action shows on the extension's
 * Errors page with what was being done instead of as an uncaught rejection.
 *
 * @param {string} what - What was being done.
 * @returns {(error: unknown) => void} The handler.
 */
const logFailure = (what) => (error) => console.error(`${what}:`, error);

/**
 * Register every listener on `api`. Called at the top of the service worker's script, so the
 * listeners are attached each time Chrome starts the worker for an event.
 *
 * @param {typeof chrome} api - `chrome` (or a stand-in in tests).
 * @returns {WorkerHandlers} The menu's and the shortcuts' handlers.
 * @example
 * export const { handleMenuClick, handleCommand } = startWorker(chrome);
 */
export function startWorker(api) {
  const browser = browserApis(api);

  /**
   * The submenu as it should look now: the settings, the open tabs, the closed batch, the focused
   * window and the saved workspaces.
   *
   * @returns {Promise<MenuEntry[]>} The entries.
   */
  async function currentMenu() {
    const [settings, tabs, count, [focused], workspaces] = await Promise.all([
      settingsStore.load(api.storage),
      api.tabs.query({}),
      closedCount(api.storage.session),
      // The group items describe the window the user is in: a right-click lands there.
      api.tabs.query({ active: true, lastFocusedWindow: true }),
      loadWorkspaces(api.storage.local),
    ]);
    return menuEntries(settings, menuState(tabs, count, api.runtime.id, focused?.windowId, workspaces));
  }
  const menu = createMenuKeeper(api, currentMenu);

  /**
   * Run an action with the stored settings.
   *
   * @param {string} id - The action's id.
   * @param {chrome.tabs.Tab} [tab] - The clicked tab; the active tab when left out.
   * @param {string} [workspaceId] - For "open-workspace", the workspace; the latest when left out.
   * @returns {Promise<number[]>} The IDs of the tabs it acted on.
   */
  async function run(id, tab, workspaceId) {
    const settings = await settingsStore.load(api.storage);
    return runAction(id, tab, browser, { settings, extensionId: api.runtime.id, workspaceId });
  }

  /** Start or stop the automatic-closing alarm to match the settings. */
  async function schedule() {
    await scheduleAutoClose(api.alarms, await settingsStore.load(api.storage)).catch(logFailure('Scheduling automatic closing'));
  }

  /**
   * Menu items persist, so they're built on install or update, on browser start (the closed batch
   * is gone after a restart) and when the settings or the workspaces change. Any settings change
   * Chrome Sync refused earlier (kept on this computer) is tried again first. After a Chrome
   * update both events come in one run of the worker; the builds take turns (menu.js).
   */
  async function startUp() {
    await settingsStore.retryUnsynced(api.storage).catch(logFailure('Retrying settings sync'));
    await Promise.all([menu.build(), schedule()]);
  }
  api.runtime.onInstalled.addListener(startUp);
  api.runtime.onStartup.addListener(startUp);

  // Settings changed here, in another tab or on another computer (through Chrome Sync); a workspace
  // saved, renamed or deleted changes the "Open workspace" submenu; the closed batch changes "Reopen
  // closed tabs". The recent tabs, written at every tab switch, change nothing in the menu.
  api.storage.onChanged.addListener((changes, area) => {
    const settingsChanged = settingsStore.changed(changes, area).length > 0;
    if (settingsChanged || (area === 'local' && WORKSPACES_KEY in changes)) menu.build();
    if (settingsChanged) schedule();
    if (area === 'session' && CLOSED_KEY in changes) menu.refresh();
  });

  // "Close unused tabs automatically": each check closes what has gone unused (auto-close.js).
  api.alarms.onAlarm.addListener(async ({ name }) => {
    if (name !== AUTO_CLOSE_ALARM) return;
    const settings = await settingsStore.load(api.storage);
    await closeUnusedTabs(browser, settings, Date.now()).catch(logFailure('Closing unused tabs'));
  });

  // Keep "Mute other tabs" / "Unmute tabs" in step with what's actually muted, and the group items
  // with what the focused window holds (tabs grouped, pinned, opened, closed or moved between windows).
  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.mutedInfo || 'groupId' in changeInfo || 'pinned' in changeInfo) menu.refresh();
  });
  api.tabs.onRemoved.addListener(menu.refresh);
  api.tabs.onCreated.addListener(menu.refresh);
  api.tabs.onAttached.addListener(menu.refresh);
  api.tabs.onDetached.addListener(menu.refresh);
  api.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== api.windows.WINDOW_ID_NONE) menu.refresh();
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
      .then(async () => api.storage.session.set({ [RECENT_KEY]: change(await loadRecent(api.storage.session)) }))
      .catch(logFailure('Recent tabs'));
    return recentWrite;
  }
  api.tabs.onActivated.addListener(({ tabId }) => updateRecent((list) => noteUsed(list, tabId)));
  api.tabs.onRemoved.addListener((tabId) => updateRecent((list) => forget(list, tabId)));
  api.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === api.windows.WINDOW_ID_NONE) return; // Chrome lost focus: nothing was used.
    const [tab] = await api.tabs.query({ active: true, windowId });
    if (tab) await updateRecent((list) => noteUsed(list, tab.id));
  });

  /**
   * Bring the last used tab (and its window) to the front. Pressed again, it comes back.
   *
   * @param {chrome.tabs.Tab} [current] - The tab the shortcut was pressed on.
   * @returns {Promise<number[]>} The tab switched to; [] when there's nowhere to go.
   */
  async function switchToLastUsed(current) {
    // Record the tab being left first: if Chrome missed a focus event, the next press still
    // comes straight back here.
    await updateRecent((list) => noteUsed(list, current?.id));
    const [list, tabs] = await Promise.all([loadRecent(api.storage.session), api.tabs.query({})]);
    const target = lastUsed(list, current?.id, tabs);
    if (target?.id === undefined) return [];
    const targetId = target.id;
    await api.windows.update(target.windowId, { focused: true });
    await api.tabs.update(targetId, { active: true });
    // Switching to a tab that was already active in its window fires no onActivated: note it here.
    await updateRecent((list) => noteUsed(list, targetId));
    return [targetId];
  }

  /** @type {WorkerHandlers['handleMenuClick']} */
  async function handleMenuClick(info, tab) {
    const id = String(info.menuItemId);
    if (id === MANAGE_WORKSPACES) {
      await api.tabs.create({ url: api.runtime.getURL(WORKSPACES_PAGE) });
      return [];
    }
    // "Open workspace" items open their workspace; the rest act on the tab that was right-clicked.
    if (id.startsWith(WORKSPACE_ITEM_PREFIX)) return run('open-workspace', tab, id.slice(WORKSPACE_ITEM_PREFIX.length));
    return tab ? run(id, tab) : [];
  }

  /** @type {WorkerHandlers['handleCommand']} Command names match action IDs; they act on the active tab. */
  const handleCommand = (command, tab) => (command === SWITCH_LAST ? switchToLastUsed(tab) : run(command, tab));

  api.contextMenus.onClicked.addListener((info, tab) => {
    handleMenuClick(info, tab).catch(logFailure(`The menu item “${info.menuItemId}”`));
  });
  api.commands.onCommand.addListener((command, tab) => {
    handleCommand(command, tab).catch(logFailure(`The shortcut “${command}”`));
  });

  // Toolbar icon: open the settings page.
  api.action.onClicked.addListener(() => {
    api.runtime.openOptionsPage().catch(logFailure('Opening the settings page'));
  });

  return { handleMenuClick, handleCommand };
}
