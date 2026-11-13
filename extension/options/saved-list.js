/**
 * The lists of saved things on the settings page (workspaces, snapshots): a row for each, with
 * its name, a line about it and a ⋮ menu, as chrome://settings lists site searches. A list keeps
 * the keyboard focus when it's drawn again: on the same row if it's still there, else the row
 * that took its place, else somewhere given (the kit keeps focus this way inside its site list
 * only).
 *
 * @module options/saved-list
 */
import { createMenu, focusedIn, make, moreActionsButton } from '../vendor/extension-kit/index.js';

/** @import { Words } from '../shared/text.js' */

/**
 * One row of a list.
 *
 * @typedef {object} SavedRow
 * @property {string} id What it shows: a workspace's or snapshot's id.
 * @property {string} title Its name.
 * @property {string} summary The line under it.
 * @property {{label: string, run: () => unknown}[]} actions Its ⋮ menu.
 */

/** The page's one ⋮ menu, shared by every list. */
const menu = createMenu();

/**
 * Draw a list's rows.
 *
 * @param {HTMLElement} list - The `<ul>`.
 * @param {readonly SavedRow[]} rows - Its rows, in order.
 * @param {Words} words - The extension's words, for the ⋮ button's label.
 * @param {HTMLElement} fallback - Where the focus goes if it was in the list and no row is left.
 */
export function drawList(list, rows, words, fallback) {
  const focused = focusedIn(list);
  const old = /** @type {HTMLElement[]} */ ([...list.children]);
  const at = focused ? old.findIndex((row) => row.contains(focused)) : -1;
  const id = old[at]?.dataset.id;

  list.replaceChildren(...rows.map(({ id, title, summary, actions }) => {
    const row = make('li', 'row two-line');
    row.dataset.id = id;
    const label = make('span', 'label');
    label.append(make('span', '', title), make('span', 'secondary', summary));
    row.append(label, moreActionsButton(title, {
      label: words.t('optionsMoreActions', [title]),
      onClick: (anchor) => menu.open(actions, { anchor }),
    }));
    return row;
  }));
  if (at < 0) return;
  const same = rows.findIndex((row) => row.id === id);
  const row = list.children[same >= 0 ? same : Math.min(at, rows.length - 1)];
  (row?.querySelector('button') ?? fallback).focus();
}
