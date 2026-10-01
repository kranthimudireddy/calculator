// Locale-aware number rendering that never goes through floating point,
// so what's on the tape is exactly what was typed or computed.

export class NumberFormat {
  constructor({
    groupingSeparator = ',',
    decimalSeparator = '.',
    minusSign = '-',
    primaryGroupSize = 3,
    // Digits in the groups further left; 0 means "same as primary". Indian grouping uses 2 (12,34,567).
    secondaryGroupSize = 0,
  } = {}) {
    Object.assign(this, { groupingSeparator, decimalSeparator, minusSign, primaryGroupSize, secondaryGroupSize });
  }

  static posix = new NumberFormat();

  /** Separators and grouping for a locale, e.g. "de-DE" or undefined for the device's. */
  static fromLocale(locale) {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567890.5);
    const groups = parts.filter((part) => part.type === 'integer').map((part) => part.value.length);
    const primary = groups.length > 1 ? groups[groups.length - 1] : 3;
    const secondary = groups.length > 2 ? groups[groups.length - 2] : 0;
    return new NumberFormat({
      groupingSeparator: parts.find((part) => part.type === 'group')?.value ?? ',',
      decimalSeparator: parts.find((part) => part.type === 'decimal')?.value ?? '.',
      primaryGroupSize: primary,
      secondaryGroupSize: secondary !== primary ? secondary : 0,
    });
  }

  /** Formats a computed value, rounded to `maxFractionDigits` and padded with zeros to at least `minFractionDigits`. */
  format(value, minFractionDigits, maxFractionDigits) {
    const rounded = value.rounded(maxFractionDigits);
    return this.formatCanonical(rounded.toString(), Math.min(minFractionDigits, maxFractionDigits));
  }

  /** Formats a number exactly as typed: "1234.50" → "1,234.50", "0." → "0.". */
  formatTyped(canonical) {
    return this.formatCanonical(canonical, 0);
  }

  /**
   * Turns user-typed text in this format ("1.234,5", "−12") into canonical form ("1234.5", "-12").
   * Returns null when the text isn't a number.
   */
  canonicalize(input) {
    let text = input.trim();
    let negative = false;
    if (['-', '−', '–'].includes(text[0])) {
      negative = true;
      text = text.slice(1);
    }
    if (this.groupingSeparator && this.groupingSeparator !== this.decimalSeparator) {
      text = text.split(this.groupingSeparator).join('');
    }
    text = text.replace(/[   ]/g, '');
    if (this.decimalSeparator !== '.') text = text.split(this.decimalSeparator).join('.');
    const point = text.indexOf('.');
    const parts = point < 0 ? [text] : [text.slice(0, point), text.slice(point + 1)];
    if (!parts.every((part) => /^\d*$/.test(part)) || !/\d/.test(text)) return null;
    let result = parts[0].replace(/^0+/, '') || '0';
    if (parts.length === 2 && parts[1]) result += `.${parts[1]}`;
    const isZero = /^[0.]*$/.test(result);
    return negative && !isZero ? `-${result}` : result;
  }

  formatCanonical(text, minFractionDigits) {
    if (!text) return '';
    let body = text;
    let negative = false;
    if (body.startsWith('-')) {
      negative = true;
      body = body.slice(1);
    }
    const point = body.indexOf('.');
    const hasPoint = point >= 0;
    let integer = hasPoint ? body.slice(0, point) : body;
    let fraction = hasPoint ? body.slice(point + 1) : '';
    if (!integer) integer = '0';
    while (fraction.length < minFractionDigits) fraction += '0';
    const isZero = /^0*$/.test(integer) && /^0*$/.test(fraction);
    let out = negative && !isZero ? this.minusSign : '';
    out += this.grouped(integer);
    if (hasPoint || fraction) out += this.decimalSeparator + fraction;
    return out;
  }

  grouped(digits) {
    if (!this.groupingSeparator || this.primaryGroupSize <= 0 || digits.length <= this.primaryGroupSize) return digits;
    const groups = [];
    let end = digits.length;
    let size = this.primaryGroupSize;
    while (end > 0) {
      const start = Math.max(0, end - size);
      groups.unshift(digits.slice(start, end));
      end = start;
      size = this.secondaryGroupSize > 0 ? this.secondaryGroupSize : this.primaryGroupSize;
    }
    return groups.join(this.groupingSeparator);
  }
}
