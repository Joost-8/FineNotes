/**
 * Calculation notes, the layout of a sum before it is read (FineNotes#178).
 *
 * Grape reads a line from left to right, one character after another, so it
 * cannot see where a mark sits: a dot halfway up the digits ("3·3", times)
 * and a dot on the baseline ("3.3") read alike, and a fraction's numerator,
 * bar and denominator come out as one jumbled line. Both are settled here by
 * geometry, before Grape sees anything, and Grape reads only the pieces in
 * between:
 *
 * - a fraction bar is a dash with ink just above it and just below it, inside
 *   its width; the two sides are laid out again on their own (a fraction may
 *   hold a fraction). A dash with one dot above and one below is ÷.
 * - a dot is times when its middle sits between a quarter and three quarters
 *   of the way up the digits beside it, with ink on both sides, and no other
 *   dot above or below it (that would be a colon). On the baseline it stays a
 *   decimal point, and Grape reads it with the digits.
 *
 * PURE: no DOM. Page px throughout.
 */

import { digitHeight, isDash, pathLength } from "./calc-ink";
import { type Bounds, type Stroke, strokeBounds } from "./document";

/** One part of a sum, left to right. */
export type SumPiece =
  /** Ink for Grape to read, in the order it was written. */
  | { kind: "ink"; strokes: Stroke[] }
  /** A raised dot: times (a dot redrawn in place is one dot of several strokes). */
  | { kind: "times"; strokes: Stroke[] }
  /** A dash with a dot above and below: divided by. */
  | { kind: "divide"; strokes: Stroke[] }
  /** A fraction bar with what is over and under it. */
  | { kind: "fraction"; bar: Stroke; over: SumPiece[]; under: SumPiece[] };

interface Item {
  stroke: Stroke;
  box: Bounds;
  /** Its place in the page's order (writing order). */
  order: number;
}

const width = (b: Bounds): number => b.maxX - b.minX;
const height = (b: Bounds): number => b.maxY - b.minY;
const midX = (b: Bounds): number => (b.minX + b.maxX) / 2;
const midY = (b: Bounds): number => (b.minY + b.maxY) / 2;

/** A dot: small against the digits, and a short path (a tap, or a tiny circle). */
export function isDot(stroke: Stroke, box: Bounds, digit: number): boolean {
  if (digit <= 0) return false;
  return Math.max(width(box), height(box)) <= 0.3 * digit && pathLength(stroke) <= 0.9 * digit;
}

/** Ink that sits over (`side` -1) or under (+1) a bar, inside its width and close to it. */
function besideBar(item: Item, bar: Bounds, side: -1 | 1, digit: number): boolean {
  const w = width(bar);
  const x = midX(item.box);
  if (x < bar.minX - 0.1 * w || x > bar.maxX + 0.1 * w) return false;
  const y = midY(bar);
  const slack = 0.2 * digit;
  if (side < 0) return midY(item.box) < y && item.box.maxY <= y + slack;
  return midY(item.box) > y && item.box.minY >= y - slack;
}

/**
 * The bars among `items`, widest first: dashes at least half a digit wide.
 * A minus has nothing over and under it, so it is never one.
 */
function barCandidates(items: readonly Item[], digit: number): Item[] {
  return items
    .filter((it) => isDash(it.stroke, it.box) && width(it.box) >= 0.5 * digit)
    .sort((a, b) => width(b.box) - width(a.box));
}

/**
 * Whether the ink on one side of a bar is a fraction's side: at least 0.4 of
 * a digit tall (the other dash of an "=" is flat) and centred over the bar,
 * in its middle seven tenths (an arrow's barbs sit at its end).
 */
function isFractionSide(side: readonly Item[], bar: Bounds, digit: number): boolean {
  const minX = Math.min(...side.map((it) => it.box.minX));
  const maxX = Math.max(...side.map((it) => it.box.maxX));
  const minY = Math.min(...side.map((it) => it.box.minY));
  const maxY = Math.max(...side.map((it) => it.box.maxY));
  const w = width(bar);
  const x = (minX + maxX) / 2;
  return maxY - minY >= 0.4 * digit && x >= bar.minX + 0.15 * w && x <= bar.maxX - 0.15 * w;
}

/** The stroke a mark is known by, for {@link layoutSum}'s `plain`: a dot's first stroke, or the bar. */
export function markId(piece: SumPiece): string | null {
  if (piece.kind === "times") return piece.strokes[0].id;
  if (piece.kind === "divide") return piece.strokes[0].id;
  if (piece.kind === "fraction") return piece.bar.id;
  return null;
}

function layoutItems(items: Item[], digit: number, plain: ReadonlySet<string>): SumPiece[] {
  const placed: Array<{ left: number; piece: SumPiece }> = [];
  let rest = items;
  for (const bar of barCandidates(items, digit)) {
    if (!rest.includes(bar) || plain.has(bar.stroke.id)) continue;
    const others = rest.filter((it) => it !== bar);
    const over = others.filter((it) => besideBar(it, bar.box, -1, digit));
    const under = others.filter((it) => besideBar(it, bar.box, 1, digit));
    if (over.length === 0 || under.length === 0) continue;
    const dots = over.length === 1 && under.length === 1;
    if (
      dots &&
      isDot(over[0].stroke, over[0].box, digit) &&
      isDot(under[0].stroke, under[0].box, digit)
    ) {
      rest = rest.filter((it) => it !== bar && it !== over[0] && it !== under[0]);
      placed.push({
        left: bar.box.minX,
        piece: { kind: "divide", strokes: [bar.stroke, over[0].stroke, under[0].stroke] },
      });
      continue;
    }
    if (!isFractionSide(over, bar.box, digit) || !isFractionSide(under, bar.box, digit)) continue;
    const used = new Set([bar, ...over, ...under]);
    rest = rest.filter((it) => !used.has(it));
    placed.push({
      left: bar.box.minX,
      piece: {
        kind: "fraction",
        bar: bar.stroke,
        over: layoutItems(over, digitHeight(over.map((it) => it.box)) || digit, plain),
        under: layoutItems(under, digitHeight(under.map((it) => it.box)) || digit, plain),
      },
    });
  }

  // Raised dots in what is left, judged against the digits beside them.
  const times = timesDots(rest, digit).filter((dot) => !plain.has(dot[0].stroke.id));
  for (const dot of times) {
    placed.push({
      left: Math.min(...dot.map((it) => it.box.minX)),
      piece: { kind: "times", strokes: dot.map((it) => it.stroke) },
    });
  }
  const taken = new Set(times.flat());
  rest = rest.filter((it) => !taken.has(it));

  // The ink between the marks, as runs in left-to-right order.
  const marks = placed.sort((a, b) => a.left - b.left);
  const out: SumPiece[] = [];
  const runs = new Map<number, Item[]>();
  for (const it of rest) {
    // Its run: the number of marks whose left edge is left of its middle.
    const k = marks.filter((m) => m.left < midX(it.box)).length;
    const run = runs.get(k) ?? [];
    run.push(it);
    runs.set(k, run);
  }
  const runAt = (k: number): void => {
    const run = runs.get(k);
    if (run)
      out.push({
        kind: "ink",
        strokes: run.sort((a, b) => a.order - b.order).map((it) => it.stroke),
      });
  };
  for (let k = 0; k < marks.length; k++) {
    runAt(k);
    out.push(marks[k].piece);
  }
  runAt(marks.length);
  return out;
}

/**
 * The dots in `items` that are times: raised, between ink, and not part of a
 * colon. Each is a group: strokes of one dot that touch (a dot redrawn, or a
 * tap that left a second trace) are one dot.
 */
function timesDots(items: readonly Item[], digit: number): Item[][] {
  const single = items.filter((it) => isDot(it.stroke, it.box, digit));
  if (single.length === 0) return [];
  // Strokes of one dot: within a tenth of a digit of each other.
  const groups: Item[][] = [];
  for (const it of single) {
    const near = (o: Item): boolean =>
      Math.abs(midX(o.box) - midX(it.box)) <= 0.12 * digit &&
      Math.abs(midY(o.box) - midY(it.box)) <= 0.12 * digit;
    const group = groups.find((g) => g.some(near));
    if (group) group.push(it);
    else groups.push([it]);
  }
  const boxOf = (g: Item[]): Bounds => ({
    minX: Math.min(...g.map((it) => it.box.minX)),
    minY: Math.min(...g.map((it) => it.box.minY)),
    maxX: Math.max(...g.map((it) => it.box.maxX)),
    maxY: Math.max(...g.map((it) => it.box.maxY)),
  });
  const solid = items.filter((it) => !single.includes(it));
  const tall = solid.filter((it) => height(it.box) >= 0.5 * digit);
  if (tall.length === 0) return [];
  const result: Item[][] = [];
  for (const group of groups) {
    const box = boxOf(group);
    const x = midX(box);
    // Stacked over or under another dot: a colon (divided by), or ÷ without its bar.
    const stacked = groups.some(
      (o) =>
        o !== group &&
        Math.abs(midX(boxOf(o)) - x) <= 0.3 * digit &&
        Math.abs(midY(boxOf(o)) - midY(box)) > 0.12 * digit,
    );
    if (stacked) continue;
    // Over or under any other stroke (an i's stem, a letter's bowl): part of that letter.
    const margin = 0.05 * digit;
    if (solid.some((it) => x >= it.box.minX - margin && x <= it.box.maxX + margin)) continue;
    // Its nearest neighbours must be full-height marks (digits, brackets), and
    // the dot small against them: beside small letters in a word, a short
    // stroke of a letter looks like a dot against the line's tall ones.
    const left = solid.filter((it) => it.box.maxX <= x).sort((a, b) => b.box.maxX - a.box.maxX)[0];
    const right = solid.filter((it) => it.box.minX >= x).sort((a, b) => a.box.minX - b.box.minX)[0];
    if (!left || !right || !tall.includes(left) || !tall.includes(right)) continue;
    const near = Math.min(height(left.box), height(right.box));
    if (Math.max(width(box), height(box)) > 0.3 * near) continue;
    // Within reach of both: about two digits.
    if (x - left.box.maxX > 2 * digit || right.box.minX - x > 2 * digit) continue;
    // How far up the digits beside it: 0 on their baseline, 1 at their top.
    const base = (left.box.maxY + right.box.maxY) / 2;
    const top = (left.box.minY + right.box.minY) / 2;
    const span = base - top;
    if (span <= 0) continue;
    const up = (base - midY(box)) / span;
    if (up >= 0.25 && up <= 0.75) result.push(group);
  }
  return result;
}

/**
 * The sum's strokes (without its "=") laid out into pieces, left to right.
 * A sum with neither a fraction nor a raised dot is one piece of ink, read as
 * before. Marks named in `plain` (by {@link markId}) are left as ink: ones a
 * reading showed were not times or a fraction ({@link misreadMarks}).
 */
export function layoutSum(
  strokes: readonly Stroke[],
  plain: ReadonlySet<string> = new Set(),
): SumPiece[] {
  const items: Item[] = [];
  strokes.forEach((stroke, order) => {
    const box = strokeBounds(stroke);
    if (box) items.push({ stroke, box, order });
  });
  if (items.length === 0) return [];
  const solid = items.filter((it) => !isDash(it.stroke, it.box));
  const digit = digitHeight((solid.length > 0 ? solid : items).map((it) => it.box));
  return layoutItems(items, digit, plain);
}

/** A reading that can end before a times: a number, a closing bracket, or one letter. */
const TIMES_BEFORE = /(?:[0-9)\]]|(?<![A-Za-z])[A-Za-z])\s*$/;
/** A reading that can start after a times: a number, an opening bracket, a minus, or one letter. */
const TIMES_AFTER = /^\s*(?:[0-9([−-]|[A-Za-z](?![A-Za-z]))/;

/**
 * The marks the readings show were taken wrongly, by {@link markId}: a times
 * dot with a word beside it (the dot of an i between letters, a full stop),
 * and a fraction a side of which read as no letter or digit (an arrow's
 * barbs). Lay the sum out again with these as `plain` and read it again.
 * `readings` are in {@link inkPieces} order.
 */
export function misreadMarks(
  pieces: readonly SumPiece[],
  readings: readonly string[],
): Set<string> {
  const bad = new Set<string>();
  let next = 0;
  // Each ink piece's reading, by piece, in reading order.
  const text = new Map<SumPiece, string>();
  const walk = (list: readonly SumPiece[]): void => {
    for (const p of list) {
      if (p.kind === "ink") text.set(p, readings[next++] ?? "");
      else if (p.kind === "fraction") {
        walk(p.over);
        walk(p.under);
      }
    }
  };
  walk(pieces);
  const sideText = (list: readonly SumPiece[]): string =>
    list.map((p) => (p.kind === "ink" ? (text.get(p) ?? "") : "1")).join("");
  const check = (list: readonly SumPiece[]): void => {
    list.forEach((p, i) => {
      if (p.kind === "fraction") {
        const id = markId(p);
        if (
          id &&
          (!/[0-9A-Za-z]/.test(sideText(p.over)) || !/[0-9A-Za-z]/.test(sideText(p.under)))
        ) {
          bad.add(id);
        }
        check(p.over);
        check(p.under);
        return;
      }
      if (p.kind !== "times") return;
      const before = list[i - 1];
      const after = list[i + 1];
      const okBefore =
        before !== undefined &&
        (before.kind === "fraction" ||
          (before.kind === "ink" && TIMES_BEFORE.test(text.get(before) ?? "")));
      const okAfter =
        after !== undefined &&
        (after.kind === "fraction" ||
          (after.kind === "ink" && TIMES_AFTER.test(text.get(after) ?? "")));
      const id = markId(p);
      if (id && !(okBefore && okAfter)) bad.add(id);
    });
  };
  check(pieces);
  return bad;
}

/** The ink pieces of a layout, depth first, in the order {@link sumText} reads them. */
export function inkPieces(pieces: readonly SumPiece[]): Stroke[][] {
  const out: Stroke[][] = [];
  const walk = (list: readonly SumPiece[]): void => {
    for (const p of list) {
      if (p.kind === "ink") out.push(p.strokes);
      else if (p.kind === "fraction") {
        walk(p.over);
        walk(p.under);
      }
    }
  };
  walk(pieces);
  return out;
}

/** Whether a side of a fraction needs brackets: anything but one number or one name. */
function needsBrackets(text: string): boolean {
  return !/^\s*-?(?:[0-9.,]+|[A-Za-z][A-Za-z0-9]*)\s*$/.test(text);
}

/**
 * The sum as text, from the readings of its ink pieces (in {@link inkPieces}
 * order): a raised dot is `*`, ÷ is `/`, and a fraction is `(over)/(under)`,
 * in brackets when it stands beside more of the sum. Null when a side of a
 * fraction read as nothing.
 */
export function sumText(pieces: readonly SumPiece[], readings: readonly string[]): string | null {
  let next = 0;
  const build = (list: readonly SumPiece[]): string | null => {
    const parts: string[] = [];
    for (const p of list) {
      if (p.kind === "ink") parts.push((readings[next++] ?? "").trim());
      else if (p.kind === "times") parts.push("*");
      else if (p.kind === "divide") parts.push("/");
      else {
        const over = build(p.over);
        const under = build(p.under);
        if (!over || !under) return null;
        const a = needsBrackets(over) ? `(${over})` : over;
        const b = needsBrackets(under) ? `(${under})` : under;
        parts.push(list.length > 1 ? `(${a}/${b})` : `${a}/${b}`);
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };
  return build(pieces);
}

/** What Grape gave for one group of ink. */
export interface PieceReading {
  /** The reading (with the language model). */
  text: string;
  /** Mean best-class probability over its frames. */
  confidence: number;
  /** The letters as written (no language model); `chars` follow it. */
  greedy?: string;
  /** Each character of `greedy`: its strokes (indices into the group), confidence and runner-ups. */
  chars?: ReadonlyArray<{
    char: string;
    strokes: readonly number[];
    confidence: number;
    alternatives: ReadonlyArray<{ char: string }>;
  }>;
}

/**
 * Below this a piece read without per-character detail is a doubt as a
 * whole. Measured on the 246 real eval lines (`calc_confidence_probe.mjs`):
 * of the short lines (6 characters at most, like a fraction's side), 18 of 27
 * read wrongly fell under 0.9 and 1 of 9 read exactly; under 0.85, 12 of 27
 * and none. 0.88 sits between.
 */
export const DOUBT_BELOW = 0.88;

/**
 * Below this a character is a doubt. Measured on the 5,003 characters of the
 * eval lines (`calc_char_probe.mjs`): under 0.7, 38 % of the characters read
 * wrongly and 5.4 % of those read right (digits: 33 % and 12 %); the right
 * character was among the top three runner-ups for 56 % of the wrong ones.
 */
export const CHAR_DOUBT_BELOW = 0.7;

/** Something Grape was unsure of: one character, or a whole piece (`at` -1). */
export interface CharDoubt {
  /** Its strokes' ids. */
  strokes: string[];
  /** What was read: the character, or the piece's whole text. */
  char: string;
  /** Other characters it may be, most likely first (none for a whole piece). */
  alternatives: string[];
  /** Which piece of the sum (`SumReading.pieces`). */
  piece: number;
  /** The character's index in the piece's text, or -1 for the whole piece. */
  at: number;
}

/** A sum read for a calculation note. */
export interface SumReading {
  /** The line's text, ending in "=". */
  text: string;
  /** Whether a raised dot was read as times (the typed form then uses `\cdot`). */
  dot: boolean;
  /** Whether a fraction bar was read (the exact answer is offered first). */
  fraction: boolean;
  /** What Grape was unsure of. */
  doubts: CharDoubt[];
  /** Each piece read: its strokes, what Grape read, and what it reads now (after picks). */
  pieces: Array<{ strokes: string[]; read: string; text: string }>;
  /** The layout the pieces were read in; null for a line read whole. */
  layout: SumPiece[] | null;
}

/**
 * For each character of `b`, the index of the character of `a` it lines up
 * with (the same, or one in its place), or -1 where `b` has one `a` lacks: a
 * least-edits alignment.
 */
export function alignChars(a: readonly string[], b: readonly string[]): number[] {
  const n = a.length;
  const m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  const map = new Array<number>(m).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      map[j - 1] = i - 1;
      i--;
      j--;
    } else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return map;
}

/**
 * The doubts of piece `index`, read from `group`. With Grape's characters,
 * each character of the reading is lined up with the one Grape wrote at its
 * place (`greedy`): one Grape was unsure of, or one the language model
 * changed ("Z" read as "2"), is a doubt, offering what Grape wrote and its
 * runner-ups. Without them, the whole piece is a doubt when its confidence
 * is low.
 */
function pieceDoubts(index: number, group: readonly Stroke[], reading: PieceReading): CharDoubt[] {
  const chars = reading.chars;
  if (chars && chars.length > 0) {
    const text = Array.from(reading.text);
    const map = alignChars(
      chars.map((c) => c.char),
      text,
    );
    const out: CharDoubt[] = [];
    text.forEach((char, at) => {
      const c = map[at] >= 0 ? chars[map[at]] : null;
      if (!c || char.trim() === "") return;
      const changed = c.char !== char;
      if (!changed && c.confidence >= CHAR_DOUBT_BELOW) return;
      const strokes = c.strokes.flatMap((i) => (group[i] ? [group[i].id] : []));
      if (strokes.length === 0) return;
      const offered = [c.char, ...c.alternatives.map((a) => a.char)].filter(
        (a, k, all) => a.trim() !== "" && a !== char && all.indexOf(a) === k,
      );
      out.push({ strokes, char, alternatives: offered, piece: index, at });
    });
    return out;
  }
  if (reading.confidence >= DOUBT_BELOW) return [];
  return [
    { strokes: group.map((s) => s.id), char: reading.text, alternatives: [], piece: index, at: -1 },
  ];
}

/**
 * Read a sum laid out by where its marks sit: lay it out, read its ink pieces
 * with `read`, and lay it out again without any mark the readings show was
 * taken wrongly ({@link misreadMarks}), at most three times. Null when it has
 * no layout (or none survives): read it whole, with {@link readWhole}.
 */
export async function readLaidOut(
  strokes: readonly Stroke[],
  read: (groups: Stroke[][]) => Promise<PieceReading[]>,
): Promise<SumReading | null> {
  const plain = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const layout = layoutSum(strokes, plain);
    if (!hasLayout(layout)) return null;
    const groups = inkPieces(layout);
    const readings = groups.length > 0 ? await read(groups) : [];
    if (readings.length !== groups.length) return null;
    const texts = readings.map((r) => r.text);
    const bad = misreadMarks(layout, texts);
    if (bad.size === 0) {
      const text = sumText(layout, texts);
      if (text === null) return null;
      return {
        text: `${text} =`,
        dot: hasKind(layout, "times"),
        fraction: hasKind(layout, "fraction"),
        doubts: groups.flatMap((g, i) => pieceDoubts(i, g, readings[i])),
        pieces: groups.map((g, i) => ({
          strokes: g.map((s) => s.id),
          read: texts[i],
          text: texts[i],
        })),
        layout,
      };
    }
    for (const id of bad) plain.add(id);
  }
  return null;
}

/** A sum with no layout, read as one line (`strokes` as read, the "=" included). */
export function readWhole(strokes: readonly Stroke[], reading: PieceReading): SumReading {
  return {
    text: reading.text,
    dot: false,
    fraction: false,
    doubts: pieceDoubts(0, strokes, reading),
    pieces: [{ strokes: strokes.map((s) => s.id), read: reading.text, text: reading.text }],
    layout: null,
  };
}

/**
 * The reading with `doubt` answered as `text` (one character, or the
 * piece's whole text for a whole-piece doubt): its piece's text, the sum's
 * text, and the doubts that remain. Null when the doubt is not this
 * reading's, or the sum no longer reads.
 */
export function withPick(reading: SumReading, doubt: CharDoubt, text: string): SumReading | null {
  const index = reading.doubts.indexOf(doubt);
  const piece = reading.pieces[doubt.piece];
  if (index < 0 || !piece) return null;
  let next: string;
  if (doubt.at < 0) next = text;
  else {
    const chars = Array.from(piece.text);
    if (doubt.at >= chars.length) return null;
    chars[doubt.at] = text;
    next = chars.join("");
  }
  const pieces = reading.pieces.map((p, i) => (i === doubt.piece ? { ...p, text: next } : p));
  let sum: string | null;
  if (reading.layout) {
    const laid = sumText(
      reading.layout,
      pieces.map((p) => p.text),
    );
    sum = laid === null ? null : `${laid} =`;
  } else sum = next;
  if (sum === null) return null;
  // A whole piece answered, or a character answered with more or fewer than
  // one: that piece's other doubts no longer point at the right characters.
  const shifted = doubt.at < 0 || Array.from(text).length !== 1;
  return {
    ...reading,
    text: sum,
    pieces,
    doubts: reading.doubts.filter((d) => d !== doubt && !(shifted && d.piece === doubt.piece)),
  };
}

function hasKind(pieces: readonly SumPiece[], kind: SumPiece["kind"]): boolean {
  return pieces.some(
    (p) =>
      p.kind === kind ||
      (p.kind === "fraction" && (hasKind(p.over, kind) || hasKind(p.under, kind))),
  );
}

/** Whether the layout is anything but plain ink (a raised dot, ÷ or a fraction somewhere). */
export function hasLayout(pieces: readonly SumPiece[]): boolean {
  return pieces.some((p) => p.kind !== "ink");
}
