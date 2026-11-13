/**
 * The scratch page a tip's Try it opens: one page of the notebook paper the
 * user last chose, with a few lines of writing on it, so a gesture that acts
 * on ink (circle to select, scribble to erase) has something to act on. It
 * is a file of its own, overwritten each time and put in the trash when the
 * try ends, so nothing done there reaches a real note. PURE.
 */

import { ASSETS_FOLDER } from "./vault-folders";
import { type InkDocument, type Stroke, POINT_STRIDE } from "./document";
import { type NotebookChoices, buildNewDocument } from "./new-notebook";

/** Where the scratch page is written, beside FineNotes' other own files. */
export const TRY_PAGE_PATH = `${ASSETS_FOLDER}/Try a gesture.notebook.md`;

/** The writing's ink: the default soft black, at an ordinary pen's width. */
const INK = "#1a1a1a";
const INK_SIZE = 2.5;

/** Words per line, as fractions of the line's width: a short sentence of different lengths. */
const LINES: readonly (readonly number[])[] = [
  [0.16, 0.09, 0.22, 0.12, 0.14],
  [0.2, 0.11, 0.08, 0.18, 0.1],
  [0.13, 0.24, 0.1, 0.15],
];

/**
 * A word drawn as joined loops, as quick cursive ("eeee") looks from afar:
 * a curtate cycloid turned so each loop closes at the top, along `width`
 * at baseline `y`, `size` px tall. Deterministic.
 */
export function scribbledWord(x: number, y: number, width: number, size: number): number[] {
  const loops = Math.max(2, Math.round(width / (size * 0.9)));
  const steps = loops * 12;
  // Forward speed per radian, and a backward swing larger than it at the
  // top of each turn, which is what closes the loop there.
  const pace = width / (loops * 2 * Math.PI);
  const swing = pace * 1.6;
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * loops * 2 * Math.PI;
    // A slow rise and fall across the word, so letters differ in height.
    const tall = 1 + 0.25 * Math.sin((i / steps) * Math.PI * 3);
    const px = x + pace * a + swing * Math.sin(a);
    const py = y - (1 - Math.cos(a)) * 0.5 * size * tall;
    pts.push(Math.round(px * 100) / 100, Math.round(py * 100) / 100, 0.5);
  }
  return pts;
}

/**
 * Three lines of writing in the top half of a page `width` by `height`,
 * starting below the hint that sits over the page's top.
 */
export function sampleWriting(width: number, height: number): Stroke[] {
  const margin = width * 0.1;
  const line = width - 2 * margin;
  const gap = line * 0.03;
  const size = Math.max(10, height * 0.018);
  const strokes: Stroke[] = [];
  LINES.forEach((words, row) => {
    let x = margin;
    const y = height * (0.3 + row * 0.07);
    for (const share of words) {
      const w = line * share;
      strokes.push({
        id: `s${strokes.length + 1}`,
        color: INK,
        size: INK_SIZE,
        tool: "pen",
        pts: scribbledWord(x, y, w, size),
      });
      x += w + gap;
    }
  });
  return strokes;
}

/** The scratch notebook: one page of `choices`' paper with writing on it, no cover. */
export function tryPageDocument(choices: NotebookChoices, title: string): InkDocument {
  const doc = buildNewDocument({ ...choices, type: "notebook", cover: "none" }, title);
  const first = doc.pages[0];
  if (first) first.strokes = sampleWriting(first.geometry.width, first.geometry.height);
  return doc;
}

/** Points in a stroke's flat array, for tests and bounds. */
export function pointCount(stroke: Stroke): number {
  return Math.floor(stroke.pts.length / POINT_STRIDE);
}
