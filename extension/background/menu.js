/**
 * The tab right-click menu as Chrome holds it: one "More tab actions" submenu of the visible
 * actions, the less used ones in submenus of their own (shared/actions.js `menuEntries`; no
 * separators, which Chrome doesn't draw in a tab-menu submenu), built whole when what it lists changes and, between
 * builds, its live labels and greyed-out items ("Reopen 3 closed tabs", "Unmute tabs", nothing
 * left to group) kept in step with the tabs.
 *
 * Chrome keeps the items themselves across service worker restarts; what's kept here in memory is
 * only a note of what Chrome was last told, to save telling it the same again, and which items
 * the menu was last built with is in `chrome.storage.session` ({@link BUILT_KEY}).
 *
 * @module background/menu
 */
import { contextMenuBuilder } from '../vendor/extension-kit/index.js';

/** @import { MenuEntry } from '../shared/actions.js' */
/** @import { StorageArea } from '../vendor/extension-kit/settings/storage.js' */

/** The submenu's own item. Its id predates the extension's rename, and stays. */
export const PARENT_ID = 'more-tab-actions';
/** The chrome.storage.session item holding the ids of the items Chrome was last given, whole (it outlives the worker's memory). */
export const BUILT_KEY = 'menuBuilt';
/** How long a burst of tab events is given to end before the labels are looked at again, in ms. */
export const REFRESH_MS = 100;

/**
 * One menu item for `chrome.contextMenus.create`, always with an id.
 *
 * @typedef {chrome.contextMenus.CreateProperties & {id: string}} MenuItem
 */

/**
 * The parts of `chrome` the menu uses.
 *
 * @typedef {object} MenuEdges
 * @property {Pick<typeof chrome.contextMenus, 'removeAll' | 'create' | 'update'>} contextMenus The menu.
 * @property {{lastError?: {message?: string}}} runtime Where Chrome leaves `create`'s error.
 * @property {{session: StorageArea}} storage `chrome.storage`: which items the menu was built with.
 */

/**
 * `chrome.contextMenus.create` properties for the whole menu, each parent before its children.
 *
 * @param {readonly MenuEntry[]} entries - The submenu's entries, from `menuEntries`.
 * @param {string} title - The submenu's own title (shared/actions.js `MENU_MESSAGE`).
 * @returns {MenuItem[]} The items, the submenu itself first; [] when every action is hidden (no menu at all).
 * @example
 * menuItems(menuEntries(words, settings, state), words.t(MENU_MESSAGE)); // [{ id: 'more-tab-actions', title: 'More tab actions', … }, …]
 */
export function menuItems(entries, title) {
  if (!entries.length) return [];
  /** @type {MenuItem[]} */
  const items = [{ id: PARENT_ID, title, contexts: ['tab'] }];
  /**
   * @param {readonly MenuEntry[]} list - Entries.
   * @param {string} parentId - The item they go under.
   */
  const add = (list, parentId) => list.forEach((entry) => {
    items.push({ id: entry.id, parentId, title: entry.title, enabled: entry.enabled, contexts: ['tab'] });
    if (entry.children) add(entry.children, entry.id);
  });
  add(entries, PARENT_ID);
  return items;
}

/**
 * What an item shows: its title and whether it's enabled, as one string to compare.
 *
 * @param {MenuItem} item - A menu item.
 * @returns {string} Its look.
 */
const look = (item) => `${item.enabled !== false}|${item.title}`;

/**
 * Keeps Chrome's menu in step with the extension's state.
 *
 * @typedef {object} MenuKeeper
 * @property {() => Promise<void>} build Build the menu whole, from the items as they are when
 *   its turn comes (after any build or refresh under way). Errors are logged, not thrown.
 * @property {() => void} refresh Look at the items again once a burst of calls has ended, and
 *   tell Chrome only about the items whose title or greyed-out state changed; if the items
 *   themselves differ (a submenu with nothing usable is left out), build the menu whole.
 */

/**
 * Make the menu's keeper.
 *
 * @param {MenuEdges} edges - `chrome` (or fakes in tests).
 * @param {() => Promise<MenuItem[]>} read - The menu's items as they should be now ({@link menuItems}).
 * @returns {MenuKeeper} The keeper.
 * @example
 * const menu = createMenuKeeper(chrome, async () => menuItems(await currentEntries(), words.t(MENU_MESSAGE)));
 * chrome.runtime.onInstalled.addListener(menu.build);
 * chrome.tabs.onRemoved.addListener(menu.refresh);
 */
export function createMenuKeeper({ contextMenus, runtime, storage }, read) {
  const buildMenu = contextMenuBuilder({ contextMenus, runtime });
  /** @type {Map<string, string>} What Chrome was last told each item looks like, by id. */
  const shown = new Map();
  /** @type {Promise<void>} Builds and refreshes take turns, so none reads the entries before its turn. */
  let turn = Promise.resolve();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  /**
   * @param {() => Promise<void>} job - A build or a refresh.
   * @returns {Promise<void>} Settles once it has run.
   */
  const inTurn = (job) => {
    turn = turn.then(job).catch((error) => console.error('The tab menu:', error));
    return turn;
  };

  /**
   * @param {readonly MenuItem[]} items - Menu items.
   * @returns {string} Which items they are, in order: the same text for the same menu, whatever its labels.
   */
  const idsOf = (items) => items.map((item) => item.id).join();
  /**
   * Give Chrome the whole menu, and note what it was given.
   *
   * @param {MenuItem[]} items - The items.
   * @returns {Promise<void>}
   */
  const buildWhole = async (items) => {
    await buildMenu(items);
    shown.clear();
    for (const item of items) shown.set(item.id, look(item));
    await storage.session.set({ [BUILT_KEY]: idsOf(items) });
  };

  return {
    build: () => inTurn(async () => {
      await buildWhole(await read());
    }),
    refresh() {
      clearTimeout(timer);
      timer = setTimeout(() => inTurn(async () => {
        const items = await read();
        // A submenu came or went (its actions all greyed out, or usable again): only a whole
        // build can add or remove items. What Chrome holds is read from session storage, as this
        // run of the worker may never have built the menu.
        const { [BUILT_KEY]: built } = await storage.session.get([BUILT_KEY]);
        if (built !== idsOf(items)) {
          await buildWhole(items);
          return;
        }
        for (const item of items) {
          if (shown.get(item.id) === look(item)) continue;
          // An item that isn't in the menu (a build is on its way) is refused: nothing to update.
          await contextMenus.update(item.id, { title: item.title, enabled: item.enabled })
            .then(() => shown.set(item.id, look(item)), () => {});
        }
      }), REFRESH_MS);
    },
  };
}
