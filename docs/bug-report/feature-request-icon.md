**Title:** contextMenus: allow tab-context extension items to omit the extension icon

**Component:** Platform > Extensions > API
**Type:** Feature Request

---

**Request**

Give extensions a way to leave out the extension icon on their item in the tab strip context menu (`contexts: ["tab"]`). For example, a `CreateProperties` option such as `showIcon: false`, limited to the `"tab"` context.

**Why**

- The tab menu is a compact, text-only list of Chrome's own actions ("Close other tabs", "Close tabs to the right"…). An extension that adds closely related actions, such as closing tabs by site or reopening a batch of closed tabs, looks out of place with a 16px icon next to its one entry.
- In the tab menu the extension's item is already in its own section, set off by separators, so it's still clear that the item isn't Chrome's.
- Chrome already leaves the icon off in the extension action menu (`ContextMenuMatcher::AppendExtensionItems` skips `SetExtensionIcon()` when `is_action_menu` is true). So there's precedent for menus where the icon isn't needed.

**Current behaviour**

`ContextMenuMatcher::AppendExtensionItems()` always calls `SetExtensionIcon()` for the extension's top-level item unless `is_action_menu` is true. The comment there ("because we are going to put the extension icon next to it") shows it's on purpose, and there's no API to opt out.

**Understood trade-off**

The icon tells users which extension owns an item, which helps stop spoofing. If removing it outright isn't acceptable, some alternatives would help:
- Only allow omitting the icon when the item's title can't be confused with a built-in command, or
- Keep the icon in the tab menu but put the extension's name in the item's tooltip instead, or
- Show a smaller, monochrome version of the icon.

Chrome version: 157.0.8103.39, macOS 27.2.
