/**
 * The shortcuts the options page lists: only the ones that are set, in menu
 * order. Users set them on chrome://extensions/shortcuts.
 *
 * @param {{id: string, title: string}[]} actions - ACTIONS, in menu order.
 * @param {{name?: string, shortcut?: string}[]} commands - chrome.commands.getAll().
 * @returns {{id: string, title: string, shortcut: string}[]}
 */
export function setShortcuts(actions, commands) {
  return actions.flatMap((action) => {
    const shortcut = commands.find((command) => command.name === action.id)?.shortcut;
    return shortcut ? [{ id: action.id, title: action.title, shortcut }] : [];
  });
}
