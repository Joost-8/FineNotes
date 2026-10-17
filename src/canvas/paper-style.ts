/**
 * A paper's style beyond its template: any paper colour, the rules' colour,
 * and rules closer together or further apart than the template's own. The
 * fields already exist on a synthetic backdrop (`spacing`, `color`,
 * `paperColor`); this is the template picker's way to set them.
 *
 * Pure: no DOM. GoodNotes has no line spacing or free paper colour, and its
 * users ask for both (research/reports/GoodNotes aesthetics and design
 * freedom.md); Noteshelf has any paper colour.
 */

import type { Ruling, SyntheticBackdrop } from "../model/document";
import { type PaperColorId, templateBackdrop } from "../model/templates";
import { resolveSpacing } from "./backdrop";

export interface PaperStyle {
  /** Paper colour, `#rrggbb`; absent keeps the paper colour chosen. */
  paper?: string;
  /** Rule colour, `#rrggbb`; absent keeps the template's. */
  rule?: string;
  /** The template's spacing times this; absent or 1 keeps it. */
  spacing?: number;
}

/** Papers the picker offers, light to dark: white, creams, pastels, a grey and a black. */
export const PAPER_SWATCHES: ReadonlyArray<{ label: string; color: string }> = [
  { label: "White", color: "#ffffff" },
  { label: "Ivory", color: "#fbf8ed" },
  { label: "Cream", color: "#f6efe0" },
  { label: "Blush", color: "#fcefee" },
  { label: "Mint", color: "#eef7f1" },
  { label: "Sky", color: "#edf4fb" },
  { label: "Lavender", color: "#f3f0fb" },
  { label: "Stone", color: "#ecebe8" },
  { label: "Slate", color: "#3a3d44" },
  { label: "Charcoal", color: "#26272b" },
];

/** Rule colours: the template's own first (`null`), then quiet tones that read on light paper. */
export const RULE_SWATCHES: ReadonlyArray<{ label: string; color: string | null }> = [
  { label: "Template's own", color: null },
  { label: "Soft grey", color: "#d5d8de" },
  { label: "Blue", color: "#b8cde8" },
  { label: "Red", color: "#efb8b8" },
  { label: "Green", color: "#b9dcc4" },
  { label: "Sepia", color: "#d9c7a8" },
  { label: "Lavender", color: "#cfc6ea" },
  { label: "Dark", color: "#9aa0ab" },
];

/** Spacing steps as multiples of the template's own. */
export const SPACING_STEPS: ReadonlyArray<{ label: string; k: number }> = [
  { label: "Tight", k: 0.8 },
  { label: "Normal", k: 1 },
  { label: "Roomy", k: 1.25 },
  { label: "Wide", k: 1.5 },
];

/** A dark paper: one whose rules and default ink need light tones. */
export function isDarkPaper(color: string): boolean {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff";
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

/**
 * The backdrop for `ruling` on paper `color`, with `style` on top: its own
 * paper and rule colours, and spacing scaled from the template's (rounded to
 * whole page px, so a saved page does not carry float noise).
 */
export function styledBackdrop(
  ruling: Ruling,
  color: PaperColorId,
  style: PaperStyle = {},
): SyntheticBackdrop {
  const backdrop = templateBackdrop(ruling, color);
  if (style.paper && /^#[0-9a-f]{6}$/i.test(style.paper)) {
    const paper = style.paper.toLowerCase();
    if (paper === "#ffffff") delete backdrop.paperColor;
    else backdrop.paperColor = paper;
    // A dark paper the template did not choose needs rules that show on it.
    if (isDarkPaper(paper) && !style.rule) backdrop.color = "#4a4d56";
    else if (!isDarkPaper(paper) && color === "dark" && !style.rule) delete backdrop.color;
  }
  if (style.rule && /^#[0-9a-f]{6}$/i.test(style.rule)) backdrop.color = style.rule.toLowerCase();
  const k = style.spacing;
  if (typeof k === "number" && Number.isFinite(k) && k > 0 && Math.abs(k - 1) > 1e-9) {
    backdrop.spacing = Math.max(8, Math.round(resolveSpacing(undefined, ruling) * k));
  }
  return backdrop;
}

/** The style a backdrop already has, so the picker opens on it. */
export function paperStyleOf(backdrop: SyntheticBackdrop): PaperStyle {
  const style: PaperStyle = {};
  if (backdrop.paperColor) style.paper = backdrop.paperColor.toLowerCase();
  if (backdrop.color && RULE_SWATCHES.some((s) => s.color === backdrop.color?.toLowerCase())) {
    style.rule = backdrop.color.toLowerCase();
  }
  if (typeof backdrop.spacing === "number") {
    const k = backdrop.spacing / resolveSpacing(undefined, backdrop.kind);
    const step = SPACING_STEPS.reduce((best, s) =>
      Math.abs(s.k - k) < Math.abs(best.k - k) ? s : best,
    );
    if (step.k !== 1) style.spacing = step.k;
  }
  return style;
}
