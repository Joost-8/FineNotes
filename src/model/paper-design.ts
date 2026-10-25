/**
 * Designed paper: a paper the user makes in the paper designer
 * (`view/paper-designer.ts`) and keeps in My templates, beside the PDFs of
 * `paper-library.ts`. A design is a small JSON file in the templates
 * folder's `Papers` folder, in millimetres, as the designer shows it; a page
 * that uses it gets an ordinary synthetic backdrop (`designBackdrop`), in
 * page px, with the four optional fields of contracts/api.md §1 "Designed
 * paper": `texture`, `margins`, `blankZone`, `marginLines`.
 *
 * A page never points at the design file: deleting or editing a design
 * changes no page that already uses it, as with the PDF papers.
 *
 * Pure: no DOM, no Obsidian.
 */

import {
  type AttachmentFolders,
  type InkDocument,
  type MarginLines,
  type PageGeometry,
  type PaperMargins,
  type PaperSide,
  type PaperTexture,
  type Ruling,
  type SyntheticBackdrop,
  isCoverRuling,
} from "./document";
import { type NotebookChoices, buildNewDocument } from "./new-notebook";
import type { PaperEntry } from "./paper-library";
import { PAGE_SIZES, sizeGeometry } from "./templates";
import { DEFAULT_MARGIN_LINE_COLOR } from "./paper-extras";
import { mmToPage } from "./units";

export { DEFAULT_MARGIN_LINE_COLOR };

/** What a design file says it is, so no other JSON in the folder is taken for one. */
export const PAPER_DESIGN_FORMAT = "finenotes-paper";
/** The file format's version: a newer one is still read, field by field. */
export const PAPER_DESIGN_VERSION = 1;
/** A design file's extension. */
export const PAPER_DESIGN_EXTENSION = "json";

export type DesignRuling = "none" | "lines" | "squares" | "dots";
export type DesignTexture = "plain" | PaperTexture;
export type MarginLineSides = "left" | "right" | "both";

export const DESIGN_RULINGS: readonly DesignRuling[] = ["none", "lines", "squares", "dots"];
export const DESIGN_TEXTURES: readonly DesignTexture[] = ["plain", "fine", "heavy"];
export const PAPER_SIDES: readonly PaperSide[] = ["top", "right", "bottom", "left"];
export const MARGIN_LINE_SIDES: readonly MarginLineSides[] = ["left", "right", "both"];

/** Everything the designer asks. Lengths in millimetres. */
export interface PaperDesign {
  /** The name the user gave; the file is named after it. */
  name: string;
  /** A {@link PAGE_SIZES} id. */
  size: string;
  landscape: boolean;
  /** Paper colour, `#rrggbb`. */
  paper: string;
  texture: DesignTexture;
  ruling: DesignRuling;
  /** Line, square or dot pitch, mm. */
  spacing: number;
  /** Rule colour, `#rrggbb`. */
  ruleColor: string;
  /** Where the ruling stops, from each edge, mm. */
  margins: Record<PaperSide, number>;
  /** One band with no ruling, from one edge, mm; or none. */
  blank: { side: PaperSide; size: number } | null;
  /** Vertical lines in from the left, the right or both edges, mm; or none. */
  marginLine: { sides: MarginLineSides; inset: number; color: string } | null;
}

/** The rule colour a design starts with: the light paper's own rule. */
export const DEFAULT_RULE_COLOR = "#ccd5e0";

/** Each ruling's pitch when it is picked, mm (8 mm lines are Ruled Wide's 40 page px). */
export const DESIGN_SPACING_MM: Readonly<Record<DesignRuling, number>> = {
  none: 8,
  lines: 8,
  squares: 5,
  dots: 5,
};

/** The range each length may take, mm, and the step its − and + move by. */
export const DESIGN_RANGES = {
  spacing: { min: 2, max: 30, step: 0.5 },
  margin: { min: 0, max: 300, step: 1 },
  blank: { min: 5, max: 1189, step: 5 },
  inset: { min: 2, max: 150, step: 1 },
} as const;

export type DesignRange = keyof typeof DESIGN_RANGES;

/** A new design: A4 portrait, white, plain, 8 mm lines, nothing else. */
export function defaultPaperDesign(): PaperDesign {
  return {
    name: "",
    size: PAGE_SIZES[0].id,
    landscape: false,
    paper: "#ffffff",
    texture: "plain",
    ruling: "lines",
    spacing: DESIGN_SPACING_MM.lines,
    ruleColor: DEFAULT_RULE_COLOR,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    blank: null,
    marginLine: null,
  };
}

/** `value` held to `range`, to its step's precision; `null` for no number at all. */
export function clampDesignValue(range: DesignRange, value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const { min, max } = DESIGN_RANGES[range];
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Two decimals of a page px: no float noise in a saved page. */
function px(mm: number): number {
  return Math.round(mmToPage(mm) * 100) / 100;
}

/** The ruling each designer choice draws. Older builds draw these too, across the whole page. */
const RULING_KIND: Readonly<Record<DesignRuling, Ruling>> = {
  none: "blank",
  lines: "ruled-wide",
  squares: "squared",
  dots: "dotted",
};

/** The page geometry a design makes, from its size and orientation. */
export function designGeometry(design: PaperDesign): PageGeometry {
  return sizeGeometry(design.size, design.landscape);
}

/**
 * The backdrop a page of `design` gets. Margins and the blank band only
 * stop a ruling, so a design without one stores neither.
 */
export function designBackdrop(design: PaperDesign): SyntheticBackdrop {
  const backdrop: SyntheticBackdrop = { kind: RULING_KIND[design.ruling] };
  const ruled = design.ruling !== "none";
  if (ruled) {
    backdrop.spacing = px(design.spacing);
    backdrop.color = design.ruleColor.toLowerCase();
  }
  const paper = design.paper.toLowerCase();
  if (paper !== "#ffffff") backdrop.paperColor = paper;
  if (design.texture !== "plain") backdrop.texture = design.texture;
  if (ruled) {
    const margins: PaperMargins = {};
    for (const side of PAPER_SIDES) {
      if (design.margins[side] > 0) margins[side] = px(design.margins[side]);
    }
    if (Object.keys(margins).length > 0) backdrop.margins = margins;
    if (design.blank && design.blank.size > 0) {
      backdrop.blankZone = { side: design.blank.side, size: px(design.blank.size) };
    }
  }
  const line = design.marginLine;
  if (line) {
    const lines: MarginLines = {};
    if (line.sides !== "right") lines.left = px(line.inset);
    if (line.sides !== "left") lines.right = px(line.inset);
    lines.color = line.color.toLowerCase();
    backdrop.marginLines = lines;
  }
  return backdrop;
}

/** My templates' entry for the design saved at `path`. */
export function designEntry(path: string, design: PaperDesign): PaperEntry {
  const { width, height } = designGeometry(design);
  return { path, page: 0, width, height, name: design.name || "Paper", design };
}

// --- The file ------------------------------------------------------------------

/** A design as its file holds it: pretty JSON, with its format and version first. */
export function serializePaperDesign(design: PaperDesign): string {
  return `${JSON.stringify(
    { format: PAPER_DESIGN_FORMAT, version: PAPER_DESIGN_VERSION, ...design },
    null,
    2,
  )}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A length field, or `fallback` when it is no number or outside its range. */
function length(raw: unknown, range: DesignRange, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const { min, max } = DESIGN_RANGES[range];
  return raw >= min && raw <= max ? raw : fallback;
}

function oneOf<T extends string>(raw: unknown, options: readonly T[], fallback: T): T {
  return typeof raw === "string" && (options as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

function hex(raw: unknown, fallback: string): string {
  return typeof raw === "string" && HEX.test(raw) ? raw.toLowerCase() : fallback;
}

/**
 * Read a design file. Anything but a FineNotes paper design is `null`. A
 * design is read field by field: one the user (or a newer build) wrote that
 * this build cannot read takes its default, and the rest of the design
 * stays as made.
 */
export function parsePaperDesign(text: string): PaperDesign | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.format !== PAPER_DESIGN_FORMAT) return null;
  const base = defaultPaperDesign();
  const design: PaperDesign = {
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 100) : "",
    size: PAGE_SIZES.some((s) => s.id === raw.size) ? (raw.size as string) : base.size,
    landscape: raw.landscape === true,
    paper: hex(raw.paper, base.paper),
    texture: oneOf(raw.texture, DESIGN_TEXTURES, base.texture),
    ruling: oneOf(raw.ruling, DESIGN_RULINGS, base.ruling),
    spacing: base.spacing,
    ruleColor: hex(raw.ruleColor, base.ruleColor),
    margins: { ...base.margins },
    blank: null,
    marginLine: null,
  };
  design.spacing = length(raw.spacing, "spacing", DESIGN_SPACING_MM[design.ruling]);
  if (isRecord(raw.margins)) {
    for (const side of PAPER_SIDES) design.margins[side] = length(raw.margins[side], "margin", 0);
  }
  if (isRecord(raw.blank)) {
    const side = oneOf<PaperSide | "">(raw.blank.side, PAPER_SIDES, "");
    const size = length(raw.blank.size, "blank", 0);
    if (side && size > 0) design.blank = { side, size };
  }
  if (isRecord(raw.marginLine)) {
    const sides = oneOf<MarginLineSides | "">(raw.marginLine.sides, MARGIN_LINE_SIDES, "");
    const inset = length(raw.marginLine.inset, "inset", 0);
    if (sides && inset > 0) {
      design.marginLine = {
        sides,
        inset,
        color: hex(raw.marginLine.color, DEFAULT_MARGIN_LINE_COLOR),
      };
    }
  }
  return design;
}

// --- A notebook of it --------------------------------------------------------------

/**
 * A new notebook on designed paper: the cover chosen, at the design's size,
 * then a page of the design. Everything else is the ordinary new notebook.
 */
export function buildDesignedNotebook(
  choices: NotebookChoices,
  title: string,
  attachments: AttachmentFolders | undefined,
  design: PaperDesign,
): InkDocument {
  const doc = buildNewDocument(
    { ...choices, size: design.size, landscape: design.landscape },
    title,
    attachments,
  );
  for (const page of doc.pages) {
    if (page.backdrop.kind === "pdf" || !isCoverRuling(page.backdrop.kind)) {
      page.backdrop = designBackdrop(design);
    }
  }
  return doc;
}

// --- What the folded sections say ---------------------------------------------------

function mm(value: number): string {
  return `${Number(value.toFixed(1))} mm`;
}

const SIDE_NAMES: Readonly<Record<PaperSide | MarginLineSides, string>> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
  both: "Both",
};

/** The margins as their folded heading shows them: "None", "20 mm", or each side's. */
export function marginsSummary(margins: Record<PaperSide, number>): string {
  const values = PAPER_SIDES.map((side) => margins[side]);
  if (values.every((v) => v === 0)) return "None";
  if (values.every((v) => v === values[0])) return mm(values[0]);
  return `${values.map((v) => Number(v.toFixed(1))).join(" · ")} mm`;
}

/** The blank band as its heading shows it: "None" or "Bottom · 50 mm". */
export function blankSummary(blank: PaperDesign["blank"]): string {
  return blank ? `${SIDE_NAMES[blank.side]} · ${mm(blank.size)}` : "None";
}

/** The margin line as its heading shows it: "None" or "Left · 25 mm". */
export function marginLineSummary(line: PaperDesign["marginLine"]): string {
  return line ? `${SIDE_NAMES[line.sides]} · ${mm(line.inset)}` : "None";
}
