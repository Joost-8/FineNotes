/**
 * Column sums (discussion #228): a column of handwritten amounts, a line
 * drawn under it, and the total under the line, as in Apple Notes' Math
 * Notes and as amounts are added up by hand in an Austrian or German office.
 *
 * Everything that can be settled by where the ink sits is settled here,
 * before Grape reads anything (the ledger's rule from FineNotes#178):
 *
 * - the line: a long flat stroke with a column of ink right above it and
 *   nothing level with it to its left (an "=" has its sum there). Two such
 *   strokes close together are a double line, the final total; one is a
 *   subtotal.
 * - the rows: the ink above the line, in bands, up to a gap or the top of
 *   the column. An earlier line in the column is kept as a row of its own.
 * - the amount: the ink of a row that lies over the line. The line is as long
 *   as the amounts, not the text, so names and dates to its left
 *   (`12.03.2024`) are never read as amounts.
 * - the sign: a short dash level with the middle of the digits, left of the
 *   amount or as its first mark, makes the row a minus.
 *
 * Grape then reads only each amount's ink, and {@link parseAmount} turns the
 * text into a number in the column's convention (`1.234,50` or `1,234.50`).
 * Money is added in whole cents (no floating point), and a row that does not
 * read as an amount withholds the total: a wrong total is worse than none.
 *
 * PURE: no DOM. Page px throughout.
 */

import { isDash, isSumInk, pathLength } from "./calc-ink";
import { type PieceReading, alignChars } from "./calc-layout";
import { type Bounds, POINT_STRIDE, type Stroke, strokeBounds } from "./document";

/** A single line closes a subtotal, a double line the final total. */
export type RuleKind = "subtotal" | "total";

export interface SumRule {
  kind: RuleKind;
  /** One stroke, or two for a double line (upper first). */
  strokes: Stroke[];
  bounds: Bounds;
}

export interface ColumnRow {
  /** The ink over the line: the amount, read by Grape. Empty for a row of only a name. */
  amount: Stroke[];
  /** A minus left of the amount (or as its first mark), not handed to Grape. */
  sign: 1 | -1;
  /** The sign's stroke, when it has one. */
  signStroke: Stroke | null;
  /** The ink left of the amount: a name, a date, a document number. Never read. */
  label: Stroke[];
  bounds: Bounds;
  /** An earlier line drawn in the column (a subtotal before this one). */
  rule: SumRule | null;
}

export interface Column {
  rule: SumRule;
  /** Top to bottom. */
  rows: ColumnRow[];
  /** The digits' height, from the amounts. */
  digit: number;
}

const width = (b: Bounds): number => b.maxX - b.minX;
const height = (b: Bounds): number => b.maxY - b.minY;
const midY = (b: Bounds): number => (b.minY + b.maxY) / 2;

function union(boxes: readonly Bounds[]): Bounds {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The shortest a rule may be, in page px, before any column is known. */
const MIN_RULE_PX = 24;

/** A long, flat, straight stroke: a candidate line under a column. */
function isRuleStroke(stroke: Stroke, box: Bounds): boolean {
  const w = width(box);
  if (w < MIN_RULE_PX) return false;
  // Flatter than a dash may be: a rule is drawn deliberately, and long.
  return height(box) <= Math.max(0.15 * w, 2) && pathLength(stroke) <= 1.25 * w;
}

/** Whether two rule strokes make a double line: same span, one just under the other. */
function isDoubleRule(a: Bounds, b: Bounds): boolean {
  const wa = width(a);
  const wb = width(b);
  if (Math.max(wa, wb) > 1.6 * Math.min(wa, wb)) return false;
  const overlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  if (overlap < 0.7 * Math.min(wa, wb)) return false;
  const gap = Math.abs(midY(a) - midY(b));
  return gap > 1 && gap <= 0.25 * Math.min(wa, wb) + 4;
}

/**
 * The line the stroke just drawn finished, or null: the last sum-ink stroke
 * is a rule, and with the one before it a double line when they pair up.
 * Whether a column sits above it is {@link columnAbove}'s question.
 */
export function ruleAtEnd(strokes: readonly Stroke[]): SumRule | null {
  const ink = strokes.filter(isSumInk);
  const last = ink[ink.length - 1];
  const lastBox = last && strokeBounds(last);
  if (!last || !lastBox || !isRuleStroke(last, lastBox)) return null;
  const prev = ink[ink.length - 2];
  const prevBox = prev && strokeBounds(prev);
  if (prev && prevBox && isRuleStroke(prev, prevBox) && isDoubleRule(prevBox, lastBox)) {
    const upper = midY(prevBox) <= midY(lastBox);
    return {
      kind: "total",
      strokes: upper ? [prev, last] : [last, prev],
      bounds: union([prevBox, lastBox]),
    };
  }
  return { kind: "subtotal", strokes: [last], bounds: lastBox };
}

interface Item {
  stroke: Stroke;
  box: Bounds;
}

/** A short dash level with the middle of the digits: a minus in the margin. */
function isMinus(item: Item, row: Bounds, digit: number): boolean {
  if (!isDash(item.stroke, item.box)) return false;
  const w = width(item.box);
  if (w < 0.2 * digit || w > 1.2 * digit) return false;
  const y = midY(item.box);
  // Between a quarter and three quarters of the way down the row's digits.
  return y >= row.minY + 0.25 * height(row) && y <= row.maxY - 0.2 * height(row);
}

/** Pieces of a row, left to right, split at gaps wider than `gap`. */
function pieces(items: readonly Item[], gap: number): Item[][] {
  const sorted = [...items].sort((a, b) => a.box.minX - b.box.minX);
  const out: Item[][] = [];
  let right = -Infinity;
  for (const it of sorted) {
    if (out.length === 0 || it.box.minX - right > gap) out.push([]);
    out[out.length - 1].push(it);
    right = Math.max(right, it.box.maxX);
  }
  return out;
}

/**
 * Bands of ink, bottom to top. The tallest strokes make the bands; a smaller
 * one joins the band its middle falls in, or just under (a comma or a full
 * stop below the baseline, a minus, a dot), else it is a band of its own. A
 * line (`isLine`: under the amounts) is always a band of its own, or of two
 * for a double line (an earlier subtotal's line).
 */
function bands(items: readonly Item[], isLine: (it: Item) => boolean): Item[][] {
  const sorted = [...items].sort((a, b) => height(b.box) - height(a.box));
  const out: { items: Item[]; box: Bounds; tall: number; rule: boolean }[] = [];
  for (const it of sorted) {
    const rule = isLine(it);
    const y = midY(it.box);
    const band = rule
      ? out.find((b) => b.rule && b.items.length === 1 && isDoubleRule(b.box, it.box))
      : out.find((b) => {
          if (b.rule) return false;
          const pad = 0.35 * b.tall;
          return y >= b.box.minY - pad && y <= b.box.maxY + pad;
        });
    if (band) {
      band.items.push(it);
      band.box = union([band.box, it.box]);
    } else out.push({ items: [it], box: it.box, tall: height(it.box), rule });
  }
  out.sort((a, b) => b.box.maxY - a.box.maxY);
  return out.map((b) => b.items);
}

/**
 * The column above a line, or null when there is none: at least two rows
 * with ink over the line, and nothing level with the line to its left (an
 * "=" or an underlined word has its text there).
 */
export function columnAbove(strokes: readonly Stroke[], rule: SumRule): Column | null {
  const ruleIds = new Set(rule.strokes.map((s) => s.id));
  const items: Item[] = [];
  for (const stroke of strokes) {
    if (!isSumInk(stroke) || ruleIds.has(stroke.id)) continue;
    const box = strokeBounds(stroke);
    if (box) items.push({ stroke, box });
  }
  const r = rule.bounds;
  const w = width(r);
  const left = r.minX - 0.1 * w;
  const right = r.maxX + 0.1 * w;
  const over = (b: Bounds): boolean => b.maxX > left && b.minX < right;

  // Ink in the column above the line, its digits' height, and the column's reach.
  const above = items.filter((it) => it.box.maxY <= r.maxY + 2 && midY(it.box) < r.minY);
  const inSpan = above.filter((it) => over(it.box) && !isRuleStroke(it.stroke, it.box));
  const digit = median(inSpan.map((it) => height(it.box)).filter((h) => h > 2));
  if (digit <= 0 || w < 1.2 * digit) return null;

  // Nothing level with the line, to its left or through it: then it is an
  // "=" (its sum is there), a strikethrough or a table's rule.
  const level = items.some(
    (it) =>
      it.box.maxX > r.minX - 3.5 * digit &&
      it.box.minX < r.maxX &&
      midY(it.box) > r.minY - 0.5 * digit &&
      midY(it.box) < r.maxY + 0.5 * digit,
  );
  if (level) return null;

  // Rows, bottom up, from the band just above the line, until a gap.
  const near = above.filter((it) => it.box.minX < right && it.box.maxY > r.minY - 40 * digit);
  const rows: ColumnRow[] = [];
  let bottom = r.minY;
  // A line under the amounts, not a t's bar or an underlined name.
  const isLine = (it: Item): boolean =>
    isRuleStroke(it.stroke, it.box) &&
    Math.min(it.box.maxX, r.maxX) - Math.max(it.box.minX, r.minX) >= 0.6 * w;
  for (const band of bands(near, isLine)) {
    const box = union(band.map((it) => it.box));
    if (bottom - box.maxY > 1.6 * digit) break;
    const rowRule = band.length <= 2 ? earlierRule(band, r) : null;
    if (rowRule) {
      rows.push({ amount: [], sign: 1, signStroke: null, label: [], bounds: box, rule: rowRule });
      bottom = box.minY;
      continue;
    }
    const row = rowOf(band, box, left, right, digit);
    // A band with nothing over the line ends the column (a heading, a
    // paragraph); right above the line it means there is no column.
    if (row.amount.length === 0) {
      if (rows.length === 0) return null;
      break;
    }
    rows.push(row);
    bottom = box.minY;
  }
  rows.reverse();
  if (rows.filter((x) => x.amount.length > 0).length < 2) return null;
  return { rule, rows, digit };
}

/** A band that is itself a line under part of the column (an earlier subtotal). */
function earlierRule(band: readonly Item[], r: Bounds): SumRule | null {
  const strokes = band.filter((it) => isRuleStroke(it.stroke, it.box));
  if (strokes.length !== band.length) return null;
  const box = union(strokes.map((it) => it.box));
  const overlap = Math.min(box.maxX, r.maxX) - Math.max(box.minX, r.minX);
  if (overlap < 0.6 * width(r)) return null;
  const double = strokes.length === 2 && isDoubleRule(strokes[0].box, strokes[1].box);
  return {
    kind: double ? "total" : "subtotal",
    strokes: [...strokes].sort((a, b) => midY(a.box) - midY(b.box)).map((it) => it.stroke),
    bounds: box,
  };
}

/** A row's amount (the ink over the line), its sign and its label. */
function rowOf(
  band: readonly Item[],
  box: Bounds,
  left: number,
  right: number,
  digit: number,
): ColumnRow {
  const ps = pieces(band, 0.6 * digit);
  // The amount: the pieces that reach over the line (right-most first).
  const amountPieces = ps.filter((p) => {
    const b = union(p.map((it) => it.box));
    return b.maxX > left && b.minX < right;
  });
  let amount = amountPieces.flat();
  const label = ps.filter((p) => !amountPieces.includes(p)).flat();
  const digitsBox = amount.length > 0 ? union(amount.map((it) => it.box)) : box;
  let sign: 1 | -1 = 1;
  let signStroke: Stroke | null = null;
  // A minus as the amount's first mark.
  const first = [...amount].sort((a, b) => a.box.minX - b.box.minX)[0];
  if (first && amount.length > 1 && isMinus(first, digitsBox, digit)) {
    sign = -1;
    signStroke = first.stroke;
    amount = amount.filter((it) => it !== first);
  } else if (label.length > 0) {
    // A minus just left of the amount, in the margin.
    const nearest = [...label].sort((a, b) => b.box.maxX - a.box.maxX)[0];
    const amountLeft = amount.length > 0 ? Math.min(...amount.map((it) => it.box.minX)) : left;
    if (nearest.box.maxX > amountLeft - 2 * digit && isMinus(nearest, digitsBox, digit)) {
      sign = -1;
      signStroke = nearest.stroke;
    }
  }
  const byOrder = (items: Item[]): Stroke[] => items.map((it) => it.stroke);
  return {
    amount: byOrder(amount),
    sign,
    signStroke,
    label: byOrder(label.filter((it) => it.stroke !== signStroke)),
    bounds: box,
    rule: null,
  };
}

// ---------------------------------------------------------------------------
// Amounts as text

/** How a column writes its amounts: `de` 1.234,50 (Austria, Germany), `en` 1,234.50. */
export type Convention = "de" | "en";

/** An exact amount: `units` hundredths (or `scale` decimals) of one. */
export interface Amount {
  /** The amount times 10^scale, an integer. */
  units: number;
  scale: number;
}

/**
 * Text Grape read for an amount, as a number in `convention`, or null when it
 * is not one (a date, a document number, a word). Accepts thousands
 * separators only in groups of three, a decimal part, and the whole-amount
 * dash `,-` / `,--` / `,–` (de) or `.-` (en). A leading "-" is a minus.
 */
export function parseAmount(text: string, convention: Convention): Amount | null {
  let t = text.replace(/\s+/g, "").replace(/[–—]/g, "-");
  let negative = false;
  if (t.startsWith("-") || t.startsWith("−")) {
    negative = true;
    t = t.slice(1);
  }
  const dec = convention === "de" ? "," : ".";
  const thou = convention === "de" ? "." : ",";
  // The whole-amount dash: "120,-" "120,--".
  t = t.replace(new RegExp(`\\${dec}-+$`), "");
  const esc = (c: string): string => `\\${c}`;
  const grouped = new RegExp(`^\\d{1,3}(${esc(thou)}\\d{3})+(${esc(dec)}\\d+)?$`);
  const plain = new RegExp(`^\\d+(${esc(dec)}\\d+)?$`);
  if (!grouped.test(t) && !plain.test(t)) return null;
  const [whole, frac = ""] = t.split(dec);
  const digits = whole.split(thou).join("") + frac;
  if (digits.length > 15) return null;
  const units = Number(digits);
  if (!Number.isSafeInteger(units)) return null;
  return { units: negative ? -units : units, scale: frac.length };
}

/**
 * The column's convention, from what its amounts look like: a decimal comma
 * (`,50`, `,-`) or thousands dots say `de`, a decimal point or thousands
 * commas say `en`. Ties and amounts with neither go to `fallback` (the
 * app's language).
 */
export function guessConvention(texts: readonly string[], fallback: Convention): Convention {
  let de = 0;
  let en = 0;
  for (const raw of texts) {
    const t = raw.replace(/\s+/g, "");
    if (/,-+$/.test(t) || /,\d{1,2}$/.test(t) || /\.\d{3},/.test(t)) de++;
    else if (/\.-+$/.test(t) || /\.\d{1,2}$/.test(t) || /,\d{3}\./.test(t)) en++;
  }
  if (de > en) return "de";
  if (en > de) return "en";
  return fallback;
}

/** `a + b`, exactly, at the larger scale. */
export function addAmounts(a: Amount, b: Amount): Amount {
  const scale = Math.max(a.scale, b.scale);
  return {
    units: a.units * 10 ** (scale - a.scale) + b.units * 10 ** (scale - b.scale),
    scale,
  };
}

/**
 * An amount as the column writes it: `de` 1.234,50, `en` 1,234.50, with at
 * least `minScale` decimals (a column of cents keeps its cents: 12,00).
 */
export function formatAmount(amount: Amount, convention: Convention, minScale = 0): string {
  const scale = Math.max(amount.scale, minScale);
  const units = Math.abs(amount.units) * 10 ** (scale - amount.scale);
  const digits = String(units).padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  const thou = convention === "de" ? "." : ",";
  const dec = convention === "de" ? "," : ".";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thou);
  return `${amount.units < 0 ? "-" : ""}${grouped}${scale > 0 ? dec + frac : ""}`;
}

/** What a row was read as, for the card: its text and its value (null: not an amount). */
export interface RowValue {
  text: string;
  value: Amount | null;
}

export interface ColumnTotal {
  /** The total, or null when a row did not read as an amount. */
  total: Amount | null;
  /** The rows the total adds up, by their index in {@link Column.rows}. */
  rows: number[];
  /** Rows over the line that did not read as an amount: the total waits for them. */
  unread: number[];
  /** The decimals the column writes (the most any amount has). */
  scale: number;
}

/**
 * The total a line closes. A single line adds the rows since the line before
 * it; a double line adds every row in the column. A row right under an
 * earlier line that equals that line's total is its written result, and is
 * not added again.
 */
export function columnTotal(column: Column, values: ReadonlyArray<RowValue | null>): ColumnTotal {
  const zero: Amount = { units: 0, scale: 0 };
  const all = { rows: [] as number[], unread: [] as number[], sum: zero };
  let group = { rows: [] as number[], unread: [] as number[], sum: zero };
  /** The total of the line right above the current row, while there is one. */
  let lineAbove: Amount | null = null;
  let scale = 0;
  column.rows.forEach((row, i) => {
    if (row.rule) {
      lineAbove = row.rule.kind === "total" ? all.sum : group.sum;
      group = { rows: [], unread: [], sum: zero };
      return;
    }
    const result = lineAbove;
    lineAbove = null;
    if (row.amount.length === 0) return;
    const v = values[i]?.value ?? null;
    if (!v) {
      all.unread.push(i);
      group.unread.push(i);
      return;
    }
    const signed = { units: row.sign * v.units, scale: v.scale };
    scale = Math.max(scale, v.scale);
    if (result && equal(signed, result)) return; // that line's written result
    for (const g of [all, group]) {
      g.rows.push(i);
      g.sum = addAmounts(g.sum, signed);
    }
  });
  const counted = column.rule.kind === "total" ? all : group;
  return {
    total: counted.unread.length > 0 ? null : counted.sum,
    rows: counted.rows,
    unread: counted.unread,
    scale,
  };
}

function equal(a: Amount, b: Amount): boolean {
  const s = Math.max(a.scale, b.scale);
  return a.units * 10 ** (s - a.scale) === b.units * 10 ** (s - b.scale);
}

// ---------------------------------------------------------------------------
// Digit shapes Grape misses on their own

/**
 * A "1" written as one stroke: a straight stem and at most a short flag at
 * its top, coming from the lower left (the Austrian and German school 1),
 * drawn in either direction. Read alone, Grape takes these for "." or "/"
 * (measured: 28 of 34 lone 1s in Oskar's ink, 30 of 120 in UJI's 60 writers;
 * `research/column-sum-probe.mjs`, `column-sum-digits.mjs`), so a row that
 * Grape read as no digit at all and that is one such stroke is a 1. A 7's
 * top runs flat; a 4 or a 9 has no straight stem from its top.
 * `digit` (the column's digit height) may be null.
 */
export function isUpstrokeOne(strokes: readonly Stroke[], digit: number | null): boolean {
  if (strokes.length !== 1) return false;
  const p = strokes[0].pts;
  const box = strokeBounds(strokes[0]);
  if (!box) return false;
  const h = height(box);
  if (h <= 0 || (digit !== null && h < 0.6 * digit)) return false;
  const n = Math.floor(p.length / POINT_STRIDE);
  if (n < 3) return false;
  const x = (i: number): number => p[i * POINT_STRIDE];
  const y = (i: number): number => p[i * POINT_STRIDE + 1];
  let top = 0;
  for (let i = 1; i < n; i++) if (y(i) < y(top)) top = i;
  // The two arms from the top; the stem is the one that reaches the bottom.
  const firstArm = { from: top, to: 0 };
  const lastArm = { from: top, to: n - 1 };
  const reach = (a: { to: number }): number => y(a.to) - y(top);
  const [stem, flag] =
    reach(firstArm) >= reach(lastArm) ? [firstArm, lastArm] : [lastArm, firstArm];
  if (reach(stem) < 0.75 * h) return false;
  if (!straight(stem.from, stem.to, x, y, 0.12 * h)) return false;
  // Within 30 degrees of upright.
  if (Math.abs(x(stem.to) - x(top)) > 0.58 * reach(stem)) return false;
  // The flag: none, or short and steep, ending left of the top and below it.
  const fx = x(top) - x(flag.to);
  const fy = y(flag.to) - y(top);
  const length = Math.hypot(fx, fy);
  if (length < 0.15 * h) return true;
  return (
    fx > 0 && fy >= 0.45 * fx && length <= 0.8 * h && straight(flag.from, flag.to, x, y, 0.12 * h)
  );
}

/** Whether points `a`..`b` (either order) lie within `tol` of the chord between them. */
function straight(
  a: number,
  b: number,
  x: (i: number) => number,
  y: (i: number) => number,
  tol: number,
): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const dx = x(hi) - x(lo);
  const dy = y(hi) - y(lo);
  const len = Math.hypot(dx, dy);
  if (len === 0) return true;
  for (let i = lo; i <= hi; i++) {
    const d = Math.abs((x(i) - x(lo)) * dy - (y(i) - y(lo)) * dx) / len;
    if (d > tol) return false;
  }
  return true;
}

/**
 * A reading with its commas and full stops settled by the ink (Grape takes a
 * comma for "." or "/" and a full stop for ","): a small mark low in the row
 * is a comma when it hangs below the baseline or is a short downward tick,
 * else a full stop. `ink` is the row's amount, in the order Grape read it
 * (`chars` index it); `digit` the column's digit height. The marks settled
 * are certain: they raise no doubt.
 */
export function marksSettled(
  reading: PieceReading,
  ink: readonly Stroke[],
  digit: number,
): PieceReading {
  const chars = reading.chars;
  if (!chars || chars.length === 0 || digit <= 0) return reading;
  const boxes = ink.map((s) => strokeBounds(s));
  const tall = boxes.filter((b): b is Bounds => b !== null && height(b) > 0.6 * digit);
  if (tall.length === 0) return reading;
  const baseline = median(tall.map((b) => b.maxY));
  // The row's own digits' height: the column's counts its marks in too.
  const h = median(tall.map((b) => height(b)));
  const settled = chars.map((c) => {
    const own = c.strokes.map((i) => boxes[i]).filter((b): b is Bounds => b != null);
    if (own.length === 0 || own.length !== c.strokes.length) return null;
    const b = union(own);
    const small = height(b) < 0.45 * h && width(b) < 0.45 * h;
    if (!small || b.minY < baseline - 0.45 * h) return null;
    const hangs = b.maxY > baseline + 0.12 * h;
    const tick = height(b) > 0.2 * h && height(b) > 1.5 * width(b);
    return hangs || tick ? "," : ".";
  });
  if (settled.every((m) => m === null)) return reading;
  const text = Array.from(reading.text);
  const map = alignChars(
    chars.map((c) => c.char),
    text,
  );
  text.forEach((_, at) => {
    const mark = map[at] >= 0 ? settled[map[at]] : null;
    if (mark) text[at] = mark;
  });
  return {
    ...reading,
    text: text.join(""),
    ...(reading.greedy !== undefined
      ? { greedy: chars.map((c, i) => settled[i] ?? c.char).join("") }
      : {}),
    chars: chars.map((c, i) => {
      const mark = settled[i];
      return mark ? { ...c, char: mark, confidence: 1 } : c;
    }),
  };
}

// ---------------------------------------------------------------------------
// The card: what was read, lined up, and the total

/**
 * A row's text as Grape read it, with the shape rule for the 1 it misses
 * applied: a row Grape read as no digit at all that is one upstroke-1
 * stroke is "1" ({@link isUpstrokeOne}).
 */
export function rowText(read: string, amount: readonly Stroke[], digit: number | null): string {
  const text = read.replace(/\s+/g, "");
  if (/\d/.test(text)) return text;
  return isUpstrokeOne(amount, digit) ? "1" : text;
}

/** The column's convention when its amounts do not say: the app language's decimal mark. */
export function conventionOfLocale(locale: string): Convention {
  try {
    return new Intl.NumberFormat(locale).format(1.5).includes(",") ? "de" : "en";
  } catch {
    return "en";
  }
}

export interface ColumnSummary {
  convention: Convention;
  /** Per row of the column: what it was read as (null for a line or a row with no amount). */
  values: Array<RowValue | null>;
  total: ColumnTotal;
  /** The total as the column writes it, or null while a row is unread. */
  totalText: string | null;
  /** The rows the card lists (the ones the total adds, and the unread), top to bottom. */
  shown: number[];
  /** The rows lined up on the decimal mark, the last underlined as the line is drawn. */
  tex: string;
  /** The rows as one typed sum ("1.234,50 + 20,00 - 5,00"), for the typing dialog. */
  expression: string;
}

/** Characters LaTeX would take as commands, out of a reading shown as text. */
const TEX_UNSAFE = /[{}\\$^_&%#~]/g;

/**
 * The card's summary of `column`, its rows read as `texts` (one per row,
 * null for a line or a row with no amount). `typed` overrides rows with
 * signed amounts typed in the dialog. The convention comes from what the
 * rows look like, else `fallback`.
 */
export function summarizeColumn(
  column: Column,
  texts: ReadonlyArray<string | null>,
  fallback: Convention,
  typed: ReadonlyMap<number, Amount> = new Map(),
): ColumnSummary {
  const convention = guessConvention(
    texts.filter((x): x is string => x !== null),
    fallback,
  );
  const values: Array<RowValue | null> = column.rows.map((row, i) => {
    if (row.rule || row.amount.length === 0) return null;
    const own = typed.get(i);
    if (own) {
      // The row's ink sign still applies in the total: undo it here.
      return {
        text: formatAmount(own, convention),
        value: { ...own, units: own.units * row.sign },
      };
    }
    const text = texts[i] ?? "";
    return { text, value: parseAmount(text, convention) };
  });
  const total = columnTotal(column, values);
  const shown = [...total.rows, ...total.unread].sort((a, b) => a - b);
  const signedOf = (i: number): Amount | null => {
    const v = values[i]?.value;
    return v ? { units: column.rows[i].sign * v.units, scale: v.scale } : null;
  };
  // Every amount is written with the column's decimals, so right-aligned
  // they line up on the decimal mark.
  const cells = shown.map((i) => {
    const signed = signedOf(i);
    if (!signed) {
      const raw = (values[i]?.text ?? "").replace(TEX_UNSAFE, "") || "?";
      return { tex: String.raw`\text{${raw}}`, typed: raw };
    }
    const text = formatAmount(signed, convention, total.scale);
    // Set as one upright run: no space after its comma, as there is after punctuation.
    return { tex: String.raw`\mathrm{${text}}`, typed: text };
  });
  const lines = cells.map((c, k) => {
    if (k !== cells.length - 1) return c.tex;
    return column.rule.kind === "total"
      ? String.raw`\underline{\underline{${c.tex}}}`
      : String.raw`\underline{${c.tex}}`;
  });
  const tex = `\\begin{aligned} ${lines.join(" \\\\ ")} \\end{aligned}`;
  const expression = cells
    .map((c, k) => {
      if (k === 0) return c.typed;
      return c.typed.startsWith("-") ? `- ${c.typed.slice(1)}` : `+ ${c.typed}`;
    })
    .join(" ");
  const totalText = total.total ? formatAmount(total.total, convention, total.scale) : null;
  return { convention, values, total, totalText, shown, tex, expression };
}

/**
 * A sum typed in the dialog ("1.234,50 + 20 - 5,-"), as signed amounts in
 * order, or null when a part is not an amount.
 */
export function parseTypedColumn(text: string, convention: Convention): Amount[] | null {
  const out: Amount[] = [];
  let at = 0;
  const skip = (): void => {
    while (at < text.length && /\s/.test(text[at])) at++;
  };
  for (;;) {
    skip();
    if (at >= text.length) break;
    let sign = 1;
    if (text[at] === "+" || text[at] === "-" || text[at] === "−") {
      sign = text[at] === "+" ? 1 : -1;
      at++;
      skip();
    } else if (out.length > 0) return null;
    let part = "";
    while (at < text.length && /[\d.,]/.test(text[at])) part += text[at++];
    // The whole-amount dash ("20,-"), unless a digit follows it: then its
    // last dash is the next amount's minus ("20,--5", "20,-5").
    if (/[.,]$/.test(part)) {
      let dashes = 0;
      while (text[at + dashes] === "-") dashes++;
      let next = at + dashes;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (dashes > 0 && /\d/.test(text[next] ?? "") && next === at + dashes) dashes--;
      at += dashes;
      part = part.slice(0, -1);
    }
    const amount = parseAmount(part, convention);
    if (!amount) return null;
    out.push({ units: sign * amount.units, scale: amount.scale });
  }
  return out.length > 0 ? out : null;
}
