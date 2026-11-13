/**
 * Chrome's confirmation dialog (cr-dialog): a title, a line of text, Cancel and an action button,
 * styled by chrome-ui.css's `.dialog`. Enter means the action, Esc and Cancel cancel, and the
 * focus goes back to what opened it. (The kit's dialog always has a field to type in.)
 *
 * @module options/confirm
 */
import { make } from '../vendor/extension-kit/index.js';

/**
 * Ask whether to go ahead.
 *
 * @param {{title: string, text: string, action: string, cancel: string}} request - What to ask.
 * @returns {Promise<boolean>} True when the action button was chosen.
 * @example
 * if (await confirm({ title: 'Import workspaces', text: '2 new workspaces', action: 'Import', cancel: 'Cancel' })) add();
 */
export function confirm({ title, text, action, cancel }) {
  const opener = /** @type {HTMLElement | null} */ (document.activeElement);
  const dialog = make('dialog', 'dialog');
  dialog.id = 'confirm-dialog';
  const form = make('form');
  form.method = 'dialog';
  const heading = make('h2', 'dialog-title', title);
  heading.id = 'confirm-dialog-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  const body = make('div', 'dialog-body', text);
  body.id = 'confirm-dialog-text';
  dialog.setAttribute('aria-describedby', body.id);
  const buttons = make('div', 'dialog-buttons');
  const no = make('button', '', cancel);
  no.value = 'cancel';
  const yes = make('button', 'action', action);
  yes.value = 'confirm';
  buttons.append(no, yes);
  form.append(heading, body, buttons);
  dialog.append(form);
  document.body.append(dialog);
  dialog.returnValue = 'cancel';
  dialog.showModal();
  yes.focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      opener?.focus();
      resolve(dialog.returnValue === 'confirm');
    }, { once: true });
  });
}
