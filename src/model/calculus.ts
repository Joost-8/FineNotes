/**
 * Numerical calculus on a real function of one variable. Pure; no library.
 *
 * Each routine either returns a value it can vouch for or says why not, in
 * words for the calculator's display ("Integral does not converge"). A
 * function value that is not finite (a pole, outside the domain) is never
 * passed off as an answer.
 */

export type Real = (x: number) => number;
export type Numeric = { ok: true; value: number } | { ok: false; error: string };

const ok = (value: number): Numeric => ({ ok: true, value });
const no = (error: string): Numeric => ({ ok: false, error });

/** Put a result a rounding error away from a whole number on it. */
function snap(x: number): number {
  const k = Math.round(x);
  return Math.abs(x - k) <= 1e-10 * Math.max(1, Math.abs(x)) ? k : x;
}

// --- Derivative ---------------------------------------------------------------

/**
 * f′(x0) by central differences with two Richardson steps (error O(h⁶)),
 * the step relative to |x0|. Refused where the slopes from either side
 * disagree (a corner, a jump) or a value is not finite.
 */
export function derivative(f: Real, x0: number): Numeric {
  if (!Number.isFinite(x0)) return no("Not a real number");
  const h = 1e-3 * Math.max(1, Math.abs(x0));
  const central = (s: number): number => (f(x0 + s) - f(x0 - s)) / (2 * s);
  const d1 = central(h);
  const d2 = central(h / 2);
  const d3 = central(h / 4);
  const r1 = (4 * d2 - d1) / 3;
  const r2 = (4 * d3 - d2) / 3;
  const r = (16 * r2 - r1) / 15;
  const fx = f(x0);
  if (!Number.isFinite(r) || !Number.isFinite(fx)) return no("Not differentiable here");
  const s = h / 64;
  const left = (fx - f(x0 - s)) / s;
  const right = (f(x0 + s) - fx) / s;
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  if (!(Math.abs(left - right) <= 0.05 * scale)) return no("Not differentiable here");
  return ok(snap(r));
}

// --- Integral -----------------------------------------------------------------

// Gauss–Kronrod 7–15 on [-1, 1] (QUADPACK's qk15): Kronrod nodes, outermost
// first, the last one the centre; the Gauss nodes are the odd ones and the centre.
const XGK = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993945,
  0.5860872354676911, 0.4058451513773972, 0.20778495500789848, 0,
];
const WGK = [
  0.022935322010529224, 0.06309209262997856, 0.10479001032225019, 0.14065325971552592,
  0.1690047266392679, 0.19035057806478542, 0.20443294007529889, 0.20948214108472782,
];
const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694];

interface Piece {
  a: number;
  b: number;
  value: number;
  error: number;
}

/** One G7–K15 step on [a, b]: the Kronrod value and |Kronrod − Gauss| as its error. */
function kronrod(f: Real, a: number, b: number): Piece {
  const c = (a + b) / 2;
  const h = (b - a) / 2;
  const fc = f(c);
  let k = WGK[7] * fc;
  let g = WG[3] * fc;
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j];
    const sum = f(c - dx) + f(c + dx);
    k += WGK[j] * sum;
    if (j % 2 === 1) g += WG[(j - 1) / 2] * sum;
  }
  return { a, b, value: k * h, error: Math.abs((k - g) * h) };
}

const MAX_PIECES = 600;

/**
 * ∫ₐᵇ f by adaptive Gauss–Kronrod: the piece with the largest error estimate
 * is halved until the total error is within tolerance. The end points are
 * never evaluated, so an integrable singularity there (1/√x on [0, 1]) is
 * fine; anything that will not settle is refused, not guessed.
 */
export function integrate(f: Real, a: number, b: number): Numeric {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return no("Limits must be finite");
  if (a === b) return ok(0);
  if (a > b) {
    const flipped = integrate(f, b, a);
    return flipped.ok ? ok(-flipped.value) : flipped;
  }
  const pieces = [kronrod(f, a, b)];
  for (;;) {
    let value = 0;
    let error = 0;
    let worst = 0;
    for (let i = 0; i < pieces.length; i++) {
      value += pieces[i].value;
      error += pieces[i].error;
      if (pieces[i].error > pieces[worst].error) worst = i;
    }
    if (!Number.isFinite(value) || !Number.isFinite(error)) return no("Integral does not converge");
    if (error <= Math.max(1e-13, 1e-11 * Math.abs(value))) return ok(snap(value));
    if (pieces.length >= MAX_PIECES) {
      return error <= Math.max(1e-9, 1e-8 * Math.abs(value))
        ? ok(value)
        : no("Integral does not converge");
    }
    const { a: lo, b: hi } = pieces[worst];
    const mid = (lo + hi) / 2;
    if (!(mid > lo && mid < hi)) return no("Integral does not converge");
    pieces.splice(worst, 1, kronrod(f, lo, mid), kronrod(f, mid, hi));
  }
}

// --- Roots --------------------------------------------------------------------

/** Brent's method on [a, b] with f(a), f(b) of opposite signs (or one zero). */
function brent(f: Real, a: number, b: number, fa: number, fb: number): number {
  if (fa === 0) return a;
  if (fb === 0) return b;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < 200; i++) {
    if (Math.sign(fb) === Math.sign(fc)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      [a, b, c] = [b, c, b];
      [fa, fb, fc] = [fb, fc, fb];
    }
    const tol = 2 * Number.EPSILON * Math.abs(b) + 1e-300;
    const m = (c - b) / 2;
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const r = fb / fc;
        const t = fa / fc;
        p = s * (2 * m * t * (t - r) - (b - a) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
  }
  return b;
}

/** A sign change that is a root, not a pole: f is small there. */
function confirmed(f: Real, x: number): boolean {
  const y = f(x);
  return Number.isFinite(y) && Math.abs(y) <= 1e-7;
}

/** Newton's method with a numeric slope, for roots where f does not change sign (x² = 0). */
function newton(f: Real, x: number): number | null {
  for (let i = 0; i < 100; i++) {
    const y = f(x);
    if (!Number.isFinite(y)) return null;
    if (y === 0) return x;
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const slope = (f(x + h) - f(x - h)) / (2 * h);
    if (!Number.isFinite(slope) || slope === 0) return null;
    const step = y / slope;
    x -= step;
    if (Math.abs(step) <= 1e-14 * Math.max(1, Math.abs(x))) return confirmed(f, x) ? x : null;
  }
  // Never settled: a small f far out (1/x at 10⁸) is not a root.
  return null;
}

/** A sign change of f between a and b, scanning `steps` pieces left to right. */
function scan(f: Real, a: number, b: number, steps: number): number | null {
  let x0 = a;
  let y0 = f(a);
  for (let i = 1; i <= steps; i++) {
    const x1 = a + ((b - a) * i) / steps;
    const y1 = f(x1);
    if (Number.isFinite(y0) && Number.isFinite(y1) && y0 * y1 <= 0) {
      const r = brent(f, x0, x1, y0, y1);
      if (confirmed(f, r)) return r;
    }
    x0 = x1;
    y0 = y1;
  }
  return null;
}

/**
 * A root of f near `guess`: the nearest sign change found by stepping out
 * from the guess on both sides, refined by Brent's method; failing that,
 * Newton's method from the guess.
 */
export function solveNear(f: Real, guess: number): Numeric {
  if (!Number.isFinite(guess)) return no("Not a real number");
  if (f(guess) === 0) return ok(guess);
  const scale = Math.max(1, Math.abs(guess));
  let step = 0.01 * scale;
  let left = guess;
  let right = guess;
  while (step < 1e8 * scale) {
    const lo = scan(f, left - step, left, 4);
    const hi = scan(f, right, right + step, 4);
    if (lo !== null || hi !== null) {
      const best =
        lo === null
          ? hi!
          : hi === null
            ? lo
            : Math.abs(lo - guess) <= Math.abs(hi - guess)
              ? lo
              : hi;
      return ok(snap(best));
    }
    left -= step;
    right += step;
    step *= 2;
  }
  const r = newton(f, guess);
  return r === null ? no("No root found") : ok(snap(r));
}

/** A root of f in [a, b]: the first sign change, else Newton from the middle if it stays inside. */
export function solveIn(f: Real, a: number, b: number): Numeric {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return no("Limits must be finite");
  if (a > b) [a, b] = [b, a];
  const r = scan(f, a, b, 400) ?? newton(f, (a + b) / 2);
  return r !== null && r >= a && r <= b ? ok(snap(r)) : no("No root found in range");
}
