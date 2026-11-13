# Better Tab Actions

More actions in Chrome’s tab right-click menu: close every tab from a site, close duplicates,
reopen what you just closed, sort and mute tabs, and save your windows as a workspace to reopen
later.

![The tab menu with More tab actions open](store/screenshot-1.png)

## What it adds

Right-click any tab → **More tab actions**:

| Action | What it does |
|---|---|
| Close tabs to the left | Chrome has “to the right”; this is the other side |
| Close tabs from this site | Closes every tab on the same site as the one you clicked |
| Close other tabs from this site | The same, but keeps the tab you clicked |
| Close duplicate tabs | Keeps one tab per page, and the tab in front in any other window |
| Close tabs not used in 7 days | The number of days is a setting |
| Reopen closed tabs | Brings back the last batch it closed, in their places and groups |
| Sort tabs by site | Puts each site’s tabs next to each other |
| Mute other tabs / Unmute tabs | Silences every tab except the one you clicked |
| Open workspace › | Reopens a saved workspace (shown once you’ve saved one); only the tab in front of each window stays loaded |
| Groups and workspaces › Save this window as a group | Puts the window’s loose tabs into one saved tab group |
| Groups and workspaces › Close window and keep as group | The same, then closes the window |
| Groups and workspaces › Save windows as workspace | Saves your windows with their tabs, pinned tabs, groups and sizes (or just this window) |

- **Close unused tabs automatically** (off until you turn it on): closes tabs you haven’t used for
  the time you pick, counting only time Chrome is open and your computer is awake, from when you
  turn it on. They can be reopened with “Reopen closed tabs”.
- **Workspaces on the settings page**: open one in new windows or in the window you’re in,
  rename, replace or delete it; export them all to a file and import it on another computer
  (nothing is replaced, and you’re told what will be added first).
- **Snapshots**: take a copy of all your windows when you like, or automatically every 5 to 60
  minutes while your tabs change (off until you turn it on). Open one, or save it as a workspace.
- **Keyboard**: every action can have a shortcut, and so can “Switch to last used tab”, which goes
  back to the tab you were just on, even in another window. None is set to begin with: choose
  your own at chrome://extensions/shortcuts.
- **Settings** (click the toolbar icon): which actions show, which windows they work on, and your
  workspaces.

## Good to know

- Pinned tabs are never closed. Automatic closing also skips each window’s current tab, tabs
  playing sound, incognito tabs and the sites you list.
- Incognito tabs an action closes aren’t kept for “Reopen closed tabs”, as Chrome keeps no closed
  tabs for incognito windows.
- Chrome doesn’t tell extensions which tabs are using your camera or microphone, so add a call’s
  site to the “never close” list.
- Chrome can’t open a tab without asking its site for the page, so each tab of a reopened
  workspace does that once; all but the tab in front are then unloaded as soon as their sites
  answer, and load in full when you click them.
- A password written in an address (`https://name:password@site/`) is never saved in a workspace.
- Settings sync through Chrome Sync; workspaces and snapshots stay on this computer.

## Privacy

Nothing is collected or sent anywhere: no network requests, no analytics, no account. See
[PRIVACY.md](PRIVACY.md).

## Permissions

| Permission | Why |
|---|---|
| `contextMenus` | The “More tab actions” submenu on the tab right-click menu |
| `tabs` | Reading tab addresses and titles to find a site’s tabs, duplicates and unused tabs |
| `tabGroups` | Naming the group when you save a window as a group |
| `storage` | Your settings; the last closed tabs so they can be reopened; your workspaces and snapshots (on this computer only, never synced) |
| `offscreen` | A tiny hidden page that tells whether Chrome is in light or dark mode, for the toolbar icon |
| `alarms` | Checking for unused tabs every few minutes, while “Close unused tabs automatically” is on; taking a snapshot, while “Take snapshots automatically” is on |

Chrome shows “Read your browsing history” (for `tabs`) and “View and manage your tab groups”
(for `tabGroups`) when you install it. Workspaces, their export and import, and snapshots need no other permission, and `alarms` shows no
warning (the e2e check asks Chrome for the manifest’s warnings, with and without it).

## Install from source

Needs Chrome 150 or later (that’s when Chrome let extensions add to the tab menu).

1. Download or clone this repository, and run `npm install` (it copies the kit into `extension/vendor/`).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the
   `extension/` folder.

## Development

```sh
npm install          # Playwright, ESLint, TypeScript; copies the kit into extension/vendor/
npm test             # lint, type-check (tsc on the JSDoc types), unit tests (node --test), copied-code check
npm run e2e          # builds .test-builds/e2e, then browser tests in Playwright's Chromium
npm run package      # tests, then release/better-tab-actions.zip for the Chrome Web Store
```

## License

[MIT](LICENSE) © 2026 David Sherlock / ArrayPress Limited
