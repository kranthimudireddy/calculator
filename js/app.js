// Paper on top, keypad below. Everything on screen is redrawn from the store after each change.

import * as tape from './tape.js';
import { NotebookStore, sameNoteEditing } from './store.js';
import { NumberFormat } from './number-format.js';
import { FONTS, THEMES, loadPrefs, metrics } from './prefs.js';
import { pageItems } from './layout.js';
import { rowsHTML } from './page-view.js';
import { buildKeypad } from './keypad.js';

const store = new NotebookStore();
const prefs = loadPrefs();
const format = NumberFormat.fromLocale();

const app = document.getElementById('app');
const pageView = document.getElementById('page');
const rowsView = document.getElementById('rows');
const titleView = document.getElementById('page-title');
const panel = document.getElementById('panel');
const dots = document.getElementById('page-dots');
const undoButton = document.getElementById('undo');

let lastTail = null;
let revealTimer = null;

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
  const page = store.selectedPage;
  const m = metrics(prefs.size);
  // While a note is being written on the page, the keyboard takes the keypad's place.
  panel.hidden = store.noteEditing !== null;

  const width = pageView.clientWidth || window.innerWidth;
  const height = pageView.clientHeight || window.innerHeight;
  const evaluation = tape.evaluatePage(page, evaluationOptions());
  const items = pageItems(evaluation, prefs, format, { width, minimumRows: Math.ceil(height / m.rowHeight) + 1 });
  rowsView.className = `rows paper-${prefs.paper}`;
  rowsView.style.setProperty('--row', `${m.rowHeight}px`);
  rowsView.innerHTML = rowsHTML(items, {
    prefs,
    format,
    width,
    noteEditingID: noteEditingRowID(page),
    highlightedID: store.editing?.pageID === page.id ? store.editing.entryID : null,
    noteValue: store.noteText,
  });

  titleView.textContent = store.displayTitle(page);
  undoButton.disabled = !store.canUndo;
  renderDots();

  const input = rowsView.querySelector('.note-input');
  if (input) startTyping(input);

  // Follow the writing when the bottom of the tape changes.
  const tail = JSON.stringify([page.id, page.calculations.reduce((count, c) => count + c.entries.length, 0), page.draft]);
  if (tail !== lastTail && !store.editing) {
    const samePage = lastTail?.startsWith(JSON.stringify([page.id]).slice(0, -1));
    scrollToTail(samePage ? 'smooth' : 'auto');
  }
  lastTail = tail;
}

function noteEditingRowID(page) {
  const editing = store.noteEditing;
  if (!editing || editing.pageID !== page.id) return null;
  return editing.target.kind === 'draft' ? page.draft?.id ?? null : editing.target.id;
}

function renderDots() {
  const count = store.pages.length;
  const index = store.selectedIndex;
  dots.setAttribute('aria-label', `Page ${index + 1} of ${count}`);
  dots.innerHTML = count <= 10
    ? Array.from({ length: count }, (_, i) => `<span class="dot${i === index ? ' current' : ''}"></span>`).join('')
    : `<span class="count">${index + 1} / ${count}</span>`;
}

function scrollToTail(behavior) {
  const tail = rowsView.querySelector('[data-tail]');
  if (!tail) return;
  const top = Math.max(0, tail.offsetTop + tail.offsetHeight - pageView.clientHeight);
  pageView.scrollTo({ top, behavior });
}

// MARK: - Writing notes on the page

/** Puts the cursor in the note field. Called while handling the tap, which is when iPhone allows a keyboard. */
function startTyping(input) {
  const editing = store.noteEditing;
  input.addEventListener('input', () => store.setNoteText(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
  });
  // Puts the pen down, unless another line's note has already been started.
  input.addEventListener('blur', () => {
    if (sameNoteEditing(store.noteEditing, editing)) store.endNote();
  });
  if (document.activeElement !== input) {
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }
  // Once the keyboard is up, bring the line into view.
  const row = input.closest('.row');
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    if (!row.isConnected) return;
    const top = row.offsetTop - (pageView.clientHeight - row.offsetHeight) / 2;
    pageView.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, 350);
}

// Tap beside a line to write its note right there; tap empty paper to finish.
rowsView.addEventListener('click', (event) => {
  if (event.target.closest('.note-input')) return;
  const row = event.target.closest('.row');
  if (row?.dataset.type !== 'row') {
    store.endNote();
    return;
  }
  const x = event.clientX - row.getBoundingClientRect().left;
  const onNumber = x >= Number(row.dataset.start) && x <= Number(row.dataset.end);
  if (row.dataset.kind === 'draft') store.beginNote({ kind: 'draft' });
  else if (!onNumber) store.beginNote({ kind: 'entry', id: row.dataset.id });
  else store.endNote();
});

// Dragging the page puts the keyboard away, like the iOS app.
let touchStartY = null;
pageView.addEventListener('touchstart', (event) => { touchStartY = event.touches[0].clientY; }, { passive: true });
pageView.addEventListener('touchmove', (event) => {
  const input = rowsView.querySelector('.note-input');
  if (input && document.activeElement === input && Math.abs(event.touches[0].clientY - touchStartY) > 12) input.blur();
}, { passive: true });

// MARK: - Keypad

function handleKey(action) {
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
  // Redrawing would replace the note field and close the keyboard.
  if (!store.noteEditing) render();
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
