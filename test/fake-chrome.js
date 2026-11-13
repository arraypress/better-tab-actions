/**
 * In-memory stand-ins for the rest of the Chrome edge the service worker touches, around
 * test/fake-browser.js: `chrome.contextMenus` (the items Chrome holds, refusing what Chrome
 * refuses), `chrome.alarms`, and a whole `chrome` whose tabs, windows and storage fire the events
 * Chrome fires, so the real worker (extension/background/worker.js) runs against it.
 *
 * @module test/fake-chrome
 */
import { EXTENSION_ID, fakeBrowser } from './fake-browser.js';

/** @import { AlarmsApi } from '../extension/background/auto-close.js' */
/** @import { TabSeed } from './fake-browser.js' */

/** @type {Set<Set<(...args: any[]) => unknown>>} Every fake event's listeners, for {@link dropListeners}. */
const everyEvent = new Set();

/**
 * Forget every listener on every fake event, as when Chrome stops an idle service worker: the
 * worker's memory is gone, and its script registers its listeners again when it next starts.
 * (The kit's fake storage keeps its own `onChanged` listeners: a stopped worker's would still
 * hear a storage change there.)
 *
 * @returns {void}
 */
export function dropListeners() {
  for (const listeners of everyEvent) listeners.clear();
}

/**
 * A Chrome event: listeners are added as on `chrome.*.on…`, and a test fires it.
 *
 * @template {unknown[]} A
 * @returns {{addListener(listener: (...args: A) => unknown): void, removeListener(listener: (...args: A) => unknown): void,
 *   hasListener(listener: (...args: A) => unknown): boolean, fire(...args: A): Promise<unknown[]>}} The event; `fire` resolves once every
 *   listener's promise has settled.
 */
export function fakeEvent() {
  /** @type {Set<(...args: A) => unknown>} */
  const listeners = new Set();
  everyEvent.add(listeners);
  return {
    addListener: (listener) => { listeners.add(listener); },
    removeListener: (listener) => { listeners.delete(listener); },
    hasListener: (listener) => listeners.has(listener),
    fire: (...args) => Promise.all([...listeners].map((listener) => listener(...args))),
  };
}

/**
 * An in-memory `chrome.contextMenus`, as Chromium behaves (each point checked in Chromium 156):
 * `create` answers through its callback a moment later, leaving a refusal in
 * `runtime.lastError` ("Cannot create item with duplicate id …", a parent that isn't there);
 * `update` rejects for an item that isn't there; `removeAll` settles a moment later.
 *
 * @param {{lastError?: {message?: string}}} runtime - Where `create`'s error is left, as `chrome.runtime`.
 * @returns The API, plus what tests read: the items Chrome holds, the refusals, and the calls made.
 */
export function fakeContextMenus(runtime) {
  /** @type {Map<string, chrome.contextMenus.CreateProperties>} The items, in the order they were created. */
  const items = new Map();
  /** @type {string[]} */
  const errors = [];
  /** @type {{id: string, title?: string, enabled?: boolean}[]} */
  const updates = [];
  let removals = 0;
  const later = () => new Promise((resolve) => setTimeout(resolve, 0));

  return {
    /**
     * @param {chrome.contextMenus.CreateProperties} props - The item.
     * @param {() => void} [callback] - Called once Chrome has made or refused it.
     */
    create(props, callback) {
      const id = String(props.id);
      later().then(() => {
        const refused = items.has(id)
          ? `Cannot create item with duplicate id ${id}`
          : props.parentId !== undefined && !items.has(String(props.parentId))
            ? `Cannot find menu item with id ${props.parentId}`
            : undefined;
        if (refused) {
          errors.push(refused);
          runtime.lastError = { message: refused };
        } else {
          items.set(id, { ...props });
        }
        callback?.();
        delete runtime.lastError;
      });
      return id;
    },
    /**
     * @param {string | number} id - The item.
     * @param {Omit<chrome.contextMenus.CreateProperties, 'id'>} props - What changes.
     */
    async update(id, props) {
      await later();
      const item = items.get(String(id));
      if (!item) throw new Error(`Cannot find menu item with id ${id}`);
      updates.push({ id: String(id), ...props });
      Object.assign(item, props);
    },
    async removeAll() {
      await later();
      removals++;
      items.clear();
    },
    onClicked: /** @type {ReturnType<typeof fakeEvent<[chrome.contextMenus.OnClickData, chrome.tabs.Tab?]>>} */ (fakeEvent()),

    /** The items Chrome holds, in order. */
    get items() {
      return [...items.values()];
    },
    /**
     * One item's title, with " (greyed out)" when it's disabled.
     *
     * @param {string} id - The item.
     * @returns {string | undefined} What the menu shows, if the item is there.
     */
    shows(id) {
      const item = items.get(id);
      return item && `${item.title}${item.enabled === false ? ' (greyed out)' : ''}`;
    },
    /** Every refusal Chrome reported, as on the extension's Errors page. */
    errors,
    /** Every `update` Chrome accepted. */
    updates,
    /** How many times the menu was cleared. */
    get removals() {
      return removals;
    },
  };
}

/**
 * An in-memory `chrome.alarms`: the alarms by name, and their event.
 *
 * @param {number} [now] - The time alarms are scheduled from. Default 0.
 * @returns {AlarmsApi & {all: Map<string, chrome.alarms.Alarm>, readonly creates: number,
 *   onAlarm: ReturnType<typeof fakeEvent<[chrome.alarms.Alarm]>>}} The fake.
 */
export function fakeAlarms(now = 0) {
  /** @type {Map<string, chrome.alarms.Alarm>} */
  const all = new Map();
  let creates = 0;
  return {
    all,
    get creates() {
      return creates;
    },
    async get(name) {
      return all.get(name);
    },
    async create(name, { periodInMinutes, delayInMinutes = 0 }) {
      creates++;
      all.set(name, { name, periodInMinutes, scheduledTime: now + delayInMinutes * 60_000, persistAcrossSessions: true });
    },
    async clear(name) {
      return all.delete(name);
    },
    onAlarm: fakeEvent(),
  };
}

/**
 * A whole `chrome` for the service worker: the fake browser's tabs, windows, tab groups and
 * storage, firing the events Chrome fires when they change (a tab created, removed, activated,
 * muted, pinned or grouped; a window focused), plus the menu, alarms, commands, the toolbar
 * button and the runtime's install and start-up events.
 *
 * @param {TabSeed[]} tabs - The open tabs (see `fakeBrowser`).
 * @param {Parameters<typeof fakeBrowser>[1]} [options] - The windows (see `fakeBrowser`).
 * @returns The stand-in: `api` is what the worker takes as `chrome`; the rest is for the test.
 */
export function fakeChrome(tabs, options) {
  const browser = fakeBrowser(tabs, options);
  /** @type {{id: string, lastError?: {message?: string}}} */
  const runtimeState = { id: EXTENSION_ID };
  const contextMenus = fakeContextMenus(runtimeState);
  const alarms = fakeAlarms();
  /** @type {string[]} */
  const openedOptions = [];

  const events = {
    onCreated: /** @type {ReturnType<typeof fakeEvent<[chrome.tabs.Tab]>>} */ (fakeEvent()),
    onRemoved: /** @type {ReturnType<typeof fakeEvent<[number, object]>>} */ (fakeEvent()),
    onUpdated: /** @type {ReturnType<typeof fakeEvent<[number, object, object]>>} */ (fakeEvent()),
    onActivated: /** @type {ReturnType<typeof fakeEvent<[{tabId: number, windowId: number}]>>} */ (fakeEvent()),
    onAttached: fakeEvent(),
    onDetached: fakeEvent(),
  };
  const onFocusChanged = /** @type {ReturnType<typeof fakeEvent<[number]>>} */ (fakeEvent());

  const tabsApi = {
    ...browser.tabs,
    ...events,
    /** @param {chrome.tabs.CreateProperties} props */
    async create(props) {
      const tab = await browser.tabs.create({ windowId: browser.lastFocusedWindowId, ...props });
      await events.onCreated.fire(/** @type {chrome.tabs.Tab} */ (tab));
      return tab;
    },
    /** @param {number[]} ids */
    async remove(ids) {
      await browser.tabs.remove(ids);
      for (const id of ids) await events.onRemoved.fire(id, {});
    },
    /** @param {number} id @param {chrome.tabs.UpdateProperties} props */
    async update(id, props) {
      const tab = await browser.tabs.update(id, props);
      if (props.muted !== undefined) await events.onUpdated.fire(id, { mutedInfo: tab.mutedInfo }, tab);
      if (props.pinned !== undefined) await events.onUpdated.fire(id, { pinned: tab.pinned }, tab);
      if (props.active) await events.onActivated.fire({ tabId: id, windowId: tab.windowId });
      return tab;
    },
    /** @param {chrome.tabs.GroupOptions} group */
    async group(group) {
      const groupId = await browser.tabs.group(group);
      for (const id of [group.tabIds].flat()) await events.onUpdated.fire(/** @type {number} */ (id), { groupId }, {});
      return groupId;
    },
  };

  const windowsApi = {
    ...browser.windows,
    WINDOW_ID_NONE: -1,
    onFocusChanged,
    /** @param {number} id @param {chrome.windows.UpdateInfo} info */
    async update(id, info) {
      const win = await browser.windows.update(id, info);
      if (info.focused) await onFocusChanged.fire(id);
      return win;
    },
  };

  const api = {
    tabs: tabsApi,
    windows: windowsApi,
    tabGroups: browser.tabGroups,
    extension: browser.extension,
    storage: browser.storage,
    contextMenus,
    alarms,
    commands: { onCommand: /** @type {ReturnType<typeof fakeEvent<[string, chrome.tabs.Tab?]>>} */ (fakeEvent()) },
    action: { onClicked: fakeEvent() },
    runtime: Object.assign(runtimeState, {
      onInstalled: fakeEvent(),
      onStartup: fakeEvent(),
      getURL: (/** @type {string} */ path) => `chrome-extension://${EXTENSION_ID}/${path}`,
      openOptionsPage: async () => { openedOptions.push('options'); },
    }),
  };

  return {
    /** What the worker takes as `chrome`. */
    api: /** @type {typeof chrome} */ (/** @type {unknown} */ (api)),
    browser,
    contextMenus,
    alarms,
    tabs: tabsApi,
    windows: windowsApi,
    commands: api.commands,
    action: api.action,
    runtime: api.runtime,
    /** Each time the settings page was opened from the toolbar button. */
    openedOptions,
  };
}
