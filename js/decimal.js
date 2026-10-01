// Exact decimal numbers on BigInt, so 0.1 + 0.2 is 0.3 and every sum matches the paper.
// A value is `int / 10^scale`. Division keeps 40 decimal places.

const PLACES = 40;
const TEN = 10n;

export class Decimal {
  constructor(int, scale = 0) {
    this.int = int;
    this.scale = scale;
  }

  /** Parses canonical text ("-12.50", "3", "7."). Returns null for anything else. */
  static parse(text) {
    const match = /^(-?)(\d+)(?:\.(\d+))?\.?$/.exec(text);
    if (!match) return null;
    const fraction = match[3] ?? '';
    const int = BigInt(match[2] + fraction);
    return new Decimal(match[1] ? -int : int, fraction.length);
  }

  get isZero() {
    return this.int === 0n;
  }

  plus(other) {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(scaled(this, scale) + scaled(other, scale), scale);
  }

  minus(other) {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(scaled(this, scale) - scaled(other, scale), scale);
  }

  times(other) {
    return limited(new Decimal(this.int * other.int, this.scale + other.scale));
  }

  /** The caller checks for zero first. */
  dividedBy(other) {
    const numerator = this.int * TEN ** BigInt(other.scale + PLACES + 1);
    const denominator = other.int * TEN ** BigInt(this.scale);
    return new Decimal(numerator / denominator, PLACES + 1).rounded(PLACES);
  }

  /** Rounds half away from zero, like a till receipt. */
  rounded(places) {
    if (this.scale <= places) return this;
    const factor = TEN ** BigInt(this.scale - places);
    const negative = this.int < 0n;
    const magnitude = negative ? -this.int : this.int;
    let quotient = magnitude / factor;
    if ((magnitude % factor) * 2n >= factor) quotient += 1n;
    return new Decimal(negative ? -quotient : quotient, places);
  }

  equals(other) {
    return this.minus(other).isZero;
  }

  /** Canonical text: "." decimal point, no grouping, no trailing zeros. */
  toString() {
    let { int, scale } = this;
    while (scale > 0 && int % TEN === 0n) {
      int /= TEN;
      scale -= 1;
    }
    const negative = int < 0n;
    let digits = (negative ? -int : int).toString();
    if (scale > 0) {
      digits = digits.padStart(scale + 1, '0');
      digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    }
    return negative ? `-${digits}` : digits;
  }
}

function scaled(value, scale) {
  return value.int * TEN ** BigInt(scale - value.scale);
}

function limited(value) {
  return value.scale > PLACES ? value.rounded(PLACES) : value;
}
