# More Tab Actions: privacy

More Tab Actions works entirely in Chrome on your computer. It collects nothing and sends nothing.

## What it reads

When you choose one of its actions or shortcuts, it looks at your open tabs’ addresses, titles and
last-used times, inside Chrome, so it can close, sort, mute, group, switch to or reopen the right
tabs, and when you save a workspace, the open windows and their tab groups. Tab groups it makes
(including those it reopens from a workspace) are kept by Chrome itself, in your saved tab
groups, like the groups you make yourself.

## What it keeps

- **Your settings** (which actions show, the number of days, the windows, grouped tabs), in Chrome’s
  own extension storage. If you’re signed in to Chrome with sync on, Chrome Sync keeps them in your
  Google account so your other computers get the same settings, as it does for Chrome’s own settings.
- **Your workspaces**, when you save one: each window’s tabs (addresses and titles), which were
  pinned, its tab groups (names and colours) and its size, so “Open workspace” can bring them back.
  They are kept on this computer only, in Chrome’s local extension storage: never synced, never
  sent anywhere. Delete one on the settings page, or remove the extension, and it’s gone.
- **The last tabs it closed**, on this computer only, so “Reopen closed tabs” can bring them back.
- **The tabs you used most recently**, on this computer only, so “Switch to last used tab” knows
  where to go back to.
- **Whether Chrome is in light or dark mode**, on this computer only, to draw its toolbar icon in
  the right colour.

The closed tabs and recent tabs lists are cleared when Chrome quits; workspaces stay until you
delete them.

## What it sends

Nothing. It makes no network requests, has no analytics or ads, and needs no account. Settings sync
is Chrome’s own, through your Google account. Nobody, including ArrayPress, receives any of your data.

## Contact

Questions: [open an issue](https://github.com/arraypress/more-tab-actions/issues) or email
david@arraypress.com.
