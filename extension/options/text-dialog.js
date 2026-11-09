/**
 * The page's one-field dialog (cr-dialog with a cr-input), for "Rename workspace", "Add site" and
 * "Edit site": a title, a labelled field, Cancel and an action button that stays disabled while
 * the text isn't valid, with the reason under the field. Markup: `#text-dialog` in options.html.
 *
 * @module options/text-dialog
 */
import { byId } from '../vendor/extension-kit/index.js';

const dialog = byId('text-dialog', HTMLDialogElement);
const input = byId('text-dialog-input', HTMLInputElement);
const error = byId('text-dialog-error');
const confirm = byId('text-dialog-confirm', HTMLButtonElement);

/**
 * What the dialog asks.
 *
 * @typedef {object} TextRequest
 * @property {string} title The dialog's title ("Add site").
 * @property {string} label The field's label ("Site").
 * @property {string} [value] The text to start with. Default ''.
 * @property {string} action The action button's text ("Add", "Save").
 * @property {(text: string) => string | null} [validate] The reason the text can't be used
 *   (shown under the field), or null when it can. Default: anything but blank.
 */

/** @type {(text: string) => string | null} */
let check = () => null;

/** Show whether the current text can be used. */
function refresh() {
  const reason = input.value.trim() ? check(input.value) : '';
  error.textContent = reason ?? '';
  error.hidden = !reason;
  confirm.disabled = reason !== null;
}
input.addEventListener('input', refresh);
// Enter means the action button, as in Chrome's dialogs (the form's first button is Cancel).
input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (!confirm.disabled) dialog.close('confirm');
});

/**
 * Ask for a piece of text.
 *
 * @param {TextRequest} request - What to ask.
 * @returns {Promise<string | null>} The text, trimmed; null when cancelled.
 */
export function askText({ title, label, value = '', action, validate = () => null }) {
  byId('text-dialog-title').textContent = title;
  byId('text-dialog-label').textContent = label;
  confirm.textContent = action;
  input.value = value;
  check = validate;
  refresh();
  dialog.returnValue = ''; // Escape keeps the last one.
  dialog.showModal();
  input.select();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm' ? input.value.trim() : null), { once: true });
  });
}
