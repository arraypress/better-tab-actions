/**
 * Moves settings into Chrome Sync for installs made before syncing was always on. The
 * background runs it on install, update and startup, before reading settings; it is safe to run
 * any number of times (once moved, there is nothing left to move).
 *
 * Where earlier builds kept settings:
 * - the first builds: in chrome.storage.sync, one item per setting, as now;
 * - then: in chrome.storage.local, with an opt-in switch (`syncSettings`, local) that mirrored
 *   them into one sync item (`settings`).
 *
 * Sync wins: a setting already in sync (from another computer) stays; the old mirrored item
 * comes next; this computer's local copy fills whatever is left. Old copies are removed only
 * after their values are safely written (or held for sync by writeSynced), so nothing is lost.
 */
import { DEFAULTS, LOCAL_KEYS, SYNCED_KEYS, normalizeSettings, writeSynced } from '../shared/settings.js';

/** In chrome.storage.local: the old opt-in switch. */
export const OLD_SWITCH = 'syncSettings';
/** In chrome.storage.sync: the old switch's one mirrored item. */
export const OLD_SYNC_ITEM = 'settings';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The settings in `object` this version can read (junk, or a newer version's choice, is left out). */
function readable(object) {
  const kept = {};
  for (const key of SYNCED_KEYS.filter((key) => key in object)) {
    const value = normalizeSettings({ [key]: object[key] })[key];
    // The normaliser falls back to the default for what it can't read; a real default stays.
    if (!same(value, DEFAULTS[key]) || same(object[key], DEFAULTS[key])) kept[key] = value;
  }
  return kept;
}

export async function moveSettingsToSync(storage) {
  const [local, synced] = await Promise.all([
    storage.local.get([...SYNCED_KEYS, OLD_SWITCH]),
    storage.sync.get([...SYNCED_KEYS, OLD_SYNC_ITEM]),
  ]);
  const { [OLD_SYNC_ITEM]: mirrored, ...inSync } = synced;
  // Through the normaliser, so nothing unreadable reaches sync; an unreadable mirrored value
  // leaves this computer's own.
  const older = { ...readable(local), ...(mirrored && typeof mirrored === 'object' ? readable(mirrored) : {}) };
  const values = Object.fromEntries(Object.entries(older).filter(([key]) => !(key in inSync)));
  // Also retries anything sync refused before.
  await writeSynced(storage, values);

  // Settings tied to this computer (LOCAL_KEYS) stay where they are.
  const stale = Object.keys(local).filter((key) => !LOCAL_KEYS.includes(key));
  if (stale.length) await storage.local.remove(stale);
  if (mirrored !== undefined) await storage.sync.remove(OLD_SYNC_ITEM);
}
