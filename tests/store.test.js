import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookStore } from '../js/store.js';
import * as tape from '../js/tape.js';

function storage(notebook) {
  const values = new Map(notebook ? [['calculator.notebook', JSON.stringify(notebook)]] : []);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function sample() {
  const page = tape.newPage('Welcome');
  page.calculations = [
    tape.newCalculation([tape.newLine(null, '12.40', {note:'milk & eggs'}), tape.newLine('+', '8.99', {note:'bread'}), tape.newLine('+', '23.50', {note:'coffee beans'}), tape.newTotal('this week')], 'Groceries'),
    tape.newCalculation([tape.newLine(null, '86.50', {note:'the bill'}), tape.newLine('+', '15', {mode:'percent',note:'tip'}), tape.newTotal(), tape.newLine('/', '4', {note:'people'}), tape.newTotal('each')], 'Dinner for four'),
  ];
  return page;
}
test('new PWA notebook starts blank', () => {
  storage(); const store = new NotebookStore();
  assert.equal(store.pages.length, 1);
  assert.equal(store.selectedPage.title, '');
  assert.deepEqual(store.selectedPage.calculations, []);
});
test('bundled demo is removed while saved user pages remain selected', () => {
  const demo = sample(), user = tape.newPage('My sums');
  storage({pages:[demo,user],selectedPageID:user.id});
  const store = new NotebookStore();
  assert.deepEqual(store.pages.map(p => p.id), [user.id]);
  assert.equal(store.selectedPageID, user.id);
});
test('edited Welcome page is preserved', () => {
  const demo = sample(); demo.calculations[0].entries[0].text = '99';
  storage({pages:[demo],selectedPageID:demo.id});
  assert.equal(new NotebookStore().selectedPage.id, demo.id);
});
