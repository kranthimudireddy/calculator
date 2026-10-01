// Owns the notebook: every page, the page on screen, note editing, undo, and saving on the phone.
// A port of the iOS app's NotebookStore.

import * as tape from './tape.js';

const STORAGE_KEY = 'calculator.notebook';

export class NotebookStore {
  constructor() {
    const notebook = loadNotebook() ?? emptyNotebook();
    // Remove only the unchanged bundled demo; keep edited Welcome pages.
    notebook.pages = notebook.pages.filter(page => !isOriginalSample(page));
    this.pages = notebook.pages.length > 0 ? notebook.pages : [tape.newPage()];
    this.selectedPageID = this.pages.find((page) => page.id === notebook.selectedPageID)?.id ?? this.pages.at(-1).id;
    /** The line whose note is being typed on the page: { pageID, target: { kind: 'draft' } or { kind: 'entry', id } }. */
    this.noteEditing = null;
    /** A line open in the line editor: { pageID, entryID }. */
    this.editing = null;
    /** A title being typed in place: { pageID, calculationID (null for the page's own title), text }. */
    this.titleEditing = null;
    this.undoStack = [];
    this.listeners = new Set();
    this.saveTimer = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener();
  }

  // MARK: Pages

  get selectedIndex() {
    return Math.max(0, this.pages.findIndex((page) => page.id === this.selectedPageID));
  }

  get selectedPage() {
    return this.pages[this.selectedIndex];
  }

  page(id) {
    return this.pages.find((page) => page.id === id) ?? null;
  }

  displayTitle(page) {
    if (page.title) return page.title;
    return `Page ${this.pages.findIndex((candidate) => candidate.id === page.id) + 1}`;
  }

  select(pageID) {
    if (pageID === this.selectedPageID || !this.page(pageID)) return;
    this.finishTyping();
    this.selectedPageID = pageID;
    this.scheduleSave();
    this.notify();
  }

  /** Opens a blank page at the end (reusing the last page if it's already blank). */
  newPage() {
    this.finishTyping();
    const last = this.pages.at(-1);
    if (last && isBlank(last) && !last.title) {
      this.select(last.id);
      return;
    }
    const page = tape.newPage();
    this.pages.push(page);
    this.selectedPageID = page.id;
    this.scheduleSave();
    this.notify();
  }

  duplicatePage(id) {
    const index = this.pages.findIndex((page) => page.id === id);
    if (index < 0) return;
    const copy = structuredClone(this.pages[index]);
    copy.id = tape.uuid();
    copy.title = `${this.displayTitle(this.pages[index])} copy`;
    copy.createdAt = copy.modifiedAt = Date.now();
    this.pages.splice(index + 1, 0, copy);
    this.selectedPageID = copy.id;
    this.scheduleSave();
    this.notify();
  }

  deletePage(id) {
    const index = this.pages.findIndex((page) => page.id === id);
    if (index < 0) return;
    this.finishTyping();
    this.pages.splice(index, 1);
    this.undoStack = this.undoStack.filter((snapshot) => snapshot.id !== id);
    if (this.pages.length === 0) this.pages = [tape.newPage()];
    if (this.selectedPageID === id || !this.page(this.selectedPageID)) {
      this.selectedPageID = this.pages[Math.min(index, this.pages.length - 1)].id;
    }
    this.scheduleSave();
    this.notify();
  }

  renamePage(id, title) {
    this.mutate(id, true, (page) => { page.title = title.trim(); });
  }

  clearPage(id) {
    this.finishTyping();
    this.mutate(id, true, (page) => {
      page.calculations = [];
      page.draft = null;
    });
  }

  // MARK: Keypad

  press(key) {
    const page = this.selectedPage;
    let changesStructure = true;
    if (key.type === 'digit' || key.type === 'point') changesStructure = false;
    else if (key.type === 'backspace') changesStructure = page.draft === null;
    this.mutate(page.id, changesStructure, (p) => tape.apply(p, key));
  }

  // MARK: Notes

  /** Starts a note on the line being typed, or else on the last line of the page. */
  beginNoteOnCurrentLine() {
    const page = this.selectedPage;
    const lastEntry = page.calculations.at(-1)?.entries.at(-1);
    if (page.draft && tape.hasDigits(page.draft)) this.beginNote({ kind: 'draft' });
    else if (lastEntry) this.beginNote({ kind: 'entry', id: lastEntry.id });
    else if (page.draft) this.beginNote({ kind: 'draft' });
  }

  beginNote(target) {
    const editing = { pageID: this.selectedPageID, target };
    if (sameNoteEditing(this.noteEditing, editing)) return;
    this.finishTyping();
    this.checkpoint(this.selectedPageID);
    this.noteEditing = editing;
    this.notify();
  }

  endNote() {
    const editing = this.noteEditing;
    if (!editing) return;
    const text = this.noteText;
    this.noteEditing = null;
    const trimmed = text.trim();
    if (trimmed !== text) this.writeNote(trimmed, editing);
    this.notify();
  }

  get noteText() {
    const editing = this.noteEditing;
    const page = editing && this.page(editing.pageID);
    if (!page) return '';
    if (editing.target.kind === 'draft') return page.draft?.note ?? '';
    return tape.entryOf(page, editing.target.id)?.note ?? '';
  }

  /** Typing a note: saved, but nothing else on screen changes, so no redraw. */
  setNoteText(text) {
    if (this.noteEditing) this.writeNote(text, this.noteEditing);
  }

  writeNote(note, editing) {
    const page = this.page(editing.pageID);
    if (!page) return;
    if (editing.target.kind === 'draft') {
      if (page.draft) page.draft.note = note;
    } else {
      tape.setNote(page, editing.target.id, note);
    }
    this.scheduleSave();
  }

  // MARK: Titles, typed in place

  /** Starts typing a calculation's title on the page, or the page's own title when `calculationID` is null. */
  beginTitle(pageID, calculationID = null) {
    const page = this.page(pageID);
    if (!page) return;
    if (this.titleEditing?.pageID === pageID && this.titleEditing.calculationID === calculationID) return;
    this.finishTyping();
    const text = calculationID ? page.calculations.find((c) => c.id === calculationID)?.title ?? '' : page.title;
    this.titleEditing = { pageID, calculationID, text };
    this.notify();
  }

  /** Typing a title: kept until the title is finished, so nothing else redraws. */
  setTitleText(text) {
    if (this.titleEditing) this.titleEditing.text = text;
  }

  endTitle() {
    const editing = this.titleEditing;
    if (!editing) return;
    this.titleEditing = null;
    const page = this.page(editing.pageID);
    const title = editing.text.trim();
    const current = editing.calculationID
      ? page?.calculations.find((c) => c.id === editing.calculationID)?.title
      : page?.title;
    if (current === undefined || title === current) this.notify();
    else if (editing.calculationID) this.setCalculationTitle(title, editing.calculationID, editing.pageID, true);
    else this.renamePage(editing.pageID, title);
  }

  /** Puts the pen down on whatever is being typed on the page. */
  finishTyping() {
    this.endNote();
    this.endTitle();
  }

  // MARK: Editing lines on the tape

  beginEditing(entryID) {
    this.finishTyping();
    this.checkpoint(this.selectedPageID);
    this.editing = { pageID: this.selectedPageID, entryID };
    this.notify();
  }

  /** Moves the open line editor to another line, e.g. one just inserted. */
  editInstead(entryID) {
    if (!this.editing) return;
    this.editing = { pageID: this.editing.pageID, entryID };
    this.notify();
  }

  endEditing() {
    if (!this.editing) return;
    this.editing = null;
    this.notify();
  }

  updateLine(ref, change) {
    this.mutate(ref.pageID, false, (page) => tape.updateLine(page, ref.entryID, change));
  }

  setCalculationTitle(title, calculationID, pageID, checkpoint = false) {
    this.mutate(pageID, checkpoint, (page) => tape.setCalculationTitle(page, calculationID, title));
  }

  deleteEntry(ref, checkpoint = false) {
    this.mutate(ref.pageID, checkpoint, (page) => tape.deleteEntry(page, ref.entryID));
  }

  insertLine(ref, checkpoint = false) {
    let newID = null;
    this.mutate(ref.pageID, checkpoint, (page) => { newID = tape.insertLineAfter(page, ref.entryID); });
    return newID;
  }

  // MARK: Undo

  checkpoint(pageID) {
    const page = this.page(pageID);
    if (!page) return;
    const snapshot = JSON.stringify(page);
    if (this.undoStack.length > 0 && JSON.stringify(this.undoStack.at(-1)) === snapshot) return;
    this.undoStack.push(JSON.parse(snapshot));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  undo() {
    this.noteEditing = null;
    this.titleEditing = null;
    const snapshot = this.undoStack.pop();
    if (snapshot) {
      const index = this.pages.findIndex((page) => page.id === snapshot.id);
      if (index >= 0) this.pages[index] = snapshot;
      else this.pages.push(snapshot);
      this.selectedPageID = snapshot.id;
      this.scheduleSave();
    }
    this.notify();
  }

  // MARK: Saving

  mutate(pageID, shouldCheckpoint, change) {
    const page = this.page(pageID);
    if (!page) return;
    if (shouldCheckpoint) this.checkpoint(pageID);
    change(page);
    this.scheduleSave();
    this.notify();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    const notebook = { version: 1, pages: this.pages, selectedPageID: this.selectedPageID };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notebook));
    } catch (error) {
      console.error("Calculator: couldn't save the notebook", error);
    }
  }
}

export function sameNoteEditing(a, b) {
  return Boolean(a && b) && a.pageID === b.pageID && a.target.kind === b.target.kind && a.target.id === b.target.id;
}

function isBlank(page) {
  return page.calculations.length === 0 && page.draft === null;
}

function loadNotebook() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!saved) return null;
  try {
    const notebook = JSON.parse(saved);
    if (!Array.isArray(notebook.pages)) throw new Error('no pages');
    return notebook;
  } catch (error) {
    // Keep the unreadable copy rather than overwriting someone's sums.
    try {
      localStorage.setItem(`${STORAGE_KEY}.unreadable-${Date.now()}`, saved);
    } catch {
      // Nowhere to keep it.
    }
    console.error('Calculator: notebook unreadable, kept a copy', error);
    return null;
  }
}

/** New installs open a clean sheet. */
function emptyNotebook() {
  const page = tape.newPage();
  return { version: 1, pages: [page], selectedPageID: page.id };
}

function isOriginalSample(page) {
  if (page.title !== 'Welcome' || page.draft !== null) return false;
  const content = page.calculations.map(c => [c.title, c.entries.map(e =>
    e.kind === 'total' ? ['total', e.note] : ['line', e.op, e.text, e.mode, e.note])]);
  return JSON.stringify(content) === JSON.stringify([
    ['Groceries', [
      ['line', null, '12.40', 'number', 'milk & eggs'],
      ['line', '+', '8.99', 'number', 'bread'],
      ['line', '+', '23.50', 'number', 'coffee beans'],
      ['total', 'this week'],
    ]],
    ['Dinner for four', [
      ['line', null, '86.50', 'number', 'the bill'],
      ['line', '+', '15', 'percent', 'tip'],
      ['total', ''], ['line', '/', '4', 'number', 'people'], ['total', 'each'],
    ]],
  ]);
}
