import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../js/decimal.js';
import { NumberFormat } from '../js/number-format.js';
import * as tape from '../js/tape.js';

// MARK: - Helpers

const options = { maxFractionDigits: 2, format: NumberFormat.posix };

/** Types keys into a page: digits, ".", + - * / % =, and "<" for backspace. */
function type(keys, page) {
  for (const key of keys) {
    if (/\d/.test(key)) tape.apply(page, tape.Key.digit(Number(key)));
    else if (key === '.') tape.apply(page, tape.Key.point);
    else if ('+-*/'.includes(key)) tape.apply(page, tape.Key.op(key));
    else if (key === '%') tape.apply(page, tape.Key.percent);
    else if (key === '=') tape.apply(page, tape.Key.equals);
    else if (key === '<') tape.apply(page, tape.Key.backspace);
    else if (key !== ' ') throw new Error(`Unknown key ${key}`);
  }
  return page;
}

const page = (keys) => type(keys, tape.newPage());
const evaluate = (p, opts = options) => tape.evaluatePage(p, opts);
const texts = (p, calculation = 0) => evaluate(p).calculations[calculation].rows.map((row) => row.text);
const result = (p, calculation = 0) => evaluate(p).calculations[calculation].result?.toString() ?? null;
const dec = (text) => Decimal.parse(text);

// MARK: - Typing

test('adds a column of numbers', () => {
  const p = page('159 + 357 + 654 =');
  assert.equal(p.calculations.length, 1);
  assert.deepEqual(texts(p), ['159', '357', '654', '1,170']);
  assert.equal(evaluate(p).calculations[0].rows.at(-1).kind, 'total');
  assert.equal(result(p), '1170');
  assert.equal(p.draft, null);
});

test('an operator after a total continues the same calculation', () => {
  const p = page('159+357+654= -39=');
  assert.equal(p.calculations.length, 1);
  assert.deepEqual(texts(p), ['159', '357', '654', '1,170', '39', '1,131']);
});

test('a digit after a total starts a new calculation', () => {
  const p = page('2+2= 5*3=');
  assert.equal(p.calculations.length, 2);
  assert.equal(result(p, 0), '4');
  assert.equal(result(p, 1), '15');
});

test('works left to right like a tape', () => {
  assert.equal(result(page('2+3*4=')), '20');
  assert.equal(result(page('10-4/2=')), '3');
});

test('decimals are exact', () => {
  assert.equal(result(page('0.1+0.2=')), '0.3');
});

test('an operator pressed twice replaces the first', () => {
  const p = page('5+-3=');
  assert.equal(result(p), '2');
  assert.equal(evaluate(p).calculations[0].rows[1].symbol, 'minus');
});

test('the first operator on an empty page starts from zero', () => {
  assert.equal(result(page('-5=')), '-5');
});

test('leading zeros and decimal points', () => {
  assert.equal(page('.5').draft.digits, '0.5');
  assert.equal(page('007').draft.digits, '7');
  assert.equal(page('1..2').draft.digits, '1.2');
});

test('limits the length of typed numbers', () => {
  assert.equal(page('12345678901234567890').draft.digits.length, tape.MAX_DIGITS);
});

test('equals on a single number', () => {
  assert.deepEqual(texts(page('250=')), ['250', '250']);
});

test('equals twice adds one total', () => {
  assert.deepEqual(texts(page('1+2==')), ['1', '2', '3']);
});

test('equals after a dangling operator drops it', () => {
  const p = page('1+2+=');
  assert.deepEqual(texts(p), ['1', '2', '3']);
  assert.equal(p.draft, null);
});

test('typed trailing zeros are kept and totals match', () => {
  assert.deepEqual(texts(page('12.40+8.5=')), ['12.40', '8.5', '20.90']);
});

test('totals are rounded to the setting', () => {
  assert.deepEqual(texts(page('10/3=')), ['10', '3', '3.33']);
  const precise = { ...options, maxFractionDigits: 4 };
  assert.equal(evaluate(page('10/3='), precise).calculations[0].rows.at(-1).text, '3.3333');
});

test('continuing after a total uses the rounded total', () => {
  // 3.33 is what's written on the page, so × 3 gives 9.99.
  assert.equal(result(page('10/3=*3=')), '9.99');
});

// MARK: - Percent

test('percent of the running total', () => {
  const e = evaluate(page('100+15%=')).calculations[0];
  assert.deepEqual(e.rows.map((row) => row.text), ['100', '15', '115']);
  assert.equal(e.rows[1].label, '+15%');
  assert.equal(e.rows[1].value.toString(), '15');

  const discount = evaluate(page('250-25%=')).calculations[0];
  assert.deepEqual(discount.rows.map((row) => row.text), ['250', '62.5', '187.5']);
  assert.equal(discount.rows[1].label, '−25%');
});

test('percent with multiply and divide', () => {
  const e = evaluate(page('80*50%=')).calculations[0];
  assert.deepEqual(e.rows.map((row) => row.text), ['80', '50%', '40']);
  assert.equal(e.rows[1].label, null);
  assert.equal(result(page('80/50%=')), '160');
});

test('the percent key toggles', () => {
  assert.equal(page('15%%').draft.mode, 'number');
  assert.equal(page('15%<').draft.digits, '15');
});

// MARK: - Errors

test('division by zero is an error', () => {
  const e = evaluate(page('5/0=+1=')).calculations[0];
  assert.equal(e.rows[2].isError, true);
  assert.equal(e.rows[2].text, 'Error');
  assert.equal(e.rows.at(-1).isError, true);
  assert.equal(e.result, null);
  // A new calculation starts clean.
  assert.equal(result(page('5/0= 2+2='), 1), '4');
});

// MARK: - Backspace

test('backspace deletes typed digits', () => {
  assert.equal(page('12<').draft.digits, '1');
  assert.equal(page('12<<').draft, null);
  assert.equal(page('1.<').draft.digits, '1');
});

test('backspace removes a pending operator', () => {
  const p = page('12+<');
  assert.equal(p.draft, null);
  assert.equal(p.calculations.length, 1);
});

test('backspace walks back up the tape', () => {
  const p = page('1+2=');
  type('<', p);
  assert.deepEqual(texts(p), ['1', '2']);
  assert.equal(p.draft, null);

  const poppedID = p.calculations[0].entries[1].id;
  type('<', p);
  assert.equal(p.draft.op, '+');
  assert.equal(p.draft.digits, '2');
  assert.equal(p.draft.id, poppedID);
  assert.deepEqual(texts(p), ['1']);

  type('<<<', p); // "2", then "+", then pops "1"
  assert.equal(p.draft.op, null);
  assert.equal(p.draft.digits, '1');
  assert.equal(p.calculations.length, 0);
});

test('clear entry drops the draft only', () => {
  const p = page('1+2=5');
  tape.apply(p, tape.Key.clear);
  assert.equal(p.draft, null);
  assert.equal(p.calculations.length, 1);
});

// MARK: - Notes and editing

test('notes travel with the line', () => {
  const p = page('12.40');
  p.draft.note = 'milk & eggs';
  type('+8.99=', p);
  const rows = evaluate(p).calculations[0].rows;
  assert.equal(rows[0].note, 'milk & eggs');

  tape.setNote(p, rows[2].id, 'groceries');
  assert.equal(evaluate(p).calculations[0].rows[2].note, 'groceries');
});

test('editing a line recalculates everything below', () => {
  const p = page('100+50=*2=');
  tape.updateLine(p, p.calculations[0].entries[0].id, (line) => { line.text = '200'; });
  assert.deepEqual(texts(p), ['200', '50', '250', '2', '500']);
});

test('deleting and inserting lines', () => {
  const p = page('1+2+3=');
  tape.deleteEntry(p, p.calculations[0].entries[1].id);
  assert.deepEqual(texts(p), ['1', '3', '4']);

  const newID = tape.insertLineAfter(p, p.calculations[0].entries[0].id);
  assert.ok(newID);
  tape.updateLine(p, newID, (line) => { line.text = '10'; });
  assert.deepEqual(texts(p), ['1', '10', '3', '14']);

  tape.deleteEntry(p, p.calculations[0].entries[0].id);
  tape.deleteEntry(p, p.calculations[0].entries[0].id);
  // Deleting the last line also drops the total left on its own.
  tape.deleteEntry(p, p.calculations[0].entries[0].id);
  assert.equal(p.calculations.length, 0);
});

test('deleting between two totals leaves one', () => {
  const p = page('100+50=*2=');
  tape.setNote(p, p.calculations[0].entries[4].id, 'each');
  tape.deleteEntry(p, p.calculations[0].entries[3].id); // the × 2 line
  assert.deepEqual(texts(p), ['100', '50', '150']);
  assert.equal(p.calculations[0].entries.at(-1).note, 'each');
});

test('deleting the first line drops a leading total', () => {
  const p = page('5=+3=');
  tape.deleteEntry(p, p.calculations[0].entries[0].id);
  assert.deepEqual(texts(p), ['3', '3']);
  const q = page('5=');
  tape.deleteEntry(q, q.calculations[0].entries[0].id);
  assert.equal(q.calculations.length, 0);
});

test('a committed line keeps the draft id', () => {
  const p = page('42');
  const draftID = p.draft.id;
  type('=', p);
  assert.equal(p.calculations[0].entries[0].id, draftID);
});

test('draft placement', () => {
  assert.equal(evaluate(page('1+2=+')).draft.continuesLastCalculation, true);
  assert.equal(evaluate(page('1+2=5')).draft.continuesLastCalculation, false);
  assert.equal(evaluate(page('5%')).draft.text, '5%');
});

// MARK: - Formatting

test('formats with locale separators', () => {
  const german = new NumberFormat({ groupingSeparator: '.', decimalSeparator: ',' });
  assert.equal(german.format(dec('1234567.891'), 0, 2), '1.234.567,89');
  assert.equal(german.formatTyped('0.'), '0,');
  assert.equal(german.canonicalize('1.234,5'), '1234.5');

  const indian = new NumberFormat({ primaryGroupSize: 3, secondaryGroupSize: 2 });
  assert.equal(indian.format(dec('1234567'), 0, 2), '12,34,567');
});

test('formats from system locales', () => {
  const de = NumberFormat.fromLocale('de-DE');
  assert.equal(de.decimalSeparator, ',');
  assert.equal(de.groupingSeparator, '.');
  assert.equal(NumberFormat.fromLocale('en-IN').format(dec('10000000'), 0, 0), '1,00,00,000');
});

test('formatting edge cases', () => {
  const f = NumberFormat.posix;
  assert.equal(f.format(dec('-5'), 0, 2), '-5');
  assert.equal(f.format(dec('-0.001'), 0, 2), '0');
  assert.equal(f.format(dec('2.5'), 2, 2), '2.50');
  assert.equal(f.format(dec('0.125'), 0, 2), '0.13');
  assert.equal(f.formatTyped('1234.50'), '1,234.50');
  assert.equal(f.formatTyped(''), '');
});

test('canonicalizes typed text', () => {
  const f = NumberFormat.posix;
  assert.equal(f.canonicalize(' 1,234.50 '), '1234.50');
  assert.equal(f.canonicalize('−12'), '-12');
  assert.equal(f.canonicalize('.5'), '0.5');
  assert.equal(f.canonicalize('007'), '7');
  assert.equal(f.canonicalize('12.'), '12');
  assert.equal(f.canonicalize('-0'), '0');
  assert.equal(f.canonicalize('abc'), null);
  assert.equal(f.canonicalize('1.2.3'), null);
  assert.equal(f.canonicalize(''), null);
});

test('parses canonical decimals', () => {
  assert.ok(dec('12.50').equals(dec('12.5')));
  assert.equal(dec('-3').toString(), '-3');
  assert.equal(dec('7.').toString(), '7');
  assert.equal(dec(''), null);
  assert.equal(dec('1e5'), null);
});

// MARK: - Saving and sharing

test('pages survive a JSON round trip', () => {
  const p = page('12.40+8.5=5*2');
  p.title = 'Groceries';
  p.calculations[0].title = 'Monday';
  p.draft.note = 'typing';
  const notebook = { version: 1, pages: [p], selectedPageID: p.id };
  assert.deepEqual(JSON.parse(JSON.stringify(notebook)), notebook);
});

test('exports plain text', () => {
  const p = page('12.40+8.99=');
  p.title = 'Groceries';
  p.calculations[0].entries[0].note = 'milk & eggs';
  type('+10%=', p);
  const expected = [
    'Groceries',
    '',
    '  12.40   milk & eggs',
    '+  8.99',
    '───────',
    '= 21.39',
    '+  2.14   +10%',
    '───────',
    '= 23.53',
  ].join('\n');
  assert.equal(tape.plainText(p, options), expected);
});
