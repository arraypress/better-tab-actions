/**
 * A repeating `chrome.alarms` alarm kept in step with a setting: there while it's on, at the
 * period it asks for, and gone while it's off. From Chrome 150 an alarm lasts until the extension
 * updates, so asking on install, on browser start and when the settings change is enough.
 *
 * @module background/alarm
 */

/**
 * The chrome.alarms slice a schedule uses.
 *
 * @typedef {{
 *   get(name: string): Promise<chrome.alarms.Alarm | undefined>,
 *   create(name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void>,
 *   clear(name: string): Promise<boolean>,
 * }} AlarmsApi
 */

/**
 * Have the alarm run every `minutes`, or not at all. One already running at that period is left
 * alone, so a worker waking up doesn't push its next turn back.
 *
 * @param {AlarmsApi} alarms - `chrome.alarms`.
 * @param {string} name - The alarm's name.
 * @param {number} minutes - Its period; 0 for no alarm.
 * @returns {Promise<boolean>} True when the alarm was made (it wasn't running at that period).
 * @example
 * await keepAlarm(chrome.alarms, 'take-snapshot', settings.autoSnapshot ? settings.snapshotMinutes : 0);
 */
export async function keepAlarm(alarms, name, minutes) {
  if (!minutes) {
    await alarms.clear(name);
    return false;
  }
  if ((await alarms.get(name))?.periodInMinutes === minutes) return false;
  await alarms.create(name, { delayInMinutes: minutes, periodInMinutes: minutes });
  return true;
}
