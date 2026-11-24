/**
 * Curve rows for the handwriting writer (Neaten): what the model is shown of
 * a writer's lines, and what its written rows become as ink.
 *
 * A row is one cubic curve in Grape 2's "raw" encoding (`hwr/curves.ts`):
 * end displacement (2), first arm (2), second arm (2), three time values and
 * pen-up, in normalised units (the core, x-height, is 0.4) with y up. The
 * writer reads and writes the same rows.
 *
 * Ports of research/handwriting-rig/gen: `inkflow.runs_of`, `longrun.calm`,
 * `inkdual.reference_sep`, `author_tests.pick_old`, `curve_lib._share_blanks`
 * and `curve_strokes`, `inkdual.words_of` and `geo_model_test.word_strokes`
 * ("level"). The research's numbers (6 reference lines, 144 curves, a jump
 * held to 6 units) come from the model's file (`writer-meta.ts`).
 *
 * PURE: no DOM, no Obsidian.
 */

/** Values per row. */
export const ROW = 10;
/** The pen-up value's place in a row. */
const UP = 9;

/** A line's rows (`n × ROW`, row-major). */
export interface Rows {
  x: Float32Array;
  n: number;
}

/** A writer's line: its text, its rows, and the character of its text each row belongs to. */
export interface TaggedLine extends Rows {
  text: string;
  char: Int32Array;
}

/** What the model is shown: rows, each row's character id, place in its character, that character's length, and separators. */
export interface Reference extends Rows {
  cid: Int32Array;
  k: Int32Array;
  d: Int32Array;
  sep: Uint8Array;
}

/** Whether row `i` lifts the pen. */
export function isUp(x: Float32Array, i: number): boolean {
  return x[i * ROW + UP] > 0.5;
}

/**
 * For a non-decreasing character index per row: each row's place in its
 * character (`k`) and that character's number of rows (`d`).
 */
export function runsOf(char: ArrayLike<number>): { k: Int32Array; d: Int32Array } {
  const n = char.length;
  const k = new Int32Array(n);
  const d = new Int32Array(n);
  let a = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || char[i] !== char[a]) {
      for (let j = a; j < i; j++) {
        k[j] = j - a;
        d[j] = i - a;
      }
      a = i;
    }
  }
  return { k, d };
}

/**
 * A CTC alignment's label position per frame (-1 for a blank, as
 * `lexicon.forceAlign` gives it) to a character per row: a run of blanks
 * goes to its neighbours, the first half to the left one.
 */
export function shareBlanks(pos: ArrayLike<number>): Int32Array {
  const char = Int32Array.from(pos);
  const T = char.length;
  let t = 0;
  while (t < T) {
    if (char[t] >= 0) {
      t++;
      continue;
    }
    let e = t;
    while (e < T && char[e] < 0) e++;
    const left = t > 0 ? char[t - 1] : null;
    const right = e < T ? char[e] : null;
    if (left === null && right !== null) char.fill(right, t, e);
    else if (right === null && left !== null) char.fill(left, t, e);
    else if (left !== null && right !== null) {
      const mid = t + Math.floor((e - t + 1) / 2);
      char.fill(left, t, mid);
      char.fill(right, mid, e);
    }
    t = e;
  }
  return char;
}

/**
 * The rows with every pen-up move no longer than `limit` units, its
 * direction kept (a long jump in a reference line, such as a move to the
 * margin, unsettles the model). The same object when nothing is over.
 */
export function calm<R extends Rows>(r: R, limit: number): R {
  if (limit <= 0) return r;
  let over = false;
  for (let i = 0; i < r.n; i++) {
    if (isUp(r.x, i) && Math.hypot(r.x[i * ROW], r.x[i * ROW + 1]) > limit) over = true;
  }
  if (!over) return r;
  const x = Float32Array.from(r.x);
  for (let i = 0; i < r.n; i++) {
    if (!isUp(x, i)) continue;
    const o = i * ROW;
    const len = Math.hypot(x[o], x[o + 1]);
    const f = Math.min(limit / Math.max(len, 1e-6), 1);
    const dx = x[o] * f;
    const dy = x[o + 1] * f;
    // A pen-up row is a straight move: arms at a third (`curvesFromFeatures`).
    x[o] = dx;
    x[o + 1] = dy;
    x[o + 2] = dx / 3;
    x[o + 3] = dy / 3;
    x[o + 4] = -dx / 3;
    x[o + 5] = -dy / 3;
  }
  return { ...r, x };
}

/**
 * The lines that share most letters (case ignored) with `text`, best
 * first, at most `count`; ties keep the pool's order.
 */
export function pickLines<L extends { text: string }>(
  text: string,
  pool: readonly L[],
  count: number,
): L[] {
  const want = new Set(text.toLowerCase());
  want.delete(" ");
  const score = (line: L): number => {
    let n = 0;
    for (const c of new Set(line.text.toLowerCase())) if (want.has(c)) n++;
    return n;
  };
  return pool
    .map((line, i) => ({ line, i, s: score(line) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, count)
    .map((p) => p.line);
}

/**
 * Lines joined into one reference, a separator row between them, cut at
 * `size` rows. `index` maps a character to the model's id. Null for no lines.
 */
export function referenceOf(
  lines: readonly TaggedLine[],
  size: number,
  index: ReadonlyMap<string, number>,
): Reference | null {
  if (lines.length === 0) return null;
  const x: number[] = [];
  const cid: number[] = [];
  const k: number[] = [];
  const d: number[] = [];
  const sep: number[] = [];
  let total = 0;
  for (let m = 0; m < lines.length; m++) {
    const line = lines[m];
    if (m > 0) {
      const gap = new Array<number>(ROW).fill(0);
      gap[UP] = 1;
      x.push(...gap);
      cid.push(0);
      k.push(0);
      d.push(0);
      sep.push(1);
      total++;
    }
    const runs = runsOf(line.char);
    for (let i = 0; i < line.n; i++) {
      for (let c = 0; c < ROW; c++) x.push(line.x[i * ROW + c]);
      cid.push(index.get(line.text[line.char[i]]) ?? 0);
      k.push(runs.k[i]);
      d.push(runs.d[i]);
      sep.push(0);
    }
    total += line.n;
    if (total >= size) break;
  }
  const n = Math.min(total, size);
  return {
    x: Float32Array.from(x.slice(0, n * ROW)),
    n,
    cid: Int32Array.from(cid.slice(0, n)),
    k: Int32Array.from(k.slice(0, n)),
    d: Int32Array.from(d.slice(0, n)),
    sep: Uint8Array.from(sep.slice(0, n)),
  };
}

/** numpy's median: the mean of the two middle values for an even count. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : 0.5 * (s[h - 1] + s[h]);
}

/** Points along each row's curve, `per` per curve (ends included), y up. */
function curvePoints(
  r: Rows,
  per: number,
): { pts: Float64Array; start: Float64Array; end: Float64Array } {
  const pts = new Float64Array(r.n * per * 2);
  const start = new Float64Array(r.n * 2);
  const end = new Float64Array(r.n * 2);
  let px = 0;
  let py = 0;
  for (let i = 0; i < r.n; i++) {
    const o = i * ROW;
    const ex = px + r.x[o];
    const ey = py + r.x[o + 1];
    const ax = px + r.x[o + 2];
    const ay = py + r.x[o + 3];
    const bx = ex + r.x[o + 4];
    const by = ey + r.x[o + 5];
    start[i * 2] = px;
    start[i * 2 + 1] = py;
    end[i * 2] = ex;
    end[i * 2 + 1] = ey;
    for (let j = 0; j < per; j++) {
      const s = per === 1 ? 0 : j / (per - 1);
      const u = 1 - s;
      const q = (i * per + j) * 2;
      pts[q] = u * u * u * px + 3 * u * u * s * ax + 3 * u * s * s * bx + s * s * s * ex;
      pts[q + 1] = u * u * u * py + 3 * u * u * s * ay + 3 * u * s * s * by + s * s * s * ey;
    }
    px = ex;
    py = ey;
  }
  return { pts, start, end };
}

/** A written stroke: its first and last row, and its x extent by the rows' ends. */
export interface RowStroke {
  a: number;
  e: number;
  lo: number;
  hi: number;
}

/**
 * The line's strokes (runs of pen-down rows) and the word of the text each
 * belongs to: the word most of its rows were written for (rows written for a
 * space do not vote); a stroke with no vote goes to the word whose ink is
 * nearest along the line. -1 when no stroke has a word.
 */
export function wordsOf(
  r: Rows,
  char: ArrayLike<number>,
  text: string,
): { strokes: RowStroke[]; owner: number[] } {
  const { start, end } = curvePoints(r, 1);
  const wordAt: number[] = [];
  let w = 0;
  for (const ch of text) {
    wordAt.push(ch === " " ? -1 : w);
    if (ch === " ") w++;
  }
  const strokes: RowStroke[] = [];
  let t = 0;
  while (t < r.n) {
    if (isUp(r.x, t)) {
      t++;
      continue;
    }
    let e = t;
    while (e + 1 < r.n && !isUp(r.x, e + 1)) e++;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = t; i <= e; i++) {
      lo = Math.min(lo, start[i * 2], end[i * 2]);
      hi = Math.max(hi, start[i * 2], end[i * 2]);
    }
    strokes.push({ a: t, e, lo, hi });
    t = e + 1;
  }
  const owner = strokes.map(({ a, e }) => {
    const votes = new Map<number, number>();
    for (let i = a; i <= e; i++) {
      const v = wordAt[char[i]] ?? -1;
      if (v >= 0) votes.set(v, (votes.get(v) ?? 0) + 1);
    }
    let best = -1;
    let most = 0;
    // bincount().argmax(): the lowest word among the most votes.
    for (const [v, n] of [...votes].sort((p, q) => p[0] - q[0])) {
      if (n > most) {
        best = v;
        most = n;
      }
    }
    return best;
  });
  if (owner.some((o) => o < 0) && owner.some((o) => o >= 0)) {
    const known = owner.map((o, i) => (o >= 0 ? i : -1)).filter((i) => i >= 0);
    owner.forEach((o, i) => {
      if (o >= 0) return;
      const mid = 0.5 * (strokes[i].lo + strokes[i].hi);
      let near = known[0];
      let bestGap = Infinity;
      for (const j of known) {
        const gap = Math.max(strokes[j].lo - mid, mid - strokes[j].hi, 0);
        if (gap < bestGap) {
          bestGap = gap;
          near = j;
        }
      }
      owner[i] = owner[near];
    });
  }
  return { strokes, owner };
}

const DESCENDERS = new Set("gjpqy");

/** Points per curve when a written line becomes ink. */
export const POINTS_PER_CURVE = 8;

/** One written stroke as points (x right, y up, curve units), and its word (-1: none). */
export interface WrittenStroke {
  pts: number[];
  word: number;
}

/**
 * The written line as strokes, each word moved up or down so its letters'
 * feet stand on one straight line through the words. A word's foot is the
 * median bottom of its letters and digits without a descender; a word with
 * none follows the word before it. Without an alignment (`char` null or of
 * another length) the strokes are as written, with no words.
 */
export function levelledStrokes(
  r: Rows,
  char: ArrayLike<number> | null,
  text: string,
): WrittenStroke[] {
  const { pts } = curvePoints(r, POINTS_PER_CURVE);
  const per = POINTS_PER_CURVE;
  const strokeOf = (a: number, e: number, dy: number): number[] => {
    const out: number[] = [];
    for (let i = a; i <= e; i++) {
      // The first point of a curve is the last of the one before it.
      for (let j = i === a ? 0 : 1; j < per; j++) {
        const q = (i * per + j) * 2;
        out.push(pts[q], pts[q + 1] + dy);
      }
    }
    return out;
  };
  const aligned = char !== null && char.length === r.n;
  const { strokes, owner } = aligned
    ? wordsOf(r, char, text)
    : { strokes: plainStrokes(r), owner: [] as number[] };
  if (!aligned || strokes.length === 0) {
    return strokes.map((s) => ({ pts: strokeOf(s.a, s.e, 0), word: -1 }));
  }
  const wordAt: number[] = [];
  let w = 0;
  for (const ch of text) {
    wordAt.push(ch === " " ? -1 : w);
    if (ch === " ") w++;
  }
  const feet = new Map<number, number[]>();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || !/[\p{L}\p{N}]/u.test(ch) || DESCENDERS.has(ch)) continue;
    let low = Infinity;
    for (let row = 0; row < r.n; row++) {
      if (char[row] !== i || isUp(r.x, row)) continue;
      for (let j = 0; j < per; j++) low = Math.min(low, pts[(row * per + j) * 2 + 1]);
    }
    if (low === Infinity) continue;
    const list = feet.get(wordAt[i]) ?? [];
    list.push(low);
    feet.set(wordAt[i], list);
  }
  const ext = new Map<number, [number, number]>();
  strokes.forEach((s, i) => {
    const o = owner[i];
    if (o < 0) return;
    const cur = ext.get(o);
    ext.set(o, cur ? [Math.min(s.lo, cur[0]), Math.max(s.hi, cur[1])] : [s.lo, s.hi]);
  });
  const foot = new Map<number, number>();
  for (const [word, list] of feet) if (ext.has(word)) foot.set(word, median(list));
  const mid = (word: number): number => {
    const e = ext.get(word) as [number, number];
    return 0.5 * (e[0] + e[1]);
  };
  const ws = [...foot.keys()].sort((a, b) => a - b);
  let slope = 0;
  if (ws.length >= 3) {
    const pairs: number[] = [];
    ws.forEach((a, i) => {
      for (const b of ws.slice(i + 1)) {
        if (Math.abs(mid(b) - mid(a)) > 1)
          pairs.push(((foot.get(b) as number) - (foot.get(a) as number)) / (mid(b) - mid(a)));
      }
    });
    slope = pairs.length ? median(pairs) : 0;
  }
  const level = ws.length ? median(ws.map((v) => (foot.get(v) as number) - slope * mid(v))) : 0;
  const dy = new Map<number, number>();
  let last = 0;
  for (const word of [...ext.keys()].sort((a, b) => a - b)) {
    if (foot.has(word)) last = slope * mid(word) + level - (foot.get(word) as number);
    dy.set(word, last);
  }
  return strokes.map((s, i) => ({
    pts: strokeOf(s.a, s.e, dy.get(owner[i]) ?? 0),
    word: owner[i],
  }));
}

function plainStrokes(r: Rows): RowStroke[] {
  const out: RowStroke[] = [];
  let t = 0;
  while (t < r.n) {
    if (isUp(r.x, t)) {
      t++;
      continue;
    }
    let e = t;
    while (e + 1 < r.n && !isUp(r.x, e + 1)) e++;
    out.push({ a: t, e, lo: 0, hi: 0 });
    t = e + 1;
  }
  return out;
}
