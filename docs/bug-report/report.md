**Title:** contextMenus: `type: "separator"` items are dropped from extension submenus in the "tab" context menu

**Component:** Platform > Extensions > API

**Chrome version:** 157.0.8103.39 (Official Build), macOS 27.2
(The cause is in cross-platform code, so it should affect every desktop platform except ChromeOS, where extension separators are disabled anyway.)

---

**What steps will reproduce the problem?**

1. Load the attached unpacked extension (`repro/`). It creates the same submenu twice, once with `contexts: ["tab"]` and once with `contexts: ["page"]`:
   ```
   Repro (…) ▸  Item A
                ───────   ← { type: "separator" }
                Item B
   ```
2. Right-click any web page and open "Repro (page)".
3. Right-click any tab in the tab strip and open "Repro (tab)".

**What is the expected result?**

Both submenus show a separator between Item A and Item B.

**What happens instead?**

- The page menu shows the separator.
- The tab menu shows Item A and Item B with **no separator**.
- No errors in the service worker console; `chrome.contextMenus.create` succeeds for the separator.

---

**Cause (from reading `main`)**

It's an ordering issue between building the `TabMenuModel` and wiring up its delegate:

1. `BrowserTabStripController::ShowContextMenuForTab` creates the `TabContextMenuController` and then constructs `TabMenuModel(context_menu_controller_.get(), …)`.
2. `TabMenuModel`'s constructor calls `Build()`, which (behind `kExtensionTabContextMenu`) creates the `ContextMenuMatcher` and calls `AppendExtensionItems()`. For an extension with one top-level parent, that builds a child `ui::SimpleMenuModel(delegate_)` whose delegate is the `TabContextMenuController`, and `RecursivelyAppendExtensionItems()` calls `AddSeparator(ui::NORMAL_SEPARATOR)` for the separator item.
3. `SimpleMenuModel::AddSeparator()` searches backwards for the last *visible* item and returns early ("No visible items. Don't add a separator.") if it finds none. For extension command IDs, `SimpleMenuModel::IsVisibleAt()` asks `delegate_->IsCommandIdVisible()`.
4. `TabContextMenuController::IsCommandIdVisible()` answers extension command IDs through `tab_menu_model_->extension_items()`. But `tab_menu_model_` is still null here, so it returns `false`.
5. `tab_menu_model_` is set only afterwards, in `TabContextMenuController::LoadModel()`, which `BrowserTabStripController` calls after the `TabMenuModel` constructor returns.

So, while the submenu is being built, every extension item looks invisible to `AddSeparator()` and every separator is silently dropped. At display time `tab_menu_model_` is set, so the normal items report visible and render, but the separators were never added.

The top-level model isn't affected because `TabMenuModel` overrides `IsVisibleAt()` to ask the matcher directly. The child `SimpleMenuModel`s that `ContextMenuMatcher` creates for extension submenus don't get that override. The same early return should also drop the separators that `RecursivelyAppendExtensionItems()` inserts automatically around radio groups.

**Possible fixes**

- Make the controller able to resolve extension visibility while the model is being built: either pass the `TabMenuModel` to the controller before `Build()` runs, or build the model after `LoadModel()`.
- Or have `TabContextMenuController::IsCommandIdVisible()` return `true` for extension command IDs when no model is attached yet. The real visibility is checked again when the menu is shown.

**Relevant files**

- `chrome/browser/ui/views/tabs/browser_tab_strip_controller.cc`: `ShowContextMenuForTab`
- `chrome/browser/ui/views/tabs/tab/tab_context_menu_controller.cc`: `LoadModel`, `IsCommandIdVisible`
- `chrome/browser/ui/tabs/tab_menu_model.cc`: constructor → `Build()` → `AppendExtensionItems`
- `chrome/browser/extensions/context_menu_matcher.cc`: `AppendExtensionItems`, `RecursivelyAppendExtensionItems`
- `ui/menus/simple_menu_model.cc`: `AddSeparator`, `IsVisibleAt`

Related: PSA thread for the `"tab"` context (M150), https://groups.google.com/a/chromium.org/g/chromium-extensions/c/RReE8dtY4Ok, and issue 514442561 (multiple tab items crash, fixed).
