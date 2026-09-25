/**
 * The page-template catalogue behind the "Add Page" popover and the template
 * picker: which papers exist, what they are called, which colours and sizes a
 * page can have, and the per-vault "recent templates" list.
 *
 * Modelled on GoodNotes' built-in paper templates (its community marketplace
 * is out of scope). Pure: no DOM, no Obsidian.
 */

import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAPER_WIDTH } from "../constants";
import {
  type Backdrop,
  type CoverRuling,
  type Page,
  type PageGeometry,
  type Ruling,
  type SyntheticBackdrop,
  RULINGS,
  isCoverRuling,
} from "./document";
import { mmToPage } from "./units";

export interface TemplateEntry {
  ruling: Ruling;
  name: string;
}

export interface TemplateSection {
  title: string;
  templates: readonly TemplateEntry[];
}

/** The picker's sections, in GoodNotes' order. Aliases (`lined`, `grid`) are not offered. */
export const TEMPLATE_SECTIONS: readonly TemplateSection[] = [
  {
    title: "Essentials",
    templates: [
      { ruling: "blank", name: "Blank" },
      { ruling: "dotted", name: "Dotted Paper" },
      { ruling: "ruled-narrow", name: "Ruled Narrow" },
      { ruling: "ruled-wide", name: "Ruled Wide" },
      { ruling: "squared", name: "Squared Paper" },
    ],
  },
  {
    title: "Writing papers",
    templates: [
      { ruling: "cornell", name: "Cornell" },
      { ruling: "legal", name: "Legal" },
      { ruling: "single-column", name: "Single Column" },
      { ruling: "single-column-mix", name: "Single Column Mix" },
      { ruling: "three-column", name: "Three Column" },
      { ruling: "title-date", name: "Title & Date" },
    ],
  },
  {
    title: "Planner",
    templates: [
      { ruling: "todos", name: "Todos" },
      { ruling: "weekly-planner", name: "Weekly Planner" },
      { ruling: "monthly-planner", name: "Monthly Planner" },
      { ruling: "accounting", name: "Accounting" },
    ],
  },
  {
    title: "Music",
    templates: [
      { ruling: "music", name: "Music Paper" },
      { ruling: "guitar-tab", name: "Guitar Tablature" },
    ],
  },
];

/** Cover designs. Covers are pages but not paper, so the paper picker never offers them. */
export const COVER_TEMPLATES: readonly TemplateEntry[] = [
  { ruling: "cover-plain", name: "Plain cover" },
  { ruling: "cover-label", name: "Label cover" },
  { ruling: "cover-band", name: "Spine cover" },
  { ruling: "cover-linen", name: "Linen cover" },
];

export interface CoverColor {
  id: string;
  label: string;
  /** The cloth colour, stored as the cover backdrop's `paperColor`. */
  color: string;
}

/**
 * The cover colours the "New notebook" dialog and "Change cover" offer, each
 * with every design. Four deep and four light, so the derived title ink is
 * exercised both ways (see `coverPalette` in `cover.ts`).
 */
export const COVER_COLORS: readonly CoverColor[] = [
  { id: "navy", label: "Navy", color: "#1f3a5f" },
  { id: "forest", label: "Forest", color: "#2f5d46" },
  { id: "burgundy", label: "Burgundy", color: "#7a2537" },
  { id: "charcoal", label: "Charcoal", color: "#34363b" },
  { id: "terracotta", label: "Terracotta", color: "#c0643f" },
  { id: "mustard", label: "Mustard", color: "#d9a93a" },
  { id: "sage", label: "Sage", color: "#9db59a" },
  { id: "sky", label: "Sky", color: "#8fb8de" },
];

/** The backdrop of a cover in one of {@link COVER_COLORS}. An unknown id gets the first colour. */
export function coverBackdrop(ruling: CoverRuling, colorId: string): SyntheticBackdrop {
  const color = COVER_COLORS.find((c) => c.id === colorId) ?? COVER_COLORS[0];
  return { kind: ruling, paperColor: color.color };
}

/** Which of {@link COVER_COLORS} a backdrop is in, or `null` for any other colour. */
export function coverColorOf(backdrop: Backdrop): string | null {
  if (backdrop.kind === "pdf" || !backdrop.paperColor) return null;
  const paper = backdrop.paperColor.toLowerCase();
  return COVER_COLORS.find((c) => c.color === paper)?.id ?? null;
}

/**
 * The paper a new page next to page `index` should repeat. Normally that
 * page's own backdrop — but a cover is not paper, so next to a cover it is
 * the nearest paper page's (the one after it first), or blank paper.
 */
export function paperTemplateFor(pages: readonly Page[], index: number): Backdrop {
  const at = Math.max(0, Math.min(pages.length - 1, Math.trunc(index) || 0));
  const isPaper = (page: Page | undefined): page is Page =>
    !!page && (page.backdrop.kind === "pdf" || !isCoverRuling(page.backdrop.kind));
  if (isPaper(pages[at])) return pages[at].backdrop;
  for (let d = 1; d < pages.length; d++) {
    if (isPaper(pages[at + d])) return pages[at + d].backdrop;
    if (isPaper(pages[at - d])) return pages[at - d].backdrop;
  }
  return { kind: "blank" };
}

const RULING_NAMES: ReadonlyMap<Ruling, string> = new Map([
  ...TEMPLATE_SECTIONS.flatMap((s) => s.templates.map((t) => [t.ruling, t.name] as const)),
  ...COVER_TEMPLATES.map((t) => [t.ruling, t.name] as const),
  ["lined", "Ruled Wide"],
  ["grid", "Squared Paper"],
]);

/** Display name of a ruling. */
export function templateName(ruling: Ruling): string {
  return RULING_NAMES.get(ruling) ?? "Paper";
}

export type PaperColorId = "white" | "yellow" | "dark";

export interface PaperColor {
  id: PaperColorId;
  label: string;
  /** Page fill. */
  paper: string;
  /** Rule colour, when the paper theme's default would not read on it. */
  rule?: string;
}

export const PAPER_COLORS: readonly PaperColor[] = [
  { id: "white", label: "White Paper", paper: "#ffffff" },
  { id: "yellow", label: "Yellow Paper", paper: "#fbf8ed" },
  { id: "dark", label: "Dark Paper", paper: "#26272b", rule: "#4a4d56" },
];

/** Which paper colour a backdrop is on. Anything unrecognised reads as white. */
export function paperColorOf(backdrop: Backdrop): PaperColorId {
  if (backdrop.kind === "pdf" || !backdrop.paperColor) return "white";
  const match = PAPER_COLORS.find(
    (c) => c.paper.toLowerCase() === backdrop.paperColor?.toLowerCase(),
  );
  return match?.id ?? "white";
}

/** The backdrop a template produces on a given paper colour. */
export function templateBackdrop(ruling: Ruling, color: PaperColorId): SyntheticBackdrop {
  const spec = PAPER_COLORS.find((c) => c.id === color);
  const backdrop: SyntheticBackdrop = { kind: ruling };
  if (spec && spec.id !== "white") backdrop.paperColor = spec.paper;
  if (spec?.rule) backdrop.color = spec.rule;
  return backdrop;
}

export interface PageSize {
  id: string;
  label: string;
  /** Portrait width and height, in page px. */
  width: number;
  height: number;
}

/**
 * Page sizes. "Standard" is the default geometry every page has had so far.
 * The paper sizes use its scale — A4's 210 mm is 1024 px — so a pen stroke is
 * the same physical thickness on every size.
 */
const mm = (v: number): number => Math.round(mmToPage(v));

export const PAGE_SIZES: readonly PageSize[] = [
  { id: "standard", label: "Standard", width: DEFAULT_PAPER_WIDTH, height: DEFAULT_PAGE_HEIGHT },
  { id: "a6", label: "A6", width: mm(105), height: mm(148) },
  { id: "a5", label: "A5", width: mm(148), height: mm(210) },
  { id: "a3", label: "A3", width: mm(297), height: mm(420) },
  { id: "letter", label: "Letter", width: mm(215.9), height: mm(279.4) },
  { id: "legal-size", label: "Legal", width: mm(215.9), height: mm(355.6) },
  { id: "tabloid", label: "Tabloid", width: mm(279.4), height: mm(431.8) },
];

/** The geometry for a size id and orientation. Unknown ids get Standard. */
export function sizeGeometry(sizeId: string, landscape: boolean): PageGeometry {
  const size = PAGE_SIZES.find((s) => s.id === sizeId) ?? PAGE_SIZES[0];
  return landscape
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * Which size and orientation a geometry is. A geometry that matches none of
 * the presets (an imported or migrated page) reports `null`, so the picker can
 * offer "keep current size" rather than guessing.
 */
export function sizeOf(geometry: PageGeometry): { sizeId: string; landscape: boolean } | null {
  for (const size of PAGE_SIZES) {
    if (size.width === geometry.width && size.height === geometry.height) {
      return { sizeId: size.id, landscape: false };
    }
    if (size.height === geometry.width && size.width === geometry.height) {
      return { sizeId: size.id, landscape: true };
    }
  }
  return null;
}

// --- Recent templates -------------------------------------------------------

/** How many recent templates the popover remembers. */
export const MAX_RECENT = 6;

/** Two backdrops are the same template when they draw the same paper. */
function sameTemplate(a: SyntheticBackdrop, b: SyntheticBackdrop): boolean {
  return (
    a.kind === b.kind &&
    (a.paperColor ?? "") === (b.paperColor ?? "") &&
    (a.color ?? "") === (b.color ?? "") &&
    (a.spacing ?? 0) === (b.spacing ?? 0)
  );
}

/** Move `used` to the front of the recent list, without duplicates. */
export function pushRecent(
  recent: readonly SyntheticBackdrop[],
  used: SyntheticBackdrop,
  max: number = MAX_RECENT,
): SyntheticBackdrop[] {
  // A cover is not a paper template; it never becomes one by being used.
  if (isCoverRuling(used.kind)) return recent.slice(0, max);
  return [{ ...used }, ...recent.filter((r) => !sameTemplate(r, used))].slice(0, max);
}

/**
 * Parse a stored recent list. Anything malformed is dropped, never repaired
 * into something the user did not pick: this came from local storage, which
 * any other build or plugin could have written.
 */
export function parseRecent(raw: unknown): SyntheticBackdrop[] {
  if (!Array.isArray(raw)) return [];
  const out: SyntheticBackdrop[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.kind !== "string" || !(RULINGS as readonly string[]).includes(r.kind)) continue;
    if (isCoverRuling(r.kind)) continue;
    const backdrop: SyntheticBackdrop = { kind: r.kind as Ruling };
    if (typeof r.paperColor === "string") backdrop.paperColor = r.paperColor;
    if (typeof r.color === "string") backdrop.color = r.color;
    if (typeof r.spacing === "number" && Number.isFinite(r.spacing) && r.spacing > 0) {
      backdrop.spacing = r.spacing;
    }
    out.push(backdrop);
  }
  return out.slice(0, MAX_RECENT);
}

/**
 * The cards the "Add Page" popover shows: the current page's own template
 * first, then the recent ones that differ from it. A PDF page cannot be
 * repeated as a template, so its card is plain paper — and so is a cover's,
 * which is not paper at all (hosts pass {@link paperTemplateFor} instead).
 */
export function popoverTemplates(
  current: Backdrop,
  recent: readonly SyntheticBackdrop[],
): Array<{ label: string; backdrop: SyntheticBackdrop }> {
  const first: SyntheticBackdrop =
    current.kind === "pdf" || isCoverRuling(current.kind) ? { kind: "blank" } : { ...current };
  return [
    { label: "Current template", backdrop: first },
    ...recent
      .filter((r) => !sameTemplate(r, first))
      .map((backdrop) => ({ label: templateName(backdrop.kind), backdrop })),
  ].slice(0, MAX_RECENT);
}

/** Subtitle under a template card: its paper colour. */
export function paperLabel(backdrop: Backdrop): string {
  const id = paperColorOf(backdrop);
  return PAPER_COLORS.find((c) => c.id === id)?.label ?? "White Paper";
}
