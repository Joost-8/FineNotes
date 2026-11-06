/**
 * How a page's margin paper (`model/page-margin.ts`) is ruled: its lines,
 * squares or dots continue the page's own (FineNotes#164). On a paper page
 * ruled evenly from its top (lined, squared, dotted and the column papers)
 * the margin takes the page's pitch and starts counting where the page
 * does, so a line in the margin is level with a line on the page at any
 * spacing. A PDF page, or a paper with its own layout (planners, music,
 * covers), has no pitch to follow: the margin paper keeps its own default.
 * A pitch set in the Margin popover (`marginSpacing`) wins over both.
 *
 * PURE: no DOM.
 */

import type { Page, Ruling, SyntheticBackdrop } from "../model/document";
import { pdfFrameOf } from "../model/document";
import {
  type MarginPaperChoice,
  marginBackdrop,
  marginPaperOf,
  marginRuling,
  marginSpacingOf,
} from "../model/page-margin";
import { ruledArea } from "../model/paper-extras";
import { resolveSpacing } from "./backdrop";

/** Papers whose rules (or dots) repeat at their pitch from the top of the ruled area. */
const EVEN_RULINGS: ReadonlySet<Ruling> = new Set<Ruling>([
  "ruled-narrow",
  "ruled-wide",
  "lined",
  "squared",
  "grid",
  "dotted",
  "graph",
  "cornell",
  "legal",
  "single-column",
  "two-column",
  "three-column",
  "margin-left",
  "margin-right",
]);

/** The page's own pitch the margin follows, page px; null where there is none to follow. */
export function followedSpacing(page: Page): number | null {
  const backdrop = page.backdrop;
  if (backdrop.kind === "pdf" || !EVEN_RULINGS.has(backdrop.kind)) return null;
  return resolveSpacing(backdrop.spacing, backdrop.kind);
}

/**
 * The pitch a margin of `paper` (default: the page's own) is drawn at when
 * nothing is set, page px; null for plain paper.
 */
export function defaultMarginSpacing(
  page: Page,
  paper: MarginPaperChoice = marginPaperOf(page),
): number | null {
  const ruling = marginRuling(paper);
  if (!ruling) return null;
  return followedSpacing(page) ?? resolveSpacing(undefined, ruling);
}

/** The pitch the margin is drawn at, page px; null without a ruled margin. */
export function marginSpacing(page: Page): number | null {
  if (!marginBackdrop(page)) return null;
  return marginSpacingOf(page) ?? defaultMarginSpacing(page);
}

/**
 * The pitch to store for `spacing` (page px) set on `page`'s margin of
 * `paper`: null (follow) when it is what that margin draws without one, so
 * nothing is stored that changes nothing; else `spacing`, to two decimals.
 */
export function storedMarginSpacing(
  page: Page,
  paper: MarginPaperChoice,
  spacing: number,
): number | null {
  const pitch = Math.round(spacing * 100) / 100;
  const own = defaultMarginSpacing(page, paper);
  return own !== null && Math.abs(own - pitch) < 0.005 ? null : pitch;
}

/**
 * The paper to draw in the margins, its pitch resolved and, where it
 * follows the page, started where the page's rules start; null for plain.
 * The strips are drawn from the page's top, so the start is carried as a top
 * margin under one pitch (`margins.top`): rules at `start + n·pitch`.
 */
export function marginPaper(page: Page): SyntheticBackdrop | null {
  const margin = marginBackdrop(page);
  if (!margin) return null;
  const spacing = marginSpacing(page);
  if (spacing === null) return margin;
  const followed = followedSpacing(page);
  const paper: SyntheticBackdrop = { ...margin, spacing };
  if (followed !== null && Math.abs(followed - spacing) < 0.005 && page.backdrop.kind !== "pdf") {
    const frame = pdfFrameOf(page.backdrop, page.geometry);
    const area = ruledArea(page.backdrop, { width: frame.width, height: frame.height });
    const start = frame.y + (area?.y ?? 0);
    const phase = ((start % spacing) + spacing) % spacing;
    // Whole page px, as `ruledArea` rounds the page's own start.
    if (Math.round(phase) > 0) paper.margins = { top: Math.round(phase) };
  }
  return paper;
}
