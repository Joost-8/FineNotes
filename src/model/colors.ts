/**
 * Colours the user can pick: a palette of common ones, colours typed as hex
 * or picked by hue, saturation and brightness, and a short list of recent
 * custom ones.
 * Every colour stored in a note is `#rrggbb`, lower case.
 *
 * PURE: no DOM, no Obsidian.
 */

/**
 * The picker's common colours: a row of neutrals, then each hue dark to
 * light. Chosen to read on white paper; the lightest row is for highlights
 * and box fills.
 */
export const COMMON_COLORS: readonly string[] = [
  // Neutrals
  "#000000",
  "#495057",
  "#868e96",
  "#ced4da",
  "#ffffff",
  // Deep
  "#c92a2a",
  "#d9480f",
  "#e67700",
  "#2b8a3e",
  "#1864ab",
  "#5f3dc4",
  "#a61e4d",
  // Bright
  "#fa5252",
  "#fd7e14",
  "#fcc419",
  "#40c057",
  "#228be6",
  "#7950f2",
  "#e64980",
  // Light
  "#ffc9c9",
  "#ffd8a8",
  "#fff3bf",
  "#d3f9d8",
  "#d0ebff",
  "#e5dbff",
  "#fcc2d7",
];

/** Most custom colours remembered. */
export const MAX_RECENT_COLORS = 8;

/** A shape's colour until one is picked. */
export const DEFAULT_SHAPE_COLOR = "#000000";

/**
 * A colour as typed — `#abc`, `abc`, `#aabbcc`, `AABBCC`, with spaces — as
 * `#aabbcc`, or `null` when it is not one.
 */
export function parseHexColor(input: string): string | null {
  const text = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(text)) {
    return `#${[...text].map((c) => c + c).join("")}`;
  }
  return /^[0-9a-f]{6}$/.test(text) ? `#${text}` : null;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rrggbb` (or anything {@link parseHexColor} reads) as 0–255 channels; `null` if unreadable. */
export function hexToRgb(hex: string): Rgb | null {
  const color = parseHexColor(hex);
  if (!color) return null;
  const n = Number.parseInt(color.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Channels as `#rrggbb`, each rounded and clamped to 0–255. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 0)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * A colour as the custom-colour square picks it: hue in degrees
 * (0 ≤ h < 360), saturation and value (brightness) from 0 to 1.
 */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

function unit(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** 0–255 channels as hue, saturation and value. A grey has no hue: `h` is 0. */
export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = unit(r / 255);
  const green = unit(g / 255);
  const blue = unit(b / 255);
  const max = Math.max(red, green, blue);
  const spread = max - Math.min(red, green, blue);
  let h = 0;
  if (spread > 0) {
    if (max === red) h = (green - blue) / spread;
    else if (max === green) h = (blue - red) / spread + 2;
    else h = (red - green) / spread + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : spread / max, v: max };
}

/**
 * Hue, saturation and value as 0–255 channels (not rounded: {@link rgbToHex}
 * rounds). The hue wraps (360° is red again, −120° is blue); saturation and
 * value are clamped to 0–1, and anything not a number counts as 0.
 */
export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = Number.isFinite(h) ? (((h % 360) + 360) % 360) / 60 : 0;
  const sat = unit(s);
  const val = unit(v);
  const chroma = val * sat;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const [r, g, b] =
    hue < 1
      ? [chroma, x, 0]
      : hue < 2
        ? [x, chroma, 0]
        : hue < 3
          ? [0, chroma, x]
          : hue < 4
            ? [0, x, chroma]
            : hue < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = val - chroma;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/**
 * `color` at the front of the recent list, without repeats, at most
 * {@link MAX_RECENT_COLORS}. A colour already in the common palette is not
 * recent — it is always one tap away — and neither is anything unreadable.
 */
export function pushRecentColor(recent: readonly string[], color: string): string[] {
  const hex = parseHexColor(color);
  const kept = recent
    .map((c) => parseHexColor(c))
    .filter((c): c is string => c !== null && c !== hex);
  if (!hex || COMMON_COLORS.includes(hex)) return kept.slice(0, MAX_RECENT_COLORS);
  return [hex, ...kept].slice(0, MAX_RECENT_COLORS);
}

/** Swatches the pen's colour row shows at once, and holds before it is first edited. */
export const PEN_ROW_SIZE = 5;

/** The most colours a pen type's row holds, reserved ones included; more scroll. */
export const PEN_ROW_MAX = 24;

/** Readable colours as `#rrggbb`, each once, in order; anything else dropped. */
function uniqueColors(colors: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const item of colors) {
    const hex = typeof item === "string" ? parseHexColor(item) : null;
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

/**
 * The colours the settings define keep their own slots at the front of the
 * pen's row: the default ink colour, then the custom palette colours. At most
 * one less than the row, so a picked colour always has a slot to go to.
 */
export function reservedPenColors(defined: readonly unknown[]): string[] {
  return uniqueColors(defined).slice(0, PEN_ROW_SIZE - 1);
}

/**
 * The pen's row: the reserved colours, then the ones the user keeps, at most
 * {@link PEN_ROW_MAX}. A row never edited (`picked` absent) is topped up
 * from `fill` (the built-in palette) to {@link PEN_ROW_SIZE}; a stored row
 * is the user's own and is not, so a colour they removed stays removed.
 * Rows stored before the row grew were always full, so they read the same.
 */
export function penColorRow(
  reserved: readonly string[],
  picked: readonly unknown[] | undefined,
  fill: readonly string[],
): string[] {
  const row = reservedPenColors(reserved);
  const stored = Array.isArray(picked) ? picked : null;
  const limit = stored ? PEN_ROW_MAX : PEN_ROW_SIZE;
  for (const color of uniqueColors(stored ?? fill)) {
    if (row.length >= limit) break;
    if (!row.includes(color)) row.push(color);
  }
  return row;
}

/**
 * The picked slots of `row` (its first `reservedCount` are reserved) once
 * `color` is chosen. A colour already in the row changes nothing, so a pick
 * stays where it is. `replace` is the swatch whose picker chose it: a picked
 * slot is changed in place, as GoodNotes edits the swatch it opened from.
 * Otherwise the new colour joins the end of the row, as GoodNotes' "+" adds
 * one, unless the row is full.
 */
export function pickPenColor(
  row: readonly string[],
  reservedCount: number,
  color: string,
  replace?: string,
): string[] {
  const free = row.slice(reservedCount);
  const hex = parseHexColor(color);
  if (!hex || row.includes(hex)) return free;
  const at = replace ? free.indexOf(parseHexColor(replace) ?? "") : -1;
  if (at >= 0) {
    free[at] = hex;
    return free;
  }
  return row.length < PEN_ROW_MAX ? [...free, hex] : free;
}

/**
 * The picked slots of `row` without `color`. A reserved colour comes from
 * the settings and would only come back, so it stays.
 */
export function removePenColor(
  row: readonly string[],
  reservedCount: number,
  color: string,
): string[] {
  const free = row.slice(reservedCount);
  return free.filter((c) => !sameColor(c, color));
}

/** Whether `color` is one of `row`'s colours the user can remove. */
export function removablePenColor(
  row: readonly string[],
  reservedCount: number,
  color: string,
): boolean {
  return row.slice(reservedCount).some((c) => sameColor(c, color));
}

/**
 * The colour to write with once `color` leaves `row`: the swatch before it,
 * or after it when it was first; null when it was the only one.
 */
export function colorAfterRemoving(row: readonly string[], color: string): string | null {
  const at = row.findIndex((c) => sameColor(c, color));
  if (at < 0) return null;
  return row[at - 1] ?? row[at + 1] ?? null;
}

/** Stored recent colours, cleaned: readable, unique, at most {@link MAX_RECENT_COLORS}. */
export function recentColorsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const hex = typeof item === "string" ? parseHexColor(item) : null;
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length === MAX_RECENT_COLORS) break;
  }
  return out;
}

/** Whether `a` and `b` are the same colour, however each is written. */
export function sameColor(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  const x = parseHexColor(a);
  return x !== null && x === parseHexColor(b);
}

/**
 * A mark that reads on a swatch of `color`: near-black on a light colour,
 * white on a dark one (WCAG relative luminance, split where the two contrast
 * equally). An unreadable colour gets the dark mark.
 */
export function contrastMark(color: string): "#1a1a1a" | "#ffffff" {
  const rgb = hexToRgb(color);
  if (!rgb) return "#1a1a1a";
  const linear = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
  return luminance > 0.179 ? "#1a1a1a" : "#ffffff";
}
