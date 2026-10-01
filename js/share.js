import { evaluatePage } from './tape.js';
import { pageItems } from './layout.js';
import { FONTS, metrics } from './prefs.js';
import { glyphRun, markPath, rulePath, seedOf, wobble } from './handwriting.js';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Finished page, at the native app's 430-point export width. */
export async function pageImage(page, title, prefs, options) {
  await document.fonts.ready;
  const width = 430;
  const m = metrics(prefs.size);
  const font = FONTS[prefs.font];
  const finished = { ...page, draft: null };
  const items = pageItems(evaluatePage(finished, options), prefs, options.format, { width, minimumRows: 0, tailRows: 1 }).slice(1);
  const height = m.rowHeight * (items.length + 1.5) + 30;
  const canvas = document.createElement('canvas');
  canvas.width = width * 3; canvas.height = Math.ceil(height * 3);
  const ctx = canvas.getContext('2d'); ctx.scale(3, 3);
  const styles = getComputedStyle(document.documentElement);
  const color = name => styles.getPropertyValue(name).trim();
  ctx.fillStyle = color('--paper'); ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';
  ctx.font = `${font.weight} ${m.headingFontSize * 1.2 * font.sizeAdjustment}px ${font.family}`;
  ctx.fillStyle = color('--ink'); ctx.fillText(title, 18, m.rowHeight * 0.75, width - 36);
  items.forEach((item, index) => {
    const top = m.rowHeight * (1.5 + index);
    const step = prefs.paper === 'grid' ? m.rowHeight / 2 : m.rowHeight;
    if (prefs.paper !== 'plain') {
      ctx.strokeStyle = color(prefs.paper === 'grid' ? '--grid' : '--line'); ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let y = step; y <= m.rowHeight; y += step) { ctx.moveTo(0, top + y); ctx.lineTo(width, top + y); }
      if (prefs.paper === 'grid') for (let x = step / 2; x < width; x += step) { ctx.moveTo(x, top); ctx.lineTo(x, top + m.rowHeight); }
      ctx.stroke();
    }
    ctx.fillStyle = color('--note-ink');
    ctx.font = `${font.weight} ${m.headingFontSize * font.sizeAdjustment}px ${font.family}`;
    if (item.type === 'heading' || item.type === 'hint') { ctx.fillText(item.title ?? item.text, 18, top + m.rowHeight / 2, width - 36); return; }
    if (item.type !== 'row') return;
    const { row, layout: l } = item;
    const seed = seedOf(row.id);
    const start = 18 + l.leadingInset;
    const end = start + l.operatorWidth + l.columnWidth;
    ctx.strokeStyle = color('--ink'); ctx.lineWidth = Math.max(1.5, l.fontSize * 0.055); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (row.symbol) { ctx.save(); ctx.translate(start, top + (m.rowHeight - l.markSize) / 2); ctx.stroke(new Path2D(markPath(row.symbol, seed, l.markSize))); ctx.restore(); }
    if (row.kind === 'total') { ctx.save(); ctx.translate(start - 4, top + 2); ctx.stroke(new Path2D(rulePath(seed, l.operatorWidth + l.columnWidth + 8))); ctx.restore(); }
    ctx.font = `${font.weight} ${l.fontSize * font.sizeAdjustment}px ${font.family}`;
    if (row.isError) { ctx.fillStyle = color('--error'); ctx.fillText('Error', start + l.operatorWidth, top + m.rowHeight / 2); }
    else {
      const run = glyphRun(row.text, options.format.decimalSeparator, l.fontSize, font);
      let x = end - l.fractionWidth - run.integerWidth;
      run.glyphs.forEach((glyph, i) => {
        ctx.save(); ctx.translate(x + glyph.width / 2 + wobble(seed, i, 3) * l.fontSize * 0.02, top + m.rowHeight / 2 + wobble(seed, i, 4) * l.fontSize * 0.035);
        ctx.rotate(wobble(seed, i, 1) * 3 * Math.PI / 180); ctx.textAlign = 'center'; ctx.fillStyle = color(glyph.isFaded ? '--faded' : '--ink'); ctx.fillText(glyph.character, 0, 0); ctx.restore(); x += glyph.width;
      });
    }
    ctx.font = `${font.weight} ${m.noteFontSize * font.sizeAdjustment}px ${font.family}`;
    ctx.fillStyle = color('--note-ink');
    const words = [row.label, row.note].filter(Boolean).join(' ').split(/\s+/);
    const room = width - end - 32;
    let line = '', lines = [];
    for (const word of words) { if (line && ctx.measureText(`${line} ${word}`).width > room) { lines.push(line); line = word; } else line = [line, word].filter(Boolean).join(' '); }
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((text, i) => ctx.fillText(text, end + 14, top + m.rowHeight / 2 + (lines.length > 1 ? (i - 0.5) * m.noteFontSize : 0), room));
  });
  ctx.font = '500 11px sans-serif'; ctx.fillStyle = color('--faded'); ctx.textAlign = 'right'; ctx.fillText('DoodleTape', width - 18, height - 15);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to create image')), 'image/png'));
}
