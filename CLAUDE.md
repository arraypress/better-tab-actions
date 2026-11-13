# CLAUDE.md — Better Tab Actions

MV3 extension: extra actions in Chrome's tab right-click menu, with an options page (`options/`).
The extension is `extension/` (paths below are inside it unless they say otherwise); the repo
around it holds the tests, scripts, store assets and docs. Same family setup as Clean Links
(`../clean-links`) and Upright (`../rotate-image`).

- **Actions**: `shared/actions.js` (`ACTIONS`: what each does as a plan worked out from the tabs,
  `menuEntries`/`menuState` for the submenu, `runAction`), `shared/undo.js` (the closed batch
  behind "Reopen closed tabs"), `shared/workspaces.js`, `shared/sites.js`, `shared/text.js`.
- **Words**: every word people see is a message in `_locales/en/messages.json` (see Wording).
- **Service worker**: `background/background.js` is only the entry (it calls `startWorker(chrome)`
  and the kit's `startToolbarTheme(chrome)` at top level). `background/worker.js` registers every
  listener on the `chrome` it's given, so `test/worker.test.js` runs the real wiring against an
  in-memory Chrome. `background/menu.js` builds the menu (the kit's `contextMenuBuilder`) and
  refreshes its live labels; `background/auto-close.js`, `background/auto-snapshot.js` (both on
  `background/alarm.js`'s `keepAlarm`) and `background/recent.js` are below.
- **Nothing that matters lives in the worker's memory**: the menu's items are Chrome's, the closed
  batch (`lastClosed`), the recent tabs (`recentTabs`) and the reopened tabs still to unload (`unload:<id>`)
  are in `chrome.storage.session`, the
  unused-tabs check is a `chrome.alarms` alarm. `test/e2e/worker.mjs` stops the worker (the kit's
  `stopWorker`) and checks each.
- **Settings** (`shared/settings.js`: the schema for the kit's settings store) always live in
  `chrome.storage.sync`, so they follow the user through their own Chrome Sync (plain
  preferences, not personal data; the developer receives nothing). `chrome.storage.local` holds the
  saved workspaces and the snapshots (below), the toolbar glyph's `toolbarDark`, and a write sync refused, until it's
  retried (by the options page, and by the worker on install and browser start). The options page
  debounces its writes (the kit's `createSettingsSaver`; sync allows 120 a minute) and follows
  changes made elsewhere with `saver.follow`.
- **About card**: links in `options/about-links.js` (`githubAboutLinks`; `npm run package` warns
  loudly if one is ever a placeholder).
- **Toolbar glyph**: `action.default_icon` is a light/dark glyph (`icons/toolbar/`, `npm run
  toolbar-icons`). The kit does the work: `startToolbarTheme(chrome)` in the worker,
  `setUpPage(chrome, …)` on the options page (it starts `watchColorScheme`), `watchSchemeOffscreen` in `offscreen/` (kept open
  with reason MATCH_MEDIA, polling as offscreen pages get no `change` events), key `toolbarDark`
  in local, never synced; `test/e2e/toolbar.mjs` runs the kit's `checkToolbarTheme`.

## Libraries
`@arraypress/extension-kit` (^1.11.1, from npm): chrome-ui.css, the settings store and saver,
`contextMenuBuilder`, the toolbar glyph, About links, `setShortcuts`, i18n (`setUpPage`,
`translator`, `counted`, `data-i18n`), the ⋮ menu
(`createMenu`/`moreActionsButton`), the one-field dialog (`askText`), the toast with Undo
(`createToast`), the site list (`createSiteList`, `siteHost`, `onSite`), `make`, `focusedIn`,
`syncItemBytes`, packaging, test builds, and the test helpers (`fakeChromeStorage`, `runChecks`,
`stopWorker`, `missingReferences`, `messageLookup`/`readMessages`, `savedTabGroups`,
`warningsAddedBy`, `checkToolbarTheme`).
`extension/vendor/extension-kit/` is its browser half, copied from `node_modules` by `npm install`
(`postinstall`) and never committed (gitignored), so it can't drift from `package.json`. Never
edit it. `npm install <pkg>` doesn't rerun `postinstall`: run `npm run postinstall` after one.

Kept here because the kit has no equivalent (candidates for it):
- `background/menu.js`'s own turn-taking around `contextMenuBuilder`: the builder takes the
  items, and this menu's items must be read when the build's turn comes, not when it was asked for.
- `options/saved-list.js`: the workspaces' and snapshots' rows, keeping the focus in a list across a
  redraw (the kit does it inside `createSiteList` only).
- `options/confirm.js`: Chrome's confirmation dialog (title, a line, Cancel and an action), on the
  kit's `.dialog` styles; the kit's dialogs always have a field.
- `store/tools/frame.mjs`: for the store screenshots, Chrome's tab menu drawn as macOS draws it
  (icons, dark theme, a submenu moved up to stay on screen, each row's position: more than the
  kit's `contextMenuHtml` does), outlines over tabs, and a copy of the kit's tab layout, which
  `storeFrame` doesn't export.

## Tests
- `npm test`: `extension-kit vendor-check` (fails while `vendor/` is stale), ESLint, `tsc` (a
  strict check of the JSDoc types), `node --test test/*.js`, and `extension-kit duplication`
  (fails on copied code not listed in a `.jscpd-allowlist.json`; there is none).
- Unit tests fake only Chrome's edge: `test/fake-browser.js` (tabs, windows, tab groups, file
  access and the kit's fake storage, holding real state and refusing what Chromium refuses:
  addresses extensions can't open, a window placed mostly off the screen; sites listed as `slow`
  don't answer until told, and a tab discarded before then loses its address) and
  `test/fake-chrome.js` around it (the menu Chrome holds, alarms, and the events Chrome fires),
  which the real `startWorker` runs against. The words are the real `_locales`, through the kit's
  `messageLookup` (`test/helpers.js` `WORDS`).
- `test/locales.test.js`: every message used exists and every message is used, placeholders line
  up, each count has both its messages, en_GB only overrides en, Chrome's wording (curly quotes,
  no exclamation marks), and the name written only in `extName`, `extShortName` and `toolbarTitle`.
- `npm run e2e` (Playwright's Chromium, not part of `npm test`): `scripts/build-e2e.mjs` makes
  `.test-builds/e2e/` (the kit's `buildTestCopy`): `extension/` with `test/e2e/hook.js` as its
  service worker, which exposes `handleMenuClick` and `handleCommand` (what a menu click and a
  shortcut call; Chrome's native tab menu and shortcuts can't be driven headlessly). Then
  `test/e2e/`: `groups.mjs`, `workspaces.mjs`, `snapshots.mjs` (export and import, "Open in this
  window", snapshots, and Chrome's install warnings unchanged), `worker.mjs` (shortcuts, and the worker stopped),
  `auto-close.mjs`, `options.mjs` and `toolbar.mjs` (the last two load `extension/` itself). Each
  runs through the kit's `runChecks` (clean-ups always; a check that hangs fails after 60 s).
  `test/e2e/helpers.mjs` holds what they share (made-up `*.example` sites on a real local server
  that counts requests, opening a window, `click` and `press` through the hook).
- `test/package.test.js`: the zip is exactly `extension/` (less the SVG sources), every path the
  extension names resolves inside it, no command has a `suggested_key`, and the store build has
  no test hook.
- `npm run package`: tests, then `release/better-tab-actions.zip`, then the link reminders.

## Shortcuts and support contact
- **No default keyboard shortcuts** (David, 12 Nov 2026: Alt+Shift+letter types characters on a
  Mac, switches keyboard language on Windows, and the family's extensions clashed). The manifest's
  14 commands (one per action, plus `switch-last-tab`) have no `suggested_key`; people set keys at
  chrome://extensions/shortcuts. The settings page lists what `chrome.commands.getAll` says is set
  (the kit's `setShortcuts`), else “None set yet. Add them on Chrome’s Keyboard shortcuts page.”
- **Support**: support@arraypress.com (“for now”), for support and privacy questions; bugs go to
  GitHub Issues. Written in `PRIVACY.md`'s Contact and `CHROMEWEBSTORE.md`'s support field; no code
  names it.

## The menu
`background/menu.js`. Chrome keeps menu items across worker restarts, so the menu is built whole
(`menu.build()`) on install or update, on browser start (the closed batch is gone), and when the
settings or the workspaces change; between builds `menu.refresh()` (100 ms after a burst of tab
events) updates only the items whose title or greyed-out state changed: "Reopen 3 closed tabs",
"Unmute tabs", the group items for the focused window. The session listener refreshes only for
`lastClosed`: `recentTabs` is written at every tab switch and changes nothing in the menu.
`contexts: ['tab']` puts the items on the tab strip's menu; the manifest's `minimum_chrome_version`
is 150.

## Reopen closed tabs
`shared/undo.js`: the last batch of tabs an action closed, in `chrome.storage.session`. Left out
of it (they close for good): incognito tabs (Chrome itself keeps no closed tabs for incognito
windows; their addresses would outlive the window and reopen in an ordinary one), tabs with no
address yet, and addresses over 8,192 characters (`MAX_URL` in `shared/sites.js`: big `data:`
pages would fill session's 10 MB, and the write failing stopped the action). Tabs go back to
their window, place and group; tabs whose window has gone open in a new window, one address at a
time (`chrome.windows.create` with a list fails whole if Chrome refuses one address, e.g. a
`file:` page after file access was turned off).

## Workspaces
`shared/workspaces.js` (snapshot, name, reopen plan, storage, open/save/replace), wired into `shared/actions.js`
(actions `save-workspace`, `save-window-workspace`, `open-workspace`: a submenu of the latest 10 plus
"Manage workspaces", or the latest one from its shortcut), and `options/workspaces-section.js` (the card, ⋮ menu,
rename dialog, toasts with Undo: the kit's `createMenu`/`moreActionsButton`, `askText` and `createToast`; the
keyboard focus stays in the list when it's redrawn). Stored under `workspaces` in `chrome.storage.local`
only (it's browsing history: never sync), bounded to 40 workspaces × 500 tabs × 200 KB, URLs ≤ 8,192 characters,
titles ≤ 200. A `user:password@` in an address is dropped before it's stored (`withoutCredentials` in `shared/sites.js`). There's no save confirmation beyond what the extension already does for its actions: the menu
updates (the new workspace heads "Open workspace", as "Reopen 3 closed tabs" appears after closing), like Chrome's
own "Bookmark all tabs" shows nothing after saving.

What real Chromium does (checked with Playwright's Chromium 156, `test/e2e/workspaces.mjs`):
- **Opening tabs.** `chrome.tabs.create` refuses `javascript:`, `devtools:`, `chrome-untrusted:` and
  chrome://kill|crash|hang|quit|restart, and `file:` without file access. `view-source:`, `data:`, `about:`,
  extension pages and other chrome:// pages open fine, so they're kept (`reopenable()`); `blob:` and
  `chrome-error:` are skipped as there'd be nothing to show.
- **Unloaded tabs.** Chrome gives extensions **no way to open a tab unloaded** (`tabs.create` has no such
  option, unlike Firefox's `discarded`; the unloaded tabs of Chrome's own session restore can't be made by an
  extension). A new tab has only a `pendingUrl` until its site's answer starts to arrive (the response
  headers), when it reports its `url`. `chrome.tabs.discard` before that **loses the address for good** (the tab
  stays blank, and nothing loads when it's clicked), whether straight after `tabs.create`, once `pendingUrl`
  shows, or 500 ms into a 3 s wait; and the request has already left (the server saw it when the tab was
  discarded 5 ms after `create`). From `url` on, discarding keeps the address, place, pin and group, and stops
  the rest of the page (the server sees the connection close). So **every reopened tab asks its site for the
  page once**, and the best Chrome allows is to discard at the first bytes: `unloadWhenAnswered` marks each new
  tab in `chrome.storage.session` (`unload:<tabId>`, one item a tab, so the worker and the settings page
  never overwrite each other), discards those already answered, and the worker's `tabs.onUpdated` listener
  (`unloadIfAnswered`, on a `url` change) discards the rest when they answer, however long that takes and
  whichever run of the worker hears it. A tab the user has brought to the front by then stays loaded. A tab
  discarded before its `<title>` arrived shows its address as its title until clicked. Discarding gives the
  tab a **new id**, so groups are made first. Marks of tabs closed while waiting are left: harmless, and gone
  when Chrome quits.
- **Counting requests.** Playwright's `context.route` doesn't see the requests of tabs an extension opens in
  the background (six fully loading tabs counted as two), which is how "sends no request" was once believed.
  `test/e2e/helpers.mjs` serves the `*.example` sites from a real local server (the kit's `serve`, HTTPS,
  `--host-resolver-rules`) and counts there; `slow.example` answers after 3 s.
- **Window state.** A state set right after tabs are added to a new window is dropped (reads back "normal" a
  moment later, headed too), so `setWindowState` sets it again until it holds. Bounds and a non-normal state
  can't be given together, so windows open normal at their bounds and change state last.
- **Window bounds.** `chrome.windows.create` rejects a position that leaves less than half the window on a
  screen ("Invalid value for bounds. Bounds must be at least 50% within visible screen space.": a display
  since unplugged, or a window dragged mostly off the screen's edge). `createWindow` then opens it with
  its size only, which Chrome never refuses (it fits the window to the screen). A window that still can't be
  made (its address is refused) is logged and left out; the windows after it open.
- **Saved tab groups.** Every group an extension makes is saved by Chrome and pinned to the saved groups bar
  (the profile's `Sync Data/LevelDB`, read by the kit's `savedTabGroups` from `/testing`). Closing its window or the browser
  keeps it; ungrouping or `tabs.remove` of its tabs deletes it. Nothing dedupes by title, and no API can find
  or reuse a closed saved group, so **each reopen of a workspace adds another saved copy of its groups**.
  Chosen: the synced setting **"Reopen tab groups"** (on by default, secondary text "Chrome also adds each group
  it reopens to your saved tab groups"): on keeps the workspace faithful, off reopens the tabs ungrouped and
  adds nothing. Reusing an open group with the same title was rejected: it would pull tabs into another window's
  group, and does nothing for the closed copies that pile up.

## Open in this window, export and import
- **Open in this window** (`openWorkspace` with `windowId`; the settings page's ⋮ menus only, where "this
  window" is the page's own): every saved window's tabs are added at the end of that window, pinned ones among
  its pinned tabs, each saved window's groups made again, none brought to the front, all unloaded as their
  sites answer. No menu item or command: the tab menu's "Open workspace" submenu would need every name twice.
- **Export and import** (`shared/transfer.js`, the Workspaces card's "Export and import" row). The file:
  `{app: "better-tab-actions", kind: "workspaces", version: 1, exported, workspaces: [{name, savedAt, skipped,
  windows}]}`, downloaded through an `<a download>` on a blob (no `downloads` permission). Reading never trusts
  it: it must name the app and kind, and a higher `version` is refused (`newer`); each workspace's windows are
  turned back into open-window shapes and put through `snapshotWindows`, so `reopenable()`, the size limits and
  `withoutCredentials` are the same code as for a save, bad tabs are left out and counted, and one bad tab never
  refuses the file. A workspace already kept (same name and windows, `sameKey`) is skipped, so the same file
  twice adds nothing; nothing is ever replaced; never more than 40. The page shows the preview in `confirm.js`
  ("2 new workspaces, 1 already here, 3 tabs that can’t be reopened", joined by `Intl.ListFormat`), reads the
  file again against what's stored when it's confirmed, and the toast's Undo takes the added ones away.
  Buttons say "Export" and "Import" (no "…": `test/locales.test.js` keeps it for a label cut short).

## Snapshots
`shared/snapshots.js`, `background/auto-snapshot.js`, `options/snapshots-section.js` (the Snapshots card).
A snapshot is a workspace's windows (`captureWindows`: groups, window state and size, never incognito) with
the time and `auto`, in `chrome.storage.local` under `snapshots`, newest first; the row's title is the time
in the person's language (`dateTime`).
- **Two pools.** Automatic: at most 20 and 1 MB together, the oldest dropped first (`withAutomatic`). Manual
  ("Take snapshot"): at most 10 and 512 KB, never dropped; at the limit no more are taken and the card says so.
  Neither pushes the other out. With the workspaces' 8 MB both fit local's 10 MB (asserted in
  `test/snapshots.test.js`).
- **Only when something changed.** An automatic one is skipped when `layoutKey` (windows, each tab's address,
  pinned and group in order, groups' titles and colours) equals the newest snapshot's: not for a new title,
  another tab in front, or a moved window.
- **Never silent.** `takeSnapshot` answers `kept`, `unchanged`, `nothing`, `full` or `failed`. If Chrome's
  storage refuses an automatic one, older automatic ones go one at a time until it fits; if it's the only one
  left and still refused, `snapshotProblem` is set in `chrome.storage.session` and the card shows a line until
  one is kept. A manual one's result is the toast.
- **The alarm** (`take-snapshot`, every `snapshotMinutes`: 5, 15, 30 or 60; synced settings `autoSnapshot`,
  off by default). `keepAlarm` (also behind automatic closing) leaves a running alarm alone; when it makes one
  (turned on, or the time changed) a snapshot is taken at once. No awake clock: a missed alarm fires once on
  waking, and takes one snapshot only if something changed.
- "Take snapshot" on the settings page leaves the settings tab out (as "Replace with current windows" does);
  an automatic one keeps every window. "Save as workspace" copies it (named by `workspaceName`); the snapshot
  stays. No menu item or command for now: the menu is already thirteen items.

## Close unused tabs automatically
`background/auto-close.js`: an alarm (`close-unused-tabs`, every `CHECK_MINUTES` = 5) while `autoClose` is on
closes tabs `unused()` (shared with "Close tabs not used in N days" in `shared/actions.js`) for `autoCloseHours`
(1, 4, 12, 24, 72, 168; `AUTO_CLOSE_HOURS` in settings.js) of running, awake Chrome (the awake clock, below),
in normal windows, never incognito, never on `keepSites` (or their subdomains). Closed tabs are *appended* to the undo batch (`recordClosed(..., {append: true})`,
capped at 500) so earlier automatic closes stay reopenable; a menu action still starts a new batch. Sites are
typed into the kit's one-field dialog and listed by its `createSiteList` (Add button, ⋮ Edit/Remove; `siteHost` keeps
hosts, `onSite` matches subdomains), as chrome://settings/performance lists Memory Saver's sites; the list is cut to fit one sync item. Memory Saver is
only linked, never reimplemented.
- **Camera, mic, screen.** Chrome exposes no capture state to extensions: with fake devices in Chromium 156, a
  tab using `getUserMedia` (camera and mic) or `getDisplayMedia` showed no change in any `chrome.tabs.Tab` field
  (`audible` stays false), and `tabs.discard` didn't refuse it. Only a content script (host permissions) or
  `debugger`/`tabCapture` could tell, so it isn't attempted; the README says to list a call's site.
- **`alarms`** has no install warning: `test/e2e/auto-close.mjs` compares Chrome's own warnings for the manifest
  with and without it (the kit's `warningsAddedBy`). That check runs on a test build (`.test-builds/auto-close/`, gitignored, deleted after)
  where `HOUR_MS` is a second and `CHECK_MINUTES` 0.02; unpacked extensions may set alarms that short.
- **The alarm's lifetime.** From Chrome 150 an alarm persists until the extension updates
  (`persistAcrossSessions`, true by default; read back in Chromium 156), so scheduling on install, on browser
  start and on a settings change is enough.
- **The awake clock** (David, 13 Nov 2026: a night's sleep must not close everything). Chrome's docs: "Alarms
  continue to run while a device is sleeping. However, an alarm will not wake up a device. When the device
  wakes up, any missed alarms will fire. Repeating alarms will fire at most once and then be rescheduled";
  they say nothing of an alarm that fell due while Chrome was closed. `tab.lastAccessed` is wall-clock time.
  So each check ticks an `AwakeClock` in `chrome.storage.local` (`awakeClock`: `since`, `tick`, `away`; local
  because it must outlive Chrome being closed): a tick more than two periods after the last (`GAP_MS`) makes
  the time between an away stretch, and `awakeTime` takes away stretches off a tab's idle time. Time before
  the setting was turned on counts as away (nothing was watching), so nothing closes until the chosen time
  has passed, awake, since then. Turning it off deletes the clock. At most 200 stretches (`MAX_AWAY`); older
  ones fold into `since`, which only keeps tabs longer. `chrome.idle` isn't used: it reports a locked screen,
  not sleep, nothing while Chrome is closed, and would add a permission. The menu's "Close tabs not used in
  N days" is asked for by hand and still goes by `lastAccessed` alone. Tested with the time each check is
  given (`test/auto-close.test.js`), and in Chromium by taking the alarm away for longer than the chosen
  time and by quitting and starting Chrome (`test/e2e/auto-close.mjs`).

## Design
- The options page copies chrome://settings. Its look comes from `chrome-ui.css` in `@arraypress/extension-kit`
  (`extension/vendor/extension-kit/styles/`). Class names are in the kit's README.
- Never hand-roll styles for things the kit has (rows, cards, toggles, selects, buttons, link rows), nor
  components it has (⋮ menus and their buttons, the one-field dialog, the toast with Undo).
  `options/options.css` holds only what this page adds.
- One card per section, section titles above cards, help as a row's secondary text, links to
  Chrome pages as link rows (`.link-row.external`).
- The About card comes last and copies chrome://settings/help (Chromium's `settings/about_page`):
  logo and name, "Version …", then "Get help with …", "Report an issue", "Privacy policy" as external
  link rows (the kit's `.about-product` and `.product-title`).

## Wording
Tabby's rules (`../tabby/CLAUDE.md`, "Wording"): Chrome's own words, sentence case, curly
quotes and apostrophes, "…" only when something asks for more input.
- **Every word is in `_locales`** (`en`, the default, and `en_GB`, which holds only what differs:
  so far the description, the same text, so the folder exists for Chrome and the store). The
  manifest's name, description, toolbar title and command descriptions are `__MSG_…__`; the page's
  text is `data-i18n` (filled by the kit's `setUpPage`); scripts look words up through
  `shared/text.js` `Words` (`{t, lang}`: the kit's `translator` and Chrome's UI language, from
  `wordsOf(chrome.i18n)` in the worker, `setUpPage`'s `t` on the page). `menuEntries`, `menuTitle`,
  `duration`, `minutesText`, `workspaceSummary` and `snapshotSummary` take the words as an argument, so tests pass the real messages.
- An action's `message` is its name's key, and the same message is its command's description in
  the manifest (`test/actions.test.js` holds them together). Counts are the kit's `counted` with a
  pair of messages, `xOne` (“1 day”) and `x` (“$COUNT$ days”): the menu's days and closed tabs,
  the ages, a workspace's windows and tabs, an import's parts.
- Messages that name the extension take it as `$NAME$` (content `$1`), filled from `extShortName`
  by the kit; the manifest's own messages can't, so `toolbarTitle` writes it out.
- Two messages name menu items, shown in bold (`options.js` `showWithNames`): the names are
  placeholders, filled from the menu's own messages, so they can't drift from the menu.
- Group and workspace names (a site, or a date) and dates come from `Intl` in Chrome's language.
- The extension was called More Tab Actions until 10 Nov 2026 (renamed for the Better family). The tab menu's
  submenu stays “More tab actions”, as Chrome words its own “More …” entries; `PARENT_ID` stays `more-tab-actions`.

## Folders
- GitHub: `arraypress/better-tab-actions` (public). The About links (`extension/options/about-links.js`) point into it, so it must stay public.
- `npm install` first: devDependencies (Playwright, the kit) and the kit's copy in `extension/vendor/`.
- **Load the `extension/` folder** (chrome://extensions → Load unpacked). `npm run package` writes the store zip to `release/better-tab-actions.zip`: exactly `extension/`, less `icons/**/*.svg`, `*.d.ts` and `.DS_Store` (`scripts/package.mjs`). `docs/bug-report/` is the Chrome separator-bug write-up.
- Where a file goes: `background/` runs only in the service worker, `offscreen/` and `options/` are those pages, `shared/` is what more than one of them loads (`actions.js` and what it imports are loaded by the worker and the options page), and `vendor/` is the kit's copy.
- `scripts/`: `package.mjs` (the store zip) and `build-e2e.mjs` (the test build).
- `store/`: Chrome Web Store screenshots and promo tile (listing text in `CHROMEWEBSTORE.md`). Not packaged. Regenerate with `node store/tools/make-screenshots.mjs` and look at each. The canvas, caption and Chrome's window are the kit's `storeFrame`; `store/tools/frame.mjs` adds the drawn tab menu.
