// Every page in the notebook, newest first.

import * as tape from './tape.js';
import { escapeHTML } from './page-view.js';
import { ICONS, confirmAction, onLongPress, openSheet, showMenu } from './ui.js';

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const SWIPE_WIDTH = 168;

export function openNotebook({ store, evaluationOptions, onDismiss }) {
  let renamingID = null;
  let swipedID = null;

  const { header, body, close } = openSheet({
    title: 'Notebook',
    leading: '<button type="button" class="sheet-button" data-close>Close</button>',
    trailing: `<button type="button" class="sheet-icon-button" data-new aria-label="New page">${ICONS.newPage}</button>`,
    className: 'sheet-large',
    onClose: () => {
      unsubscribe();
      onDismiss?.();
    },
  });
  header.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) {
      close();
    } else if (event.target.closest('[data-new]')) {
      store.newPage();
      close();
    }
  });

  function render() {
    body.innerHTML = `<ul class="notebook">${[...store.pages].reverse().map(row).join('')}</ul>`;
    const input = body.querySelector('.rename-input');
    if (input) startRenaming(input);
  }

  function row(page) {
    const result = tape.evaluatePage(page, evaluationOptions()).lastResultText;
    const title = page.id === renamingID
      ? `<input class="rename-input" type="text" enterkeyhint="done" autocomplete="off" spellcheck="false" aria-label="Page title" value="${escapeHTML(page.title)}">`
      : `<span class="notebook-title">${escapeHTML(store.displayTitle(page))}</span>`;
    const offset = page.id === swipedID ? -SWIPE_WIDTH : 0;
    return `<li class="notebook-row" data-id="${page.id}">`
      + '<div class="swipe-actions">'
      + `<button type="button" class="swipe-action duplicate" data-duplicate>${ICONS.duplicate}<span>Duplicate</span></button>`
      + `<button type="button" class="swipe-action delete" data-delete>${ICONS.trash}<span>Delete</span></button>`
      + '</div>'
      + `<div class="notebook-content" style="transform:translateX(${offset}px)">`
      + `<div class="notebook-text">${title}<span class="notebook-summary">${escapeHTML(summary(page))}</span></div>`
      + (result ? `<span class="notebook-result">${escapeHTML(result)}</span>` : '')
      + (page.id === store.selectedPageID ? `<span class="notebook-check">${ICONS.check}</span>` : '')
      + '</div></li>';
  }

  // MARK: Taps

  body.addEventListener('click', (event) => {
    const item = event.target.closest('.notebook-row');
    if (dragged) {
      dragged = false;
      return;
    }
    if (!item || event.target.closest('input')) return;
    const id = item.dataset.id;
    if (event.target.closest('[data-duplicate]')) {
      swipedID = null;
      store.duplicatePage(id);
    } else if (event.target.closest('[data-delete]')) {
      swipedID = null;
      askToDelete(id);
    } else if (swipedID) {
      swipedID = null;
      render();
    } else if (renamingID) {
      body.querySelector('.rename-input')?.blur();
    } else {
      store.select(id);
      close();
    }
  });

  onLongPress(body, '.notebook-content', (content) => {
    const id = content.closest('.notebook-row').dataset.id;
    content.classList.add('pressed');
    showMenu(content.getBoundingClientRect(), pointOf(content), [
      { label: 'Rename', icon: ICONS.rename, action: () => rename(id) },
      { label: 'Duplicate', icon: ICONS.duplicate, action: () => store.duplicatePage(id) },
      { label: 'Delete', icon: ICONS.trash, destructive: true, action: () => askToDelete(id) },
    ], () => content.classList.remove('pressed'));
  });

  function askToDelete(id) {
    const page = store.page(id);
    if (!page) return;
    render();
    confirmAction({
      title: 'Delete this page?',
      message: 'Its calculations and notes will be gone for good.',
      confirmLabel: `Delete ${store.displayTitle(page)}`,
      onConfirm: () => store.deletePage(id),
    });
  }

  // MARK: Renaming in place

  function rename(id) {
    renamingID = id;
    swipedID = null;
    render();
  }

  function startRenaming(input) {
    const id = renamingID;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });
    input.addEventListener('blur', () => {
      if (renamingID !== id) return;
      renamingID = null;
      if (input.value.trim() !== store.page(id)?.title) store.renamePage(id, input.value);
      else render();
    });
  }

  // MARK: Swipe for Duplicate and Delete

  let drag = null;
  // A drag can end with a click on the row; that click isn't a tap.
  let dragged = false;
  body.addEventListener('pointerdown', (event) => {
    dragged = false;
    const content = event.target.closest('.notebook-content');
    if (!content || renamingID) return;
    const id = content.closest('.notebook-row').dataset.id;
    const base = id === swipedID ? -SWIPE_WIDTH : 0;
    drag = { content, id, startX: event.clientX, startY: event.clientY, base, offset: base, moving: false };
  });
  body.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moving) {
      if (Math.abs(event.clientY - drag.startY) > 10) {
        drag = null;
        return;
      }
      if (Math.abs(dx) < 10) return;
      drag.moving = true;
      drag.content.classList.add('dragging');
    }
    drag.offset = Math.min(0, Math.max(-SWIPE_WIDTH - 40, drag.base + dx));
    drag.content.style.transform = `translateX(${drag.offset}px)`;
  });
  const endDrag = () => {
    if (!drag) return;
    const { id, offset, moving } = drag;
    drag = null;
    if (!moving) return;
    dragged = true;
    swipedID = offset < -SWIPE_WIDTH / 2.5 ? id : null;
    render();
  };
  body.addEventListener('pointerup', endDrag);
  body.addEventListener('pointercancel', endDrag);

  const unsubscribe = store.subscribe(render);
  render();
  return { close };
}

function summary(page) {
  const lines = page.calculations.reduce((count, c) => count + c.entries.filter((entry) => entry.kind === 'line').length, 0);
  return `${lines === 1 ? '1 line' : `${lines} lines`} · ${ago(page.modifiedAt)}`;
}

function ago(time) {
  const seconds = Math.round((time - Date.now()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(0, 'second');
}

function pointOf(element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}
