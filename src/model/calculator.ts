/**
 * The calculator's engine: an expression string in, an exact value out. Pure.
 *
 * Hand-written rather than math.js (about 600 KB) because a pop-up calculator
 * needs a scientific set, exact fractions and number bases, nothing more.
 * The entry point takes a plain string so that anything able to produce one
 * (the keypad, a hardware keyboard, later a recognised handwritten
 * expression) can be calculated the same way.
 *
 * - Numbers are kept exact as rationals (bigint numerator and denominator)
 *   wherever the operation allows: + − × ÷, whole powers, roots that come
 *   out exact, mod, n!, nCr, nPr, and sin/cos/tan of the angles in degrees
 *   whose value is rational. Anything irrational becomes a float. So
 *   0.1 + 0.2 is exactly 3/10, and the fractions switch only changes how a
 *   value is shown, never what it is.
 * - Precedence, loosest first: + −; × ÷ and implicit multiplication (the
 *   same level, left to right, so 1/2π is π/2 as math.js and TI read it);
 *   unary minus; ^ (right-associative, so −2^2 = −4 and 2^3^2 = 2^9); then
 *   postfix ! and %. A function written without brackets takes the operand
 *   after it (`sin 30`, `√9`). Brackets left open at the end are closed.
 * - The exponent of a decimal literal is a capital E (`1.5E3`); a lower-case
 *   e is always the constant, so "2e+1" means 2·e + 1.
 * - In a base other than ten, literals are read in that base (hex letters
 *   A–F included) and only whole results can be shown.
 *
 * Every failure is a short message ("Divide by zero", "Missing bracket");
 * no NaN or Infinity ever leaves this module as a value.
 */

export type AngleMode = "deg" | "rad";
export type NumberBase = 2 | 8 | 10 | 16;
export const NUMBER_BASES: readonly NumberBase[] = [10, 16, 2, 8];
export const BASE_LABELS: Readonly<Record<NumberBase, string>> = {
  2: "BIN",
  8: "OCT",
  10: "DEC",
  16: "HEX",
};

/** An exact rational in lowest terms, `d > 0`. */
export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

/** A calculator value: exact when it can be, a finite float otherwise. */
export type CalcValue = Rational | number;

export interface EvalContext {
  angle?: AngleMode;
  base?: NumberBase;
  /** The last answer, read by `Ans`. */
  ans?: CalcValue;
  /** The memory, read by `M` (MR). */
  memory?: CalcValue;
}

export type EvalResult = { ok: true; value: CalcValue } | { ok: false; error: string };

export interface FormatOptions {
  /** Show non-whole rationals as `n/d`. */
  fractions?: boolean;
  base?: NumberBase;
}

/** Significant digits shown. */
export const DISPLAY_DIGITS = 12;
/** Longest expression read; anything longer is refused rather than parsed. */
const MAX_LENGTH = 2000;
/** Deepest nesting of brackets and operators. */
const MAX_DEPTH = 200;
/** A rational with a part beyond this many bits becomes a float. */
const MAX_BITS = 4096;
const MAX_FACTORIAL = 1000;
const MAX_COMBINATION_STEPS = 5000;

class CalcError extends Error {}

function fail(message: string): never {
  throw new CalcError(message);
}

// --- Values -----------------------------------------------------------------

export function isRational(value: CalcValue): value is Rational {
  return typeof value !== "number";
}

function babs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function bitLength(x: bigint): number {
  if (x === 0n) return 0;
  const hex = babs(x).toString(16);
  return (hex.length - 1) * 4 + parseInt(hex[0], 16).toString(2).length;
}

function gcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

/** n/d in lowest terms; a float when either part grows past {@link MAX_BITS}. */
export function rational(n: bigint, d = 1n): CalcValue {
  if (d === 0n) fail("Divide by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  if (g > 1n) {
    n /= g;
    d /= g;
  }
  if (bitLength(n) > MAX_BITS || bitLength(d) > MAX_BITS) return toFloat({ n, d });
  return { n, d };
}

const ZERO = rational(0n);
const ONE = rational(1n);

/**
 * |n/d| rounded to `digits` significant digits: the digits and the power of
 * ten of the first one (value ≈ m.mmm × 10^exp).
 */
function significant(n: bigint, d: bigint, digits: number): { mant: string; exp: number } {
  const a = babs(n);
  if (a === 0n) return { mant: "0", exp: 0 };
  let exp = a.toString().length - d.toString().length;
  if (exp >= 0 ? a < d * pow10(exp) : a * pow10(-exp) < d) exp--;
  const shift = digits - 1 - exp;
  const num = shift >= 0 ? a * pow10(shift) : a;
  const den = shift >= 0 ? d : d * pow10(-shift);
  let m = (2n * num + den) / (2n * den);
  if (m === pow10(digits)) {
    m /= 10n;
    exp++;
  }
  return { mant: m.toString(), exp };
}

/** The nearest float (or ±Infinity / 0 beyond the float range). */
export function toFloat(value: CalcValue): number {
  if (typeof value === "number") return value;
  const { n, d } = value;
  const SAFE = 2n ** 53n;
  if (babs(n) < SAFE && d < SAFE) return Number(n) / Number(d);
  const { mant, exp } = significant(n, d, 17);
  const x = Number(`${mant[0]}.${mant.slice(1)}e${exp}`);
  return n < 0n ? -x : x;
}

/** A float result, refused when it is not a real, finite number. */
function finite(x: number): number {
  if (Number.isNaN(x)) fail("Not a real number");
  if (!Number.isFinite(x)) fail("Too large");
  return x === 0 ? 0 : x;
}

function isInteger(value: CalcValue): value is Rational {
  return isRational(value) && value.d === 1n;
}

function sign(value: CalcValue): number {
  if (typeof value === "number") return Math.sign(value);
  return value.n === 0n ? 0 : value.n < 0n ? -1 : 1;
}

/** A float that is a whole number, as an exact integer; anything else unchanged. */
function exactIfWhole(value: CalcValue): CalcValue {
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) < 2 ** 53) {
    return rational(BigInt(value));
  }
  return value;
}

export function add(a: CalcValue, b: CalcValue): CalcValue {
  if (isRational(a) && isRational(b)) return rational(a.n * b.d + b.n * a.d, a.d * b.d);
  return finite(toFloat(a) + toFloat(b));
}

export function negate(a: CalcValue): CalcValue {
  return isRational(a) ? rational(-a.n, a.d) : finite(-a);
}

export function subtract(a: CalcValue, b: CalcValue): CalcValue {
  return add(a, negate(b));
}

export function multiply(a: CalcValue, b: CalcValue): CalcValue {
  if (isRational(a) && isRational(b)) return rational(a.n * b.n, a.d * b.d);
  return finite(toFloat(a) * toFloat(b));
}

export function divide(a: CalcValue, b: CalcValue): CalcValue {
  if (sign(b) === 0) fail("Divide by zero");
  if (isRational(a) && isRational(b)) return rational(a.n * b.d, a.d * b.n);
  return finite(toFloat(a) / toFloat(b));
}

function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
}

/** a mod b, taking the divisor's sign (a − b·⌊a/b⌋). */
function modulo(a: CalcValue, b: CalcValue): CalcValue {
  if (sign(b) === 0) fail("Divide by zero");
  if (isRational(a) && isRational(b)) {
    const q = floorDiv(a.n * b.d, a.d * b.n);
    return subtract(a, multiply(b, rational(q)));
  }
  const x = toFloat(a);
  const y = toFloat(b);
  return finite(x - y * Math.floor(x / y));
}

function equal(a: CalcValue, b: CalcValue): boolean {
  if (isRational(a) && isRational(b)) return a.n === b.n && a.d === b.d;
  return toFloat(a) === toFloat(b);
}

/** The exact integer k-th root of a ≥ 0, or null when there is none. */
function integerRoot(a: bigint, k: number): bigint | null {
  if (a < 2n) return a;
  let x: bigint;
  if (a < 2n ** 52n) {
    x = BigInt(Math.round(Math.pow(Number(a), 1 / k)));
    for (const c of [x - 1n, x, x + 1n]) if (c >= 0n && c ** BigInt(k) === a) return c;
    return null;
  }
  const K = BigInt(k);
  x = 1n << BigInt(Math.ceil(bitLength(a) / k) + 1);
  for (;;) {
    const y = ((K - 1n) * x + a / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  return x ** K === a ? x : null;
}

function rationalRoot(q: Rational, k: number): CalcValue | null {
  const negative = q.n < 0n;
  if (negative && k % 2 === 0) return null;
  const n = integerRoot(babs(q.n), k);
  const d = n === null ? null : integerRoot(q.d, k);
  if (n === null || d === null) return null;
  return rational(negative ? -n : n, d);
}

function wholePower(a: Rational, k: bigint): CalcValue {
  if (k === 0n) return ONE;
  if (a.n === 0n && k < 0n) fail("Divide by zero");
  const e = babs(k);
  if (Math.max(bitLength(a.n), bitLength(a.d)) * Number(e) > MAX_BITS) {
    return finite(Math.pow(toFloat(a), Number(k)));
  }
  const p = { n: a.n ** e, d: a.d ** e };
  return k < 0n ? rational(p.d, p.n) : rational(p.n, p.d);
}

export function power(a: CalcValue, b: CalcValue): CalcValue {
  if (isRational(a) && isRational(b)) {
    if (b.d === 1n) return wholePower(a, b.n);
    if (b.d <= 64n) {
      const root = rationalRoot(a, Number(b.d));
      if (root !== null && isRational(root)) return wholePower(root, b.n);
    }
  }
  const x = toFloat(a);
  const y = toFloat(b);
  if (x === 0 && y < 0) fail("Divide by zero");
  if (x < 0 && !Number.isInteger(y)) {
    // A negative number to an odd-denominator fraction is still real.
    if (isRational(b) && b.d % 2n === 1n) {
      const m = Math.pow(-x, y);
      return finite(b.n % 2n === 0n ? m : -m);
    }
    fail("Not a real number");
  }
  return finite(Math.pow(x, y));
}

function naturalLog(value: CalcValue): number {
  if (sign(value) <= 0) fail("Not a real number");
  if (isRational(value) && value.n === value.d) return 0;
  const x = toFloat(value);
  if (Number.isFinite(x) && x > 0) return Math.log(x);
  // Beyond the float range: ln(m × 10^e) = ln m + e·ln 10.
  const r = value as Rational;
  const { mant, exp } = significant(r.n, r.d, 17);
  return Math.log(Number(`${mant[0]}.${mant.slice(1)}`)) + exp * Math.LN10;
}

function logarithm(x: CalcValue, base: CalcValue): CalcValue {
  const lb = naturalLog(base);
  if (lb === 0) fail("Undefined");
  const r = naturalLog(x) / lb;
  // log₂ 8 is 3, not 2.9999999999999996, when it is exactly so.
  const k = Math.round(r);
  if (Math.abs(r - k) < 1e-9 && Math.abs(k) <= 4096 && isRational(x) && isRational(base)) {
    if (equal(wholePower(base, BigInt(k)), x)) return rational(BigInt(k));
  }
  return finite(r);
}

function roundTo(value: CalcValue, places: CalcValue): CalcValue {
  if (!isInteger(places) || places.n < 0n || places.n > 15n) fail("Places: 0 to 15");
  const scale = pow10(Number(places.n));
  if (isRational(value)) {
    const n = babs(value.n) * scale;
    const r = (2n * n + value.d) / (2n * value.d);
    return rational(value.n < 0n ? -r : r, scale);
  }
  return finite(Number(value.toFixed(Number(places.n))));
}

function wholeNonNegative(value: CalcValue): bigint {
  const v = exactIfWhole(value);
  if (!isInteger(v) || v.n < 0n) fail("Whole numbers ≥ 0 only");
  return v.n;
}

function factorial(value: CalcValue): CalcValue {
  const n = wholeNonNegative(value);
  if (n > BigInt(MAX_FACTORIAL)) fail("Too large");
  let p = 1n;
  for (let i = 2n; i <= n; i++) p *= i;
  return rational(p);
}

function permutations(nValue: CalcValue, rValue: CalcValue, choose: boolean): CalcValue {
  const n = wholeNonNegative(nValue);
  let r = wholeNonNegative(rValue);
  if (r > n) return ZERO;
  if (choose && n - r < r) r = n - r;
  if (r > BigInt(MAX_COMBINATION_STEPS)) fail("Too large");
  let p = 1n;
  for (let i = 0n; i < r; i++) p *= n - i;
  if (!choose) return rational(p);
  let f = 1n;
  for (let i = 2n; i <= r; i++) f *= i;
  return rational(p / f);
}

// --- Trigonometry -------------------------------------------------------------

type Trig = "sin" | "cos" | "tan";

const SIN_DEGREES: Readonly<Record<number, CalcValue>> = {
  0: ZERO,
  30: rational(1n, 2n),
  90: ONE,
  150: rational(1n, 2n),
  180: ZERO,
  210: rational(-1n, 2n),
  270: rational(-1n),
  330: rational(-1n, 2n),
};

/** The exact value at a whole number of degrees, when it is rational; null otherwise. */
function exactDegrees(kind: Trig, degrees: Rational): CalcValue | null {
  const r = modulo(degrees, rational(360n));
  if (!isInteger(r)) return null;
  const a = Number(r.n);
  if (kind === "tan") {
    if (a % 180 === 90) fail("Undefined");
    if (a % 180 === 0) return ZERO;
    if (a % 180 === 45) return ONE;
    if (a % 180 === 135) return rational(-1n);
    return null;
  }
  const at = kind === "sin" ? a : (a + 90) % 360;
  return Object.prototype.hasOwnProperty.call(SIN_DEGREES, at) ? SIN_DEGREES[at] : null;
}

/** Float trig lands a hair off 0, ±½ and ±1 (sin π = 1.2e-16); put it on them. */
function snapTrig(x: number): CalcValue {
  const half = Math.round(x * 2);
  if (Math.abs(x * 2 - half) < 2e-14) return rational(BigInt(half), 2n);
  return finite(x);
}

function trig(kind: Trig, value: CalcValue, angle: AngleMode): CalcValue {
  if (angle === "deg" && isRational(value)) {
    const exact = exactDegrees(kind, value);
    if (exact !== null) return exact;
  }
  const x = angle === "deg" ? (toFloat(value) * Math.PI) / 180 : toFloat(value);
  if (kind === "tan" && Math.abs(Math.cos(x)) < 1e-12) fail("Undefined");
  return snapTrig(kind === "sin" ? Math.sin(x) : kind === "cos" ? Math.cos(x) : Math.tan(x));
}

function inverseTrig(kind: Trig, value: CalcValue, angle: AngleMode): CalcValue {
  const x = toFloat(value);
  if (kind !== "tan" && (x < -1 || x > 1)) fail("Not a real number");
  const r = kind === "sin" ? Math.asin(x) : kind === "cos" ? Math.acos(x) : Math.atan(x);
  if (angle === "rad") return finite(r);
  const degrees = (r * 180) / Math.PI;
  const k = Math.round(degrees);
  return Math.abs(degrees - k) < 1e-9 ? rational(BigInt(k)) : finite(degrees);
}

// --- Functions and names -------------------------------------------------------

interface CalcFunction {
  /** How it is written, for messages. */
  label: string;
  min: number;
  max: number;
  apply: (args: CalcValue[], angle: AngleMode) => CalcValue;
}

const HALF = rational(1n, 2n);

const FUNCTIONS: ReadonlyMap<string, CalcFunction> = new Map<string, CalcFunction>([
  ["sin", { label: "sin", min: 1, max: 1, apply: ([x], a) => trig("sin", x, a) }],
  ["cos", { label: "cos", min: 1, max: 1, apply: ([x], a) => trig("cos", x, a) }],
  ["tan", { label: "tan", min: 1, max: 1, apply: ([x], a) => trig("tan", x, a) }],
  ["asin", { label: "asin", min: 1, max: 1, apply: ([x], a) => inverseTrig("sin", x, a) }],
  ["acos", { label: "acos", min: 1, max: 1, apply: ([x], a) => inverseTrig("cos", x, a) }],
  ["atan", { label: "atan", min: 1, max: 1, apply: ([x], a) => inverseTrig("tan", x, a) }],
  ["ln", { label: "ln", min: 1, max: 1, apply: ([x]) => finite(naturalLog(x)) }],
  [
    "log",
    {
      label: "log",
      min: 1,
      max: 2,
      apply: ([x, b]) => logarithm(x, b ?? rational(10n)),
    },
  ],
  ["sqrt", { label: "√", min: 1, max: 1, apply: ([x]) => power(x, HALF) }],
  ["root", { label: "root", min: 2, max: 2, apply: ([x, n]) => power(x, divide(ONE, n)) }],
  [
    "abs",
    {
      label: "abs",
      min: 1,
      max: 1,
      apply: ([x]) => (sign(x) < 0 ? negate(x) : x),
    },
  ],
  ["round", { label: "round", min: 1, max: 2, apply: ([x, p]) => roundTo(x, p ?? ZERO) }],
  ["mod", { label: "mod", min: 2, max: 2, apply: ([a, b]) => modulo(a, b) }],
  ["ncr", { label: "nCr", min: 2, max: 2, apply: ([n, r]) => permutations(n, r, true) }],
  ["npr", { label: "nPr", min: 2, max: 2, apply: ([n, r]) => permutations(n, r, false) }],
]);

const ALIASES: Readonly<Record<string, string>> = {
  arcsin: "asin",
  arccos: "acos",
  arctan: "atan",
  rnd: "round",
};

// --- Tokens -------------------------------------------------------------------

type Token =
  { kind: "num"; value: CalcValue } | { kind: "name"; name: string } | { kind: "op"; op: string };

const OPERATORS = "+-*/^(),!%√";

/** Typographic forms (the keypad's, or a recogniser's) to the ones the tokenizer reads. */
function normalise(source: string): string {
  return source
    .replace(/[×·∗⋅]/g, "*")
    .replace(/[÷∕]/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/;/g, ",")
    .replace(/π/g, " pi ")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);
const isHexDigit = (c: string | undefined): boolean => c !== undefined && /[0-9A-Fa-f]/.test(c);

function decimalLiteral(int: string, frac: string, exp: number): CalcValue {
  if (Math.abs(exp) > 1000) fail("Too large");
  const n = BigInt(int + frac || "0");
  const scale = exp - frac.length;
  return scale >= 0 ? rational(n * pow10(scale)) : rational(n, pow10(-scale));
}

function tokenize(source: string, base: NumberBase): Token[] {
  const s = normalise(source);
  const tokens: Token[] = [];
  let i = 0;
  const readWhile = (test: (c: string) => boolean): string => {
    const start = i;
    while (i < s.length && test(s[i])) i++;
    return s.slice(start, i);
  };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (base === 10 && (isDigit(c) || (c === "." && isDigit(s[i + 1])))) {
      if (c === "0" && /[xbo]/.test(s[i + 1] ?? "") && isHexDigit(s[i + 2])) {
        const radix = s[i + 1] === "x" ? 16 : s[i + 1] === "b" ? 2 : 8;
        i += 2;
        tokens.push({ kind: "num", value: baseLiteral(readWhile(isHexDigit), radix) });
        continue;
      }
      const int = readWhile(isDigit);
      let frac = "";
      if (s[i] === ".") {
        i++;
        frac = readWhile(isDigit);
      }
      let exp = 0;
      const signed = s[i + 1] === "+" || s[i + 1] === "-";
      if (s[i] === "E" && isDigit(s[signed ? i + 2 : i + 1])) {
        const negative = s[i + 1] === "-";
        i += signed ? 2 : 1;
        exp = Number(readWhile(isDigit));
        if (negative) exp = -exp;
      }
      if (s[i] === ".") fail("Syntax error");
      tokens.push({ kind: "num", value: decimalLiteral(int, frac, exp) });
      continue;
    }
    if (base !== 10 && isDigit(c)) {
      const digits = readWhile(base === 16 ? isHexDigit : isDigit);
      tokens.push({ kind: "num", value: baseLiteral(digits, base) });
      continue;
    }
    if (isLetter(c)) {
      const word = readWhile(isLetter);
      if (base === 16 && /^[0-9A-Fa-f]+$/.test(word)) {
        tokens.push({ kind: "num", value: baseLiteral(word, 16) });
      } else {
        tokens.push({ kind: "name", name: word.toLowerCase() });
      }
      continue;
    }
    if (OPERATORS.includes(c)) {
      tokens.push({ kind: "op", op: c });
      i++;
      continue;
    }
    fail(c === "." ? "Syntax error" : `Unknown sign: ${c}`);
  }
  return tokens;
}

function baseLiteral(digits: string, radix: number): CalcValue {
  let n = 0n;
  const R = BigInt(radix);
  for (const ch of digits) {
    const v = parseInt(ch, 16);
    if (!(v < radix))
      fail(`${ch.toUpperCase()} is not a ${BASE_LABELS[radix as NumberBase]} digit`);
    n = n * R + BigInt(v);
  }
  return rational(n);
}

// --- Parser -------------------------------------------------------------------

class Parser {
  private i = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly ctx: Required<EvalContext>,
  ) {}

  parse(): CalcValue {
    if (this.tokens.length === 0) fail("Nothing to calculate");
    const value = this.expression();
    const left = this.tokens[this.i];
    if (left) fail(left.kind === "op" && left.op === ")" ? "Missing bracket" : "Syntax error");
    return value;
  }

  private peekOp(): string | null {
    const t = this.tokens[this.i];
    return t?.kind === "op" ? t.op : null;
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) fail("Too complex");
  }

  private expression(): CalcValue {
    this.enter();
    let value = this.term();
    for (let op = this.peekOp(); op === "+" || op === "-"; op = this.peekOp()) {
      this.i++;
      const right = this.term();
      value = op === "+" ? add(value, right) : subtract(value, right);
    }
    this.depth--;
    return value;
  }

  /** Whether the next token can start an operand, for implicit multiplication. */
  private startsOperand(): boolean {
    const t = this.tokens[this.i];
    if (!t) return false;
    return t.kind !== "op" || t.op === "(" || t.op === "√";
  }

  private term(): CalcValue {
    let value = this.unary();
    for (;;) {
      const op = this.peekOp();
      if (op === "*" || op === "/") {
        this.i++;
        const right = this.unary();
        value = op === "*" ? multiply(value, right) : divide(value, right);
      } else if (this.startsOperand()) {
        value = multiply(value, this.power());
      } else {
        return value;
      }
    }
  }

  private unary(): CalcValue {
    const op = this.peekOp();
    if (op === "-" || op === "+") {
      this.i++;
      this.enter();
      const value = this.unary();
      this.depth--;
      return op === "-" ? negate(value) : value;
    }
    return this.power();
  }

  private power(): CalcValue {
    const base = this.postfix();
    if (this.peekOp() !== "^") return base;
    this.i++;
    this.enter();
    const exponent = this.unary();
    this.depth--;
    return power(base, exponent);
  }

  private postfix(): CalcValue {
    let value = this.primary();
    for (let op = this.peekOp(); op === "!" || op === "%"; op = this.peekOp()) {
      this.i++;
      value = op === "!" ? factorial(value) : divide(value, rational(100n));
    }
    return value;
  }

  /** `)` closes; the end of the input closes too (brackets left open are forgiven). */
  private close(): void {
    if (this.peekOp() === ")") this.i++;
    else if (this.i < this.tokens.length) fail("Syntax error");
  }

  private primary(): CalcValue {
    const t = this.tokens[this.i];
    if (!t) fail("Syntax error");
    this.i++;
    if (t.kind === "num") return t.value;
    if (t.kind === "op") {
      if (t.op === "(") {
        const value = this.expression();
        this.close();
        return value;
      }
      if (t.op === "√") return power(this.unary(), HALF);
      const after = this.tokens[this.i - 2];
      const empty = after?.kind === "op" && after.op === "(";
      fail(t.op === ")" && !empty ? "Missing bracket" : "Syntax error");
    }
    const name = ALIASES[t.name] ?? t.name;
    switch (name) {
      case "pi":
        return Math.PI;
      case "e":
        return Math.E;
      case "ans":
        return this.ctx.ans;
      case "m":
        return this.ctx.memory;
    }
    const fn = FUNCTIONS.get(name);
    if (!fn) fail(`Unknown name: ${t.name}`);
    const args: CalcValue[] = [];
    if (this.peekOp() === "(") {
      this.i++;
      if (this.peekOp() !== ")") {
        args.push(this.expression());
        while (this.peekOp() === ",") {
          this.i++;
          args.push(this.expression());
        }
      }
      this.close();
    } else {
      args.push(this.unary());
    }
    if (args.length < fn.min || args.length > fn.max) {
      const count = fn.min === fn.max ? `${fn.min}` : `${fn.min} or ${fn.max}`;
      fail(`${fn.label} takes ${count} number${fn.max === 1 ? "" : "s"}`);
    }
    return fn.apply(args, this.ctx.angle);
  }
}

/**
 * Calculate `expression`. Never throws for bad input: every failure comes
 * back as `{ ok: false, error }` with a short message for the display.
 */
export function evaluate(expression: string, ctx: EvalContext = {}): EvalResult {
  try {
    if (expression.length > MAX_LENGTH) fail("Too long");
    const base = ctx.base ?? 10;
    const full: Required<EvalContext> = {
      angle: ctx.angle ?? "deg",
      base,
      ans: ctx.ans ?? ZERO,
      memory: ctx.memory ?? ZERO,
    };
    let value = new Parser(tokenize(expression, base), full).parse();
    if (typeof value === "number") value = finite(value);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof CalcError) return { ok: false, error: error.message };
    // A bigint grown past what the engine allows, or a recursion limit.
    if (error instanceof RangeError) return { ok: false, error: "Too large" };
    throw error;
  }
}

// --- Display ------------------------------------------------------------------

/** Digits and power of ten as text: fixed while it is short, else `m.mmmE±x`. */
function layout(negative: boolean, mant: string, exp: number): string {
  const digits = mant.replace(/0+$/, "");
  if (digits === "") return "0";
  const minus = negative ? "-" : "";
  if (exp >= -6 && exp < DISPLAY_DIGITS) {
    if (exp < 0) return `${minus}0.${"0".repeat(-exp - 1)}${digits}`;
    const int = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
    const frac = digits.slice(exp + 1);
    return `${minus}${int}${frac ? `.${frac}` : ""}`;
  }
  const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${minus}${m}E${exp}`;
}

/**
 * `value` as the display shows it: 12 significant digits, `n/d` with
 * fractions on, the integer in `base` otherwise. Null when the value has no
 * form in that base (it is not whole).
 */
export function formatValue(value: CalcValue, options: FormatOptions = {}): string | null {
  const base = options.base ?? 10;
  if (base !== 10) {
    const whole = exactIfWhole(value);
    if (!isInteger(whole)) return null;
    const text = babs(whole.n).toString(base).toUpperCase();
    return whole.n < 0n ? `-${text}` : text;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (value === 0) return "0";
    const [m, e] = Math.abs(value)
      .toExponential(DISPLAY_DIGITS - 1)
      .split("e");
    return layout(value < 0, m.replace(".", ""), Number(e));
  }
  const { n, d } = value;
  if (options.fractions && d !== 1n) {
    const top = n.toString();
    const bottom = d.toString();
    if (babs(n).toString().length <= DISPLAY_DIGITS && bottom.length <= DISPLAY_DIGITS) {
      return `${top}/${bottom}`;
    }
  }
  const { mant, exp } = significant(n, d, DISPLAY_DIGITS);
  return layout(n < 0n, mant, exp);
}

/** Evaluate and format in one step: what the display shows for `expression`. */
export function calculate(
  expression: string,
  ctx: EvalContext = {},
  options: FormatOptions = {},
): { ok: true; value: CalcValue; text: string } | { ok: false; error: string } {
  const result = evaluate(expression, ctx);
  if (!result.ok) return result;
  const text = formatValue(result.value, { ...options, base: ctx.base ?? options.base });
  if (text === null) return { ok: false, error: "Not a whole number" };
  return { ok: true, value: result.value, text };
}

// --- Editing ------------------------------------------------------------------

/** What the keypad's ⌫ removes: a whole function name with its bracket, or one sign. */
export function deleteLast(expression: string): string {
  const trimmed = expression.replace(/\s+$/, "");
  const match =
    /(?:asin|acos|atan|sin|cos|tan|ln|log|sqrt|root|abs|round|mod|nCr|nPr)\($|Ans$/i.exec(trimmed);
  if (match) return trimmed.slice(0, match.index);
  return Array.from(trimmed).slice(0, -1).join("");
}
