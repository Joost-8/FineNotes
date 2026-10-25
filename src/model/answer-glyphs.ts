/**
 * The letters a calculation note writes its answer in: the writer's own,
 * taken from their symbol practice sheet, or clean drawn ones when there is
 * no sheet (or it lacks a character the answer needs). Clean ones are
 * smooth pen lines, as a careful hand writes them, never seven-segment.
 *
 * A glyph is strokes of [x, y] in a unit box: y = 0 is the top of a digit,
 * y = 1 the baseline, x from 0. `width` is how far the next glyph starts.
 *
 * PURE: no DOM.
 */

import { POINT_STRIDE } from "./document";

export interface Glyph {
  strokes: Array<Array<[number, number]>>;
  width: number;
}

export type GlyphSet = ReadonlyMap<string, Glyph>;

/** Space between glyphs, in digit heights. */
const TRACKING = 0.16;
/** The pressure answer ink is written at: the pens' own width. */
const PRESSURE = 0.5;

/** Points along an ellipse from angle a0 to a1 (degrees, y down: -90 is the top). */
function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  steps = 14,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

const line = (...pts: Array<[number, number]>): Array<[number, number]> => pts;

/** Clean glyphs for everything an answer can hold: digits, sign, point, exponent. */
export const CLEAN_GLYPHS: GlyphSet = new Map<string, Glyph>([
  ["0", { strokes: [arc(0.27, 0.5, 0.25, 0.5, -90, 270, 28)], width: 0.54 }],
  ["1", { strokes: [line([0.06, 0.22], [0.26, 0], [0.26, 1])], width: 0.36 }],
  [
    "2",
    {
      strokes: [[...arc(0.26, 0.27, 0.24, 0.25, -165, 25), [0.03, 1], [0.54, 1]]],
      width: 0.58,
    },
  ],
  [
    "3",
    {
      strokes: [
        [...arc(0.25, 0.25, 0.22, 0.24, -160, 90), ...arc(0.25, 0.74, 0.27, 0.26, -90, 160)],
      ],
      width: 0.56,
    },
  ],
  ["4", { strokes: [line([0.42, 1], [0.42, 0], [0.02, 0.68], [0.56, 0.68])], width: 0.6 }],
  [
    "5",
    {
      strokes: [[[0.5, 0], [0.12, 0], [0.07, 0.46], ...arc(0.27, 0.69, 0.27, 0.3, -130, 150)]],
      width: 0.58,
    },
  ],
  [
    "6",
    {
      strokes: [
        [[0.46, 0.03], [0.26, 0.14], [0.1, 0.38], ...arc(0.28, 0.72, 0.25, 0.28, 180, 540, 24)],
      ],
      width: 0.56,
    },
  ],
  ["7", { strokes: [line([0.02, 0], [0.54, 0], [0.18, 1])], width: 0.56 }],
  [
    "8",
    {
      strokes: [
        arc(0.28, 0.25, 0.21, 0.24, 90, 450, 20),
        arc(0.28, 0.74, 0.26, 0.26, -90, 270, 22),
      ],
      width: 0.58,
    },
  ],
  [
    "9",
    {
      strokes: [[...arc(0.27, 0.29, 0.24, 0.28, 0, 360, 22), [0.5, 0.6], [0.4, 1]]],
      width: 0.56,
    },
  ],
  [".", { strokes: [line([0.06, 0.97], [0.08, 0.99])], width: 0.16 }],
  [",", { strokes: [line([0.09, 0.9], [0.04, 1.12])], width: 0.16 }],
  ["-", { strokes: [line([0.04, 0.56], [0.4, 0.56])], width: 0.46 }],
  ["/", { strokes: [line([0.42, 0], [0.04, 1])], width: 0.48 }],
  [
    "E",
    {
      strokes: [line([0.44, 0], [0.02, 0], [0.02, 1], [0.44, 1]), line([0.02, 0.5], [0.36, 0.5])],
      width: 0.5,
    },
  ],
]);

/** A character sample from the symbol sheet: its strokes in page px, and the line it was written on. */
export interface RawSample {
  symbol: string;
  /** Each stroke's flat `[x, y, pressure, …]`. */
  strokes: ReadonlyArray<ArrayLike<number>>;
  /** The rule it was written above, page px. */
  baseline: number;
}

function boxOf(strokes: ReadonlyArray<ArrayLike<number>>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pts of strokes) {
    for (let i = 0; i + 1 < pts.length; i += POINT_STRIDE) {
      minX = Math.min(minX, pts[i]);
      maxX = Math.max(maxX, pts[i]);
      minY = Math.min(minY, pts[i + 1]);
      maxY = Math.max(maxY, pts[i + 1]);
    }
  }
  return { minX, minY, maxX, maxY };
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The writer's glyphs from their symbol sheet: each character's last sample,
 * scaled so their digits are one unit tall. A digit sits on its own lowest
 * point; a point, comma or minus sits where the digits sat above their rule,
 * so it keeps its height on the line. Empty without digits to measure by.
 */
export function glyphsFromSamples(samples: readonly RawSample[]): Map<string, Glyph> {
  const out = new Map<string, Glyph>();
  const usable = samples.filter((s) => s.strokes.some((p) => p.length >= POINT_STRIDE));
  const digits = usable.filter((s) => /^[0-9]$/.test(s.symbol));
  if (digits.length === 0) return out;
  const boxes = digits.map((s) => boxOf(s.strokes));
  const unit = median(boxes.map((b) => b.maxY - b.minY));
  if (!(unit > 0)) return out;
  // How far above its rule the writer's digits end, in page px.
  const lift = median(boxes.map((b, i) => digits[i].baseline - b.maxY));
  for (const sample of usable) {
    const box = boxOf(sample.strokes);
    const digit = /^[0-9]$/.test(sample.symbol);
    const base = digit ? box.maxY : sample.baseline - lift;
    const strokes = sample.strokes.map((pts) => {
      const out: Array<[number, number]> = [];
      for (let i = 0; i + 1 < pts.length; i += POINT_STRIDE) {
        out.push([(pts[i] - box.minX) / unit, 1 + (pts[i + 1] - base) / unit]);
      }
      return out;
    });
    out.set(sample.symbol, { strokes, width: Math.max(0.12, (box.maxX - box.minX) / unit) });
  }
  return out;
}

/**
 * The glyphs to write `text` in: the writer's when they have every
 * character of it (one hand throughout, never a mix), else the clean ones.
 * Null when even the clean set lacks a character.
 */
export function glyphsFor(text: string, own: GlyphSet | null): GlyphSet | null {
  const chars = Array.from(text);
  if (own && chars.every((c) => own.has(c))) return own;
  return chars.every((c) => CLEAN_GLYPHS.has(c)) ? CLEAN_GLYPHS : null;
}

/**
 * `text` written in `glyphs` from `x`, its digits `height` tall on
 * `baseline`: one `[x, y, pressure, …]` array per stroke, page px.
 */
export function writeText(
  text: string,
  glyphs: GlyphSet,
  at: { x: number; baseline: number; height: number },
): number[][] {
  const strokes: number[][] = [];
  let x = at.x;
  const top = at.baseline - at.height;
  for (const c of Array.from(text)) {
    const glyph = glyphs.get(c);
    if (!glyph) continue;
    for (const s of glyph.strokes) {
      const pts: number[] = [];
      for (const [gx, gy] of s) pts.push(x + gx * at.height, top + gy * at.height, PRESSURE);
      // A single point is a dot: give it a second, so it draws.
      if (pts.length === POINT_STRIDE) pts.push(pts[0] + 0.01, pts[1], PRESSURE);
      if (pts.length > 0) strokes.push(pts);
    }
    x += (glyph.width + TRACKING) * at.height;
  }
  return strokes;
}
