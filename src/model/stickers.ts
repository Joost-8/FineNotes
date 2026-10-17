/**
 * The built-in sticker pack: arrows, labels, washi tape, icons and doodles,
 * each a small SVG drawn in one colour and a soft tint of it, so the whole
 * pack recolours from a single choice. A placed sticker is an ordinary
 * picture: its SVG is saved beside the notebook, as every picture is, so a
 * notebook never depends on the plugin's copy.
 *
 * Pure: no DOM, no Obsidian. `stickerSvg` gives the file's text.
 */

export type StickerCategory = "arrows" | "labels" | "tape" | "icons" | "doodles";

export const STICKER_CATEGORIES: ReadonlyArray<{ id: StickerCategory; label: string }> = [
  { id: "arrows", label: "Arrows" },
  { id: "labels", label: "Labels" },
  { id: "tape", label: "Tape" },
  { id: "icons", label: "Icons" },
  { id: "doodles", label: "Doodles" },
];

/** The colours a sticker is drawn in: `ink` for lines, `tint` for soft fills. */
export interface StickerInk {
  ink: string;
  tint: string;
}

export interface Sticker {
  id: string;
  name: string;
  category: StickerCategory;
  /** The SVG's own size, which is also the size it is placed at, in page px. */
  w: number;
  h: number;
  /** The drawing inside the `<svg>`, in a `0 0 w h` box. */
  body: (c: StickerInk) => string;
}

const line = (d: string, c: StickerInk, width = 3): string =>
  `<path d="${d}" fill="none" stroke="${c.ink}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

const solid = (d: string, fill: string): string => `<path d="${d}" fill="${fill}"/>`;

/** An open arrowhead at (x, y) pointing along `angle` degrees. */
const head = (x: number, y: number, angle: number, c: StickerInk, size = 11): string => {
  const a = (angle * Math.PI) / 180;
  const at = (turn: number): string => {
    const t = a + Math.PI + (turn * Math.PI) / 180;
    return `${(x + size * Math.cos(t)).toFixed(1)} ${(y + size * Math.sin(t)).toFixed(1)}`;
  };
  return line(`M${at(-32)} L${x} ${y} L${at(32)}`, c);
};

/** A strip of washi tape with torn ends, its pattern drawn by `pattern`. */
const tape =
  (pattern: (c: StickerInk) => string) =>
  (c: StickerInk): string => {
    const torn =
      "M4 6 L9 2 L14 6 L20 2 L196 2 L201 6 L196 10 L201 14 L196 18 L201 22 L196 26 L201 30 L196 34 L20 34 L14 30 L9 34 L4 30 L9 26 L4 22 L9 18 L4 14 L9 10 Z";
    return (
      `<defs><clipPath id="t"><path d="${torn}"/></clipPath></defs>` +
      solid(torn, c.tint) +
      `<g clip-path="url(#t)">${pattern(c)}</g>`
    );
  };

/** Points of a star with `n` tips round (cx, cy). */
const star = (cx: number, cy: number, r: number, inner: number, n = 5): string => {
  const parts: string[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const radius = i % 2 === 0 ? r : r * inner;
    const t = -Math.PI / 2 + (i * Math.PI) / n;
    parts.push(
      `${(cx + radius * Math.cos(t)).toFixed(1)} ${(cy + radius * Math.sin(t)).toFixed(1)}`,
    );
  }
  return `M${parts.join(" L")} Z`;
};

export const STICKERS: readonly Sticker[] = [
  // --- Arrows: drawn as by hand, an open head.
  {
    id: "arrow-curve",
    name: "Curved arrow",
    category: "arrows",
    w: 120,
    h: 70,
    body: (c) => line("M8 60 C 30 10, 80 6, 108 26", c) + head(108, 26, 35, c),
  },
  {
    id: "arrow-loop",
    name: "Loop arrow",
    category: "arrows",
    w: 130,
    h: 70,
    body: (c) =>
      line("M8 50 C 30 50, 52 44, 58 30 C 64 14, 44 8, 40 22 C 36 38, 70 52, 118 46", c) +
      head(118, 46, -8, c),
  },
  {
    id: "arrow-straight",
    name: "Arrow",
    category: "arrows",
    w: 120,
    h: 30,
    body: (c) => line("M6 16 C 40 13, 80 17, 112 15", c) + head(112, 15, -2, c),
  },
  {
    id: "arrow-double",
    name: "Two-way arrow",
    category: "arrows",
    w: 120,
    h: 30,
    body: (c) => line("M10 15 L110 15", c) + head(110, 15, 0, c) + head(10, 15, 180, c),
  },
  {
    id: "arrow-turn",
    name: "Turning arrow",
    category: "arrows",
    w: 80,
    h: 90,
    body: (c) => line("M12 8 L12 56 C 12 72, 20 78, 36 78 L70 78", c) + head(70, 78, 0, c),
  },
  // --- Labels: a soft fill with an ink edge, room to write on.
  {
    id: "label-banner",
    name: "Banner",
    category: "labels",
    w: 200,
    h: 60,
    body: (c) =>
      solid("M18 16 L4 16 L12 30 L4 44 L30 44 Z M182 16 L196 16 L188 30 L196 44 L170 44 Z", c.ink) +
      solid("M24 8 L176 8 L176 40 L24 40 Z", c.tint) +
      line("M24 8 L176 8 L176 40 L24 40 Z", c, 2.5),
  },
  {
    id: "label-tag",
    name: "Tag",
    category: "labels",
    w: 150,
    h: 56,
    body: (c) =>
      solid("M30 6 L140 6 Q146 6 146 12 L146 44 Q146 50 140 50 L30 50 L6 28 Z", c.tint) +
      line("M30 6 L140 6 Q146 6 146 12 L146 44 Q146 50 140 50 L30 50 L6 28 Z", c, 2.5) +
      `<circle cx="28" cy="28" r="5" fill="none" stroke="${c.ink}" stroke-width="2.5"/>`,
  },
  {
    id: "label-bubble",
    name: "Speech bubble",
    category: "labels",
    w: 150,
    h: 100,
    body: (c) => {
      const d =
        "M24 8 L126 8 Q142 8 142 24 L142 60 Q142 76 126 76 L58 76 L32 94 L38 76 L24 76 Q8 76 8 60 L8 24 Q8 8 24 8 Z";
      return solid(d, c.tint) + line(d, c, 2.5);
    },
  },
  {
    id: "label-note",
    name: "Sticky note",
    category: "labels",
    w: 120,
    h: 120,
    body: (c) =>
      solid("M8 8 L112 8 L112 88 L88 112 L8 112 Z", c.tint) +
      solid("M112 88 L88 88 L88 112 Z", c.ink) +
      line("M8 8 L112 8 L112 88 L88 112 L8 112 Z", c, 1.5),
  },
  {
    id: "label-circle",
    name: "Number badge",
    category: "labels",
    w: 60,
    h: 60,
    body: (c) =>
      `<circle cx="30" cy="30" r="25" fill="${c.tint}" stroke="${c.ink}" stroke-width="2.5"/>`,
  },
  // --- Tape: a translucent strip with a pattern.
  {
    id: "tape-plain",
    name: "Plain tape",
    category: "tape",
    w: 205,
    h: 36,
    body: tape(() => ""),
  },
  {
    id: "tape-stripes",
    name: "Striped tape",
    category: "tape",
    w: 205,
    h: 36,
    body: tape((c) => {
      const out: string[] = [];
      for (let x = -40; x < 220; x += 16) out.push(`M${x} 40 L${x + 30} -4`);
      return `<path d="${out.join(" ")}" stroke="${c.ink}" stroke-opacity="0.35" stroke-width="6"/>`;
    }),
  },
  {
    id: "tape-dots",
    name: "Dotted tape",
    category: "tape",
    w: 205,
    h: 36,
    body: tape((c) => {
      const out: string[] = [];
      for (let y = 8, row = 0; y < 36; y += 10, row++) {
        for (let x = row % 2 ? 14 : 8; x < 205; x += 12) out.push(`M${x} ${y}h0.01`);
      }
      return `<path d="${out.join("")}" stroke="${c.ink}" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round"/>`;
    }),
  },
  {
    id: "tape-grid",
    name: "Grid tape",
    category: "tape",
    w: 205,
    h: 36,
    body: tape((c) => {
      const out: string[] = [];
      for (let x = 0; x < 210; x += 9) out.push(`M${x} 0 V36`);
      for (let y = 0; y < 40; y += 9) out.push(`M0 ${y} H210`);
      return `<path d="${out.join(" ")}" stroke="${c.ink}" stroke-opacity="0.25" stroke-width="1"/>`;
    }),
  },
  // --- Icons.
  {
    id: "icon-star",
    name: "Star",
    category: "icons",
    w: 60,
    h: 60,
    body: (c) => {
      const d = star(30, 32, 26, 0.45);
      return solid(d, c.tint) + line(d, c, 2.5);
    },
  },
  {
    id: "icon-heart",
    name: "Heart",
    category: "icons",
    w: 60,
    h: 56,
    body: (c) => {
      const d =
        "M30 50 C 8 36, 4 22, 10 14 C 16 6, 26 8, 30 16 C 34 8, 44 6, 50 14 C 56 22, 52 36, 30 50 Z";
      return solid(d, c.tint) + line(d, c, 2.5);
    },
  },
  {
    id: "icon-check",
    name: "Check",
    category: "icons",
    w: 60,
    h: 60,
    body: (c) =>
      `<circle cx="30" cy="30" r="25" fill="${c.tint}" stroke="${c.ink}" stroke-width="2.5"/>` +
      line("M18 31 L27 40 L43 21", c, 4),
  },
  {
    id: "icon-idea",
    name: "Light bulb",
    category: "icons",
    w: 56,
    h: 70,
    body: (c) => {
      const bulb =
        "M28 6 C 14 6, 8 16, 8 25 C 8 34, 16 39, 19 46 L37 46 C 40 39, 48 34, 48 25 C 48 16, 42 6, 28 6 Z";
      return solid(bulb, c.tint) + line(bulb, c, 2.5) + line("M20 54 L36 54 M22 62 L34 62", c, 2.5);
    },
  },
  {
    id: "icon-warning",
    name: "Warning",
    category: "icons",
    w: 64,
    h: 58,
    body: (c) => {
      const d = "M32 6 L60 52 L4 52 Z";
      return (
        solid(d, c.tint) +
        line(d, c, 2.5) +
        line("M32 22 L32 36", c, 4) +
        `<circle cx="32" cy="44" r="2.6" fill="${c.ink}"/>`
      );
    },
  },
  {
    id: "icon-pin",
    name: "Pin",
    category: "icons",
    w: 48,
    h: 64,
    body: (c) =>
      `<circle cx="24" cy="20" r="15" fill="${c.tint}" stroke="${c.ink}" stroke-width="2.5"/>` +
      `<circle cx="19" cy="15" r="4" fill="#ffffff" fill-opacity="0.8"/>` +
      line("M24 35 L24 60", c, 2.5),
  },
  {
    id: "icon-bookmark",
    name: "Bookmark",
    category: "icons",
    w: 40,
    h: 64,
    body: (c) => {
      const d = "M6 4 L34 4 L34 60 L20 48 L6 60 Z";
      return solid(d, c.tint) + line(d, c, 2.5);
    },
  },
  {
    id: "icon-flower",
    name: "Flower",
    category: "icons",
    w: 64,
    h: 64,
    body: (c) => {
      const petals: string[] = [];
      for (let i = 0; i < 6; i++) {
        const t = (i * Math.PI) / 3;
        const x = (32 + 15 * Math.cos(t)).toFixed(1);
        const y = (32 + 15 * Math.sin(t)).toFixed(1);
        petals.push(
          `<circle cx="${x}" cy="${y}" r="11" fill="${c.tint}" stroke="${c.ink}" stroke-width="2"/>`,
        );
      }
      return `${petals.join("")}<circle cx="32" cy="32" r="8" fill="${c.ink}"/>`;
    },
  },
  // --- Doodles: ink only.
  {
    id: "doodle-sparkles",
    name: "Sparkles",
    category: "doodles",
    w: 70,
    h: 64,
    body: (c) => {
      const spark = (x: number, y: number, r: number): string =>
        `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`;
      return solid(`${spark(26, 34, 22)} ${spark(56, 14, 10)} ${spark(58, 50, 7)}`, c.ink);
    },
  },
  {
    id: "doodle-swash",
    name: "Underline swash",
    category: "doodles",
    w: 200,
    h: 30,
    body: (c) => line("M6 20 C 50 8, 90 26, 130 14 C 155 7, 175 10, 194 16", c, 4),
  },
  {
    id: "doodle-circle",
    name: "Scribbled circle",
    category: "doodles",
    w: 140,
    h: 80,
    body: (c) =>
      line(
        "M96 10 C 60 2, 14 12, 10 38 C 6 64, 56 74, 96 68 C 130 62, 136 36, 118 22 C 104 12, 80 10, 60 12",
        c,
        2.5,
      ),
  },
  {
    id: "doodle-squiggle",
    name: "Squiggle divider",
    category: "doodles",
    w: 200,
    h: 24,
    body: (c) => {
      let d = "M4 12";
      for (let x = 4; x < 192; x += 16) d += ` q4 -10 8 0 q4 10 8 0`;
      return line(d, c, 2.5);
    },
  },
  {
    id: "doodle-dots",
    name: "Dot divider",
    category: "doodles",
    w: 200,
    h: 16,
    body: (c) => {
      const dots: string[] = [];
      for (let x = 8; x < 200; x += 14)
        dots.push(`<circle cx="${x}" cy="8" r="2.8" fill="${c.ink}"/>`);
      return dots.join("");
    },
  },
  {
    id: "doodle-bracket",
    name: "Bracket",
    category: "doodles",
    w: 40,
    h: 140,
    body: (c) =>
      line(
        "M32 6 C 18 6, 20 20, 20 50 C 20 64, 14 70, 6 70 C 14 70, 20 76, 20 90 C 20 120, 18 134, 32 134",
        c,
        3,
      ),
  },
];

/** A sticker by id, or `undefined`. */
export function stickerById(id: string): Sticker | undefined {
  return STICKERS.find((s) => s.id === id);
}

/** The colours a sticker in `color` is drawn in: the colour, and a light tint of it. */
export function stickerInk(color: string, tintAlpha = 0.3): StickerInk {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#1a1a1a";
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  // Mixed with white rather than see-through: a tint that hides what is under it.
  const mix = (v: number): string =>
    Math.round(255 - (255 - v) * tintAlpha)
      .toString(16)
      .padStart(2, "0");
  return { ink: hex, tint: `#${mix(r)}${mix(g)}${mix(b)}` };
}

/** The sticker as a standalone SVG file in `color`. */
export function stickerSvg(sticker: Sticker, color: string): string {
  const c = stickerInk(color);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sticker.w}" height="${sticker.h}" ` +
    `viewBox="0 0 ${sticker.w} ${sticker.h}">${sticker.body(c)}</svg>`
  );
}

/** A file name for a placed sticker: its name and colour, so a folder of them reads well. */
export function stickerFileName(sticker: Sticker, color: string): string {
  return `Sticker ${sticker.name} ${stickerInk(color).ink.slice(1)}`;
}

/** Where the user's sticker collections live until they choose another folder. */
export const DEFAULT_STICKER_FOLDER = "FineNotes stickers";

/** The stickers folder as set, or the default for a blank or unreadable one; no slashes at the ends. */
export function stickerFolderOf(value: unknown): string {
  const text = typeof value === "string" ? value.trim().replace(/^\/+|\/+$/g, "") : "";
  return text || DEFAULT_STICKER_FOLDER;
}
