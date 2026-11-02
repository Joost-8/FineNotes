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
import type { LearnedModel } from "./recognition/hwr/learned-model";
import {
  DEFAULT_ERASER_SIZE,
  DEFAULT_HIGHLIGHTER_ALPHA,
  DEFAULT_PAPER_WIDTH,
  PALETTE,
  SIZES,
} from "./constants";
import {
  DARK_PAPER,
  LIGHT_DESK,
  LIGHT_PAPER,
  type PaperTheme,
  paperTheme,
  withDesk,
} from "./canvas/backdrop";
import { DEFAULT_LASSO_FILTER, type LassoFilter, type LassoMode } from "./canvas/lasso";
import { DEFAULT_PEN_GESTURES, type PenGestures } from "./ink/pen-gestures";
import type { BarrelAction } from "./input/pen-modifiers";
import type { ExportFormat } from "./export/export-choice";
import type { StylusClickAction } from "./input/stylus-click";
import { type SavedPen, defaultSavedPens } from "./model/saved-pens";
import { type BarItemId, DEFAULT_BAR } from "./view/toolbar-layout";
import type { EraserFilter } from "./ink/stroke-eraser";
import { DEFAULT_SHAPE_COLOR, parseHexColor } from "./model/colors";
import { DEFAULT_STICKER_FOLDER, DEFAULT_TEMPLATE_FOLDER } from "./model/vault-folders";
import type { AttachmentKind } from "./model/document";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "./model/text-style";
import type { ImageAspect } from "./recognition/ai-image";
import type { ImageVendorChoice } from "./recognition/ai-menu-model";
import { type LlmVendor, chatCompletionsUrl, isPlainHttpUrl } from "./recognition/llm-request";
import { MANUAL_PROVIDER_ID } from "./recognition/manual";
import type { EraserMode } from "./view/toolbar";
import type { PenCursorStyle } from "./view/pen-cursor";
import { type PenOptionsOnWrite, penOptionsOnWriteOf } from "./view/tool-return";

/** The tools an ink note can open with (`defaultTool`). */
export type ToolId = "pen" | "highlighter" | "eraser" | "select";

/** How pages are shown (`pageAppearance`): light paper, dark pages, or as Obsidian's theme is. */
export type PageAppearance = "light" | "dark" | "system";
/** The desk around the pages: `auto` is the page appearance's own (`PaperTheme.desk`). */
export type DeskChoice = "auto" | "light" | "dark" | "custom";
export type SnapMode = "disabled" | "hold" | "auto";

export interface GoodObsidianSettings {
  // What an ink note starts with. Tool state the toolbar remembers is further down.
  /**
   * When a pen stroke snaps to a shape (Pen gestures › Make shapes): never,
   * after a hold, or on lift too. The one field the code reads; `drawAndHold`
   * and `penAutoShape` only mirror it, for vaults that go back to an older
   * build ({@link storeSnapMode}).
   */
  snapMode: SnapMode;
  /** How curved a stroke may be and still snap, 10 (strict) to 100 (loose); 50 is the tuned default. */
  snapCurvatureThreshold: number;
  /** Mirror of `snapMode !== "disabled"`, read by builds before it. */
  drawAndHold: boolean;
  defaultTool: ToolId;
  /** Extra palette swatches, `#rgb` or `#rrggbb`. */
  customColors: string[];
  defaultColor: string;
  /** The laser pointer's default colour, `#rgb` or `#rrggbb`. */
  laserDefaultColor: string;
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
  /**
   * The lasso takes a stroke when any part of it is inside the loop, as
   * Notability does (the default); off, at least half of it (Goodnotes,
   * `canvas/lasso.ts`). It was `lassoAnyPart`, off by default, in the
   * unreleased PR #59 build: a new key, so a vault that saved that `false`
   * still gets the new default.
   */
  lassoTouches: boolean;
  /** 0–1. The settings tab shows it as a percentage. */
  highlighterAlpha: number;
  paperWidth: number;

  // The "New notebook" dialog (0.5).
  /** Where new notebooks and pages go; empty for the folder of the open note. */
  newNotebookFolder: string;
  /**
   * New notebooks and pages get a folder of their own, named after them,
   * holding the note and the folders its pictures, recordings, transcripts,
   * AI chats and exports go in. The file explorer shows it as the notebook.
   */
  notebookOwnFolder: boolean;
  /** Show New notebook in the file explorer context menu. */
  showNewNotebookInContextMenu: boolean;
  /** Show New notebook beside the file explorer creation buttons. */
  showNewNotebookInExplorer: boolean;
  /**
   * In the file explorer, show a notebook's own folder as the notebook: its
   * file hidden inside, the folder's name opening it, icons on its folders.
   */
  folderNotebooks: boolean;
  /**
   * The dialog's last choices (type, cover, paper, size, orientation). May
   * hold anything, so it is only read through `parseNotebookChoices`.
   */
  lastNotebookChoices: unknown;
  /**
   * The My templates entry the dialog made a notebook of last time, or null
   * when it was a paper. Read only through `parseNotebookTemplate`.
   */
  lastNotebookTemplate: unknown;

  recognitionProviderId: string;
  desynchronizedCanvas: boolean;
  /** The input overlay: raw pointer events drawn over the page. */
  debugHud: boolean;
  /** The iPad Scribble notice is shown once; this says it has been. */
  scribbleNoticeShown: boolean;
  /** The last version whose changes "What's new" has shown. */
  lastSeenVersion: string;
  /** Read once a day whether a newer FineNotes is out, and mark the gear (update-check.ts). */
  checkForUpdates: boolean;
  /**
   * While one is out, "Update available" pops up under the gear every other
   * day; off, the dot alone says it ("Don't show again").
   */
  updateReminders: boolean;

  // AI with the user's own key.
  /** The vendor that transcribes pages and answers questions. */
  llmVendor: LlmVendor;
  /** Empty for the vendor's default model. */
  llmModel: string;
  /** With OpenRouter, serve the model only from providers that do not say they compress it. */
  openRouterSkipCompressed: boolean;
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
  /** Where Ask opens: a window over the notebook, or a sidebar beside the page. */
  askLayout: "window" | "sidebar";
  /**
   * A new Ask AI chat starts with the page being read picked. Off by default
   * (Joost, discussion #107): a chat sends a page only when the user picks one.
   */
  askAttachPage: boolean;
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
  /** Where Make shapes lives was said, at the first pen stroke that snapped. */
  shapeHintShown: boolean;
  /** Mirror of `snapMode === "auto"`, read by builds before it. */
  penAutoShape: boolean;
  /** Scribble to erase and Circle to lasso (the pen type menu). Checked where it is read. */
  penGestures: PenGestures;
  /** The Shape tool's colour, `#rrggbb`. */
  shapeColor: string;
  /** Cover tape's colour, `#rrggbb` (`model/cover-tape`). Absent: masking tape. */
  tapeColor?: string;
  /** Cover tape's height, page px. Absent: the medium height. */
  tapeHeight?: number;
  /** Vault folder of the user's sticker collections: one subfolder per collection. */
  stickerFolder: string;
  /**
   * Where notebooks without a folder of their own save new files, by kind;
   * "" keeps each kind's own default (Obsidian's attachment setting, next to
   * the recording, an AI chats folder, next to the note). A notebook with its
   * own folder, or one that set a folder itself, keeps its own.
   */
  imagesFolder: string;
  recordingsFolder: string;
  transcriptsFolder: string;
  chatsFolder: string;
  exportsFolder: string;
  /** New tables get a header row. */
  tableHeader?: boolean;
  /** Vault folder "Save as template" writes `.finetemplate` files to. */
  templateFolder: string;
  /** URL of a template gallery's JSON index; empty: no gallery. */
  templateGalleryUrl: string;
  /** The Shape tool's fill, line, corners and arrowheads (`model/shape-style`). */
  shapeStyle?: ShapeToolStyle;
  /** How far the Fill tool reaches past gaps (`model/fill-region`). Checked where it is read. */
  fillGap?: string;
  /** The Fill tool's own colour, `#rrggbb`; not the pen's. Checked where it is read. */
  fillColor?: string;
  /** Colours picked lately, newest first. Checked where it is read. */
  recentColors: string[];
  /** The pen row's picked colours, after the reserved ones. Checked where it is read. */
  penColors?: string[];
  /** The pen types' order in the pen's row (`model/pen-type-order.ts`). Checked where it is read. */
  penTypeOrder?: string[];
  /**
   * Each pen type's own colour and row (`model/pen-inks.ts`), so switching
   * pens brings each one's colours back. Checked where it is read.
   */
  penInks?: Record<string, unknown>;
  /**
   * Each pen type's stroke stabilization, whole percent
   * (`model/pen-stabilization.ts`); a pen left out is off. Checked where it
   * is read.
   */
  penStabilization?: Record<string, unknown>;
  /** The ruler's kind and angle snapping (`rulerSettingsOf`). Checked where it is read. */
  ruler?: unknown;
  /**
   * Advanced: the pressure pens (Fountain, Brush) widen with pen pressure.
   * Off, every pen draws one width. It replaced `pressureEnabled`
   * (2026-09-30), which was on by default and is dropped on load.
   */
  pressureWidth: boolean;
  /**
   * Advanced: the Brush pen paints wider where the Pencil is held flat, for
   * shading (`ink/tilt`). Off, nothing of the tilt is kept. Strokes that
   * kept it are drawn with it either way.
   */
  pencilTilt: boolean;
  /** Selecting an active secondary tool again returns to the pen or highlighter used before. */
  returnToPenOnReselect: boolean;
  /** Finish one secondary-tool use, then return to the pen or highlighter used before. */
  returnToPenAfterUse: boolean;
  /** Double-tap with two fingers to undo, with three to redo. */
  fingerTapUndo: boolean;
  /** Read handwriting on this device: search, titles and links from ink. */
  handwritingOnDevice: boolean;
  /**
   * While a recording plays, ink not written yet at that moment shows pale
   * (2.5); switched on the player bar.
   */
  replayInk: boolean;
  /**
   * Underline words read on this device that may be misread; a tap corrects
   * them, and learning uses the answers (view/word-check.ts).
   */
  checkHandwrittenWords: boolean;
  /**
   * Calculation notes: a line that ends in "=" is read on this device and its
   * answer offered beside it, written only on a tap (view/calc-notes.ts).
   * On by default (Joost, 2026-10-25: every Grape now reads maths).
   */
  calcNotes: boolean;
  /**
   * The vault path of a handwriting model file to read with instead of the
   * downloaded Grape (a model tuned to one writer). Blank for Grape.
   */
  hwrModelPath?: string;
  /** The model learned from the user's practice page, when there is one. */
  handwritingModel?: LearnedModel;
  /** The model learned from Grape 2.0. */
  grape2Model?: LearnedModel;
  /** The model before the last learning (`personal-prev.bin`), kept to go back to. */
  grape2ModelPrevious?: LearnedModel;
  handwritingModelPrevious?: LearnedModel;
  /**
   * Read with the learned model when its file is here (on unless switched
   * off); off reads with Grape alone and keeps the file.
   */
  useLearnedHandwriting?: boolean;
  /**
   * How many words were corrected at the last reminder to learn again, or
   * when learning last started (learned-model.ts `relearnDue`).
   */
  relearnRemindedAt?: number;
  /** Where the practice notebook was written. */
  practiceNotebookPath?: string;

  // Transcribing recordings on this device (audio/speech-models.ts).
  /** The speech model: "whisper-tiny", "whisper-base" or (not on mobile) "whisper-small". */
  speechModel?: string;
  /** The spoken language as an ISO 639-1 code, or "auto" to detect it. */
  speechLanguage?: string;

  // Dark pages (#25): a view setting. What is stored never changes.
  /** Light pages, dark pages, or following Obsidian's theme. Checked where it is read. */
  pageAppearance: PageAppearance;
  /** With dark pages, PDF pages are inverted too; off, they are shown as they are. */
  invertPdfPages: boolean;
  /** Export as PDF leaves the cover tapes out, so what is under them shows. */
  exportWithoutTapes: boolean;
  /** The desk around the pages: as the page appearance has it, light, dark, or `deskColor`. */
  desk: DeskChoice;
  /** The desk's colour when `desk` is `"custom"`, `#rrggbb`. Checked where it is read. */
  deskColor: string;
  /** Export as PDF leaves out the paper's lines, grid, dots and texture. */
  exportPlainPaper: boolean;
  /** The export dialog's format, as last picked: PDF, PNG or JPG. Checked where it is read. */
  exportFormat: ExportFormat;

  // Pens and shortcuts (FineNotes#24, #25).
  /** Up to eight saved pens, for the toolbar's favourites and the keys 1 to 8. Checked where read. */
  savedPens: SavedPen[];
  /**
   * The tools the bar shows, left to right ("Customize toolbar"); the rest wait
   * in its More tools menu, except those in `toolbarOff`.
   */
  toolbarItems: BarItemId[];
  /** The tools shown nowhere, neither on the bar nor in its menu (`toolbar-layout.ts`). */
  toolbarOff: BarItemId[];
  /** The pen last written with, which every notebook opens with. Checked where it is read. */
  lastPen?: SavedPen;
  /** What a tablet pen's barrel button does: erase, lasso, pan, or nothing. Checked where read. */
  barrelButton: BarrelAction;
  /**
   * What a click of that button does with the pen in the air, not writing:
   * open the pen menu (and close it again), or nothing. Checked where read.
   */
  stylusButtonClick: StylusClickAction;
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
   * The highlighter's tip: round, or a flat chisel that draws a level
   * highlight as a band with square ends (`ink/chisel.ts`). Each stroke
   * keeps the tip it was written with (`Stroke.tip`). Absent: round.
   */
  highlighterTip?: HighlighterTip;
  /**
   * Stylus-only mode: every pointer but the pen is ignored on the page, so
   * a hand resting on the glass moves neither the ink nor the page.
   */
  onlyStylusMode: boolean;
  /**
   * "Hide pen options while writing": the pen's options pill tucks away as
   * soon as the pen or highlighter writes, as a second tap on its button
   * does, until the pen is tapped or until it lifts (`tool-return.ts`). A
   * switch before (true is until tapped); checked where read.
   */
  tuckPenOptionsOnWrite: PenOptionsOnWrite;
  /** Page px added after a Zoom box line; negative lets taller boxes overlap. */
  zoomBoxLineStep: number;
  /** Move the Zoom box right (then wrap) after a stroke reaches its threshold. */
  zoomBoxAutoAdvance: boolean;
  /** Percentage of the box's right edge that triggers auto-advance. */
  zoomBoxAutoAdvanceThreshold: number;
  /**
   * The Magnifier's mode, remembered: true makes its button open a Zoom box
   * in one tap, the tool in hand kept (`magnifierTap`); false zooms the page.
   */
  magnifierZoomBox: boolean;
  /**
   * "Grey out while erasing", the eraser's mode list: Whole stroke and By
   * line draw what they take grey until the pen lifts, as Notability does,
   * instead of hiding it (discussion #51). Off by default; read through
   * {@link greyWhileErasingOf}.
   */
  greyWhileErasing: boolean;

  /**
   * The settings tab's sections shown open, by id; every other one is
   * folded. Checked where read ({@link openSectionsOf}). It replaced
   * `foldedSettingsSections` (2026-10-21, the compact settings), which is
   * dropped on load, so everyone starts with every section folded.
   */
  settingsOpen: string[];
  /** The iPad's "switch off Scribble" tip was dismissed with its ✕. */
  scribbleTipDismissed: boolean;

  /**
   * The calculator's switches and its history per notebook path. Checked
   * where read (`parseCalculatorData`, model/calculator-store.ts).
   */
  calculator?: unknown;
}

// The records are copies, so a host that edits its settings in place cannot
// change the shared defaults.
export const DEFAULT_SETTINGS: GoodObsidianSettings = {
  drawAndHold: true,
  snapMode: "hold",
  snapCurvatureThreshold: 50,
  defaultTool: "pen",
  customColors: [],
  defaultColor: PALETTE[0],
  laserDefaultColor: "#ff3b30",
  defaultSize: SIZES[1],
  eraserMode: "standard",
  eraserSize: DEFAULT_ERASER_SIZE,
  eraserFilter: "all",
  lassoMode: "freehand",
  lassoFilter: { ...DEFAULT_LASSO_FILTER },
  lassoTouches: true,
  highlighterAlpha: DEFAULT_HIGHLIGHTER_ALPHA,
  paperWidth: DEFAULT_PAPER_WIDTH,
  newNotebookFolder: "",
  lastNotebookChoices: null,
  lastNotebookTemplate: null,
  recognitionProviderId: MANUAL_PROVIDER_ID,
  desynchronizedCanvas: true,
  debugHud: false,
  scribbleNoticeShown: false,
  lastSeenVersion: "",
  checkForUpdates: true,
  updateReminders: true,
  llmVendor: "anthropic",
  llmModel: "",
  openRouterSkipCompressed: false,
  llmApiKey: "",
  llmBaseUrl: "",
  llmCustomApiKey: "",
  apiKeys: {},
  imageVendor: "same",
  imageModel: "",
  imageAspect: "square",
  askSaveChats: false,
  askLayout: "window",
  askAttachPage: false,
  cloudConsentGiven: false,
  customConsentGiven: false,
  autoRecognize: false,
  textStyle: { ...DEFAULT_TEXT_STYLE },
  textToolPinned: false,
  textDragSize: false,
  textHintShown: 0,
  textHintDismissed: false,
  shapeHintShown: false,
  penAutoShape: false,
  penGestures: { ...DEFAULT_PEN_GESTURES },
  shapeColor: DEFAULT_SHAPE_COLOR,
  stickerFolder: DEFAULT_STICKER_FOLDER,
  imagesFolder: "",
  recordingsFolder: "",
  transcriptsFolder: "",
  chatsFolder: "",
  exportsFolder: "",
  templateFolder: DEFAULT_TEMPLATE_FOLDER,
  templateGalleryUrl: "",
  recentColors: [],
  pressureWidth: false,
  pencilTilt: false,
  returnToPenOnReselect: false,
  returnToPenAfterUse: false,
  fingerTapUndo: true,
  handwritingOnDevice: true,
  replayInk: true,
  checkHandwrittenWords: false,
  calcNotes: true,
  speechModel: "whisper-base",
  speechLanguage: "auto",
  notebookOwnFolder: true,
  showNewNotebookInContextMenu: true,
  showNewNotebookInExplorer: false,
  folderNotebooks: true,
  pageAppearance: "light",
  invertPdfPages: true,
  exportWithoutTapes: false,
  desk: "auto",
  deskColor: LIGHT_PAPER.desk,
  exportPlainPaper: false,
  exportFormat: "pdf",

  savedPens: defaultSavedPens(),
  toolbarItems: [...DEFAULT_BAR],
  toolbarOff: [],
  barrelButton: "erase",
  stylusButtonClick: "pen-menu",
  penCursor: "ink",
  straightHighlighter: true,
  onlyStylusMode: false,
  tuckPenOptionsOnWrite: "off",
  zoomBoxLineStep: 0,
  zoomBoxAutoAdvance: false,
  zoomBoxAutoAdvanceThreshold: 33,
  magnifierZoomBox: false,
  greyWhileErasing: false,

  settingsOpen: [],
  scribbleTipDismissed: false,
};

/** A stored laser colour, or the built-in red when a vault contains bad data. */
export function laserDefaultColorOf(raw: unknown): string {
  return typeof raw === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)
    ? raw
    : DEFAULT_SETTINGS.laserDefaultColor;
}

// --- Settings sections -----------------------------------------------------------

/**
 * The settings tab's sections, by the id `settingsOpen` keeps. Ids, not
 * headings, so a renamed heading keeps its state.
 */
export const SETTINGS_SECTIONS = [
  "writing",
  "shortcuts",
  "pages",
  "on-device",
  "ai",
  "advanced",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

function isSection(value: unknown): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly unknown[]).includes(value);
}

/**
 * The open sections a stored value names, in the tab's order, once each.
 * Anything but a list (a missing key, a hand-edited file) opens none; ids
 * this build does not know are dropped.
 */
export function openSectionsOf(raw: unknown): SettingsSection[] {
  if (!Array.isArray(raw)) return [];
  return SETTINGS_SECTIONS.filter((id) => raw.includes(id));
}

/**
 * Whether `id` is shown open. `alone`: one section open at a time (on an
 * iPad or a phone), so of several stored open (synced from a computer) only
 * the first is.
 */
export function sectionOpen(raw: unknown, id: SettingsSection, alone = false): boolean {
  const open = openSectionsOf(raw);
  return alone ? open[0] === id : open.includes(id);
}

/** The open sections with `id` opened or folded; `alone`: opening it folds the rest. */
export function withSection(
  raw: unknown,
  id: SettingsSection,
  open: boolean,
  alone = false,
): SettingsSection[] {
  if (!isSection(id)) return openSectionsOf(raw);
  if (open && alone) return [id];
  const rest = openSectionsOf(raw).filter((section) => section !== id);
  return open ? SETTINGS_SECTIONS.filter((s) => s === id || rest.includes(s)) : rest;
}

// --- The eraser ------------------------------------------------------------------

/**
 * Whether the Whole stroke and By line erasers grey what they take. Only a stored
 * `true` turns it on: a missing key (every vault before it) or a hand-edited
 * value of any other kind leaves the eraser hiding strokes, as it always did.
 */
export function greyWhileErasingOf(raw: unknown): boolean {
  return raw === true;
}

// --- Choices that set two switches -------------------------------------------------

/** "Back to the pen": the two return-to-pen switches as one choice. */
export type ReturnToPen = "never" | "reselect" | "after-use" | "both";

export function returnToPenOf(
  settings: Pick<GoodObsidianSettings, "returnToPenOnReselect" | "returnToPenAfterUse">,
): ReturnToPen {
  const reselect = settings.returnToPenOnReselect === true;
  const afterUse = settings.returnToPenAfterUse === true;
  if (reselect && afterUse) return "both";
  if (reselect) return "reselect";
  return afterUse ? "after-use" : "never";
}

export function storeReturnToPen(settings: GoodObsidianSettings, choice: unknown): void {
  settings.returnToPenOnReselect = choice === "reselect" || choice === "both";
  settings.returnToPenAfterUse = choice === "after-use" || choice === "both";
}

/**
 * The settings the pen's menu holds beside the pen in hand's own: "Make
 * shapes" and its curve bar (Pen gestures, and the Auto shape button), and
 * "Hide pen options while writing" and "Back to the pen" (Pen settings).
 * They are the same for every pen.
 */
export interface PenPreferences {
  snapMode: SnapMode;
  /** {@link GoodObsidianSettings.highlighterTip}. */
  highlighterTip: HighlighterTip;
  /** {@link GoodObsidianSettings.snapCurvatureThreshold}. */
  snapCurve: number;
  tuckOnWrite: PenOptionsOnWrite;
  returnToPen: ReturnToPen;
}

/** The highlighter's tips, as the pen menu offers them. */
export type HighlighterTip = "round" | "chisel";

/** A stored tip; anything but the chisel is round. */
export function highlighterTipOf(value: unknown): HighlighterTip {
  return value === "chisel" ? "chisel" : "round";
}

const SNAP_MODES: readonly SnapMode[] = ["disabled", "hold", "auto"];

export function isSnapMode(value: unknown): value is SnapMode {
  return typeof value === "string" && SNAP_MODES.includes(value as SnapMode);
}

/**
 * Read the snapping mode, from the two switches it replaced when a vault
 * has none yet: `penAutoShape` (on lift) and `drawAndHold` (on hold).
 */
export function snapModeOf(settings: {
  snapMode?: unknown;
  drawAndHold?: unknown;
  penAutoShape?: unknown;
}): SnapMode {
  if (isSnapMode(settings.snapMode)) return settings.snapMode;
  if (settings.penAutoShape === true) return "auto";
  return settings.drawAndHold === false ? "disabled" : "hold";
}

/** The curve bar's value, 10–100 in steps of 5; anything else reads as the default 50. */
export function snapCurveOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(10, Math.round(value / 5) * 5));
}

/** Set the snapping mode, and the two old switches that mirror it. */
export function storeSnapMode(
  settings: Pick<GoodObsidianSettings, "snapMode" | "drawAndHold" | "penAutoShape">,
  mode: SnapMode,
): void {
  settings.snapMode = mode;
  settings.drawAndHold = mode !== "disabled";
  settings.penAutoShape = mode === "auto";
}

/**
 * After loading: a vault from before "Make shapes" takes its mode from the
 * two switches it replaced (`saved` is the file as read); from then on
 * those only mirror it.
 */
export function loadSnapSettings(
  settings: GoodObsidianSettings,
  saved: Partial<Record<keyof GoodObsidianSettings, unknown>>,
): void {
  storeSnapMode(settings, snapModeOf(saved));
  settings.snapCurvatureThreshold = snapCurveOf(saved.snapCurvatureThreshold);
}

export function penPreferencesOf(
  settings: Pick<
    GoodObsidianSettings,
    | "snapMode"
    | "snapCurvatureThreshold"
    | "drawAndHold"
    | "penAutoShape"
    | "tuckPenOptionsOnWrite"
    | "returnToPenOnReselect"
    | "returnToPenAfterUse"
    | "highlighterTip"
  >,
): PenPreferences {
  return {
    snapMode: snapModeOf(settings),
    highlighterTip: highlighterTipOf(settings.highlighterTip),
    snapCurve: snapCurveOf(settings.snapCurvatureThreshold),
    tuckOnWrite: penOptionsOnWriteOf(settings.tuckPenOptionsOnWrite),
    returnToPen: returnToPenOf(settings),
  };
}

/** Store what the pen's menu changed; what `patch` leaves out stays as it is. */
export function storePenPreferences(
  settings: GoodObsidianSettings,
  patch: Partial<PenPreferences>,
): void {
  if ("snapMode" in patch) storeSnapMode(settings, snapModeOf({ snapMode: patch.snapMode }));
  if ("snapCurve" in patch) settings.snapCurvatureThreshold = snapCurveOf(patch.snapCurve);
  if ("tuckOnWrite" in patch) {
    settings.tuckPenOptionsOnWrite = penOptionsOnWriteOf(patch.tuckOnWrite);
  }
  if ("returnToPen" in patch) storeReturnToPen(settings, patch.returnToPen);
  if ("highlighterTip" in patch) settings.highlighterTip = highlighterTipOf(patch.highlighterTip);
}

/** The vault-wide folders for each kind of file, as `resolveAttachmentFolder` takes them. */
export function attachmentDefaults(
  settings: Pick<
    GoodObsidianSettings,
    "imagesFolder" | "recordingsFolder" | "transcriptsFolder" | "chatsFolder" | "exportsFolder"
  >,
): Record<AttachmentKind, string> {
  return {
    images: settings.imagesFolder,
    audio: settings.recordingsFolder,
    transcripts: settings.transcriptsFolder,
    chats: settings.chatsFolder,
    exports: settings.exportsFolder,
  };
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

/** The desk choice `desk` holds, or "auto" for anything it does not know. */
export function deskChoiceOf(desk: unknown): DeskChoice {
  return desk === "light" || desk === "dark" || desk === "custom" ? desk : "auto";
}

/**
 * The desk colour `desk` and `deskColor` ask for, or `null` for the page
 * appearance's own desk. A custom colour that is not a colour is `null` too.
 */
export function deskColorOf(
  settings: Partial<Pick<GoodObsidianSettings, "desk" | "deskColor">>,
): string | null {
  switch (settings.desk) {
    case "light":
      return LIGHT_DESK;
    case "dark":
      return DARK_PAPER.desk;
    case "custom":
      return typeof settings.deskColor === "string" ? parseHexColor(settings.deskColor) : null;
    default:
      return null;
  }
}

/**
 * The paper theme notebooks and page embeds are shown in, by the dark pages
 * settings, the desk setting and Obsidian's theme. A view setting only:
 * export, printing and AI reading always paint `paperTheme(false)`.
 *
 * Page appearance and Dark PDF pages are two settings, and neither changes
 * the other (FineNotes#67): while they were one dropdown, picking Match
 * Obsidian after "Dark, PDFs as they are" turned PDFs dark again.
 */
export function shownPaperTheme(
  settings: Pick<GoodObsidianSettings, "pageAppearance" | "invertPdfPages"> &
    Partial<Pick<GoodObsidianSettings, "desk" | "deskColor">>,
  obsidianDark: boolean,
): PaperTheme {
  const dark = pagesAreDark(settings.pageAppearance, obsidianDark);
  // "With the pages" sets them apart: dark pages lie on the grey desk light
  // ones do, not on their own nearly black one (Joost, 2026-10-31).
  const desk = deskColorOf(settings) ?? (dark ? LIGHT_PAPER.desk : null);
  return withDesk(paperTheme(dark, settings.invertPdfPages === false), desk);
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
 * a model id is stored without the spaces a paste brings along. "Read with
 * my learned model" is on until switched off, so a file without the key
 * reads with it.
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
  useLearnedHandwriting: { show: (on) => on !== false, store: (on) => on === true },
  tuckPenOptionsOnWrite: { show: penOptionsOnWriteOf, store: penOptionsOnWriteOf },
  // Anything it does not know is light, as `pagesAreDark` reads it.
  pageAppearance: { show: pageAppearanceOf, store: pageAppearanceOf },
  invertPdfPages: { show: (on) => on !== false, store: (on) => on !== false },
};

/** A stored page appearance, with anything unknown read as light. */
export function pageAppearanceOf(value: unknown): PageAppearance {
  return value === "dark" || value === "system" ? value : "light";
}

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
    key === "pressureWidth" ||
    key === "speechModel" ||
    key === "useLearnedHandwriting"
  );
}
