/**
 * The few numpy routines the recogniser's Python reference
 * (research/handwriting-rig/htr.py) uses, with numpy's own arithmetic order,
 * so features computed here match the reference to the last bit in nearly
 * every case. Measured against numpy 2.5 (port notes, PORT.md):
 * `np.sum` is a pairwise sum started at 0, `np.linspace` multiplies the
 * index by one step, `np.percentile` interpolates at `(n - 1) * q`.
 *
 * PURE: no DOM, no Obsidian.
 */

/** numpy's pairwise summation of `n` values from `start` (blocks of 128, 8 lanes). */
function pairwise(a: ArrayLike<number>, start: number, n: number): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += a[start + i];
    return res;
  }
  if (n <= 128) {
    let r0 = a[start],
      r1 = a[start + 1],
      r2 = a[start + 2],
      r3 = a[start + 3],
      r4 = a[start + 4],
      r5 = a[start + 5],
      r6 = a[start + 6],
      r7 = a[start + 7];
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      const o = start + i;
      r0 += a[o];
      r1 += a[o + 1];
      r2 += a[o + 2];
      r3 += a[o + 3];
      r4 += a[o + 4];
      r5 += a[o + 5];
      r6 += a[o + 6];
      r7 += a[o + 7];
    }
    let res = r0 + r1 + (r2 + r3) + (r4 + r5 + (r6 + r7));
    for (; i < n; i++) res += a[start + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwise(a, start, n2) + pairwise(a, start + n2, n - n2);
}

/** `np.sum` of float64 values. */
export function npSum(a: ArrayLike<number>): number {
  return 0 + pairwise(a, 0, a.length);
}

/** `np.mean` of float64 values (NaN when empty, as numpy). */
export function npMean(a: ArrayLike<number>): number {
  return npSum(a) / a.length;
}

/** `np.linspace(start, stop, n)`: the index times one step, and `stop` exactly last. */
export function linspace(start: number, stop: number, n: number): Float64Array {
  const out = new Float64Array(n);
  if (n === 1) {
    out[0] = start;
    return out;
  }
  const step = (stop - start) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = i * step + start;
  if (n > 1) out[n - 1] = stop;
  return out;
}

/**
 * `np.interp(x, xp, fp)` for ascending `x` and non-decreasing `xp`: the last
 * `xp[j] <= x` anchors each value, ends hold the end values, and an exact hit
 * takes `fp[j]` (numpy's branches, in its order).
 */
export function interp(
  x: ArrayLike<number>,
  xp: ArrayLike<number>,
  fp: ArrayLike<number>,
): Float64Array {
  const n = xp.length;
  const out = new Float64Array(x.length);
  if (n === 1) {
    for (let i = 0; i < x.length; i++) out[i] = fp[0];
    return out;
  }
  let j = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (v < xp[0]) {
      out[i] = fp[0];
      continue;
    }
    if (v > xp[n - 1]) {
      out[i] = fp[n - 1];
      continue;
    }
    // x is ascending, so the anchor only moves forward; but a caller may pass
    // any order, so step back when it must.
    while (j > 0 && xp[j] > v) j--;
    while (j + 1 < n && xp[j + 1] <= v) j++;
    if (j === n - 1 || xp[j] === v) {
      out[i] = fp[j];
      continue;
    }
    const slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
    out[i] = slope * (v - xp[j]) + fp[j];
  }
  return out;
}

/** Ascending copy of `a`. */
export function sorted(a: ArrayLike<number>): Float64Array {
  return Float64Array.from(a).sort();
}

/** `np.percentile(a, q)` with the default "linear" method, on already sorted values. */
export function percentileSorted(s: ArrayLike<number>, q: number): number {
  const n = s.length;
  const v = (n - 1) * (q / 100);
  if (v >= n - 1) return s[n - 1];
  const lo = Math.floor(v);
  const gamma = v - lo;
  const a = s[lo];
  const b = s[lo + 1];
  const diff = b - a;
  return gamma >= 0.5 ? b - diff * (1 - gamma) : a + diff * gamma;
}

/** `np.median`. */
export function median(a: ArrayLike<number>): number {
  const s = sorted(a);
  const n = s.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Least-squares line `y = a·x + b` (what `np.polyfit(x, y, 1)` returns, to
 * rounding: numpy solves it by SVD). Centred, so large page coordinates do
 * not cost precision.
 */
export function fitLine(x: ArrayLike<number>, y: ArrayLike<number>): [number, number] {
  const mx = npMean(x);
  const my = npMean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx;
    sxx += dx * dx;
    sxy += dx * (y[i] - my);
  }
  const a = sxy / sxx;
  return [a, my - a * mx];
}
