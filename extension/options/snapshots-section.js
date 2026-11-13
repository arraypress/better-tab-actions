/**
 * The settings page's Snapshots card: "Take snapshot", and each snapshot (shared/snapshots.js)
 * under the time it was taken, newest first, with its ⋮ menu (Open, Open in this window, Save as
 * workspace, Delete). Says so when the manual ones are at their limit, and when an automatic one
 * couldn't be kept. Drawn again whenever the stored snapshots change.
 *
 * @module options/snapshots-section
 */
import { byId } from '../vendor/extension-kit/index.js';
import { browserApis } from '../shared/actions.js';
import {
  loadSnapshots, MAX_MANUAL, PROBLEM_KEY, roomForManual, saveSnapshotAsWorkspace, SNAPSHOTS_KEY, snapshotSummary, takeSnapshot,
  updateSnapshots,
} from '../shared/snapshots.js';
import { dateTime } from '../shared/text.js';
import { MAX_WORKSPACES, openWorkspace } from '../shared/workspaces.js';
import { drawList } from './saved-list.js';
import { openHere, takeBack } from './workspaces-section.js';

/** @import { Settings } from '../shared/settings.js' */
/** @import { Snapshot } from '../shared/snapshots.js' */
/** @import { Words } from '../shared/text.js' */
/** @import { Toast } from '../vendor/extension-kit/ui/toast.js' */

const apis = browserApis(chrome);
const takeButton = byId('take-snapshot', HTMLButtonElement);

/**
 * Start the Snapshots card.
 *
 * @param {() => Settings} settings - The page's settings, as they are now.
 * @param {Words} words - The extension's words.
 * @param {Toast} toast - The page's toast.
 * @returns {Promise<void>} Settles once the list is drawn.
 */
export async function startSnapshots(settings, words, toast) {
  const { t } = words;
  byId('snapshots-full-text').textContent = t('snapshotsFull', [String(MAX_MANUAL)]);

  /**
   * A snapshot's ⋮ menu.
   *
   * @param {Snapshot} snapshot - The snapshot.
   * @param {string} title - The time it was taken, as its row says it.
   * @returns {{label: string, run: () => unknown}[]} Its items.
   */
  const actionsFor = (snapshot, title) => [
    { label: t('workspaceOpen'), run: () => openWorkspace(apis, snapshot, { reopenGroups: settings().reopenGroups }) },
    { label: t('workspaceOpenHere'), run: () => openHere(snapshot) },
    {
      label: t('snapshotSaveAs'),
      run: async () => {
        const workspace = await saveSnapshotAsWorkspace(chrome.storage.local, snapshot.id, { now: Date.now(), locale: words.lang });
        if (workspace) toast.show(t('toastSavedAs', [workspace.name]), () => takeBack([workspace]));
        else toast.show(t('optionsWorkspacesFull', [String(MAX_WORKSPACES)]));
      },
    },
    {
      label: t('workspaceDelete'),
      run: async () => {
        await updateSnapshots(chrome.storage.local, (all) => all.filter((s) => s.id !== snapshot.id));
        toast.show(t('toastDeleted', [title]), () => updateSnapshots(chrome.storage.local, (all) => [...all.filter((s) => s.id !== snapshot.id), snapshot]));
      },
    },
  ];

  /** Draw the list from storage, and the lines about the limit and a snapshot that couldn't be kept. */
  async function render() {
    const [snapshots, { [PROBLEM_KEY]: problem }] = await Promise.all([loadSnapshots(chrome.storage.local), chrome.storage.session.get([PROBLEM_KEY])]);
    drawList(byId('snapshot-list'), snapshots.map((snapshot) => {
      const title = dateTime(snapshot.savedAt, words.lang);
      return { id: snapshot.id, title, summary: snapshotSummary(snapshot, words), actions: actionsFor(snapshot, title) };
    }), words, takeButton);
    byId('snapshots-full').hidden = roomForManual(snapshots);
    byId('snapshot-problem').hidden = !problem;
  }

  takeButton.addEventListener('click', async () => {
    const page = await chrome.tabs.getCurrent();
    const result = await takeSnapshot(apis, { auto: false, now: Date.now(), leaveOut: page?.id });
    const said = { kept: t('toastSnapshotTaken'), nothing: t('toastSnapshotNothing'), full: t('snapshotsFull', [String(MAX_MANUAL)]), failed: t('snapshotProblem') };
    if (result !== 'unchanged') toast.show(said[result]);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' && SNAPSHOTS_KEY in changes) || (area === 'session' && PROBLEM_KEY in changes)) render();
  });
  await render();
}
