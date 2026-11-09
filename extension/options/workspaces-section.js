/**
 * The settings page's Workspaces card: the saved workspaces, newest first, each a row with its
 * name and "2 windows · 24 tabs · Saved 9 Nov", and a ⋮ menu to open, rename, replace with the
 * current windows or delete it. Deleting and replacing show a toast with "Undo", as
 * chrome://bookmarks does. The list follows storage, so a workspace saved from the tab menu
 * shows up at once.
 *
 * @module options/workspaces-section
 */
import { askText, byId, createMenu, createToast, moreActionsButton } from '../vendor/extension-kit/index.js';
import { browserApis, runAction } from '../shared/actions.js';
import {
  loadWorkspaces, MAX_NAME_LENGTH, MAX_WORKSPACES, replaceWorkspace, updateWorkspaces, workspaceSummary, WORKSPACES_KEY,
} from '../shared/workspaces.js';

/** @import { Settings } from '../shared/settings.js' */
/** @import { Workspace } from '../shared/workspaces.js' */

const apis = browserApis(chrome);
const list = byId('workspace-list');
const empty = byId('no-workspaces');
const full = byId('workspaces-full');
const menu = createMenu();
const toast = createToast();

/** The page's current settings (for "Reopen tab groups"), from {@link startWorkspaces}. */
let settings = /** @type {() => Settings} */ (() => { throw new Error('startWorkspaces first'); });

/**
 * Put the workspace back as it was (after "Delete" or "Replace with current windows").
 *
 * @param {Workspace} old - The workspace as it was.
 * @returns {Promise<unknown>} Settles once stored.
 */
const restore = (old) => updateWorkspaces(chrome.storage.local, (all) => [...all.filter((w) => w.id !== old.id), old]);

/**
 * Run one of a workspace's ⋮ menu items.
 *
 * @param {Workspace} workspace - The workspace.
 * @param {'open' | 'rename' | 'replace' | 'delete'} command - The item.
 * @returns {Promise<void>} Settles once done.
 */
async function act(workspace, command) {
  if (command === 'open') {
    await runAction('open-workspace', undefined, apis, { settings: settings(), workspaceId: workspace.id });
  } else if (command === 'rename') {
    const name = await askText({ title: 'Rename workspace', label: 'Name', value: workspace.name, action: 'Save', maxLength: MAX_NAME_LENGTH });
    if (name) await updateWorkspaces(chrome.storage.local, (all) => all.map((w) => (w.id === workspace.id ? { ...w, name } : w)));
  } else if (command === 'replace') {
    const page = await chrome.tabs.getCurrent();
    const old = await replaceWorkspace(apis, workspace.id, { now: Date.now(), leaveOut: page?.id });
    if (old) toast.show(`Replaced “${old.name}” with your current windows`, () => restore(old));
  } else {
    await updateWorkspaces(chrome.storage.local, (all) => all.filter((w) => w.id !== workspace.id));
    toast.show(`Deleted “${workspace.name}”`, () => restore(workspace));
  }
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

  row.append(label, moreActionsButton(workspace.name, {
    onClick: (anchor) => menu.open([
      { label: 'Open', run: () => act(workspace, 'open') },
      { label: 'Rename', run: () => act(workspace, 'rename') },
      { label: 'Replace with current windows', run: () => act(workspace, 'replace') },
      { label: 'Delete', run: () => act(workspace, 'delete') },
    ], { anchor }),
  }));
  return row;
}

/** Show the stored workspaces. */
async function render() {
  const workspaces = await loadWorkspaces(chrome.storage.local);
  list.replaceChildren(...workspaces.map(workspaceRow));
  empty.hidden = workspaces.length > 0;
  full.hidden = workspaces.length < MAX_WORKSPACES;
}

/**
 * Wire up the card.
 *
 * @param {() => Settings} current - The page's current settings (for "Reopen tab groups").
 * @returns {Promise<void>} Settles once the list is shown.
 */
export async function startWorkspaces(current) {
  settings = current;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && WORKSPACES_KEY in changes) render();
  });
  await render();
}
