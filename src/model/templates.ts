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
import { isTemplatePaper } from "./paper-library";
import { paperExtrasKey, readPaperExtras } from "./paper-extras";
import { mmToPage } from "./units";
import { t } from "../i18n/translate";

export interface TemplateEntry {
  ruling: Ruling;
  /** The name shown, in the language in use. */
  readonly name: string;
}

export interface TemplateSection {
  readonly title: string;
  templates: readonly TemplateEntry[];
}

/** The picker's sections, in GoodNotes' order. Aliases (`lined`, `grid`) are not offered. */
export const TEMPLATE_SECTIONS: readonly TemplateSection[] = [
  {
    get title() {
      return t("notebooks.templateSection.essentials");
    },
    templates: [
      {
        ruling: "blank",
        get name() {
          return t("notebooks.template.blank");
        },
      },
      {
        ruling: "dotted",
        get name() {
          return t("notebooks.template.dotted");
        },
      },
      {
        ruling: "ruled-narrow",
        get name() {
          return t("notebooks.template.ruledNarrow");
        },
      },
      {
        ruling: "ruled-wide",
        get name() {
          return t("notebooks.template.ruledWide");
        },
      },
      {
        ruling: "squared",
        get name() {
          return t("notebooks.template.squared");
        },
      },
    ],
  },
  {
    get title() {
      return t("notebooks.templateSection.writing");
    },
    templates: [
      {
        ruling: "cornell",
        get name() {
          return t("notebooks.template.cornell");
        },
      },
      {
        ruling: "legal",
        get name() {
          return t("notebooks.template.legal");
        },
      },
      {
        ruling: "single-column",
        get name() {
          return t("notebooks.template.singleColumn");
        },
      },
      {
        ruling: "single-column-mix",
        get name() {
          return t("notebooks.template.singleColumnMix");
        },
      },
      {
        ruling: "two-column",
        get name() {
          return t("notebooks.template.twoColumn");
        },
      },
      {
        ruling: "three-column",
        get name() {
          return t("notebooks.template.threeColumn");
        },
      },
      {
        ruling: "margin-left",
        get name() {
          return t("notebooks.template.marginLeft");
        },
      },
      {
        ruling: "margin-right",
        get name() {
          return t("notebooks.template.marginRight");
        },
      },
      {
        ruling: "title-date",
        get name() {
          return t("notebooks.template.titleDate");
        },
      },
    ],
  },
  {
    get title() {
      return t("notebooks.templateSection.grids");
    },
    templates: [
      {
        ruling: "graph",
        get name() {
          return t("notebooks.template.graph");
        },
      },
      {
        ruling: "isometric",
        get name() {
          return t("notebooks.template.isometric");
        },
      },
      {
        ruling: "isometric-dots",
        get name() {
          return t("notebooks.template.isometricDots");
        },
      },
      {
        ruling: "hexagon",
        get name() {
          return t("notebooks.template.hexagon");
        },
      },
    ],
  },
  {
    get title() {
      return t("notebooks.templateSection.planner");
    },
    templates: [
      {
        ruling: "todos",
        get name() {
          return t("notebooks.template.todos");
        },
      },
      {
        ruling: "daily-planner",
        get name() {
          return t("notebooks.template.dailyPlanner");
        },
      },
      {
        ruling: "weekly-planner",
        get name() {
          return t("notebooks.template.weeklyPlanner");
        },
      },
      {
        ruling: "weekly-grid",
        get name() {
          return t("notebooks.template.weeklyGrid");
        },
      },
      {
        ruling: "monthly-planner",
        get name() {
          return t("notebooks.template.monthlyPlanner");
        },
      },
      {
        ruling: "habit-tracker",
        get name() {
          return t("notebooks.template.habitTracker");
        },
      },
      {
        ruling: "meeting-notes",
        get name() {
          return t("notebooks.template.meetingNotes");
        },
      },
      {
        ruling: "accounting",
        get name() {
          return t("notebooks.template.accounting");
        },
      },
    ],
  },
  {
    get title() {
      return t("notebooks.templateSection.study");
    },
    templates: [
      {
        ruling: "handwriting",
        get name() {
          return t("notebooks.template.handwriting");
        },
      },
      {
        ruling: "storyboard",
        get name() {
          return t("notebooks.template.storyboard");
        },
      },
    ],
  },
  {
    get title() {
      return t("notebooks.templateSection.music");
    },
    templates: [
      {
        ruling: "music",
        get name() {
          return t("notebooks.template.music");
        },
      },
      {
        ruling: "guitar-tab",
        get name() {
          return t("notebooks.template.guitarTab");
        },
      },
      {
        ruling: "music-tab",
        get name() {
          return t("notebooks.template.musicTab");
        },
      },
    ],
  },
];

/**
 * Cover designs, in the cover picker's groups. Covers are pages but not
 * paper, so the paper picker never offers them. The classic designs (plain,
 * label, spine, linen) are no longer offered but still drawn, so older
 * notebooks open as they were ({@link CLASSIC_COVER_NAMES}).
 */
export const COVER_SECTIONS: readonly TemplateSection[] = [
  {
    get title() {
      return t("notebooks.templateSection.covers");
    },
    templates: [
      {
        ruling: "cover-gradient",
        get name() {
          return t("notebooks.template.coverGradient");
        },
      },
      {
        ruling: "cover-orb",
        get name() {
          return t("notebooks.template.coverOrb");
        },
      },
      {
        ruling: "cover-split",
        get name() {
          return t("notebooks.template.coverSplit");
        },
      },
      {
        ruling: "cover-contour",
        get name() {
          return t("notebooks.template.coverContour");
        },
      },
      {
        ruling: "cover-glass",
        get name() {
          return t("notebooks.template.coverGlass");
        },
      },
      {
        ruling: "cover-monogram",
        get name() {
          return t("notebooks.template.coverMonogram");
        },
      },
      {
        ruling: "cover-accent",
        get name() {
          return t("notebooks.template.coverAccent");
        },
      },
    ],
  },
];

/** Every cover design the picker offers, in picker order. */
export const COVER_TEMPLATES: readonly TemplateEntry[] = COVER_SECTIONS.flatMap((s) => s.templates);

/** Names of the classic designs, which notebooks made before 2026-10-07 may still carry. */
export const CLASSIC_COVER_NAMES: readonly TemplateEntry[] = [
  {
    ruling: "cover-plain",
    get name() {
      return t("notebooks.template.coverPlain");
    },
  },
  {
    ruling: "cover-label",
    get name() {
      return t("notebooks.template.coverLabel");
    },
  },
  {
    ruling: "cover-band",
    get name() {
      return t("notebooks.template.coverBand");
    },
  },
  {
    ruling: "cover-linen",
    get name() {
      return t("notebooks.template.coverLinen");
    },
  },
];

export interface CoverColor {
  id: string;
  label: string;
  /** The cloth colour, stored as the cover backdrop's `paperColor`. */
  color: string;
}

/**
 * The cover colours the "New notebook" dialog and "Change cover" offer, each
 * with every design. Deep and light in equal numbers, so the derived title
 * ink is exercised both ways (see `coverPalette` in `cover.ts`). Ids are
 * stored in settings: never rename one, only add.
 */
export const COVER_COLORS: readonly CoverColor[] = [
  {
    id: "navy",
    get label() {
      return t("notebooks.coverColor.navy");
    },
    color: "#1f3a5f",
  },
  {
    id: "forest",
    get label() {
      return t("notebooks.coverColor.forest");
    },
    color: "#2f5d46",
  },
  {
    id: "burgundy",
    get label() {
      return t("notebooks.coverColor.burgundy");
    },
    color: "#7a2537",
  },
  {
    id: "charcoal",
    get label() {
      return t("notebooks.coverColor.charcoal");
    },
    color: "#34363b",
  },
  {
    id: "terracotta",
    get label() {
      return t("notebooks.coverColor.terracotta");
    },
    color: "#c0643f",
  },
  {
    id: "mustard",
    get label() {
      return t("notebooks.coverColor.mustard");
    },
    color: "#d9a93a",
  },
  {
    id: "sage",
    get label() {
      return t("notebooks.coverColor.sage");
    },
    color: "#9db59a",
  },
  {
    id: "sky",
    get label() {
      return t("notebooks.coverColor.sky");
    },
    color: "#8fb8de",
  },
  {
    id: "ink",
    get label() {
      return t("notebooks.coverColor.ink");
    },
    color: "#1d1e22",
  },
  {
    id: "plum",
    get label() {
      return t("notebooks.coverColor.plum");
    },
    color: "#5a3a5f",
  },
  {
    id: "teal",
    get label() {
      return t("notebooks.coverColor.teal");
    },
    color: "#236b70",
  },
  {
    id: "olive",
    get label() {
      return t("notebooks.coverColor.olive");
    },
    color: "#6b6a32",
  },
  {
    id: "kraft",
    get label() {
      return t("notebooks.coverColor.kraft");
    },
    color: "#b59a74",
  },
  {
    id: "blush",
    get label() {
      return t("notebooks.coverColor.blush");
    },
    color: "#e7b6ae",
  },
  {
    id: "lavender",
    get label() {
      return t("notebooks.coverColor.lavender");
    },
    color: "#b8aad8",
  },
  {
    id: "ivory",
    get label() {
      return t("notebooks.coverColor.ivory");
    },
    color: "#ece6d6",
  },
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
 * The page whose paper a new page next to page `index` should repeat.
 * Normally that page — but a cover is not paper, and neither is a board
 * among the pages (discussion #160), so next to one it is the nearest paper
 * page (the one after it first), or none.
 */
export function paperPageFor(pages: readonly Page[], index: number): Page | undefined {
  return nearestPage(
    pages,
    index,
    (page) =>
      page.board !== true && (page.backdrop.kind === "pdf" || !isCoverRuling(page.backdrop.kind)),
  );
}

/**
 * The page whose size a new page next to page `index` takes: that page, or
 * next to a board among the pages (discussion #160) the nearest page that
 * is not a board (the one after it first); none in a notebook of boards.
 */
export function shapePageFor(pages: readonly Page[], index: number): Page | undefined {
  return nearestPage(pages, index, (page) => page.board !== true);
}

/** Page `index` when it is `fit`, else the nearest that is (the one after first). */
function nearestPage(
  pages: readonly Page[],
  index: number,
  fit: (page: Page) => boolean,
): Page | undefined {
  const at = Math.max(0, Math.min(pages.length - 1, Math.trunc(index) || 0));
  const ok = (page: Page | undefined): page is Page => !!page && fit(page);
  if (ok(pages[at])) return pages[at];
  for (let d = 1; d < pages.length; d++) {
    if (ok(pages[at + d])) return pages[at + d];
    if (ok(pages[at - d])) return pages[at - d];
  }
  return undefined;
}

/** The paper a new page next to page `index` should repeat ({@link paperPageFor}), or blank. */
export function paperTemplateFor(pages: readonly Page[], index: number): Backdrop {
  return paperPageFor(pages, index)?.backdrop ?? { kind: "blank" };
}

/**
 * The backdrop a new page repeats from paper `backdrop`. A PDF page from My
 * templates is paper like any other ({@link isTemplatePaper}, given the
 * names in My templates now), so it repeats as it is, the same page of the
 * same PDF. Any other PDF page (a lecture's slide) points at content, not
 * paper: a blank sheet is the honest default.
 */
export function repeatedPaper(backdrop: Backdrop, templateNames: ReadonlySet<string>): Backdrop {
  if (backdrop.kind === "pdf" && !isTemplatePaper(backdrop, templateNames)) {
    return { kind: "blank" };
  }
  return { ...backdrop };
}

/** Display name of a ruling, in the language in use. */
export function templateName(ruling: Ruling): string {
  // The aliases (`lined`, `grid`) are named as the papers they draw.
  if (ruling === "lined") return t("notebooks.template.ruledWide");
  if (ruling === "grid") return t("notebooks.template.squared");
  const entries = [
    ...TEMPLATE_SECTIONS.flatMap((s) => s.templates),
    ...COVER_TEMPLATES,
    ...CLASSIC_COVER_NAMES,
  ];
  return entries.find((entry) => entry.ruling === ruling)?.name ?? t("notebooks.template.paper");
}

export type PaperColorId = "white" | "yellow" | "dark";

export interface PaperColor {
  id: PaperColorId;
  label: string;
  /** Page fill. */
  paper: string;
  /** Rule colour, when the paper theme's default would not read on it. */
  rule?: string;
  /** Earlier fills of this paper, which pages already written still carry. */
  former?: readonly string[];
}

export const PAPER_COLORS: readonly PaperColor[] = [
  {
    id: "white",
    get label() {
      return t("notebooks.paperKind.white");
    },
    paper: "#ffffff",
  },
  {
    id: "yellow",
    get label() {
      return t("notebooks.paperKind.yellow");
    },
    paper: "#f9f1d3",
    former: ["#fbf8ed"],
  },
  {
    id: "dark",
    get label() {
      return t("notebooks.paperKind.dark");
    },
    paper: "#26272b",
    rule: "#4a4d56",
  },
];

/** Which paper colour a backdrop is on. Anything unrecognised reads as white. */
export function paperColorOf(backdrop: Backdrop): PaperColorId {
  if (backdrop.kind === "pdf" || !backdrop.paperColor) return "white";
  const fill = backdrop.paperColor.toLowerCase();
  const match = PAPER_COLORS.find(
    (c) => c.paper.toLowerCase() === fill || c.former?.includes(fill),
  );
  return match?.id ?? "white";
}

/**
 * A page's backdrop with its template left out, for Export as PDF's plain
 * paper: lines, grid, dots, texture, margin lines and printed prompts go and
 * the paper keeps its colour. A PDF page and a cover are content, not
 * template, and stay as they are.
 */
export function plainBackdrop(backdrop: Backdrop): Backdrop {
  if (backdrop.kind === "pdf" || isCoverRuling(backdrop.kind)) return backdrop;
  return backdrop.paperColor
    ? { kind: "blank", paperColor: backdrop.paperColor }
    : { kind: "blank" };
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
  // 1024 x 1448 page px is 210 x 297 mm at this scale: A4 (units.ts).
  {
    id: "standard",
    get label() {
      return t("notebooks.page.size.standard");
    },
    width: DEFAULT_PAPER_WIDTH,
    height: DEFAULT_PAGE_HEIGHT,
  },
  { id: "a6", label: "A6", width: mm(105), height: mm(148) },
  { id: "a5", label: "A5", width: mm(148), height: mm(210) },
  { id: "a3", label: "A3", width: mm(297), height: mm(420) },
  { id: "a2", label: "A2", width: mm(420), height: mm(594) },
  { id: "a1", label: "A1", width: mm(594), height: mm(841) },
  { id: "a0", label: "A0", width: mm(841), height: mm(1189) },
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
    (a.spacing ?? 0) === (b.spacing ?? 0) &&
    paperExtrasKey(a) === paperExtrasKey(b)
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
    out.push({ ...backdrop, ...readPaperExtras(r) });
  }
  return out.slice(0, MAX_RECENT);
}

/**
 * The cards the "Add Page" popover shows: the current page's own template
 * first, then the recent ones that differ from it. The first card repeats
 * the page as a new page would ({@link repeatedPaper}): a page of My
 * templates as it is, any other PDF page as plain paper. So is a cover,
 * which is not paper at all (hosts pass {@link paperTemplateFor} instead).
 */
export function popoverTemplates(
  current: Backdrop,
  recent: readonly SyntheticBackdrop[],
  templateNames: ReadonlySet<string> = new Set(),
): Array<{ label: string; backdrop: Backdrop }> {
  const first: Backdrop =
    current.kind !== "pdf" && isCoverRuling(current.kind)
      ? { kind: "blank" }
      : repeatedPaper(current, templateNames);
  return [
    { label: t("notebooks.template.current"), backdrop: first },
    ...recent
      .filter((r) => first.kind === "pdf" || !sameTemplate(r, first))
      .map((backdrop) => ({ label: templateName(backdrop.kind), backdrop })),
  ].slice(0, MAX_RECENT);
}

/** Subtitle under a template card: its paper colour. */
export function paperLabel(backdrop: Backdrop): string {
  const id = paperColorOf(backdrop);
  return PAPER_COLORS.find((c) => c.id === id)?.label ?? t("notebooks.paperKind.white");
}
