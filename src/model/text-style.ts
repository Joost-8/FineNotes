/**
 * Whole-box text style (0.5): what the Text tool's options pill edits, what a
 * new box is created with, and the rule for storing it on a box.
 *
 * The storage rule is contracts/api.md §3 and §6: an optional style key holds
 * a real, non-default value or it is **absent**. `false`, `"left"`, `"sans"`,
 * the default line height and "no fill" are all spelled by deleting the key,
 * so a box styled back to the default is identical to one never styled, and a
 * box written before 0.5 needs no migration.
 *
 * Styles are whole-box for now. Per-word formatting would keep this type as
 * the box's base style and add styled runs over it; see text-commands.ts.
 *
 * Pure: no DOM, no Obsidian.
 */

import {
  TEXT_ALIGNS,
  TEXT_FONTS,
  TEXT_FONT_STACKS,
  type TextAlign,
  type TextBorder,
  type TextFont,
} from "./document";

/** Line height of a box with no `lineHeight`, as a multiple of its font size (§6). */
export const DEFAULT_LINE_HEIGHT = 1.25;
export const MIN_LINE_HEIGHT = 0.8;
export const MAX_LINE_HEIGHT = 3;

/**
 * Smallest font size a box keeps. `serialize.ts` raises anything smaller to
 * this on load, so offering a smaller size would change on the next open.
 */
export const MIN_TEXT_SIZE = 12;

/**
 * Narrowest a box that does not fit its text keeps: `serialize.ts` widens
 * anything narrower to this on load, so an importer must not write one.
 */
export const MIN_TEXT_BOX_WIDTH = 80;
export const MAX_TEXT_SIZE = 400;

/** The size dropdown. 22 is the size every box was created at before 0.5. */
export const TEXT_SIZES: readonly number[] = [
  12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 64, 72, 96,
];

/** Line spacing choices. 1.25 is the default, and is stored as no key at all. */
export const LINE_HEIGHTS: readonly number[] = [1, 1.15, DEFAULT_LINE_HEIGHT, 1.5, 2];

/**
 * Box fills: soft, light tints any ink colour reads on. Hex only, because the
 * value reaches a style attribute (contracts/api.md §6).
 */
export const TEXT_FILLS: readonly string[] = [
  "#fff3b0",
  "#ffe0c2",
  "#ffd6de",
  "#d6ecff",
  "#d8f5dd",
  "#e8defc",
  "#ececec",
];

/**
 * Border widths the menu offers, page px. Each is inside the loader's range
 * ({@link MAX_BORDER_WIDTH}), so a box reopens with the width it was given.
 */
export const TEXT_BORDER_WIDTHS: ReadonlyArray<{ label: string; width: number }> = [
  { label: "Thin", width: 1 },
  { label: "Medium", width: 2 },
  { label: "Thick", width: 4 },
];

/** Widest border a box keeps, page px; a wider stored one is dropped as corrupt. */
export const MAX_BORDER_WIDTH = 50;

/** The radius the menu's "Rounded corners" sets, page px. */
export const TEXT_CORNER_RADIUS = 12;

/** Largest corner radius a box keeps, page px; a larger stored one is dropped as corrupt. */
export const MAX_CORNER_RADIUS = 500;

/** Menu names for the typefaces, shown in their own face. */
export const TEXT_FONT_LABELS: Readonly<Record<TextFont, string>> = {
  sans: "Sans",
  serif: "Serif",
  times: "Times",
  mono: "Mono",
  verdana: "Verdana",
  trebuchet: "Trebuchet",
};

export const TEXT_ALIGN_LABELS: Readonly<Record<TextAlign, string>> = {
  left: "Align left",
  center: "Centre",
  right: "Align right",
  justify: "Justify",
};

/** Everything a text box's look is made of: the 0.5 style keys plus colour and size. */
export interface TextStyle {
  color: string;
  fontSize: number;
  font?: TextFont;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: TextAlign;
  lineHeight?: number;
  fill?: string;
  border?: TextBorder;
  radius?: number;
}

/**
 * A change to some of a style's keys. A default value — `false`, `"left"`,
 * `"sans"`, {@link DEFAULT_LINE_HEIGHT}, or `null` for the fill — removes the
 * key. An invalid value is ignored, never clamped onto a valid neighbour.
 */
export interface TextStylePatch {
  color?: string;
  fontSize?: number;
  font?: TextFont;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: TextAlign;
  lineHeight?: number;
  fill?: string | null;
  /**
   * The border's width; `null` removes the border. Given to a box with no
   * border, the border takes `borderColor`, else the text colour.
   */
  borderWidth?: number | null;
  /** The border's colour. Given to a box with no border, it adds a thin one. */
  borderColor?: string;
  /** Corner radius, page px; `null` squares the corners. */
  radius?: number | null;
}

/** The style a Text tool starts with, and "Reset to default" returns to. */
export const DEFAULT_TEXT_STYLE: Readonly<TextStyle> = { color: "#1a1a1a", fontSize: 22 };

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` — the only colours a patch accepts. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function isTextSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_TEXT_SIZE &&
    value <= MAX_TEXT_SIZE
  );
}

function isLineHeight(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_LINE_HEIGHT &&
    value <= MAX_LINE_HEIGHT
  );
}

/** A border width the loader keeps: finite, above 0, at most {@link MAX_BORDER_WIDTH}. */
export function isBorderWidth(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_BORDER_WIDTH
  );
}

/** A corner radius the loader keeps: finite, above 0, at most {@link MAX_CORNER_RADIUS}. */
export function isCornerRadius(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_CORNER_RADIUS
  );
}

/**
 * A stored border, or `undefined` when it is not one: a width out of range or
 * a colour that is not hex drops the whole border rather than inventing half
 * of it.
 */
export function normalizeBorder(raw: unknown): TextBorder | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { width, color } = raw as Record<string, unknown>;
  return isBorderWidth(width) && isHexColor(color) ? { width, color } : undefined;
}

/** A flag is stored as `true` or not at all. */
function setFlag(
  target: TextStyle,
  key: "bold" | "italic" | "underline" | "strike",
  value: boolean | undefined,
): void {
  if (value === true) target[key] = true;
  else if (value === false) delete target[key];
}

/**
 * Apply `patch` to `target` in place — a style, or a `TextBoxElement`, which
 * carries the same keys. Defaults delete their key; invalid values are ignored.
 */
export function applyTextStyle(target: TextStyle, patch: TextStylePatch): void {
  if (isHexColor(patch.color)) target.color = patch.color;
  if (isTextSize(patch.fontSize)) target.fontSize = patch.fontSize;
  if (patch.font !== undefined && TEXT_FONTS.includes(patch.font)) {
    if (patch.font === "sans") delete target.font;
    else target.font = patch.font;
  }
  setFlag(target, "bold", patch.bold);
  setFlag(target, "italic", patch.italic);
  setFlag(target, "underline", patch.underline);
  setFlag(target, "strike", patch.strike);
  if (patch.align !== undefined && TEXT_ALIGNS.includes(patch.align)) {
    if (patch.align === "left") delete target.align;
    else target.align = patch.align;
  }
  if (isLineHeight(patch.lineHeight)) {
    if (Math.abs(patch.lineHeight - DEFAULT_LINE_HEIGHT) < 1e-9) delete target.lineHeight;
    else target.lineHeight = patch.lineHeight;
  }
  if (patch.fill === null) delete target.fill;
  else if (isHexColor(patch.fill)) target.fill = patch.fill;
  applyBorder(target, patch);
  if (patch.radius === null) delete target.radius;
  else if (isCornerRadius(patch.radius)) target.radius = patch.radius;
}

function applyBorder(target: TextStyle, patch: TextStylePatch): void {
  if (patch.borderWidth === null) {
    delete target.border;
    return;
  }
  const width = isBorderWidth(patch.borderWidth) ? patch.borderWidth : undefined;
  const color = isHexColor(patch.borderColor) ? patch.borderColor : undefined;
  if (width === undefined && color === undefined) return;
  // A new object every time: an undo snapshot may hold the old one.
  target.border = {
    width: width ?? target.border?.width ?? TEXT_BORDER_WIDTHS[0].width,
    color: color ?? target.border?.color ?? target.color,
  };
}

/** Just the style of a box (or of any style), absent keys left absent. */
export function textStyleOf(source: TextStyle): TextStyle {
  const style: TextStyle = { color: source.color, fontSize: source.fontSize };
  if (source.font !== undefined) style.font = source.font;
  if (source.bold === true) style.bold = true;
  if (source.italic === true) style.italic = true;
  if (source.underline === true) style.underline = true;
  if (source.strike === true) style.strike = true;
  if (source.align !== undefined) style.align = source.align;
  if (source.lineHeight !== undefined) style.lineHeight = source.lineHeight;
  if (source.fill !== undefined) style.fill = source.fill;
  if (source.border !== undefined) style.border = { ...source.border };
  if (source.radius !== undefined) style.radius = source.radius;
  return style;
}

/** A copy of `style` with `patch` applied. */
export function withTextStyle(style: TextStyle, patch: TextStylePatch): TextStyle {
  const next = textStyleOf(style);
  applyTextStyle(next, patch);
  return next;
}

/** A stable fingerprint of a style: equal looks, equal keys. */
export function textStyleKey(style: TextStyle): string {
  const s = textStyleOf(style);
  return [
    s.color,
    s.fontSize,
    s.font ?? "sans",
    s.bold ? "b" : "",
    s.italic ? "i" : "",
    s.underline ? "u" : "",
    s.strike ? "s" : "",
    s.align ?? "left",
    s.lineHeight ?? DEFAULT_LINE_HEIGHT,
    s.fill ?? "",
    s.border ? `${s.border.width}/${s.border.color}` : "",
    s.radius ?? 0,
  ].join("|");
}

/** Whether applying `patch` to `style` would change how it looks. */
export function changesTextStyle(style: TextStyle, patch: TextStylePatch): boolean {
  return textStyleKey(style) !== textStyleKey(withTextStyle(style, patch));
}

/** The patch that takes any style back to {@link DEFAULT_TEXT_STYLE}. */
export function resetTextStylePatch(): TextStylePatch {
  return {
    color: DEFAULT_TEXT_STYLE.color,
    fontSize: DEFAULT_TEXT_STYLE.fontSize,
    font: "sans",
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    align: "left",
    lineHeight: DEFAULT_LINE_HEIGHT,
    fill: null,
    borderWidth: null,
    radius: null,
  };
}

/**
 * A style read back from plugin settings, which a user or a sync conflict
 * may have edited: anything malformed falls back to the default.
 */
export function sanitizeTextStyle(raw: unknown): TextStyle {
  const style: TextStyle = { ...DEFAULT_TEXT_STYLE };
  if (typeof raw !== "object" || raw === null) return style;
  const r = raw as Record<string, unknown>;
  applyTextStyle(style, {
    color: typeof r.color === "string" ? r.color : undefined,
    fontSize: typeof r.fontSize === "number" ? r.fontSize : undefined,
    font: typeof r.font === "string" ? (r.font as TextFont) : undefined,
    bold: r.bold === true ? true : undefined,
    italic: r.italic === true ? true : undefined,
    underline: r.underline === true ? true : undefined,
    strike: r.strike === true ? true : undefined,
    align: typeof r.align === "string" ? (r.align as TextAlign) : undefined,
    lineHeight: typeof r.lineHeight === "number" ? r.lineHeight : undefined,
    fill: typeof r.fill === "string" ? r.fill : undefined,
    radius: typeof r.radius === "number" ? r.radius : undefined,
  });
  const border = normalizeBorder(r.border);
  if (border) style.border = border;
  return style;
}

/** A style's line height as a multiple of its font size. */
export function lineHeightOf(style: Pick<TextStyle, "lineHeight">): number {
  return isLineHeight(style.lineHeight) ? style.lineHeight : DEFAULT_LINE_HEIGHT;
}

/** The typeface a style names, `"sans"` when absent or unknown. */
export function fontOf(style: Pick<TextStyle, "font">): TextFont {
  const font = style.font;
  return font !== undefined && TEXT_FONTS.includes(font) ? font : "sans";
}

/**
 * CSS / canvas font-family list for a style. A real family list, never
 * `var(--…)`: canvas string properties do not resolve CSS variables.
 */
export function fontFamilyOf(style: Pick<TextStyle, "font">): string {
  return TEXT_FONT_STACKS[fontOf(style)];
}
