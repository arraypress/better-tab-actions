/**
 * Opening a ⋮ menu (the kit's `<dialog class="menu">`) where Chrome's cr-action-menu opens one:
 * over its button, its top at the button's top and its end at the button's end, moved up or in
 * when it would leave the window. A click outside it closes it.
 *
 * @module options/action-menu
 */

/** The gap kept between the menu and the window's edges. */
const EDGE = 8;

/**
 * Open `menu` over `anchor`, and return focus to `anchor` when it closes.
 *
 * @param {HTMLDialogElement} menu - The `.menu` dialog.
 * @param {HTMLElement} anchor - The ⋮ button that opened it.
 * @returns {void}
 */
export function showMenu(menu, anchor) {
  menu.showModal();
  const box = anchor.getBoundingClientRect();
  const { width, height } = menu.getBoundingClientRect();
  const left = Math.max(EDGE, Math.min(box.right - width, innerWidth - width - EDGE));
  const top = box.top + height + EDGE <= innerHeight ? box.top : Math.max(EDGE, box.bottom - height);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('button')?.focus();
  menu.addEventListener('close', () => anchor.focus(), { once: true });
}

/**
 * Close a menu on a click outside it. A modal dialog's backdrop belongs to the dialog, so such a
 * click targets the dialog itself; its position tells it from a click on the menu's own padding.
 * Call once per menu.
 *
 * @param {HTMLDialogElement} menu - The `.menu` dialog.
 * @returns {void}
 */
export function closeOnOutsideClick(menu) {
  menu.addEventListener('click', (event) => {
    if (event.target !== menu) return;
    const box = menu.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) menu.close();
  });
}
