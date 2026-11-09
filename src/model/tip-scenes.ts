/**
 * The moving pictures of Tips and What's new, as data. PURE.
 *
 * A picture is a little loop drawn on a 320 x 180 sheet: shapes, each with
 * tracks saying how it moves over one loop (offset 0 to 1). The plugin ships
 * no image files and speaks 43 languages, so a scene holds ink, marks and
 * maths, never a sentence, and costs a few hundred bytes.
 */

export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 180;
/** One loop of every picture, in ms. */
export const SCENE_MS = 5200;

export type Tone =
  "ink" | "accent" | "red" | "green" | "blue" | "mark" | "rule" | "soft" | "desk" | "page";

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
    })
  | (Painted & { kind: "rect"; x: number; y: number; w: number; h: number; r?: number })
  | (Painted & { kind: "circle"; cx: number; cy: number; r: number })
  | (Painted & { kind: "text"; x: number; y: number; text: string; size: number })
  | { kind: "group"; motion?: Motion; children: SceneShape[] };

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

/** A path that reads as a line of cursive in any language: humps of varied height. */
export function scrawl(x: number, y: number, width: number, seed = 1, height = 12): string {
  const random = rng(seed);
  let at = x;
  let d = `M${x} ${y}`;
  while (at < x + width) {
    const step = height * 0.75 + random() * height * 0.55;
    const tall = random() > 0.76;
    const top = y - height * (tall ? 1.5 : 0.72) - random() * 3;
    const foot = y + (random() - 0.5) * 2.4;
    d += ` C${round(at + step * 0.08)} ${round(y)} ${round(at + step * 0.2)} ${round(top)}`;
    d += ` ${round(at + step * 0.52)} ${round(top)}`;
    d += ` S${round(at + step * 0.72)} ${round(y + 2.5)} ${round(at + step)} ${round(foot)}`;
    at += step;
  }
  return d;
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

/** Rows of grey bars: a printed page in no language. */
function printed(rows: ReadonlyArray<readonly [y: number, widths: readonly number[]]>) {
  const shapes: SceneShape[] = [];
  for (const [y, widths] of rows) {
    let x = 34;
    for (const w of widths) {
      shapes.push({ kind: "rect", x, y, w, h: 8, r: 3, tone: "soft", fill: true });
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

function searchPill(typeA: number, typeB: number, seed: number): SceneShape[] {
  return [
    { kind: "rect", x: 60, y: 12, w: 200, h: 30, r: 10, tone: "page", fill: true },
    { kind: "rect", x: 60, y: 12, w: 200, h: 30, r: 10, tone: "soft", width: 1 },
    { kind: "circle", cx: 79, cy: 26, r: 5.5, tone: "soft", width: 2 },
    { kind: "path", d: "M83 30l5 5", tone: "soft", width: 2 },
    written(scrawl(100, 32, 72, seed, 9), typeA, typeB, false),
  ];
}

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
      ...searchPill(0.1, 0.38, 21),
      ...[110, 142].map((y): SceneShape => ({
        kind: "path",
        d: `M0 ${y}H320`,
        tone: "rule",
        width: 1,
      })),
      { kind: "rect", x: 130, y: 80, w: 82, h: 28, r: 3, tone: "mark", fill: true, motion: FOUND },
      ink(scrawl(44, 104, 76, 14, 13)),
      ink(scrawl(134, 104, 72, 21, 9)),
      ink(scrawl(216, 104, 60, 16, 13)),
      ink(scrawl(44, 136, 170, 17, 13)),
    ],
  },
  homeSearch: {
    rest: 0.76,
    shapes: [
      { kind: "rect", x: 0, y: 0, w: 320, h: 180, tone: "desk", fill: true },
      ...searchPill(0.1, 0.34, 23),
      ...[54, 128, 202].map((x) => miniPage(x, 68)),
      ink(scrawl(62, 96, 46, 4, 7)),
      ink(scrawl(62, 116, 50, 7, 7)),
      ink(scrawl(136, 96, 48, 8, 7)),
      { kind: "rect", x: 134, y: 106, w: 52, h: 16, r: 2, tone: "mark", fill: true, motion: FOUND },
      ink(scrawl(136, 118, 46, 23, 7)),
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
      { kind: "text", x: 44, y: 106, text: "x = 2y + 1", size: 30, tone: "ink" },
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
        kind: "rect",
        x: 124,
        y: 74 + i * 15,
        w: 72 - (i % 2) * 18,
        h: 8,
        r: 3,
        tone: "ink",
        fill: true,
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
        motion: { scale: movedTo(1.45, 0.24, 0.66, 1) },
        children: [ink(scrawl(118, 96, 86, 31, 13)), ...selection(108, 68, 106, 40)],
      },
      {
        kind: "circle",
        cx: 110,
        cy: 120,
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
          x: movedTo(-36, 0.24, 0.66),
          y: movedTo(18, 0.24, 0.66),
        },
      },
      {
        kind: "circle",
        cx: 214,
        cy: 66,
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
          x: movedTo(36, 0.24, 0.66),
          y: movedTo(-18, 0.24, 0.66),
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
      {
        kind: "rect",
        x: 140,
        y: 53,
        w: 40,
        h: 8,
        r: 3,
        tone: "page",
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
      taps(160, 57, [0.5]),
      ink(scrawl(100, 106, 124, 33, 14), { opacity: shownFrom(0.58) }),
    ],
  },
  turnIntoText: {
    rest: 0.8,
    shapes: [
      ...ruledPaper(),
      ink(scrawl(66, 76, 190, 35, 13), { opacity: shownUntil(0.5) }),
      ink(scrawl(66, 108, 150, 36, 13), { opacity: shownUntil(0.5) }),
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
      ...[0, 1, 2, 3, 4].map((i): SceneShape => ({
        kind: "rect",
        x: 66 + i * 40,
        y: 62,
        w: 34,
        h: 9,
        r: 3,
        tone: "ink",
        fill: true,
        motion: { opacity: shownFrom(0.52 + i * 0.03) },
      })),
      ...[0, 1, 2, 3].map((i): SceneShape => ({
        kind: "rect",
        x: 66 + i * 40,
        y: 94,
        w: 34,
        h: 9,
        r: 3,
        tone: "ink",
        fill: true,
        motion: { opacity: shownFrom(0.66 + i * 0.03) },
      })),
    ],
  },
  correctWord: {
    rest: 0.5,
    shapes: [
      ...ruledPaper(),
      ink(scrawl(44, 106, 74, 37, 13)),
      ink(scrawl(130, 106, 76, 38, 13)),
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
          { kind: "rect", x: 118, y: 134, w: 76, h: 8, r: 3, tone: "ink", fill: true },
          { kind: "rect", x: 118, y: 152, w: 58, h: 8, r: 3, tone: "soft", fill: true },
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
          { kind: "rect", x: 104, y: 72, w: 112, h: 9, r: 3, tone: "ink", fill: true },
          { kind: "rect", x: 104, y: 92, w: 80, h: 9, r: 3, tone: "ink", fill: true },
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
} satisfies Record<string, TipScene>;

export type SceneId = keyof typeof SCENES;

export function tipScene(id: SceneId): TipScene {
  return SCENES[id];
}

export const SCENE_IDS = Object.keys(SCENES) as SceneId[];
