/**
 * In-memory stand-in for the browser edge: chrome.tabs, chrome.windows, chrome.tabGroups and
 * chrome.storage.session. Holds real state (window membership, tab order, groups, saved groups,
 * mute) so tests check outcomes, not calls.
 */
export const EXTENSION_ID = 'test-extension-id';

export function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(key) {
      for (const k of [key].flat()) delete data[k];
    },
  };
}

/**
 * chrome.storage with local and sync areas and onChanged, behaving as Chrome does: values are
 * stored as JSON, onChanged fires only for values that changed, and sync refuses an item over
 * its 8,192-byte quota and more than 120 writes (set or remove) a minute, by `now()`.
 * `sync.writes` counts the writes it took. `settled()` waits for every listener, including the
 * changes those listeners make.
 */
export function fakeChromeStorage({ local = {}, sync = {}, now = Date.now } = {}) {
  const listeners = [];
  const running = [];
  const json = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  function area(name, initial, { quotaPerItem, writesPerMinute } = {}) {
    const data = json(initial);
    const recent = [];
    const fire = (changes) => {
      if (!Object.keys(changes).length) return;
      for (const listener of listeners) running.push(listener(json(changes), name));
    };
    return {
      data,
      writes: 0,
      /** A write, counted against the per-minute limit; refused over it, as Chrome does. */
      take() {
        if (!writesPerMinute) return void this.writes++;
        while (recent.length && recent[0] <= now() - 60_000) recent.shift();
        if (recent.length >= writesPerMinute) {
          throw new Error('This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.');
        }
        recent.push(now());
        this.writes++;
      },
      async get(keys) {
        const wanted = keys == null ? Object.keys(data) : [keys].flat();
        return Object.fromEntries(wanted.filter((k) => k in data).map((k) => [k, json(data[k])]));
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) {
          if (quotaPerItem && key.length + JSON.stringify(value).length > quotaPerItem) {
            throw new Error('Resource::kQuotaBytesPerItem quota exceeded');
          }
        }
        this.take();
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
          changes[key] = { oldValue: data[key], newValue: json(value) };
          data[key] = json(value);
        }
        fire(changes);
      },
      async remove(keys) {
        this.take();
        const changes = {};
        for (const key of [keys].flat()) {
          if (!(key in data)) continue;
          changes[key] = { oldValue: data[key] };
          delete data[key];
        }
        fire(changes);
      },
    };
  }

  return {
    local: area('local', local),
    sync: area('sync', sync, { quotaPerItem: 8192, writesPerMinute: 120 }),
    onChanged: { addListener: (listener) => listeners.push(listener) },
    async settled() {
      while (running.length) await Promise.all(running.splice(0));
    },
  };
}

/** The colours Chrome cycles through for new groups (chrome.tabGroups.Color). */
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/**
 * `focusedWindowId` is the window Chrome treats as current when an API call names none (from a
 * service worker, the last focused window). Tabs with `incognito: true` make their window incognito.
 */
export function fakeBrowser(initialTabs, { focusedWindowId = 1 } = {}) {
  let nextTabId = 1000;
  let nextWindowId = 100;
  let nextGroupId = 500;
  // Array order = tab order within each window.
  let tabs = initialTabs.map((t) => ({ windowId: 1, groupId: -1, ...t }));
  const openWindows = new Set(tabs.map((t) => t.windowId));
  const incognito = (windowId) => tabs.some((t) => t.windowId === windowId && t.incognito);

  /** Open groups the extension made: id → { id, windowId, title, color }. */
  const groups = new Map();
  /**
   * Chrome's saved groups, as Chromium 150–157 keeps them (chrome/browser/ui/tabs/saved_tab_groups/):
   * - every new group is saved, whoever made it, except in incognito (no TabGroupSyncService
   *   there) (saved_tab_group_model_listener.cc OnTabGroupAdded);
   * - its title follows the open group's (OnTabGroupChanged, kVisualsChanged);
   * - closing the last tab of a group deletes the saved group (local_tab_group_listener.cc
   *   MaybeRemoveWebContentsFromLocal), but closing its whole window only disconnects it, and it
   *   stays saved (WillCloseAllTabs → TabGroupSyncServiceImpl::RemoveLocalTabGroupMapping).
   * Entries: { title, urls, groupId } with groupId null once the group is closed.
   */
  const saved = [];
  const savedFor = (groupId) => saved.find((g) => g.groupId === groupId);
  const urlsIn = (groupId) => tabs.filter((t) => t.groupId === groupId).map((t) => t.url);

  /** Groups left with no tabs are gone, and so are their saved copies. */
  function dropEmptyGroups() {
    for (const id of [...groups.keys()]) {
      if (tabs.some((t) => t.groupId === id)) continue;
      groups.delete(id);
      const copy = savedFor(id);
      if (copy) saved.splice(saved.indexOf(copy), 1);
    }
  }

  /** Tabs as Chrome reports them, with `index` = position within the window. */
  const snapshot = () => {
    const seen = {};
    return tabs.map((t) => ({ ...t, index: (seen[t.windowId] = (seen[t.windowId] ?? -1) + 1) }));
  };

  const tabsApi = {
    async query(q) {
      return q.active ? snapshot().filter((t) => t.active) : snapshot();
    },
    async remove(ids) {
      tabs = tabs.filter((t) => !ids.includes(t.id));
      dropEmptyGroups();
      // Chrome closes a window when its last tab closes.
      for (const id of [...openWindows]) {
        if (!tabs.some((t) => t.windowId === id)) openWindows.delete(id);
      }
    },
    async update(id, { muted }) {
      const tab = tabs.find((t) => t.id === id);
      tab.mutedInfo = muted ? { muted: true, reason: 'extension', extensionId: EXTENSION_ID } : { muted: false };
    },
    async create({ windowId, index, url }) {
      if (!openWindows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
      const tab = { id: nextTabId++, windowId, groupId: -1, url };
      const inWindow = tabs.filter((t) => t.windowId === windowId);
      const before = typeof index === 'number' ? inWindow[index] : undefined;
      if (before) tabs.splice(tabs.indexOf(before), 0, tab);
      else tabs.splice(tabs.indexOf(inWindow.at(-1)) + 1, 0, tab);
      return { ...tab };
    },
    /** Mirrors Chromium's TabStripModel::GetGroupToAssign: a moved tab's group depends on its new neighbours. */
    async move(id, { index }) {
      const tab = tabs.find((t) => t.id === id);
      const win = tabs.filter((t) => t.windowId === tab.windowId);
      const from = win.indexOf(tab);
      const to = Math.min(Math.max(index, 0), win.length - 1);
      if (from === to) return { ...tab };

      const NONE = -1;
      const groupAt = (i) => win[i]?.groupId ?? NONE;
      const [left, right] = to > from ? [groupAt(to), groupAt(to + 1)] : [groupAt(to - 1), groupAt(to)];
      let group = tab.groupId;
      if (group !== left && group !== right) {
        if (left === right && left !== NONE) group = left; // Dropped inside another group: joins it.
        else if (group !== NONE && win.filter((t) => t.groupId === group).length > 1) group = NONE; // Leaves its group.
      }

      win.splice(from, 1);
      win.splice(to, 0, tab);
      tab.groupId = group;
      let k = 0;
      tabs = tabs.map((t) => (t.windowId === tab.windowId ? win[k++] : t));
      return { ...tab };
    },
    /**
     * Into an existing group, or a new one in `createProperties.windowId` (else the focused
     * window). Like Chrome, tabs from other windows move over, and a new group's tabs are
     * stacked together where its first tab was. Chrome picks the colour.
     */
    async group({ groupId, tabIds, createProperties }) {
      const chosen = [tabIds].flat().map((id) => tabs.find((t) => t.id === id));
      if (chosen.some((t) => !t)) throw new Error('No tab with that id.');
      if (groupId !== undefined) {
        // Chrome removes a group once it has no tabs left.
        if (!tabs.some((t) => t.groupId === groupId)) throw new Error(`No group with id: ${groupId}.`);
        for (const t of chosen) t.groupId = groupId;
        return groupId;
      }
      const windowId = createProperties?.windowId ?? focusedWindowId;
      if (!openWindows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
      for (const t of chosen) {
        if (t.windowId === windowId) continue;
        tabs.splice(tabs.indexOf(t), 1);
        tabs.push(Object.assign(t, { windowId }));
      }
      const id = nextGroupId++;
      const ordered = tabs.filter((t) => chosen.includes(t));
      const at = tabs.indexOf(ordered[0]);
      const rest = tabs.filter((t) => !chosen.includes(t));
      const before = tabs.slice(0, at).filter((t) => !chosen.includes(t)).length;
      tabs = [...rest.slice(0, before), ...ordered, ...rest.slice(before)];
      for (const t of ordered) t.groupId = id;
      groups.set(id, { id, windowId, title: '', color: GROUP_COLORS[groups.size % GROUP_COLORS.length] });
      if (!incognito(windowId)) saved.push({ title: '', groupId: id });
      dropEmptyGroups(); // Tabs moved out of their old groups.
      return id;
    },
  };

  const tabGroupsApi = {
    async update(groupId, { title, color } = {}) {
      const group = groups.get(groupId);
      if (!group) throw new Error(`No group with id: ${groupId}.`);
      if (title !== undefined) group.title = title;
      if (color !== undefined) group.color = color;
      const copy = savedFor(groupId);
      if (copy) copy.title = group.title;
      return { ...group };
    },
    async get(groupId) {
      const group = groups.get(groupId);
      if (!group) throw new Error(`No group with id: ${groupId}.`);
      return { ...group };
    },
  };

  const windowsApi = {
    async get(id) {
      if (!openWindows.has(id)) throw new Error(`No window with id: ${id}.`);
      return { id, incognito: incognito(id) };
    },
    /** Closes the window and all its tabs at once: its groups stay saved (see `saved`). */
    async remove(id) {
      if (!openWindows.has(id)) throw new Error(`No window with id: ${id}.`);
      for (const [groupId, group] of groups) {
        if (group.windowId !== id) continue;
        const copy = savedFor(groupId);
        if (copy) Object.assign(copy, { urls: urlsIn(groupId), groupId: null });
        groups.delete(groupId);
      }
      tabs = tabs.filter((t) => t.windowId !== id);
      openWindows.delete(id);
    },
    async create({ url }) {
      const id = nextWindowId++;
      openWindows.add(id);
      const created = [url].flat().map((u) => ({ id: nextTabId++, windowId: id, groupId: -1, url: u }));
      tabs.push(...created);
      return { id, tabs: created.map((t) => ({ ...t })) };
    },
  };

  return {
    tabs: tabsApi,
    windows: windowsApi,
    tabGroups: tabGroupsApi,
    session: fakeStorage(),

    /** A tab as Chrome would pass it to a menu click. */
    tab: (id) => snapshot().find((t) => t.id === id),
    /** IDs of open tabs, in order. */
    get open() {
      return tabs.map((t) => t.id);
    },
    /** IDs of muted tabs. */
    get muted() {
      return tabs.filter((t) => t.mutedInfo?.muted).map((t) => t.id);
    },
    /** Window ID → URLs in tab order. */
    layout() {
      const out = {};
      for (const t of tabs) (out[t.windowId] ??= []).push(t.url);
      return out;
    },
    groupOf: (url) => tabs.find((t) => t.url === url)?.groupId,
    /** IDs of open windows. */
    get windowIds() {
      return [...openWindows];
    },
    /** Open groups: { title, color, windowId, urls }, in order of creation. */
    get groups() {
      return [...groups.values()].map((g) => ({ title: g.title, color: g.color, windowId: g.windowId, urls: urlsIn(g.id) }));
    },
    /** Chrome's saved groups: { title, urls, open }. */
    get saved() {
      return saved.map((g) => ({ title: g.title, urls: g.groupId === null ? g.urls : urlsIn(g.groupId), open: g.groupId !== null }));
    },
    /** Window ID → "url [g<groupId>]" in tab order, to check order and group membership together. */
    strip(windowId = 1) {
      return tabs
        .filter((t) => t.windowId === windowId)
        .map((t) => (t.groupId === -1 ? t.url : `${t.url} [g${t.groupId}]`));
    },
  };
}
