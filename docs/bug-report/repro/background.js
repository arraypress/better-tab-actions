/**
 * The minimal extension for the Chrome separator bug report (../report.md): the same item
 * structure in two contexts. The separator shows in the page menu, not in the tab menu.
 *
 * @module docs/bug-report/repro/background
 */
chrome.runtime.onInstalled.addListener(() => {
  for (const context of /** @type {const} */ (['tab', 'page'])) {
    const parentId = `parent-${context}`;
    const log = () => chrome.runtime.lastError && console.error(chrome.runtime.lastError.message);
    chrome.contextMenus.create({ id: parentId, title: `Repro (${context})`, contexts: [context] }, log);
    chrome.contextMenus.create({ id: `a-${context}`, parentId, title: 'Item A', contexts: [context] }, log);
    chrome.contextMenus.create({ id: `sep-${context}`, parentId, type: 'separator', contexts: [context] }, log);
    chrome.contextMenus.create({ id: `b-${context}`, parentId, title: 'Item B', contexts: [context] }, log);
  }
});

chrome.contextMenus.onClicked.addListener((info) => console.log('clicked', info.menuItemId));
