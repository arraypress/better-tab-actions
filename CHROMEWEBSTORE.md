# Chrome Web Store Listing — More Tab Actions

> Last Updated: 2026-11-09

Single source of truth for the Developer Dashboard. Update it in the same change as anything
that alters the listing, permissions, data handling or version. Not shipped: `npm run package`
zips only the contents of `extension/` (into `release/more-tab-actions.zip`), so this file
and `store/` never reach the store.

## Store Listing

**Extension Name** [REQUIRED] (16/75)
More Tab Actions
<!-- The store takes the title from manifest.json "name". A longer title, e.g.
     "More Tab Actions – Close Tabs by Site & Duplicates", would mean changing the manifest. -->

**Short Description** [REQUIRED] (129/132, from manifest.json "description")
More actions for Chrome’s tab right-click menu: close tabs by site, duplicates, inactive tabs, mute tabs, save windows as groups.
<!-- The store shows the manifest's text. Wording rules want a curly apostrophe (Chrome’s);
     change manifest.json if you want that, it isn't behaviour. -->

**Detailed Description** [REQUIRED] (plain text, paste as-is)

```
Right-click any tab and open More tab actions for the jobs Chrome’s own tab menu leaves out.

CLOSE TABS
• Close tabs from this site: every tab from the same site, in one click.
• Close other tabs from this site: the same, but keeps the tab you clicked.
• Close duplicate tabs: keeps one copy of each page.
• Close tabs not used in 7 days: you choose the number of days. Tabs playing sound are left alone.
• Close tabs to the left: the partner to Chrome’s “Close tabs to the right”.
• Reopen closed tabs: brings back the last batch an action closed, in their windows, places and groups.

TIDY UP
• Sort tabs by site: tab groups stay together and pinned tabs stay put.
• Mute other tabs: silences every other tab playing sound. Choose Unmute tabs to bring them back; tabs you muted yourself stay muted.

TAB GROUPS
• Save this window as a group: puts the window’s tabs into one new tab group, named after its main site (or today’s date). Tabs already in groups stay in them, and pinned tabs stay pinned. Chrome keeps the group in your saved tab groups.
• Close window and keep as group: the same, then closes the window. Reopen the group whenever you like from Chrome’s saved tab groups. Not offered while the window has pinned tabs, so nothing closes without a group to come back to.

WORKSPACES
• Save windows as workspace: keeps every window with its tabs in order, pinned tabs, tab groups (names, colours, collapsed) and size, named after its main sites. Or save just the window you’re in.
• Open workspace: reopens one in new windows. Only each window’s front tab loads; the rest load when you click them, so a big workspace opens fast.
• Manage them on the settings page: open, rename, replace with your current windows, or delete (with Undo).
Workspaces stay on your computer. They’re never synced or sent anywhere.

SAFE BY DEFAULT
Pinned tabs are never closed. Choose whether tabs in groups can be closed, and whether site, duplicate and inactive tabs are closed in this window only or in all windows.

YOUR MENU, YOUR KEYS
Hide the actions you don’t use. Each action can have a keyboard shortcut: Close tabs from this site comes set to Alt+Shift+W (Option+Shift+W on Mac), and you can add the rest at chrome://extensions/shortcuts.

Switch to last used tab: press Alt+Shift+Z (Option+Shift+Z on Mac) to jump back to the tab you were just on, even in another window. Press it again to flip back. Chrome has no shortcut for this; Ctrl+Tab only moves along the tab strip.

PRIVATE
No account and no sign-in. More Tab Actions collects nothing and sends nothing. It looks at your open tabs only on your computer, when you choose an action. Workspaces are kept on this computer only. Your settings follow you to your other computers through your own Chrome Sync, like Chrome’s own settings, and never come to us.
```

**Category** [REQUIRED]
Make Chrome Yours › Functionality & UI (alternative: Productivity › Tools).

**Single Purpose** [REQUIRED]
Adds extra actions for tabs to Chrome’s tab right-click menu (closing tabs by site, duplicate or unused tabs, reopening them, sorting tabs by site, muting other tabs, putting a window’s tabs into a tab group, and saving windows as a workspace to reopen later), with keyboard shortcuts for the same actions, plus a shortcut to switch back to the last used tab.

**Primary Language** [REQUIRED]
English.

**Homepage URL** [OPTIONAL]: an ArrayPress page for the extension, if there is one.
**Support URL** [OPTIONAL]: the support page or `mailto:` address David chooses.

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `extension/icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `store/screenshot-1.png`: “Close every tab from this site”, the tab menu with the submenu open (all thirteen items, the group and workspace ones included; “Open workspace” greyed out as nothing is saved yet) |
| Screenshot 2 | 1280×800 | ✅ Ready | `store/screenshot-2.png`: “Close duplicate tabs, keep one of each”, the tab strip before and after |
| Screenshot 3 | 1280×800 | ✅ Ready | `store/screenshot-3.png`: “Mute every other tab”, the menu over tabs playing sound |
| Screenshot 4 | 1280×800 | ✅ Ready | `store/screenshot-4.png`: “Choose what’s in the menu”, the settings page |
| Screenshot 5 | 1280×800 | ✅ Ready | `store/screenshot-5.png`: “Pick the windows, the days and your shortcuts”, settings in dark mode: Closing tabs and Keyboard shortcuts |
| Screenshot 6 | 1280×800 | ✅ Ready | `store/screenshot-6.png`: “Save your windows, reopen them later”, the Workspaces card with three real workspaces and a row’s ⋮ menu open |
| Small Promo Tile [RECOMMENDED] | 440×280 | ✅ Ready | `store/promo-440x280.png`: icon, name, “More from your tab menu” |
| Marquee Promo Tile [OPTIONAL] | 1400×560 | ⬜ Not made | Only used if the store features the extension |

**How they were made.** `node store/tools/make-screenshots.mjs` regenerates all seven. It loads
`extension/` as an unpacked extension in Playwright's Chromium (Playwright 1.64.0 from the Tabby repo).
- The settings pages (4, 5, 6) are real captures, at 1.2 like the others (shot 2 at 1). The script stops if shot 5’s Keyboard shortcuts card no longer fits. Shot 6’s workspaces are saved by the build’s own `snapshotWindows` and `workspaceName` from windows of the made-up sites (one renamed “Hiking trip”).
- Screenshot 2's tab lists are real: the script opens the tabs, runs the build's own “Close duplicate tabs” (`extension/shared/actions.js` `runAction`, as `extension/background/background.js` does) and draws the strip from `chrome.tabs` before and after.
- Chrome's tab right-click menu is native, so it can't be captured headlessly; shots 1 and 3 draw it.
  - Its items and order come from Chromium's `tab_menu_model.cc` at tag 157.0.8103.39. They use the macOS Title Case strings, for a signed-out profile with one window and no tab groups.
  - The submenu's labels come from the build's `menuEntries()`. It's moved up to stay on screen, as macOS does with a tall submenu.
  - The submenu has **no separator** because Chrome 157 drops separators in tab-menu submenus (`docs/bug-report/report.md`), so this is what users see today.
  - Re-check these two shots if Chrome changes the tab menu.
- The web pages behind the menus are made up (no real sites). Photos are CC0, from Wikimedia Commons: “Bierstadt Lake Trail, Rocky Mountain National Park, 2009”, “Lake Mountain Landscape”, “Lighthouse Chania evening sun”.

## Privacy Practices

**Single purpose**: as above.

**Permission justifications** (every permission and manifest key that asks for access):

| Permission | Justification |
|---|---|
| `contextMenus` | Adds the “More tab actions” submenu to the menu Chrome shows when the user right-clicks a tab. No install warning. |
| `tabs` | The actions need each open tab’s address to find tabs from the same site and duplicate pages, to sort tabs by site and to name a new tab group after its main site, plus its last-used time for “Close tabs not used in N days”. “Save windows as workspace” reads the open tabs’ addresses, titles and pinned state to keep them on the device; “Open workspace” reopens them and discards the background ones (`chrome.tabs.discard`) so they load only when clicked. Tabs are read on the device, only when the user picks an action or a shortcut, and nothing is sent anywhere. Install warning: “Read your browsing history”. |
| `tabGroups` | “Save this window as a group” and “Close window and keep as group” name the tab group they make (`chrome.tabGroups.update`, title only; Chrome picks the colour). Saving a workspace reads the open groups’ titles, colours and collapsed state (`chrome.tabGroups.query`), and opening one makes them again with the same title, colour and collapsed state. Making a group itself (`chrome.tabs.group`) needs no permission; reading and naming it do. Nothing is sent anywhere. Install warning: “View and manage your tab groups”. |
| `storage` | `chrome.storage.sync` keeps the user’s settings (hidden actions, days, windows, grouped tabs), so Chrome Sync carries them to the user’s other computers through their own Google account, like Chrome’s own settings (signed out of Chrome, they stay on the computer). `chrome.storage.local` holds the user’s saved workspaces (`workspaces`: per window, tab addresses, titles, pinned state, tab groups and the window’s size and state; at most 40 of 500 tabs and 200 KB each; this computer only, never synced, deleted with the extension), a settings change Chrome Sync refused for the moment, until it’s retried, and whether Chrome was last seen in light or dark mode (`toolbarDark`, one true/false, this computer only, never synced), for the toolbar icon. `chrome.storage.session` remembers the addresses of the last batch of tabs an action closed, so “Reopen closed tabs” can bring them back. Chrome clears that when it quits. Nothing is sent to the developer. No install warning. |
| `commands` (manifest key) | Keyboard shortcuts for the same actions, plus “Switch to last used tab”; two have defaults (Close tabs from this site, Alt+Shift+W; Switch to last used tab, Alt+Shift+Z). Users change them at chrome://extensions/shortcuts. The two group actions and the three workspace actions (save windows, save this window, open the last workspace) have commands with no default key. No install warning. |
| `action` (manifest key, not a permission) | The toolbar button opens the settings page. Its icon is a plain glyph in Chrome’s own toolbar icon colours, light or dark to match Chrome. |
| `offscreen` | Keeps one small hidden page (`offscreen/offscreen.html`, reason `MATCH_MEDIA`) that reads whether Chrome is in light or dark mode (`matchMedia('(prefers-color-scheme: dark)')`, which the service worker can’t call), so the toolbar icon matches Chrome’s own icons. It only reads that one true/false and tells the extension’s service worker when it changes; it loads nothing and sends nothing anywhere. No install warning. |

No host permissions, no content scripts, no `scripting`.

**Remote code**: No. Everything is in the package.

**Network requests**: None.

**Data usage** (dashboard › Privacy practices › “What user data do you plan to collect…”). Tick **none** of the boxes.
Settings sync through the user’s own Chrome Sync (their Google account), like Chrome’s own settings; the developer receives nothing. They are only the extension’s own preferences (hidden actions, days, windows, grouped tabs), none of the types below.

| Data type | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | |
| Personal communications | No | |
| Location | No | |
| Web history | No | Open tabs’ addresses are read on the device to carry out an action; the last closed batch is kept in session storage on the device until Chrome quits; workspaces the user saves are kept in local storage on the device until the user deletes them. None of it is ever sent off the device, synced, or seen by the developer. |
| User activity | No | |
| Website content | No | Pages aren’t read at all. |

Certify all three: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used to decide creditworthiness or for lending.

**Privacy policy URL**: `https://github.com/arraypress/more-tab-actions/blob/main/PRIVACY.md` (the
repo must be public first). The text is `PRIVACY.md`; the draft below is the same.

### Draft privacy policy

> **More Tab Actions: privacy**
>
> More Tab Actions works entirely on your computer. It collects nothing and sends nothing.
>
> **What it reads:** when you choose one of its actions or shortcuts, it looks at your open tabs’ addresses, titles and last-used times, in Chrome, so it can close, sort, mute, group or reopen the right tabs. Tab groups it makes are kept by Chrome itself, in your saved tab groups, like groups you make.
>
> **What it keeps:** your settings (which actions show, the number of days, the windows, grouped tabs), in Chrome’s own storage. If you’re signed in to Chrome with sync on, Chrome Sync keeps them in your Google account so your other computers get the same settings, as it does for Chrome’s own settings. It also keeps the addresses of the last tabs it closed, on this computer, so “Reopen closed tabs” can bring them back; that list is cleared when Chrome quits. Workspaces you save (each window’s tab addresses and titles, pinned tabs, tab groups and size) are kept on this computer only, never synced or sent, until you delete them.
>
> **What it sends:** nothing. It makes no network requests, has no analytics or ads, and needs no account. Settings sync is Chrome’s own, through your Google account. Nobody, including ArrayPress, receives any of your data.
>
> Questions: david@arraypress.com.

## Version History

| Version | Date | Notes |
|---|---|---|
| 1.0.0 | 2026-11-09 | First build, not yet submitted. Includes “Save this window as a group” and “Close window and keep as group” (adds `tabGroups`, warning “View and manage your tab groups”). Workspaces (save windows, reopen them; kept in local storage only; no new permission). Settings always sync through Chrome Sync (the opt-in switch is gone; earlier test installs’ settings move over by themselves). About card at the end of the settings page. |

## Submit checklist

**You need to do these yourself (they can’t be done from here):**
- [ ] **Developer account.** Register at https://chrome.google.com/webstore/devconsole (one-time US$5 fee) with the Google account that will own ArrayPress’s listings. Turn on 2-Step Verification, which the dashboard requires.
- [ ] **Account tab.** Set the publisher name (ArrayPress) and a **contact email**, and verify that email. Complete the trader / non-trader declaration (EU Digital Services Act): as a company, ArrayPress Limited is likely a trader, which needs a verified address and phone number.
- [x] **Make the GitHub repo public** (done 9 Nov 2026) (`arraypress/more-tab-actions`). The About card’s Get help, Report an issue and Privacy policy links, and the privacy policy URL, all point into it; while it’s private they show GitHub’s 404. `npm run package` prints a reminder.
- [ ] Decide the **support** contact (email or URL) and whether to add a homepage URL.

**Build:**
- [ ] `npm run package` (tests, kit check, zip). The zip is exactly the contents of `extension/`, less the toolbar glyph's SVG sources (`test/package.test.js` checks this):
      `unzip -l release/more-tab-actions.zip` should list 39 files: `manifest.json` at the root, then `background/` (2), `offscreen/` (2), `options/` (6), `shared/` (6), `vendor/` (12, the kit's browser half) and `icons/` (10 PNGs); no `store/`, `test/`, `scripts/` or `docs/`.
- [ ] **No placeholder links.** `extension/options/about-links.js` points at the GitHub repo (README, Issues, PRIVACY.md); `npm run package` warns loudly if any link is ever set back to example.com.
- [ ] Load the `extension/` folder in a clean profile and right-click a tab: the submenu, a shortcut and the settings page all work.

**Developer Dashboard, in order:**
1. **Items › New item**: upload `release/more-tab-actions.zip`.
2. **Store listing**: paste the detailed description and pick the category and language (English). Upload:
   - store icon `extension/icons/icon-128.png`;
   - screenshots `store/screenshot-1.png` … `-6.png`, in that order (1 is the one people see first);
   - small promo tile `store/promo-440x280.png`.

   Add the homepage and support URLs if you have them.
3. **Privacy practices**: fill in the single purpose, each permission justification (`contextMenus`, `tabs`, `tabGroups`, `storage`), remote code: No, no data types ticked, the three certifications, and the privacy policy URL.
4. **Distribution**: Free; Public; all regions (or as you prefer).
5. **Test instructions** (if asked): none needed. There’s no login; right-click any tab.
6. **Submit for review.** Optionally untick “Publish automatically after approval” to choose the moment. Reviews of a `tabs` permission can take a few days; the justification above answers the usual question.
