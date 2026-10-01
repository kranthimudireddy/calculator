// The paper tape: what's on a page, how keypad presses change it, and how it's worked out.
// A port of the iOS app's TapeKit, kept to the same rules and the same tests.

import { Decimal } from './decimal.js';

/** Longest number the keypad accepts, in digits. */
export const MAX_DIGITS = 15;

const HUNDRED = Decimal.parse('100');

/** Operators are stored as "+", "-", "*", "/" and drawn as these marks. */
const SYMBOL_OF = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divide' };
export const SYMBOL_TEXT = { plus: '+', minus: '−', times: '×', divide: '÷', equals: '=' };

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // randomUUID needs a secure context; plain http on the local network still has getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// MARK: - Model

export function newPage(title = '') {
  const now = Date.now();
  return { id: uuid(), title, createdAt: now, modifiedAt: now, calculations: [], draft: null };
}

export function newLine(op, text, { mode = 'number', note = '', id = uuid() } = {}) {
  return { kind: 'line', id, op, text, mode, note };
}

export function newTotal(note = '') {
  return { kind: 'total', id: uuid(), note };
}

export function newCalculation(entries, title = '') {
  return { id: uuid(), title, entries };
}

function newDraft(op = null) {
  return { id: uuid(), op, digits: '', mode: 'number', note: '' };
}

export const hasDigits = (draft) => /\d/.test(draft.digits);
const digitCount = (draft) => draft.digits.replace(/\D/g, '').length;
const endsWithTotal = (calculation) => calculation.entries.at(-1)?.kind === 'total';

export function lineValue(line) {
  return Decimal.parse(line.text) ?? new Decimal(0n);
}

// MARK: - Keypad

export const Key = {
  digit: (digit) => ({ type: 'digit', digit }),
  point: { type: 'point' },
  op: (op) => ({ type: 'op', op }),
  percent: { type: 'percent' },
  equals: { type: 'equals' },
  backspace: { type: 'backspace' },
  clear: { type: 'clear' },
};

/**
 * Applies one keypad press, like a paper-tape calculator:
 * digits build the current line; an operator commits it and starts the next line;
 * `=` writes a subtotal (an operator after it continues from the subtotal, a digit starts
 * a new calculation); backspace deletes typed digits, then walks back up the tape.
 */
export function apply(page, key) {
  switch (key.type) {
    case 'digit': {
      if (!(key.digit >= 0 && key.digit <= 9)) return;
      const line = page.draft ?? newDraft();
      if (digitCount(line) >= MAX_DIGITS) return;
      if (line.digits === '0' || line.digits === '-0') line.digits = line.digits.slice(0, -1);
      line.digits += String(key.digit);
      page.draft = line;
      break;
    }
    case 'point': {
      const line = page.draft ?? newDraft();
      if (line.digits.includes('.')) return;
      line.digits += hasDigits(line) ? '.' : '0.';
      page.draft = line;
      break;
    }
    case 'op':
      if (page.draft && !hasDigits(page.draft)) {
        page.draft.op = key.op;
      } else {
        commitDraft(page);
        page.draft = newDraft(key.op);
      }
      break;
    case 'percent':
      if (!page.draft || !hasDigits(page.draft)) return;
      page.draft.mode = page.draft.mode === 'number' ? 'percent' : 'number';
      break;
    case 'equals': {
      if (page.draft) {
        if (hasDigits(page.draft)) commitDraft(page);
        else page.draft = null;
      }
      const last = page.calculations.at(-1);
      if (last && last.entries.length > 0 && !endsWithTotal(last)) last.entries.push(newTotal());
      break;
    }
    case 'backspace':
      backspace(page);
      break;
    case 'clear':
      clearLastLine(page);
      break;
  }
  page.modifiedAt = Date.now();
}

/** Moves the typed line onto the tape. A line with no operator starts a new calculation. */
export function commitDraft(page) {
  const draft = page.draft;
  if (!draft || !hasDigits(draft)) return false;
  const text = draft.digits.endsWith('.') ? draft.digits.slice(0, -1) : draft.digits;
  const line = newLine(draft.op, text, { mode: draft.mode, note: draft.note, id: draft.id });
  if (draft.op === null || page.calculations.length === 0) {
    page.calculations.push(newCalculation([line]));
  } else {
    page.calculations.at(-1).entries.push(line);
  }
  page.draft = null;
  page.modifiedAt = Date.now();
  return true;
}

/** Remove a whole number line, skipping its trailing subtotal marks. */
function clearLastLine(page) {
  if (page.draft && (hasDigits(page.draft) || page.draft.note)) {
    page.draft = null;
    return;
  }
  page.draft = null;
  while (page.calculations.length) {
    const last = page.calculations.at(-1);
    const removed = last.entries.pop();
    if (!last.entries.length) page.calculations.pop();
    if (removed?.kind === 'line') return;
  }
}

function backspace(page) {
  const draft = page.draft;
  if (draft) {
    if (hasDigits(draft) && draft.mode !== 'number') {
      draft.mode = 'number';
    } else if (hasDigits(draft)) {
      draft.digits = draft.digits.slice(0, -1);
      if (draft.digits === '-') draft.digits = '';
      if (!hasDigits(draft) && draft.op === null && draft.note === '') page.draft = null;
    } else {
      page.draft = null;
    }
    return;
  }
  // Nothing typed: step back up the tape. A subtotal is removed; a line comes back for editing.
  const last = page.calculations.at(-1);
  if (!last) return;
  const removed = last.entries.pop();
  if (last.entries.length === 0) page.calculations.pop();
  if (removed?.kind === 'line') {
    page.draft = { id: removed.id, op: removed.op, digits: removed.text, mode: removed.mode, note: removed.note };
  }
}

// MARK: - Editing lines already on the tape

export function locationOf(page, entryID) {
  for (let c = 0; c < page.calculations.length; c++) {
    const e = page.calculations[c].entries.findIndex((entry) => entry.id === entryID);
    if (e >= 0) return { c, e };
  }
  return null;
}

export function entryOf(page, entryID) {
  const at = locationOf(page, entryID);
  return at ? page.calculations[at.c].entries[at.e] : null;
}

export function calculationContaining(page, entryID) {
  const at = locationOf(page, entryID);
  return at ? page.calculations[at.c] : null;
}

/** True for the first entry of a calculation, whose operator is optional. */
export function isFirstEntry(page, entryID) {
  return locationOf(page, entryID)?.e === 0;
}

export function updateLine(page, entryID, change) {
  const entry = entryOf(page, entryID);
  if (entry?.kind !== 'line') return;
  change(entry);
  page.modifiedAt = Date.now();
}

export function setNote(page, entryID, note) {
  const entry = entryOf(page, entryID);
  if (!entry) return;
  entry.note = note;
  page.modifiedAt = Date.now();
}

export function deleteEntry(page, entryID) {
  const at = locationOf(page, entryID);
  if (!at) return;
  const calculation = page.calculations[at.c];
  calculation.entries.splice(at.e, 1);
  removeRedundantTotals(calculation);
  if (calculation.entries.length === 0) page.calculations.splice(at.c, 1);
  page.modifiedAt = Date.now();
}

/** Inserts `+ 0` below an entry and returns the new line's id. */
export function insertLineAfter(page, entryID) {
  const at = locationOf(page, entryID);
  if (!at) return null;
  const line = newLine('+', '0');
  page.calculations[at.c].entries.splice(at.e + 1, 0, line);
  page.modifiedAt = Date.now();
  return line.id;
}

export function setCalculationTitle(page, calculationID, title) {
  const calculation = page.calculations.find((candidate) => candidate.id === calculationID);
  if (!calculation) return;
  calculation.title = title;
  page.modifiedAt = Date.now();
}

export function deleteCalculation(page, calculationID) {
  page.calculations = page.calculations.filter((calculation) => calculation.id !== calculationID);
  page.modifiedAt = Date.now();
}

/** A total straight after another total, or at the very top, adds nothing: drop it, keeping its note. */
export function removeRedundantTotals(calculation) {
  const entries = calculation.entries;
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (entry.kind !== 'total') {
      index += 1;
    } else if (index === 0) {
      entries.splice(0, 1);
    } else if (entries[index - 1].kind === 'total') {
      if (entries[index - 1].note === '') entries[index - 1].note = entry.note;
      entries.splice(index, 1);
    } else {
      index += 1;
    }
  }
}

// MARK: - Working it out

/**
 * Works the tape out top to bottom. Each line applies to the running total,
 * the way an adding machine does: `2 + 3 × 4 = 20`.
 * `options` is { maxFractionDigits, format }.
 */
export function evaluatePage(page, options) {
  const calculations = page.calculations.map((calculation) => evaluateCalculation(calculation, options));
  const draft = page.draft ? evaluateDraft(page, page.draft, options) : null;
  return { calculations, draft, lastResultText: calculations.at(-1)?.resultText ?? null };
}

function evaluateDraft(page, draft, options) {
  const typed = options.format.formatTyped(draft.digits);
  return {
    id: draft.id,
    symbol: draft.op ? SYMBOL_OF[draft.op] : null,
    text: draft.mode === 'percent' && hasDigits(draft) ? `${typed}%` : typed,
    note: draft.note,
    // true when the draft will be added to the last calculation; false when it starts a new one.
    continuesLastCalculation: draft.op !== null && page.calculations.length > 0,
  };
}

export function evaluateCalculation(calculation, options) {
  const format = options.format;
  const maxDigits = Math.max(0, options.maxFractionDigits);
  // Totals show at least as many decimals as the numbers typed above them (12.40 + 8.5 = 20.90).
  const typedDigits = Math.max(
    0,
    ...calculation.entries
      .filter((entry) => entry.kind === 'line' && entry.mode === 'number')
      .map((line) => fractionDigitCount(line.text)),
  );
  const minDigits = Math.min(typedDigits, maxDigits);
  const formatResult = (value) => format.format(value, minDigits, maxDigits);

  let running = new Decimal(0n);
  const rows = [];

  for (const entry of calculation.entries) {
    if (entry.kind === 'total') {
      const total = running?.rounded(maxDigits) ?? null;
      running = total;
      rows.push({
        id: entry.id,
        kind: 'total',
        symbol: 'equals',
        text: total ? formatResult(total) : 'Error',
        label: null,
        note: entry.note,
        value: total,
        isError: total === null,
      });
      continue;
    }

    const value = lineValue(entry);
    const percentText = `${format.formatTyped(entry.text)}%`;
    let text = format.formatTyped(entry.text);
    let label = null;
    let amount = value;

    if (entry.op === null && entry.mode === 'number') {
      running = value;
    } else if (entry.op === null) {
      running = value.dividedBy(HUNDRED);
      text = percentText;
      amount = running;
    } else if (entry.mode === 'number') {
      running = running ? applyOperator(entry.op, value, running) : null;
    } else if (entry.op === '+' || entry.op === '-') {
      // + 15% adds 15% of the running total; − 25% takes a quarter off.
      const isAdd = entry.op === '+';
      label = (isAdd ? '+' : '−') + percentText;
      if (running) {
        const part = running.times(value).dividedBy(HUNDRED).rounded(maxDigits);
        running = isAdd ? running.plus(part) : running.minus(part);
        amount = part;
        text = formatResult(part);
      } else {
        amount = null;
        text = percentText;
        label = null;
      }
    } else {
      // × 50% multiplies by 0.5; ÷ 50% divides by 0.5.
      running = running ? applyOperator(entry.op, value.dividedBy(HUNDRED), running) : null;
      text = percentText;
      amount = value.dividedBy(HUNDRED);
    }

    rows.push({
      id: entry.id,
      kind: 'line',
      symbol: entry.op ? SYMBOL_OF[entry.op] : null,
      text,
      label,
      note: entry.note,
      value: amount,
      isError: false,
    });
  }

  const result = running?.rounded(maxDigits) ?? null;
  return {
    id: calculation.id,
    title: calculation.title,
    rows,
    // Running value after the last row; null after an error such as ÷ 0.
    result: rows.length ? result : null,
    resultText: rows.length && result ? formatResult(result) : null,
  };
}

function applyOperator(op, value, current) {
  switch (op) {
    case '+': return current.plus(value);
    case '-': return current.minus(value);
    case '*': return current.times(value);
    case '/': return value.isZero ? null : current.dividedBy(value);
  }
  return null;
}

function fractionDigitCount(text) {
  const point = text.indexOf('.');
  return point < 0 ? 0 : text.length - point - 1;
}

// MARK: - Sharing

/**
 * The page as plain text, one calculation per paragraph:
 *
 *     Groceries
 *        12.40   milk & eggs
 *     +   8.99   bread
 *     ────────
 *     =  21.39
 */
export function plainText(page, options) {
  const paragraphs = [];
  if (page.title) paragraphs.push(page.title);
  for (const calculation of evaluatePage(page, options).calculations) {
    const lines = [];
    if (calculation.title) lines.push(calculation.title);
    const width = Math.max(0, ...calculation.rows.map((row) => [...row.text].length));
    for (const row of calculation.rows) {
      if (row.kind === 'total') lines.push('─'.repeat(width + 2));
      const symbol = row.symbol ? SYMBOL_TEXT[row.symbol] : ' ';
      const number = ' '.repeat(Math.max(0, width - [...row.text].length)) + row.text;
      const comment = [row.label, row.note || null].filter(Boolean).join(' ');
      lines.push(comment ? `${symbol} ${number}   ${comment}` : `${symbol} ${number}`);
    }
    paragraphs.push(lines.join('\n'));
  }
  return paragraphs.join('\n\n');
}
