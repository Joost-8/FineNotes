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

import { derivative, integrate, limit, solveIn, solveNear } from "./calculus";

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
  /** The same in floats, for graphs and numerical calculus: NaN where it is undefined. */
  float: (args: number[], angle: AngleMode) => number;
}

const HALF = rational(1n, 2n);
const toRad = (x: number, angle: AngleMode): number => (angle === "deg" ? (x * Math.PI) / 180 : x);
const fromRad = (x: number, angle: AngleMode): number =>
  angle === "deg" ? (x * 180) / Math.PI : x;

/** x^y in floats, real where an odd root makes it so ((−8)^(1/3) = −2). */
function floatPower(x: number, y: number): number {
  if (x >= 0 || Number.isInteger(y)) return Math.pow(x, y);
  const q = 1 / y;
  const k = Math.round(q);
  if (Math.abs(q - k) < 1e-9 && k % 2 !== 0) return -Math.pow(-x, y);
  return NaN;
}

function floatFactorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let p = 1;
  for (let i = 2; i <= n; i++) p *= i;
  return p;
}

function floatPermutations(n: number, r: number, choose: boolean): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0) return NaN;
  if (r > n) return 0;
  if (choose && n - r < r) r = n - r;
  if (r > MAX_COMBINATION_STEPS) return NaN;
  let p = 1;
  for (let i = 0; i < r; i++) p *= choose ? (n - i) / (i + 1) : n - i;
  return choose ? Math.round(p) : p;
}

const FUNCTIONS: ReadonlyMap<string, CalcFunction> = new Map<string, CalcFunction>([
  [
    "sin",
    {
      label: "sin",
      min: 1,
      max: 1,
      apply: ([x], a) => trig("sin", x, a),
      float: ([x], a) => Math.sin(toRad(x, a)),
    },
  ],
  [
    "cos",
    {
      label: "cos",
      min: 1,
      max: 1,
      apply: ([x], a) => trig("cos", x, a),
      float: ([x], a) => Math.cos(toRad(x, a)),
    },
  ],
  [
    "tan",
    {
      label: "tan",
      min: 1,
      max: 1,
      apply: ([x], a) => trig("tan", x, a),
      float: ([x], a) => Math.tan(toRad(x, a)),
    },
  ],
  [
    "asin",
    {
      label: "asin",
      min: 1,
      max: 1,
      apply: ([x], a) => inverseTrig("sin", x, a),
      float: ([x], a) => fromRad(Math.asin(x), a),
    },
  ],
  [
    "acos",
    {
      label: "acos",
      min: 1,
      max: 1,
      apply: ([x], a) => inverseTrig("cos", x, a),
      float: ([x], a) => fromRad(Math.acos(x), a),
    },
  ],
  [
    "atan",
    {
      label: "atan",
      min: 1,
      max: 1,
      apply: ([x], a) => inverseTrig("tan", x, a),
      float: ([x], a) => fromRad(Math.atan(x), a),
    },
  ],
  [
    "ln",
    {
      label: "ln",
      min: 1,
      max: 1,
      apply: ([x]) => finite(naturalLog(x)),
      float: ([x]) => Math.log(x),
    },
  ],
  [
    "log",
    {
      label: "log",
      min: 1,
      max: 2,
      apply: ([x, b]) => logarithm(x, b ?? rational(10n)),
      float: ([x, b]) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
    },
  ],
  [
    "sqrt",
    { label: "√", min: 1, max: 1, apply: ([x]) => power(x, HALF), float: ([x]) => Math.sqrt(x) },
  ],
  [
    "root",
    {
      label: "root",
      min: 2,
      max: 2,
      apply: ([x, n]) => power(x, divide(ONE, n)),
      float: ([x, n]) => floatPower(x, 1 / n),
    },
  ],
  [
    "abs",
    {
      label: "abs",
      min: 1,
      max: 1,
      apply: ([x]) => (sign(x) < 0 ? negate(x) : x),
      float: ([x]) => Math.abs(x),
    },
  ],
  [
    "round",
    {
      label: "round",
      min: 1,
      max: 2,
      apply: ([x, p]) => roundTo(x, p ?? ZERO),
      float: ([x, p]) => {
        const scale = 10 ** (p ?? 0);
        return (Math.sign(x) * Math.round(Math.abs(x) * scale)) / scale;
      },
    },
  ],
  [
    "mod",
    {
      label: "mod",
      min: 2,
      max: 2,
      apply: ([a, b]) => modulo(a, b),
      float: ([a, b]) => a - b * Math.floor(a / b),
    },
  ],
  [
    "ncr",
    {
      label: "nCr",
      min: 2,
      max: 2,
      apply: ([n, r]) => permutations(n, r, true),
      float: ([n, r]) => floatPermutations(n, r, true),
    },
  ],
  [
    "npr",
    {
      label: "nPr",
      min: 2,
      max: 2,
      apply: ([n, r]) => permutations(n, r, false),
      float: ([n, r]) => floatPermutations(n, r, false),
    },
  ],
]);

/** A whole number for the bitwise functions, or a clear refusal. */
function wholeNumber(value: CalcValue): bigint {
  const v = exactIfWhole(value);
  if (!isInteger(v)) fail("Whole numbers only");
  return v.n;
}

/** 1 / f(x), "Undefined" where f is 0 (sec 90°). */
function reciprocal(value: CalcValue): CalcValue {
  if (sign(value) === 0) fail("Undefined");
  return divide(ONE, value);
}

const hyperbolic =
  (f: (x: number) => number): CalcFunction["apply"] =>
  ([x]) =>
    sign(x) === 0 && f(0) === 0 ? ZERO : finite(f(toFloat(x)));

/** Shifts stop here: a bigint of more bits than the engine keeps is no use to anyone. */
const MAX_SHIFT = 4096;

const MORE_FUNCTIONS: Array<[string, CalcFunction]> = [
  [
    "sinh",
    { label: "sinh", min: 1, max: 1, apply: hyperbolic(Math.sinh), float: ([x]) => Math.sinh(x) },
  ],
  [
    "cosh",
    {
      label: "cosh",
      min: 1,
      max: 1,
      apply: ([x]) => finite(Math.cosh(toFloat(x))),
      float: ([x]) => Math.cosh(x),
    },
  ],
  [
    "tanh",
    { label: "tanh", min: 1, max: 1, apply: hyperbolic(Math.tanh), float: ([x]) => Math.tanh(x) },
  ],
  [
    "asinh",
    {
      label: "asinh",
      min: 1,
      max: 1,
      apply: hyperbolic(Math.asinh),
      float: ([x]) => Math.asinh(x),
    },
  ],
  [
    "acosh",
    {
      label: "acosh",
      min: 1,
      max: 1,
      apply: ([x]) => finite(Math.acosh(toFloat(x))),
      float: ([x]) => Math.acosh(x),
    },
  ],
  [
    "atanh",
    {
      label: "atanh",
      min: 1,
      max: 1,
      apply: hyperbolic(Math.atanh),
      float: ([x]) => Math.atanh(x),
    },
  ],
  [
    "sec",
    {
      label: "sec",
      min: 1,
      max: 1,
      apply: ([x], a) => reciprocal(trig("cos", x, a)),
      float: ([x], a) => 1 / Math.cos(toRad(x, a)),
    },
  ],
  [
    "csc",
    {
      label: "csc",
      min: 1,
      max: 1,
      apply: ([x], a) => reciprocal(trig("sin", x, a)),
      float: ([x], a) => 1 / Math.sin(toRad(x, a)),
    },
  ],
  [
    "cot",
    {
      label: "cot",
      min: 1,
      max: 1,
      apply: ([x], a) => reciprocal(trig("tan", x, a)),
      float: ([x], a) => 1 / Math.tan(toRad(x, a)),
    },
  ],
  [
    "asec",
    {
      label: "asec",
      min: 1,
      max: 1,
      apply: ([x], a) => inverseTrig("cos", reciprocal(x), a),
      float: ([x], a) => fromRad(Math.acos(1 / x), a),
    },
  ],
  [
    "acsc",
    {
      label: "acsc",
      min: 1,
      max: 1,
      apply: ([x], a) => inverseTrig("sin", reciprocal(x), a),
      float: ([x], a) => fromRad(Math.asin(1 / x), a),
    },
  ],
  [
    "acot",
    {
      label: "acot",
      min: 1,
      max: 1,
      apply: ([x], a) =>
        sign(x) === 0
          ? a === "deg"
            ? rational(90n)
            : Math.PI / 2
          : inverseTrig("tan", reciprocal(x), a),
      float: ([x], a) => fromRad(x === 0 ? Math.PI / 2 : Math.atan(1 / x), a),
    },
  ],
  [
    "and",
    {
      label: "AND",
      min: 2,
      max: 2,
      apply: ([a, b]) => rational(wholeNumber(a) & wholeNumber(b)),
      float: ([a, b]) =>
        Number.isInteger(a) && Number.isInteger(b) ? Number(BigInt(a) & BigInt(b)) : NaN,
    },
  ],
  [
    "or",
    {
      label: "OR",
      min: 2,
      max: 2,
      apply: ([a, b]) => rational(wholeNumber(a) | wholeNumber(b)),
      float: ([a, b]) =>
        Number.isInteger(a) && Number.isInteger(b) ? Number(BigInt(a) | BigInt(b)) : NaN,
    },
  ],
  [
    "xor",
    {
      label: "XOR",
      min: 2,
      max: 2,
      apply: ([a, b]) => rational(wholeNumber(a) ^ wholeNumber(b)),
      float: ([a, b]) =>
        Number.isInteger(a) && Number.isInteger(b) ? Number(BigInt(a) ^ BigInt(b)) : NaN,
    },
  ],
  [
    "not",
    {
      label: "NOT",
      min: 1,
      max: 1,
      apply: ([a]) => rational(-wholeNumber(a) - 1n),
      float: ([a]) => (Number.isInteger(a) ? -a - 1 : NaN),
    },
  ],
  [
    "shl",
    {
      label: "<<",
      min: 2,
      max: 2,
      apply: ([a, n]) => {
        const k = wholeNumber(n);
        if (k < 0n || k > BigInt(MAX_SHIFT)) fail("Shift by 0 to 4096");
        return rational(wholeNumber(a) << k);
      },
      float: ([a, n]) => (Number.isInteger(a) && Number.isInteger(n) && n >= 0 ? a * 2 ** n : NaN),
    },
  ],
  [
    "shr",
    {
      label: ">>",
      min: 2,
      max: 2,
      apply: ([a, n]) => {
        const k = wholeNumber(n);
        if (k < 0n || k > BigInt(MAX_SHIFT)) fail("Shift by 0 to 4096");
        return rational(wholeNumber(a) >> k);
      },
      float: ([a, n]) =>
        Number.isInteger(a) && Number.isInteger(n) && n >= 0 ? Math.floor(a / 2 ** n) : NaN,
    },
  ],
];
for (const [name, fn] of MORE_FUNCTIONS) (FUNCTIONS as Map<string, CalcFunction>).set(name, fn);

/** The calculus functions take an expression in a variable, so they see their first argument unevaluated. */
const CALCULUS: Readonly<Record<string, { label: string; min: number; max: number }>> = {
  deriv: { label: "d/dx", min: 2, max: 2 },
  integral: { label: "∫", min: 3, max: 3 },
  sum: { label: "Σ", min: 3, max: 4 },
  prod: { label: "Π", min: 3, max: 4 },
  solve: { label: "solve", min: 2, max: 3 },
  lim: { label: "lim", min: 2, max: 2 },
};

const ALIASES: Readonly<Record<string, string>> = {
  arcsin: "asin",
  arccos: "acos",
  arctan: "atan",
  rnd: "round",
  diff: "deriv",
  int: "integral",
  product: "prod",
  arcsinh: "asinh",
  arccosh: "acosh",
  arctanh: "atanh",
};

/** The variable of graphs and of d/dx, ∫ and solve. */
export const VARIABLE = "x";
/** Most terms Σ adds: exactly up to {@link SUM_EXACT_TERMS}, in floats beyond. */
const SUM_MAX_TERMS = 1_000_000;
const SUM_EXACT_TERMS = 2000;

// --- Tokens -------------------------------------------------------------------

type Token =
  | { kind: "num"; value: CalcValue; text: string }
  | { kind: "name"; name: string }
  | { kind: "op"; op: string };

const OPERATORS = "+-*/^(),!%√=°";
/** Stands for an operand not typed yet, in the natural display (a box). */
export const PLACEHOLDER = "▢";

/** Typographic forms (the keypad's, or a recogniser's) to the ones the tokenizer reads. */
function normalise(source: string): string {
  return source
    .replace(/d\/dx/g, " deriv")
    .replace(/∫/g, " integral")
    .replace(/[Σ∑]/g, " sum")
    .replace(/[Π∏]/g, " prod")
    .replace(/θ/g, " theta ")
    .replace(/∞/g, " inf ")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
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

/** Every name a word can begin with, longest first, for splitting run-together letters (`sinx`, `ax`). */
let knownNames: string[] | null = null;
function namesLongestFirst(): string[] {
  if (!knownNames) {
    knownNames = [
      ...FUNCTIONS.keys(),
      ...Object.keys(CALCULUS),
      ...Object.keys(ALIASES),
      ...LETTER_CONSTANTS,
    ].sort((a, b) => b.length - a.length);
  }
  return knownNames;
}

/** Constants a graph's letters may spell, besides single letters. */
const LETTER_CONSTANTS = ["pi", "theta", "inf"];

/**
 * A run of letters as names, Desmos-style: a known function or constant
 * where one starts, single letters (each a variable, multiplied) elsewhere.
 * So `ax` is a·x and `sinx` is sin x.
 */
function splitLetters(word: string): string[] {
  const out: string[] = [];
  let rest = word.toLowerCase();
  while (rest.length > 0) {
    const name = namesLongestFirst().find((n) => n.length > 1 && rest.startsWith(n));
    if (name) {
      out.push(name);
      rest = rest.slice(name.length);
    } else {
      out.push(rest[0]);
      rest = rest.slice(1);
    }
  }
  return out;
}

function tokenize(source: string, base: NumberBase, letters = false): Token[] {
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
    if (c === PLACEHOLDER) {
      tokens.push({ kind: "name", name: PLACEHOLDER });
      i++;
      continue;
    }
    if (base === 10 && (isDigit(c) || (c === "." && isDigit(s[i + 1])))) {
      if (c === "0" && /[xbo]/.test(s[i + 1] ?? "") && isHexDigit(s[i + 2])) {
        const radix = s[i + 1] === "x" ? 16 : s[i + 1] === "b" ? 2 : 8;
        const start = i;
        i += 2;
        const value = baseLiteral(readWhile(isHexDigit), radix);
        tokens.push({ kind: "num", value, text: s.slice(start, i) });
        continue;
      }
      const start = i;
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
      tokens.push({ kind: "num", value: decimalLiteral(int, frac, exp), text: s.slice(start, i) });
      continue;
    }
    if (base !== 10 && isDigit(c)) {
      const digits = readWhile(base === 16 ? isHexDigit : isDigit);
      tokens.push({ kind: "num", value: baseLiteral(digits, base), text: digits.toUpperCase() });
      continue;
    }
    if (isLetter(c)) {
      const word = readWhile(isLetter);
      if (base === 16 && /^[0-9A-Fa-f]+$/.test(word)) {
        tokens.push({ kind: "num", value: baseLiteral(word, 16), text: word.toUpperCase() });
      } else if (letters) {
        for (const name of splitLetters(word)) tokens.push({ kind: "name", name });
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
    if (c === "<" || c === ">") {
      const op = s[i + 1] === "=" ? `${c}=` : c;
      tokens.push({ kind: "op", op });
      i += op.length;
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

// --- Syntax tree --------------------------------------------------------------

/** A parsed expression, evaluated as many times as needed (graphs, calculus). */
export type CalcNode =
  | { k: "num"; v: CalcValue; text?: string }
  | { k: "name"; name: string }
  | { k: "neg"; a: CalcNode }
  | {
      k: "bin";
      op: "+" | "-" | "*" | "/" | "^" | "mod";
      a: CalcNode;
      b: CalcNode;
      implicit?: true;
    }
  | { k: "post"; op: "!" | "%" | "°"; a: CalcNode }
  /** An equation or inequality: only inside solve's first input, or at the top of a graph's line. */
  | { k: "rel"; op: Relation; a: CalcNode; b: CalcNode }
  | { k: "call"; fn: string; args: CalcNode[]; bracketed: boolean };

export type Relation = "=" | "<" | ">" | "<=" | ">=";
const RELATIONS: readonly string[] = ["=", "<", ">", "<=", ">="];

class Parser {
  private i = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    /** A relation (=, <, …) is allowed at the top: a graph's line. */
    private readonly relations = false,
  ) {}

  parse(): CalcNode {
    if (this.tokens.length === 0) fail("Nothing to calculate");
    const node = this.relations ? this.relation() : this.expression();
    const left = this.tokens[this.i];
    if (left) fail(left.kind === "op" && left.op === ")" ? "Missing bracket" : "Syntax error");
    return node;
  }

  private peekOp(): string | null {
    const t = this.tokens[this.i];
    return t?.kind === "op" ? t.op : null;
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) fail("Too complex");
  }

  /** `a = b`, `a < b`, or a plain expression. */
  private relation(): CalcNode {
    const a = this.expression();
    const op = this.peekOp();
    if (op === null || !RELATIONS.includes(op)) return a;
    this.i++;
    return { k: "rel", op: op as Relation, a, b: this.expression() };
  }

  /** The name `mod` used between two operands (17 mod 5), not as mod(a, b). */
  private atInfixMod(): boolean {
    const t = this.tokens[this.i];
    return t?.kind === "name" && t.name === "mod";
  }

  private expression(): CalcNode {
    this.enter();
    let node = this.term();
    for (let op = this.peekOp(); op === "+" || op === "-"; op = this.peekOp()) {
      this.i++;
      node = { k: "bin", op, a: node, b: this.term() };
    }
    this.depth--;
    return node;
  }

  /** Whether the next token can start an operand, for implicit multiplication. */
  private startsOperand(): boolean {
    const t = this.tokens[this.i];
    if (!t) return false;
    return t.kind !== "op" || t.op === "(" || t.op === "√";
  }

  private term(): CalcNode {
    let node = this.unary();
    for (;;) {
      const op = this.peekOp();
      if (op === "*" || op === "/") {
        this.i++;
        node = { k: "bin", op, a: node, b: this.unary() };
      } else if (this.atInfixMod()) {
        // Same precedence as × and ÷, as math.js has it: 2 + 17 mod 5 × 2 = 2 + ((17 mod 5) × 2).
        this.i++;
        node = { k: "bin", op: "mod", a: node, b: this.unary() };
      } else if (this.startsOperand()) {
        node = { k: "bin", op: "*", a: node, b: this.power(), implicit: true };
      } else {
        return node;
      }
    }
  }

  private unary(): CalcNode {
    const op = this.peekOp();
    if (op === "-" || op === "+") {
      this.i++;
      this.enter();
      const a = this.unary();
      this.depth--;
      return op === "-" ? { k: "neg", a } : a;
    }
    return this.power();
  }

  private power(): CalcNode {
    const base = this.postfix();
    if (this.peekOp() !== "^") return base;
    this.i++;
    this.enter();
    const exponent = this.unary();
    this.depth--;
    return { k: "bin", op: "^", a: base, b: exponent };
  }

  private postfix(): CalcNode {
    let node = this.primary();
    for (let op = this.peekOp(); op === "!" || op === "%" || op === "°"; op = this.peekOp()) {
      this.i++;
      node = { k: "post", op, a: node };
    }
    return node;
  }

  /** `)` closes; the end of the input closes too (brackets left open are forgiven). */
  private close(): void {
    if (this.peekOp() === ")") this.i++;
    else if (this.i < this.tokens.length) fail("Syntax error");
  }

  private primary(): CalcNode {
    const t = this.tokens[this.i];
    if (!t) fail("Syntax error");
    this.i++;
    if (t.kind === "num") return { k: "num", v: t.value, text: t.text };
    if (t.kind === "op") {
      if (t.op === "(") {
        const node = this.expression();
        this.close();
        // A bracket the user wrote is kept, for the natural display.
        return { k: "call", fn: "(", args: [node], bracketed: true };
      }
      if (t.op === "√") return { k: "call", fn: "sqrt", args: [this.unary()], bracketed: false };
      const after = this.tokens[this.i - 2];
      const empty = after?.kind === "op" && after.op === "(";
      fail(t.op === ")" && !empty ? "Missing bracket" : "Syntax error");
    }
    const name = ALIASES[t.name] ?? t.name;
    const fn = FUNCTIONS.get(name);
    const calculus = Object.prototype.hasOwnProperty.call(CALCULUS, name) ? CALCULUS[name] : null;
    if (!fn && !calculus) return { k: "name", name };
    const args: CalcNode[] = [];
    let bracketed = false;
    if (this.peekOp() === "(") {
      bracketed = true;
      this.i++;
      if (this.peekOp() !== ")") {
        args.push(name === "solve" ? this.relation() : this.expression());
        while (this.peekOp() === ",") {
          this.i++;
          args.push(this.expression());
        }
      }
      this.close();
    } else {
      args.push(this.unary());
    }
    const spec = fn ?? calculus!;
    if (args.length < spec.min || args.length > spec.max) {
      const count = spec.min === spec.max ? `${spec.min}` : `${spec.min} or ${spec.max}`;
      fail(`${spec.label} takes ${count} input${spec.max === 1 ? "" : "s"}`);
    }
    if (name === "solve" && args[0].k === "rel" && args[0].op !== "=")
      fail("solve needs an equation");
    for (const arg of args.slice(1)) if (arg.k === "rel") fail("Syntax error");
    return { k: "call", fn: name, args, bracketed };
  }
}

/** Parse `expression` into a tree; null with the error when it is not one. */
export function parseExpression(
  expression: string,
  base: NumberBase = 10,
  options: { letters?: boolean; relations?: boolean } = {},
): { ok: true; node: CalcNode } | { ok: false; error: string } {
  try {
    if (expression.length > MAX_LENGTH) fail("Too long");
    const tokens = tokenize(expression, base, options.letters === true);
    return { ok: true, node: new Parser(tokens, options.relations === true).parse() };
  } catch (error) {
    if (error instanceof CalcError) return { ok: false, error: error.message };
    if (error instanceof RangeError) return { ok: false, error: "Too large" };
    throw error;
  }
}

// --- Exact evaluation ---------------------------------------------------------

interface Env {
  angle: AngleMode;
  ans: CalcValue;
  memory: CalcValue;
  /** Bound variables (x inside d/dx, Σ's index). */
  vars: ReadonlyMap<string, CalcValue>;
}

function evalExact(node: CalcNode, env: Env): CalcValue {
  switch (node.k) {
    case "num":
      return node.v;
    case "name":
      return lookup(node.name, env);
    case "neg":
      return negate(evalExact(node.a, env));
    case "post": {
      const a = evalExact(node.a, env);
      if (node.op === "°") return env.angle === "deg" ? a : multiply(a, Math.PI / 180);
      return node.op === "!" ? factorial(a) : divide(a, rational(100n));
    }
    case "rel":
      return fail("Syntax error");
    case "bin": {
      const a = evalExact(node.a, env);
      const b = evalExact(node.b, env);
      switch (node.op) {
        case "mod":
          return modulo(a, b);
        case "+":
          return add(a, b);
        case "-":
          return subtract(a, b);
        case "*":
          return multiply(a, b);
        case "/":
          return divide(a, b);
        default:
          return power(a, b);
      }
    }
    case "call": {
      if (node.fn === "(") return evalExact(node.args[0], env);
      const fn = FUNCTIONS.get(node.fn);
      if (fn)
        return fn.apply(
          node.args.map((arg) => evalExact(arg, env)),
          env.angle,
        );
      return calculus(node.fn, node.args, env);
    }
  }
}

function lookup(name: string, env: Env): CalcValue {
  const bound = env.vars.get(name);
  if (bound !== undefined) return bound;
  switch (name) {
    case "pi":
      return Math.PI;
    case "e":
      return Math.E;
    case "inf":
      return fail("∞ only as a limit's target");
    case "ans":
      return env.ans;
    case "m":
      return env.memory;
    case PLACEHOLDER:
      return fail("Syntax error");
  }
  return fail(`Unknown name: ${name}`);
}

/** `node` as a real function of `variable`, every other name taken from `env`. */
function realFunction(node: CalcNode, env: Env, variable: string): (x: number) => number {
  const unknown = unknownName(node, new Set([...env.vars.keys(), variable]));
  if (unknown !== null) fail(`Unknown name: ${unknown}`);
  const vars = new Map<string, number>();
  for (const [name, value] of env.vars) vars.set(name, toFloat(value));
  const compiled = compileNode(node, {
    angle: env.angle,
    ans: toFloat(env.ans),
    memory: toFloat(env.memory),
  });
  return (x) => {
    vars.set(variable, x);
    return compiled(vars);
  };
}

function numeric(result: { ok: true; value: number } | { ok: false; error: string }): CalcValue {
  if (!result.ok) fail(result.error);
  return exactIfWhole(finite(result.value));
}

/** An equation `a = b` as `a − b`, whose zero is its solution. */
function difference(node: CalcNode): CalcNode {
  return node.k === "rel" ? { k: "bin", op: "-", a: node.a, b: node.b } : node;
}

function calculus(name: string, args: CalcNode[], env: Env): CalcValue {
  const value = (node: CalcNode): number => toFloat(evalExact(node, env));
  switch (name) {
    case "lim": {
      const target = args[1];
      const to =
        target.k === "name" && target.name === "inf"
          ? Infinity
          : target.k === "neg" && target.a.k === "name" && target.a.name === "inf"
            ? -Infinity
            : value(target);
      return numeric(limit(realFunction(args[0], env, VARIABLE), to));
    }
    case "deriv":
      return numeric(derivative(realFunction(args[0], env, VARIABLE), value(args[1])));
    case "integral":
      return numeric(
        integrate(realFunction(args[0], env, VARIABLE), value(args[1]), value(args[2])),
      );
    case "solve": {
      const f = realFunction(difference(args[0]), env, VARIABLE);
      return numeric(
        args.length === 2
          ? solveNear(f, value(args[1]))
          : solveIn(f, value(args[1]), value(args[2])),
      );
    }
    default:
      return sumOver(args, env, name === "prod");
  }
}

/** Σ(expr, i, a, b) or Σ(expr, a, b) in x (Π likewise): exact over a short range, floats over a long one. */
function sumOver(args: CalcNode[], env: Env, product = false): CalcValue {
  const sym = product ? "Π" : "Σ";
  let variable = VARIABLE;
  let bounds = args.slice(1);
  if (args.length === 4) {
    const index = args[1];
    if (index.k !== "name" || index.name === PLACEHOLDER)
      fail(`${sym} needs a letter to count with`);
    variable = index.name;
    bounds = args.slice(2);
  }
  const from = exactIfWhole(evalExact(bounds[0], env));
  const to = exactIfWhole(evalExact(bounds[1], env));
  if (!isInteger(from) || !isInteger(to)) fail(`${sym} counts in whole numbers`);
  if (to.n < from.n) return product ? ONE : ZERO;
  const terms = to.n - from.n + 1n;
  if (terms > BigInt(SUM_MAX_TERMS)) fail("Too many terms");
  if (terms <= BigInt(SUM_EXACT_TERMS)) {
    let total: CalcValue = product ? ONE : ZERO;
    const vars = new Map(env.vars);
    const inner: Env = { ...env, vars };
    for (let i = from.n; i <= to.n; i++) {
      vars.set(variable, rational(i));
      const term = evalExact(args[0], inner);
      total = product ? multiply(total, term) : add(total, term);
    }
    return total;
  }
  const f = realFunction(args[0], env, variable);
  if (product) {
    let total = 1;
    for (let i = Number(from.n); i <= Number(to.n); i++) total *= f(i);
    return finite(total);
  }
  let total = 0;
  let carry = 0;
  for (let i = Number(from.n); i <= Number(to.n); i++) {
    // Kahan summation: a million small terms keep their digits.
    const y = f(i) - carry;
    const t = total + y;
    carry = t - total - y;
    total = t;
  }
  return finite(total);
}

// --- Float evaluation (graphs, calculus) -------------------------------------

interface FloatEnv {
  angle: AngleMode;
  ans: number;
  memory: number;
}

type Compiled = (vars: Map<string, number>) => number;

/** `node` as a fast float function of the bound variables: NaN where it is undefined. */
function compileNode(node: CalcNode, env: FloatEnv): Compiled {
  switch (node.k) {
    case "num": {
      const v = toFloat(node.v);
      return () => v;
    }
    case "name": {
      const { name } = node;
      const constant =
        name === "pi"
          ? Math.PI
          : name === "e"
            ? Math.E
            : name === "inf"
              ? Infinity
              : name === "ans"
                ? env.ans
                : name === "m"
                  ? env.memory
                  : undefined;
      return (vars) => vars.get(name) ?? constant ?? NaN;
    }
    case "neg": {
      const a = compileNode(node.a, env);
      return (vars) => -a(vars);
    }
    case "post": {
      const a = compileNode(node.a, env);
      if (node.op === "°") return env.angle === "deg" ? a : (vars) => (a(vars) * Math.PI) / 180;
      return node.op === "!" ? (vars) => floatFactorial(a(vars)) : (vars) => a(vars) / 100;
    }
    case "rel": {
      // A relation as a number: its difference (an equation's zero is its curve).
      const a = compileNode(node.a, env);
      const b = compileNode(node.b, env);
      return (vars) => a(vars) - b(vars);
    }
    case "bin": {
      const a = compileNode(node.a, env);
      const b = compileNode(node.b, env);
      switch (node.op) {
        case "+":
          return (vars) => a(vars) + b(vars);
        case "-":
          return (vars) => a(vars) - b(vars);
        case "*":
          return (vars) => a(vars) * b(vars);
        case "/":
          return (vars) => a(vars) / b(vars);
        case "mod":
          return (vars) => {
            const x = a(vars);
            const y = b(vars);
            return y === 0 ? NaN : x - y * Math.floor(x / y);
          };
        default:
          return (vars) => floatPower(a(vars), b(vars));
      }
    }
    case "call": {
      if (node.fn === "(") return compileNode(node.args[0], env);
      const args = node.args.map((arg) => compileNode(arg, env));
      const fn = FUNCTIONS.get(node.fn);
      if (fn)
        return (vars) =>
          fn.float(
            args.map((arg) => arg(vars)),
            env.angle,
          );
      return compileCalculus(node, args);
    }
  }
}

function compileCalculus(node: Extract<CalcNode, { k: "call" }>, args: Compiled[]): Compiled {
  const inner = args[0];
  const bind =
    (vars: Map<string, number>, variable: string) =>
    (x: number): number => {
      const scoped = new Map(vars);
      scoped.set(variable, x);
      return inner(scoped);
    };
  const value = (r: { ok: true; value: number } | { ok: false; error: string }): number =>
    r.ok ? r.value : NaN;
  switch (node.fn) {
    case "deriv":
      return (vars) => value(derivative(bind(vars, VARIABLE), args[1](vars)));
    case "integral":
      return (vars) => value(integrate(bind(vars, VARIABLE), args[1](vars), args[2](vars)));
    case "solve":
      return (vars) =>
        value(
          args.length === 2
            ? solveNear(bind(vars, VARIABLE), args[1](vars))
            : solveIn(bind(vars, VARIABLE), args[1](vars), args[2](vars)),
        );
    case "lim":
      return (vars) => value(limit(bind(vars, VARIABLE), args[1](vars)));
    default: {
      const index = node.args[1];
      const variable = node.args.length === 4 && index.k === "name" ? index.name : VARIABLE;
      const [from, to] = node.args.length === 4 ? [args[2], args[3]] : [args[1], args[2]];
      return (vars) => {
        const a = from(vars);
        const b = to(vars);
        if (!Number.isInteger(a) || !Number.isInteger(b) || b - a > SUM_MAX_TERMS) return NaN;
        const f = bind(vars, variable);
        const product = node.fn === "prod";
        let total = product ? 1 : 0;
        for (let i = a; i <= b; i++) total = product ? total * f(i) : total + f(i);
        return total;
      };
    }
  }
}

/**
 * `expression` as a real function of x, for a graph: "y = …" and "f(x) = …"
 * are read as the right-hand side. The function returns NaN where it is
 * undefined; it never throws.
 */
export function compileFunction(
  expression: string,
  ctx: { angle?: AngleMode; ans?: CalcValue; memory?: CalcValue } = {},
): { ok: true; fn: (x: number) => number } | { ok: false; error: string } {
  const rhs = expression.replace(/^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=/i, "");
  const parsed = parseExpression(rhs);
  if (!parsed.ok) return parsed;
  const compiled = compileNode(parsed.node, {
    angle: ctx.angle ?? "rad",
    ans: toFloat(ctx.ans ?? ZERO),
    memory: toFloat(ctx.memory ?? ZERO),
  });
  const vars = new Map<string, number>();
  const fn = (x: number): number => {
    vars.set(VARIABLE, x);
    return compiled(vars);
  };
  // An unknown name surfaces now, not as a blank graph.
  const unknown = unknownName(parsed.node);
  if (unknown !== null) return { ok: false, error: `Unknown name: ${unknown}` };
  return { ok: true, fn };
}

/** A name in `node` that nothing defines (a bound index of Σ counts as defined inside it). */
function unknownName(
  node: CalcNode,
  bound: ReadonlySet<string> = new Set([VARIABLE]),
): string | null {
  switch (node.k) {
    case "num":
      return null;
    case "name":
      return bound.has(node.name) || ["pi", "e", "ans", "m", "inf"].includes(node.name)
        ? null
        : node.name;
    case "neg":
    case "post":
      return unknownName(node.a, bound);
    case "bin":
    case "rel":
      return unknownName(node.a, bound) ?? unknownName(node.b, bound);
    case "call": {
      if (
        (node.fn === "sum" || node.fn === "prod") &&
        node.args.length === 4 &&
        node.args[1].k === "name"
      ) {
        const inner = new Set(bound).add(node.args[1].name);
        return (
          unknownName(node.args[0], inner) ??
          unknownName(node.args[2], bound) ??
          unknownName(node.args[3], bound)
        );
      }
      for (const arg of node.args) {
        const found = unknownName(arg, bound);
        if (found !== null) return found;
      }
      return null;
    }
  }
}

/** Whether `expression` reads x outside a calculus function's own use of it: something to plot. */
export function usesVariable(expression: string): boolean {
  const parsed = parseExpression(expression);
  if (!parsed.ok) return false;
  const free = (node: CalcNode): boolean => {
    switch (node.k) {
      case "num":
        return false;
      case "name":
        return node.name === VARIABLE;
      case "neg":
      case "post":
        return free(node.a);
      case "bin":
      case "rel":
        return free(node.a) || free(node.b);
      case "call":
        if (Object.prototype.hasOwnProperty.call(CALCULUS, node.fn)) {
          return node.args.slice(1).some(free);
        }
        return node.args.some(free);
    }
  };
  return free(parsed.node);
}

/**
 * Calculate `expression`. Never throws for bad input: every failure comes
 * back as `{ ok: false, error }` with a short message for the display.
 */
export function evaluate(expression: string, ctx: EvalContext = {}): EvalResult {
  const parsed = parseExpression(expression, ctx.base ?? 10);
  if (!parsed.ok) return parsed;
  try {
    let value = evalExact(parsed.node, {
      angle: ctx.angle ?? "deg",
      ans: ctx.ans ?? ZERO,
      memory: ctx.memory ?? ZERO,
      vars: new Map(),
    });
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
