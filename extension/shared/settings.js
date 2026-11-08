/**
 * Settings, their defaults, and loading/saving them.
 *
 * They live in chrome.storage.sync, one item per setting, so they follow the user to their
 * other computers through their own Chrome Sync, like Chrome's own settings. They are plain
 * preferences (which menu items show, days, windows), not personal data, and Chrome Sync keeps
 * them in the user's own Google account: the developer receives nothing, so "no data
 * collected" stays true. (Signed out of Chrome, sync storage simply stays on the computer.)
 *
 * chrome.storage.local holds only a write sync refused (see writeSynced): kept here and
 * retried, so a change is never lost. Nothing here is tied to one computer.
 */

export const DEFAULTS = Object.freeze({
  /** IDs of actions hidden from the menu (they still work as shortcuts). */
  hiddenActions: [],
  /** "Close tabs not used in N days". */
  inactiveDays: 7,
  /** Site, duplicate and inactive closing: the clicked tab's 'window' only, or 'all' windows. */
  windowScope: 'window',
  /** Whether close actions may close tabs that are in a tab group. */
  includeGroupedTabs: true,
});

export const MIN_DAYS = 1;
export const MAX_DAYS = 365;

/** Settings tied to one computer, kept in chrome.storage.local: none here. */
export const LOCAL_KEYS = Object.freeze([]);
export const SYNCED_KEYS = Object.freeze(Object.keys(DEFAULTS).filter((key) => !LOCAL_KEYS.includes(key)));
/** In chrome.storage.local: synced settings Chrome Sync hasn't taken yet, { key: value }. */
export const UNSYNCED = 'unsyncedSettings';
/** Chrome refuses a sync item over 8,192 bytes (key plus JSON value). */
const MAX_ITEM_BYTES = 8192;

/** Coerce anything read from storage (or a form) into valid settings, falling back to defaults. */
export function normalizeSettings(raw = {}) {
  const days = Math.round(Number(raw.inactiveDays));
  return {
    hiddenActions: Array.isArray(raw.hiddenActions)
      ? [...new Set(raw.hiddenActions.filter((id) => typeof id === 'string'))]
      : [...DEFAULTS.hiddenActions],
    inactiveDays: Number.isFinite(days)
      ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, days))
      : DEFAULTS.inactiveDays,
    windowScope: raw.windowScope === 'all' || raw.windowScope === 'window' ? raw.windowScope : DEFAULTS.windowScope,
    includeGroupedTabs:
      typeof raw.includeGroupedTabs === 'boolean' ? raw.includeGroupedTabs : DEFAULTS.includeGroupedTabs,
  };
}

const pick = (object, keys) => Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, object[key]]));
const bytes = (key, value) => new TextEncoder().encode(key + JSON.stringify(value)).length;

/** Read settings from chrome.storage (`storage` has .sync and .local). */
export async function loadSettings(storage) {
  const [synced, local] = await Promise.all([
    storage.sync.get([...SYNCED_KEYS]),
    storage.local.get([...LOCAL_KEYS, UNSYNCED]),
  ]);
  const { [UNSYNCED]: unsynced = {}, ...here } = local;
  return normalizeSettings({ ...synced, ...pick(unsynced, SYNCED_KEYS), ...here });
}

/**
 * Start a sync write of `values` at once; resolves to what sync refused. An item too big for sync
 * isn't even tried.
 */
function send(storage, values) {
  const entries = Object.entries(values);
  const fits = Object.fromEntries(entries.filter(([key, value]) => bytes(key, value) <= MAX_ITEM_BYTES));
  const refused = Object.fromEntries(entries.filter(([key]) => !(key in fits)));
  if (!Object.keys(fits).length) return Promise.resolve(refused);
  return storage.sync.set(fits).then(() => refused, (error) => {
    console.warn('Settings: Chrome Sync refused the change; keeping it on this computer and trying again later.', error?.message ?? error);
    return { ...refused, ...fits };
  });
}

/**
 * Write synced settings in one sync write (sync allows 120 a minute), then any that sync refused
 * before. What sync refuses (too many writes, or an item too big for it) is kept in local, where
 * loadSettings still reads it, and goes up with the next write or retryUnsynced. Resolves to
 * whether everything reached sync.
 */
export async function writeSynced(storage, values) {
  // Sent before anything is awaited, so a page that's closing still gets it out.
  const sending = send(storage, values);
  const { [UNSYNCED]: held } = await storage.local.get([UNSYNCED]);
  let refused = await sending;
  const older = Object.fromEntries(Object.entries(pick(held ?? {}, SYNCED_KEYS)).filter(([key]) => !(key in values)));
  if (Object.keys(older).length) refused = { ...(await send(storage, older)), ...refused };
  if (Object.keys(refused).length) await storage.local.set({ [UNSYNCED]: refused });
  else if (held) await storage.local.remove(UNSYNCED);
  return !Object.keys(refused).length;
}

/** Try again to put settings sync refused earlier into sync. */
export const retryUnsynced = (storage) => writeSynced(storage, {});

/**
 * Save `changes`. Only the settings it names are written, so a change made meanwhile on another
 * computer to a different setting survives. Each setting normalises on its own, so nothing is
 * read first and the writes start at once. Resolves to all the settings, and whether sync took them.
 */
export async function saveSettings(storage, changes) {
  const values = pick(normalizeSettings(changes), Object.keys(changes));
  const local = pick(values, LOCAL_KEYS);
  const writingLocal = Object.keys(local).length ? storage.local.set(local) : null;
  const synced = await writeSynced(storage, pick(values, SYNCED_KEYS));
  await writingLocal;
  return { settings: await loadSettings(storage), synced };
}

/** The settings a chrome.storage.onChanged event touches (including ones held for sync). */
export function changedSettings(changes, area) {
  if (area === 'sync') return SYNCED_KEYS.filter((key) => key in changes);
  if (area !== 'local') return [];
  const held = changes[UNSYNCED] ? Object.keys({ ...changes[UNSYNCED].oldValue, ...changes[UNSYNCED].newValue }) : [];
  return Object.keys(DEFAULTS).filter((key) => LOCAL_KEYS.includes(key) ? key in changes : held.includes(key));
}

/**
 * Saving for the options page. Changes apply at once in `settings`, but reach storage only once
 * the clicks stop for `delay` ms, so a burst of toggles is one sync write (sync allows 120 a
 * minute). If sync refuses, the change is kept on this computer (writeSynced) and tried again
 * after `retryAfter` ms. `flush()` writes now (the page calls it as it's hidden or closed).
 */
export function settingsSaver(storage, { delay = 1000, retryAfter = 60_000, onSaved = () => {} } = {}) {
  let pending = {};
  let timer;
  let retryTimer;
  let writing = Promise.resolve();

  /** Track a write so flush() can be awaited (tests). */
  const track = (promise) => {
    writing = Promise.all([writing, promise.catch((error) => console.error('Saving settings:', error))]);
    return writing;
  };

  /** Writes start at once, not after earlier ones finish: Chrome applies them in order. */
  function flush() {
    clearTimeout(timer);
    const changes = pending;
    pending = {};
    if (!Object.keys(changes).length) return writing;
    return track(saveSettings(storage, changes).then(({ settings, synced }) => {
      clearTimeout(retryTimer);
      if (!synced) retryTimer = setTimeout(retry, retryAfter);
      onSaved(settings);
    }));
  }

  function retry() {
    track(retryUnsynced(storage).then((synced) => {
      if (!synced) retryTimer = setTimeout(retry, retryAfter);
    }));
  }

  return {
    /** Changes not yet written, to lay over what storage holds. */
    get pending() { return { ...pending }; },
    save(changes) {
      pending = { ...pending, ...changes };
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    /** Stop the timers (tests). */
    stop() { clearTimeout(timer); clearTimeout(retryTimer); },
  };
}
