// Turns a worked-out page into rows of paper: blank lines, titles, and the lines of each sum.

import { FONTS, metrics } from './prefs.js';
import { glyphRun } from './handwriting.js';

export const HINTS = [
  'Type a sum on the keypad.',
  'Tap beside a line to write a note.',
  'Tap a number to change it.',
];

/**
 * Every row on the page is one line of paper tall. Returns items of type
 * "blank", "hint", "heading" or "row" (a line of a sum, with its calculation's column layout).
 */
export function pageItems(evaluation, prefs, format, { width, minimumRows, tailRows = 3 }) {
  const blocks = evaluation.calculations.map((calculation) => ({
    id: calculation.id,
    calculationID: calculation.id,
    title: calculation.title,
    rows: calculation.rows,
  }));

  const draft = evaluation.draft;
  if (draft) {
    const row = { id: draft.id, kind: 'draft', symbol: draft.symbol, text: draft.text, label: null, note: draft.note, isError: false };
    if (draft.continuesLastCalculation && blocks.length > 0) {
      blocks.at(-1).rows = [...blocks.at(-1).rows, row];
    } else {
      blocks.push({ id: draft.id, calculationID: null, title: '', rows: [row] });
    }
  }

  const items = [{ type: 'blank', id: 'blank-top' }];
  if (blocks.length === 0) {
    for (const hint of HINTS) items.push({ type: 'hint', id: `hint-${hint}`, text: hint });
  }
  blocks.forEach((block, index) => {
    if (index > 0) items.push({ type: 'blank', id: `blank-gap-${block.id}` });
    if (block.calculationID && block.title) {
      items.push({ type: 'heading', id: `heading-${block.calculationID}`, calculationID: block.calculationID, title: block.title });
    }
    const layout = blockLayout(block.rows, prefs, format, width);
    for (const row of block.rows) {
      items.push({ type: 'row', id: row.id, row, layout, calculationID: block.calculationID });
    }
  });

  const tail = Math.max(tailRows, minimumRows - items.length);
  for (let i = 0; i < tail; i++) items.push({ type: 'blank', id: `blank-tail-${i}` });
  return items;
}

/** Column measurements shared by every row of one calculation, so operators and decimal points line up. */
export function blockLayout(rows, prefs, format, width) {
  const m = metrics(prefs.size);
  const font = FONTS[prefs.font] ?? FONTS.noteworthy;

  const measure = (fontSize) => {
    let integer = fontSize * font.digitWidth;
    let fraction = 0;
    for (const row of rows) {
      if (row.isError) {
        integer = Math.max(integer, fontSize * 2.4);
        continue;
      }
      const run = glyphRun(row.text, format.decimalSeparator, fontSize, font);
      integer = Math.max(integer, run.integerWidth);
      fraction = Math.max(fraction, run.fractionWidth);
    }
    return { integer, fraction };
  };

  let fontSize = m.fontSize;
  let measured = measure(fontSize);
  // Leave room after the numbers for notes; long numbers shrink to fit rather than run off the page.
  const roomForNotes = 64;
  const available = width - m.sidePadding * 2 - fontSize * 0.95 - roomForNotes;
  const needed = measured.integer + measured.fraction;
  if (needed > available && available > 0) {
    fontSize = Math.max(m.fontSize * 0.45, (fontSize * available) / needed);
    measured = measure(fontSize);
  }
  // Centre the sum on the page, moving it left only as far as it takes to keep that room for notes.
  const operatorWidth = fontSize * 0.95;
  const sumWidth = operatorWidth + measured.integer + measured.fraction;
  const centred = (width - sumWidth) / 2 - m.sidePadding;
  const leavingRoom = width - m.sidePadding * 2 - sumWidth - roomForNotes;
  return {
    fontSize,
    integerWidth: measured.integer,
    fractionWidth: measured.fraction,
    columnWidth: measured.integer + measured.fraction,
    operatorWidth,
    markSize: fontSize * 0.4,
    leadingInset: Math.max(0, Math.min(centred, leavingRoom)),
  };
}
