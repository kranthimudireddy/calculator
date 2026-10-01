// The handwritten look: repeatable wobble, fixed-width digit cells, and pen-stroke marks.

// MARK: - Deterministic wobble

/**
 * Small, repeatable irregularities so digits look written rather than typeset.
 * The same line always wobbles the same way, so nothing shimmers while you type.
 */
export function seedOf(id) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix(value) {
  let z = value >>> 0;
  z ^= z >>> 16;
  z = Math.imul(z, 0x85ebca6b);
  z ^= z >>> 13;
  z = Math.imul(z, 0xc2b2ae35);
  z ^= z >>> 16;
  return z >>> 0;
}

/** A value in -1...1 for (seed, index, salt). */
export function wobble(seed, index, salt = 0) {
  return (mix(seed ^ mix(Math.imul(index + 1, 0x9e3779b1) ^ salt)) / 0xffffffff) * 2 - 1;
}

// MARK: - Glyph layout

/**
 * A number broken into fixed-width cells so columns line up like hand-done column arithmetic.
 * The integer part and the fraction part (from the decimal separator on) are measured separately,
 * which lets a calculation align every number on its decimal point.
 */
export function glyphRun(text, decimalSeparator, fontSize, font) {
  const glyphs = [];
  let integerWidth = 0;
  let fractionWidth = 0;
  let inFraction = false;
  for (const character of text) {
    if (character === decimalSeparator[0] || character === '%') inFraction = true;
    const width = cellWidth(character, fontSize, font);
    // Decimals are written in lighter ink.
    glyphs.push({ character, width, isFaded: inFraction && character !== '%' });
    if (inFraction) fractionWidth += width;
    else integerWidth += width;
  }
  return { glyphs, integerWidth, fractionWidth };
}

function cellWidth(character, fontSize, font) {
  if (character >= '0' && character <= '9') return fontSize * font.digitWidth;
  if (',.\'’   '.includes(character)) return fontSize * 0.24;
  if (character === '-' || character === '−') return fontSize * 0.42;
  if (character === '%') return fontSize * 0.8;
  return fontSize * 0.6;
}

// MARK: - Hand-drawn strokes

const round = (value) => Math.round(value * 100) / 100;

/** + − × ÷ = as an SVG path in a `size` square, drawn as pen strokes so they match every font. */
export function markPath(symbol, seed, size) {
  const r = size / 2;
  const c = { x: r, y: r };
  const jitter = (i) => wobble(seed, i, 7) * size * 0.07;
  const parts = [];
  const stroke = (a, b, i) => {
    const start = `${round(a.x + jitter(i))} ${round(a.y + jitter(i + 1))}`;
    const control = `${round((a.x + b.x) / 2 + jitter(i + 2))} ${round((a.y + b.y) / 2 + jitter(i + 3))}`;
    const end = `${round(b.x + jitter(i + 4))} ${round(b.y + jitter(i + 5))}`;
    parts.push(`M${start}Q${control} ${end}`);
  };
  const dot = (p, i) => {
    const x = round(p.x + jitter(i));
    const y = round(p.y + jitter(i + 1));
    parts.push(`M${x} ${y}L${round(x + 0.6)} ${round(y + 0.4)}`);
  };

  switch (symbol) {
    case 'plus':
      stroke({ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }, 0);
      stroke({ x: c.x, y: c.y - r }, { x: c.x, y: c.y + r }, 10);
      break;
    case 'minus':
      stroke({ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }, 0);
      break;
    case 'times': {
      const d = r * 0.78;
      stroke({ x: c.x - d, y: c.y - d }, { x: c.x + d, y: c.y + d }, 0);
      stroke({ x: c.x + d, y: c.y - d }, { x: c.x - d, y: c.y + d }, 10);
      break;
    }
    case 'divide':
      stroke({ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }, 0);
      dot({ x: c.x, y: c.y - r * 0.62 }, 20);
      dot({ x: c.x, y: c.y + r * 0.62 }, 24);
      break;
    case 'equals':
      stroke({ x: c.x - r, y: c.y - r * 0.36 }, { x: c.x + r, y: c.y - r * 0.36 }, 0);
      stroke({ x: c.x - r, y: c.y + r * 0.36 }, { x: c.x + r, y: c.y + r * 0.36 }, 10);
      break;
  }
  return parts.join('');
}

/** The line drawn under a column before its total, as an SVG path `width` wide and 6 tall. */
export function rulePath(seed, width) {
  const y = 3;
  const jitter = (i) => wobble(seed, i, 11) * 1.2;
  return `M0 ${round(y + jitter(0))}`
    + `Q${round(width * 0.25)} ${round(y + jitter(2) * 1.5)} ${round(width / 2)} ${round(y + jitter(1))}`
    + `Q${round(width * 0.75)} ${round(y + jitter(4) * 1.5)} ${round(width)} ${round(y + jitter(3))}`;
}
