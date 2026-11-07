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
  // An expanded polynomial's signs and its letter (FineNotes#178), lower
  // case on the x-height (0.45 to 1).
  [
    "+",
    { strokes: [line([0.04, 0.56], [0.52, 0.56]), line([0.28, 0.32], [0.28, 0.8])], width: 0.56 },
  ],
  ["x", { strokes: [line([0.04, 0.46], [0.46, 1]), line([0.46, 0.46], [0.04, 1])], width: 0.5 }],
  [
    "y",
    { strokes: [line([0.04, 0.46], [0.27, 0.84]), line([0.5, 0.46], [0.12, 1.24])], width: 0.54 },
  ],
  [
    "a",
    {
      strokes: [arc(0.24, 0.73, 0.2, 0.26, -10, 350, 20), line([0.44, 0.46], [0.46, 1])],
      width: 0.5,
    },
  ],
  [
    "b",
    { strokes: [line([0.06, 0], [0.06, 1]), arc(0.26, 0.73, 0.2, 0.26, 180, 540, 20)], width: 0.5 },
  ],
  [
    "n",
    {
      strokes: [
        line([0.06, 0.46], [0.06, 1]),
        line([0.06, 0.62], [0.2, 0.47], [0.38, 0.48], [0.44, 0.62], [0.44, 1]),
      ],
      width: 0.52,
    },
  ],
  [
    "t",
    {
      strokes: [line([0.2, 0.14], [0.2, 0.94], [0.34, 1]), line([0.02, 0.44], [0.4, 0.44])],
      width: 0.44,
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

/** How wide `text` is when written at `height`, page px (as {@link writeText} advances). */
export function textWidth(text: string, glyphs: GlyphSet, height: number): number {
  let w = 0;
  for (const c of Array.from(text)) {
    const glyph = glyphs.get(c);
    if (glyph) w += (glyph.width + TRACKING) * height;
  }
  return Math.max(0, w - TRACKING * height);
}

/**
 * A fraction written by hand from `x`: `top` over a bar over `bottom`, each
 * 0.8 of `height` tall, centred on each other, the bar at the middle of a
 * digit on `baseline` (where the "=" sits). One stroke per array, page px.
 */
export function writeFraction(
  top: string,
  bottom: string,
  glyphs: GlyphSet,
  at: { x: number; baseline: number; height: number },
): number[][] {
  const h = at.height * 0.8;
  const wt = textWidth(top, glyphs, h);
  const wb = textWidth(bottom, glyphs, h);
  const bar = Math.max(wt, wb) + at.height * 0.3;
  const y = at.baseline - at.height * 0.45;
  const gap = at.height * 0.14;
  return [
    ...writeText(top, glyphs, { x: at.x + (bar - wt) / 2, baseline: y - gap, height: h }),
    [at.x, y, PRESSURE, at.x + bar / 2, y + at.height * 0.01, PRESSURE, at.x + bar, y, PRESSURE],
    ...writeText(bottom, glyphs, { x: at.x + (bar - wb) / 2, baseline: y + gap + h, height: h }),
  ];
}

/**
 * `text` with powers written as they are by hand: each `^` and the digits
 * after it ("8x^2+18x+4") small and raised after its base. One stroke per
 * array, page px.
 */
export function writeWithPowers(
  text: string,
  glyphs: GlyphSet,
  at: { x: number; baseline: number; height: number },
): number[][] {
  const out: number[][] = [];
  let x = at.x;
  const small = at.height * 0.6;
  for (const part of text.split(/(\^[0-9]+)/)) {
    if (!part) continue;
    if (part.startsWith("^")) {
      const digits = part.slice(1);
      out.push(
        ...writeText(digits, glyphs, {
          x,
          baseline: at.baseline - at.height * 0.55,
          height: small,
        }),
      );
      x += textWidth(digits, glyphs, small) + TRACKING * at.height;
    } else {
      out.push(...writeText(part, glyphs, { x, baseline: at.baseline, height: at.height }));
      x += textWidth(part, glyphs, at.height) + TRACKING * at.height;
    }
  }
  return out;
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
