/**
 * The settings page's Workspaces card: each saved workspace with its ⋮ menu (Open, Open in this
 * window, Rename, Replace with current windows, Delete), the toast with Undo, and the row that
 * exports them to a file and imports one (shared/transfer.js) after saying what it would add.
 * The list is drawn again whenever the stored workspaces change, wherever they changed.
 *
 * @module options/workspaces-section
 */
import { askText, byId, counted, createToast } from '../vendor/extension-kit/index.js';
import { browserApis, runAction } from '../shared/actions.js';
import { readWorkspacesFile, workspacesFile } from '../shared/transfer.js';
import {
  loadWorkspaces, MAX_NAME_LENGTH, MAX_WORKSPACES, openWorkspace, replaceWorkspace, updateWorkspaces, workspaceSummary, WORKSPACES_KEY,
} from '../shared/workspaces.js';
import { confirm } from './confirm.js';
import { drawList } from './saved-list.js';

/** @import { Settings } from '../shared/settings.js' */
/** @import { Words } from '../shared/text.js' */
/** @import { ImportPreview } from '../shared/transfer.js' */
/** @import { Workspace } from '../shared/workspaces.js' */
/** @import { Toast } from '../vendor/extension-kit/ui/toast.js' */

const apis = browserApis(chrome);
const list = byId('workspace-list');
const exportButton = byId('export-workspaces', HTMLButtonElement);
const importFile = byId('import-file', HTMLInputElement);

/** The page's current settings (for "Reopen tab groups"). Set by {@link startWorkspaces}. */
let settings = /** @type {() => Settings} */ (() => { throw new Error('startWorkspaces first'); });
/** @type {Words} */
let words;
/** @type {Toast} */
let toast;

/**
 * Open some saved windows in the window this page is in, at the end of its tabs.
 *
 * @param {Pick<Workspace, 'windows'>} saved - A workspace, or a snapshot.
 * @returns {Promise<void>}
 */
export async function openHere(saved) {
  const page = await chrome.tabs.getCurrent();
  if (page) await openWorkspace(apis, saved, { reopenGroups: settings().reopenGroups, windowId: page.windowId });
}

/**
 * Put workspaces back as they were: an Undo.
 *
 * @param {Workspace} old - The workspace before the change.
 * @returns {Promise<Workspace[]>} The list as stored.
 */
const restore = (old) => updateWorkspaces(chrome.storage.local, (all) => [...all.filter((w) => w.id !== old.id), old]);

/**
 * Take workspaces away again: the Undo of adding them.
 *
 * @param {readonly Workspace[]} added - The workspaces.
 * @returns {Promise<Workspace[]>} The list as stored.
 */
export const takeBack = (added) => updateWorkspaces(chrome.storage.local, (all) => all.filter((w) => !added.some((a) => a.id === w.id)));

/**
 * A workspace's ⋮ menu.
 *
 * @param {Workspace} workspace - The workspace.
 * @returns {{label: string, run: () => unknown}[]} Its items.
 */
function actionsFor(workspace) {
  const { t } = words;
  return [
    { label: t('workspaceOpen'), run: () => runAction('open-workspace', undefined, apis, { settings: settings(), workspaceId: workspace.id }) },
    { label: t('workspaceOpenHere'), run: () => openHere(workspace) },
    {
      label: t('workspaceRename'),
      run: async () => {
        const name = await askText({
          title: t('workspaceRenameTitle'), label: t('workspaceNameLabel'), value: workspace.name,
          action: t('optionsSave'), cancel: t('optionsCancel'), maxLength: MAX_NAME_LENGTH,
        });
        if (name) await updateWorkspaces(chrome.storage.local, (all) => all.map((w) => (w.id === workspace.id ? { ...w, name } : w)));
      },
    },
    {
      label: t('workspaceReplace'),
      run: async () => {
        const page = await chrome.tabs.getCurrent();
        const old = await replaceWorkspace(apis, workspace.id, { now: Date.now(), leaveOut: page?.id });
        if (old) toast.show(t('toastReplaced', [old.name]), () => restore(old));
      },
    },
    {
      label: t('workspaceDelete'),
      run: async () => {
        await updateWorkspaces(chrome.storage.local, (all) => all.filter((w) => w.id !== workspace.id));
        toast.show(t('toastDeleted', [workspace.name]), () => restore(workspace));
      },
    },
  ];
}

/** Draw the list from storage: the rows, else the empty line; the "full" line at the limit. */
async function render() {
  const workspaces = await loadWorkspaces(chrome.storage.local);
  drawList(list, workspaces.map((workspace) => ({
    id: workspace.id, title: workspace.name, summary: workspaceSummary(workspace, Date.now(), words), actions: actionsFor(workspace),
  })), words, byId('reopenGroups'));
  byId('no-workspaces').hidden = workspaces.length > 0;
  byId('workspaces-full').hidden = workspaces.length < MAX_WORKSPACES;
  exportButton.disabled = workspaces.length === 0;
}

/** Download every workspace as one file, through a link (no permission needed). */
async function exportAll() {
  const workspaces = await loadWorkspaces(chrome.storage.local);
  if (!workspaces.length) return;
  const { filename, text } = workspacesFile(workspaces, Date.now());
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  toast.show(counted(workspaces.length, 'toastExportedOne', 'toastExported', words));
}

/**
 * What a file would do, in a sentence: "2 new workspaces, 1 already here, 3 tabs that can’t be
 * reopened", as the person's language writes a list.
 *
 * @param {ImportPreview} preview - What the file holds.
 * @returns {string} The parts that aren't zero, joined; '' when there are none.
 */
function previewText({ fresh, existing, skipped, noRoom }) {
  const parts = [
    fresh.length && counted(fresh.length, 'importNewOne', 'importNew', words),
    existing && counted(existing, 'importExistingOne', 'importExisting', words),
    noRoom && counted(noRoom, 'importNoRoomOne', 'importNoRoom', words),
    skipped && counted(skipped, 'importSkippedOne', 'importSkipped', words),
  ].filter((part) => typeof part === 'string');
  return new Intl.ListFormat(words.lang, { type: 'unit', style: 'long' }).format(parts);
}

/**
 * Read a chosen file, say what it would add, and add it once that's confirmed.
 *
 * @param {File} file - The file.
 * @returns {Promise<void>}
 */
async function importFrom(file) {
  const { t } = words;
  const [kept, fileAccess] = await Promise.all([loadWorkspaces(chrome.storage.local), chrome.extension.isAllowedFileSchemeAccess()]);
  const read = readWorkspacesFile(await file.text(), { kept, fileAccess, now: Date.now(), locale: words.lang });
  if ('problem' in read) {
    toast.show(read.problem === 'newer' ? t('importNewer') : t('importNotOurs'));
    return;
  }
  const details = previewText(read);
  if (!read.fresh.length) {
    toast.show(details ? t('importNothingBecause', [details]) : t('importNothing'));
    return;
  }
  if (!await confirm({ title: t('importTitle'), text: details, action: t('optionsImport'), cancel: t('optionsCancel') })) return;
  // Against what's stored now, not when the file was read: never over the limit, never a second copy.
  const again = readWorkspacesFile(await file.text(), { kept: await loadWorkspaces(chrome.storage.local), fileAccess, now: Date.now(), locale: words.lang });
  const fresh = 'problem' in again ? [] : again.fresh;
  await updateWorkspaces(chrome.storage.local, (all) => [...fresh, ...all]);
  toast.show(counted(fresh.length, 'toastImportedOne', 'toastImported', words), () => takeBack(fresh));
}

/**
 * Start the Workspaces card.
 *
 * @param {() => Settings} current - The page's settings, as they are now.
 * @param {Words} pageWords - The extension's words.
 * @returns {Promise<Toast>} The page's toast, once the list is drawn.
 */
export async function startWorkspaces(current, pageWords) {
  settings = current;
  words = pageWords;
  toast = createToast({ undoLabel: words.t('toastUndo') });
  exportButton.addEventListener('click', exportAll);
  byId('import-workspaces').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const [file] = importFile.files ?? [];
    importFile.value = ''; // So choosing the same file again is a change.
    if (file) await importFrom(file);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && WORKSPACES_KEY in changes) render();
  });
  await render();
  return toast;
}
