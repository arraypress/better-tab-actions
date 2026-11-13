# Changelog

## 1.0.0 — unreleased

First version.

- **More tab actions** submenu on the tab right-click menu (Chrome 150+): close tabs from this site,
  close other tabs from this site, close duplicate tabs, close tabs not used in N days, close tabs to
  the left, reopen closed tabs, sort tabs by site, mute or unmute other tabs, save this window as a
  group, close window and keep as group.
- **Workspaces**: save every window, or the one you clicked in, as a named workspace (tabs in
  order, pinned tabs, tab groups with their colours and collapsed state, window size and state),
  and reopen it later from **Open workspace** in the tab menu or from the settings page, where each
  can be opened, renamed, replaced with the current windows or deleted (with Undo). Only each
  window’s active tab stays loaded: Chrome can’t open a tab unloaded, so every tab asks its site
  for the page once and the others are unloaded as soon as their sites answer (a slow site’s tab
  when it does, however long that takes), then load when clicked. A password written in an address
  (`name:password@`) is never stored. Kept on this computer only, never
  synced; up to 40 workspaces of up to 500 tabs. **Reopen tab groups** setting, as Chrome saves
  every group it reopens. A window saved on a display that’s since been unplugged opens where
  Chrome puts new windows. Commands for save windows, save this window and open the last workspace.
- **Open in this window**: a workspace or snapshot’s tabs open at the end of the window you’re in
  (several saved windows become tabs of this one, groups kept), beside opening in new windows.
- **Export and import workspaces** on the settings page: one versioned JSON file, downloaded
  through a link (no permission). Importing says what it will add first (“2 new workspaces, 1
  already here, 3 tabs that can’t be reopened”), merges and never replaces, skips workspaces
  already kept (the same file twice adds nothing), leaves out and counts tabs that can’t be
  reopened, drops passwords from addresses, and refuses a file that isn’t ours or is from a newer
  version.
- **Snapshots**: “Take snapshot” keeps every window as a workspace would (groups, window state
  and size); “Take snapshots automatically” (off by default) keeps one every 5, 15, 30 or 60
  minutes, only when tabs were opened, closed, moved, pinned or grouped (not for a new title or
  another tab in front). Automatic ones keep to the newest 20 and 1 MB, the oldest dropped
  first; the ones you take (up to 10) are never pushed out by them. A snapshot that can’t be
  kept is said so on the settings page. Each can be opened, saved as a workspace or deleted
  (with Undo). Never incognito windows; on this computer only.
- **Close unused tabs automatically** (off by default): tabs not used for 1, 4 or 12 hours, 1 or 3
  days, or 1 week are closed every few minutes (`chrome.alarms`, no install warning) and join
  “Reopen closed tabs”. Only time Chrome is open and the computer awake counts, from when it’s
  turned on: a night asleep, or a day with Chrome closed, closes nothing. Keeps each window’s
  current tab, pinned, playing, incognito and (if set) grouped tabs, and a “Never close tabs from
  these sites” list. Links to Chrome’s Memory Saver.
- **Switch to last used tab**, across windows: a keyboard shortcut only.
- **No default keyboard shortcuts.** Every action, and “Switch to last used tab”, is a command you
  can give a key at chrome://extensions/shortcuts; the settings page lists the keys you’ve set.
  (Alt+Shift+letter, the usual default, types a character on a Mac and switches the keyboard’s
  language on Windows.)
- “Close duplicate tabs” across all windows never closes the tab in front in another window: it’s
  kept, and its copies go.
- **A menu that reads at a glance.** Every closing action is together at the first level, “Close
  tabs to the left” first (beside Chrome’s own “Close tabs to the right”), then Reopen closed
  tabs, Sort tabs by site and Mute other tabs; “Open workspace” appears once a workspace is
  saved; the four saving actions are in one submenu, “Groups and workspaces” (with one action
  left it shows at the first level; with nothing to use just then it isn’t shown). No separators
  are sent: Chrome draws none in a tab-menu submenu. Every action keeps its id, shortcut and
  setting, and the settings page lists them the same way.
- Choose which actions show in the menu.
- Incognito tabs an action closes aren’t kept for “Reopen closed tabs”, as Chrome keeps no closed
  tabs for incognito windows.
- Every word is in `_locales` (English: `en`, and `en_GB` for what differs), ready to be translated;
  counts are written as the language writes numbers.
- Settings sync through Chrome Sync; settings page styled like chrome://settings, with an About card.
- Toolbar icon drawn in Chrome’s own icon colours, light and dark.
