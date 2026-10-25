/**
 * The designed-paper fields a synthetic backdrop may carry (contracts/api.md
 * §1 "Designed paper"): reading them from disk, comparing them, and where
 * they put things on a page. The designer itself is `paper-design.ts`.
 *
 * Pure: no DOM, no Obsidian.
 */

import type {
  BlankZone,
  MarginLines,
  PageGeometry,
  PaperMargins,
  PaperSide,
  SyntheticBackdrop,
} from "./document";

/** A margin line's colour when it names none: the soft red of a school exercise book. */
export const DEFAULT_MARGIN_LINE_COLOR = "#e8a3a3";

const PAPER_SIDES: readonly PaperSide[] = ["top", "right", "bottom", "left"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- The backdrop's own fields -------------------------------------------------

/** A page px length a document may carry: finite and not negative. */
function pageLength(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/**
 * The designed-paper fields of a stored backdrop, each checked on its own.
 * A field that is malformed is left out (the paper loses only that), never
 * repaired into a value nobody chose.
 */
export function readPaperExtras(
  raw: Record<string, unknown>,
): Pick<SyntheticBackdrop, "texture" | "margins" | "blankZone" | "marginLines"> {
  const out: Pick<SyntheticBackdrop, "texture" | "margins" | "blankZone" | "marginLines"> = {};
  if (raw.texture === "fine" || raw.texture === "heavy") out.texture = raw.texture;
  if (isRecord(raw.margins)) {
    const margins: PaperMargins = {};
    for (const side of PAPER_SIDES) {
      const value = pageLength(raw.margins[side]);
      if (value !== null && value > 0) margins[side] = value;
    }
    if (Object.keys(margins).length > 0) out.margins = margins;
  }
  if (isRecord(raw.blankZone)) {
    const side = raw.blankZone.side;
    const size = pageLength(raw.blankZone.size);
    if ((PAPER_SIDES as readonly unknown[]).includes(side) && size !== null && size > 0) {
      out.blankZone = { side: side as PaperSide, size } satisfies BlankZone;
    }
  }
  if (isRecord(raw.marginLines)) {
    const lines: MarginLines = {};
    const left = pageLength(raw.marginLines.left);
    const right = pageLength(raw.marginLines.right);
    if (left !== null) lines.left = left;
    if (right !== null) lines.right = right;
    if (lines.left !== undefined || lines.right !== undefined) {
      if (typeof raw.marginLines.color === "string") lines.color = raw.marginLines.color;
      out.marginLines = lines;
    }
  }
  return out;
}

/** The designed-paper fields of a backdrop as one comparable string ("" for none). */
export function paperExtrasKey(backdrop: SyntheticBackdrop): string {
  const extras = readPaperExtras(backdrop as unknown as Record<string, unknown>);
  return Object.keys(extras).length > 0 ? JSON.stringify(extras) : "";
}

// --- Where things go on the page -------------------------------------------------

export interface PaperRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the ruling is drawn on a page of `geometry`: inside the margins and
 * outside the blank band, to whole page px. `null` when the backdrop has
 * neither (the whole page, as always). A rect with no room left has a zero
 * side: no ruling at all.
 */
export function ruledArea(backdrop: SyntheticBackdrop, geometry: PageGeometry): PaperRect | null {
  const { margins, blankZone } = backdrop;
  if (!margins && !blankZone) return null;
  const inset: Record<PaperSide, number> = {
    top: margins?.top ?? 0,
    right: margins?.right ?? 0,
    bottom: margins?.bottom ?? 0,
    left: margins?.left ?? 0,
  };
  if (blankZone) inset[blankZone.side] = Math.max(inset[blankZone.side], blankZone.size);
  const x0 = Math.round(Math.min(geometry.width, inset.left));
  const y0 = Math.round(Math.min(geometry.height, inset.top));
  const x1 = Math.round(Math.max(x0, geometry.width - inset.right));
  const y1 = Math.round(Math.max(y0, geometry.height - inset.bottom));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The margin lines of a page of `geometry`: their x, and the span they run
 * (the page's height, short of a blank band at the top or bottom). Lines
 * that would fall off the page are left out.
 */
export function marginLinePlan(
  backdrop: SyntheticBackdrop,
  geometry: PageGeometry,
): { xs: number[]; y0: number; y1: number; color: string } | null {
  const lines = backdrop.marginLines;
  if (!lines) return null;
  const xs: number[] = [];
  if (lines.left !== undefined && lines.left < geometry.width) xs.push(lines.left);
  if (lines.right !== undefined && lines.right < geometry.width) {
    xs.push(geometry.width - lines.right);
  }
  if (xs.length === 0) return null;
  const blank = backdrop.blankZone;
  const y0 = blank?.side === "top" ? Math.min(geometry.height, blank.size) : 0;
  const y1 =
    blank?.side === "bottom" ? Math.max(y0, geometry.height - blank.size) : geometry.height;
  return { xs, y0, y1, color: lines.color ?? DEFAULT_MARGIN_LINE_COLOR };
}
