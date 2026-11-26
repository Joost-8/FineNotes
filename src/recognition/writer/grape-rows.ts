/**
 * What Neaten asks of Grape, on curve rows: a writer's copied line turned
 * into rows tied to its letters (the reference the writer is shown), and a
 * written line read back (to keep the best try, and to find words to
 * repair). Runs in the recogniser's worker, next to the loaded model.
 *
 * The rows are Grape 2's own curves (`curvesFromFeatures`), in time order
 * with no late strokes moved (`lineFeatures` without `lateStrokes`), as the
 * research made them for the writer (`curve_lib.author_sheets`); letters are
 * tied to rows by CTC forced alignment, blanks shared with their neighbours
 * (`curve_lib.align_rows`).
 *
 * PURE: no DOM, no Obsidian.
 */

import { forward } from "../hwr/blstm";
import type { HwrBundle } from "../hwr/bundle";
import { greedyDecode } from "../hwr/ctc";
import { curvesFromFeatures } from "../hwr/curves";
import { type InkStroke, LineTooLongError, lineFeatures } from "../hwr/features";
import { forceAlign } from "../hwr/lexicon";
import { ROW, type Rows, type TaggedLine, shareBlanks } from "./rows";

/** The model's class of each character of `text`; null when it has none for one. */
function classes(bundle: HwrBundle, text: string): number[] | null {
  const index = new Map(bundle.meta.alphabet.map((c, i) => [c, i + 1]));
  const ids: number[] = [];
  for (const ch of text) {
    const k = index.get(ch);
    if (k === undefined) return null;
    ids.push(k);
  }
  return ids.length === text.length ? ids : null;
}

/** Rows padded to the network's input width. */
function padded(bundle: HwrBundle, r: Rows): Float32Array {
  const C = bundle.net.inputs;
  if (C === ROW) return r.x;
  const out = new Float32Array(r.n * C);
  for (let i = 0; i < r.n; i++) out.set(r.x.subarray(i * ROW, i * ROW + ROW), i * C);
  return out;
}

/**
 * A copied line as the writer is shown it: its rows and each row's letter.
 * Null when the model has no class for a letter, the ink is too short for
 * the text, or the text cannot be laid over it.
 */
export function tagLine(
  bundle: HwrBundle,
  strokes: readonly InkStroke[],
  text: string,
): TaggedLine | null {
  const input = bundle.meta.input;
  if (!input || input.kind !== "curves") return null;
  const ids = classes(bundle, text);
  if (!ids || ids.length === 0) return null;
  let rows: Rows;
  try {
    const points = lineFeatures(strokes, bundle.meta.features.heightsPerSecond, {
      lateStrokes: false,
    });
    const curves = curvesFromFeatures(points.features, points.frames, input.tol, ROW);
    rows = { x: curves.features, n: curves.frames };
  } catch (error) {
    if (error instanceof LineTooLongError) return null;
    throw error;
  }
  if (rows.n < text.length) return null;
  const logp = forward(bundle.net, padded(bundle, rows), rows.n);
  const pos = forceAlign(logp, rows.n, bundle.meta.alphabet.length + 1, ids);
  if (!pos) return null;
  return { text, x: rows.x, n: rows.n, char: shareBlanks(pos) };
}

/** What Grape reads in written rows (best path, as the research's gate read them). */
/**
 * Whether the reader makes the rows a writer was trained on: the same
 * curve tolerance and normalisation (Grape and the writer update apart).
 */
export function rowsMatch(bundle: HwrBundle, rows: { tol: number; norm: string }): boolean {
  const input = bundle.meta.input;
  return (
    input?.kind === "curves" &&
    Math.abs(input.tol - rows.tol) < 1e-9 &&
    bundle.meta.features.norm === rows.norm
  );
}

export function readRows(bundle: HwrBundle, r: Rows): string {
  return readRowsSure(bundle, r).text;
}

/**
 * What Grape reads in written rows, with how sure it is of each character:
 * the best probability over the frames it was read in. A short word written
 * badly can still be read as itself ("at" drawn like "nt", 25 November on
 * Joost's iPad); its letters' sureness says so.
 */
export function readRowsSure(bundle: HwrBundle, r: Rows): { text: string; sure: number[] } {
  if (r.n === 0) return { text: "", sure: [] };
  const logp = forward(bundle.net, padded(bundle, r), r.n);
  const read = greedyDecode(logp, r.n, bundle.meta.alphabet);
  return { text: read.text, sure: spanSureness(logp, read.spans, bundle.meta.alphabet.length + 1) };
}

/** Per character of a greedy read, the best probability of any class but blank over its frames. */
export function spanSureness(
  logp: ArrayLike<number>,
  spans: readonly [number, number][],
  classes: number,
): number[] {
  return spans.map(([t0, t1]) => {
    let best = -Infinity;
    for (let t = t0; t <= t1; t++) {
      for (let k = 1; k < classes; k++) best = Math.max(best, logp[t * classes + k]);
    }
    return Math.exp(best);
  });
}
