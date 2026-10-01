// Choices saved in settings, and the colours, fonts and sizes they map to (the same as the iOS app).

export const THEMES = {
  sky: {
    name: 'Sky', panel: '#8FCBEF', digitFill: '#FFFFFF', digitText: '#1E2A33',
    opFill: '#3F87BF', fnFill: '#CDE8F8', fnText: '#245C86', noteInk: ['#2F6FAE', '#7DB8EC'],
  },
  ocean: {
    name: 'Ocean', panel: '#5E88A8', digitFill: '#FFFFFF', digitText: '#1F2C38',
    opFill: '#1E3A52', fnFill: '#A9C3D6', fnText: '#1E3A52', noteInk: ['#33658E', '#8DB4D4'],
  },
  cherry: {
    name: 'Cherry', panel: '#E4475F', digitFill: '#FFFFFF', digitText: '#3A1A20',
    opFill: '#A32238', fnFill: '#F6B3BE', fnText: '#7E1729', noteInk: ['#C02A45', '#F28A9C'],
  },
  mint: {
    name: 'Mint', panel: '#7CCBAE', digitFill: '#FFFFFF', digitText: '#1C332B',
    opFill: '#2E7A5E', fnFill: '#C9EDDF', fnText: '#22614A', noteInk: ['#2A7F60', '#7FD3B2'],
  },
  // Night reads best on dark paper whatever the system setting.
  night: {
    name: 'Night', panel: '#0B0B0C', digitFill: '#D4D4D2', digitText: '#111111',
    opFill: '#C98B2E', fnFill: '#505055', fnText: '#FFFFFF', noteInk: ['#B9771B', '#E0A650'], scheme: 'dark',
  },
};

/** Apple's handwriting faces, built into iPhone and Mac. */
export const FONTS = {
  noteworthy: { name: 'Noteworthy', family: 'Noteworthy, cursive', weight: 300, digitWidth: 0.56, sizeAdjustment: 1 },
  bradley: { name: 'Bradley Hand', family: '"Bradley Hand", cursive', weight: 700, digitWidth: 0.56, sizeAdjustment: 1.12 },
  marker: { name: 'Marker Felt', family: '"Marker Felt", cursive', weight: 300, digitWidth: 0.54, sizeAdjustment: 1 },
  chalkboard: { name: 'Chalkboard', family: '"Chalkboard SE", cursive', weight: 300, digitWidth: 0.62, sizeAdjustment: 0.9 },
  party: { name: 'Party', family: '"Party LET", cursive', weight: 400, digitWidth: 0.5, sizeAdjustment: 1.3 },
};

const SIZES = {
  small: { fontSize: 24, rowHeight: 34 },
  medium: { fontSize: 30, rowHeight: 40 },
  large: { fontSize: 36, rowHeight: 48 },
};

export const DEFAULT_PREFS = { theme: 'sky', paper: 'grid', font: 'noteworthy', size: 'medium', decimals: 2 };

const STORAGE_KEY = 'calculator.prefs';

export function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...DEFAULT_PREFS, ...saved };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing can refuse storage; the choice just won't be remembered.
  }
}

/** Every row is exactly one line of paper tall, so ruled and grid paper line up with the writing. */
export function metrics(size) {
  const { fontSize, rowHeight } = SIZES[size] ?? SIZES.medium;
  return {
    fontSize,
    rowHeight,
    sidePadding: 18,
    noteFontSize: Math.round(rowHeight * 0.4),
    headingFontSize: Math.round(fontSize * 0.8),
  };
}
