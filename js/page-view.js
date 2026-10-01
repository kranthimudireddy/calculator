// Draws page items as HTML: blank lines of paper, hints, calculation titles, and the lines of each sum.

import { FONTS, metrics } from './prefs.js';
import { glyphRun, markPath, rulePath, seedOf, wobble } from './handwriting.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (character) => ESCAPES[character]);

const SPOKEN = { plus: 'plus', minus: 'minus', times: 'times', divide: 'divided by', equals: 'equals' };

/**
 * `context` is { prefs, format, width, noteEditingID, highlightedID, noteValue, titleEditingID, titleValue }:
 * the row whose note or title is being written gets a borderless text field in its place.
 */
export function rowsHTML(items, context) {
  const m = metrics(context.prefs.size);
  const font = FONTS[context.prefs.font] ?? FONTS.noteworthy;
  return items.map((item) => itemHTML(item, context, m, font)).join('');
}

function itemHTML(item, context, m, font) {
  switch (item.type) {
    case 'blank':
      return `<div class="row blank" data-type="blank"${item.id === 'blank-tail-0' ? ' data-tail' : ''}></div>`;
    case 'hint':
      return `<div class="row hint" data-type="hint" style="font-size:${m.noteFontSize * 1.25 * font.sizeAdjustment}px">${escapeHTML(item.text)}</div>`;
    case 'heading': {
      const title = item.calculationID === context.titleEditingID
        ? `<input class="title-input" type="text" enterkeyhint="done" autocomplete="off" spellcheck="false" aria-label="Calculation title" value="${escapeHTML(context.titleValue)}">`
        : escapeHTML(item.title);
      return `<div class="row heading" data-type="heading" data-calculation="${item.calculationID}" style="font-size:${m.headingFontSize * font.sizeAdjustment}px">${title}</div>`;
    }
    default:
      return lineHTML(item, context, m, font);
  }
}

function lineHTML({ row, layout }, context, m, font) {
  const seed = seedOf(row.id);
  const strokeWidth = Math.max(1.5, layout.fontSize * 0.055);
  const numberStart = m.sidePadding + layout.leadingInset;
  const numberEnd = numberStart + layout.operatorWidth + layout.columnWidth;
  const highlighted = row.id === context.highlightedID ? ' highlighted' : '';

  const mark = row.symbol
    ? `<svg class="mark" width="${layout.markSize}" height="${layout.markSize}" viewBox="0 0 ${layout.markSize} ${layout.markSize}">`
      + `<path d="${markPath(row.symbol, seed, layout.markSize)}" stroke-width="${strokeWidth}"/></svg>`
    : '';

  let rule = '';
  if (row.kind === 'total') {
    const width = layout.operatorWidth + layout.columnWidth + 8;
    rule = `<svg class="rule" style="left:${numberStart - 4}px" width="${width}" height="6" viewBox="0 0 ${width} 6" aria-hidden="true">`
      + `<path d="${rulePath(seed, width)}" stroke-width="${strokeWidth * 0.8}"/></svg>`;
  }

  return `<div class="row line${highlighted}" data-type="row" data-id="${row.id}" data-kind="${row.kind}" data-start="${numberStart}" data-end="${numberEnd}">`
    + `<div class="op" style="margin-left:${numberStart}px;width:${layout.operatorWidth}px" aria-hidden="true">${mark}</div>`
    + `<div class="num" style="width:${layout.columnWidth}px">${numberHTML(row, layout, seed, context, font)}</div>`
    + `<div class="note" style="font-size:${m.noteFontSize * font.sizeAdjustment}px">${noteHTML(row, context, m, font, numberEnd)}</div>`
    + rule
    + '</div>';
}

function numberHTML(row, layout, seed, context, font) {
  const spoken = `<span class="visually-hidden">${escapeHTML([row.symbol && SPOKEN[row.symbol], row.isError ? 'error' : row.text].filter(Boolean).join(' '))}</span>`;
  if (row.isError) {
    return `<span class="error" style="font-size:${layout.fontSize * 0.8 * font.sizeAdjustment}px" aria-hidden="true">Error</span>${spoken}`;
  }
  const run = glyphRun(row.text, context.format.decimalSeparator, layout.fontSize, font);
  const glyphs = run.glyphs.map((glyph, index) => {
    const rotate = wobble(seed, index, 1) * 3;
    const scale = 1 + wobble(seed, index, 2) * 0.035;
    const x = wobble(seed, index, 3) * layout.fontSize * 0.02;
    const y = wobble(seed, index, 4) * layout.fontSize * 0.035;
    return `<span class="glyph${glyph.isFaded ? ' faded' : ''}" style="width:${glyph.width}px;`
      + `transform:translate(${x.toFixed(2)}px,${y.toFixed(2)}px) rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(3)})">`
      + `${escapeHTML(glyph.character)}</span>`;
  }).join('');
  const caret = row.kind === 'draft' ? `<span class="caret" style="height:${layout.fontSize * 0.85}px"></span>` : '';
  // Pad so decimal points line up with the other numbers in this calculation.
  const pad = Math.max(0, layout.fractionWidth - run.fractionWidth);
  return `<span class="glyphs" style="font-size:${layout.fontSize * font.sizeAdjustment}px" aria-hidden="true">${glyphs}${caret}</span>`
    + `<span class="pad" style="width:${pad}px"></span>${spoken}`;
}

function noteHTML(row, context, m, font, numberEnd) {
  const label = row.label ? `<span class="label">${escapeHTML(row.label)}</span>` : '';
  if (row.id === context.noteEditingID) {
    return `${label}<input class="note-input" type="text" enterkeyhint="done" autocapitalize="none" autocomplete="off" `
      + `spellcheck="false" aria-label="Note" value="${escapeHTML(context.noteValue)}">`;
  }
  if (!row.note && !label) return '';
  // Long notes wrap onto a second line, and shrink a little if two lines still aren't enough.
  const available = context.width - numberEnd - 14 - m.sidePadding;
  const size = m.noteFontSize * font.sizeAdjustment;
  const width = textWidth([row.label, row.note].filter(Boolean).join('  '), `${font.weight} ${size}px ${font.family}`);
  const scale = available > 0 && width > available * 2 ? Math.max(0.7, (available * 2 * 0.92) / width) : 1;
  const note = row.note ? `<span class="text">${escapeHTML(row.note)}</span>` : '';
  return `<span class="note-text" style="font-size:${scale.toFixed(3)}em">${label}${note}</span>`;
}

let measuring = null;

function textWidth(text, font) {
  measuring ??= document.createElement('canvas').getContext('2d');
  measuring.font = font;
  return measuring.measureText(text).width;
}
