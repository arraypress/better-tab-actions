/**
 * "Never close tabs from these sites", as chrome://settings/performance lists the sites Memory
 * Saver keeps active: an "Add" button, a row per site with a ⋮ menu ("Edit", "Remove"), and "No
 * sites added" while there are none. Sites are typed into the page's one-field dialog and kept
 * as hosts (`siteFromInput`).
 *
 * @module options/keep-sites
 */
import { byId } from '../vendor/extension-kit/index.js';
import { siteFromInput } from '../shared/sites.js';
import { closeOnOutsideClick, moreActionsButton, showMenu } from './action-menu.js';
import { askText } from './text-dialog.js';

/** @import { Settings } from '../shared/settings.js' */

const list = byId('site-list');
const empty = byId('no-sites');
const menu = byId('site-menu', HTMLDialogElement);

/** The site whose ⋮ menu is open. */
let current = '';

/**
 * Ask for a site, refusing anything that isn't one.
 *
 * @param {string} title - "Add site" or "Edit site".
 * @param {string} action - "Add" or "Save".
 * @param {string} [value] - The site to start with.
 * @returns {Promise<string | null>} The site as kept (a host), or null when cancelled.
 */
async function askSite(title, action, value) {
  const text = await askText({
    title, label: 'Site', value, action,
    validate: (typed) => (siteFromInput(typed) ? null : 'Enter a site, like example.com'),
  });
  return text === null ? null : siteFromInput(text);
}

/**
 * Show the sites.
 *
 * @param {readonly string[]} sites - The kept sites.
 * @returns {void}
 */
export function renderSites(sites) {
  list.replaceChildren(...sites.map((site) => {
    const row = document.createElement('li');
    row.className = 'row';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = site;
    row.append(label, moreActionsButton(site, (button) => {
      current = site;
      showMenu(menu, button);
    }));
    return row;
  }));
  empty.hidden = sites.length > 0;
}

/**
 * Wire up the list.
 *
 * @param {() => Settings} settings - The page's current settings.
 * @param {(sites: string[]) => void} save - Stores a new list (and shows it).
 * @returns {void}
 */
export function startSites(settings, save) {
  closeOnOutsideClick(menu);
  byId('add-site').addEventListener('click', async () => {
    const site = await askSite('Add site', 'Add');
    if (site) save([...settings().keepSites.filter((s) => s !== site), site]);
  });
  menu.addEventListener('click', async (event) => {
    const item = event.target instanceof Element ? event.target.closest('[data-command]') : null;
    if (!(item instanceof HTMLElement) || !current) return;
    const site = current;
    menu.close();
    const sites = settings().keepSites;
    if (item.dataset.command === 'remove') {
      save(sites.filter((s) => s !== site));
    } else if (item.dataset.command === 'edit') {
      const edited = await askSite('Edit site', 'Save', site);
      if (edited) save([...new Set(sites.map((s) => (s === site ? edited : s)))]);
    }
  });
}
