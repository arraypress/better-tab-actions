/**
 * What more than one test file needs besides the fakes: the extension's real words, and a way to
 * hear what's logged.
 *
 * @module test/helpers
 */
import { fileURLToPath } from 'node:url';
import { messageLookup } from '@arraypress/extension-kit/testing';
import { wordsOf } from '../extension/shared/text.js';

/** @import { Words } from '../extension/shared/text.js' */

/** The extension's folder. */
export const EXTENSION = fileURLToPath(new URL('../extension/', import.meta.url));

/**
 * `chrome.i18n` over the extension's real `_locales` (en), in a British English Chrome.
 *
 * @type {{getMessage(key: string, substitutions?: string | string[]): string, getUILanguage(): string}}
 */
export const I18N = { getMessage: messageLookup(EXTENSION), getUILanguage: () => 'en-GB' };

/**
 * The extension's words, as its pages and worker get them from `chrome.i18n`.
 *
 * @type {Words}
 */
export const WORDS = wordsOf(I18N);

/**
 * Capture what's logged with `console.error` while `body` runs, and keep it off the test output.
 *
 * @param {() => Promise<unknown>} body - What to run.
 * @returns {Promise<string[]>} Each call's arguments, joined with a space.
 * @example
 * const logged = await errorsLogged(() => openWorkspace(apis, workspace, options));
 * assert.match(logged[0], /^Reopening a window:/);
 */
export async function errorsLogged(body) {
  const real = console.error;
  /** @type {string[]} */
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  try {
    await body();
  } finally {
    console.error = real;
  }
  return logged;
}

/**
 * A menu entry by its id, wherever it is: at the first level or inside a submenu.
 *
 * @param {readonly import('../extension/shared/actions.js').MenuEntry[]} entries - The menu's entries.
 * @param {string} id - An action, or a submenu.
 * @returns {import('../extension/shared/actions.js').MenuEntry | undefined} The entry, if it's in the menu.
 */
export function entryOf(entries, id) {
  for (const entry of entries) {
    const found = entry.id === id ? entry : entryOf(entry.children ?? [], id);
    if (found) return found;
  }
  return undefined;
}
