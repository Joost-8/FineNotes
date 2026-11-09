/**
 * The moving pictures of Tips and What's new, as data. PURE.
 *
 * A picture is a little loop drawn on a 320 x 180 sheet: shapes, each with
 * tracks saying how it moves over one loop (offset 0 to 1). The plugin ships
 * no image files, so a scene is ink and marks, and costs a few hundred bytes.
 * The pages in them are a student's biology notes, written by a single-stroke
 * hand so the pen can write them as it does ink.
 */

export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 180;
/** One loop of every picture, in ms. */
export const SCENE_MS = 5200;

export type Tone =
  | "ink"
  | "print"
  | "accent"
  | "red"
  | "green"
  | "blue"
  | "mark"
  | "rule"
  | "soft"
  | "desk"
  | "page";

/** A value over one loop: `[offset, value]` pairs, offsets ascending. */
export type Track = ReadonlyArray<readonly [number, number]>;

export interface Motion {
  opacity?: Track;
  /** How much of a path is drawn, 0 to 1. */
  draw?: Track;
  x?: Track;
  y?: Track;
  rotate?: Track;
  scale?: Track;
}

interface Painted {
  tone: Tone;
  motion?: Motion;
  fill?: boolean;
  width?: number;
  dashed?: boolean;
}

export type SceneShape =
  | (Painted & {
      kind: "path";
      d: string;
      /** The offsets between which a pen rides along this path. */
      pen?: readonly [number, number];
      /** A fingertip rides instead of the pen. */
      rider?: "pen" | "finger";
    })
  | (Painted & { kind: "rect"; x: number; y: number; w: number; h: number; r?: number })
  | (Painted & { kind: "circle"; cx: number; cy: number; r: number })
  | (Painted & {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      /** The width the text is set to, whatever font the device has. */
      fit?: number;
      face?: "typed" | "print";
    })
  | {
      kind: "group";
      motion?: Motion;
      /** A fixed position and size, under whatever moves it. */
      place?: { x: number; y: number; scale: number };
      children: SceneShape[];
    };

export interface TipScene {
  /** The offset that reads best as a still, for reduced motion and off-screen pictures. */
  rest: number;
  shapes: SceneShape[];
}

// --- Keyframes ---------------------------------------------------------------

export interface SceneKeyframe {
  offset: number;
  [property: string]: number | string;
}

/** The value of a track at `t`, straight between its points. */
export function sampleTrack(track: Track, t: number): number {
  const first = track[0];
  if (!first) return 0;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < track.length; i++) {
    const [at, value] = track[i];
    if (t <= at) {
      const [fromAt, from] = track[i - 1];
      return at === fromAt ? value : from + ((t - fromAt) / (at - fromAt)) * (value - from);
    }
  }
  return track[track.length - 1][1];
}

function offsetsOf(tracks: ReadonlyArray<Track | undefined>): number[] {
  const offsets = new Set<number>([0, 1]);
  for (const track of tracks) for (const [at] of track ?? []) offsets.add(at);
  return [...offsets].sort((a, b) => a - b);
}

function frames(track: Track, make: (value: number) => number | string, key: string) {
  return offsetsOf([track]).map((offset): SceneKeyframe => {
    return { offset, [key]: make(sampleTrack(track, offset)) };
  });
}

/**
 * The Web Animations keyframes of a motion, one list per animated property.
 * Position, turn and size are one `transform`, so they cannot override each
 * other.
 */
export function motionKeyframes(motion: Motion): SceneKeyframe[][] {
  const lists: SceneKeyframe[][] = [];
  if (motion.opacity) lists.push(frames(motion.opacity, (v) => v, "opacity"));
  if (motion.draw) lists.push(frames(motion.draw, (v) => 1 - v, "strokeDashoffset"));
  const { x, y, rotate, scale } = motion;
  if (x || y || rotate || scale) {
    lists.push(
      offsetsOf([x, y, rotate, scale]).map((offset) => {
        const dx = x ? sampleTrack(x, offset) : 0;
        const dy = y ? sampleTrack(y, offset) : 0;
        const turn = rotate ? sampleTrack(rotate, offset) : 0;
        const size = scale ? sampleTrack(scale, offset) : 1;
        return {
          offset,
          transform: `translate(${dx}px, ${dy}px) rotate(${turn}deg) scale(${size})`,
        };
      }),
    );
  }
  return lists;
}

/** A pen's opacity over the loop: there only while it rides its path. */
export function penPresence(from: number, to: number): Track {
  return [
    [0, 0],
    [Math.max(0, from - 0.03), 0],
    [from, 1],
    [to, 1],
    [Math.min(1, to + 0.04), 0],
    [1, 0],
  ];
}

// --- Building blocks ---------------------------------------------------------

const END = 0.95;

/** Hidden until `a`, then shown until `out`. */
function shownFrom(a: number, out = END): Track {
  return [
    [0, 0],
    [a, 0],
    [a + 0.02, 1],
    [out, 1],
    [Math.min(1, out + 0.03), 0],
    [1, 0],
  ];
}

/** Shown until `b`, gone, and back in time for the next loop. */
function shownUntil(b: number): Track {
  return [
    [0, 1],
    [b, 1],
    [b + 0.03, 0],
    [0.95, 0],
    [0.98, 1],
    [1, 1],
  ];
}

function drawnBetween(a: number, b: number): Track {
  return [
    [0, 0],
    [a, 0],
    [b, 1],
    [1, 1],
  ];
}

/** Still, then moved to `value` between `a` and `b`, and put back when the loop ends. */
function movedTo(value: number, a: number, b: number, from = 0): Track {
  return [
    [0, from],
    [a, from],
    [b, value],
    [END, value],
    [0.98, from],
    [1, from],
  ];
}

function rng(seed: number): () => number {
  let state = seed * 2654435761;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** The humps of an unsteady hand, for a line that is not writing. */
function humps(x: number, y: number, width: number, seed: number, height: number): string {
  const random = rng(seed);
  let at = x;
  let d = `M${x} ${y}`;
  while (at < x + width) {
    const step = height * 0.75 + random() * height * 0.55;
    const top = y - height * 0.72 - random() * 3;
    d += ` C${round(at + step * 0.08)} ${round(y)} ${round(at + step * 0.2)} ${round(top)}`;
    d += ` ${round(at + step * 0.52)} ${round(top)}`;
    d += ` S${round(at + step * 0.72)} ${round(y + 2.5)} ${round(at + step)} ${round(y)}`;
    at += step;
  }
  return d;
}

/**
 * A single-stroke handwriting: each letter a pen path from the last letter's
 * end to its own, so the words write themselves like ink. x-height 9, baseline
 * 0, y down. `[advance, path]`; a path's first segment joins from the pen.
 */
export const LETTERS: Readonly<Record<string, readonly [number, string]>> = {
  a: [12, "C3 -5 6 -9 9 -9C5 -11 1 -8 1 -4C1 0 6 0 9 -9C8 -5 8 0 12 -2"],
  b: [12, "C3 -3 8 -12 8 -17C8 -21 5 -20 4 -15L3 -1C4 -6 8 -9 9 -8C11 -6 8 0 4 -1C6 -2 9 -3 12 -3"],
  c: [10, "C0.5 -4 3 -9 7 -9C4.5 -10 1.2 -8 1.2 -4C1.2 0 6 1 10 -2"],
  d: [13, "C3 -5 6 -9 9 -9C5 -11 1 -8 1 -4C1 0 6 0 9 -9L10 -19C9 -12 8 -1 13 -2"],
  e: [10, "C5 -2 9 -5 8 -8C7 -10 3 -9 2 -5C1 -1 5 1 10 -2"],
  f: [10, "C3 -3 8 -12 8 -17C8 -21 5 -20 4 -15C3 -8 3 0 3 6C3 9 6 6 5 3C4 0 8 -1 10 -3"],
  g: [12, "C3 -5 6 -9 9 -9C5 -11 1 -8 1 -4C1 0 6 0 9 -9C9 -3 9 4 7 7C5 10 1 8 4 3C6 0 10 -1 12 -2"],
  h: [
    14,
    "C3 -3 8 -12 8 -17C8 -21 5 -20 4 -15L3 0C4 -5 7 -9 9 -9C11 -9 10 -4 10 -2C10 -1 12 -1 14 -3",
  ],
  i: [8, "C2 -3 3 -7 4 -9C3 -5 3 -1 5 -1C6 -1 7 -2 8 -3M4 -13L4.3 -12.5M8 -3"],
  j: [8, "C2 -3 3 -7 4 -9C4 -3 4 4 2 7C0 10 -2 7 2 3C4 1 7 -1 8 -3M4 -13L4.3 -12.5M8 -3"],
  k: [
    13,
    "C3 -3 8 -12 8 -17C8 -21 5 -20 4 -15L3 0C4 -5 8 -10 9 -8C10 -6 6 -5 4 -5C7 -4 8 -1 10 -1C11 -1 12 -2 13 -3",
  ],
  l: [10, "C3 -3 8 -12 8 -17C8 -21 5 -20 4 -15C3 -9 3 -1 6 -1C8 -1 9 -2 10 -3"],
  m: [
    19,
    "C1 -3 3 -7 3 -9L3 0C4 -5 6 -9 8 -9C10 -9 9 -4 9 0C10 -5 12 -9 14 -9C16 -9 15 -4 15 -2C15 -1 17 -1 19 -3",
  ],
  n: [14, "C1 -3 3 -7 3 -9L3 0C4 -5 7 -9 9 -9C11 -9 10 -4 10 -2C10 -1 12 -1 14 -3"],
  o: [12, "C3 -5 6 -9 8 -9C4 -10 1 -7 1 -4C1 0 7 1 8 -5C8 -8 6 -9 5 -8C7 -6 10 -3 12 -3"],
  p: [12, "C2 -3 3 -7 4 -9L2 8C3 -3 6 -9 9 -9C12 -8 9 0 5 -1C7 -2 10 -3 12 -3"],
  q: [12, "C3 -5 6 -9 9 -9C5 -11 1 -8 1 -4C1 0 6 0 9 -9L8 8C9 2 10 -1 12 -3"],
  r: [12, "C2 -3 3 -6 4 -9C5 -8 7 -8 8 -9C7 -6 7 -2 9 -2C10 -2 11 -2.5 12 -3"],
  s: [10, "C2 -3 4 -6 6 -10C8 -6 9 -2 6 0C4 1 2 0 2 -1C4 -1 7 -2 10 -3"],
  t: [10, "C2 -3 4 -10 5 -17C4 -10 3 -1 6 -1C8 -1 9 -2 10 -3M1 -10L9 -11M10 -3"],
  u: [14, "C2 -3 3 -7 3 -9C2 -4 2 -1 5 -1C7 -1 9 -6 10 -9C9 -5 9 -1 11 -1C12 -1 13 -2 14 -3"],
  v: [14, "C2 -3 3 -7 4 -9C4 -5 5 -1 7 -1C9 -2 11 -6 10 -9C12 -7 13 -6 14 -6"],
  w: [
    18,
    "C2 -3 3 -7 3 -9C2 -4 3 -1 5 -1C7 -1 8 -5 9 -8C8 -4 9 -1 11 -1C13 -2 15 -6 14 -9C16 -7 17 -6 18 -6",
  ],
  x: [11, "C2 -4 6 -9 8 -9C6 -6 7 0 11 -2M10 -8L3 -0.5M11 -2"],
  y: [
    12,
    "C2 -3 3 -7 3 -9C2 -4 2 -1 5 -1C7 -1 9 -6 10 -9C10 -3 10 4 8 7C6 10 2 8 5 3C7 0 10 -1 12 -3",
  ],
  z: [11, "C3 -4 5 -9 8 -9L2 0C5 -2 8 0 11 -3"],
  A: [16, "M0 0L7 -18L14 0M3 -7L11 -7M16 0"],
  D: [15, "M1 0L1 -18C12 -18 14 -4 1 0M15 0"],
  N: [16, "M0 0L1 -18L12 0L13 -18M16 0"],
  P: [12, "M1 0L1 -18C11 -19 11 -8 1 -9M12 0"],
  R: [13, "M1 0L1 -18C10 -19 10 -9 1 -9L11 0M13 0"],
  T: [15, "M0 -18L14 -18M7 -18L7 0M15 0"],
  " ": [7, "M7 -2"],
};

/** What the pictures' pages say. Their lengths cover the widths scenes ask for. */
export const BIOLOGY: readonly string[] = [
  "cell",
  "gene",
  "DNA",
  "RNA",
  "ATP",
  "lipid",
  "virus",
  "algae",
  "tissue",
  "enzyme",
  "mitosis",
  "meiosis",
  "osmosis",
  "protein",
  "nucleus",
  "ribosome",
  "membrane",
  "organism",
  "bacteria",
  "chromosome",
  "chloroplast",
  "mitochondria",
  "cell membrane",
  "the cell cycle",
  "active transport",
  "golgi apparatus",
  "photosynthesis",
  "gene expression",
  "the krebs cycle",
  "DNA replication",
  "natural selection",
  "protein synthesis",
  "cells divide by mitosis",
  "cellular respiration",
  "the nucleus holds the DNA",
  "endoplasmic reticulum",
  "ribosomes build proteins",
  "plants make sugar from light",
  "mitochondria make ATP for cells",
  "enzymes lower activation energy",
  "every cell comes from another cell",
];

const widthOf = (text: string): number =>
  [...text].reduce((sum, letter) => sum + (LETTERS[letter]?.[0] ?? 7), 0);

/** `text` as one pen path starting at (x, y), filling `width` where it can. */
export function handwrite(text: string, x: number, y: number, width: number, height = 12): string {
  const unit = (height * 0.85) / 9;
  const stretch = Math.min(1.3, Math.max(0.65, width / Math.max(1, widthOf(text) * unit)));
  const sx = unit * stretch;
  const random = rng(text.length * 7 + 3);
  let at = x;
  let d = `M${round(x)} ${round(y)}`;
  for (const letter of text) {
    const [advance, path] = LETTERS[letter] ?? LETTERS[" "];
    const lift = (random() - 0.5) * height * 0.08;
    d += path.replace(/([MLC])([^MLC]+)/g, (_, command: string, numbers: string) => {
      const values = numbers.trim().split(/\s+/).map(Number);
      const placed = values.map((value, i) =>
        round(i % 2 === 0 ? at + value * sx : y + lift + value * unit),
      );
      return command + placed.join(" ");
    });
    at += advance * sx;
  }
  return d;
}

/** Some biology about as wide as `width`, in handwriting; `seed` picks among the nearest. */
export function scrawl(x: number, y: number, width: number, seed = 1, height = 12): string {
  const unit = (height * 0.85) / 9;
  const distance = (text: string): number => Math.abs(Math.log((widthOf(text) * unit) / width));
  const nearest = [...BIOLOGY].sort((a, b) => distance(a) - distance(b)).slice(0, 5);
  return handwrite(nearest[seed % nearest.length], x, y, width, height);
}

/** A scribble: passes straight up and down, stepping along. */
export function zigzag(x: number, top: number, bottom: number, passes: number, width: number) {
  const step = width / passes;
  let d = `M${x} ${bottom}`;
  for (let i = 1; i <= passes; i++) {
    d += `L${round(x + i * step)} ${i % 2 ? top : bottom}`;
  }
  return d;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
}

function ink(d: string, motion?: Motion, pen?: readonly [number, number]): SceneShape {
  return { kind: "path", d, tone: "ink", width: 2.6, motion, pen };
}

/** Handwriting that writes itself between `a` and `b`, gone again at the end. */
function written(d: string, a: number, b: number, pen = true): SceneShape {
  return ink(d, { draw: drawnBetween(a, b), opacity: shownFrom(a) }, pen ? [a, b] : undefined);
}

function ruledPaper(): SceneShape[] {
  return [46, 78, 110, 142].map((y) => ({
    kind: "path",
    d: `M0 ${y}H320`,
    tone: "rule",
    width: 1,
  }));
}

const PRINT_WORDS = [
  "of",
  "the",
  "in",
  "and",
  "cell",
  "gene",
  "into",
  "each",
  "with",
  "form",
  "cells",
  "which",
  "plant",
  "water",
  "sugar",
  "lipid",
  "virus",
  "spore",
  "fungi",
  "light",
  "acids",
  "roots",
  "enzyme",
  "oxygen",
  "glucose",
  "hormone",
  "energy",
  "carbon",
  "tissue",
  "protein",
  "nucleus",
  "mitosis",
  "osmosis",
  "membrane",
  "organism",
  "bacteria",
  "ribosome",
  "cytoplasm",
  "organelle",
  "metabolism",
  "chromosome",
  "chloroplast",
  "respiration",
];

/** A word as long as a printed gap of `w`, varying with `index`. */
/** Roughly how wide a serif sets each letter, in em; the rest count as 0.55. */
const PRINT_EM: Record<string, number> = {
  " ": 0.26,
  i: 0.29,
  j: 0.29,
  l: 0.29,
  f: 0.34,
  t: 0.35,
  r: 0.41,
  s: 0.43,
  a: 0.5,
  c: 0.46,
  e: 0.48,
  g: 0.51,
  z: 0.45,
  k: 0.53,
  v: 0.5,
  x: 0.5,
  y: 0.5,
  m: 0.88,
  w: 0.75,
};
const PRINT_SIZE = 11;

const printWidth = (text: string): number =>
  [...text].reduce((sum, letter) => sum + (PRINT_EM[letter] ?? 0.57), 0) * PRINT_SIZE;

type Print = readonly [text: string, width: number];
const sized = (text: string): Print => [text, printWidth(text)];
const SMALL_WORDS = PRINT_WORDS.slice(0, 4);
const PRINT_SINGLES: readonly Print[] = PRINT_WORDS.map(sized);
/** For the gaps no word fills: a small word before a noun, "in water". */
const PRINT_PAIRS: readonly Print[] = SMALL_WORDS.flatMap((small) =>
  PRINT_WORDS.slice(10).map((noun) => sized(`${small} ${noun}`)),
);

/**
 * Print as wide as a gap of `w`, varying with `index`, never `after` twice
 * running. Set to the gap it is stretched or squeezed, so only what a serif
 * sets within a twelfth of the gap is offered: letters of one size across a
 * page, on any device's font. One word where one fits.
 */
function printWord(w: number, index: number, after = ""): string {
  const near = (from: readonly Print[]): Print[] =>
    from.filter(([text, width]) => text !== after && Math.abs(width - w) <= w / 12);
  let pool = near(PRINT_SINGLES);
  if (pool.length === 0) pool = near(PRINT_PAIRS);
  if (pool.length === 0) {
    pool = [...PRINT_SINGLES, ...PRINT_PAIRS]
      .filter(([text]) => text !== after)
      .sort((x, y) => Math.abs(x[1] - w) - Math.abs(y[1] - w))
      .slice(0, 1);
  }
  return pool[(index * 7) % pool.length][0];
}

/** Typed text across `w`, its top where a bar of that width would be. */
function typed(
  text: string,
  x: number,
  y: number,
  w: number,
  tone: Tone = "ink",
  motion?: Motion,
): SceneShape {
  const size = Math.min(12.5, (w / Math.max(1, text.length)) * 2.05);
  return { kind: "text", x, y: y + 9, text, size, fit: w, face: "typed", tone, motion };
}

/** Rows of printed words: a page of a textbook. */
function printed(rows: ReadonlyArray<readonly [y: number, widths: readonly number[]]>, left = 34) {
  const shapes: SceneShape[] = [];
  let index = 0;
  let last = "";
  for (const [y, widths] of rows) {
    let x = left;
    for (const w of widths) {
      last = printWord(w, index, last);
      shapes.push({
        kind: "text",
        x,
        y: y + 8,
        text: last,
        size: PRINT_SIZE,
        fit: w,
        face: "print",
        tone: "print",
      });
      index += 1;
      x += w + 7;
    }
  }
  return shapes;
}

const PRINT: ReadonlyArray<readonly [number, readonly number[]]> = [
  [38, [34, 58, 26, 66, 40]],
  [68, [48, 30, 74, 36, 52]],
  [98, [26, 62, 44, 70, 30]],
  [128, [58, 36, 52, 44, 42]],
];

/** Finger touches at the given offsets. */
function taps(x: number, y: number, at: readonly number[]): SceneShape {
  const opacity: Array<readonly [number, number]> = [[0, 0]];
  const scale: Array<readonly [number, number]> = [[0, 0.6]];
  for (const t of at) {
    opacity.push([t - 0.03, 0], [t, 0.5], [t + 0.03, 0.5], [t + 0.06, 0]);
    scale.push([t - 0.03, 0.6], [t, 1], [t + 0.03, 1], [t + 0.06, 0.6]);
  }
  opacity.push([1, 0]);
  scale.push([1, 0.6]);
  return {
    kind: "circle",
    cx: x,
    cy: y,
    r: 16,
    tone: "accent",
    fill: true,
    motion: { opacity, scale },
  };
}

/** The ring that says "the pen is holding still". */
function holdRing(x: number, y: number, a: number, b: number): SceneShape {
  return {
    kind: "circle",
    cx: x,
    cy: y,
    r: 18,
    tone: "accent",
    width: 3,
    motion: {
      opacity: [
        [0, 0],
        [a, 0],
        [(a + b) / 2, 0.8],
        [b, 0],
        [1, 0],
      ],
      scale: [
        [0, 0.5],
        [a, 0.5],
        [b, 1.3],
        [1, 1.3],
      ],
    },
  };
}

/** A selection's dashed box and corner squares. */
function selection(x: number, y: number, w: number, h: number): SceneShape[] {
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  return [
    { kind: "rect", x, y, w, h, tone: "accent", width: 1.5, dashed: true },
    ...corners.map(([cx, cy]): SceneShape => ({
      kind: "rect",
      x: cx - 4,
      y: cy - 4,
      w: 8,
      h: 8,
      r: 2,
      tone: "accent",
      fill: true,
    })),
  ];
}

const swatch = (cx: number, cy: number, tone: Tone, motion?: Motion): SceneShape => ({
  kind: "circle",
  cx,
  cy,
  r: 11,
  tone,
  fill: true,
  motion,
});

const miniPage = (x: number, y: number, motion?: Motion): SceneShape => ({
  kind: "rect",
  x,
  y,
  w: 64,
  h: 86,
  r: 4,
  tone: "page",
  fill: true,
  motion,
});

function searchPill(typeA: number, typeB: number): SceneShape[] {
  return [
    { kind: "rect", x: 60, y: 12, w: 200, h: 30, r: 10, tone: "page", fill: true },
    { kind: "rect", x: 60, y: 12, w: 200, h: 30, r: 10, tone: "soft", width: 1 },
    { kind: "circle", cx: 79, cy: 26, r: 5.5, tone: "soft", width: 2 },
    { kind: "path", d: "M83 30l5 5", tone: "soft", width: 2 },
    written(handwrite("mitosis", 100, 32, 62, 9), typeA, typeB, false),
  ];
}

// --- A kit for the pictures of the interface ----------------------------------

const between = (a: number, b: number): Track => [
  [0, 0],
  [a, 0],
  [a + 0.02, 1],
  [b, 1],
  [b + 0.02, 0],
  [1, 0],
];

function sc(rest: number, ...shapes: Array<SceneShape | SceneShape[]>): TipScene {
  return { rest, shapes: shapes.flat() };
}

const desk = (): SceneShape => ({
  kind: "rect",
  x: 0,
  y: 0,
  w: 320,
  h: 180,
  tone: "desk",
  fill: true,
});

const word = (x: number, y: number, w: number, seed: number, h = 12, motion?: Motion): SceneShape =>
  ink(scrawl(x, y, w, seed, h), motion);

function box(
  x: number,
  y: number,
  w: number,
  h: number,
  tone: Tone = "page",
  r = 4,
  motion?: Motion,
): SceneShape {
  return { kind: "rect", x, y, w, h, r, tone, fill: true, motion };
}

function frame(
  x: number,
  y: number,
  w: number,
  h: number,
  tone: Tone = "soft",
  r = 4,
  motion?: Motion,
  dashed = false,
): SceneShape {
  return { kind: "rect", x, y, w, h, r, tone, width: 1.5, dashed, motion };
}

const dot = (cx: number, cy: number, r: number, tone: Tone, motion?: Motion): SceneShape => ({
  kind: "circle",
  cx,
  cy,
  r,
  tone,
  fill: true,
  motion,
});

const group = (
  motion: Motion | undefined,
  ...children: Array<SceneShape | SceneShape[]>
): SceneShape => ({
  kind: "group",
  motion,
  children: children.flat(),
});

const line = (d: string, tone: Tone, width = 2, motion?: Motion): SceneShape => ({
  kind: "path",
  d,
  tone,
  width,
  motion,
});

const ICONS = {
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  magnet: "M6 3v9a6 6 0 0 0 12 0V3h-4v9a2 2 0 0 1-4 0V3zM6 7h4M14 7h4",
  camera: "M3 8h4l2-3h6l2 3h4v11H3zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  check: "M4 12l5 5L20 6",
  speech: "M3 4h18v13H9l-5 4v-4H3z",
  eraser: "M8 20l-5-5L14 4l7 7-9 9zM3 15l6 6M12 20h9",
  pen: "M4 20l1-5L17 3l4 4L9 19z",
  folder: "M3 6h6l2 3h10v11H3z",
  file: "M6 2h9l5 5v15H6zM15 2v5h5",
} as const;

function icon(
  name: keyof typeof ICONS,
  x: number,
  y: number,
  tone: Tone = "ink",
  size = 24,
  motion?: Motion,
): SceneShape {
  return {
    kind: "group",
    place: { x: x - size / 2, y: y - size / 2, scale: size / 24 },
    motion,
    children: [{ kind: "path", d: ICONS[name], tone, width: 2 }],
  };
}

/** A small menu of bars; `pick` is the row a tap lands on. */
function popover(x: number, y: number, w: number, rows: number, a: number, b: number, pick = -1) {
  const h = 16 + rows * 22;
  return group(
    { opacity: between(a, b) },
    box(x, y, w, h, "page", 10),
    frame(x, y, w, h, "soft", 10),
    Array.from({ length: rows }, (_, i): SceneShape => {
      const label = ["Paste", "Text box", "Select all"][i % 3];
      return typed(
        label,
        x + 14,
        y + 13 + i * 22,
        label.length * 6.2,
        i === pick ? "accent" : "print",
      );
    }),
  );
}

const penStick = (x: number, tone: Tone, motion?: Motion): SceneShape =>
  group(motion, box(x - 7, 56, 14, 52, tone, 4), {
    kind: "path",
    d: `M${x - 7} 108L${x} 126L${x + 7} 108Z`,
    tone,
    fill: true,
  });

const toolbarRow = (y = 14): SceneShape[] => [
  box(44, y, 232, 36, "page", 18),
  frame(44, y, 232, 36, "soft", 18),
  ...[0, 1, 2, 3, 4].map((i) => box(70 + i * 40, y + 9, 18, 18, "soft", 5)),
];

const LIFT: Track = [
  [0, 1],
  [0.2, 1],
  [0.3, 1.12],
  [0.72, 1.12],
  [0.8, 1],
  [1, 1],
];

const NOTES = [
  "Cells are the basic unit of life.",
  "Every cell comes from a cell.",
  "DNA carries the genetic code.",
  "Enzymes speed up reactions.",
];
const SHORT_NOTES = ["Cell theory", "Mitosis", "Meiosis", "Genes"];

const textBars = (x: number, y: number, rows: number, w = 150): SceneShape[] =>
  Array.from({ length: rows }, (_, i) => {
    const width = w - (i % 2) * 34;
    return typed((width < 110 ? SHORT_NOTES : NOTES)[i % 4], x, y + i * 18, width, "print");
  });

function keyCap(x: number, y: number, w: number, label: string): SceneShape[] {
  return [
    box(x, y, w, 36, "page", 8),
    frame(x, y, w, 36, "soft", 8),
    {
      kind: "text",
      x: x + w / 2 - label.length * 5,
      y: y + 24,
      text: label,
      size: 17,
      tone: "ink",
    },
  ];
}

const tableGrid = (
  x: number,
  y: number,
  cols: number,
  rows: number,
  cw = 56,
  rh = 28,
): SceneShape[] => [
  frame(x, y, cols * cw, rows * rh, "ink", 0),
  ...Array.from({ length: cols - 1 }, (_, i) =>
    line(`M${x + (i + 1) * cw} ${y}V${y + rows * rh}`, "ink", 1.2),
  ),
  ...Array.from({ length: rows - 1 }, (_, i) =>
    line(`M${x} ${y + (i + 1) * rh}H${x + cols * cw}`, "ink", 1.2),
  ),
];

const HEART =
  "M160 142C110 104 100 70 126 56C142 48 156 60 160 74C164 60 180 48 196 56C222 70 212 104 160 142Z";
const WOBBLY_HEART =
  "M160 144C106 106 96 68 124 56C144 46 154 58 161 76C166 56 184 46 198 57C226 74 208 108 158 146";
const AXES = "M40 150H284M60 166V20";
const CURVE = "M60 138C110 130 150 110 180 76C200 54 230 34 272 28";

// --- The pictures ------------------------------------------------------------

const WOBBLY_RING =
  "M112 62C128 40 186 36 208 58C232 82 226 128 196 142C164 156 116 148 102 118C92 96 100 74 118 58";

const FOUND: Motion = { opacity: shownFrom(0.48) };

const SCENES = {
  hold: {
    rest: 0.75,
    shapes: [
      ink(WOBBLY_RING, { draw: drawnBetween(0.03, 0.34), opacity: shownUntil(0.52) }, [0.03, 0.34]),
      holdRing(118, 58, 0.36, 0.54),
      ink(ellipsePath(162, 92, 64, 56), { opacity: shownFrom(0.53) }),
    ],
  },
  scribble: {
    rest: 0.4,
    shapes: [
      ...ruledPaper(),
      ink(scrawl(60, 106, 196, 3, 14), { opacity: shownUntil(0.5) }),
      {
        kind: "path",
        d: zigzag(58, 72, 116, 16, 200),
        tone: "red",
        width: 2.6,
        pen: [0.16, 0.46],
        motion: { draw: drawnBetween(0.16, 0.46), opacity: shownUntil(0.5) },
      },
    ],
  },
  circleLasso: {
    rest: 0.76,
    shapes: [
      ...ruledPaper(),
      {
        kind: "group",
        motion: { x: movedTo(44, 0.6, 0.76), y: movedTo(24, 0.6, 0.76) },
        children: [
          ink(scrawl(86, 92, 144, 5, 14)),
          {
            kind: "group",
            motion: { opacity: shownFrom(0.47) },
            children: selection(76, 62, 166, 46),
          },
        ],
      },
      {
        kind: "path",
        d: "M72 72C110 44 214 44 246 74C264 96 240 124 196 128C146 134 84 130 68 100C62 88 66 80 76 70",
        tone: "accent",
        width: 2.4,
        pen: [0.03, 0.3],
        motion: { draw: drawnBetween(0.03, 0.3), opacity: shownUntil(0.45) },
      },
      holdRing(76, 70, 0.31, 0.46),
    ],
  },
  holdResize: {
    rest: 0.76,
    shapes: [
      ink(
        "M104 58L208 54L214 124L102 128L104 56",
        { draw: drawnBetween(0.03, 0.26), opacity: shownUntil(0.42) },
        [0.03, 0.26],
      ),
      holdRing(104, 56, 0.28, 0.43),
      {
        kind: "group",
        motion: {
          opacity: shownFrom(0.42),
          scale: movedTo(1.32, 0.52, 0.76, 1),
          rotate: movedTo(11, 0.52, 0.76),
        },
        children: [{ kind: "rect", x: 104, y: 56, w: 110, h: 70, tone: "ink", width: 2.6 }],
      },
      {
        kind: "path",
        d: "M214 126L252 150",
        tone: "ink",
        width: 0,
        pen: [0.5, 0.78],
        motion: {
          opacity: [
            [0, 0],
            [1, 0],
          ],
        },
      },
    ],
  },
  arrow: {
    rest: 0.78,
    shapes: [
      ink(
        "M46 136C110 110 190 80 266 48L240 58",
        { draw: drawnBetween(0.03, 0.38), opacity: shownUntil(0.58) },
        [0.03, 0.38],
      ),
      holdRing(240, 58, 0.4, 0.58),
      ink("M46 136L266 48M266 48L238 48M266 48L252 74", { opacity: shownFrom(0.58) }),
    ],
  },
  coverTape: {
    rest: 0.32,
    shapes: [
      ...ruledPaper(),
      ink(scrawl(40, 74, 100, 6, 12)),
      ink(scrawl(160, 74, 110, 8, 12)),
      ink(scrawl(40, 106, 220, 9, 12)),
      {
        kind: "path",
        d: "M158 68H276",
        tone: "blue",
        width: 28,
        pen: [0.04, 0.24],
        motion: {
          draw: drawnBetween(0.04, 0.24),
          opacity: [
            [0, 0],
            [0.04, 0],
            [0.05, 1],
            [0.42, 1],
            [0.45, 0.14],
            [0.72, 0.14],
            [0.75, 1],
            [0.95, 1],
            [0.98, 0],
            [1, 0],
          ],
        },
      },
      taps(218, 68, [0.42, 0.72]),
    ],
  },
  hear: {
    rest: 0.55,
    shapes: [
      ...ruledPaper(),
      {
        kind: "rect",
        x: 118,
        y: 80,
        w: 74,
        h: 30,
        r: 5,
        tone: "accent",
        fill: true,
        motion: {
          opacity: [
            [0, 0],
            [0.3, 0],
            [0.34, 0.25],
            [0.86, 0.25],
            [0.9, 0],
            [1, 0],
          ],
        },
      },
      ink(scrawl(44, 106, 78, 11, 13)),
      ink(scrawl(124, 106, 62, 12, 13)),
      ink(scrawl(196, 106, 76, 13, 13)),
      taps(152, 92, [0.26]),
      ...[0, 1, 2, 3, 4, 5, 6].map((i): SceneShape => ({
        kind: "rect",
        x: 122 + i * 11,
        y: 126,
        w: 6,
        h: 34,
        r: 3,
        tone: "accent",
        fill: true,
        motion: {
          scale: [
            [0, 0.14],
            [0.3, 0.14],
            [0.38 + i * 0.012, 1],
            [0.46, 0.4 + (i % 3) * 0.2],
            [0.56 + i * 0.01, 1],
            [0.66, 0.3 + (i % 2) * 0.4],
            [0.76 - i * 0.008, 0.95],
            [0.88, 0.14],
            [1, 0.14],
          ],
        },
      })),
    ],
  },
  snap: {
    rest: 0.76,
    shapes: [
      ...printed(PRINT),
      {
        kind: "rect",
        x: 32,
        y: 62,
        w: 262,
        h: 20,
        r: 2,
        tone: "mark",
        fill: true,
        motion: { opacity: shownFrom(0.47) },
      },
      {
        kind: "path",
        d: "M36 78C80 66 120 84 162 72C204 66 244 84 288 70",
        tone: "mark",
        width: 16,
        pen: [0.06, 0.38],
        motion: { draw: drawnBetween(0.06, 0.38), opacity: shownUntil(0.46) },
      },
    ],
  },
  holdWord: {
    rest: 0.72,
    shapes: [
      ...printed(PRINT),
      {
        kind: "rect",
        x: 88,
        y: 63,
        w: 40,
        h: 18,
        r: 2,
        tone: "accent",
        fill: true,
        motion: {
          opacity: [
            [0, 0],
            [0.44, 0],
            [0.48, 0.3],
            [0.92, 0.3],
            [0.95, 0],
            [1, 0],
          ],
        },
      },
      holdRing(108, 72, 0.14, 0.44),
      {
        kind: "circle",
        cx: 88,
        cy: 60,
        r: 4,
        tone: "accent",
        fill: true,
        motion: { opacity: shownFrom(0.47) },
      },
      {
        kind: "circle",
        cx: 128,
        cy: 84,
        r: 4,
        tone: "accent",
        fill: true,
        motion: { opacity: shownFrom(0.47) },
      },
    ],
  },
  calc: {
    rest: 0.78,
    shapes: [
      ...ruledPaper(),
      {
        kind: "text",
        x: 62,
        y: 106,
        text: "3 × 2 =",
        size: 34,
        tone: "ink",
        motion: { opacity: shownFrom(0.02) },
      },
      {
        kind: "rect",
        x: 200,
        y: 76,
        w: 42,
        h: 34,
        r: 12,
        tone: "accent",
        fill: true,
        motion: {
          opacity: [
            [0, 0],
            [0.26, 0],
            [0.3, 1],
            [0.58, 1],
            [0.61, 0],
            [1, 0],
          ],
        },
      },
      {
        kind: "text",
        x: 213,
        y: 101,
        text: "6",
        size: 22,
        tone: "page",
        motion: {
          opacity: [
            [0, 0],
            [0.26, 0],
            [0.3, 1],
            [0.58, 1],
            [0.61, 0],
            [1, 0],
          ],
        },
      },
      taps(221, 92, [0.52]),
      {
        kind: "text",
        x: 206,
        y: 106,
        text: "6",
        size: 34,
        tone: "ink",
        motion: { opacity: shownFrom(0.6) },
      },
    ],
  },
  searchInk: {
    rest: 0.76,
    shapes: [
      ...searchPill(0.1, 0.38),
      ...[110, 142].map((y): SceneShape => ({
        kind: "path",
        d: `M0 ${y}H320`,
        tone: "rule",
        width: 1,
      })),
      { kind: "rect", x: 130, y: 80, w: 82, h: 28, r: 3, tone: "mark", fill: true, motion: FOUND },
      ink(scrawl(44, 104, 76, 14, 13)),
      ink(handwrite("mitosis", 134, 104, 72, 12)),
      ink(scrawl(216, 104, 60, 16, 13)),
      ink(scrawl(44, 136, 170, 17, 13)),
    ],
  },
  homeSearch: {
    rest: 0.76,
    shapes: [
      { kind: "rect", x: 0, y: 0, w: 320, h: 180, tone: "desk", fill: true },
      ...searchPill(0.1, 0.34),
      ...[54, 128, 202].map((x) => miniPage(x, 68)),
      ink(scrawl(62, 96, 46, 4, 7)),
      ink(scrawl(62, 116, 50, 7, 7)),
      ink(scrawl(136, 96, 48, 8, 7)),
      { kind: "rect", x: 134, y: 106, w: 52, h: 16, r: 2, tone: "mark", fill: true, motion: FOUND },
      ink(handwrite("mitosis", 136, 118, 46, 7)),
      ink(scrawl(210, 96, 50, 10, 7)),
      ink(scrawl(210, 116, 44, 12, 7)),
    ],
  },
  inkLink: {
    rest: 0.74,
    shapes: [
      ...ruledPaper(),
      ink("M72 80H62V112H72M82 80H72V112H82"),
      ink(scrawl(92, 106, 110, 18, 13)),
      ink("M212 80H222V112H212M222 80H232V112H222"),
      taps(150, 96, [0.26]),
      {
        kind: "group",
        motion: {
          opacity: shownFrom(0.34),
          scale: movedTo(1, 0.32, 0.46, 0.84),
          y: movedTo(0, 0.32, 0.46, 14),
        },
        children: [
          { kind: "rect", x: 72, y: 22, w: 176, h: 140, r: 10, tone: "page", fill: true },
          { kind: "rect", x: 72, y: 22, w: 176, h: 140, r: 10, tone: "accent", width: 2 },
          ink(scrawl(88, 62, 120, 18, 11)),
          ink(scrawl(88, 92, 136, 19, 9)),
          ink(scrawl(88, 122, 120, 20, 9)),
        ],
      },
    ],
  },
  undo: {
    rest: 0.24,
    shapes: [
      ...ruledPaper(),
      ink(handwrite("the cell cycle", 44, 106, 150, 15)),
      ink("M214 96C232 66 244 120 258 88C268 66 280 110 296 82", { opacity: shownUntil(0.42) }),
      taps(136, 138, [0.26, 0.38]),
      taps(192, 144, [0.26, 0.38]),
    ],
  },
  pullPage: {
    rest: 0.76,
    shapes: [
      { kind: "rect", x: 0, y: 0, w: 320, h: 180, tone: "desk", fill: true },
      {
        kind: "group",
        motion: { y: movedTo(-52, 0.2, 0.5) },
        children: [
          { kind: "rect", x: 90, y: -60, w: 140, h: 192, r: 3, tone: "page", fill: true },
          ink(scrawl(106, 60, 104, 3, 11)),
          ink(scrawl(106, 90, 88, 4, 11)),
          {
            kind: "rect",
            x: 90,
            y: 148,
            w: 140,
            h: 100,
            r: 3,
            tone: "page",
            fill: true,
            motion: { opacity: shownFrom(0.54) },
          },
        ],
      },
      {
        kind: "path",
        d: "M160 132a18 18 0 1 1-.01 0",
        tone: "accent",
        width: 4,
        motion: { draw: drawnBetween(0.2, 0.5), opacity: shownUntil(0.54) },
      },
      taps(160, 150, [0.12]),
    ],
  },
  tapColour: {
    rest: 0.5,
    shapes: [
      { kind: "rect", x: 90, y: 12, w: 140, h: 40, r: 20, tone: "desk", fill: true },
      swatch(122, 32, "ink"),
      swatch(160, 32, "red"),
      swatch(198, 32, "green"),
      { kind: "circle", cx: 160, cy: 32, r: 15, tone: "accent", width: 2 },
      swatch(160, 32, "blue", { opacity: shownFrom(0.66) }),
      taps(160, 32, [0.22]),
      {
        kind: "group",
        motion: {
          opacity: [
            [0, 0],
            [0.28, 0],
            [0.32, 1],
            [0.64, 1],
            [0.67, 0],
            [1, 0],
          ],
          y: [
            [0, 8],
            [0.28, 8],
            [0.36, 0],
            [1, 0],
          ],
        },
        children: [
          { kind: "rect", x: 76, y: 62, w: 168, h: 92, r: 12, tone: "page", fill: true },
          { kind: "rect", x: 76, y: 62, w: 168, h: 92, r: 12, tone: "soft", width: 1 },
          ...(["ink", "red", "green", "blue", "mark", "accent"] as const).map((tone, i) =>
            swatch(112 + (i % 3) * 48, 86 + Math.floor(i / 3) * 44, tone),
          ),
        ],
      },
      taps(112, 130, [0.58]),
    ],
  },
  zoomBox: {
    rest: 0.62,
    shapes: [
      { kind: "rect", x: 24, y: 104, w: 272, h: 64, r: 10, tone: "desk", fill: true },
      { kind: "rect", x: 40, y: 38, w: 96, h: 24, tone: "accent", width: 1.5, dashed: true },
      ...ruledPaper().slice(0, 1),
      ink(scrawl(44, 56, 86, 25, 9), { draw: drawnBetween(0.08, 0.72), opacity: shownFrom(0.08) }),
      ink(
        scrawl(44, 152, 236, 25, 25),
        { draw: drawnBetween(0.08, 0.72), opacity: shownFrom(0.08) },
        [0.08, 0.72],
      ),
    ],
  },
  eraseLine: {
    rest: 0.44,
    shapes: [
      ...ruledPaper(),
      ink(scrawl(40, 74, 240, 26, 13), { opacity: shownUntil(0.52) }),
      ink(scrawl(40, 106, 200, 27, 13)),
      ink(scrawl(40, 138, 230, 28, 13)),
      {
        kind: "circle",
        cx: 60,
        cy: 66,
        r: 13,
        tone: "soft",
        width: 2,
        motion: {
          x: [
            [0, 0],
            [0.14, 0],
            [0.5, 170],
            [1, 170],
          ],
          opacity: [
            [0, 0],
            [0.12, 0],
            [0.15, 1],
            [0.5, 1],
            [0.54, 0],
            [1, 0],
          ],
        },
      },
    ],
  },
  typedEquation: {
    rest: 0.76,
    shapes: [
      {
        kind: "text",
        x: 94,
        y: 98,
        text: "\\frac{a+b}{2}",
        size: 18,
        tone: "soft",
        motion: { opacity: shownUntil(0.42) },
      },
      {
        kind: "group",
        motion: { opacity: shownFrom(0.46) },
        children: [
          { kind: "text", x: 124, y: 76, text: "a + b", size: 30, tone: "ink" },
          { kind: "path", d: "M118 88H204", tone: "ink", width: 2 },
          { kind: "text", x: 152, y: 122, text: "2", size: 30, tone: "ink" },
        ],
      },
    ],
  },
  typeInShape: {
    rest: 0.76,
    shapes: [
      { kind: "circle", cx: 160, cy: 90, r: 66, tone: "ink", width: 2.6 },
      taps(160, 90, [0.16]),
      {
        kind: "path",
        d: "M124 76V104",
        tone: "accent",
        width: 2,
        motion: {
          opacity: [
            [0, 0],
            [0.24, 0],
            [0.26, 1],
            [0.34, 1],
            [0.36, 0],
            [1, 0],
          ],
        },
      },
      ...[0, 1, 2].map((i): SceneShape => ({
        kind: "text",
        x: 160 - [50, 32, 68][i] / 2,
        y: 83 + i * 15,
        text: ["Plasma", "lipid", "membrane"][i],
        size: 13,
        fit: [50, 32, 68][i],
        face: "typed",
        tone: "ink",
        motion: { opacity: shownFrom(0.38 + i * 0.1) },
      })),
    ],
  },
  turnKnob: {
    rest: 0.78,
    shapes: [
      ...ruledPaper(),
      {
        kind: "group",
        motion: { rotate: movedTo(24, 0.2, 0.78) },
        children: [
          ink(scrawl(92, 96, 140, 30, 14)),
          ...selection(80, 62, 164, 48),
          { kind: "path", d: "M162 110V134", tone: "accent", width: 1.5 },
          { kind: "circle", cx: 162, cy: 140, r: 6, tone: "accent", fill: true },
        ],
      },
    ],
  },
  pinchSelection: {
    rest: 0.7,
    shapes: [
      ...ruledPaper(),
      {
        kind: "group",
        motion: { rotate: movedTo(32, 0.24, 0.66) },
        children: [ink(scrawl(100, 96, 120, 31, 13)), ...selection(90, 68, 140, 40)],
      },
      {
        kind: "circle",
        cx: 110,
        cy: 88,
        r: 16,
        tone: "accent",
        fill: true,
        motion: {
          opacity: [
            [0, 0],
            [0.12, 0],
            [0.18, 0.5],
            [0.72, 0.5],
            [0.76, 0],
            [1, 0],
          ],
          x: movedTo(8, 0.24, 0.66),
          y: movedTo(-30, 0.24, 0.66),
        },
      },
      {
        kind: "circle",
        cx: 210,
        cy: 88,
        r: 16,
        tone: "accent",
        fill: true,
        motion: {
          opacity: [
            [0, 0],
            [0.12, 0],
            [0.18, 0.5],
            [0.72, 0.5],
            [0.76, 0],
            [1, 0],
          ],
          x: movedTo(-8, 0.24, 0.66),
          y: movedTo(30, 0.24, 0.66),
        },
      },
    ],
  },
  pasteHere: {
    rest: 0.8,
    shapes: [
      ...ruledPaper(),
      holdRing(160, 96, 0.08, 0.32),
      {
        kind: "rect",
        x: 126,
        y: 42,
        w: 68,
        h: 30,
        r: 12,
        tone: "accent",
        fill: true,
        motion: {
          opacity: [
            [0, 0],
            [0.3, 0],
            [0.34, 1],
            [0.54, 1],
            [0.57, 0],
            [1, 0],
          ],
        },
      },
      typed("Paste", 140, 52, 40, "page", {
        opacity: [
          [0, 0],
          [0.3, 0],
          [0.34, 1],
          [0.54, 1],
          [0.57, 0],
          [1, 0],
        ],
      }),
      taps(160, 57, [0.5]),
      ink(scrawl(100, 106, 124, 33, 14), { opacity: shownFrom(0.58) }),
    ],
  },
  turnIntoText: {
    rest: 0.8,
    shapes: [
      ...ruledPaper(),
      ink(handwrite("cells split into two halves", 66, 76, 190, 13), { opacity: shownUntil(0.5) }),
      ink(handwrite("every cell makes more", 66, 108, 150, 13), { opacity: shownUntil(0.5) }),
      {
        kind: "group",
        motion: {
          opacity: [
            [0, 0],
            [0.12, 0],
            [0.16, 1],
            [0.48, 1],
            [0.51, 0],
            [1, 0],
          ],
        },
        children: selection(56, 50, 208, 68),
      },
      typed("Cells split into two halves.", 66, 62, 186, "ink", { opacity: shownFrom(0.52) }),
      typed("Every cell makes more.", 66, 94, 150, "ink", { opacity: shownFrom(0.62) }),
    ],
  },
  correctWord: {
    rest: 0.5,
    shapes: [
      ...ruledPaper(),
      ink(scrawl(44, 106, 74, 37, 13)),
      ink(handwrite("mitosis", 130, 106, 76, 13)),
      ink(scrawl(218, 106, 58, 39, 13)),
      {
        kind: "path",
        d: "M130 114H206",
        tone: "red",
        width: 2,
        dashed: true,
        motion: { opacity: shownUntil(0.66) },
      },
      taps(168, 96, [0.2]),
      {
        kind: "group",
        motion: {
          opacity: [
            [0, 0],
            [0.26, 0],
            [0.3, 1],
            [0.64, 1],
            [0.67, 0],
            [1, 0],
          ],
        },
        children: [
          { kind: "rect", x: 104, y: 122, w: 128, h: 50, r: 10, tone: "page", fill: true },
          { kind: "rect", x: 104, y: 122, w: 128, h: 50, r: 10, tone: "soft", width: 1 },
          typed("mitosis", 118, 133, 62),
          typed("meiosis", 118, 151, 62, "print"),
        ],
      },
      taps(150, 138, [0.58]),
    ],
  },
  ribbon: {
    rest: 0.72,
    shapes: [
      { kind: "rect", x: 0, y: 0, w: 320, h: 180, tone: "desk", fill: true },
      ...[54, 128, 202].map((x) => miniPage(x, 46)),
      { kind: "path", d: "M172 46V76L166 70L160 76V46", tone: "soft", width: 2 },
      {
        kind: "path",
        d: "M172 46V76L166 70L160 76V46Z",
        tone: "accent",
        fill: true,
        motion: { opacity: shownFrom(0.34) },
      },
      taps(166, 62, [0.3]),
    ],
  },
  reorder: {
    rest: 0.76,
    shapes: [
      { kind: "rect", x: 0, y: 0, w: 320, h: 180, tone: "desk", fill: true },
      miniPage(54, 46),
      ink(scrawl(62, 76, 46, 42, 7)),
      {
        kind: "group",
        motion: { x: movedTo(-74, 0.46, 0.68) },
        children: [miniPage(202, 46), ink(scrawl(210, 76, 44, 41, 7))],
      },
      {
        kind: "group",
        motion: {
          x: movedTo(74, 0.34, 0.72),
          scale: [
            [0, 1],
            [0.2, 1],
            [0.3, 1.1],
            [0.74, 1.1],
            [0.82, 1],
            [1, 1],
          ],
        },
        children: [miniPage(128, 46), ink(scrawl(136, 76, 46, 40, 7))],
      },
      holdRing(160, 90, 0.08, 0.24),
    ],
  },
  scan: {
    rest: 0.76,
    shapes: [
      { kind: "rect", x: 0, y: 0, w: 320, h: 180, tone: "desk", fill: true },
      {
        kind: "group",
        motion: { opacity: shownUntil(0.5) },
        children: [
          { kind: "path", d: "M92 34L232 22L250 156L78 150Z", tone: "page", fill: true },
          { kind: "path", d: "M92 34L232 22L250 156L78 150Z", tone: "accent", width: 2 },
          ink(scrawl(106, 74, 118, 43, 10)),
          ink(scrawl(104, 108, 124, 44, 10)),
          ...[
            [92, 34],
            [232, 22],
            [250, 156],
            [78, 150],
          ].map(([cx, cy]): SceneShape => ({
            kind: "circle",
            cx,
            cy,
            r: 6,
            tone: "accent",
            fill: true,
          })),
        ],
      },
      {
        kind: "group",
        motion: { opacity: shownFrom(0.52), scale: movedTo(1, 0.52, 0.66, 0.92) },
        children: [
          { kind: "rect", x: 100, y: 14, w: 120, h: 152, r: 3, tone: "page", fill: true },
          ink(scrawl(112, 64, 92, 43, 10)),
          ink(scrawl(112, 98, 96, 44, 10)),
        ],
      },
    ],
  },
  importBooks: {
    rest: 0.8,
    shapes: [
      { kind: "rect", x: 0, y: 0, w: 320, h: 180, tone: "desk", fill: true },
      { kind: "path", d: "M36 150H284", tone: "soft", width: 3 },
      ...(
        [
          ["blue", 70, 0.1],
          ["red", 136, 0.26],
          ["green", 202, 0.42],
        ] as const
      ).map(([tone, x, at]): SceneShape => ({
        kind: "rect",
        x,
        y: 58,
        w: 54,
        h: 90,
        r: 4,
        tone,
        fill: true,
        motion: { y: movedTo(0, at, at + 0.2, -96), opacity: shownFrom(at) },
      })),
    ],
  },
  textTurns: {
    rest: 0.76,
    shapes: [
      {
        kind: "group",
        motion: { rotate: movedTo(15, 0.2, 0.6) },
        children: [
          { kind: "rect", x: 86, y: 60, w: 148, h: 54, tone: "accent", width: 1.5 },
          typed("The cell cycle", 104, 71, 112),
          typed("Chapter 3", 104, 91, 80, "print"),
          { kind: "path", d: "M160 114V134", tone: "accent", width: 1.5 },
          { kind: "circle", cx: 160, cy: 140, r: 6, tone: "accent", fill: true },
        ],
      },
    ],
  },
  lineSpacing: {
    rest: 0.76,
    shapes: [0, 1, 2, 3].map((i): SceneShape => ({
      kind: "path",
      d: `M40 ${40 + i * 24}H280`,
      tone: "blue",
      width: 1.5,
      motion: { y: movedTo(i * 12, 0.2, 0.6) },
    })),
  },
  penOrder: sc(
    0.76,
    box(68, 40, 184, 104, "desk", 22),
    holdRing(160, 90, 0.08, 0.26),
    penStick(110, "ink"),
    penStick(210, "blue", { x: movedTo(-50, 0.42, 0.68) }),
    penStick(160, "red", { x: movedTo(50, 0.32, 0.7), scale: LIFT }),
  ),
  pillDock: sc(
    0.76,
    desk(),
    box(60, 16, 200, 150, "page", 3),
    holdRing(160, 40, 0.06, 0.24),
    group(
      { x: movedTo(108, 0.3, 0.7), y: movedTo(52, 0.3, 0.7), rotate: movedTo(90, 0.3, 0.7) },
      box(92, 24, 136, 32, "accent", 16),
      [0, 1, 2].map((i) => dot(122 + i * 38, 40, 7, "page")),
    ),
  ),
  colourOff: sc(
    0.72,
    box(70, 56, 180, 56, "desk", 28),
    swatch(110, 84, "ink"),
    swatch(210, 84, "green", { x: movedTo(-50, 0.54, 0.72) }),
    holdRing(160, 84, 0.08, 0.24),
    swatch(160, 84, "red", {
      y: movedTo(66, 0.28, 0.58),
      x: movedTo(46, 0.28, 0.58),
      scale: movedTo(0.1, 0.42, 0.62, 1),
      opacity: shownUntil(0.6),
    }),
  ),
  customizeBar: sc(
    0.76,
    desk(),
    box(44, 58, 232, 44, "page", 22),
    [0, 1, 3, 4].map((i) => box(66 + i * 44, 69, 22, 22, "soft", 5)),
    box(154, 69, 22, 22, "accent", 5, { x: movedTo(88, 0.32, 0.72), scale: LIFT }),
    holdRing(165, 80, 0.08, 0.26),
  ),
  savedPens: sc(
    0.8,
    icon("star", 160, 44, "accent", 34, {
      scale: [
        [0, 1],
        [0.18, 1],
        [0.24, 1.3],
        [0.3, 1],
        [1, 1],
      ],
    }),
    taps(160, 44, [0.2]),
    box(70, 100, 180, 50, "desk", 25),
    (["ink", "red", "blue"] as const).map((tone, i) =>
      swatch(112 + i * 48, 125, tone, {
        opacity: shownFrom(0.34 + i * 0.12),
        y: movedTo(0, 0.34 + i * 0.12, 0.46 + i * 0.12, -30),
      }),
    ),
  ),
  toolbarEdge: sc(
    0.76,
    desk(),
    box(70, 20, 180, 150, "page", 3),
    group({ y: movedTo(118, 0.28, 0.68) }, toolbarRow(12)),
    holdRing(160, 30, 0.06, 0.24),
  ),
  dockOptions: sc(
    0.76,
    desk(),
    box(60, 62, 200, 108, "page", 3),
    toolbarRow(10),
    group(
      { y: movedTo(-62, 0.28, 0.66), x: movedTo(-12, 0.28, 0.66) },
      box(84, 112, 152, 30, "accent", 15),
      [0, 1, 2, 3].map((i) => dot(114 + i * 31, 127, 6, "page")),
    ),
  ),
  redoThree: sc(
    0.8,
    ruledPaper(),
    word(44, 106, 130, 44, 13),
    ink("M190 98C208 70 220 122 234 92C244 70 258 112 276 86", { opacity: shownFrom(0.46) }),
    [120, 164, 206].map((x, i) => taps(x, 138 + (i % 2) * 8, [0.24, 0.36])),
  ),
  fillScreen: sc(
    0.5,
    desk(),
    group(
      {
        scale: [
          [0, 0.62],
          [0.32, 0.62],
          [0.46, 1.1],
          [0.72, 1.1],
          [0.86, 0.62],
          [1, 0.62],
        ],
      },
      box(92, 12, 136, 156, "page", 3),
      word(106, 62, 100, 3, 11),
      word(106, 96, 86, 4, 11),
    ),
    taps(160, 96, [0.16, 0.26, 0.76]),
  ),
  fingerHoldMenu: sc(
    0.6,
    ruledPaper(),
    holdRing(160, 118, 0.08, 0.3),
    dot(160, 118, 16, "accent", {
      opacity: [
        [0, 0],
        [0.05, 0],
        [0.08, 0.5],
        [0.34, 0.5],
        [0.38, 0],
        [1, 0],
      ],
    }),
    popover(100, 18, 120, 3, 0.32, 0.92),
  ),
  drawFinger: sc(0.5, ruledPaper(), {
    kind: "path",
    d: "M60 110C90 50 130 140 170 80C200 44 240 110 268 72",
    tone: "ink",
    width: 3,
    pen: [0.08, 0.78],
    rider: "finger",
    motion: { draw: drawnBetween(0.08, 0.78), opacity: shownFrom(0.08) },
  }),
  stylusOnly: sc(
    0.7,
    ruledPaper(),
    {
      kind: "circle",
      cx: 236,
      cy: 136,
      r: 34,
      tone: "soft",
      fill: true,
      motion: {
        opacity: [
          [0, 0.5],
          [1, 0.5],
        ],
        scale: [
          [0, 1],
          [0.5, 1.08],
          [1, 1],
        ],
      },
    },
    written(scrawl(44, 106, 150, 45, 13), 0.1, 0.8),
  ),
  fingerPick: sc(
    0.76,
    ruledPaper(),
    frame(100, 56, 120, 70, "ink", 3),
    taps(160, 92, [0.3]),
    group({ opacity: shownFrom(0.38) }, selection(94, 50, 132, 82)),
  ),
  copyStyle: sc(
    0.76,
    ruledPaper(),
    { kind: "path", d: scrawl(40, 74, 110, 46, 12), tone: "blue", width: 4.5 },
    word(170, 106, 110, 47, 12, { opacity: shownUntil(0.7) }),
    {
      kind: "path",
      d: scrawl(170, 106, 110, 47, 12),
      tone: "blue",
      width: 4.5,
      pen: [0.28, 0.68],
      motion: { draw: drawnBetween(0.28, 0.68), opacity: shownFrom(0.28) },
    },
  ),
  dragToPage: sc(
    0.76,
    desk(),
    box(20, 22, 130, 136, "page", 3),
    box(170, 22, 130, 136, "page", 3),
    group({ x: movedTo(150, 0.26, 0.72) }, word(40, 92, 90, 48, 12), selection(32, 66, 106, 38)),
  ),
  oneItem: sc(
    0.78,
    ruledPaper(),
    group(
      { x: movedTo(130, 0.3, 0.72), y: movedTo(30, 0.3, 0.72) },
      icon("star", 90, 66, "green", 54),
    ),
    {
      kind: "path",
      d: "M90 66C130 70 180 80 220 96",
      tone: "ink",
      width: 0,
      pen: [0.28, 0.72],
      motion: {
        opacity: [
          [0, 0],
          [1, 0],
        ],
      },
    },
  ),
  saveSticker: sc(
    0.82,
    ruledPaper(),
    icon("star", 110, 90, "red", 62),
    frame(70, 50, 82, 82, "accent", 8, { opacity: between(0.08, 0.42) }, true),
    group(
      { opacity: shownFrom(0.44), x: movedTo(120, 0.44, 0.72), scale: movedTo(0.7, 0.44, 0.72, 1) },
      box(74, 54, 74, 74, "page", 10),
      frame(74, 54, 74, 74, "soft", 10),
      icon("star", 111, 91, "red", 50),
    ),
  ),
  screenshotLasso: sc(
    0.78,
    printed(PRINT),
    frame(60, 58, 150, 62, "accent", 3, { opacity: shownFrom(0.08) }, true),
    group(
      { opacity: between(0.26, 0.56) },
      box(113, 16, 44, 32, "ink", 16),
      icon("camera", 135, 32, "page", 20),
    ),
    taps(135, 32, [0.48]),
    group(
      { opacity: shownFrom(0.56), x: movedTo(84, 0.58, 0.8), y: movedTo(58, 0.58, 0.8) },
      box(60, 58, 150, 62, "page", 4),
      frame(60, 58, 150, 62, "accent", 4),
      printed(
        [
          [68, [48, 30, 44]],
          [98, [26, 62, 34]],
        ],
        70,
      ),
    ),
  ),
  lassoFilter: sc(
    0.76,
    ruledPaper(),
    box(190, 54, 86, 66, "blue", 4),
    group(
      { y: movedTo(36, 0.48, 0.72) },
      word(46, 94, 120, 50, 13),
      group({ opacity: shownFrom(0.42) }, selection(36, 66, 140, 40)),
    ),
    line("M26 80C60 30 240 24 292 70C310 116 250 146 150 146C60 146 14 124 26 80", "accent", 2.2, {
      draw: drawnBetween(0.05, 0.36),
      opacity: shownUntil(0.42),
    }),
  ),
  lockPicture: sc(
    0.76,
    desk(),
    box(70, 24, 180, 132, "page", 3),
    printed([
      [60, [40, 50, 30]],
      [90, [60, 44, 26]],
      [120, [36, 60, 34]],
    ]).map((s) => ({ ...s, x: (s as { x: number }).x + 56 }) as SceneShape),
    taps(160, 90, [0.22]),
    icon("lock", 160, 90, "accent", 44, {
      opacity: shownFrom(0.34),
      scale: movedTo(1, 0.34, 0.46, 1.5),
    }),
  ),
  pictureFront: sc(
    0.76,
    ruledPaper(),
    word(60, 106, 200, 51, 14),
    box(120, 40, 110, 100, "blue", 5, {
      opacity: [
        [0, 0.95],
        [0.4, 0.95],
        [0.66, 0.35],
        [0.94, 0.35],
        [0.98, 0.95],
        [1, 0.95],
      ],
    }),
  ),
  insertSpace: sc(
    0.76,
    ruledPaper(),
    word(60, 74, 200, 52, 12),
    {
      kind: "path",
      d: "M30 92v18m-6-6l6 6l6-6",
      tone: "accent",
      width: 2.4,
      motion: { y: movedTo(32, 0.24, 0.68) },
    },
    group({ y: movedTo(32, 0.24, 0.68) }, word(60, 106, 180, 53, 12), word(60, 138, 210, 54, 12)),
  ),
  zoomAdvance: sc(
    0.5,
    ruledPaper().slice(0, 2),
    frame(36, 36, 70, 42, "accent", 3, { x: movedTo(170, 0.12, 0.88) }, true),
    written(scrawl(42, 72, 230, 55, 11), 0.1, 0.88),
  ),
  zoomFrame: sc(
    0.7,
    ruledPaper(),
    group(
      {
        x: [
          [0, 0],
          [0.12, 0],
          [0.42, 90],
          [0.95, 90],
          [0.98, 0],
          [1, 0],
        ],
        scale: [
          [0, 1],
          [0.5, 1],
          [0.8, 1.4],
          [0.95, 1.4],
          [0.98, 1],
          [1, 1],
        ],
      },
      selection(50, 56, 100, 46),
    ),
  ),
  eyedropper: sc(
    0.8,
    box(186, 40, 96, 96, "accent", 48),
    box(26, 74, 92, 40, "desk", 20),
    swatch(72, 94, "ink"),
    swatch(72, 94, "accent", { opacity: shownFrom(0.54) }),
    {
      kind: "path",
      d: "M90 60C130 56 180 60 232 88",
      tone: "ink",
      width: 0,
      pen: [0.14, 0.48],
      motion: {
        opacity: [
          [0, 0],
          [1, 0],
        ],
      },
    },
    holdRing(232, 88, 0.48, 0.62),
  ),
  eraseHighlightOnly: sc(
    0.76,
    ruledPaper(),
    box(60, 76, 200, 32, "mark", 2, { opacity: shownUntil(0.56) }),
    word(70, 104, 180, 56, 14),
    {
      kind: "circle",
      cx: 66,
      cy: 92,
      r: 15,
      tone: "soft",
      width: 2,
      motion: {
        x: [
          [0, 0],
          [0.14, 0],
          [0.56, 190],
          [1, 190],
        ],
        opacity: between(0.12, 0.56),
      },
    },
  ),
  hideOptions: sc(
    0.7,
    ruledPaper(),
    box(92, 16, 136, 34, "accent", 17, { y: movedTo(-60, 0.16, 0.34) }),
    written(scrawl(44, 106, 220, 57, 13), 0.16, 0.84),
  ),
  backToPen: sc(
    0.82,
    ruledPaper().slice(1),
    icon("eraser", 160, 42, "ink", 40, { opacity: shownUntil(0.5) }),
    icon("pen", 160, 42, "accent", 40, { opacity: shownFrom(0.52) }),
    word(70, 120, 180, 58, 13, { opacity: shownUntil(0.46) }),
    {
      kind: "circle",
      cx: 70,
      cy: 112,
      r: 12,
      tone: "soft",
      width: 2,
      motion: {
        x: [
          [0, 0],
          [0.1, 0],
          [0.46, 180],
          [1, 180],
        ],
        opacity: between(0.08, 0.46),
      },
    },
  ),
  chisel: sc(
    0.76,
    word(60, 96, 200, 59, 14),
    box(50, 72, 220, 30, "mark", 15, { opacity: shownUntil(0.48) }),
    box(50, 72, 220, 30, "mark", 0, { opacity: shownFrom(0.5) }),
  ),
  stabilization: sc(
    0.8,
    line(humps(40, 92, 240, 60, 3), "red", 2.4, {
      draw: drawnBetween(0.04, 0.4),
      opacity: shownUntil(0.5),
    }),
    line("M40 92C100 60 180 124 280 86", "ink", 2.8, {
      draw: drawnBetween(0.52, 0.82),
      opacity: shownFrom(0.52),
    }),
  ),
  rulerUse: sc(
    0.8,
    group(
      { rotate: movedTo(-16, 0.1, 0.34) },
      box(30, 84, 260, 40, "soft", 4),
      Array.from({ length: 12 }, (_, i): SceneShape =>
        line(`M${46 + i * 20} 84v${i % 3 ? 8 : 14}`, "page", 1.5),
      ),
    ),
    {
      kind: "path",
      d: "M44 112L272 46",
      tone: "ink",
      width: 2.8,
      pen: [0.42, 0.82],
      motion: { draw: drawnBetween(0.42, 0.82), opacity: shownFrom(0.42) },
    },
  ),
  rulerKinds: sc(
    0.5,
    box(40, 70, 240, 40, "soft", 4, { opacity: between(0, 0.3) }),
    {
      kind: "path",
      d: "M80 146L240 146L80 40Z",
      tone: "soft",
      fill: true,
      motion: { opacity: between(0.34, 0.62) },
    },
    {
      kind: "path",
      d: "M60 140A100 100 0 0 1 260 140Z",
      tone: "soft",
      fill: true,
      motion: { opacity: shownFrom(0.66) },
    },
  ),
  checklist: sc(
    0.8,
    [0, 1, 2].map((i) =>
      typed(
        ["Label the cell", "Revise meiosis", "Learn the organelles"][i],
        106,
        56 + i * 30,
        [92, 100, 130][i],
        "ink",
        {
          opacity: shownFrom(0.02),
        },
      ),
    ),
    [0, 1, 2].map((i) =>
      frame(76, 52 + i * 30, 20, 20, "ink", 4, { opacity: shownFrom(0.14 + i * 0.08) }),
    ),
    taps(86, 62, [0.52]),
    icon("check", 86, 62, "accent", 22, { opacity: shownFrom(0.58) }),
  ),
  widthMm: sc(
    0.5,
    [0, 1, 2].map((i) =>
      box(50, 86 - i * 6, 220, 8 + i * 12, "ink", 4 + i * 6, {
        opacity: between(i * 0.3, i * 0.3 + 0.28),
      }),
    ),
  ),
  linkedShapes: sc(
    0.8,
    frame(40, 62, 84, 56, "ink", 3),
    dot(124, 90, 6, "accent", { opacity: between(0.08, 0.5) }),
    {
      kind: "path",
      d: "M124 90H196",
      tone: "ink",
      width: 2.4,
      pen: [0.14, 0.5],
      rider: "finger",
      motion: { draw: drawnBetween(0.14, 0.5), opacity: shownFrom(0.14) },
    },
    {
      kind: "path",
      d: "M186 82L198 90L186 98",
      tone: "ink",
      width: 2.4,
      motion: { opacity: shownFrom(0.5) },
    },
    frame(198, 62, 84, 56, "ink", 3, { opacity: shownFrom(0.52) }),
  ),
  cornerPoints: sc(
    0.78,
    line("M90 50H220V130H90Z", "ink", 2.6, { opacity: shownUntil(0.5) }),
    line("M90 50H250L262 150L90 130Z", "ink", 2.6, { opacity: shownFrom(0.52) }),
    [
      [90, 50],
      [90, 130],
    ].map(([cx, cy]) => ({ kind: "circle", cx, cy, r: 6, tone: "accent", width: 2 })),
    {
      kind: "circle",
      cx: 220,
      cy: 130,
      r: 7,
      tone: "accent",
      fill: true,
      motion: { x: movedTo(42, 0.2, 0.5), y: movedTo(20, 0.2, 0.5) },
    },
    {
      kind: "circle",
      cx: 220,
      cy: 50,
      r: 6,
      tone: "accent",
      width: 2,
      motion: { x: movedTo(30, 0.2, 0.5) },
    },
  ),
  bendCurves: sc(
    0.78,
    ink(ellipsePath(160, 92, 64, 56), { opacity: shownUntil(0.5) }),
    ink(
      "M96 92C96 40 150 36 190 36C258 30 290 92 224 104C210 136 190 148 160 148C124 148 96 124 96 92",
      { opacity: shownFrom(0.52) },
    ),
    dot(224, 92, 7, "accent", { x: movedTo(46, 0.2, 0.5), y: movedTo(-20, 0.2, 0.5) }),
  ),
  fillTool: sc(
    0.5,
    {
      kind: "path",
      d: ellipsePath(160, 90, 72, 60),
      tone: "blue",
      fill: true,
      motion: { opacity: between(0.2, 0.56) },
    },
    {
      kind: "path",
      d: ellipsePath(160, 90, 72, 60),
      tone: "green",
      fill: true,
      motion: { opacity: shownFrom(0.58) },
    },
    ink(ellipsePath(160, 90, 72, 60)),
    taps(160, 92, [0.18, 0.56]),
  ),
  scribbleFill: sc(
    0.8,
    {
      kind: "path",
      d: ellipsePath(160, 90, 72, 60),
      tone: "red",
      fill: true,
      motion: { opacity: shownFrom(0.54) },
    },
    ink(ellipsePath(160, 90, 72, 60)),
    {
      kind: "path",
      d: zigzag(112, 62, 118, 12, 96),
      tone: "red",
      width: 2.6,
      pen: [0.08, 0.46],
      motion: { draw: drawnBetween(0.08, 0.46), opacity: shownUntil(0.52) },
    },
  ),
  arcsHearts: sc(
    0.78,
    ink(WOBBLY_HEART, { draw: drawnBetween(0.04, 0.36), opacity: shownUntil(0.54) }, [0.04, 0.36]),
    holdRing(158, 146, 0.38, 0.54),
    ink(HEART, { opacity: shownFrom(0.54) }),
  ),
  curvedElbow: sc(
    0.82,
    line("M40 54L280 54", "ink", 2.4, { opacity: shownUntil(0.17) }),
    line("M40 54Q160 34 280 54", "ink", 2.4, { opacity: between(0.17, 0.23) }),
    line("M40 54Q160 14 280 54", "ink", 2.4, { opacity: between(0.23, 0.29) }),
    line("M40 54Q160 -6 280 54", "ink", 2.4, { opacity: shownFrom(0.29) }),
    line("M280 54L262 42M280 54L266 72", "ink", 2.4),
    dot(160, 54, 7, "accent", { y: movedTo(-30, 0.12, 0.3), opacity: shownUntil(0.5) }),
    line("M40 158H200V108", "ink", 2.4, { opacity: shownUntil(0.68) }),
    line("M200 108L189 124M200 108L211 124", "ink", 2.4, { opacity: shownUntil(0.68) }),
    line("M40 158V98H280", "ink", 2.4, { opacity: shownFrom(0.7) }),
    line("M280 98L264 87M280 98L264 109", "ink", 2.4, { opacity: shownFrom(0.7) }),
    dot(200, 108, 7, "accent", {
      x: movedTo(80, 0.5, 0.7),
      y: movedTo(-10, 0.5, 0.7),
      opacity: between(0.46, 0.8),
    }),
  ),
  lineUpMoves: sc(
    0.78,
    line("M60 8V172", "red", 1.2, { opacity: between(0.5, 0.74) }),
    line("M8 62H312", "red", 1.2, { opacity: between(0.5, 0.74) }),
    frame(60, 62, 76, 56, "ink", 3),
    group(
      { x: movedTo(-120, 0.1, 0.5) },
      box(180, 62, 76, 76, "soft", 3),
      frame(180, 62, 76, 76, "accent", 3),
    ),
  ),
  lockFit: sc(
    0.8,
    desk(),
    box(0, 0, 320, 180, "page", 0),
    printed([
      [40, [70, 60, 40, 80]],
      [76, [90, 50, 70, 40]],
      [112, [50, 80, 60, 60]],
      [148, [80, 40, 90, 50]],
    ]),
    dot(230, 92, 13, "accent", {
      x: movedTo(-140, 0.18, 0.56),
      opacity: between(0.14, 0.6),
    }),
    icon("lock", 160, 90, "accent", 40, {
      opacity: shownFrom(0.58),
      scale: movedTo(1, 0.58, 0.7, 1.4),
    }),
  ),
  pathArrow: sc(
    0.78,
    ink(
      "M50 40C60 80 52 110 60 132C110 138 170 130 226 134L262 134",
      { draw: drawnBetween(0.04, 0.38), opacity: shownUntil(0.56) },
      [0.04, 0.38],
    ),
    holdRing(262, 134, 0.4, 0.56),
    ink("M56 40V134H262M262 134L240 122M262 134L240 146", { opacity: shownFrom(0.56) }),
  ),
  shapeSnap: sc(
    0.76,
    frame(190, 42, 92, 80, "ink", 0),
    {
      kind: "path",
      d: "M36 150L188 44",
      tone: "ink",
      width: 2.6,
      pen: [0.1, 0.5],
      motion: { draw: drawnBetween(0.1, 0.5), opacity: shownFrom(0.1) },
    },
    holdRing(190, 42, 0.5, 0.7),
  ),
  tableTab: sc(
    0.8,
    tableGrid(76, 40, 3, 2),
    box(78, 42, 52, 24, "accent", 2, {
      opacity: [
        [0, 0.3],
        [1, 0.3],
      ],
      x: [
        [0, 0],
        [0.2, 0],
        [0.3, 56],
        [0.46, 56],
        [0.56, 112],
        [0.72, 112],
        [0.8, 0],
        [1, 0],
      ],
      y: [
        [0, 0],
        [0.72, 0],
        [0.8, 56],
        [0.95, 56],
        [0.98, 0],
        [1, 0],
      ],
    }),
    group(
      { opacity: shownFrom(0.78) },
      frame(76, 96, 168, 28, "ink", 0),
      line("M132 96V124M188 96V124", "ink", 1.2),
    ),
  ),
  tableResize: sc(
    0.76,
    frame(60, 44, 200, 90, "ink", 0),
    line("M60 74H260M60 104H260M200 44V134", "ink", 1.2),
    line("M120 44V134", "accent", 3, { x: movedTo(40, 0.22, 0.68) }),
  ),
  tapeEye: sc(
    0.5,
    ruledPaper(),
    [66, 98, 130].map((y, i) =>
      box(50 + i * 26, y, 170, 22, "blue", 3, {
        opacity: [
          [0, 1],
          [0.34, 1],
          [0.38, 0.14],
          [0.7, 0.14],
          [0.74, 1],
          [1, 1],
        ],
      }),
    ),
    [66, 98, 130].map((y, i) => word(58 + i * 26, y + 18, 150, 61 + i, 10)),
    icon("eye", 160, 28, "accent", 32),
    taps(160, 28, [0.32, 0.68]),
  ),
  tapeMagnet: sc(
    0.78,
    printed(PRINT),
    line("M36 44L290 136", "blue", 18, {
      draw: drawnBetween(0.08, 0.4),
      opacity: shownUntil(0.46),
    }),
    [
      [32, 34, 262],
      [32, 64, 262],
      [32, 94, 262],
      [32, 124, 262],
    ].map(([x, y, w], i) => box(x, y, w, 16, "blue", 2, { opacity: shownFrom(0.48 + i * 0.05) })),
  ),
  tapeExport: sc(
    0.8,
    desk(),
    box(40, 24, 104, 132, "page", 3),
    word(52, 66, 78, 3, 9),
    box(50, 80, 86, 16, "blue", 2),
    word(52, 124, 74, 4, 9),
    { kind: "path", d: "M152 90H176M168 82l8 8l-8 8", tone: "accent", width: 2.4 },
    group(
      { opacity: shownFrom(0.4) },
      box(186, 24, 104, 132, "page", 3),
      word(198, 66, 78, 3, 9),
      word(198, 94, 82, 5, 9),
      word(198, 124, 74, 4, 9),
    ),
  ),
  askSelection: sc(
    0.78,
    ruledPaper(),
    ink(handwrite("krebs cycle", 86, 126, 112, 14)),
    line(
      "M70 96C110 80 190 82 214 100C232 124 204 146 150 146C96 148 58 128 70 96",
      "accent",
      2.2,
      { draw: drawnBetween(0.05, 0.34), opacity: shownFrom(0.05) },
    ),
    icon("speech", 244, 54, "accent", 58, {
      opacity: shownFrom(0.44),
      scale: movedTo(1, 0.44, 0.58, 0.6),
    }),
  ),
  laser: sc(0.6, printed(PRINT), {
    kind: "path",
    d: "M50 150C120 60 180 150 280 50",
    tone: "red",
    width: 4,
    pen: [0.08, 0.72],
    rider: "finger",
    motion: {
      draw: drawnBetween(0.08, 0.72),
      opacity: [
        [0, 0],
        [0.08, 0],
        [0.1, 1],
        [0.72, 1],
        [0.92, 0],
        [1, 0],
      ],
    },
  }),
  copyHighlighted: sc(
    0.78,
    printed(PRINT),
    box(32, 62, 262, 20, "mark", 2),
    group(
      {
        x: movedTo(96, 0.34, 0.68),
        y: movedTo(74, 0.34, 0.68),
        scale: movedTo(0.15, 0.34, 0.68, 1),
        opacity: shownFrom(0.34),
      },
      box(32, 66, 262, 11, "ink", 3),
    ),
    frame(232, 124, 54, 44, "accent", 6),
  ),
  pasteTranscript: sc(
    0.82,
    Array.from({ length: 11 }, (_, i): SceneShape =>
      box(66 + i * 18, 72 - (i % 3) * 10, 8, 36 + (i % 3) * 20, "accent", 4, {
        opacity: shownUntil(0.46),
      }),
    ),
    textBars(66, 56, 4, 190).map((s, i) => ({
      ...s,
      motion: { opacity: shownFrom(0.48 + i * 0.07) },
    })),
  ),
  homePreview: sc(
    0.72,
    desk(),
    box(30, 30, 76, 110, "blue", 5),
    box(120, 30, 76, 110, "red", 5, { opacity: shownUntil(0.4) }),
    taps(68, 86, [0.22]),
    group(
      { x: movedTo(0, 0.28, 0.5, 170), opacity: shownFrom(0.28) },
      box(190, 10, 120, 160, "page", 8),
      [0, 1].map((i) => frame(214, 22 + i * 72, 72, 62, "soft", 2)),
      word(222, 56, 54, 3, 7),
      word(222, 128, 50, 4, 7),
    ),
  ),
  homeDrag: sc(
    0.56,
    desk(),
    box(46, 40, 74, 100, "green", 5, {
      x: movedTo(150, 0.26, 0.64),
      y: movedTo(10, 0.26, 0.64),
      scale: movedTo(0.34, 0.5, 0.68, 1),
      opacity: shownUntil(0.68),
    }),
    icon("folder", 230, 92, "accent", 92, {
      scale: [
        [0, 1],
        [0.66, 1],
        [0.72, 1.14],
        [0.8, 1],
        [1, 1],
      ],
    }),
  ),
  folderColour: sc(
    0.8,
    desk(),
    icon("folder", 160, 90, "soft", 104, { opacity: shownUntil(0.5) }),
    {
      kind: "path",
      d: "M116 66h28l10 14h50v56H116z",
      tone: "green",
      fill: true,
      motion: { opacity: shownFrom(0.52) },
    },
    icon("star", 164, 106, "page", 26, { opacity: shownFrom(0.62) }),
  ),
  foldNote: sc(
    0.5,
    ruledPaper(),
    group(
      {
        scale: [
          [0, 1],
          [0.2, 1],
          [0.4, 0.26],
          [0.66, 0.26],
          [0.84, 1],
          [1, 1],
        ],
      },
      box(100, 40, 120, 104, "mark", 5),
      word(114, 80, 90, 66, 9),
      word(114, 110, 80, 67, 9),
    ),
    taps(160, 92, [0.14, 0.62]),
  ),
  pageTab: sc(
    0.76,
    desk(),
    box(80, 16, 150, 150, "page", 3),
    box(226, 50, 34, 26, "red", 4, { opacity: shownFrom(0.28), x: movedTo(0, 0.28, 0.42, -26) }),
    taps(244, 62, [0.58]),
    word(96, 92, 110, 68, 11, { opacity: shownUntil(0.64) }),
    word(96, 92, 90, 69, 11, { opacity: shownFrom(0.66) }),
    word(96, 124, 104, 70, 11, { opacity: shownFrom(0.66) }),
  ),
  contentsHeading: sc(
    0.8,
    ruledPaper(),
    word(30, 74, 130, 71, 15),
    frame(22, 42, 148, 44, "accent", 6, { opacity: between(0.08, 0.5) }, true),
    box(196, 20, 108, 140, "desk", 8),
    typed("Cell biology", 208, 37, 70, "print"),
    typed("The nucleus", 208, 59, 80, "accent", {
      opacity: shownFrom(0.52),
      x: movedTo(0, 0.52, 0.66, -60),
    }),
    typed("Genetics", 208, 81, 60, "print"),
  ),
  inkTask: sc(
    0.82,
    ruledPaper(),
    word(90, 106, 170, 72, 13),
    frame(52, 84, 24, 24, "ink", 5, {
      opacity: shownFrom(0.28),
      scale: movedTo(1, 0.28, 0.4, 0.5),
    }),
    taps(64, 96, [0.56]),
    icon("check", 64, 96, "accent", 24, { opacity: shownFrom(0.62) }),
  ),
  linkTo: sc(
    0.82,
    ruledPaper(),
    word(70, 106, 180, 73, 13),
    line("M70 114H250", "accent", 2.4, { draw: drawnBetween(0.14, 0.4), opacity: shownFrom(0.14) }),
    icon("link", 268, 92, "accent", 26, { opacity: shownFrom(0.4) }),
    taps(160, 100, [0.52]),
    group(
      { opacity: shownFrom(0.6), scale: movedTo(1, 0.6, 0.72, 0.8) },
      box(90, 16, 140, 74, "page", 8),
      frame(90, 16, 140, 74, "accent", 8),
      word(104, 58, 104, 74, 9),
    ),
  ),
  embedPages: sc(
    0.8,
    textBars(40, 24, 2, 230),
    group(
      { opacity: shownFrom(0.28), y: movedTo(0, 0.28, 0.52, -30) },
      box(90, 62, 140, 92, "page", 3),
      frame(90, 62, 140, 92, "soft", 3),
      word(104, 100, 106, 75, 10),
      word(104, 132, 90, 76, 10),
    ),
  ),
  copyPageLink: sc(
    0.76,
    desk(),
    box(30, 26, 100, 130, "page", 3),
    word(42, 76, 74, 77, 9),
    box(190, 26, 100, 130, "page", 3),
    textBars(202, 48, 2, 76),
    icon("link", 80, 110, "accent", 34, { x: movedTo(160, 0.22, 0.66), y: movedTo(0, 0.22, 0.66) }),
  ),
  pdfLinks: sc(
    0.76,
    printed(PRINT.slice(0, 2)),
    printed(PRINT.slice(2)).map((s) => ({ ...s, motion: { opacity: shownUntil(0.4) } })),
    box(252, 96, 44, 24, "red", 4),
    taps(274, 108, [0.3]),
    group({ opacity: shownFrom(0.42) }, tableGrid(40, 92, 3, 2, 60, 30)),
  ),
  learnWriting: sc(
    0.8,
    ruledPaper().slice(0, 2),
    line(scrawl(50, 74, 220, 78, 13), "soft", 2.2),
    {
      kind: "path",
      d: scrawl(50, 106, 220, 78, 13),
      tone: "ink",
      width: 2.6,
      pen: [0.08, 0.6],
      motion: { draw: drawnBetween(0.08, 0.6), opacity: shownFrom(0.08) },
    },
    box(50, 138, 220, 12, "desk", 6),
    box(50, 138, 220, 12, "accent", 6, {
      opacity: [
        [0, 0.2],
        [0.6, 0.2],
        [0.82, 1],
        [0.95, 1],
        [0.98, 0.2],
        [1, 0.2],
      ],
    }),
  ),
  margins: sc(
    0.8,
    desk(),
    group(
      { x: movedTo(-54, 0.2, 0.46) },
      box(84, 26, 152, 128, "page", 3),
      printed([
        [52, [40, 34, 46]],
        [82, [52, 30, 34]],
        [112, [32, 44, 40]],
      ]).map((s) => ({ ...s, x: (s as { x: number }).x + 66 }) as SceneShape),
    ),
    box(182, 26, 92, 128, "page", 3, { opacity: shownFrom(0.34) }),
    written(scrawl(192, 90, 72, 79, 11), 0.5, 0.82),
  ),
  joinedPages: sc(
    0.8,
    desk(),
    box(30, 30, 126, 120, "page", 0, { x: movedTo(4, 0.14, 0.38) }),
    box(164, 30, 126, 120, "page", 0, { x: movedTo(-4, 0.14, 0.38) }),
    {
      kind: "path",
      d: "M60 100C110 70 190 130 262 84",
      tone: "ink",
      width: 2.8,
      pen: [0.44, 0.82],
      motion: { draw: drawnBetween(0.44, 0.82), opacity: shownFrom(0.44) },
    },
  ),
  pageGrid: sc(
    0.8,
    desk(),
    Array.from({ length: 8 }, (_, i): SceneShape =>
      box(40 + (i % 4) * 62, 18 + Math.floor(i / 4) * 78, 50, 68, "page", 3),
    ),
    [0, 2, 5].map((i, n) =>
      dot(82 + (i % 4) * 62, 26 + Math.floor(i / 4) * 78, 8, "accent", {
        opacity: shownFrom(0.3 + n * 0.14),
      }),
    ),
    [0, 2, 5].map((i, n) =>
      taps(65 + (i % 4) * 62, 52 + Math.floor(i / 4) * 78, [0.28 + n * 0.14]),
    ),
  ),
  moveToNotebook: sc(
    0.5,
    desk(),
    box(226, 44, 66, 92, "green", 5),
    miniPage(40, 46, {
      x: movedTo(190, 0.24, 0.66),
      y: movedTo(0, 0.24, 0.66),
      scale: movedTo(0.4, 0.46, 0.68, 1),
      opacity: shownUntil(0.68),
    }),
  ),
  saveTemplate: sc(
    0.8,
    desk(),
    [0, 1, 2].map((i) => box(214 + i * 8, 62 - i * 6, 58, 76, "page", 3)),
    group(
      {
        x: movedTo(136, 0.24, 0.66),
        y: movedTo(0, 0.24, 0.66),
        scale: movedTo(0.42, 0.24, 0.66, 1),
        opacity: shownUntil(0.68),
      },
      box(50, 16, 112, 148, "page", 3),
      [60, 90, 120].map((y) => line(`M58 ${y}H154`, "rule", 1.5)),
    ),
  ),
  designPaper: sc(
    0.82,
    desk(),
    box(90, 12, 140, 156, "page", 3),
    box(90, 12, 140, 156, "mark", 3, {
      opacity: [
        [0, 0],
        [0.6, 0],
        [0.72, 0.28],
        [0.94, 0.28],
        [0.97, 0],
        [1, 0],
      ],
    }),
    [44, 72, 100, 128, 156].map((y, i) =>
      line(`M90 ${y}H230`, "blue", 1.2, { opacity: shownFrom(0.1 + i * 0.08) }),
    ),
    line("M120 12V168", "red", 1.2, { opacity: shownFrom(0.52) }),
  ),
  newBoard: sc(
    0.8,
    desk(),
    group({ scale: movedTo(1.6, 0.4, 0.78, 1) }, box(110, 50, 100, 80, "page", 3)),
    written(scrawl(122, 96, 80, 80, 10), 0.08, 0.4),
  ),
  plainExport: sc(
    0.8,
    box(0, 0, 320, 180, "page", 0),
    ruledPaper().map((s) => ({ ...s, motion: { opacity: shownUntil(0.5) } })),
    word(50, 74, 200, 81, 13),
    word(50, 106, 170, 82, 13),
  ),
  pictureExport: sc(
    0.8,
    desk(),
    [-18, 0, 18].map((deg, i) =>
      group(
        { rotate: movedTo(deg, 0.26, 0.66), x: movedTo((i - 1) * 62, 0.26, 0.66) },
        box(122, 26, 76, 128, "page", 3),
        word(132, 86, 56, 83 + i, 8),
      ),
    ),
  ),
  pageNumbers: sc(
    0.8,
    desk(),
    [0, 1, 2].map((i) => box(40 + i * 86, 22, 70, 136, "page", 3)),
    ["1", "2", "3"].map((n, i): SceneShape => ({
      kind: "text",
      x: 70 + i * 86,
      y: 150,
      text: n,
      size: 16,
      tone: "ink",
      motion: { opacity: shownFrom(0.26 + i * 0.12) },
    })),
    [0, 1, 2].map((i) =>
      box(50 + i * 86, 32, 50, 6, "accent", 3, { opacity: shownFrom(0.26 + i * 0.12) }),
    ),
  ),
  darkDesk: sc(
    0.8,
    desk(),
    box(70, 12, 180, 156, "page", 3),
    box(70, 12, 180, 156, "ink", 3, { opacity: shownFrom(0.4) }),
    word(86, 84, 150, 84, 12, { opacity: shownUntil(0.42) }),
    line(scrawl(86, 84, 150, 84, 12), "page", 2.6, { opacity: shownFrom(0.42) }),
    line(scrawl(86, 118, 130, 85, 12), "page", 2.6, { opacity: shownFrom(0.42) }),
  ),
  readOnly: sc(0.7, ruledPaper(), word(44, 106, 230, 86, 13), icon("lock", 160, 54, "accent", 46), {
    kind: "path",
    d: "M90 150L132 112",
    tone: "ink",
    width: 0,
    pen: [0.14, 0.5],
    motion: {
      opacity: [
        [0, 0],
        [1, 0],
      ],
    },
  }),
  dropPdf: sc(
    0.8,
    desk(),
    box(60, 86, 200, 84, "page", 3),
    icon("file", 160, 34, "red", 52, { y: movedTo(68, 0.14, 0.46), opacity: shownUntil(0.5) }),
    [-1, 0, 1].map((n) =>
      group(
        { x: movedTo(n * 62, 0.5, 0.74), opacity: shownFrom(0.5) },
        box(136, 96, 48, 64, "desk", 3),
      ),
    ),
  ),
  graphPin: sc(
    0.78,
    line(AXES, "soft", 1.5),
    line(CURVE, "blue", 2.8),
    holdRing(180, 76, 0.1, 0.34),
    dot(180, 76, 6, "accent", { opacity: shownFrom(0.34) }),
    group(
      { opacity: shownFrom(0.4) },
      box(192, 90, 62, 26, "page", 6),
      frame(192, 90, 62, 26, "accent", 6),
      { kind: "text", x: 202, y: 109, text: "1.2", size: 15, tone: "ink" },
    ),
  ),
  graphFit: sc(
    0.78,
    line(AXES, "soft", 1.5),
    group(
      {
        x: [
          [0, 80],
          [0.34, 80],
          [0.6, 0],
          [0.94, 0],
          [0.98, 80],
          [1, 80],
        ],
        y: [
          [0, 60],
          [0.34, 60],
          [0.6, 0],
          [0.94, 0],
          [0.98, 60],
          [1, 60],
        ],
        scale: [
          [0, 0.5],
          [0.34, 0.5],
          [0.6, 1],
          [0.94, 1],
          [0.98, 0.5],
          [1, 0.5],
        ],
      },
      line(CURVE, "blue", 2.8),
    ),
    taps(160, 90, [0.16, 0.26]),
  ),
  sumGlow: sc(
    0.8,
    ruledPaper(),
    { kind: "text", x: 34, y: 106, text: "3 × 4 =", size: 34, tone: "ink" },
    // The glow: the same ink in the accent, with a soft line under it.
    {
      kind: "text",
      x: 34,
      y: 106,
      text: "3 × 4 =",
      size: 34,
      tone: "accent",
      motion: { opacity: shownFrom(0.2) },
    },
    line("M34 116H150", "accent", 3, { opacity: shownFrom(0.2), draw: drawnBetween(0.2, 0.3) }),
    taps(92, 94, [0.4]),
    group(
      {
        opacity: between(0.46, 0.75),
        y: [
          [0, 8],
          [0.46, 8],
          [0.52, 0],
          [1, 0],
        ],
      },
      box(170, 44, 124, 98, "page", 12),
      frame(170, 44, 124, 98, "soft", 12),
      { kind: "text", x: 184, y: 70, text: "3 × 4", size: 16, tone: "print" },
      { kind: "text", x: 184, y: 98, text: "= 12", size: 24, tone: "ink" },
      box(184, 110, 60, 22, "accent", 11),
      typed("Write", 199, 115, 30, "page"),
    ),
    taps(214, 121, [0.72]),
    {
      kind: "text",
      x: 160,
      y: 106,
      text: "12",
      size: 34,
      tone: "ink",
      motion: { opacity: shownFrom(0.78) },
    },
  ),
  solveLetter: sc(
    0.82,
    ruledPaper(),
    { kind: "text", x: 44, y: 76, text: "2x + 3 = 7", size: 30, tone: "ink" },
    {
      kind: "text",
      x: 44,
      y: 128,
      text: "x =",
      size: 30,
      tone: "ink",
      motion: { opacity: shownFrom(0.16) },
    },
    {
      kind: "text",
      x: 44,
      y: 128,
      text: "x =",
      size: 30,
      tone: "accent",
      motion: { opacity: between(0.32, 0.66) },
    },
    line("M44 138H92", "accent", 3, {
      opacity: between(0.32, 0.66),
      draw: drawnBetween(0.32, 0.4),
    }),
    taps(68, 118, [0.48]),
    group(
      { opacity: between(0.54, 0.7) },
      box(130, 100, 92, 40, "page", 12),
      frame(130, 100, 92, 40, "soft", 12),
      { kind: "text", x: 146, y: 127, text: "x = 2", size: 20, tone: "ink" },
    ),
    taps(176, 120, [0.64]),
    {
      kind: "text",
      x: 106,
      y: 128,
      text: "2",
      size: 30,
      tone: "ink",
      motion: { opacity: shownFrom(0.7) },
    },
  ),
  insertGraph: sc(
    0.82,
    ruledPaper(),
    word(30, 62, 110, 41, 12),
    // The calculator's graph, with its Insert graph button.
    box(176, 14, 130, 132, "page", 10),
    frame(176, 14, 130, 132, "soft", 10),
    typed("y = x² − 2", 190, 22, 64, "print"),
    line("M190 98H292M241 108V44", "soft", 1.2),
    line("M200 46C216 112 266 112 282 46", "blue", 2.6, { draw: drawnBetween(0.04, 0.22) }),
    box(196, 116, 90, 22, "accent", 11),
    typed("Insert graph", 208, 121, 66, "page"),
    taps(241, 127, [0.34]),
    // Its copy lands on the page.
    group(
      {
        opacity: shownFrom(0.38),
        x: movedTo(-158, 0.4, 0.7),
        y: movedTo(40, 0.4, 0.7),
      },
      box(186, 38, 110, 76, "page", 6),
      frame(186, 38, 110, 76, "accent", 6),
      line("M190 98H292M241 108V44", "soft", 1.2),
      line("M200 46C216 112 266 112 282 46", "blue", 2.6),
    ),
  ),
  looks: sc(
    0.5,
    desk(),
    // One tool bar, three looks.
    group(
      { opacity: shownUntil(0.28) },
      box(44, 46, 232, 40, "page", 20),
      frame(44, 46, 232, 40, "soft", 20),
      box(62, 54, 24, 24, "accent", 12),
      [1, 2, 3, 4].map((i) => box(66 + i * 42, 57, 18, 18, "soft", 5)),
    ),
    group(
      { opacity: between(0.33, 0.6) },
      box(48, 50, 232, 40, "ink", 0),
      box(44, 46, 232, 40, "page", 0),
      { kind: "rect", x: 44, y: 46, w: 232, h: 40, tone: "ink", width: 3 },
      box(62, 54, 24, 24, "mark", 0),
      { kind: "rect", x: 62, y: 54, w: 24, h: 24, tone: "ink", width: 3 },
      [1, 2, 3, 4].map((i) => box(66 + i * 42, 57, 18, 18, "ink", 0)),
    ),
    group(
      { opacity: between(0.65, 0.93) },
      box(44, 46, 232, 40, "page", 8),
      { kind: "rect", x: 44, y: 46, w: 232, h: 40, r: 8, tone: "ink", width: 1 },
      { kind: "rect", x: 62, y: 54, w: 24, h: 24, r: 4, tone: "ink", width: 1.5 },
      [0, 1, 2, 3, 4].map((i): SceneShape => ({
        kind: "circle",
        cx: 74 + i * 42 + (i === 0 ? 0 : 1),
        cy: 66,
        r: 7,
        tone: "ink",
        width: 1.2,
      })),
    ),
    // The chips that pick one.
    ...["Default", "Brutalist", "Paper"].map((name, i): SceneShape[] => [
      box(52 + i * 76, 118, 66, 26, "page", 13),
      frame(52 + i * 76, 118, 66, 26, "soft", 13),
      {
        kind: "rect",
        x: 52 + i * 76,
        y: 118,
        w: 66,
        h: 26,
        r: 13,
        tone: "accent",
        width: 2.5,
        motion: { opacity: i === 0 ? shownUntil(0.28) : between(0.03 + i * 0.3, 0.3 + i * 0.3) },
      },
      typed(name, 62 + i * 76, 126, 46, "print"),
    ]),
    taps(161, 131, [0.31]),
    taps(237, 131, [0.63]),
  ),
  lassoTray: sc(
    0.8,
    ruledPaper(),
    word(40, 132, 96, 23, 13),
    selection(32, 110, 112, 34),
    // The bar: colour, Copy, Duplicate, Delete, and the menu's dots.
    box(36, 70, 132, 30, "ink", 15),
    dot(54, 85, 6, "accent"),
    [0, 1].map((i) => box(71 + i * 24, 78, 14, 14, "soft", 4)),
    box(119, 78, 14, 14, "red", 4),
    [0, 1, 2].map((i) => dot(145 + i * 6, 85, 2, "page")),
    taps(151, 85, [0.24]),
    // The menu: a tray of four, then rows.
    group(
      {
        opacity: shownFrom(0.3),
        y: [
          [0, -8],
          [0.3, -8],
          [0.38, 0],
          [1, 0],
        ],
      },
      box(176, 30, 124, 128, "ink", 12),
      box(184, 38, 108, 44, "print", 9),
      [0, 1, 2, 3].flatMap((i): SceneShape[] => [
        box(193 + i * 26, 45, 12, 12, "page", 3, { opacity: shownFrom(0.36 + i * 0.05) }),
        box(191 + i * 26, 64, 16, 5, "soft", 2, { opacity: shownFrom(0.36 + i * 0.05) }),
      ]),
      [0, 1, 2].map((i) => box(190, 96 + i * 20, 70 - i * 14, 7, "soft", 3)),
    ),
    taps(199, 58, [0.72]),
  ),
  graphPopOut: sc(
    0.8,
    ruledPaper(),
    word(40, 106, 120, 87, 13),
    group(
      { x: movedTo(60, 0.24, 0.64), y: movedTo(-38, 0.24, 0.64), scale: LIFT },
      box(150, 70, 120, 92, "page", 8),
      frame(150, 70, 120, 92, "soft", 8),
      line("M160 148H260M168 158V80", "soft", 1.2),
      line("M168 142C200 134 226 110 256 84", "blue", 2.4),
    ),
  ),
  basicCalc: sc(
    0.5,
    Array.from({ length: 24 }, (_, i): SceneShape =>
      box(60 + (i % 6) * 34, 18 + Math.floor(i / 6) * 37, 28, 28, "desk", 5, {
        opacity: between(0, 0.42),
      }),
    ),
    Array.from({ length: 12 }, (_, i): SceneShape =>
      dot(70 + (i % 4) * 60, 34 + Math.floor(i / 4) * 56, 22, i % 4 === 3 ? "accent" : "desk", {
        opacity: shownFrom(0.48),
      }),
    ),
  ),
  spaceDrag: sc(
    0.76,
    desk(),
    group(
      { x: movedTo(-70, 0.24, 0.7) },
      box(120, 10, 140, 116, "page", 3),
      word(136, 66, 104, 88, 11),
    ),
    keyCap(90, 134, 140, "Space"),
  ),
  altZoom: sc(
    0.76,
    desk(),
    group(
      { scale: movedTo(1.5, 0.24, 0.7, 0.8) },
      box(110, 36, 100, 80, "page", 3),
      word(122, 82, 76, 89, 9),
    ),
    keyCap(132, 136, 56, "Alt"),
  ),
  shiftErase: sc(
    0.76,
    ruledPaper().slice(0, 2),
    word(70, 74, 180, 90, 13, { opacity: shownUntil(0.56) }),
    {
      kind: "path",
      d: "M60 62H262",
      tone: "ink",
      width: 0,
      pen: [0.2, 0.56],
      motion: {
        opacity: [
          [0, 0],
          [1, 0],
        ],
      },
    },
    keyCap(126, 118, 68, "Shift"),
  ),
  shortcutSheet: sc(
    0.8,
    Array.from({ length: 12 }, (_, i): SceneShape =>
      box(66 + (i % 4) * 50, 22 + Math.floor(i / 4) * 40, 40, 30, "desk", 6, {
        opacity: shownFrom(0.3 + i * 0.03),
      }),
    ),
    keyCap(140, 136, 40, "?"),
    taps(160, 154, [0.2]),
  ),
} satisfies Record<string, TipScene>;

export type SceneId = keyof typeof SCENES;

export function tipScene(id: SceneId): TipScene {
  return SCENES[id];
}

export const SCENE_IDS = Object.keys(SCENES) as SceneId[];
