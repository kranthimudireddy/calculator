// Small iOS-style pieces shared by the screens: icons, long press, the context menu, sheets and confirmations.

import { escapeHTML } from './page-view.js';

const icon = (paths) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  note: icon('<path d="M4 20.5h16"/><path d="M14.6 4.6l3.3 3.3-8.6 8.6-4.3 1 1-4.3z"/>'),
  edit: icon('<path d="M4 7h8M16 7h4M4 12h2M10 12h10M4 17h10M18 17h2"/><circle cx="14" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="17" r="2"/>'),
  insert: icon('<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 9.5l3.5 2.5L4 14.5z"/>'),
  copy: icon('<rect x="8" y="8" width="11" height="13" rx="2"/><path d="M5 16V5a2 2 0 0 1 2-2h8"/>'),
  title: icon('<path d="M5 6h14M12 6v13"/>'),
  rename: icon('<path d="M14.6 4.6l3.3 3.3-9.6 9.6-4.3 1 1-4.3z"/>'),
  remove: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
  trash: icon('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>'),
  duplicate: icon('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M4 15V6a2 2 0 0 1 2-2h9M14 11v6M11 14h6"/>'),
  book: icon('<path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z"/><path d="M6 3.5v17M9.5 8h6M9.5 11.5h6M9.5 15h4"/>'),
  newPage: icon('<path d="M11 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-5"/><path d="M17.5 3.8l2.7 2.7-7.7 7.7-3.4.7.7-3.4z"/>'),
  check: icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

const app = () => document.getElementById('app');

/** Things that close with Escape on a keyboard, most recent first. */
const closers = [];
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && closers.length > 0) closers.at(-1)();
});

function forget(closer) {
  const index = closers.indexOf(closer);
  if (index >= 0) closers.splice(index, 1);
}

function slideIn(element) {
  void element.offsetHeight; // let the starting position apply before the transition
  element.classList.add('shown');
}

// MARK: - Long press

/**
 * Calls `handler(element, point)` when an element matching `selector` is held for half a second,
 * or right-clicked. The tap that ends a long press doesn't count as a tap.
 */
export function onLongPress(container, selector, handler) {
  let press = null;
  const cancel = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  container.addEventListener('pointerdown', (event) => {
    const element = event.target.closest(selector);
    cancel();
    if (!element || event.target.closest('input')) return;
    const point = { x: event.clientX, y: event.clientY };
    press = {
      point,
      timer: setTimeout(() => {
        press = null;
        swallowReleaseClick();
        handler(element, point);
      }, 480),
    };
  });
  container.addEventListener('pointermove', (event) => {
    if (press && Math.hypot(event.clientX - press.point.x, event.clientY - press.point.y) > 8) cancel();
  });
  container.addEventListener('pointerup', cancel);
  container.addEventListener('pointercancel', cancel);
  container.addEventListener('contextmenu', (event) => {
    const element = event.target.closest(selector);
    if (!element || event.target.closest('input')) return;
    event.preventDefault();
    cancel();
    handler(element, { x: event.clientX, y: event.clientY });
  });
}

/** Drops the click that may follow lifting the finger after a long press; the next touch is a fresh tap. */
function swallowReleaseClick() {
  const swallow = (event) => {
    event.stopPropagation();
    event.preventDefault();
    done();
  };
  const done = () => {
    document.removeEventListener('click', swallow, true);
    document.removeEventListener('pointerdown', done, true);
  };
  document.addEventListener('click', swallow, true);
  document.addEventListener('pointerdown', done, true);
}

// MARK: - Context menu

let menu = null;

/**
 * A context menu under (or above) `anchor`, centred on the pressed point.
 * Items are { label, icon, action, destructive, separated }.
 */
export function showMenu(anchor, point, items, onClose) {
  closeMenu();
  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  backdrop.innerHTML = `<div class="menu" role="menu">${items.map((item, index) => {
    const classes = ['menu-item', item.destructive && 'destructive', item.separated && 'separated'].filter(Boolean).join(' ');
    return `<button type="button" role="menuitem" class="${classes}" data-index="${index}"><span>${escapeHTML(item.label)}</span>${item.icon ?? ''}</button>`;
  }).join('')}</div>`;
  app().appendChild(backdrop);

  const panel = backdrop.querySelector('.menu');
  const bounds = app().getBoundingClientRect();
  const left = Math.min(Math.max(12, point.x - bounds.left - panel.offsetWidth / 2), bounds.width - panel.offsetWidth - 12);
  const below = anchor.bottom - bounds.top + 6;
  const above = anchor.top - bounds.top - panel.offsetHeight - 6;
  panel.style.left = `${left}px`;
  panel.style.top = `${below + panel.offsetHeight <= bounds.height - 12 ? below : Math.max(12, above)}px`;

  // The action runs inside this tap, which is what lets it open the keyboard.
  backdrop.addEventListener('click', (event) => {
    const button = event.target.closest('.menu-item');
    closeMenu();
    if (button) items[Number(button.dataset.index)].action();
  });
  menu = { backdrop, onClose };
  closers.push(closeMenu);
  slideIn(backdrop);
}

export function closeMenu() {
  if (!menu) return;
  const { backdrop, onClose } = menu;
  menu = null;
  forget(closeMenu);
  backdrop.remove();
  onClose?.();
}

// MARK: - Sheets

/**
 * A sheet sliding up from the bottom with a title bar. `leading` and `trailing` are HTML for the bar.
 * Returns { sheet, header, body, close }. Tapping outside the sheet closes it.
 */
export function openSheet({ title, leading = '', trailing = '', className = '', onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<section class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">`
    + `<header class="sheet-header"><div class="sheet-side">${leading}</div><h2 class="sheet-title">${escapeHTML(title)}</h2>`
    + `<div class="sheet-side end">${trailing}</div></header><div class="sheet-body"></div></section>`;
  app().appendChild(backdrop);
  const sheet = backdrop.querySelector('.sheet');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    forget(close);
    backdrop.classList.remove('shown');
    setTimeout(() => backdrop.remove(), 320);
    onClose?.();
  };
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  closers.push(close);
  slideIn(backdrop);
  return {
    sheet,
    header: sheet.querySelector('.sheet-header'),
    body: sheet.querySelector('.sheet-body'),
    setTitle: (text) => { sheet.querySelector('.sheet-title').textContent = text; },
    close,
  };
}

// MARK: - Confirmation

/** An action sheet asking to confirm something that can't be undone. */
export function confirmAction({ title, message, confirmLabel, onConfirm }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop confirm-backdrop';
  backdrop.innerHTML = `<div class="confirm" role="alertdialog" aria-label="${escapeHTML(title)}">`
    + `<div class="confirm-group"><div class="confirm-message"><strong>${escapeHTML(title)}</strong>`
    + `${message ? `<span>${escapeHTML(message)}</span>` : ''}</div>`
    + `<button type="button" class="confirm-button destructive" data-confirm>${escapeHTML(confirmLabel)}</button></div>`
    + '<button type="button" class="confirm-button cancel" data-cancel>Cancel</button></div>';
  app().appendChild(backdrop);

  const close = () => {
    forget(close);
    backdrop.classList.remove('shown');
    setTimeout(() => backdrop.remove(), 320);
  };
  backdrop.addEventListener('click', (event) => {
    if (event.target.closest('[data-confirm]')) {
      close();
      onConfirm();
    } else if (event.target.closest('[data-cancel]') || event.target === backdrop) {
      close();
    }
  });
  closers.push(close);
  slideIn(backdrop);
}
