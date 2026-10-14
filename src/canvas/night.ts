/**
 * Dark pages: how a stored colour is shown on a page drawn for night use.
 *
 * Dark pages are a view setting and nothing more. Every colour in a note
 * stays the true colour it was written in (ink colour is absolute,
 * contracts/design-brief.md); this module only decides what is *painted*,
 * at render time, and export, printing and the colour picker never see it.
 *
 * The mapping inverts lightness and keeps hue, in OKLCH, so that what was
 * dark on white paper is light on dark paper and keeps its colour: black ink
 * is shown near-white, dark blue light blue, and a saturated red stays red.
 * Lightness is mapped onto the band between {@link NIGHT_PAPER_L} (white
 * paper) and {@link NIGHT_INK_L} (black ink), so the dark paper is not pure
 * black and the ink not pure white, which is easier on the eyes at night.
 * The map is a curve ({@link NIGHT_GAMMA}), not a straight line: a straight
 * inversion leaves the bright colours of the palette (a bright red, a green,
 * an orange: lightness 0.6–0.75 on white) in the dull middle of the night
 * band, and they read as dark red and olive. The curve lifts them, while
 * still mapping white to the paper and black to the ink and keeping every
 * colour's order: lighter by day is darker at night, without exception.
 * Black starts at {@link INK_BLACK_L}, the default pen's soft black
 * (`#1a1a1a`): ink that dark is shown at the full night ink, not a grey.
 * So ink that matched its paper still matches it, which is the answer to
 * white ink: on white paper it is a correction ink, the colour of the
 * paper, and at night it is shown the colour of the dark paper.
 *
 * A page whose paper is already dark (a navy cover, a black page) is left
 * exactly as it is, ink and all: it is a night page already, and inverting
 * it would turn its light writing dark on dark ({@link paperFlips}).
 *
 * PURE: no DOM, no Obsidian. The one canvas routine, {@link invertPdfArea},
 * only issues draw calls on a context it is handed.
 */

/** OKLab lightness white paper is shown at: a dark grey, not black. */
export const NIGHT_PAPER_L = 0.22;
/** OKLab lightness black ink is shown at: a soft white. */
export const NIGHT_INK_L = 0.93;
/**
 * The curve of the lightness map: darkness by day `1 − L` is raised to this
 * power before it is spread over the night band. Under 1, the middle tones
 * come out lighter than a straight inversion would put them.
 */
export const NIGHT_GAMMA = 0.6;
/**
 * OKLab lightness of the darkest ink that is told apart: the default pen,
 * `#1a1a1a`, is 0.218. Anything as dark counts as black and is shown at
 * {@link NIGHT_INK_L}.
 */
export const INK_BLACK_L = 0.22;

/** Highlighter ink is multiplied into light paper, and screened onto dark. */
export const DAY_HIGHLIGHTER_BLEND = "multiply";
export const NIGHT_HIGHLIGHTER_BLEND = "screen";

/** Lightness a highlighter is shown at, at night, by its true lightness 0 and 1. */
const NIGHT_HIGHLIGHT_L = { dark: 0.48, light: 0.6 };

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** sRGB channels 0–1 and alpha 0–1. */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

// --- Parsing and printing ----------------------------------------------------

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN = /^rgba?\(\s*([^)]*)\)$/i;

/**
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(…)` or `rgba(…)` (commas or
 * spaces, an optional `/ alpha`) as channels; anything else is `null`.
 */
export function parseCssColor(input: string): Rgba | null {
  const text = input.trim();
  const hex = HEX.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    const byte = (i: number): number => Number.parseInt(digits.slice(i, i + 2), 16) / 255;
    return { r: byte(0), g: byte(2), b: byte(4), a: digits.length === 8 ? byte(6) : 1 };
  }
  const fn = RGB_FN.exec(text);
  if (!fn) return null;
  const parts = fn[1]
    .replace("/", " ")
    .split(/[\s,]+/)
    .filter((p) => p !== "");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const value = (part: string, scale: number): number => {
    const n = Number.parseFloat(part);
    if (!Number.isFinite(n)) return Number.NaN;
    return part.endsWith("%") ? n / 100 : n / scale;
  };
  const [r, g, b] = parts.slice(0, 3).map((p) => value(p, 255));
  const a = parts.length === 4 ? value(parts[3], 1) : 1;
  if (![r, g, b, a].every(Number.isFinite)) return null;
  const unit = (v: number): number => Math.max(0, Math.min(1, v));
  return { r: unit(r), g: unit(g), b: unit(b), a: unit(a) };
}

function hexByte(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v * 255)))
    .toString(16)
    .padStart(2, "0");
}

/** `#rrggbb`, or `rgba(…)` when not opaque. */
function cssOf({ r, g, b, a }: Rgba): string {
  if (a >= 1) return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${Math.round(a * 1000) / 1000})`;
}

// --- OKLab ---------------------------------------------------------------------

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function toOklch({ r, g, b }: Rgba): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

/** Linear sRGB of an OKLCH colour; may lie outside 0–1 (out of gamut). */
function linearOf({ l, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

function inGamut(rgb: readonly number[]): boolean {
  return rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

/**
 * Back to sRGB, keeping lightness and hue: a colour the screen cannot show
 * loses chroma until it can, never lightness, which carries the contrast.
 */
function fromOklch(color: Oklch, a: number): Rgba {
  let rgb = linearOf(color);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(linearOf({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    rgb = linearOf({ ...color, c: lo });
  }
  const [r, g, b] = rgb.map((v) => fromLinear(Math.max(0, Math.min(1, v))));
  return { r, g, b, a };
}

// --- The mapping --------------------------------------------------------------

/** A colour in OKLCH (hue in radians); `null` when it is not one {@link parseCssColor} reads. */
export function oklchOf(color: string): Oklch | null {
  const rgba = parseCssColor(color);
  return rgba ? toOklch(rgba) : null;
}

/** OKLab lightness of a colour, 0–1; `null` when it is not one {@link parseCssColor} reads. */
export function lightnessOf(color: string): number | null {
  return oklchOf(color)?.l ?? null;
}

/** The lightness `l` (0–1) is shown at on a night page. */
export function nightLightness(l: number): number {
  const t = Math.max(0, Math.min(1, (l - INK_BLACK_L) / (1 - INK_BLACK_L)));
  return NIGHT_PAPER_L + (NIGHT_INK_L - NIGHT_PAPER_L) * (1 - t) ** NIGHT_GAMMA;
}

/**
 * The lightness at which a paper is shown the same at night as by day. A
 * paper darker than this is already a night page. The map falls and the
 * identity rises, so they meet once; bisection finds where.
 */
export const FLIP_POINT = ((): number => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (nightLightness(mid) > mid) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
})();

/**
 * Whether a page with this (true) paper colour is shown inverted at night.
 * Light paper is; paper already darker than {@link FLIP_POINT} is left as it
 * is, with everything on it. An unreadable colour counts as white paper.
 */
export function paperFlips(paper: string): boolean {
  return (lightnessOf(paper) ?? 1) > FLIP_POINT;
}

const shown = new Map<string, string>();
const highlights = new Map<string, string>();
/** Bound for each memo: a document holds few distinct colours, but a picker drag mints many. */
const MEMO_LIMIT = 512;

function memo(cache: Map<string, string>, color: string, map: (c: string) => string): string {
  const hit = cache.get(color);
  if (hit !== undefined) return hit;
  const value = map(color);
  if (cache.size >= MEMO_LIMIT) cache.clear();
  cache.set(color, value);
  return value;
}

/**
 * A stored colour as a night page shows it: lightness inverted onto the
 * night band, hue kept, alpha kept. A colour it cannot read is returned as
 * it is. Used for ink, text, text box fills, rulings, printed text, and the
 * paper itself.
 */
export function nightColor(color: string): string {
  return memo(shown, color, (c) => {
    const rgba = parseCssColor(c);
    if (!rgba) return c;
    const lch = toOklch(rgba);
    return cssOf(fromOklch({ ...lch, l: nightLightness(lch.l) }, rgba.a));
  });
}

/**
 * A highlighter's colour on a night page, drawn with
 * {@link NIGHT_HIGHLIGHTER_BLEND}. By day a highlighter is a light, chromatic
 * tint multiplied into white paper, which leaves dark ink dark. Its mirror at
 * night is a screen, which leaves light ink light; what it adds to the dark
 * paper is the tint, so the colour keeps its hue and chroma and is moved into
 * a middle band of lightness ({@link NIGHT_HIGHLIGHT_L}): bright enough to
 * show on dark paper, never so bright that it washes the ink under it out.
 * A dark highlighter (a dark blue one) still keeps the order: lighter by day
 * stays lighter at night.
 */
export function nightHighlighter(color: string): string {
  return memo(highlights, color, (c) => {
    const rgba = parseCssColor(c);
    if (!rgba) return c;
    const lch = toOklch(rgba);
    const t = Math.max(0, Math.min(1, lch.l));
    const l = NIGHT_HIGHLIGHT_L.dark + (NIGHT_HIGHLIGHT_L.light - NIGHT_HIGHLIGHT_L.dark) * t;
    return cssOf(fromOklch({ ...lch, l }, rgba.a));
  });
}

/**
 * How far a ruling stands out from the paper at night, as a share of what
 * {@link nightColor} gives it. The curve that lifts bright inks lifts the
 * pale rules as much, and at full strength they read heavier than by day
 * (2.5:1 against the paper, not 1.5:1); damped, they sit back as by day.
 */
const NIGHT_RULE_STRENGTH = 0.55;

/**
 * A ruling's colour (a page's lines, grid, dots) on a night page: as
 * {@link nightColor}, then drawn back toward the paper so the lines are as
 * quiet as they are by day.
 */
export function nightRule(color: string): string {
  const rgba = parseCssColor(color);
  if (!rgba) return color;
  const lch = toOklch(rgba);
  const l = NIGHT_PAPER_L + (nightLightness(lch.l) - NIGHT_PAPER_L) * NIGHT_RULE_STRENGTH;
  return cssOf(fromOklch({ ...lch, l }, rgba.a));
}

/** The paper a white page is shown on at night: `nightColor("#ffffff")`. */
export const NIGHT_PAPER = nightColor("#ffffff");
/** What black ink is shown as at night: `nightColor("#000000")`. */
export const NIGHT_INK = nightColor("#000000");

// --- PDF pages ----------------------------------------------------------------

/** One `drawImage` that painted a PDF page or a piece of one, to be drawn again. */
export interface PdfDraw {
  source: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A grey's sRGB channel, 0–1. */
function greyChannel(color: string): number {
  return parseCssColor(color)?.r ?? 0;
}

/**
 * Turn the PDF page just painted into the area `width` x `height` (white
 * paper, then `draws`) into its night form, in place, with composite
 * operations, so the raster cache keeps one true copy of every page:
 *
 * 1. `difference` with white inverts every channel: black text turns white,
 *    white paper black, and every hue turns to its opposite.
 * 2. `hue` draws the page again on top, taking back each pixel's own hue
 *    while keeping the inverted lightness: red stays red.
 * 3. `multiply` then `screen` with greys squeeze black up to the night
 *    paper and white down to the night ink, as {@link nightColor} does.
 *
 * The caller has clipped to the page; the area must hold nothing but the
 * PDF yet (no ink, no pictures), since everything in it is inverted.
 */
export function invertPdfArea(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  draws: readonly PdfDraw[],
): void {
  const floor = greyChannel(NIGHT_PAPER);
  const top = greyChannel(NIGHT_INK);
  // screen(x · m, f) = f + x · m · (1 − f): 0 → f, 1 → top.
  const m = (top - floor) / (1 - floor);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "difference";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "hue";
  for (const d of draws) ctx.drawImage(d.source, d.x, d.y, d.w, d.h);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = cssOf({ r: m, g: m, b: m, a: 1 });
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = cssOf({ r: floor, g: floor, b: floor, a: 1 });
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
