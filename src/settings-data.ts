/**
 * The plugin's stored settings (`data.json`) and the pure rules around them.
 * No Obsidian and no DOM, so all of it is tested; `settings.ts` draws the tab.
 *
 * Every key below is already in users' vaults. Renaming one, changing what
 * its value means, or reordering `DEFAULT_SETTINGS` (whose order is the order
 * a fresh install writes) changes a file people sync between devices, so
 * `tests/settings/settings-data.test.ts` pins all of it.
 */

import { type ShapeToolStyle } from "./model/shape-style";
import type { LearnedModel } from "./view/handwriting-learning";
import {
  DEFAULT_ERASER_SIZE,
  DEFAULT_HIGHLIGHTER_ALPHA,
  DEFAULT_PAPER_WIDTH,
  PALETTE,
  SIZES,
} from "./constants";
import { type PaperTheme, paperTheme } from "./canvas/backdrop";
import { DEFAULT_LASSO_FILTER, type LassoFilter, type LassoMode } from "./canvas/lasso";
import { DEFAULT_PEN_GESTURES, type PenGestures } from "./ink/pen-gestures";
import type { BarrelAction } from "./input/pen-modifiers";
import { type SavedPen, defaultSavedPens } from "./model/saved-pens";
import type { EraserFilter } from "./ink/stroke-eraser";
import { DEFAULT_SHAPE_COLOR } from "./model/colors";
import { DEFAULT_STICKER_FOLDER } from "./model/stickers";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "./model/text-style";
import type { ImageAspect } from "./recognition/ai-image";
import type { ImageVendorChoice } from "./recognition/ai-menu-model";
import { type LlmVendor, chatCompletionsUrl, isPlainHttpUrl } from "./recognition/llm-request";
import { MANUAL_PROVIDER_ID } from "./recognition/manual";
import type { EraserMode } from "./view/toolbar";
import type { PenCursorStyle } from "./view/pen-cursor";

/** The tools an ink note can open with (`defaultTool`). */
export type ToolId = "pen" | "highlighter" | "eraser" | "select";

/** How pages are shown (`pageAppearance`): light paper, dark pages, or as Obsidian's theme is. */
export type PageAppearance = "light" | "dark" | "system";

export interface GoodObsidianSettings {
  // What an ink note starts with. Tool state the toolbar remembers is further down.
  /** Draw a rough shape, hold the pen still at the end, and it snaps clean. */
  drawAndHold: boolean;
  defaultTool: ToolId;
  /** Extra palette swatches, `#rgb` or `#rrggbb`. */
  customColors: string[];
  defaultColor: string;
  defaultSize: number;
  /** The eraser's last mode, kept between sessions. */
  eraserMode: EraserMode;
  /** The eraser's last diameter, in page px. */
  eraserSize: number;
  /** "Erase highlighter only" / "Erase pen only" (0.5). Checked where it is read. */
  eraserFilter: EraserFilter;
  /** Freehand or rectangular lasso (0.5). Checked where it is read. */
  lassoMode: LassoMode;
  /** What the lasso picks up (0.5). May hold anything; checked where it is read. */
  lassoFilter: LassoFilter;
  /** 0–1. The settings tab shows it as a percentage. */
  highlighterAlpha: number;
  paperWidth: number;

  // The "New notebook" dialog (0.5).
  /** Where new notebooks and pages go; empty for the folder of the open note. */
  newNotebookFolder: string;
  /** Show New notebook in the file explorer context menu. */
  showNewNotebookInContextMenu: boolean;
  /** Show New notebook beside the file explorer creation buttons. */
  showNewNotebookInExplorer: boolean;
  /**
   * The dialog's last choices (type, cover, paper, size, orientation). May
   * hold anything, so it is only read through `parseNotebookChoices`.
   */
  lastNotebookChoices: unknown;

  recognitionProviderId: string;
  desynchronizedCanvas: boolean;
  /** The input overlay: raw pointer events drawn over the page. */
  debugHud: boolean;
  /** The iPad Scribble notice is shown once; this says it has been. */
  scribbleNoticeShown: boolean;
  /** The last version whose changes "What's new" has shown. */
  lastSeenVersion: string;

  // AI with the user's own key.
  /** The vendor that transcribes pages and answers questions. */
  llmVendor: LlmVendor;
  /** Empty for the vendor's default model. */
  llmModel: string;
  /**
   * Before 0.5, the selected cloud vendor's key in plain text. Loading moves
   * it into the key store (`key-store.ts`) and empties it; a key whose vendor
   * cannot be told stays here.
   */
  llmApiKey: string;
  /** Base URL of the `custom` vendor, an OpenAI-compatible server. */
  llmBaseUrl: string;
  /** Before 0.5, the custom endpoint's key; moved like `llmApiKey`. */
  llmCustomApiKey: string;
  /**
   * Keys per vendor slot, used only where Obsidian has no keychain (before
   * 1.11.4); with one, this stays empty. The `custom` slot's key only ever
   * goes to the custom endpoint.
   */
  apiKeys: Partial<Record<LlmVendor, string>>;
  /** "same" makes pictures with the text vendor; otherwise that vendor. */
  imageVendor: ImageVendorChoice;
  /** Empty for the image vendor's default model. */
  imageModel: string;
  /** The shape last picked in "Generate image". */
  imageAspect: ImageAspect;
  /** "Save chat" as last left in Ask AI: new chats start saved to the notebook's AI chats folder. */
  askSaveChats: boolean;
  /** The user agreed that cloud AI sends their pages off the device. */
  cloudConsentGiven: boolean;
  /** The same agreement, given separately for the custom endpoint. */
  customConsentGiven: boolean;
  /** Transcribe a page by itself once the ink has rested. */
  autoRecognize: boolean;

  // The Text tool (0.5): tool state the pill edits, with no row in the tab.
  /** What a new text box looks like. Checked where it is read. */
  textStyle: TextStyle;
  /** "Pin Text tool": Text stays chosen after a box is done. */
  textToolPinned: boolean;
  /** "Drag to size": dragging with Text sizes the new box; off, boxes fit their text. */
  textDragSize: boolean;
  /** How often the Text tool's hint has been shown. */
  textHintShown: number;
  /** The hint was closed with its ×, and stays away. */
  textHintDismissed: boolean;
  /** The pen's auto-shape: a stroke that is a shape snaps to it on lift. */
  penAutoShape: boolean;
  /** Scribble to erase and Circle to lasso (the pen type menu). Checked where it is read. */
  penGestures: PenGestures;
  /** The Shape tool's colour, `#rrggbb`. */
  shapeColor: string;
  /** Vault folder of the user's sticker collections: one subfolder per collection. */
  stickerFolder: string;
  /** The Shape tool's fill, line, corners and arrowheads (`model/shape-style`). */
  shapeStyle?: ShapeToolStyle;
  /** Colours picked lately, newest first. Checked where it is read. */
  recentColors: string[];
  /** The pen row's picked colours, after the reserved ones. Checked where it is read. */
  penColors?: string[];
  /**
   * Each pen type's own colour and row (`model/pen-inks.ts`), so switching
   * pens brings each one's colours back. Checked where it is read.
   */
  penInks?: Record<string, unknown>;
  /**
   * Advanced: the pressure pens (Fountain, Brush) widen with pen pressure.
   * Off, every pen draws one width. It replaced `pressureEnabled`
   * (2026-09-30), which was on by default and is dropped on load.
   */
  pressureWidth: boolean;
  /** Selecting an active secondary tool again returns to the pen or highlighter used before. */
  returnToPenOnReselect: boolean;
  /** Finish one secondary-tool use, then return to the pen or highlighter used before. */
  returnToPenAfterUse: boolean;
  /** Double-tap with two fingers to undo, with three to redo. */
  fingerTapUndo: boolean;
  /** Read handwriting on this device: search, titles and links from ink. */
  handwritingOnDevice: boolean;
  /**
   * The vault path of a handwriting model file to read with instead of the
   * bundled one (a model tuned to one writer). Blank for the bundled model.
   */
  hwrModelPath?: string;
  /** The model learned from the user's practice page, when there is one. */
  handwritingModel?: LearnedModel;
  /** Where the practice notebook was written. */
  practiceNotebookPath?: string;

  // Dark pages (#25): a view setting. What is stored never changes.
  /** Light pages, dark pages, or following Obsidian's theme. Checked where it is read. */
  pageAppearance: PageAppearance;
  /** With dark pages, PDF pages are inverted too; off, they are shown as they are. */
  invertPdfPages: boolean;

  // Pens and shortcuts (FineNotes#24, #25).
  /** Up to eight saved pens, for the toolbar's favourites and the keys 1 to 8. Checked where read. */
  savedPens: SavedPen[];
  /** The pen last written with, which every notebook opens with. Checked where it is read. */
  lastPen?: SavedPen;
  /** What a tablet pen's barrel button does: erase, lasso, pan, or nothing. Checked where read. */
  barrelButton: BarrelAction;
  /**
   * The cursor over the page for the pens, on a computer: the ink dot, a
   * small crosshair or the arrow. A boolean before FineNotes#27 (on is the
   * ink dot now); checked where read.
   */
  penCursor: PenCursorStyle;
  /**
   * Highlighter strokes are drawn as straight runs that bend only where the
   * pen turned, as GoodNotes draws them (`ink/straighten.ts`).
   */
  straightHighlighter: boolean;

  /**
   * The settings tab's sections shown folded, by id. Checked where read
   * ({@link foldedSectionsOf}). It replaced `openSettingsSections` (the open
   * ones), so everyone starts again from the new default.
   */
  foldedSettingsSections: string[];
}

// The records are copies, so a host that edits its settings in place cannot
// change the shared defaults.
export const DEFAULT_SETTINGS: GoodObsidianSettings = {
  drawAndHold: true,
  defaultTool: "pen",
  customColors: [],
  defaultColor: PALETTE[0],
  defaultSize: SIZES[1],
  eraserMode: "standard",
  eraserSize: DEFAULT_ERASER_SIZE,
  eraserFilter: "all",
  lassoMode: "freehand",
  lassoFilter: { ...DEFAULT_LASSO_FILTER },
  highlighterAlpha: DEFAULT_HIGHLIGHTER_ALPHA,
  paperWidth: DEFAULT_PAPER_WIDTH,
  newNotebookFolder: "",
  lastNotebookChoices: null,
  recognitionProviderId: MANUAL_PROVIDER_ID,
  desynchronizedCanvas: true,
  debugHud: false,
  scribbleNoticeShown: false,
  lastSeenVersion: "",
  llmVendor: "anthropic",
  llmModel: "",
  llmApiKey: "",
  llmBaseUrl: "",
  llmCustomApiKey: "",
  apiKeys: {},
  imageVendor: "same",
  imageModel: "",
  imageAspect: "square",
  askSaveChats: false,
  cloudConsentGiven: false,
  customConsentGiven: false,
  autoRecognize: false,
  textStyle: { ...DEFAULT_TEXT_STYLE },
  textToolPinned: false,
  textDragSize: false,
  textHintShown: 0,
  textHintDismissed: false,
  penAutoShape: false,
  penGestures: { ...DEFAULT_PEN_GESTURES },
  shapeColor: DEFAULT_SHAPE_COLOR,
  stickerFolder: DEFAULT_STICKER_FOLDER,
  recentColors: [],
  pressureWidth: false,
  returnToPenOnReselect: false,
  returnToPenAfterUse: false,
  fingerTapUndo: true,
  handwritingOnDevice: true,
  showNewNotebookInContextMenu: true,
  showNewNotebookInExplorer: false,
  pageAppearance: "light",
  invertPdfPages: true,

  savedPens: defaultSavedPens(),
  barrelButton: "erase",
  penCursor: "ink",
  straightHighlighter: true,

  foldedSettingsSections: ["pens", "shortcuts"],
};

// --- Folded settings sections ----------------------------------------------------

/**
 * The parts of the settings tab that fold, by the id `foldedSettingsSections`
 * keeps: the sections, and the shortcut list inside "Pens and shortcuts".
 * Ids, not headings, so a renamed heading keeps its state.
 */
export const SETTINGS_SECTIONS = [
  "writing",
  "pens",
  "shortcuts",
  "pages",
  "handwriting",
  "ai",
  "advanced",
  "support",
  "community",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Folded on a fresh install: "Pens and shortcuts" (the longest) and its shortcut list. */
export const DEFAULT_FOLDED_SECTIONS: readonly SettingsSection[] = ["pens", "shortcuts"];

function isSection(value: unknown): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly unknown[]).includes(value);
}

/**
 * The folded sections a stored value names, in the tab's order, once each.
 * Anything but a list (a missing key, a hand-edited file) is the default;
 * ids this build does not know are dropped.
 */
export function foldedSectionsOf(raw: unknown): SettingsSection[] {
  if (!Array.isArray(raw)) return [...DEFAULT_FOLDED_SECTIONS];
  return SETTINGS_SECTIONS.filter((id) => raw.includes(id));
}

/** Whether `id` is shown unfolded. */
export function sectionOpen(raw: unknown, id: SettingsSection): boolean {
  return !foldedSectionsOf(raw).includes(id);
}

/** The folded sections with `id` opened or folded. */
export function withSection(raw: unknown, id: SettingsSection, open: boolean): SettingsSection[] {
  if (!isSection(id)) return foldedSectionsOf(raw);
  const rest = foldedSectionsOf(raw).filter((section) => section !== id);
  return open ? rest : SETTINGS_SECTIONS.filter((s) => s === id || rest.includes(s));
}

// --- Dark pages ----------------------------------------------------------------

/**
 * Whether pages are shown dark, from the `pageAppearance` setting (anything
 * it does not know is light) and whether Obsidian's theme is dark.
 */
export function pagesAreDark(appearance: unknown, obsidianDark: boolean): boolean {
  if (appearance === "dark") return true;
  return appearance === "system" && obsidianDark;
}

/**
 * The paper theme notebooks and page embeds are shown in, by the dark pages
 * settings and Obsidian's theme. A view setting only: export, printing and
 * AI reading always paint `paperTheme(false)`.
 */
export function shownPaperTheme(
  settings: Pick<GoodObsidianSettings, "pageAppearance" | "invertPdfPages">,
  obsidianDark: boolean,
): PaperTheme {
  const dark = pagesAreDark(settings.pageAppearance, obsidianDark);
  return paperTheme(dark, settings.invertPdfPages === false);
}

// --- Paper width -------------------------------------------------------------

/** The paper widths the tab accepts, in pixels. */
export const PAPER_WIDTH_RANGE = { min: 320, max: 4096 } as const;

/**
 * The width typed into the Paper width field, or `null` while it is not one.
 * Leading digits count, as `parseInt` reads them: "1400px" is 1400.
 */
export function paperWidthFrom(text: string): number | null {
  const width = Number.parseInt(text, 10);
  if (!Number.isFinite(width)) return null;
  return width >= PAPER_WIDTH_RANGE.min && width <= PAPER_WIDTH_RANGE.max ? width : null;
}

// --- Custom endpoint ---------------------------------------------------------

/**
 * What is wrong with a custom endpoint's URL, if anything: `incomplete` when
 * no chat URL can be made from it, `plain-http` when it would work on a
 * desktop but mobile devices tend to refuse it. An empty field is not yet a
 * problem.
 */
export function endpointWarning(url: string): "incomplete" | "plain-http" | null {
  if (!url) return null;
  try {
    chatCompletionsUrl(url);
  } catch {
    return "incomplete";
  }
  return isPlainHttpUrl(url) ? "plain-http" : null;
}

// --- What controls show, and what is stored --------------------------------

/** The hex colours in a comma-separated list; anything else is dropped. */
export function parseColorList(text: string): string[] {
  const hex = /^#(?:[0-9a-f]{3}){1,2}$/i;
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => hex.test(part));
}

/**
 * The keys a settings control does not show as stored: the slider works in
 * percent, the dropdown in strings, the colour list as one line of text, and
 * a model id is stored without the spaces a paste brings along.
 */
const CONVERSIONS: Record<
  string,
  { show(stored: unknown): unknown; store(shown: unknown): unknown }
> = {
  highlighterAlpha: {
    show: (alpha) => Math.round((alpha as number) * 100),
    store: (percent) => (percent as number) / 100,
  },
  defaultSize: { show: (size) => String(size), store: (text) => Number(text) },
  customColors: {
    show: (colors) => (colors as string[]).join(", "),
    store: (text) => parseColorList(text as string),
  },
  llmModel: { show: (id) => id, store: (id) => (id as string).trim() },
  imageModel: { show: (id) => id, store: (id) => (id as string).trim() },
};

function conversion(key: string) {
  return Object.prototype.hasOwnProperty.call(CONVERSIONS, key) ? CONVERSIONS[key] : undefined;
}

/** A stored value as its settings control shows it. */
export function shownValue(settings: GoodObsidianSettings, key: string): unknown {
  const stored = (settings as unknown as Record<string, unknown>)[key];
  const convert = conversion(key);
  return convert ? convert.show(stored) : stored;
}

/** Store what a settings control was set to, in `data.json`'s own units. */
export function storeShownValue(settings: GoodObsidianSettings, key: string, shown: unknown): void {
  const convert = conversion(key);
  (settings as unknown as Record<string, unknown>)[key] = convert ? convert.store(shown) : shown;
}

/**
 * Keys that change which rows the tab has (the recognition provider brings
 * automatic recognition, the vendors bring their key, endpoint and model
 * rows), so the tab is rebuilt after they change.
 */
export function changesTabLayout(key: string): boolean {
  return (
    key === "recognitionProviderId" ||
    key === "llmVendor" ||
    key === "imageVendor" ||
    key === "pressureWidth"
  );
}
