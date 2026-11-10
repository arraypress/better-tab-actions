# Better Tab Actions

More actions in Chrome’s tab right-click menu: close every tab from a site, close duplicates or
tabs you haven’t used in a week, reopen what you just closed, sort and mute tabs, turn a whole
window into a saved tab group, and save your windows as a workspace to reopen later. It can also
close tabs you haven’t used for a while by itself. Plus a shortcut to flip back to the last tab
you used.

![The tab menu with More tab actions open](store/screenshot-1.png)

## What it adds

Right-click any tab → **More tab actions**:

| Action | What it does |
|---|---|
| Close tabs from this site | Closes every tab on the same site as the one you clicked |
| Close other tabs from this site | The same, but keeps the tab you clicked |
| Close duplicate tabs | Keeps one tab per page (the one you clicked, a pinned one, or the most recently used) |
| Close tabs not used in 7 days | Closes tabs you haven’t opened in a while (the number of days is a setting) |
| Close tabs to the left | Chrome has “to the right”; this is the other side |
| Reopen closed tabs | Brings back the last batch the extension closed, in their places and groups |
| Sort tabs by site | Puts each site’s tabs next to each other |
| Mute other tabs / Unmute tabs | Silences every tab except the one you clicked |
| Save this window as a group | Puts the window’s loose tabs into one tab group, named after its main site; Chrome saves and syncs it |
| Close window and keep as group | The same, then closes the window, to park a project for later |
| Save windows as workspace | Saves every window (not incognito, popup or app windows) with its tabs, pinned tabs, tab groups and size, named after its main sites |
| Save this window as workspace | The same, for the window you clicked in |
| Open workspace › | Reopens a saved workspace in new windows; only each window’s active tab loads, the rest load when you click them. Ends with “Manage workspaces” |

Pinned tabs are never closed. Grouped tabs can be left alone (a setting). Actions can work on the
clicked tab’s window or on every window.

**Workspaces** are listed on the settings page, newest first, where each one’s ⋮ menu opens,
renames, replaces (with the windows open now) or deletes it. Up to 40 are kept, each up to 500
tabs; pages that can’t be reopened (such as `chrome://crash`, `javascript:` or `file://` pages
without file access) are left out and counted. **Reopen tab groups** (on by default) brings the
groups back; Chrome then adds each reopened group to its saved tab groups, as it does for every
group, so turn it off if copies pile up there.

**Keyboard shortcuts:** every action can have one (set them at `chrome://extensions/shortcuts`).
Two come set:

- **Alt+Shift+Z** (⌥⇧Z): switch to the last tab you used, even in another window. Press again to
  flip back. Chrome has no shortcut for this; Ctrl+Tab only moves along the tab strip.
- **Alt+Shift+W** (⌥⇧W): close tabs from this site.

“Save windows as workspace”, “Save this window as workspace” and “Open last workspace” are there
too, with no key set (Chrome allows an extension at most four suggested keys).

## Close unused tabs automatically

Off until you turn it on (settings page, Closing tabs). Then every few minutes, tabs you haven’t
used for the time you pick (1, 4 or 12 hours, 1 or 3 days, or 1 week, by Chrome’s own last-used
time) are closed, in every normal window. They join “Reopen closed tabs”, so they come back in
their places and groups. Never closed: each window’s current tab, pinned tabs, tabs playing
sound, incognito tabs, tabs in groups when “Include tabs in groups” is off, and tabs from the
sites you list under “Never close tabs from these sites”.

Chrome doesn’t tell extensions which tabs are using your camera, microphone or screen, so a
call that’s quiet in a background tab isn’t recognised: add its site to the list. To free memory
without closing anything, use Chrome’s own Memory Saver (chrome://settings/performance), which
the settings page links to.

## Settings

Click the toolbar icon. Choose which actions appear in the menu, how many days count as inactive,
which windows the close actions work on, whether grouped tabs may be closed, automatic closing,
and your workspaces. Settings sync between your computers through Chrome Sync; workspaces don’t.

## Privacy

Nothing is collected or sent anywhere: no network requests, no analytics, no account. See
[PRIVACY.md](PRIVACY.md).

## Permissions

| Permission | Why |
|---|---|
| `contextMenus` | The “More tab actions” submenu on the tab right-click menu |
| `tabs` | Reading tab addresses and titles to find a site’s tabs, duplicates and unused tabs |
| `tabGroups` | Naming the group when you save a window as a group |
| `storage` | Your settings; the last closed tabs so they can be reopened; your workspaces (on this computer only, never synced) |
| `offscreen` | A tiny hidden page that tells whether Chrome is in light or dark mode, for the toolbar icon |
| `alarms` | Checking for unused tabs every few minutes, while “Close unused tabs automatically” is on |

Chrome shows “Read your browsing history” (for `tabs`) and “View and manage your tab groups”
(for `tabGroups`) when you install it. Workspaces need no other permission, and `alarms` shows no
warning (the e2e check asks Chrome for the manifest’s warnings, with and without it).

## Install from source

Needs Chrome 150 or later (that’s when Chrome let extensions add to the tab menu).

1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the
   `extension/` folder.

## Development

```sh
npm install          # Playwright, for the browser tests
npm test             # lint, type-check (tsc on the JSDoc types), unit tests (node --test), copied-code check
npm run e2e          # browser tests in Playwright's Chromium
npm run package      # tests, then release/better-tab-actions.zip for the Chrome Web Store
```

## Layout

The extension is the `extension/` folder: it's what you load in Chrome, and exactly what
`npm run package` zips (less the toolbar glyph's SVG sources). The rest of the repo is the project
around it.

```
better-tab-actions/
├── README.md  LICENSE  PRIVACY.md  CHANGELOG.md  CHROMEWEBSTORE.md  CLAUDE.md
├── package.json  package-lock.json  .gitignore
├── extension/                  the extension: load this folder, zip its contents
│   ├── manifest.json
│   ├── background/             the service worker: background.js (menu, shortcuts, running
│   │                           actions), auto-close.js, recent.js
│   ├── offscreen/              offscreen.html/.js: tells the worker Chrome's light or dark mode
│   ├── options/                the settings page, styled like chrome://settings: options.html/
│   │                           .css/.js, workspaces-section.js, about-links.js (⋮ menus,
│   │                           the one-field dialog, toasts and the site list are the kit's)
│   ├── shared/                 loaded by the worker and the pages: actions.js (what each action
│   │                           does), workspaces.js, settings.js, sites.js, text.js, undo.js
│   ├── vendor/extension-kit/   @arraypress/extension-kit's browser half, copied in by npm install
│   │                           (not committed): chrome-ui.css, the settings store, the toolbar glyph
│   └── icons/                  the extension icons, and toolbar/ (the light and dark glyph)
├── test/                       unit tests (node --test, against a fake browser), and e2e/
│                               (Playwright checks in real Chromium)
├── scripts/                    packaging (the kit renders the toolbar icons)
├── store/                      Chrome Web Store screenshots and promo tile, and tools/ that make them
└── docs/
    └── bug-report/             a write-up of a Chrome bug (separators are dropped in tab menu submenus)
```

## License

[MIT](LICENSE) © 2026 David Sherlock / ArrayPress Limited
