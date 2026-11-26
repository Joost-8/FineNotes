/**
 * The pieces kind: C2 (research/handwriting-rig/gen/inkref.py), the writer
 * model Beautify runs since 24 November. It is shown one whole line of the
 * writer, then words and lone letters cut from the writer's other lines,
 * chosen because they hold the characters the text needs; each piece is
 * tagged with its place inside the piece, its number and its kind (line,
 * word, letter), with a separator row before each. Sampling is the dual
 * kind's (`sampler.ts`); only the reference and the encoder's inputs differ.
 *
 * A port of `inkref.Bank` and `inkref.mixed_reference` (mode "mixed", no
 * line left out), with `letters` (a needed character shown as a lone letter
 * first that share of the time) and `other_case` (a character the writer
 * never wrote in that case looked for in the other one) from the manifest.
 * Its random choices come from a seeded generator, not Python's, so a line
 * gets a reference of the same make, not the same pieces.
 *
 * PURE: no DOM, no Obsidian.
 */

import { flowCheck, samplerMeta } from "./flow-meta";
import type { WriterKind } from "./kinds";
import type { WriterManifest } from "./manifest";
import { type Reference, ROW, type TaggedLine, calm, isUp, pickLines, runsOf } from "./rows";
import { type Encoded, type Graphs, writeLine } from "./sampler";
import { type GraphRunner, type Tensorish, bools, f32, i64, need, ones, slot } from "./tensors";

/** Most rows of a word piece (inkref.WORD_MAX). */
export const WORD_MAX = 28;

/** Kinds of piece, as the model's `unit` embedding numbers them. */
export const LINE = 0;
export const WORD = 1;
export const LETTER = 2;

/** What C2 is shown: a reference whose rows also carry their place in their piece, the piece's number and its kind. */
export interface PiecesReference extends Reference {
  pos: Int32Array;
  seg: Int32Array;
  unit: Int32Array;
}

/** A line, word or letter that can be shown. */
export interface Piece {
  x: Float32Array;
  n: number;
  cid: Int32Array;
  k: Int32Array;
  d: Int32Array;
  chars: ReadonlySet<string>;
  unit: number;
}

/** One writer's lines cut into pieces that can be shown (inkref.Bank, with v2's retagging). */
export interface Bank {
  /** Every line, whole. */
  lines: Piece[];
  /** Every word of at most WORD_MAX rows, with the line it came from. */
  words: { line: number; piece: Piece }[];
  /** Character -> the words (indices into `words`) that hold it. */
  byChar: Map<string, number[]>;
  /** Character -> every letter with a pen lift on both sides. */
  letters: Map<string, { line: number; piece: Piece }[]>;
}

/** [a, e] without leading and trailing pen-up rows. */
function strip(x: Float32Array, a: number, e: number): [number, number] {
  while (a <= e && isUp(x, a)) a++;
  while (e >= a && isUp(x, e)) e--;
  return [a, e];
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/** The bank of `lines`, already tied to their letters; `index` maps a character to the model's id. */
export function bankOf(lines: readonly TaggedLine[], index: ReadonlyMap<string, number>): Bank {
  const bank: Bank = { lines: [], words: [], byChar: new Map(), letters: new Map() };
  for (const [li, line] of lines.entries()) {
    const T = line.n;
    const cid = Int32Array.from(line.char, (c) => index.get(line.text[c]) ?? 0);
    const runs = runsOf(line.char);
    bank.lines.push({
      x: line.x,
      n: T,
      cid,
      k: runs.k,
      d: runs.d,
      chars: new Set(line.text),
      unit: LINE,
    });
    const first = new Int32Array(line.text.length).fill(T);
    const last = new Int32Array(line.text.length).fill(-1);
    for (let t = 0; t < T; t++) {
      const c = line.char[t];
      if (c < 0 || c >= line.text.length) continue;
      first[c] = Math.min(first[c], t);
      last[c] = Math.max(last[c], t);
    }
    const cut = (a: number, e: number, text: string, unit: number): Piece => {
      const r = runsOf(line.char.subarray(a, e + 1));
      return {
        x: line.x.slice(a * ROW, (e + 1) * ROW),
        n: e - a + 1,
        cid: cid.slice(a, e + 1),
        k: r.k,
        d: r.d,
        chars: new Set(text),
        unit,
      };
    };
    let at = 0;
    for (const w of line.text.split(" ")) {
      const a0 = at;
      at += w.length + 1;
      if (!w) continue;
      let lo = T;
      let hi = -1;
      for (let u = a0; u < a0 + w.length; u++) {
        if (last[u] < 0) continue;
        lo = Math.min(lo, first[u]);
        hi = Math.max(hi, last[u]);
      }
      if (hi < 0) continue;
      const [a, e] = strip(line.x, lo, hi);
      if (e - a + 1 >= 2 && e - a + 1 <= WORD_MAX) {
        for (const c of new Set(w)) push(bank.byChar, c, bank.words.length);
        bank.words.push({ line: li, piece: cut(a, e, w, WORD) });
      }
    }
    for (let u = 0; u < line.text.length; u++) {
      const c = line.text[u];
      if (c === " " || last[u] < 0) continue;
      const s = first[u];
      const t = last[u];
      const before = s === 0 || isUp(line.x, s - 1) || isUp(line.x, s);
      const after = t === T - 1 || isUp(line.x, t + 1) || isUp(line.x, t);
      if (!before || !after) continue;
      const [a, e] = strip(line.x, s, t);
      if (e >= a) push(bank.letters, c, { line: li, piece: cut(a, e, c, LETTER) });
    }
  }
  return bank;
}

/** A seeded uniform generator in [0, 1) (mulberry32). */
export function uniform(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isLower = (c: string): boolean => c !== c.toUpperCase() && c === c.toLowerCase();
/** Capitals, digits and signs other than "." and "," (inkref.is_rare). */
const isRare = (c: string): boolean => !isLower(c) && c !== "." && c !== ",";
const swapCase = (c: string): string => {
  const s = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
  return s.length === 1 ? s : c;
};

export interface MixOptions {
  /** Rows shown at most. */
  size: number;
  /** Share of needed characters shown as a lone letter first, when the writer has one. */
  letters: number;
  /** A character never written in its case is looked for in the other one. */
  otherCase: boolean;
}

/**
 * What C2 is shown for `text` (inkref.mixed_reference, mode "mixed", no
 * line left out, every match kept): a whole line short enough to leave
 * room, then the pieces that hold the characters the text needs and the
 * line lacks (capitals, digits and signs first), then other words up to
 * the size, in random order. Null for an empty bank.
 */
export function mixedReference(
  bank: Bank,
  text: string,
  random: () => number,
  options: MixOptions,
): PiecesReference | null {
  const { size: n, letters } = options;
  const count = bank.lines.length;
  if (count === 0) return null;
  const below = (k: number): number => Math.min(k - 1, Math.floor(random() * k));
  const room = n >= 256 ? 160 : Math.round(0.6 * n);
  let short = bank.lines.flatMap((l, i) => (l.n <= room ? [i] : []));
  if (short.length === 0) short = bank.lines.map((_, i) => i);
  const ai = short[below(short.length)];
  const anchor = bank.lines[ai];
  let used = anchor.n;
  const held = (c: string): boolean =>
    (bank.byChar.get(c)?.length ?? 0) > 0 || (bank.letters.get(c)?.length ?? 0) > 0;
  let need = new Set<string>();
  for (const c of new Set(text)) {
    if (c === " " || anchor.chars.has(c)) continue;
    const other = swapCase(c);
    need.add(options.otherCase && !held(c) && held(other) ? other : c);
  }
  need = new Set([...need].filter((c) => !anchor.chars.has(c)));
  const extra: Piece[] = [];
  const ok = (line: number): boolean => line !== ai;
  const order = [...need]
    .sort()
    .map((c) => ({ c, common: isRare(c) ? 0 : 1, u: random() }))
    .sort((a, b) => a.common - b.common || a.u - b.u)
    .map((o) => o.c);
  for (const c of order) {
    if (!need.has(c) || used >= n - 8) continue;
    let got: Piece | null = null;
    const lone = bank.letters.get(c) ?? [];
    // With `letters`, the lone letter is tried first that share of the time.
    const alone = letters > 0 && lone.length > 0 && random() < letters;
    if (alone) {
      for (let i = 0; i < 4 && !got; i++) {
        const p = lone[below(lone.length)];
        if (ok(p.line)) got = p.piece;
      }
    }
    const words = bank.byChar.get(c) ?? [];
    for (let i = 0; i < 4 && !got && words.length > 0; i++) {
      const p = bank.words[words[below(words.length)]];
      if (ok(p.line)) got = p.piece;
    }
    if (!alone) {
      for (let i = 0; i < 4 && !got && lone.length > 0; i++) {
        const p = lone[below(lone.length)];
        if (ok(p.line)) got = p.piece;
      }
    }
    if (got) {
      extra.push(got);
      used += got.n + 1;
      for (const h of got.chars) need.delete(h);
    }
  }
  for (let tries = 0; bank.words.length > 0 && used < n - 20 && extra.length < 14 && tries < 40;) {
    tries++;
    const p = bank.words[below(bank.words.length)];
    if (!ok(p.line)) continue;
    extra.push(p.piece);
    used += p.piece.n + 1;
  }
  // Fisher-Yates, as Python's shuffle.
  for (let i = extra.length - 1; i > 0; i--) {
    const j = below(i + 1);
    [extra[i], extra[j]] = [extra[j], extra[i]];
  }
  return assemble([anchor, ...extra], n);
}

/** Pieces joined, a separator row before each after the first, cut at `n` rows. */
export function assemble(pieces: readonly Piece[], n: number): PiecesReference {
  let total = 0;
  for (const [m, p] of pieces.entries()) total += p.n + (m > 0 ? 1 : 0);
  const size = Math.min(total, n);
  const ref: PiecesReference = {
    x: new Float32Array(size * ROW),
    n: size,
    cid: new Int32Array(size),
    k: new Int32Array(size),
    d: new Int32Array(size),
    sep: new Uint8Array(size),
    pos: new Int32Array(size),
    seg: new Int32Array(size),
    unit: new Int32Array(size),
  };
  let at = 0;
  for (const [m, p] of pieces.entries()) {
    if (at >= size) break;
    if (m > 0) {
      ref.x[at * ROW + ROW - 1] = 1; // a pen-up row of no length
      ref.seg[at] = m;
      ref.unit[at] = p.unit;
      ref.sep[at] = 1;
      at++;
    }
    for (let i = 0; i < p.n && at < size; i++, at++) {
      ref.x.set(p.x.subarray(i * ROW, (i + 1) * ROW), at * ROW);
      ref.cid[at] = p.cid[i];
      ref.k[at] = p.k[i];
      ref.d[at] = p.d[i];
      ref.pos[at] = i;
      ref.seg[at] = m;
      ref.unit[at] = p.unit;
    }
  }
  return ref;
}

/** An encoded reference as C2's velocity takes it. */
export interface PiecesEncoded extends Encoded {
  mem: Tensorish;
  valid: Tensorish;
}

/** C2's three graphs over a runner, in the order of `PIECES_KIND.graphs` (gen/export_pieces.py). */
export function piecesGraphs(run: GraphRunner): Graphs<PiecesEncoded, PiecesReference> {
  return {
    async encode(ref, drop) {
      const R = ref.n;
      const [mem, valid, s] = await run("encode", [
        f32(ref.x, [1, R, ROW]),
        bools(ones(R), [1, R]),
        i64(ref.cid, [1, R]),
        i64(ref.k, [1, R]),
        i64(ref.d, [1, R]),
        i64(ref.pos, [1, R]),
        i64(ref.seg, [1, R]),
        i64(ref.unit, [1, R]),
        bools(ref.sep, [1, R]),
        bools([drop ? 1 : 0], [1]),
      ]);
      return { mem, valid, g: Float32Array.from(s.data as Float32Array) };
    },
    async durations(ids, g) {
      const L = ids.length;
      const [logits] = await run("durations", [
        i64(ids, [1, L]),
        bools(ones(L), [1, L]),
        f32(g, [1, g.length]),
      ]);
      return Float32Array.from(logits.data as Float32Array);
    },
    async velocity(x, tau, cid, k, d, enc) {
      const n = cid.length;
      const [v] = await run("velocity", [
        f32(x, [1, n, ROW]),
        f32(Float32Array.from([tau]), [1]),
        bools(ones(n), [1, n]),
        i64(cid, [1, n]),
        i64(k, [1, n]),
        i64(d, [1, n]),
        enc.mem,
        enc.valid,
      ]);
      return Float32Array.from(v.data as Float32Array);
    },
  };
}

function piecesCheck(m: WriterManifest): string | null {
  const shared = flowCheck(m);
  if (shared) return shared;
  const { letters, otherCase } = m.reference;
  if (letters !== undefined && !(typeof letters === "number" && letters >= 0 && letters <= 1))
    return "reference letters";
  if (otherCase !== undefined && typeof otherCase !== "boolean") return "reference otherCase";
  return null;
}

/** C2's kind. */
export const PIECES_KIND: WriterKind<PiecesReference> = {
  graphs: {
    encode: {
      inputs: [
        slot("ref.rows", "float32"),
        slot("ref.mask", "bool"),
        slot("ref.char", "int64"),
        slot("ref.place", "int64"),
        slot("ref.length", "int64"),
        slot("ref.position", "int64"),
        slot("ref.piece", "int64"),
        slot("ref.unit", "int64"),
        slot("ref.separator", "bool"),
        slot("drop", "bool"),
      ],
      outputs: [slot("memory", "float32"), slot("valid", "bool"), slot("summary", "float32")],
    },
    durations: {
      inputs: [slot("text.char", "int64"), slot("text.mask", "bool"), slot("summary", "float32")],
      outputs: [slot("logits", "float32")],
    },
    velocity: {
      inputs: [
        slot("rows", "float32"),
        slot("time", "float32"),
        slot("mask", "bool"),
        slot("char", "int64"),
        slot("place", "int64"),
        slot("length", "int64"),
        slot("memory", "float32"),
        slot("valid", "bool"),
      ],
      outputs: [slot("velocity", "float32")],
    },
  },
  check: piecesCheck,
  // Its pieces come from every line it is given: the lines sharing most letters first, as many as the manifest takes.
  pick: (text, pool, count) => pickLines(text, pool, count),
  reference(text, lines, m, seed) {
    const hold = need(m.reference.hold, "reference.hold");
    const bank = bankOf(
      lines.slice(0, m.reference.lines).map((line) => calm(line, hold)),
      new Map(m.chars.map((c, i) => [c, i])),
    );
    return mixedReference(bank, text, uniform(seed), {
      size: need(m.reference.curves, "reference.curves"),
      letters: m.reference.letters ?? 0,
      otherCase: m.reference.otherCase ?? false,
    });
  },
  write: (run, m, text, ref, options) =>
    writeLine(piecesGraphs(run), samplerMeta(m), text, ref, options),
};
