// Same item structure in two contexts: the separator shows in the page menu, not in the tab menu.
chrome.runtime.onInstalled.addListener(() => {
  for (const context of ['tab', 'page']) {
    const parentId = `parent-${context}`;
    const log = () => chrome.runtime.lastError && console.error(chrome.runtime.lastError.message);
    chrome.contextMenus.create({ id: parentId, title: `Repro (${context})`, contexts: [context] }, log);
    chrome.contextMenus.create({ id: `a-${context}`, parentId, title: 'Item A', contexts: [context] }, log);
    chrome.contextMenus.create({ id: `sep-${context}`, parentId, type: 'separator', contexts: [context] }, log);
    chrome.contextMenus.create({ id: `b-${context}`, parentId, title: 'Item B', contexts: [context] }, log);
  }
});

chrome.contextMenus.onClicked.addListener((info) => console.log('clicked', info.menuItemId));
