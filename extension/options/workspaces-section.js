/**
 * The settings page's Workspaces card: the saved workspaces, newest first, each a row with its
 * name and "2 windows · 24 tabs · Saved 9 Nov", and a ⋮ menu to open, rename, replace with the
 * current windows or delete it. Deleting and replacing show a toast with "Undo", as
 * chrome://bookmarks does. The list follows storage, so a workspace saved from the tab menu
 * shows up at once.
 *
 * @module options/workspaces-section
 */
import { byId } from '../vendor/extension-kit/index.js';
import { browserApis, runAction } from '../shared/actions.js';
import {
  loadWorkspaces, MAX_WORKSPACES, replaceWorkspace, updateWorkspaces, workspaceSummary, WORKSPACES_KEY,
} from '../shared/workspaces.js';
import { closeOnOutsideClick, showMenu } from './action-menu.js';

/** @import { Settings } from '../shared/settings.js' */
/** @import { Workspace } from '../shared/workspaces.js' */

/** How long a toast stays, as chrome://bookmarks's. */
const TOAST_MS = 10_000;

const apis = browserApis(chrome);
const list = byId('workspace-list');
const empty = byId('no-workspaces');
const full = byId('workspaces-full');
const menu = byId('workspace-menu', HTMLDialogElement);
const renameDialog = byId('rename-dialog', HTMLDialogElement);
const renameInput = byId('rename-name', HTMLInputElement);
const toast = byId('toast');

/** @type {Workspace[]} */
let workspaces = [];
/** The workspace whose ⋮ menu is open (or whose rename dialog is). */
let current = /** @type {Workspace | undefined} */ (undefined);

/**
 * Put the workspace back as it was (after "Delete" or "Replace with current windows").
 *
 * @param {Workspace} old - The workspace as it was.
 * @returns {Promise<unknown>} Settles once stored.
 */
const restore = (old) => updateWorkspaces(chrome.storage.local, (all) => [...all.filter((w) => w.id !== old.id), old]);

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
/**
 * Show a toast with "Undo".
 *
 * @param {string} text - What happened.
 * @param {() => unknown} undo - Undoes it.
 */
function showToast(text, undo) {
  byId('toast-text').textContent = text;
  byId('toast-undo').onclick = () => {
    toast.hidden = true;
    undo();
  };
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
}

/**
 * One workspace's row: its name and summary, and its ⋮ button.
 *
 * @param {Workspace} workspace - The workspace.
 * @returns {HTMLLIElement} The row.
 */
function workspaceRow(workspace) {
  const row = document.createElement('li');
  row.className = 'row two-line';
  row.dataset.id = workspace.id;
  const label = document.createElement('span');
  label.className = 'label';
  const name = document.createElement('span');
  name.textContent = workspace.name;
  const summary = document.createElement('span');
  summary.className = 'secondary';
  summary.textContent = workspaceSummary(workspace, Date.now());
  label.append(name, summary);

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'icon-button';
  more.setAttribute('aria-label', `More actions for “${workspace.name}”`);
  more.setAttribute('aria-haspopup', 'menu');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-more-vert');
  icon.append(use);
  more.append(icon);
  more.addEventListener('click', () => {
    current = workspace;
    showMenu(menu, more);
  });
  row.append(label, more);
  return row;
}

/** Show the stored workspaces. */
async function render() {
  workspaces = await loadWorkspaces(chrome.storage.local);
  list.replaceChildren(...workspaces.map(workspaceRow));
  empty.hidden = workspaces.length > 0;
  full.hidden = workspaces.length < MAX_WORKSPACES;
}

/**
 * Wire up the card.
 *
 * @param {() => Settings} settings - The page's current settings (for "Reopen tab groups").
 * @returns {Promise<void>} Settles once the list is shown.
 */
export async function startWorkspaces(settings) {
  closeOnOutsideClick(menu);
  menu.addEventListener('click', async (event) => {
    const item = event.target instanceof Element ? event.target.closest('[data-command]') : null;
    const workspace = current;
    if (!(item instanceof HTMLElement) || !workspace) return;
    menu.close();
    const command = item.dataset.command;
    if (command === 'open') {
      await runAction('open-workspace', undefined, apis, { settings: settings(), workspaceId: workspace.id });
    } else if (command === 'rename') {
      renameInput.value = workspace.name;
      renameDialog.returnValue = ''; // Escape keeps the last one.
      renameDialog.showModal();
      renameInput.select();
    } else if (command === 'replace') {
      const page = await chrome.tabs.getCurrent();
      const old = await replaceWorkspace(apis, workspace.id, { now: Date.now(), leaveOut: page?.id });
      if (old) showToast(`Replaced “${old.name}” with your current windows`, () => restore(old));
    } else if (command === 'delete') {
      await updateWorkspaces(chrome.storage.local, (all) => all.filter((w) => w.id !== workspace.id));
      showToast(`Deleted “${workspace.name}”`, () => restore(workspace));
    }
  });

  renameDialog.addEventListener('close', () => {
    const name = renameInput.value.trim();
    const workspace = current;
    if (renameDialog.returnValue !== 'save' || !name || !workspace) return;
    updateWorkspaces(chrome.storage.local, (all) => all.map((w) => (w.id === workspace.id ? { ...w, name } : w)));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && WORKSPACES_KEY in changes) render();
  });
  await render();
}
