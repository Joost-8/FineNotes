/**
 * Names and numbers the rest of the plugin shares. Many are fixed by what is
 * already on disk or in users' settings: file suffixes, frontmatter keys,
 * block labels and the default page size decide how existing notes are read,
 * so they change only with a migration. The tuning numbers decide how every
 * existing note looks.
 */

/** The view type id of the notebook view; saved in workspace layouts. */
export const VIEW_TYPE_INK = "goodobsidian-view";

/**
 * The plugin id every release before the public one used. Settings saved
 * under it are carried over once when the plugin runs under a new id.
 */
export const PREVIOUS_PLUGIN_ID = "goodobsidian";

/**
 * File name suffixes. A notebook is `Title.notebook.md`, a single page
 * `Title.page.md` — Obsidian's file list shows them as "Title.notebook" and
 * "Title.page". Notes created before 0.6.3 are `Title.ink.md`: still read,
 * never written. Every one is still a Markdown file, so Obsidian, search and
 * sync treat it as a note; the frontmatter flag claims files with none.
 */
export const NOTEBOOK_FILE_SUFFIX = ".notebook.md";
export const SINGLE_PAGE_FILE_SUFFIX = ".page.md";
export const LEGACY_INK_FILE_SUFFIX = ".ink.md";
export const INK_FILE_SUFFIXES: readonly string[] = [
  NOTEBOOK_FILE_SUFFIX,
  SINGLE_PAGE_FILE_SUFFIX,
  LEGACY_INK_FILE_SUFFIX,
];

/** Filename suffix for a single notebook page. Same format as an ink note. */
export const PAGE_FILE_SUFFIX = ".ink.md";

/** The notebook manifest inside a notebook folder. */
export const NOTEBOOK_FILE = "_notebook.md";

/** Frontmatter key whose truthy value claims a folder as a notebook. */
export const NOTEBOOK_FLAG = "goodobsidian-notebook";

/**
 * Folder holding generated page thumbnails, relative to the notebook folder.
 * Deliberately NOT dot-prefixed: sync services skip dot folders, which is the
 * trap that forced a competitor to ship a sync-compatibility toggle.
 */
export const THUMBS_DIR = "thumbs";

/** Frontmatter key whose truthy value claims a file for this plugin. */
export const FRONTMATTER_FLAG = "goodobsidian";

/** Frontmatter key that records which version of the format wrote the note. */
export const FRONTMATTER_VERSION = "goodobsidian-version";

/** Label used in the `%%goodobsidian … %%` data block. */
export const BLOCK_LABEL = "goodobsidian";

/**
 * The on-disk names notes carried before 0.2.0, when the plugin was still
 * branded after InkedMark, the project it grew out of. Every reader accepts
 * them beside the current names; every writer emits the current names, so a
 * note migrates the first time it is saved. Nothing else refers to them.
 */
export const LEGACY_FRONTMATTER_FLAG = "inkedmark";
export const LEGACY_FRONTMATTER_VERSION = "inkedmark-version";
export const LEGACY_BLOCK_LABEL = "inkedmark";

/**
 * Current stroke-document schema version.
 *
 * v1 (the original, pre-fork format): one unbounded "paper roll" region.
 * v2 (FineNotes): a sequence of fixed-geometry pages, each with a backdrop
 * and images. `serialize.ts` migrates v1 -> v2 on load; there is no downgrade.
 */
export const SCHEMA_VERSION = 2;

/**
 * The width of a standard page, in page px, and the width new notebooks get
 * unless the settings say otherwise. It is also A4's 210 mm (units.ts), the
 * scale every page size on disk is measured in.
 */
export const DEFAULT_PAPER_WIDTH = 1024;

/**
 * Default page height in CSS px. 1024 x 1448 is A4's sqrt(2) ratio at
 * upstream's paper width, so a page exports to PDF 1:1 without rescaling.
 */
export const DEFAULT_PAGE_HEIGHT = 1448;

/** Hold-to-snap: max pointer drift, in page px, that still counts as held. */
export const HOLD_RADIUS = 8;

/** Hold-to-snap: how long the pen must dwell before lift to trigger a snap. */
export const HOLD_MS = 500;

/**
 * Hold-to-snap: default confidence a fit must reach before the stroke is
 * replaced. Refusing what is not a shape is the job of the fitters' structural
 * gates (corner sharpness, sweep, closure): every stroke in the adversarial
 * suite produces no candidate at all. This floor only decides how sloppy a
 * real shape may be drawn. Measured 2026-09-21 on Pencil-like streams built
 * from ink traced out of an iPad recording: circles, rects and lines score
 * 0.78–0.86; the closest non-shape (a hill: straight base, bowed top) peaks at
 * 0.65 as an ellipse. See contracts/api.md §2.
 */
export const SNAP_MIN_CONFIDENCE = 0.65;

/**
 * Hold-to-snap: default gap, in page px, under which a stroke's ends count as
 * meeting (so it can be a circle or a rectangle rather than a line).
 * `shape-recognizer.ts` also allows a fraction of the stroke's own size, since
 * a big loop can leave a big gap and still read as closed.
 */
export const SNAP_CLOSE_TOLERANCE = 24;

/**
 * When a v1 paper roll becomes a page, the space left below its lowest ink,
 * in page px, so the migrated page has room to write on.
 */
export const PAPER_GROWTH_MARGIN = 600;

/** The pen and highlighter widths the toolbar offers, in page px. */
export const SIZES = [2, 3, 5, 8, 12] as const;

/**
 * The built-in ink colours, first the default. Chosen to stay legible on
 * white paper and on the darker papers alike.
 */
export const PALETTE = [
  "#1a1a1a",
  "#ffffff",
  "#e03131",
  "#1971c2",
  "#2f9e44",
  "#f08c00",
  "#9c36b5",
] as const;

/** The pressure a stroke is drawn at when there is no reading: a mouse, or pressure off. */
export const FALLBACK_PRESSURE = 0.5;

/**
 * A new pen sample closer than this to the last one kept is dropped, in
 * page px at fit zoom (the surface scales it for the zoom).
 */
export const MIN_SAMPLE_DISTANCE = 1.4;

/** How opaque highlighter ink is, unless the settings say otherwise. */
export const DEFAULT_HIGHLIGHTER_ALPHA = 0.4;

/**
 * Eraser diameters in page px: small, medium, large. Page space rather than
 * screen space, so zooming in erases finer detail — as on paper, and as in
 * GoodNotes.
 */
export const ERASER_SIZES = [10, 24, 48] as const;

/** Default eraser diameter (medium). */
export const DEFAULT_ERASER_SIZE = ERASER_SIZES[1];

/** How long the ink must be left alone before automatic transcription runs. */
export const AUTO_RECOGNIZE_IDLE_MS = 30_000;

/**
 * Icons, by the names of the Lucide icons Obsidian ships (checked against
 * the icon table in Obsidian's own `app.js`). The ink view's tab icon, and
 * the ribbon's "New notebook" button.
 */
export const ICON_INK_VIEW = "pen-tool";
export const ICON_NEW_NOTEBOOK = "notebook-pen";
