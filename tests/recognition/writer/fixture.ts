import type { PageInk } from "../../../src/recognition/hwr/lines";
import type { WrittenStroke } from "../../../src/recognition/writer/rows";

/** Synthetic handwriting for the Neaten tests: zig-zag letters on a baseline (page px, y down). */

/** x-height and letter width, in page px. */
export const H = 12;
export const W = 10;
const LETTER_GAP = 3;
const WORD_GAP = 16;

let nextId = 0;
let clock = 0;

/** A stroke through `corners` (x right, y up from the baseline), `per` points a side. */
function stroke(
  x: number,
  base: number,
  corners: readonly [number, number][],
  pressure: number,
): PageInk {
  const pts: number[] = [];
  const put = (px: number, py: number): void => {
    pts.push(x + px, base - py, pressure);
  };
  for (let c = 0; c + 1 < corners.length; c++) {
    for (let k = 0; k < 6; k++) {
      const f = k / 6;
      put(
        corners[c][0] + f * (corners[c + 1][0] - corners[c][0]),
        corners[c][1] + f * (corners[c + 1][1] - corners[c][1]),
      );
    }
  }
  put(...corners[corners.length - 1]);
  clock += 300;
  return { id: `s${nextId++}`, tool: "pen", shape: null, t0: clock, pts };
}

export interface Line {
  strokes: PageInk[];
  /** The ids of each word's strokes. */
  words: string[][];
}

/** Letters alternate between a "w" (feet on the baseline) and an "l" (a tall stem). */
export function writerLine(x: number, base: number, words = 4, letters = 4): Line {
  const strokes: PageInk[] = [];
  const out: string[][] = [];
  let n = 0;
  for (let w = 0; w < words; w++) {
    const ids: string[] = [];
    for (let l = 0; l < letters; l++) {
      const pressure = [0.3, 0.5, 0.7][n % 3];
      const s =
        n % 2 === 0
          ? stroke(
              x,
              base,
              [
                [0, H],
                [W / 4, 0],
                [W / 2, H],
                [(3 * W) / 4, 0],
                [W, H],
              ],
              pressure,
            )
          : stroke(
              x,
              base,
              [
                [W / 2, 2 * H],
                [W / 2, 0],
              ],
              pressure,
            );
      strokes.push(s);
      ids.push(s.id);
      n++;
      x += W + LETTER_GAP;
    }
    out.push(ids);
    x += WORD_GAP - LETTER_GAP;
  }
  clock += 2000;
  return { strokes, words: out };
}

/**
 * A written line in model units (y up, x-height 0.389): `words` words of
 * `letters` zig-zag letters, `gap` apart.
 */
export function writtenLine(words = 4, letters = 3, gap = 0.5): WrittenStroke[] {
  const out: WrittenStroke[] = [];
  const h = 0.389;
  const w = 0.3;
  let x = 0.2;
  for (let word = 0; word < words; word++) {
    for (let l = 0; l < letters; l++) {
      const corners: [number, number][] = [
        [0, h],
        [w / 4, 0],
        [w / 2, h],
        [(3 * w) / 4, 0],
        [w, h],
      ];
      const pts: number[] = [];
      for (let c = 0; c + 1 < corners.length; c++) {
        for (let k = 0; k < 6; k++) {
          const f = k / 6;
          pts.push(
            x + corners[c][0] + f * (corners[c + 1][0] - corners[c][0]),
            corners[c][1] + f * (corners[c + 1][1] - corners[c][1]),
          );
        }
      }
      pts.push(x + corners[4][0], corners[4][1]);
      out.push({ pts, word });
      x += w + 0.08;
    }
    x += gap;
  }
  return out;
}

export function xs(pts: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 3) out.push(pts[i]);
  return out;
}

export function ys(pts: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i += 3) out.push(pts[i]);
  return out;
}
