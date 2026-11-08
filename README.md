# More Tab Actions

More actions in Chrome’s tab right-click menu: close every tab from a site, close duplicates or
tabs you haven’t used in a week, reopen what you just closed, sort and mute tabs, and turn a whole
window into a saved tab group. Plus a shortcut to flip back to the last tab you used.

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

Pinned tabs are never closed. Grouped tabs can be left alone (a setting). Actions can work on the
clicked tab’s window or on every window.

**Keyboard shortcuts:** every action can have one (set them at `chrome://extensions/shortcuts`).
Two come set:

- **Alt+Shift+Z** (⌥⇧Z): switch to the last tab you used, even in another window. Press again to
  flip back. Chrome has no shortcut for this; Ctrl+Tab only moves along the tab strip.
- **Alt+Shift+W** (⌥⇧W): close tabs from this site.

## Settings

Click the toolbar icon. Choose which actions appear in the menu, how many days count as inactive,
which windows the close actions work on, and whether grouped tabs may be closed. Settings sync
between your computers through Chrome Sync.

## Privacy

Nothing is collected or sent anywhere: no network requests, no analytics, no account. See
[PRIVACY.md](PRIVACY.md).

## Permissions

| Permission | Why |
|---|---|
| `contextMenus` | The “More tab actions” submenu on the tab right-click menu |
| `tabs` | Reading tab addresses and titles to find a site’s tabs, duplicates and unused tabs |
| `tabGroups` | Naming the group when you save a window as a group |
| `storage` | Your settings, and the last closed tabs so they can be reopened |
| `offscreen` | A tiny hidden page that tells whether Chrome is in light or dark mode, for the toolbar icon |

Chrome shows “Read your browsing history” (for `tabs`) and “View and manage your tab groups”
(for `tabGroups`) when you install it.

## Install from source

Needs Chrome 150 or later (that’s when Chrome let extensions add to the tab menu).

1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the
   `extension/` folder.

## Development

```sh
npm install          # Playwright, for the browser tests
npm test             # unit tests (node --test)
npm run e2e          # browser tests in Playwright's Chromium
npm run package      # tests, then release/more-tab-actions.zip for the Chrome Web Store
```

## Layout

The extension is the `extension/` folder: it's what you load in Chrome, and exactly what
`npm run package` zips (less the toolbar glyph's SVG sources). The rest of the repo is the project
around it.

```
more-tab-actions/
├── README.md  LICENSE  PRIVACY.md  CHANGELOG.md  CHROMEWEBSTORE.md  CLAUDE.md
├── package.json  package-lock.json  .gitignore
├── extension/                  the extension: load this folder, zip its contents
│   ├── manifest.json
│   ├── background/             the service worker: background.js (menu, shortcuts, running
│   │                           actions), recent.js, migrate.js, toolbar-theme.js
│   ├── offscreen/              offscreen.html/.js: tells the worker Chrome's light or dark mode
│   ├── options/                the settings page, styled like chrome://settings: options.html/
│   │                           .css/.js, about-links.js, shortcuts.js
│   ├── shared/                 loaded by the worker and the pages: actions.js (what each action
│   │                           does), settings.js, sites.js, undo.js, toolbar-scheme.js,
│   │                           chrome-ui.css (the shared design kit's copy)
│   └── icons/                  the extension icons, and toolbar/ (the light and dark glyph)
├── test/                       unit tests (node --test, against a fake browser), and e2e/
│                               (Playwright checks in real Chromium)
├── scripts/                    packaging, toolbar icon rendering, kit check, placeholder warning
├── store/                      Chrome Web Store screenshots and promo tile, and tools/ that make them
└── docs/
    └── bug-report/             a write-up of a Chrome bug (separators are dropped in tab menu submenus)
```

## License

[MIT](LICENSE) © 2026 David Sherlock / ArrayPress Limited
