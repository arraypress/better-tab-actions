/**
 * "Never close tabs from these sites", as chrome://settings/performance lists the sites Memory
 * Saver keeps active: an "Add" button, a row per site with a ⋮ menu ("Edit", "Remove"), and "No
 * sites added" while there are none. Sites are typed into the page's one-field dialog and kept
 * as hosts (`siteFromInput`).
 *
 * @module options/keep-sites
 */
import { askText, byId, createMenu, moreActionsButton } from '../vendor/extension-kit/index.js';
import { MAX_HOST_LENGTH, siteFromInput } from '../shared/sites.js';

/** @import { Settings } from '../shared/settings.js' */

const list = byId('site-list');
const empty = byId('no-sites');
const menu = createMenu();

/** The page's current settings and how to store a new list, from {@link startSites}. */
let page = /** @type {{settings: () => Settings, save: (sites: string[]) => void} | undefined} */ (undefined);

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
    title, label: 'Site', value, action, maxLength: MAX_HOST_LENGTH,
    validate: (typed) => (siteFromInput(typed) ? null : 'Enter a site, like example.com'),
  });
  return text === null ? null : siteFromInput(text);
}

/**
 * "Edit": ask for the site again, and put the answer in its place.
 *
 * @param {string} site - The site as kept.
 * @returns {Promise<void>} Settles once stored.
 */
async function edit(site) {
  const edited = await askSite('Edit site', 'Save', site);
  if (edited && page) page.save([...new Set(page.settings().keepSites.map((s) => (s === site ? edited : s)))]);
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
    row.append(label, moreActionsButton(site, {
      onClick: (anchor) => menu.open([
        { label: 'Edit', run: () => edit(site) },
        { label: 'Remove', run: () => page?.save(page.settings().keepSites.filter((s) => s !== site)) },
      ], { anchor }),
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
  page = { settings, save };
  byId('add-site').addEventListener('click', async () => {
    const site = await askSite('Add site', 'Add');
    if (site) save([...settings().keepSites.filter((s) => s !== site), site]);
  });
}
