// Paper on top, keypad below; swipe sideways between pages. Everything on screen is redrawn from the store after each change.

import * as tape from './tape.js';
import { NotebookStore, sameNoteEditing } from './store.js';
import { NumberFormat } from './number-format.js';
import { FONTS, THEMES, loadPrefs, metrics } from './prefs.js';
import { pageItems } from './layout.js';
import { escapeHTML, rowsHTML } from './page-view.js';
import { buildKeypad } from './keypad.js';
import { ICONS, onLongPress, showMenu, confirmAction } from './ui.js';
import { openLineEditor } from './line-editor.js';
import { openNotebook } from './notebook.js';
import { openSettings } from './settings.js';
import { pageImage, download } from './share.js';

const store = new NotebookStore();
const prefs = loadPrefs();
const format = NumberFormat.fromLocale();

const app = document.getElementById('app');
const pager = document.getElementById('pager');
const titleSlot = document.getElementById('title-slot');
const panel = document.getElementById('panel');
const dots = document.getElementById('page-dots');
const undoButton = document.getElementById('undo');

/** One sheet of paper per page, by page id: { section, rows, lastTail }. */
const papers = new Map();
let lineEditor = null;
let notebook = null;
let revealTimer = null;
/** How the pager moves to the selected page on the next redraw. */
let pagerBehavior = 'auto';

const evaluationOptions = () => ({ maxFractionDigits: prefs.decimals, format });

// MARK: - Drawing

function applyTheme() {
  const theme = THEMES[prefs.theme] ?? THEMES.sky;
  const font = FONTS[prefs.font] ?? FONTS.noteworthy;
  const root = document.documentElement;
  const vars = {
    '--panel': theme.panel,
    '--digit-fill': theme.digitFill,
    '--digit-text': theme.digitText,
    '--op-fill': theme.opFill,
    '--fn-fill': theme.fnFill,
    '--fn-text': theme.fnText,
    '--note-ink-light': theme.noteInk[0],
    '--note-ink-dark': theme.noteInk[1],
    '--hand-family': font.family,
    '--hand-weight': String(font.weight),
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  if (theme.scheme) root.dataset.scheme = theme.scheme;
  else delete root.dataset.scheme;
}

function render() {
  // While something is being typed on the page, the keyboard takes the keypad's place.
  panel.hidden = store.noteEditing !== null || store.titleEditing !== null;
  syncPapers();
  const page = store.selectedPage;
  const paper = papers.get(page.id);
  paper.section.classList.toggle('editing', store.editing !== null);
  drawPaper(paper, page);
  renderToolbar(page);
  undoButton.disabled = !store.canUndo;
  renderDots();
  showSelectedPaper();
  syncLineEditor(paper);
  startTyping(paper);
}

/** Adds and removes sheets of paper to match the notebook, keeping each one's scroll position. */
function syncPapers() {
  for (const [id, paper] of papers) {
    if (!store.page(id)) {
      paper.section.remove();
      papers.delete(id);
    }
  }
  store.pages.forEach((page, index) => {
    let paper = papers.get(page.id);
    const isNew = !paper;
    if (isNew) {
      const section = document.createElement('section');
      section.className = 'paper';
      section.dataset.page = page.id;
      paper = { section, rows: section.appendChild(document.createElement('div')), lastTail: null };
      papers.set(page.id, paper);
    }
    if (pager.children[index] !== paper.section) pager.insertBefore(paper.section, pager.children[index] ?? null);
    if (isNew) {
      drawPaper(paper, page);
      scrollToTail(paper, 'auto');
    }
  });
}

function drawPaper(paper, page) {
  const m = metrics(prefs.size);
  const width = pager.clientWidth || window.innerWidth;
  const height = paper.section.clientHeight || pager.clientHeight || window.innerHeight;
  const titleEditingID = store.titleEditing?.pageID === page.id ? store.titleEditing.calculationID : null;
  const items = pageItems(tape.evaluatePage(page, evaluationOptions()), prefs, format, {
    width,
    minimumRows: Math.ceil(height / m.rowHeight) + 1,
    titleEditingID,
  });
  paper.rows.className = `rows paper-${prefs.paper}`;
  paper.rows.style.setProperty('--row', `${m.rowHeight}px`);
  paper.rows.innerHTML = rowsHTML(items, {
    prefs,
    format,
    width,
    noteEditingID: noteEditingRowID(page),
    highlightedID: store.editing?.pageID === page.id ? store.editing.entryID : null,
    noteValue: store.noteText,
    titleEditingID,
    titleValue: store.titleEditing?.text ?? '',
  });

  // Follow the writing when the bottom of the tape changes.
  const tail = JSON.stringify([page.calculations.reduce((count, c) => count + c.entries.length, 0), page.draft]);
  if (paper.lastTail !== null && tail !== paper.lastTail && !store.editing) scrollToTail(paper, 'smooth');
  paper.lastTail = tail;
}

function noteEditingRowID(page) {
  const editing = store.noteEditing;
  if (!editing || editing.pageID !== page.id) return null;
  return editing.target.kind === 'draft' ? page.draft?.id ?? null : editing.target.id;
}

function scrollToTail(paper, behavior) {
  const tail = paper.rows.querySelector('[data-tail]');
  if (!tail) return;
  const top = Math.max(0, tail.offsetTop + tail.offsetHeight - paper.section.clientHeight);
  paper.section.scrollTo({ top, behavior });
}

function renderToolbar(page) {
  const editing = store.titleEditing;
  if (editing && editing.calculationID === null && editing.pageID === page.id) {
    if (!titleSlot.querySelector('input')) {
      titleSlot.innerHTML = '<input class="page-title-input" type="text" enterkeyhint="done" autocomplete="off" '
        + `spellcheck="false" aria-label="Page title" value="${escapeHTML(editing.text)}">`;
    }
  } else {
    titleSlot.innerHTML = `<button type="button" class="page-title" aria-label="Page title: ${escapeHTML(store.displayTitle(page))}. Tap to rename">`
      + `${escapeHTML(store.displayTitle(page))}</button>`;
  }
}

function renderDots() {
  const count = store.pages.length;
  const index = store.selectedIndex;
  dots.setAttribute('aria-label', `Page ${index + 1} of ${count}. Show all pages`);
  dots.innerHTML = count <= 10
    ? Array.from({ length: count }, (_, i) => `<span class="dot${i === index ? ' current' : ''}"></span>`).join('')
    : `${ICONS.book}<span class="count">${index + 1} / ${count}</span>`;
}

// MARK: - Pages, side by side

function showSelectedPaper() {
  const left = store.selectedIndex * pager.clientWidth;
  if (Math.abs(pager.scrollLeft - left) > 1) pager.scrollTo({ left, behavior: pagerBehavior });
  pagerBehavior = 'auto';
}

// Swiping lands on a page; once the pager settles, that page is the one being written on.
let settleTimer = null;
pager.addEventListener('scroll', () => {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const page = store.pages[Math.round(pager.scrollLeft / pager.clientWidth)];
    if (page && page.id !== store.selectedPageID) store.select(page.id);
  }, 120);
}, { passive: true });

// MARK: - Typing on the page

/** Puts the cursor in a note or title being typed. Called while handling the tap, which is when iPhone allows a keyboard. */
function startTyping(paper) {
  const note = paper.rows.querySelector('.note-input');
  if (note) {
    const editing = store.noteEditing;
    const fresh = startField(note, {
      onInput: (text) => store.setNoteText(text),
      isCurrent: () => sameNoteEditing(store.noteEditing, editing),
      finish: () => store.endNote(),
    });
    if (fresh) revealSoon(paper, note.closest('.row'));
  }
  const title = paper.rows.querySelector('.title-input') ?? titleSlot.querySelector('.page-title-input');
  if (title) {
    const editing = store.titleEditing;
    const fresh = startField(title, {
      onInput: (text) => store.setTitleText(text),
      isCurrent: () => store.titleEditing === editing,
      finish: () => store.endTitle(),
    });
    if (fresh && title.closest('.row')) revealSoon(paper, title.closest('.row'));
  }
}

/** Wires a field the first time it's seen: Return or leaving it finishes. Returns true for a new field. */
function startField(input, { onInput, isCurrent, finish }) {
  if (input.dataset.started) return false;
  input.dataset.started = 'true';
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
  });
  // Leaving the field puts the pen down, unless something else has already been started.
  input.addEventListener('blur', () => {
    if (isCurrent()) finish();
  });
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  return true;
}

/** Once the keyboard is up, bring the line being written into view. */
function revealSoon(paper, row) {
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    if (!row.isConnected) return;
    const top = row.offsetTop - (paper.section.clientHeight - row.offsetHeight) / 2;
    paper.section.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, 350);
}

// Tap beside a line to write its note; tap its number to change it; tap a title to rename it.
pager.addEventListener('click', (event) => {
  if (event.target.closest('input')) return;
  const paper = event.target.closest('.paper');
  if (paper?.dataset.page !== store.selectedPageID) return;
  const row = event.target.closest('.row');
  if (row?.dataset.type === 'row') {
    const x = event.clientX - row.getBoundingClientRect().left;
    const onNumber = x >= Number(row.dataset.start) && x <= Number(row.dataset.end);
    if (row.dataset.kind === 'draft') store.beginNote({ kind: 'draft' });
    else if (onNumber) store.beginEditing(row.dataset.id);
    else store.beginNote({ kind: 'entry', id: row.dataset.id });
  } else if (row?.dataset.type === 'heading') {
    store.beginTitle(store.selectedPageID, row.dataset.calculation);
  } else {
    store.finishTyping();
  }
});

// Dragging the page puts the keyboard away, like the iOS app.
let touchStart = null;
pager.addEventListener('touchstart', (event) => {
  touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });
pager.addEventListener('touchmove', (event) => {
  const field = pager.querySelector('.note-input, .title-input');
  if (!field || document.activeElement !== field || !touchStart) return;
  const touch = event.touches[0];
  if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > 12) field.blur();
}, { passive: true });

titleSlot.addEventListener('click', (event) => {
  if (event.target.closest('.page-title')) store.beginTitle(store.selectedPageID, null);
});

// MARK: - Long-press menus

onLongPress(pager, '.row.line, .row.heading', (row, point) => {
  if (row.closest('.paper')?.dataset.page !== store.selectedPageID || row.querySelector('input')) return;
  row.classList.add('menu-open');
  const items = row.dataset.type === 'heading' ? headingMenu(row) : lineMenu(row);
  showMenu(row.getBoundingClientRect(), point, items, () => row.classList.remove('menu-open'));
});

function lineMenu(row) {
  const page = store.selectedPage;
  const { id, kind } = row.dataset;
  const ref = { pageID: page.id, entryID: id };
  const evaluation = tape.evaluatePage(page, evaluationOptions());
  const evaluated = evaluation.draft?.id === id
    ? { ...evaluation.draft, isError: false }
    : evaluation.calculations.flatMap((calculation) => calculation.rows).find((candidate) => candidate.id === id);
  const calculation = kind === 'draft' ? null : tape.calculationContaining(page, id);

  const items = [{
    label: evaluated?.note ? 'Edit Note' : 'Add Note',
    icon: ICONS.note,
    action: () => store.beginNote(kind === 'draft' ? { kind: 'draft' } : { kind: 'entry', id }),
  }];
  if (kind !== 'draft') {
    items.push({ label: kind === 'total' ? 'Edit Total…' : 'Edit Line…', icon: ICONS.edit, action: () => store.beginEditing(id) });
  }
  if (kind === 'line') {
    items.push({
      label: 'Insert Line Below',
      icon: ICONS.insert,
      action: () => {
        const newID = store.insertLine(ref, true);
        if (newID) store.beginEditing(newID);
      },
    });
  }
  if (evaluated && !evaluated.isError && evaluated.text) {
    items.push({ label: `Copy ${evaluated.text}`, icon: ICONS.copy, action: () => navigator.clipboard?.writeText(evaluated.text) });
  }
  if (calculation && !calculation.title) {
    items.push({ label: 'Add Title', icon: ICONS.title, action: () => store.beginTitle(page.id, calculation.id) });
  }
  if (kind !== 'draft') {
    items.push({
      label: kind === 'total' ? 'Remove Total' : 'Delete Line',
      icon: ICONS.trash,
      destructive: true,
      separated: true,
      action: () => store.deleteEntry(ref, true),
    });
  }
  return items;
}

function headingMenu(row) {
  const pageID = store.selectedPageID;
  const calculationID = row.dataset.calculation;
  return [
    { label: 'Rename', icon: ICONS.rename, action: () => store.beginTitle(pageID, calculationID) },
    {
      label: 'Remove Title',
      icon: ICONS.remove,
      destructive: true,
      action: () => store.setCalculationTitle('', calculationID, pageID, true),
    },
  ];
}

// MARK: - Line editor and notebook

function syncLineEditor(paper) {
  if (store.editing && !lineEditor) {
    lineEditor = openLineEditor({
      store,
      format,
      onDismiss: () => {
        lineEditor = null;
        store.endEditing();
      },
    });
    revealAboveSheet(paper);
  } else if (!store.editing && lineEditor) {
    const editor = lineEditor;
    lineEditor = null;
    editor.close();
  } else {
    lineEditor?.update();
  }
}

/** Scrolls the line being edited into the paper left visible above the editor. */
function revealAboveSheet(paper) {
  requestAnimationFrame(() => {
    const row = paper.rows.querySelector('.highlighted');
    const sheet = app.querySelector('.sheet');
    if (!row || !sheet) return;
    const visibleTop = paper.section.getBoundingClientRect().top;
    const visibleBottom = app.getBoundingClientRect().bottom - sheet.offsetHeight;
    const box = row.getBoundingClientRect();
    const target = visibleTop + Math.max(0, (visibleBottom - visibleTop - box.height) / 2);
    paper.section.scrollBy({ top: box.top - target, behavior: 'smooth' });
  });
}

function showNotebook() {
  if (notebook) return;
  store.finishTyping();
  notebook = openNotebook({ store, evaluationOptions, onDismiss: () => { notebook = null; } });
}

document.getElementById('notebook-button').addEventListener('click', showNotebook);
dots.addEventListener('click', showNotebook);
document.getElementById('new-page-button').addEventListener('click', () => {
  pagerBehavior = 'smooth';
  store.newPage();
});

// Same page actions as the native toolbar.
const moreButton = document.getElementById('more-button');
function reportError(error) {
  if (error.name !== 'AbortError') window.alert(error.message || 'This action could not be completed.');
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const field = document.createElement('textarea'); field.value = text;
      document.body.appendChild(field); field.select();
      const copied = document.execCommand('copy'); field.remove();
      if (!copied) throw new Error('Copy is unavailable in this browser. Use Share as Text to save the page.');
    }
  } catch (error) { reportError(error); }
}
moreButton.addEventListener('click', () => {
  store.finishTyping();
  const page = structuredClone(store.selectedPage);
  const title = store.displayTitle(page);
  const options = evaluationOptions();
  const text = tape.plainText(page, options);
  const result = tape.evaluatePage(page, options).lastResultText;
  const filename = title.replace(/[^a-z0-9_-]/gi, '_') || 'DoodleTape';
  showMenu(moreButton.getBoundingClientRect(), { x: moreButton.getBoundingClientRect().right, y: 0 }, [
    { label: 'Share as Text', icon: ICONS.title, action: async () => {
      try {
        if (navigator.share) await navigator.share({ title, text });
        else download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${filename}.txt`);
      } catch (error) { reportError(error); }
    } },
    { label: 'Share as Image', icon: ICONS.copy, action: async () => {
      try {
        const blob = await pageImage(page, title, { ...prefs }, options);
        const file = new File([blob], `${filename}.png`, { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ title, files: [file] });
        else download(blob, file.name);
      } catch (error) { reportError(error); }
    } },
    { label: 'Copy Page', icon: ICONS.copy, action: () => copyText(text) },
    ...(result === null ? [] : [{ label: `Copy ${result}`, icon: ICONS.copy, action: () => copyText(result) }]),
    { label: 'Settings', icon: ICONS.edit, separated: true, action: () => openSettings({ prefs, format, onChange: () => {
      applyTheme();
      for (const [id, paper] of papers) drawPaper(paper, store.page(id));
      render();
    } }) },
    { label: 'Clear Page', icon: ICONS.trash, destructive: true, action: () => confirmAction({
      title: 'Clear this page?', message: 'Every calculation on it is erased. You can undo this.', confirmLabel: 'Clear Page', onConfirm: () => store.clearPage(page.id),
    }) },
  ]);
});

// MARK: - Keypad

function handleKey(action) {
  if (prefs.haptics) navigator.vibrate?.(action === 'equals' ? 20 : 10);
  const [type, value] = action.split(':');
  switch (type) {
    case 'digit': store.press(tape.Key.digit(Number(value))); break;
    case 'point': store.press(tape.Key.point); break;
    case 'op': store.press(tape.Key.op(value)); break;
    case 'percent': store.press(tape.Key.percent); break;
    case 'equals': store.press(tape.Key.equals); break;
    case 'backspace': store.press(tape.Key.backspace); break;
    case 'clear': store.press(tape.Key.clear); break;
    case 'note': store.beginNoteOnCurrentLine(); break;
  }
}

buildKeypad(document.getElementById('keypad'), { decimalSeparator: format.decimalSeparator, onKey: handleKey });
undoButton.addEventListener('click', () => store.undo());

// MARK: - Screen size and the iPhone keyboard

/** Keeps the app inside the part of the screen the keyboard leaves visible. */
function fitToViewport() {
  const viewport = window.visualViewport;
  app.style.height = `${viewport ? viewport.height : window.innerHeight}px`;
  app.style.transform = viewport?.offsetTop ? `translateY(${viewport.offsetTop}px)` : '';
}

window.visualViewport?.addEventListener('resize', fitToViewport);
window.visualViewport?.addEventListener('scroll', fitToViewport);
window.addEventListener('resize', () => {
  fitToViewport();
  // Redrawing would replace the field being typed in and close the keyboard.
  if (store.noteEditing || store.titleEditing) return;
  for (const [id, paper] of papers) drawPaper(paper, store.page(id));
  pager.scrollTo({ left: store.selectedIndex * pager.clientWidth });
});

// MARK: - Saving and offline

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.saveNow();
});
window.addEventListener('pagehide', () => store.saveNow());

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Calculator: offline support unavailable', error));
}
// Ask the phone to keep the notebook even when storage runs low.
navigator.storage?.persist?.().catch(() => {});

applyTheme();
fitToViewport();
store.subscribe(render);
render();
