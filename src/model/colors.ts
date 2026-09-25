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
