/**
 * The notebook view: one ink note (`.notebook.md`, `.page.md`, or the older
 * `.ink.md`) open in a tab. Obsidian reads and writes the file; this view
 * turns its text into a notebook and back, and puts the pieces on screen:
 *
 *   .goodobsidian-view                the tab's content
 *     .goodobsidian-toolbar           tools and actions (toolbar.ts)
 *     .goodobsidian-body              a row:
 *       .goodobsidian-pagesidebar       page thumbnails, shown on request (page-sidebar.ts)
 *       .goodobsidian-surface           the pages themselves (ink-surface.ts)
 *     .goodobsidian-textpanel         the note's Markdown text layer (text-panel.ts)
 *
 * Drawing, erasing, selecting and zooming belong to the surface. What stays
 * here is what concerns the file and the note as a whole: loading and saving
 * (with the guard in load-guard.ts), the text layer, transcription and the
 * AI menu, pages, pictures, scans and export.
 */

import { SetFurniture, furnitureText } from "../model/furniture";
import { SetPageTab, nextTabColor } from "../model/page-tabs";
import { SAVED_STICKERS_COLLECTION } from "./sticker-modal";
import { stickerFolderOf } from "../model/stickers";
import { templateFolderOf } from "../model/vault-folders";
import { readShapeToolStyle } from "../model/shape-style";
import { notebookKeyScope } from "./notebook-keys";
import { Notice, Platform, TextFileView, TFile, type WorkspaceLeaf, normalizePath } from "obsidian";
import {
  AUTO_RECOGNIZE_IDLE_MS,
  DEVICE_READ_IDLE_MS,
  DEVICE_READ_NEXT_MS,
  DEVICE_READ_OPEN_MS,
  ICON_INK_VIEW,
  PALETTE,
  SIZES,
  VIEW_TYPE_INK,
} from "../constants";
import {
  type AttachmentKind,
  type InkDocument,
  type PageComment,
  type Page,
  type TextBoxElement,
  emptyDocument,
} from "../model/document";
import { DocumentEncoder, buildInkFile, parseInkFile } from "../model/serialize";
import { BackgroundSaver } from "./background-save";
import type { RecognitionProvider } from "../recognition/provider";
import { MANUAL_PROVIDER_ID } from "../recognition/manual";
import { readTextSection, writeTextSection } from "../recognition/text-layer";
import {
  type TranscriptUpdate,
  hasAskableContent,
  hasTranscribableContent,
  pageContentHash,
  pageKeys,
  transcriptHashes,
  transcriptSources,
  renamedLinkTargets,
  syncLinkIndex,
  updatePageTranscripts,
} from "../recognition/page-transcripts";
import { adoptTaskStates, notebookTasks, syncTaskIndex } from "../recognition/task-index";
import { makeTask } from "../model/tasks";
import { type RenderedPage, renderPageForAi } from "../recognition/page-render";
import { type DeviceReading, aiKeyFolded, buildAiMenu } from "../recognition/ai-menu-model";
import { learnedRecord, practiceFiles, writePracticePage } from "./handwriting-learning";
import { CalcNotes } from "./calc-notes";
import {
  type ChatImage,
  type ChatTurn,
  buildAskSystemPrompt,
  buildAskToolsPrompt,
} from "../recognition/ai-chat";
import { type AskToolCall, searchResultText } from "../recognition/ask-tools";
import { generatedImageName } from "../recognition/ai-image";
import { nextElementId, textBoxFrame } from "../recognition/ai-placement";
import {
  type AskToolOutcome,
  type GeneratedPicture,
  askAi,
  askAiWithTools,
  generateImage,
  targetLabel,
} from "../recognition/ai-client";
import { InkSurface } from "./ink-surface";
import { PdfBackdropCache } from "./pdf-backdrop";
import { PdfTextCache } from "./pdf-text-source";
import { acquirePdfWorker, releasePdfWorker } from "./pdf-worker";
import { vaultPathFromDrop } from "../model/file-drop";
import { measurePdfPages } from "./pdf-pages";
import { VaultPaperLibrary, templateNamesIn } from "./paper-library-host";
import { renderPageThumbnail } from "../canvas/renderer";
import {
  PAPER_COPY_PREFIX,
  type PaperEntry,
  existingCopy,
  paperBackdrop,
  paperGeometry,
  paperName,
} from "../model/paper-library";
import { PdfImportModal, VaultPdfSuggestModal } from "./pdf-import-modal";
import { WriteHold } from "./write-hold";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import { VaultImageCache } from "./image-cache";
import {
  measureImage,
  pickImageFile,
  prepareImageBytes,
  saveImageAttachment,
} from "./image-import";
import { copyPictureToSystemClipboard } from "./picture-clipboard";
import {
  ImageMenuPopover,
  type ImageMenuContext,
  type InsertImageOptions,
  imageMenuEntries,
} from "./image-menu";
import { isImagePath, mimeForExtension, normalizeMime } from "../canvas/image-raster";
import { newImageElement, nextImageId, placeImageBox } from "../model/images";
import { STICKY_SIDE, newStickyNote, stickyBoxAt } from "../model/sticky-notes";
import type { BarItemId } from "./toolbar-layout";
import { CustomizeToolbarModal } from "./customize-toolbar-modal";
import { needsNewerReader } from "../model/format-features";
import type { ImageElement, PageSection } from "../model/document";
import { ScanSheet } from "./scan-sheet";
import type { ScanItem } from "./scan-io";
import { type SavedItem, buildScanInsert, scanFileName } from "../model/scan-commands";
import { AiMenuPopover } from "./ai-menu";
import {
  type CalculatorHost,
  CalculatorPopover,
  drawGraphMath,
  graphStateFor,
} from "./calculator-popover";
import { parseCalculatorData, windowOf, withWindow } from "../model/calculator-store";
import { GraphWindow } from "./graph-window";
import { centredOrigin } from "../model/calculator-keys";
import {
  AddGraph,
  EditGraph,
  GRAPH_DEFAULT_H,
  GRAPH_DEFAULT_W,
  graphFrameHeight,
  graphFromSpec,
  nextGraphId,
  specOfGraph,
} from "../model/graph-element";
import type { GraphElement } from "../model/document";
import type { GraphSpec } from "../model/graph";
import { type Stroke } from "../model/document";
import { AddStrokeToPage } from "../model/page-commands";
import { AddTable } from "../model/table-commands";
import { setCellText } from "../model/table";
import { nextTableId } from "../model/table";
import { makeTable } from "../model/table";
import { presetGeometry } from "../ink/shape-geometry";
import { CommentModal } from "./comment-modal";
import {
  AddComment,
  MAX_COMMENT_LENGTH,
  RemoveComment,
  SetCommentResolved,
  SetCommentText,
  nextCommentId,
} from "../model/comments";
import { type AskAiHost, AskAiModal, AskChatPanel } from "./ask-ai-modal";
import { listChats, readAttachment, readChat, trashChat, writeChat } from "./ask-chats-io";
import {
  type FileKind,
  type FileRow,
  folderRows,
  notebookImages,
  recordingTranscripts,
} from "../model/notebook-files";
import { pdfsBehind } from "../recognition/ask-attachments";
import { chatsFolderFor } from "../recognition/ask-chat-file";
import { type AskPagesResult, AskSession } from "../recognition/ask-session";
import { GenerateImageModal } from "./generate-image-modal";
import { AddPage, type Command, InsertImage, RemovePage } from "../model/commands";
import {
  AddTextBoxToPage,
  ClearPage,
  MovePage,
  duplicatePageAfter,
  pageToInsertAfter,
  type InsertPosition,
  CompositeCommand,
  SetPageBookmark,
  SetPageTemplate,
  insertIndexFor,
  pageFromTemplate,
} from "../model/page-commands";
import { SetPageTitle, SetSection, nextSectionId } from "../model/contents";
import {
  DuplicatePages,
  MovePages,
  RemovePages,
  isNoOpBlockMove,
  moveIndexForGap,
} from "../model/page-order";
import { ReceivePages, transferNotice, transferRefusal } from "../model/page-transfer";
import type { TransferReceipt } from "../main";
import { type MoveChoice, MovePagesModal } from "./move-pages-modal";
import { ConfirmModal } from "../ui/confirm-modal";
import {
  externalUrl,
  isExternalTarget,
  linkStrokes,
  linkTargets,
  renameLinkTargets,
} from "../model/links";
import { LinkSuggestModal } from "./link-modal";
import { inkForReading, readingText } from "./handwriting";
import { type HandwrittenLink, findHandwrittenLinks } from "../recognition/handwritten-links";
import type { PageReading } from "../recognition/hwr/recognizer";
import { type ReadWord, readWords, strokeKey } from "../recognition/hwr/corrections";
import { type ReadLine, lineHits, pageHits, searchMatchTarget } from "../search/hit-strokes";
import { inkBounds } from "../model/tasks";
import {
  type LexiconSuggestion,
  SUGGEST_MARGIN,
  replaceCore,
  wordCore,
} from "../recognition/hwr/lexicon";
import {
  editedWords,
  matchCase,
  selectionWords,
  wordsByLine,
} from "../recognition/hwr/selection-words";
import type { SpellingFix } from "./spelling-row";
import type { WordPopover } from "./word-popover";
import { nextDeviceStep } from "../recognition/device-reading";
import type { LinkableNote } from "../search/link-choices";
import {
  type Backdrop,
  type PageGeometry,
  type SyntheticBackdrop,
  isCoverRuling,
} from "../model/document";
import { paperPageFor, paperTemplateFor, parseRecent, pushRecent } from "../model/templates";
import { SetSingle, changeCover } from "../model/notebook-commands";
import { isBoard } from "../model/board";
import { resolveAttachmentFolder } from "../model/attachment-folders";
import { relinkDocument } from "../model/moved-files";
import { SetScrollDirection, scrollDirectionOf } from "../model/scroll-direction";
import { type NotebookInfo, NoteSettingsModal } from "./note-settings-modal";
import { SetReadOnly, isReadOnly } from "../model/read-only";
import { coverColorOfDocument, notebookName, renamePlan } from "../model/notebook-info";
import { ExportPdfModal } from "./export-modal";
import { penGesturesOf } from "../ink/pen-gestures";
import { NotebookSearchModal } from "./search-modal";
import {
  type PageText,
  collectPageText,
  searchPages,
  pageFromSubpath,
  pageInThisNotebook,
  folderNotebookSidecarPath,
  transcriptSidecarPath,
} from "../search/notebook-search";
import { pageLinkLabel } from "./page-embed-model";
import { type PdfExportSources, exportPagesToPdf, paintPagePreview } from "./pdf-export";
import { exportBaseName } from "../export/page-range";
import { normalizeFolder, stripInkSuffix, uniqueFileName } from "../model/new-notebook";
import { TEMPLATE_EXTENSION, buildTemplatePackage } from "../import/template-package";
import { SaveTemplateModal, type TemplateDetails } from "./template-ui";
import { MorePanel } from "./more-panel";
import { ShortcutsModal } from "../ui/shortcuts-modal";
import { ContentsTitleModal } from "./contents-title-modal";
import { TaskModal } from "./task-modal";
import { InkTextModal } from "./ink-text-modal";
import { sanitizeTextStyle, textStyleOf } from "../model/text-style";
import { DEFAULT_SHAPE_COLOR, parseHexColor, recentColorsOf } from "../model/colors";
import { AddPagePopover, TemplatePickerModal } from "./template-picker";
import { CoverPopover } from "./cover-picker";
import { type PaperTheme, paperTheme } from "../canvas/backdrop";
import { lassoFilterOf, lassoModeOf } from "../canvas/lasso";
import { rulerSettingsOf } from "../canvas/ruler-geometry";
import { eraserFilterOf } from "../ink/stroke-eraser";
import {
  type PageAction,
  PageSidebar,
  type PageSidebarRenderOptions,
  thumbnailRasterScale,
  type SectionAction,
  type SelectionAction,
} from "./page-sidebar";
import { PEN_TYPES, Toolbar, type ToolbarState, penOfState, penTypeFor } from "./toolbar";
import type { PillDock } from "./pill-dock-model";
import { penInksOf } from "../model/pen-inks";
import { penStabilizationOf } from "../model/pen-stabilization";
import { addSavedPen, openingTool, savedPenOf, savedPensOf } from "../model/saved-pens";
import { PANEL_SLIDE_MS, type PageSnapshot } from "./motion";
import {
  type LastPages,
  forgetInLastPages,
  lastPageIndex,
  parseLastPages,
  rememberPage,
  renameInLastPages,
} from "../model/last-page";
import { NoteAudio } from "./note-audio";
import { LoadGuard } from "./load-guard";
import { TextPanel } from "./text-panel";
import type GoodObsidianPlugin from "../main";
import type { GoodObsidianSettings } from "../settings";
import { attachmentDefaults, shownPaperTheme } from "../settings-data";
import { penCursorStyleOf } from "./pen-cursor";
import { errorMessage } from "../util/errors";
import { writeSystemText } from "./system-clipboard";
import { obsidianOpenUri } from "../model/home-link";

/** Quiet time after the page being read changes before it is remembered. */
const LAST_PAGE_DEBOUNCE_MS = 500;

/** Shown when an edit is refused because the note's load was held. */
const READ_ONLY_NOTICE = "FineNotes: this notebook is read-only until its ink loads cleanly.";
/** How long the page in view must stay before it is checked for misread words, ms. */
const WORD_CHECK_WAIT_MS = 1500;
/** How long after one "this notebook is read-only" notice the next may show, ms. */
const READ_ONLY_NOTICE_MS = 4000;
/** How long after a notebook opens "Update available" appears, ms: once the bar is laid out. */
const UPDATE_TIP_DELAY_MS = 1500;

/** Shown once when a load is held (see load-guard.ts). */
const HELD_LOAD_NOTICE =
  "FineNotes: this notebook's ink did not load, perhaps because the file has not " +
  "finished syncing. Nothing on disk has changed. The notebook stays read-only until it " +
  "loads cleanly: reopen it once the sync is done.";

/** The same, for a notebook a newer FineNotes wrote with something this one cannot keep. */
const NEWER_FORMAT_NOTICE =
  "FineNotes: this notebook uses something a newer FineNotes added. It stays read-only " +
  "here, so nothing in it is lost: update FineNotes to edit it.";

/**
 * The tools as the settings left them, for a view that has just opened: the
 * pen last written with, in any notebook (FineNotes#24), else the defaults.
 */
function toolStateFrom(s: GoodObsidianSettings): ToolbarState {
  const last = savedPenOf(s.lastPen);
  // Without a last pen, a notebook opens with the Fountain pen, a pressure pen.
  const spec = PEN_TYPES.find((type) => type.id === last?.type) ?? PEN_TYPES[0];
  const inks = penInksOf(s.penInks);
  return {
    tool: openingTool(s.defaultTool, last),
    color: last?.color ?? s.defaultColor,
    size: last?.size ?? s.defaultSize,
    penType: last?.type,
    pressureEnabled: s.pressureWidth && spec.pressure,
    shapeSnapEnabled: s.drawAndHold,
    eraserMode: s.eraserMode,
    eraserSize: s.eraserSize,
    eraserFilter: eraserFilterOf(s.eraserFilter),
    lassoMode: lassoModeOf(s.lassoMode),
    lassoFilter: lassoFilterOf(s.lassoFilter),
    textStyle: sanitizeTextStyle(s.textStyle),
    textPinned: s.textToolPinned === true,
    textDragSize: s.textDragSize === true,
    penAutoShape: s.penAutoShape === true,
    penGestures: penGesturesOf(s.penGestures),
    shapeColor: parseHexColor(s.shapeColor ?? "") ?? DEFAULT_SHAPE_COLOR,
    shapeStyle: readShapeToolStyle(s.shapeStyle),
    tableHeader: s.tableHeader === true,
    recentColors: recentColorsOf(s.recentColors),
    // The pen in hand's row is its own, when it has one (model/pen-inks.ts).
    penColors: inks[spec.id]?.colors ?? (Array.isArray(s.penColors) ? [...s.penColors] : undefined),
    penInks: inks,
    penStabilization: penStabilizationOf(s.penStabilization),
    rulerKind: rulerSettingsOf(s.ruler).kind,
    rulerSnap: rulerSettingsOf(s.ruler).snap,
  };
}

/** What this device is, for a practice file's training data: "ipad", "android", "mac"… */
function deviceKind(): string {
  if (Platform.isIosApp) return Platform.isTablet ? "ipad" : "iphone";
  if (Platform.isAndroidApp) return Platform.isTablet ? "android-tablet" : "android";
  if (Platform.isMacOS) return "mac";
  if (Platform.isWin) return "windows";
  if (Platform.isLinux) return "linux";
  return "unknown";
}

/** The Files tab's kind, for every notebook opened in this session. */
let lastFileKind: FileKind = "recordings";

/** A page's latest reading on this device, for lassoed ink (`readSelection`). */
interface PageWords {
  hash: string;
  words: ReadWord[];
  /** Every stroke on its read lines, and each line's text. */
  read: Set<string>;
  lines: string[];
  /** Each line's text and its ink's word groups, for search to find words in (2.5.1). */
  readLines: ReadLine[];
  /** The worker's id for it, while it keeps its log-probabilities. */
  id?: number;
}

/** What lassoed ink says, for a dialog's field. */
interface SelectionText {
  text: string;
  /** Words the ink may say otherwise (spelling-row.ts). */
  fixes: SpellingFix[];
  /** The page's read words it was taken from; empty when read afresh. */
  words: ReadWord[];
}

/** A page's words as last read, for its underlines (`checkWords`). */
interface CheckedPage {
  hash: string;
  words: ReadWord[];
  /** By stroke key: the list words a flagged word's ink fits best. */
  suggestions?: Map<string, LexiconSuggestion | null>;
}

export class InkView extends TextFileView {
  /** The notebook on screen; a blank one until a file has loaded. */
  private doc: InkDocument;
  /** The note's Markdown outside the ink block: frontmatter, prose, text layer. */
  private noteBody = "";
  /** Whether the note may be saved over, and what to save while it may not. */
  private readonly guard = new LoadGuard();

  /** True from `onOpen` to `onClose`, while the view's DOM exists. */
  private mounted = false;
  /** When the last "this notebook is read-only" notice showed, ms. */
  private readOnlyNoticeAt = 0;
  private surface: InkSurface | null = null;
  /** Lines ending in "=" answered on a tap (off unless the setting is on). */
  private readonly calcNotes: CalcNotes;
  private toolbar: Toolbar | null = null;
  private sidebar: PageSidebar | null = null;
  /** The ⋯ panel, while open. */
  private morePanel: MorePanel | null = null;
  /** The keyboard shortcuts pop-up, while it shows. */
  private shortcuts: ShortcutsModal | null = null;
  private addPagePopover: { popover: AddPagePopover; anchor: HTMLElement } | null = null;
  private coverPopover: { popover: CoverPopover; anchor: HTMLElement } | null = null;
  private aiMenu: AiMenuPopover | null = null;
  private calculator: CalculatorPopover | null = null;
  /** The graph popped out of the calculator, floating over the notebook. */
  private graphWindow: GraphWindow | null = null;
  /** The transcription in progress, if any; `cancelled` is set by tapping its notice. */
  private transcription: { cancelled: boolean } | null = null;
  private pdfCache: PdfBackdropCache | null = null;
  /** The PDF pages' text, for the highlighter that snaps to it and for Copy text. */
  private pdfText: PdfTextCache | null = null;
  /** Whether this view holds a use of the shared PDF worker (`acquirePdfWorker`). */
  private pdfWorkerHeld = false;
  /** The search box's last query, for the next search. */
  private lastSearch = "";
  /** A link's `#Page N`, until the pages it names have loaded. */
  private pendingSubpath: string | null = null;
  /** Back/Forward's page (0-based), until the pages have loaded. */
  private pendingPageIndex: number | null = null;
  /** A result of Obsidian's own search, to light up on its page once it shows (2.5). */
  private pendingSearch: { pageIndex: number; query: string } | null = null;
  /**
   * The file this leaf has put on its remembered page. A second load of the
   * same file (a sync touched it) keeps the reader where they are.
   */
  private restoredPath: string | null = null;
  private lastPageTimer = 0;
  /** The file whose data `setViewData` last loaded; `null` after `clear`. */
  private loadedPath: string | null = null;
  private backdrops: VaultBackdropRenderer | null = null;
  /** The same PDFs at thumbnail size, so the sidebar never asks for page-sized rasters. */
  private thumbBackdrops: VaultBackdropRenderer | null = null;
  /**
   * Compresses saves quickly, hands back what was read while nothing
   * changed, and keeps each page's JSON for the background save. Every
   * change to a page must reach it: {@link requestSaveOf} names the pages,
   * and `requestSave` (wrapped in the constructor) counts as all of them.
   */
  private readonly encoder = new DocumentEncoder();
  /** Saves with the main thread kept free (background-save.ts). */
  private readonly saver: BackgroundSaver;
  /** Obsidian's own `requestSave`, which says nothing about what changed. */
  private readonly saveRequest: () => void;
  /** What `getViewData` answers while a background save writes; null otherwise. */
  private preparedContents: string | null = null;
  /** The save cache was found to have missed a change (reported once). */
  private missedReported = false;
  /** Saves and PDF rasterising wait while the pen writes (write-hold.ts). */
  private readonly writeHold = new WriteHold();
  private quietTimer = 0;
  private images: VaultImageCache | null = null;
  /** The Ask AI conversation about this notebook, while it is open (see `askConversation`). */
  private askSession: AskSession | null = null;
  /** Ask in its sidebar, beside the page (the other layout is a window). */
  private chatPanel: AskChatPanel | null = null;
  /** The page sidebar was shut when a pinch opened the overview: shut it again after. */
  private sidebarForOverview = false;
  private imageMenu: { popover: ImageMenuPopover; anchor: HTMLElement } | null = null;
  /** Recording, replay and audio transcription (0.5); see note-audio.ts. */
  private audio: NoteAudio | null = null;
  /** The current tool, colour, size and so on, shared with the toolbar and the surface. */
  private readonly toolState: ToolbarState;

  /** The text layer below the pages, while mounted. */
  private textPanel: TextPanel | null = null;
  /** Whether the text layer is open; outlives the DOM, so a reopened view keeps it. */
  private textPanelOpen = false;

  /** The wait before an automatic transcription (see `scheduleAutoTranscription`). */
  private transcribeTimer = 0;
  /** The next on-device reading for search and the text layer (`scheduleDeviceReading`). */
  private deviceTimer = 0;
  /** A page is being read on the device right now. */
  private deviceBusy = false;
  /**
   * Words read on each page, by page id, with the page hash they were read
   * at: what an underlined word's tap looks up (`checkWords`).
   */
  private readonly checkedWords = new Map<string, CheckedPage>();
  /** Each page's latest reading at its content hash, by page id. */
  private readonly pageReadings = new Map<string, PageWords>();
  /** The card of the underlined word last tapped, while it is open. */
  private wordPopover: WordPopover | null = null;
  /** Stops the gear's update mark following the plugin's check. */
  private unwatchUpdates: (() => void) | null = null;
  /** The wait before the page in view is checked for misread words. */
  private wordCheckTimer = 0;
  /** Pages read on the device this session, by key, at the hash they were read at. */
  private readonly deviceRead = new Map<string, string>();
  /** The pen is on the page. */
  private penIsDown = false;

  /** Whether the input debug overlay is on. */
  private showHud: boolean;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: GoodObsidianPlugin,
  ) {
    super(leaf);
    // Any save asked for without naming pages may follow a change anywhere:
    // every page is serialised again (the save cache's conservative default).
    this.saveRequest = this.requestSave.bind(this);
    this.requestSave = () => {
      this.encoder.touchAll();
      this.saveRequest();
    };
    this.saver = new BackgroundSaver(
      this.encoder,
      {
        target: () => (this.file && !this.guard.locked ? { doc: this.doc, file: this.file } : null),
        body: () => this.syncedBody(),
        write: (contents, behind) => this.writePrepared(contents, behind),
        writeNow: () => super.save(),
        penBusy: () => this.writeHold.writing(performance.now()),
      },
      // Loaded when first needed, as the recogniser's client is.
      async () =>
        typeof Worker === "undefined"
          ? null
          : (await import("./save-worker-client")).startSaveWorker(),
    );
    this.showHud = plugin.settings.debugHud;
    this.doc = this.blankNotebook();
    this.toolState = toolStateFrom(plugin.settings);
    this.calcNotes = new CalcNotes({
      app: this.app,
      reader: plugin.handwriting,
      enabled: () =>
        this.settings.calcNotes === true &&
        this.settings.handwritingOnDevice !== false &&
        !this.isPractice &&
        !this.isProtected(),
      surface: () => this.surface,
      page: (pageId) => this.doc.pages.find((p) => p.id === pageId) ?? null,
      learning: () => plugin.learningHost(),
    });
  }

  /** The plugin's settings, read afresh each time: the settings tab may change them. */
  private get settings(): GoodObsidianSettings {
    return this.plugin.settings;
  }

  /** A notebook with one blank page, at the paper width the settings ask for. */
  private blankNotebook(): InkDocument {
    return emptyDocument(this.settings.paperWidth);
  }

  getViewType(): string {
    return VIEW_TYPE_INK;
  }

  override getIcon(): string {
    return ICON_INK_VIEW;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Notebook";
  }

  /** The note was renamed or moved: a header's `{title}` and the thumbnails follow. */
  override async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
    this.surface?.setNotebookTitle(this.notebookTitle());
    this.updateSidebarRendering();
  }

  // --- Reading and writing the file ------------------------------------------

  /** What Obsidian writes to the file: the note rebuilt, unless its load was held. */
  getViewData(): string {
    if (this.preparedContents !== null) return this.preparedContents;
    const body = this.syncedBody();
    const missed = this.encoder.missed;
    const text = this.guard.contents(() => buildInkFile(body, this.doc, this.encoder));
    if (this.encoder.missed > missed && !this.missedReported) {
      this.missedReported = true;
      console.warn("FineNotes: a page changed without telling the save cache; saved in full.");
    }
    return text;
  }

  /** The note's body, its links list brought up to date. */
  private syncedBody(): string {
    // The text block's links list follows the notebook's handwritten links,
    // so backlinks and the graph see them (FineNotes#20).
    this.noteBody = syncLinkIndex(this.noteBody, linkTargets(this.doc));
    // And its checklist follows the notebook's, for the Tasks plugin (2.5).
    this.noteBody = syncTaskIndex(this.noteBody, notebookTasks(this.doc));
    return this.noteBody;
  }

  /**
   * These pages changed (ids), or anything did when none are named: save,
   * and serialise only those pages again.
   */
  private requestSaveOf(pageIds?: readonly string[]): void {
    if (pageIds) this.encoder.touchIds(this.doc, pageIds);
    else this.encoder.touchAll();
    this.saveRequest();
  }

  /** Only the note's text around the ink changed: save it, with every page as cached. */
  private requestBodySave(): void {
    this.saveRequest();
  }

  /**
   * A background save's result: Obsidian's save writes it, `getViewData`
   * answering with it (Obsidian asks before its first `await`). `behind`:
   * the notebook changed since, so it is marked unsaved again.
   */
  private writePrepared(contents: string, behind: boolean): Promise<void> {
    this.preparedContents = contents;
    let saving: Promise<void>;
    try {
      saving = super.save();
    } finally {
      this.preparedContents = null;
    }
    if (behind) this.saveRequest();
    return saving;
  }

  /** Obsidian read the file (on open, or because it changed on disk). */
  setViewData(data: string, _clear: boolean): void {
    const began = performance.now();
    this.loadViewData(data);
    const kb = Math.round(data.length / 1024);
    this.plugin.startup.timed(`notebook loaded, ${kb} KB`, performance.now() - began);
  }

  private loadViewData(data: string): void {
    const { body, doc, payload, json } = parseInkFile(data, this.settings.paperWidth);
    const held = this.guard.admit({
      text: data,
      bytesOnDisk: this.file?.stat.size ?? 0,
      decoded: doc !== null,
    });
    if (held) {
      const newer = payload !== undefined && needsNewerReader(payload);
      new Notice(newer ? NEWER_FORMAT_NOTICE : HELD_LOAD_NOTICE, 10000);
    }
    this.noteBody = body;
    this.doc = doc ?? this.blankNotebook();
    if (doc && payload !== undefined && !held) this.encoder.remember(payload, json);
    // Files it points at that moved while it was closed (#14), and notes
    // its links lead to that Obsidian renamed in the links list.
    if (doc && !held && this.relinkDoc() + this.adoptRenamedLinks(body) > 0) this.requestSave();
    // Ticks made in the note (the Tasks plugin) since the notebook wrote it.
    if (doc && !held) this.adoptTicks(body);
    this.loadedPath = this.file?.path ?? null;
    this.textPanel?.load(body);
    if (!this.mounted) return;
    this.showDocument();
    this.matchPdfResolution();
    // A recording still running here means the file changed underneath
    // it: it stops, and joins the document now shown.
    this.audio?.documentReplaced();
    this.applyPendingPage();
    // Another notebook, or this one changed on disk: read what is unread.
    this.deviceRead.clear();
    this.scheduleDeviceReading(DEVICE_READ_OPEN_MS);
  }

  /** Relink this note's paths from the plugin's log of moved files; how many changed. */
  private relinkDoc(): number {
    if (this.guard.locked) return 0;
    const log = this.plugin.fileMoves.log();
    if (log.length === 0) return 0;
    const relinked = relinkDocument(this.doc, (path) => this.plugin.fileMoves.relink(path, log));
    // Paths rewritten in place, on any page: nothing else can tell the save cache.
    if (relinked > 0) this.encoder.touchAll();
    return relinked;
  }

  /**
   * Take the targets Obsidian rewrote in the note's links list (a note or
   * heading renamed, with its links updated) into the notebook itself, so a
   * tap still opens them and the next save keeps them; how many changed.
   */
  private adoptRenamedLinks(body: string): number {
    if (this.guard.locked) return 0;
    const renames = renamedLinkTargets(readTextSection(body), linkTargets(this.doc));
    const renamed = renameLinkTargets(this.doc, renames);
    // Targets rewritten in place, on any page: nothing else can tell the save cache.
    if (renamed > 0) this.encoder.touchAll();
    return renamed;
  }

  /**
   * Take ticks made in the note's checklist since the notebook wrote it (by
   * the Tasks plugin, or by hand) into the notebook, and save them in.
   */
  private adoptTicks(body: string): void {
    if (this.guard.locked) return;
    const pages = adoptTaskStates(this.doc, body);
    if (pages.length > 0) this.requestSaveOf(pages);
  }

  /**
   * Files this note points at were moved or renamed (#14): point at their
   * new places, repaint, and save. Also after undo and redo, which can bring
   * back a page background or picture recorded before the move.
   */
  relinkMovedFiles(): void {
    if (this.relinkDoc() === 0) return;
    this.sidebar?.setDocument(this.doc);
    this.sidebar?.invalidate();
    this.surface?.repaint();
    this.audio?.syncChrome();
    this.requestSave();
  }

  /** Hand the current notebook to everything that shows it. */
  private showDocument(): void {
    this.surface?.setDocument(this.doc);
    this.sidebar?.setDocument(this.doc);
    this.syncSingle();
  }

  /**
   * The leaf moves on to another file. A held load stays held until that
   * file's data arrives: `setViewData` is the only thing that judges a read.
   */
  clear(): void {
    // The page this file was left on, before its document goes.
    this.recordLastPage();
    this.restoredPath = null;
    this.loadedPath = null;
    // The worker holds this notebook's pages: let it go with them.
    this.saver.stop();
    this.noteBody = "";
    this.doc = this.blankNotebook();
    if (!this.mounted) return;
    this.showDocument();
    this.audio?.documentReplaced();
  }

  // --- Opening and closing ---------------------------------------------------

  override async onOpen(): Promise<void> {
    this.buildDom();
    this.mounted = true;
    // The file loaded before the view opened: put it on its page now.
    if (this.loadedPath !== null) this.applyPendingPage();
    void this.plugin.maybeShowScribbleNotice();
  }

  /**
   * Before the note goes (the tab closes, or opens another file), finish a
   * running recording so it joins *this* note, and save that.
   */
  override async onUnloadFile(file: TFile): Promise<void> {
    // The conversation was about this notebook's pages.
    this.chatPanel?.close();
    this.askSession = null;
    if (await this.audio?.finishForUnload()) {
      this.encoder.touchAll();
      await this.saveNow(false, true);
    }
    await super.onUnloadFile(file);
  }

  /**
   * Obsidian's save, put off while the pen is writing, and then made in the
   * background (background-save.ts): a stall mid-stroke is ink lost on
   * iPadOS before 18.2 (write-hold.ts). `clear` (the note is closing;
   * Obsidian then clears the view) never waits, and is made on the main
   * thread at once, as it always was. A save put off is made once the pen
   * has been up a moment.
   */
  override async save(clear?: boolean): Promise<void> {
    if (!clear && this.writeHold.holdSave(performance.now())) return;
    await this.saveNow(clear);
  }

  /**
   * Save at once, whatever the pen is doing: in the background, unless the
   * note is closing (`clear`) or `now` says it must be on disk before this
   * returns. A save made now drops any background save still running, whose
   * result would be older.
   */
  private async saveNow(clear?: boolean, now = false): Promise<void> {
    this.writeHold.saved();
    if (clear || now) {
      this.saver.supersede();
      await super.save(clear);
      return;
    }
    await this.saver.save();
  }

  /** The pen touched the page or left it: hold, or let go of, what would stall it. */
  private penActivity(down: boolean): void {
    this.penIsDown = down;
    window.clearTimeout(this.quietTimer);
    this.quietTimer = 0;
    const t = performance.now();
    if (down) {
      this.calcNotes.penDown();
      this.writeHold.penDown(t);
      this.pdfCache?.setHeld(true);
      this.pdfText?.setHeld(true);
      // Should the lift never arrive, let go anyway.
      this.quietTimer = window.setTimeout(() => this.penQuiet(), this.writeHold.quietIn(t));
      return;
    }
    this.writeHold.penUp(t);
    // Waited too long: made now, in the gap between two strokes.
    if (this.writeHold.overdue(t)) void this.saveNow();
    this.quietTimer = window.setTimeout(() => this.penQuiet(), this.writeHold.quietIn(t));
  }

  /** The pen has been up a moment: rasterise what waited, and make the save that did. */
  private penQuiet(): void {
    this.quietTimer = 0;
    this.pdfCache?.setHeld(false);
    this.pdfText?.setHeld(false);
    if (this.writeHold.savePending) void this.saveNow();
  }

  /** Full screen went on or off (the plugin's, for every notebook): the bar's button follows. */
  showFullScreen(on: boolean): void {
    this.toolbar?.setFullScreen(on);
  }

  /** The options pill was moved in some notebook (the plugin's, per device): this one's follows. */
  showPillDock(dock: PillDock): void {
    this.toolbar?.setPillDock(dock);
  }

  /**
   * Stylus-only mode was switched here or through the toolbar: its toggle
   * follows in this notebook. The hand and magnifier are ordinary toolbar
   * items now, so the choice of placing them does not change with the mode.
   */
  setOnlyStylusMode(on: boolean): void {
    this.toolbar?.setOnlyStylusMode(on);
  }

  override async onClose(): Promise<void> {
    this.recordLastPage();
    this.audio?.destroy();
    this.audio = null;
    window.clearTimeout(this.transcribeTimer);
    window.clearTimeout(this.deviceTimer);
    this.deviceTimer = 0;
    window.clearTimeout(this.wordCheckTimer);
    this.wordCheckTimer = 0;
    this.wordPopover?.close();
    this.wordPopover = null;
    window.clearTimeout(this.quietTimer);
    this.quietTimer = 0;
    this.saver.stop();
    this.calcNotes.dispose();
    this.surface?.destroy();
    this.surface = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.unwatchUpdates?.();
    this.unwatchUpdates = null;
    this.sidebar?.destroy();
    this.chatPanel?.destroy();
    this.chatPanel = null;
    this.sidebar = null;
    this.morePanel?.close();
    this.morePanel = null;
    this.shortcuts?.close();
    this.shortcuts = null;
    this.addPagePopover?.popover.close();
    this.addPagePopover = null;
    this.coverPopover?.popover.close();
    this.coverPopover = null;
    this.imageMenu?.popover.close();
    this.imageMenu = null;
    this.aiMenu?.close();
    this.aiMenu = null;
    this.calculator?.close();
    this.calculator = null;
    this.graphWindow?.close();
    this.graphWindow = null;
    if (this.transcription) this.transcription.cancelled = true;
    this.pdfCache?.destroy();
    this.pdfCache = null;
    this.pdfText?.destroy();
    this.pdfText = null;
    if (this.pdfWorkerHeld) {
      this.pdfWorkerHeld = false;
      releasePdfWorker();
    }
    this.backdrops = null;
    this.thumbBackdrops = null;
    this.images?.destroy();
    this.images = null;
    this.textPanel = null;
    this.contentEl.empty();
    this.mounted = false;
  }

  override onResize(): void {
    this.relayout();
  }

  /**
   * Lay the pages out again for the view's size, and put the options pill
   * back inside the page area: it is placed as a fraction of that area, so
   * a resize, an iPad rotation or a theme's different metrics could leave
   * it off-screen.
   */
  private relayout(): void {
    this.surface?.layout();
    this.syncSidebarInset();
  }

  /** Fit the page to the view and go back to the top (the "fit" command). */
  resetView(): void {
    this.surface?.resetView();
  }

  zoomIn(): void {
    this.surface?.zoomIn();
  }

  zoomOut(): void {
    this.surface?.zoomOut();
  }

  /** Show or hide the input debug overlay (the command, and the setting). */
  setDebug(enabled: boolean): void {
    this.showHud = enabled;
    this.surface?.setDebug(enabled);
  }

  /**
   * The cursor over the page for the pens: the ink dot (FineNotes#27), the
   * small crosshair (FineNotes#25) or the arrow. Only on a computer: a
   * finger or the Pencil has no cursor to replace.
   */
  /** Show the tool bar's items `items` ("Customize toolbar", here or in another notebook). */
  setToolbarItems(items: readonly BarItemId[]): void {
    this.toolbar?.setItems(items);
  }

  /** "Customize toolbar": the bar's items, changed live and kept for every notebook. */
  private openCustomizeToolbar(): void {
    const toolbar = this.toolbar;
    if (!toolbar) return;
    new CustomizeToolbarModal(this.app, toolbar.shownItems, toolbar.availableItems, (items) =>
      this.plugin.saveToolbarItems(items),
    ).open();
  }

  /**
   * A sticky note of `color` waits for a tap on a page, which sticks it
   * there (null: it waits no more). The sticky notes button is on meanwhile.
   */
  private armStickyNote(color: string | null): void {
    const surface = this.surface;
    if (!surface || (color !== null && this.isProtected())) return;
    surface.armStickyNote(
      color === null
        ? null
        : (index, at) => {
            this.toolbar?.setStickyArmed(false);
            this.insertStickyNote(color, index, at);
          },
    );
    this.toolbar?.setStickyArmed(color !== null);
  }

  setPenCursor(style: unknown): void {
    this.surface?.setPenCursor(Platform.isMobile ? "arrow" : penCursorStyleOf(style));
  }

  /** Keep the pen in hand for the next notebook, and the next start (FineNotes#24). */
  private rememberPen(): void {
    const tool = this.toolState.tool;
    if (tool !== "pen" && tool !== "highlighter") return;
    this.plugin.saveLastPen(penOfState(this.toolState));
  }

  /** The pressure setting changed: the pen in hand widens with pressure if it is a pressure pen. */
  setPressureWidth(enabled: boolean): void {
    this.surface?.setPressure(enabled && penTypeFor(this.toolState).pressure);
    this.surface?.setInkPressure(enabled);
    this.updateSidebarRendering();
  }

  /** The paper theme the pages are shown in (`shownPaperTheme`). */
  private shownPaper(): PaperTheme {
    return shownPaperTheme(this.settings, this.containerEl.doc.body.hasClass("theme-dark"));
  }

  /** The dark pages settings or Obsidian's theme changed: show the pages as they now say. */
  syncPaperTheme(): void {
    const surface = this.surface;
    if (!surface) return;
    const theme = this.shownPaper();
    if (surface.paperTheme === theme) return;
    surface.setPaperTheme(theme);
    this.updateSidebarRendering();
  }

  /** The recent strokes and the recogniser's verdicts on them, as JSON, for bug reports. */
  exportDiagnostics(): string | null {
    return (
      this.surface?.exportDiagnostics({
        version: this.plugin.manifest.version,
        file: this.file?.path ?? null,
        // A lag after a cold start, pinned without a console (startup-log.ts).
        startup: this.plugin.startup.report(),
      }) ?? null
    );
  }

  /**
   * `RecognitionTarget`, for the transcribe command and for automatic
   * transcription. The command does the whole notebook; an automatic run
   * only the page in view, so that a background pass can never send a
   * request for every page of a long notebook.
   */
  async recognize(engine: RecognitionProvider, background = false): Promise<void> {
    await this.transcribe(engine, background ? "page" : "notebook", background);
  }

  /**
   * Transcribe pages into the text layer, one request per page, in order.
   *
   * Each page's text goes under its own `### Page N` heading inside the
   * managed `<!--goodobsidian-text-->` section and nowhere else, so user prose
   * is never touched (page-transcripts.ts). A page whose content hash matches
   * the one recorded with its transcription is skipped — a repeat costs no
   * request and cannot churn text the user corrected. A page that is now
   * empty loses its entry. Every finished page is written straight away, so
   * stopping (tap the progress notice) or a failure keeps what was done.
   * `auto` mutes everything but failures.
   */
  async transcribe(
    provider: RecognitionProvider,
    scope: "page" | "notebook",
    auto = false,
  ): Promise<void> {
    if (this.guard.locked) {
      if (!auto) new Notice(READ_ONLY_NOTICE);
      return;
    }
    if (this.transcription) {
      if (!auto) new Notice("FineNotes: a transcription is already running.");
      return;
    }
    if (provider.id === MANUAL_PROVIDER_ID) {
      if (!auto) {
        if (!this.textPanelOpen) this.toggleTextPanel();
        new Notice("FineNotes: manual transcription — type it in the text-layer panel.");
      }
      return;
    }

    const doc = this.doc;
    const current = doc.pages[this.surface?.currentPage ?? 0];
    const pages = scope === "page" ? (current ? [current] : []) : [...doc.pages];
    const keys = pageKeys(doc.pages);
    const recorded = transcriptHashes(readTextSection(this.noteBody));
    const cleared: TranscriptUpdate[] = [];
    const work: Page[] = [];
    let unchanged = 0;
    for (const page of pages) {
      const key = keys[doc.pages.indexOf(page)];
      if (!hasTranscribableContent(page)) {
        if (recorded.has(key)) cleared.push({ key, text: "", hash: "" });
        continue;
      }
      // Only a network provider is worth skipping: on-device runs are free.
      if (provider.requiresNetwork && recorded.get(key) === pageContentHash(page)) unchanged++;
      else work.push(page);
    }
    if (cleared.length > 0) this.writeTranscripts(cleared);
    if (work.length === 0) {
      if (!auto) {
        new Notice(
          cleared.length > 0
            ? `FineNotes: cleared the transcription of ${
                cleared.length === 1
                  ? "a page that no longer has any writing"
                  : `${cleared.length} pages that no longer have any writing`
              }.`
            : unchanged > 0
              ? "FineNotes: the transcription is already up to date."
              : "FineNotes: nothing to transcribe yet.",
        );
      }
      return;
    }

    const run = { cancelled: false };
    this.transcription = run;
    const progress = auto ? null : new Notice("FineNotes: transcribing…", 0);
    progress?.messageEl.addEventListener("click", () => {
      run.cancelled = true;
    });
    let done = 0;
    let failure: { page: number; message: string } | null = null;
    try {
      for (const page of work) {
        if (run.cancelled) break;
        const index = this.doc.pages.indexOf(page);
        if (index < 0) continue; // deleted while the others were transcribed
        const count = work.length > 1 ? ` (${done + 1} of ${work.length})` : "";
        progress?.setMessage(`FineNotes: transcribing page ${index + 1}${count}… Tap to stop.`);
        const hash = pageContentHash(page);
        try {
          const image = provider.requiresNetwork ? await this.renderForAi(page) : null;
          const result = await provider.recognize({
            strokes: page.strokes,
            pageImage: image ?? undefined,
            onProgress: (message) => progress?.setMessage(`FineNotes: ${message}`),
          });
          // The note was closed meanwhile: there is no body left to write into.
          if (!this.mounted) break;
          // A result that arrives after "stop" is kept: it is already paid for.
          this.writeTranscripts([{ page, text: result.text, hash }]);
          done++;
        } catch (error) {
          failure = {
            page: index + 1,
            message: errorMessage(error),
          };
          break;
        }
      }
    } finally {
      progress?.hide();
      this.transcription = null;
    }

    if (failure) {
      new Notice(
        `FineNotes: transcription failed on page ${failure.page}: ${failure.message}` +
          (done > 0 ? ` (the ${done} page${done === 1 ? "" : "s"} before it were saved)` : ""),
        10000,
      );
      return;
    }
    if (auto) return;
    if (done > 0 && !this.textPanelOpen) this.toggleTextPanel();
    const skipped =
      unchanged > 0 ? ` ${unchanged} unchanged page${unchanged === 1 ? "" : "s"} skipped.` : "";
    new Notice(
      run.cancelled && done < work.length
        ? `FineNotes: stopped — transcribed ${done} of ${work.length} pages.${skipped}`
        : `FineNotes: transcribed ${done === 1 ? "the page" : `${done} pages`} into the ` +
            `text layer — review and edit it.${skipped}`,
    );
  }

  /**
   * Merge page transcriptions into the managed section, in page order. Accepts
   * either a page (resolved to its key now, as pages may have moved during a
   * long run) or a ready key.
   */
  private writeTranscripts(
    updates: ReadonlyArray<
      TranscriptUpdate | { page: Page; text: string; hash: string; device?: boolean }
    >,
  ): void {
    const keys = pageKeys(this.doc.pages);
    const resolved: TranscriptUpdate[] = [];
    for (const update of updates) {
      if (!("page" in update)) {
        resolved.push(update);
        continue;
      }
      const index = this.doc.pages.indexOf(update.page);
      if (index >= 0) {
        const { text, hash, device } = update;
        resolved.push({ key: keys[index], text, hash, ...(device ? { device } : {}) });
      }
    }
    const section = updatePageTranscripts(readTextSection(this.noteBody), keys, resolved);
    this.noteBody = writeTextSection(this.noteBody, section);
    this.textPanel?.load(this.noteBody);
    this.requestBodySave();
  }

  /** The page as the reader sees it, sized for a vision model. */
  private async renderForAi(page: Page): Promise<RenderedPage | null> {
    if (!this.backdrops) return null;
    return renderPageForAi(page, this.backdrops, {
      usePressure: this.settings.pressureWidth,
      highlighterAlpha: this.settings.highlighterAlpha,
      // Pictures the page shows are part of what the model should see. One
      // not decoded yet (rare: the page being read is on screen) draws as
      // the missing-image box rather than holding the request up.
      ...(this.images ? { images: this.images } : {}),
    });
  }

  // --- AI menu --------------------------------------------------------------

  /** Open the AI menu on `anchor`; a second tap on the same button closes it. */
  private openAiMenu(anchor: HTMLElement): void {
    const open = this.aiMenu;
    this.aiMenu = null;
    if (open?.isOpen) {
      open.close();
      if (open.anchorEl === anchor) return;
    }
    const doc = this.doc;
    const items = buildAiMenu({
      setup: this.plugin.aiSetup(),
      notebookAskable: doc.pages.some(hasAskableContent),
      multiPage: doc.pages.length > 1,
      recordings: doc.recordings?.length ?? 0,
      device: this.deviceReading(),
      transcribing: this.plugin.speech.running?.percent,
    });
    const setup = this.plugin.aiSetup();
    this.aiMenu = new AiMenuPopover(
      anchor,
      items,
      (id) => this.aiActions()[id]?.(),
      aiKeyFolded(setup),
      (id, on) => {
        if (id === "check-words") void this.plugin.setWordChecking(on);
      },
    );
  }

  /**
   * Open the calculator's window, or close it when it is open: the toolbar's
   * calculator button (or its row in ⋯) toggles it, and its cross closes it.
   */
  private toggleCalculator(): void {
    const open = this.calculator;
    this.calculator = null;
    if (open?.isOpen) {
      open.close();
      return;
    }
    this.calculator = new CalculatorPopover(this.contentEl, this.calculatorHost());
  }

  /** What the calculator needs from this notebook. */
  private calculatorHost(): CalculatorHost {
    return {
      path: this.file?.path ?? "",
      load: () => parseCalculatorData(this.settings.calculator),
      save: (data) => this.plugin.saveCalculator(data),
      insert: (text) => this.insertCalculation(text),
      insertGraph: (spec) => this.insertGraph(spec),
      popOutGraph: () => this.openGraphWindow(),
    };
  }

  /**
   * The calculator's graph, popped out to float over the notebook
   * (`graph-window.ts`); raised again when it is already open.
   */
  private openGraphWindow(): void {
    if (this.graphWindow?.isOpen) {
      this.graphWindow.raise();
      return;
    }
    const path = this.file?.path ?? "";
    const data = (): ReturnType<typeof parseCalculatorData> =>
      parseCalculatorData(this.settings.calculator);
    this.graphWindow = new GraphWindow({
      container: this.contentEl,
      state: graphStateFor(path),
      angle: () => data().prefs.angle,
      editLine: (id) => this.calculatorOnLine(id),
      insertGraph: (spec) => this.insertGraph(spec),
      drawMath: drawGraphMath,
      place: () => windowOf(data(), path),
      savePlace: (place) => this.plugin.saveCalculator(withWindow(data(), path, place)),
      closed: () => {
        this.graphWindow = null;
      },
    });
  }

  /** The calculator on its keys, typing a line of the graph (from the graph window). */
  private calculatorOnLine(id: string | null): void {
    this.calculator?.close();
    this.calculator = new CalculatorPopover(this.contentEl, this.calculatorHost(), {
      editLine: id,
    });
  }

  /**
   * Edit graph on a selected graph: the calculator opens on its graph pane
   * with this graph's expressions, view and angle, under the toolbar's
   * calculator button; its Done commits the edit as one undo step.
   */
  private editGraph(pageId: string, graph: GraphElement): void {
    if (this.isProtected()) return;
    this.calculator?.close();
    this.calculator = new CalculatorPopover(
      this.contentEl,
      {
        path: this.file?.path ?? "",
        load: () => parseCalculatorData(this.settings.calculator),
        save: (data) => this.plugin.saveCalculator(data),
        insert: (text) => this.insertCalculation(text),
      },
      {
        editGraph: {
          spec: specOfGraph(graph),
          done: (spec) => this.applyGraphEdit(pageId, graph, spec),
        },
      },
    );
  }

  /**
   * A calculation as a text box in the middle of what is in view of the
   * current page, in the Text tool's style, sized to its text: one undo step.
   */
  private insertCalculation(text: string): boolean {
    const surface = this.surface;
    if (!surface || this.isProtected()) return false;
    const index = surface.currentPage;
    const page = surface.document.pages[index];
    if (!page) return false;
    const style = textStyleOf(sanitizeTextStyle(this.settings.textStyle));
    // A first guess at the box's size, to centre it; the box fits its text.
    // Steps come as several lines: the widest one sets the width.
    const longest = Math.max(...text.split("\n").map((line) => line.length));
    const w = Math.max(80, longest * style.fontSize * 0.55);
    const at = centredOrigin(
      surface.visiblePageRect(index),
      page.geometry,
      w,
      style.fontSize * 1.4,
    );
    surface.applyCommand(
      new AddTextBoxToPage(page.id, {
        id: nextElementId(surface.document, "t"),
        x: at.x,
        y: at.y,
        w: 80,
        fit: true,
        text,
        ...style,
      }),
    );
    this.requestSave();
    return true;
  }

  /**
   * A graph from the calculator, in the middle of what is in view of the
   * current page, selected so its bar (Explore, Edit) is right there: one
   * undo step.
   */
  insertGraph(spec: GraphSpec): boolean {
    const surface = this.surface;
    if (!surface || this.isProtected()) return false;
    const index = surface.currentPage;
    const page = surface.document.pages[index];
    if (!page) return false;
    // The frame takes the view's shape, as the pop-up showed it, within bounds.
    const h = graphFrameHeight(spec, GRAPH_DEFAULT_W, GRAPH_DEFAULT_H);
    const at = centredOrigin(surface.visiblePageRect(index), page.geometry, GRAPH_DEFAULT_W, h);
    const graph = graphFromSpec(nextGraphId(surface.document), at.x, at.y, spec);
    if (graph.spec.expressions.length === 0) return false;
    graph.h = h;
    surface.applyCommand(new AddGraph(page.id, graph));
    surface.selectGraph(page.id, graph.id);
    this.requestSave();
    return true;
  }

  /** What Edit graph gave back for `graph`: its whole new spec, one undo step. */
  applyGraphEdit(pageId: string, graph: GraphElement, spec: GraphSpec): boolean {
    const surface = this.surface;
    if (!surface || this.isProtected()) return false;
    // Each curve keeps its colour by position; a new one takes the palette's next.
    const edited = graphFromSpec(graph.id, graph.x, graph.y, spec, graph.colors);
    if (edited.spec.expressions.length === 0) return false;
    surface.applyCommand(
      new EditGraph(pageId, graph, { spec: edited.spec, colors: edited.colors }),
    );
    this.requestSave();
    return true;
  }

  /** The on-device reader's state for the AI menu; undefined when it is off. */
  private deviceReading(): DeviceReading | undefined {
    if (this.settings.handwritingOnDevice === false) return undefined;
    const progress = this.plugin.learner.progress;
    return {
      learned: learnedRecord(this.settings, this.plugin.grape.id) !== undefined,
      practiceFiles: practiceFiles(this.plugin.learningHost()).length,
      learning: progress ? (100 * progress.step) / progress.steps : null,
      checkingWords: this.settings.checkHandwrittenWords === true,
    };
  }

  /**
   * What each AI menu entry does, by the id `buildAiMenu` gave it. A new
   * entry (e.g. "transcribe-recording") is one item there and one line here.
   */
  private aiActions(): Record<string, () => void> {
    return {
      learn: () => void this.plugin.learner.start(),
      practice: () => void writePracticePage(this.plugin.learningHost()),
      "device-settings": () => this.plugin.openSettingsTab(),
      "transcribe-recording": () => this.audio?.transcribeFromMenu(),
      "transcribe-device": () => this.audio?.transcribeOnDeviceFromMenu(),
      "transcribe-device-cancel": () => this.plugin.speech.cancel(),
      ask: () => this.openAsk(),
      "generate-image": () => this.openGenerateImage(),
      settings: () => this.plugin.openSettingsTab(),
    };
  }

  // --- Ask AI ---------------------------------------------------------------

  /** What page previews are painted from (the export dialog's, Ask AI's page picker). */
  private previewSources(): PdfExportSources {
    return {
      readPdf: async (path: string) => {
        const file = this.app.vault.getFileByPath(path);
        if (!file) throw new Error(`Missing PDF source — ${path}`);
        return this.app.vault.readBinary(file);
      },
      pdf: this.pdfCache,
      images: this.images,
      paper: paperTheme(false),
      usePressure: this.settings.pressureWidth,
      highlighterAlpha: this.settings.highlighterAlpha,
      furniture: (page) =>
        furnitureText(this.doc, this.doc.pages.indexOf(page), this.notebookTitle()),
    };
  }

  /** The notebook's name, as a header's `{title}`. */
  private notebookTitle(): string {
    return this.file ? stripInkSuffix(this.file.basename) : "";
  }

  /** Ask, in the layout last chosen: a window, or the sidebar beside the page. */
  private openAsk(): void {
    // TODO(#46 phase 4): on a board, Ask asks about what is on screen, not
    // about pages picked from a list.
    if (this.isDamaged()) return;
    if (this.settings.askLayout === "sidebar" && this.chatPanel) {
      this.setChatPanel(true);
      return;
    }
    new AskAiModal(this.app, this.askHost(), () => {
      this.setAskLayout("sidebar");
      this.setChatPanel(true);
    }).open();
  }

  private setAskLayout(layout: "window" | "sidebar"): void {
    if (this.settings.askLayout === layout) return;
    this.settings.askLayout = layout;
    void this.plugin.saveSettings();
  }

  /**
   * Open or close the Ask sidebar. It takes the left of the page, as the page
   * sidebar does, so opening it closes that one; the page glides aside as
   * it does for the page sidebar.
   */
  private setChatPanel(open: boolean): void {
    const panel = this.chatPanel;
    if (!panel || panel.isOpen === open) return;
    const before = this.surface?.pageClientRect() ?? null;
    if (open) {
      if (this.sidebar?.isOpen) this.sidebar.setOpen(false);
      panel.open();
    } else {
      panel.close();
    }
    this.syncSidebarInset();
    this.surface?.layout();
    if (before) this.surface?.glideFrom(before, PANEL_SLIDE_MS);
  }

  /** What the chat needs from this notebook, in either layout. */
  private askHost(): AskAiHost {
    const session = this.askConversation();
    return {
      session,
      sourcePath: this.file?.path ?? "",
      target: targetLabel(this.plugin.textAiConfig()),
      currentPage: () => (this.surface?.currentPage ?? 0) + 1,
      pageHasContent: (n) => {
        const page = this.doc.pages[n - 1];
        return !!page && hasAskableContent(page);
      },
      paintThumbnail: async (canvas, n, cssWidth) => {
        const page = this.doc.pages[n - 1];
        if (page) {
          await paintPagePreview(
            canvas,
            page,
            this.previewSources(),
            cssWidth,
            window.devicePixelRatio || 1,
          );
        }
      },
      insert: (text) => this.insertAnswer(text),
      insertDrawing: async (svg) => {
        const bytes = new TextEncoder().encode(svg);
        const placed = await this.insertImageBytes(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          "image/svg+xml",
          "Drawing.svg",
        );
        return placed !== null;
      },
      notebookPdfs: () =>
        pdfsBehind(
          this.doc.pages.map((page) => page.backdrop),
          this.doc.pages.map((_, i) => i + 1),
        ),
      savedChats: () =>
        this.file ? listChats(this.app, this.file.path, this.chatsFolder()) : Promise.resolve([]),
      openSaved: async (path) => {
        const chat = await readChat(this.app, path);
        if (!chat) {
          new Notice("FineNotes: that chat could not be read.");
          return;
        }
        session.load(chat, path);
      },
      rememberSave: (save) => {
        this.settings.askSaveChats = save;
        void this.plugin.saveSettings();
      },
    };
  }

  /**
   * This notebook's conversation, kept while the notebook is open so closing
   * the dialog loses neither the chat nor the draft. Before anything is
   * asked, it follows the page being read.
   */
  private askConversation(): AskSession {
    const current = (this.surface?.currentPage ?? 0) + 1;
    let session = this.askSession;
    if (!session) {
      session = new AskSession(
        {
          notebookPath: () => this.file?.path ?? "",
          confirm: () =>
            this.plugin.confirmAiSend(
              this.plugin.textAiConfig(),
              "Asking about your notes",
              "images of the pages you pick, together with your question,",
            ),
          preparePages: (numbers) =>
            this.collectAskPages(
              numbers.map((n) => n - 1).filter((i) => i >= 0 && i < this.doc.pages.length),
            ),
          ask: (turns, onStatus) => this.askWithTools(turns, onStatus),
          save: (chat, path) => writeChat(this.app, chat, path, this.chatsFolder()),
          unsave: (path) => trashChat(this.app, path),
          readFile: (path) => readAttachment(this.app, path),
          now: () => new Date(),
        },
        { page: current, totalPages: this.doc.pages.length, save: this.settings.askSaveChats },
      );
      this.askSession = session;
    } else {
      session.setTotalPages(this.doc.pages.length);
      if (session.empty) session.newChat(current);
    }
    return session;
  }

  /**
   * Ask's answer: the AI may use the notebook's tools on the way
   * (`askAiWithTools`), whichever vendor answers; a self-hosted endpoint
   * that cannot do tools answers from what was sent.
   */
  private askWithTools(
    turns: readonly ChatTurn[],
    onStatus: (status: string) => void,
  ): Promise<{ text: string; actions?: readonly string[] }> {
    const config = this.plugin.textAiConfig();
    const system = buildAskSystemPrompt();
    const withTools = askAiWithTools(config, `${system}\n${buildAskToolsPrompt()}`, turns, {
      totalPages: () => this.doc.pages.length,
      run: (call) => this.runAskTool(call),
      onStatus,
    });
    if (config.vendor !== "custom") return withTools;
    // A self-hosted server may not do tools: then it answers from what was sent.
    return withTools.catch(() => askAi(config, system, turns).then((text) => ({ text })));
  }

  /** Run one of the AI's notebook tools (`ask-tools.ts`). */
  private async runAskTool(call: AskToolCall): Promise<AskToolOutcome> {
    const surface = this.surface;
    const editRefused = (): AskToolOutcome | null =>
      !surface || this.isProtected()
        ? { text: "The notebook cannot be changed right now.", isError: true }
        : null;
    switch (call.tool) {
      case "read_pages": {
        const pages = await this.collectAskPages(call.pages.map((n) => n - 1));
        if (pages.images.length === 0) return { text: "Those pages are empty." };
        const which = pages.pageNumbers.join(", ");
        return {
          text: `Page${pages.pageNumbers.length === 1 ? "" : "s"} ${which} of ${pages.totalPages}, in that order.`,
          images: pages.images,
        };
      }
      case "search_notebook": {
        const hits = searchPages(await this.notebookTextIndex(), call.query);
        return {
          text: searchResultText(
            call.query,
            hits.map((hit) => ({
              page: hit.pageIndex + 1,
              snippets: hit.snippets.map((s) => `${s.before}${s.match}${s.after}`),
            })),
          ),
        };
      }
      case "add_text_box": {
        const refused = editRefused();
        if (refused || !surface) return refused ?? { text: "", isError: true };
        const index = call.page - 1;
        const page = surface.document.pages[index];
        if (!page) return { text: `There is no page ${call.page}.`, isError: true };
        const frame = textBoxFrame(page.geometry, null);
        surface.applyCommand(
          new AddTextBoxToPage(page.id, {
            id: nextElementId(surface.document, "t"),
            x: frame.x,
            y: frame.y,
            w: frame.w,
            text: call.text,
            color: "#1a1a1a",
            fontSize: 22,
          }),
        );
        this.requestSave();
        return {
          text: `Added the text box near the top of page ${call.page}.`,
          done: `Added a text box on page ${call.page}`,
        };
      }
      case "add_page": {
        const refused = editRefused();
        if (refused) return refused;
        if (this.isSinglePage) {
          return { text: "This note is a single page; it cannot have more.", isError: true };
        }
        const before = this.doc.pages.length;
        this.addPage(call.after - 1, true);
        if (this.doc.pages.length === before) return { text: "No page was added.", isError: true };
        return {
          text: `Added page ${call.after + 1} after page ${call.after}. Pages after it moved up by one.`,
          done: `Added page ${call.after + 1}`,
        };
      }
      case "go_to_page":
        surface?.goToPage(call.page - 1, true);
        return { text: `Showing page ${call.page}.`, done: `Went to page ${call.page}` };
      case "insert_drawing": {
        const refused = editRefused();
        if (refused) return refused;
        const bytes = new TextEncoder().encode(call.svg);
        const placed = await this.insertImageBytes(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          "image/svg+xml",
          `${call.title}.svg`,
          { pageIndex: call.page - 1, select: false },
        );
        if (!placed) return { text: "The drawing could not be placed.", isError: true };
        return {
          text: `Placed the drawing on page ${call.page}, saved as ${placed.path}.`,
          done: `Drew on page ${call.page}`,
        };
      }
      default:
        return this.runOrganiseTool(call);
    }
  }

  /**
   * The tools that organise or annotate the notebook (`ask-tools.ts`): page
   * titles, contents, bookmarks, page order, tables, practice pages, marks
   * and comments. Each is one undoable step.
   */
  private runOrganiseTool(call: AskToolCall): AskToolOutcome {
    const surface = this.surface;
    if (!surface || this.isProtected()) {
      return { text: "The notebook cannot be changed right now.", isError: true };
    }
    const doc = surface.document;
    const pageAt = (n: number): Page | null => doc.pages[n - 1] ?? null;
    const apply = (command: Command): void => {
      surface.applyCommand(command);
      this.requestSave();
    };
    switch (call.tool) {
      case "set_page_title": {
        const page = pageAt(call.page);
        if (!page) break;
        apply(new SetPageTitle(page, call.title || null));
        return call.title
          ? {
              text: `Page ${call.page} is now “${call.title}” in the contents.`,
              done: `Titled page ${call.page} “${call.title}”`,
            }
          : {
              text: `Page ${call.page} has no title now.`,
              done: `Removed page ${call.page}'s title`,
            };
      }
      case "add_section": {
        const page = pageAt(call.page);
        if (!page) break;
        const { width, height } = page.geometry;
        apply(
          new SetSection(page, nextSectionId(doc), {
            x: width * 0.08,
            y: call.y * height,
            title: call.title,
          }),
        );
        return {
          text: `Added “${call.title}” to the contents, on page ${call.page}.`,
          done: `Added “${call.title}” to the contents`,
        };
      }
      case "bookmark_page": {
        const page = pageAt(call.page);
        if (!page) break;
        apply(new SetPageBookmark(page, call.bookmarked));
        return call.bookmarked
          ? { text: `Bookmarked page ${call.page}.`, done: `Bookmarked page ${call.page}` }
          : {
              text: `Page ${call.page} has no bookmark now.`,
              done: `Unbookmarked page ${call.page}`,
            };
      }
      case "move_page": {
        if (this.isSinglePage) return { text: "This note is a single page.", isError: true };
        apply(new MovePage(call.page - 1, call.to - 1));
        this.sidebar?.flush();
        return {
          text: `Page ${call.page} is now page ${call.to}; the pages between moved by one.`,
          done: `Moved page ${call.page} to ${call.to}`,
        };
      }
      case "add_table": {
        const page = pageAt(call.page);
        if (!page) break;
        const { width, height } = page.geometry;
        const rows = call.cells.length;
        const cols = call.cells[0]?.length ?? 1;
        const x = (call.x ?? 0.08) * width;
        const y = (call.y ?? 0.08) * height;
        const w = Math.max(cols * 60, Math.min((call.width ?? 0.84) * width, width - x));
        const table = makeTable({
          id: nextTableId(doc),
          x,
          y,
          w,
          h: rows * 44,
          rows,
          cols,
          color: "#1a1a1a",
          textColor: "#1a1a1a",
          header: call.header,
        });
        call.cells.forEach((row, r) => row.forEach((cell, c) => setCellText(table, r, c, cell)));
        apply(new AddTable(page.id, table));
        return {
          text: `Added a ${rows}×${cols} table on page ${call.page}.`,
          done: `Added a table on page ${call.page}`,
        };
      }
      case "add_practice_page": {
        if (this.isSinglePage) return { text: "This note is a single page.", isError: true };
        const insert = pageToInsertAfter(doc, call.after - 1, this.templateNames());
        if (!insert) break;
        const { page } = insert;
        const { width, height } = page.geometry;
        const parts: Command[] = [new AddPage(insert.index, page)];
        if (call.title) parts.push(new SetPageTitle(page, call.title));
        // Ids counted on from the notebook's highest, one per box.
        let next = Number(nextElementId(doc, "t").slice(1));
        const box = (y: number, text: string, fontSize: number, bold = false): TextBoxElement => ({
          id: `t${next++}`,
          x: width * 0.08,
          y,
          w: width * 0.84,
          text,
          color: "#1a1a1a",
          fontSize,
          ...(bold ? { bold: true } : {}),
        });
        let top = height * 0.06;
        if (call.title) {
          parts.push(new AddTextBoxToPage(page.id, box(top, call.title, 30, true)));
          top += 60;
        }
        // Each question gets an even share of what is left, to answer under it.
        const slot = (height * 0.96 - top) / call.questions.length;
        call.questions.forEach((question, i) => {
          parts.push(
            new AddTextBoxToPage(page.id, box(top + i * slot, `${i + 1}. ${question}`, 22)),
          );
        });
        apply(new CompositeCommand("Add practice page", parts));
        surface.goToPage(insert.index, true);
        return {
          text:
            `Added practice page ${insert.index + 1} with ${call.questions.length} ` +
            `question${call.questions.length === 1 ? "" : "s"}, on the same paper as page ${call.after}.`,
          done: `Added practice page ${insert.index + 1}`,
        };
      }
      case "mark_area": {
        const page = pageAt(call.page);
        if (!page) break;
        const { width, height } = page.geometry;
        const x0 = call.x * width;
        const y0 = call.y * height;
        const x1 = (call.x + call.width) * width;
        const y1 = (call.y + call.height) * height;
        const parts: Command[] = [
          new AddStrokeToPage(page.id, markStroke(doc, call.shape, x0, y0, x1, y1)),
        ];
        if (call.comment) {
          parts.push(new AddComment(page.id, this.aiComment(doc, page, x1, y0, call.comment)));
        }
        apply(new CompositeCommand("Mark", parts));
        const what =
          call.shape === "highlight" ? "Highlighted" : call.shape === "box" ? "Boxed" : "Circled";
        return {
          text: `${what} that part of page ${call.page}${call.comment ? ", with the comment beside it" : ""}.`,
          done: `${what} part of page ${call.page}${call.comment ? " and commented" : ""}`,
        };
      }
      case "add_comment": {
        const page = pageAt(call.page);
        if (!page) break;
        const { width, height } = page.geometry;
        apply(
          new AddComment(
            page.id,
            this.aiComment(doc, page, call.x * width, call.y * height, call.text),
          ),
        );
        return {
          text: `Pinned the comment on page ${call.page}; the user opens it by tapping its marker.`,
          done: `Commented on page ${call.page}`,
        };
      }
      default:
        return { text: "That tool is not here.", isError: true };
    }
    return { text: "That page is not in the notebook.", isError: true };
  }

  /** A comment by the AI at page point (`x`, `y`), kept on the page. */
  private aiComment(doc: InkDocument, page: Page, x: number, y: number, text: string): PageComment {
    return {
      id: nextCommentId(doc),
      x: Math.min(Math.max(0, x), page.geometry.width),
      y: Math.min(Math.max(0, y), page.geometry.height),
      text: text.slice(0, MAX_COMMENT_LENGTH),
      author: "ai",
      created: Date.now(),
    };
  }

  /**
   * The notebook's text, page by page, for searching: its text boxes, the
   * note's text layer, and the transcript sidecar, beside the note first
   * (where the server keeps one) and then in the notebook's Transcripts.
   */
  private async notebookTextIndex(): Promise<PageText[]> {
    const note = this.file;
    let sidecar: string | null = null;
    const sidecarFile = note
      ? ([transcriptSidecarPath(note.path), folderNotebookSidecarPath(note.path)]
          .map((path) => (path ? this.app.vault.getFileByPath(path) : null))
          .find((file) => file !== null) ?? null)
      : null;
    if (sidecarFile) {
      try {
        sidecar = await this.app.vault.cachedRead(sidecarFile);
      } catch {
        // Not synced yet or unreadable: search what the note itself holds.
      }
    }
    const doc = this.surface?.document ?? this.doc;
    return collectPageText(doc.pages, readTextSection(this.noteBody), sidecar);
  }

  /**
   * Where this notebook keeps saved chats: its own setting (a new notebook
   * with its own folder sets it to that folder's AI chats), else "AI chats" beside it.
   */
  private chatsFolder(): string {
    return this.attachmentFolder("chats") ?? chatsFolderFor(this.file?.path ?? "");
  }

  private async collectAskPages(indexes: readonly number[]): Promise<AskPagesResult> {
    const images: ChatImage[] = [];
    const pageNumbers: number[] = [];
    for (const index of indexes) {
      const page = this.doc.pages[index];
      if (!page) continue;
      const rendered = await this.renderForAi(page);
      if (!rendered) continue;
      images.push({ base64: rendered.base64, mimeType: "image/png" });
      pageNumbers.push(index + 1);
    }
    return { images, pageNumbers, totalPages: this.doc.pages.length };
  }

  /** Pin a comment to page `index` at `at`, one undoable step. Resolves to it, or null. */
  private addComment(
    index: number,
    at: { x: number; y: number },
    text: string,
    author: "you" | "ai",
  ): PageComment | null {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected() || !text.trim()) return null;
    const comment: PageComment = {
      id: nextCommentId(surface.document),
      x: Math.min(Math.max(0, at.x), page.geometry.width),
      y: Math.min(Math.max(0, at.y), page.geometry.height),
      text: text.trim().slice(0, MAX_COMMENT_LENGTH),
      author,
      created: Date.now(),
    };
    surface.applyCommand(new AddComment(page.id, comment));
    this.requestSave();
    return comment;
  }

  /** A comment's marker was tapped: read it, edit it, resolve or delete it. */
  private openComment(index: number, comment: PageComment): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page) return;
    const apply = (command: Command): void => {
      if (this.isProtected()) return;
      surface.applyCommand(command);
      this.requestSave();
    };
    new CommentModal(this.app, comment, index + 1, {
      save: (text) => apply(new SetCommentText(page.id, comment, text)),
      resolve: (resolved) => apply(new SetCommentResolved(page.id, comment, resolved)),
      remove: () => apply(new RemoveComment(page.id, comment)),
    }).open();
  }

  /** An answer as a text box near the top of what is in view on the current page. */
  private insertAnswer(text: string): boolean {
    const surface = this.surface;
    if (!surface || !text.trim() || this.isProtected()) return false;
    const index = surface.currentPage;
    const page = surface.document.pages[index];
    if (!page) return false;
    const frame = textBoxFrame(page.geometry, surface.visiblePageRect(index));
    const box: TextBoxElement = {
      id: nextElementId(surface.document, "t"),
      x: frame.x,
      y: frame.y,
      w: frame.w,
      text,
      color: "#1a1a1a",
      fontSize: 22,
    };
    surface.applyCommand(new AddTextBoxToPage(page.id, box));
    return true;
  }

  // --- Generate image -------------------------------------------------------

  /** Open "Generate image" (the AI menu and the image menu both lead here). */
  openGenerateImage(): void {
    if (this.isProtected()) return;
    const config = this.plugin.imageAiConfig();
    if (!config) {
      new Notice("FineNotes: choose an image service in settings first.");
      return;
    }
    const target = { vendor: config.vendor, baseUrl: "" };
    new GenerateImageModal(this.app, {
      target: targetLabel(target),
      pageNumber: (this.surface?.currentPage ?? 0) + 1,
      aspect: this.settings.imageAspect,
      generate: async (prompt, aspect) => {
        this.settings.imageAspect = aspect;
        void this.plugin.saveSettings();
        const confirmed = await this.plugin.confirmAiSend(
          target,
          "Generating an image",
          "the description you typed",
        );
        if (!confirmed) return false;
        const picture = await generateImage(config, prompt, aspect);
        await this.placeGeneratedImage(picture, prompt);
        return true;
      },
    }).open();
  }

  /**
   * Save a generated picture and place it on the page being read, through
   * the same `insertImageBytes` every other picture uses (downscaled if it
   * needs to be, saved as an attachment, one undoable `InsertImage`,
   * selected).
   */
  private async placeGeneratedImage(picture: GeneratedPicture, prompt: string): Promise<void> {
    const { bytes } = picture;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const name = generatedImageName(prompt, new Date(), picture.mimeType);
    const placed = await this.insertImageBytes(buffer as ArrayBuffer, picture.mimeType, name);
    if (placed) new Notice(`FineNotes: picture saved to ${placed.path}.`);
  }

  /**
   * Automatic transcription, a setting that is off by default: every change
   * to the ink restarts a wait of AUTO_RECOGNIZE_IDLE_MS, and when the wait
   * runs out the page in view is transcribed. It cannot ask for consent, so
   * it is only armed for an engine that needs the network once the user has
   * agreed to send to the chosen vendor's kind of destination: a cloud
   * service and the user's own endpoint are agreed to separately. A page
   * whose ink has not changed since its last transcription costs nothing
   * (see `transcribe`).
   */
  /**
   * Read pages on this device for search and the text layer, a moment after
   * writing stops (`device-reading.ts` picks the page): one page at a time,
   * the page in view first, never while the pen is down, never replacing a
   * transcription.
   */
  private scheduleDeviceReading(delay = DEVICE_READ_IDLE_MS): void {
    window.clearTimeout(this.deviceTimer);
    this.deviceTimer = 0;
    if (this.settings.handwritingOnDevice === false || this.guard.locked) return;
    this.deviceTimer = window.setTimeout(() => void this.readNextPageOnDevice(), delay);
  }

  private async readNextPageOnDevice(): Promise<void> {
    this.deviceTimer = 0;
    const guard = this.plugin.readingGuard;
    const path = this.file?.path;
    if (this.deviceBusy || !this.surface || !path || guard.paused) return;
    if (this.penIsDown) {
      this.scheduleDeviceReading();
      return;
    }
    const doc = this.doc;
    const keys = pageKeys(doc.pages);
    const step = nextDeviceStep({
      pages: doc.pages,
      keys,
      entries: transcriptSources(readTextSection(this.noteBody)),
      hashOf: pageContentHash,
      read: this.deviceRead,
      skip: guard.skipped(path),
      current: this.surface.currentPage,
    });
    if (!step) return;
    if (step.kind === "clear") {
      this.writeTranscripts([{ key: step.key, text: "", hash: "" }]);
      this.scheduleDeviceReading(DEVICE_READ_NEXT_MS);
      return;
    }
    this.deviceBusy = true;
    try {
      await this.plugin.handwriting.model();
    } catch {
      // The model failed to load, which is no fault of the page: try again
      // after the next edit.
      this.deviceBusy = false;
      return;
    }
    // Marked until the reading and the link check are over: a mark left at
    // the next start means this page took the app down (reading-guard.ts).
    const mark = { path, key: step.key, hash: step.hash, page: doc.pages.indexOf(step.page) + 1 };
    guard.begin(mark);
    try {
      let reading: PageReading;
      try {
        // TODO(#46 phase 4): a board is read by area, around what changed;
        // its whole page would make every reading slower as it fills.
        reading = await this.plugin.handwriting.readPage(step.page.strokes, this.wordsChecked);
      } catch {
        // An error or a timeout: skip this page until it changes, and go on.
        guard.fail(mark);
        this.scheduleDeviceReading(DEVICE_READ_NEXT_MS);
        return;
      }
      // The page may have changed, moved or gone, or been transcribed, meanwhile.
      if (this.doc !== doc || !doc.pages.includes(step.page)) return;
      if (pageContentHash(step.page) !== step.hash) {
        this.scheduleDeviceReading();
        return;
      }
      this.deviceRead.set(step.key, step.hash);
      const entry = transcriptSources(readTextSection(this.noteBody)).get(step.key);
      if (!entry || entry.device) {
        const text = readingText(reading);
        this.writeTranscripts([{ page: step.page, text, hash: step.hash, device: true }]);
      }
      await this.offerHandwrittenLinks(step.page, reading);
      await this.checkWords(step.page, step.hash, reading);
      this.scheduleDeviceReading(DEVICE_READ_NEXT_MS);
    } finally {
      guard.end();
      this.deviceBusy = false;
    }
  }

  /**
   * Look for `[[links]]` written by hand on a page just read: each line with
   * a bracket in it is read again word by word, and the links found are
   * offered on the page (`handwritten-links.ts`).
   */
  // --- Words it may have misread ------------------------------------------------

  /** Whether misread words are underlined (needs reading on the device). */
  private get wordsChecked(): boolean {
    const settings = this.plugin.settings as GoodObsidianSettings | undefined;
    return settings?.checkHandwrittenWords === true && settings.handwritingOnDevice !== false;
  }

  /**
   * Corrections were switched on or off (the AI menu, the settings): check
   * the page in view now, or take every underline away at once.
   */
  wordCheckingChanged(): void {
    if (this.wordsChecked) {
      this.scheduleWordCheck();
      return;
    }
    window.clearTimeout(this.wordCheckTimer);
    this.wordCheckTimer = 0;
    this.wordPopover?.close();
    for (const id of this.checkedWords.keys()) this.surface?.setWordFlags(id, []);
    this.checkedWords.clear();
  }

  /** Check the page in view once the reader has settled on it. */
  private scheduleWordCheck(): void {
    if (!this.wordsChecked) return;
    window.clearTimeout(this.wordCheckTimer);
    this.wordCheckTimer = window.setTimeout(() => void this.checkPageInView(), WORD_CHECK_WAIT_MS);
  }

  /**
   * Read the page in view and underline its doubtful words, unless it was
   * checked at this content already. Never while the pen is down or the
   * background reader is busy: then it waits for the next settle.
   */
  private async checkPageInView(): Promise<void> {
    this.wordCheckTimer = 0;
    const surface = this.surface;
    const page = surface?.document.pages[surface.currentPage];
    if (!surface || !page || !this.wordsChecked || this.guard.locked) return;
    const hash = pageContentHash(page);
    if (this.checkedWords.get(page.id)?.hash === hash) return;
    if (this.deviceBusy || this.penIsDown) {
      this.scheduleWordCheck();
      return;
    }
    this.deviceBusy = true;
    try {
      const reading = await this.plugin.handwriting.readPage(page.strokes, true);
      if (this.surface === surface && surface.document.pages.includes(page)) {
        await this.checkWords(page, hash, reading);
      }
    } catch {
      // The model failed to load, or the page could not be read: nothing to underline.
    } finally {
      this.deviceBusy = false;
    }
  }

  /** Underline the words of a page just read that Grape may have misread. */
  private async checkWords(page: Page, hash: string, reading: PageReading): Promise<void> {
    const file = this.file;
    const surface = this.surface;
    if (!file || !surface) return;
    this.keepReading(page, hash, reading);
    if (!this.wordsChecked) {
      // Turned off since this page was checked: take its underlines away.
      if (this.checkedWords.delete(page.id)) surface.setWordFlags(page.id, []);
      return;
    }
    const words = readWords(reading.lines);
    const checked: CheckedPage = { hash, words };
    this.checkedWords.set(page.id, checked);
    const flagged = await this.plugin.wordCheck.flags(file.path, page.id, words);
    if (this.surface === surface)
      surface.setWordFlags(
        page.id,
        flagged.map((w) => w.strokeIds),
      );
    checked.suggestions = await this.suggestFor(reading, flagged);
  }

  /**
   * The list words each flagged word's ink fits best (lexicon.ts), worked
   * out now so a tap opens its menu at once. Empty when there is no list or
   * the page was not kept.
   */
  private async suggestFor(
    reading: PageReading,
    flagged: readonly ReadWord[],
  ): Promise<Map<string, LexiconSuggestion | null>> {
    const out = new Map<string, LexiconSuggestion | null>();
    const lexicon = this.plugin.wordCheck.lexicon();
    const located = flagged.filter((w) => w.at);
    if (reading.id === undefined || !lexicon || located.length === 0) return out;
    const items = located.map((w) => {
      const at = w.at as NonNullable<ReadWord["at"]>;
      return { line: at.line, text: reading.lines[at.line].text, start: at.start, end: at.end };
    });
    try {
      const results = await this.plugin.handwriting.suggest(reading.id, items, lexicon);
      located.forEach((w, i) => out.set(strokeKey(w.strokeIds), results?.[i] ?? null));
    } catch {
      // No suggestions: the menu offers the other answers.
    }
    return out;
  }

  /** Remember a page's reading, so lassoed ink on it can use its words. */
  private keepReading(page: Page, hash: string, reading: PageReading): PageWords {
    const entry: PageWords = {
      hash,
      words: readWords(reading.lines),
      read: new Set(reading.lines.flatMap((line) => line.strokeIds)),
      lines: reading.lines.map((line) => line.text),
      readLines: reading.lines.map((line) => ({ text: line.text, words: line.words })),
      id: reading.id,
    };
    this.pageReadings.set(page.id, entry);
    return entry;
  }

  /** A finger tapped (or a mouse right-clicked) an underlined word: ask what it says. */
  private askAboutWord(index: number, strokeIds: string[], at: { x: number; y: number }): void {
    const file = this.file;
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!file || !surface || !page) return;
    const key = strokeKey(strokeIds);
    const word = this.checkedWords.get(page.id)?.words.find((w) => strokeKey(w.strokeIds) === key);
    if (!word) return;
    const ids = new Set(strokeIds);
    const strokes = page.strokes.filter((stroke) => ids.has(stroke.id));
    const suggestion = this.checkedWords.get(page.id)?.suggestions?.get(key) ?? null;
    const asked = { note: file.path, pageId: page.id, word, strokes, suggestion };
    // Its underline turns red while the card is open.
    surface.setActiveWordFlag(page.id, strokeIds);
    const closed = () => {
      if (this.surface === surface) surface.setActiveWordFlag(null);
    };
    this.wordPopover?.close();
    this.wordPopover = this.plugin.wordCheck.ask(
      asked,
      at,
      () => {
        // Answered: underline the page's words again, without this one.
        const checked = this.checkedWords.get(page.id);
        if (!checked || this.surface !== surface) return;
        void this.plugin.wordCheck.flags(file.path, page.id, checked.words).then((flagged) =>
          surface.setWordFlags(
            page.id,
            flagged.map((w) => w.strokeIds),
          ),
        );
      },
      closed,
    );
  }

  private async offerHandwrittenLinks(page: Page, reading: PageReading): Promise<void> {
    const surface = this.surface;
    if (!surface) return;
    const bracketed = reading.lines.filter(
      (line) => line.text.includes("[") || line.greedy.includes("["),
    );
    const found: HandwrittenLink[] = [];
    if (bracketed.length > 0) {
      // The worker found the words: finding them again here would block the
      // main thread for as long as a dense page takes to segment.
      const ink = new Map(inkForReading(page.strokes).map((s) => [s.id, s]));
      for (const read of bracketed) {
        const groups = read.words
          .map((word) => word.flatMap((id) => ink.get(id) ?? []))
          .filter((group) => group.length > 0);
        if (groups.length === 0) continue;
        try {
          const words = await this.plugin.handwriting.readGroups(groups);
          found.push(
            ...findHandwrittenLinks(
              words.map((w, i) => ({
                text: w.text,
                greedy: w.greedy,
                strokeIds: groups[i].map((s) => s.id),
              })),
            ),
          );
        } catch {
          return;
        }
      }
    }
    if (this.surface === surface && this.doc.pages.includes(page)) {
      surface.setLinkSuggestions(page.id, found);
    }
  }

  private scheduleAutoTranscription(): void {
    window.clearTimeout(this.transcribeTimer);
    const { autoRecognize, llmVendor } = this.settings;
    const armed =
      autoRecognize &&
      this.plugin.activeProvider().requiresNetwork &&
      this.plugin.consentedTo(llmVendor);
    if (!armed) return;
    const transcribeNow = (): void => void this.plugin.runRecognition(this, true);
    this.transcribeTimer = window.setTimeout(transcribeNow, AUTO_RECOGNIZE_IDLE_MS);
  }

  /**
   * Open or close the text layer. Opening shows the body as it is now and
   * puts the cursor in it; the pages then lay out in the height that is left.
   */
  toggleTextPanel(): void {
    this.textPanelOpen = !this.textPanelOpen;
    const panel = this.textPanel;
    if (!panel) return;
    panel.setOpen(this.textPanelOpen);
    if (this.textPanelOpen) {
      panel.load(this.noteBody);
      panel.field.focus();
    }
    this.surface?.layout();
  }

  // --- Building the view -----------------------------------------------------

  private buildDom(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("goodobsidian-view");

    // Ink colours are absolute: pages are paper-white whatever Obsidian's
    // theme, so the default ink must not follow the theme either (dark ink
    // turned white on a dark theme would vanish on the page). How dark the
    // paper is, is chosen per notebook, in the toolbar.
    const palette = [...PALETTE, ...this.settings.customColors];
    this.toolbar = new Toolbar(
      root,
      palette,
      SIZES,
      this.toolState,
      {
        returnToPenOnReselect: () => this.settings.returnToPenOnReselect === true,
        onToolChange: (tool) => {
          this.surface?.setTool(tool);
          if (tool === "text" && this.surface) this.plugin.offerTextHint(this.surface);
        },
        // The toolbar writes colour and size into the shared tool state,
        // which is where the surface reads them; the pen is remembered for
        // the next notebook (FineNotes#24).
        onColorChange: () => {
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        onSizeChange: () => {
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        onPressureToggle: () => this.updateSidebarRendering(),
        pressureAllowed: () => this.settings.pressureWidth,
        onUndo: () => this.surface?.undo(),
        onRedo: () => this.surface?.redo(),
        onClear: () => this.clearPage(),
        onAddPage: (anchor) => this.openAddPage(anchor, this.surface?.currentPage ?? 0, "after"),
        onPenTypeChange: () => {
          this.toolbar?.syncActive();
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        savedPens: () => savedPensOf(this.settings.savedPens),
        onSavePen: (pen) =>
          this.plugin.saveSavedPens(addSavedPen(savedPensOf(this.settings.savedPens), pen)),
        onEditPens: () => this.plugin.openSettingsTab(),
        onRuler: () => {
          const surface = this.surface;
          if (!surface) return;
          surface.setRulerOut(!surface.rulerOut);
          this.toolbar?.setRulerOut(surface.rulerOut);
        },
        onRulerChange: (kind, snap) => {
          // Picking a kind or a snapping in the popover means using the ruler.
          this.surface?.setRulerOut(true);
          this.toolbar?.setRulerOut(this.surface?.rulerOut ?? false);
          this.plugin.saveRuler(kind, snap);
        },
        onEraserChange: (mode, size) => this.plugin.saveEraser(mode, size),
        sizePreviewScales: () => this.surface?.sizePreviewScales() ?? { pen: 1, eraser: 1 },
        paintSizePaper: (canvas, width, height) =>
          this.surface?.paintPaperSample(canvas, width, height) ?? false,
        onEraserFilterChange: (filter) => this.plugin.saveEraserFilter(filter),
        onLassoChange: (mode, filter) => {
          this.surface?.refreshLassoChrome();
          this.plugin.saveLasso(mode, filter);
        },
        onToggleThumbnails: () => this.toggleSidebar(),
        onFullScreen: this.plugin.fullScreenOffered
          ? () => this.plugin.toggleFullScreen()
          : undefined,
        onTextStyle: (patch) => this.surface?.applyTextStyle(patch),
        onTextSizePreview: (fontSize) => this.surface?.previewTextSize(fontSize),
        onTextList: (kind) => void this.surface?.applyTextList(kind),
        onTextDelete: () => void this.surface?.deleteEditingTextBox(),
        onPenAutoShapeChange: (enabled) => this.plugin.savePenAutoShape(enabled),
        onPenGesturesChange: (gestures) => this.plugin.savePenGestures(gestures),
        onShapeColorChange: (color) => {
          this.surface?.refreshPenCursor();
          this.plugin.saveShapeColor(color);
        },
        onShapeStyleChange: (style) => this.plugin.saveShapeStyle(style),
        onTableHeaderChange: (on) => this.plugin.saveTableHeader(on),
        onRecentColors: (colors) => this.plugin.saveRecentColors(colors),
        onPickFromPage: (done) => {
          if (this.surface) this.surface.pickColorFromPage(done);
          else done(null);
        },
        onPenColors: (colors) => this.plugin.savePenColors(colors),
        onPenInks: (inks) => this.plugin.savePenInks(inks),
        onPenStabilization: (all) => this.plugin.savePenStabilization(all),
        onTextToolChange: (style, pinned, dragSize) =>
          this.plugin.saveTextTool(style, pinned, dragSize),
        onInsertImage: (anchor) => this.openImageMenu(anchor),
        onStickers: () => {
          if (!this.isProtected() && this.file)
            this.plugin.openStickerPicker(this.imageMenuContext());
        },
        onStickyColor: (color) => this.armStickyNote(color),
        onStickyCancel: () => this.armStickyNote(null),
        onCustomize: () => this.openCustomizeToolbar(),
        onInsertPdf: (anchor) => this.openImageMenu(anchor, true),
        onAi: (anchor) => this.openAiMenu(anchor),
        onCalculator: () => this.toggleCalculator(),
        // Inside the tap: the microphone is only granted from a user gesture.
        onRecord: () => this.audio?.toggleRecording(),
        onSettings: () => this.openNoteSettings(),
        onShare: () => this.exportPdf(),
        onSearch: () => void this.openSearch(),
        onMore: (anchor) => this.toggleMorePanel(anchor),
        onPillPlaced: () => this.surface?.placeToasts(),
        onPillDock: (dock) => this.plugin.setPillDock(dock),
        onOnlyStylusMode: (on) => void this.plugin.setOnlyStylusMode(on),
        onZoomIn: () => this.surface?.zoomIn(),
        onZoomOut: () => this.surface?.zoomOut(),
        onZoomFit: () => this.surface?.resetView(),
      },
      {
        defaultSize: this.settings.defaultSize,
        reservedColors: [this.settings.defaultColor, ...this.settings.customColors],
        pillDock: this.plugin.pillDock,
        items: this.settings.toolbarItems,
        onlyStylusMode: this.settings.onlyStylusMode === true,
      },
    );
    this.showFullScreen(this.plugin.fullScreen);
    // The gear's dot while a newer FineNotes is out, and "Update available"
    // under it until it is tapped or closed, again every other day until the
    // update is in (update-notice.ts). A tap goes straight to Obsidian's Update.
    const updates = this.plugin.updates;
    const markUpdate = (): void => {
      this.toolbar?.setUpdateMark(updates.available);
      const version = updates.pendingAnnouncement();
      if (!version) {
        // "Don't show again", or checking switched off, while it showed.
        this.toolbar?.hideUpdateTip();
        return;
      }
      // After the bar is laid out; if it is not yet, the next change or open says it.
      window.setTimeout(() => {
        if (updates.pendingAnnouncement() !== version) return;
        this.toolbar?.showUpdateTip(
          () => {
            updates.announced(version);
            this.plugin.openUpdatePage();
          },
          () => updates.announced(version),
        );
      }, UPDATE_TIP_DELAY_MS);
    };
    markUpdate();
    this.unwatchUpdates?.();
    this.unwatchUpdates = updates.subscribe(markUpdate);

    const pdfCache = new PdfBackdropCache(this.app);
    this.pdfCache = pdfCache;
    // PDF pages render in the shared background worker once it is up (and
    // on this thread until then, or for good if it cannot start here).
    if (!this.pdfWorkerHeld) {
      this.pdfWorkerHeld = true;
      void acquirePdfWorker().then((worker) => {
        if (worker && this.pdfCache === pdfCache) {
          pdfCache.setWorker(worker);
          this.surface?.refreshPdfDetail();
        }
      });
    }
    this.backdrops = new VaultBackdropRenderer(this.pdfCache);
    this.thumbBackdrops = new VaultBackdropRenderer(this.pdfCache);
    this.thumbBackdrops.setDeviceScale(thumbnailRasterScale(window.devicePixelRatio || 1));
    this.images = new VaultImageCache(this.app);

    const body = root.createDiv({ cls: "goodobsidian-body" });
    this.sidebar = new PageSidebar(
      body,
      {
        // A tapped thumbnail glides to its page, as GoodNotes does; from the
        // overview, which covered the page, it is simply there.
        onSelectPage: (index, fromOverview) => this.surface?.goToPage(index, !fromOverview),
        onPageAction: (action, index, anchor) => this.pageAction(action, index, anchor),
        onSelectSection: (index, section, fromOverview) =>
          this.surface?.goToPagePoint(index, section.y, !fromOverview),
        onSectionAction: (action, index, section) => this.sectionAction(action, index, section),
        onAddPage: (anchor) => this.openAddPage(anchor, this.doc.pages.length - 1, "last"),
        onClose: () => {
          if (this.sidebar?.isOpen) this.toggleSidebar();
        },
        canEdit: () => !this.isProtected(),
        onMovePages: (indexes, gap) => this.movePages(indexes, gap),
        onSelectionAction: (action, indexes) => this.selectionAction(action, indexes),
        // The options pill floats over the page, which the overview covers.
        pageSnapshot: () => this.surface?.snapshotPage() ?? null,
        onOverviewChange: (open) => {
          root.toggleClass("goodobsidian-overview-open", open);
          if (!open) this.closeSidebarAfterOverview();
        },
        listFiles: (kind) => this.listNotebookFiles(kind),
        onOpenFile: (kind, row) => this.openNotebookFile(kind, row),
        onFileKind: (kind) => (lastFileKind = kind),
      },
      this.sidebarRendering(this.thumbBackdrops),
    );
    this.sidebar.setFileKind(lastFileKind);
    this.sidebar.setDocument(this.doc);
    // Between the page sidebar and the page, which it pushes aside.
    this.chatPanel = new AskChatPanel(this.app, body, {
      host: () => this.askHost(),
      onClose: () => this.setChatPanel(false),
      switchLayout: () => {
        this.setChatPanel(false);
        this.setAskLayout("window");
        this.openAsk();
      },
    });

    this.surface = new InkSurface(
      body,
      this.doc,
      this.toolState,
      {
        desynchronizedCanvas: this.settings.desynchronizedCanvas,
        highlighterAlpha: this.settings.highlighterAlpha,
        debug: this.showHud,
        palette,
        paper: this.shownPaper(),
      },
      {
        onRecentColors: (colors) => this.plugin.saveRecentColors(colors),
        onSaveSticker: (png, width, height) => void this.saveSticker(png, width, height),
        onEditGraph: (pageId, graph) => this.editGraph(pageId, graph),
        onChange: (pages) => {
          if (this.surface) this.sidebar?.setDocument(this.surface.document);
          // Undoing or redoing "Convert to notebook" flips `single`.
          this.syncSingle();
          // …and undo can take a recording off the note, or bring one back.
          this.audio?.syncChrome();
          this.scheduleAutoTranscription();
          this.scheduleDeviceReading();
          this.requestSaveOf(pages);
          this.relinkMovedFiles();
        },
        // The zoom or the screen changed: keep PDF pages as sharp as the ink.
        onStatus: () => this.matchPdfResolution(),
        onPen: (down) => this.penActivity(down),
        onStrokeDrawn: (pageId) => this.calcNotes.strokeDrawn(pageId),
        isLocked: () => this.isProtected(),
        returnToPenOnReselect: () => this.settings.returnToPenOnReselect === true,
        returnToPenAfterUse: () => this.settings.returnToPenAfterUse === true,
        straightenHighlighter: () => this.settings.straightHighlighter !== false,
        textDragSize: () => this.settings.textDragSize === true,
        fingerTapUndo: () => this.settings.fingerTapUndo !== false,
        onlyStylusMode: () => this.settings.onlyStylusMode === true,
        onShortcuts: () => this.toggleShortcuts(),
        onSavedPen: (index) => {
          const pen = savedPensOf(this.settings.savedPens)[index];
          if (pen && !this.isProtected()) this.toolbar?.applySavedPen(pen);
        },
        barrelAction: () => this.settings.barrelButton,
        onToolChange: (tool) => {
          this.toolbar?.setState(this.toolState);
          if (tool === "text" && this.surface) this.plugin.offerTextHint(this.surface);
        },
        onSizeScale: () => this.toolbar?.refreshSizeMarks(),
        onPageChange: (index) => {
          this.sidebar?.setCurrentPage(index);
          this.scheduleLastPage();
          this.scheduleWordCheck();
        },
        onFlaggedWord: (index, strokeIds, at) => this.askAboutWord(index, strokeIds, at),
        onReadingPoint: (index, y) => this.sidebar?.setReadingPoint(index, y),
        onAddSection: (index, at, strokeIds) => this.addSection(index, at, strokeIds),
        onLinkStrokes: (index, strokeIds, current) => this.linkInk(index, strokeIds, current),
        onMakeTask: (index, strokeIds) => this.makeInkTask(index, strokeIds),
        onTurnIntoText: (index, strokeIds) => this.turnIntoText(index, strokeIds),
        onOpenLink: (target) => this.openInkLink(target),
        onTapComment: (index, comment) => this.openComment(index, comment),
        onAddComment: (index, at) => {
          if (this.isProtected()) return;
          new CommentModal(this.app, null, index + 1, {
            save: (text) => this.addComment(index, at, text, "you"),
          }).open();
        },
        onSuggestedLink: (index, strokeIds, target) => this.linkInk(index, strokeIds, null, target),
        onHistoryChange: (canUndo, canRedo) => this.toolbar?.setHistoryState(canUndo, canRedo),
        onAddPageRequested: (afterIndex) => this.addPage(afterIndex, true),
        // Pulled past the last page: a blank page on the last page's paper,
        // then glide onto it, as GoodNotes does.
        onPullAddPage: () => this.addPage(this.doc.pages.length - 1, true),
        onPinchOverview: (snapshot) => this.openOverviewFromPinch(snapshot),
        onTextEditing: (style) => this.toolbar?.setTextTarget(style),
        onTextAnchor: (rect) => this.toolbar?.setTextAnchor(rect),
        textPillState: () => this.toolbar?.textPillState ?? "-",
        // A copied picture also goes to the system clipboard, for other apps;
        // one pasted from there comes in as any other picture does.
        onCopyImage: (image) => copyPictureToSystemClipboard(this.app, image),
        onPasteImage: (file, at) => void this.pastePictureFile(file, at),
      },
    );
    this.surface.setBackdropPainter(this.backdrops);
    this.surface.toastChrome = () => this.toolbar?.chromeSpans() ?? [];
    this.surface.setNotebookTitle(this.notebookTitle());
    this.setPenCursor(this.settings.penCursor);
    this.surface.setInkPressure(this.settings.pressureWidth);
    this.pdfText?.destroy();
    this.pdfText = new PdfTextCache(this.app);
    // A finger tap on a PDF link that waited for the page to be read.
    this.pdfText.onReady = (path, page) => this.surface?.pdfTextReady(path, page);
    this.surface.setTextSource(this.pdfText);
    // Audio (0.5). Strokes are stamped on the recorder's clock, so ink and
    // audio share one timeline even if the wall clock jumps mid-recording.
    const audio = new NoteAudio({
      app: this.app,
      plugin: this.plugin,
      file: () => this.file,
      surface: () => this.surface,
      toolbar: () => this.toolbar,
      isLocked: () => this.guard.locked,
    });
    this.audio = audio;
    // The recordings live in the page sidebar's Audio tab, as in GoodNotes.
    audio.attachPanel(this.sidebar.audioEl);
    this.surface.setClock(() => audio.now());
    this.registerDomEvent(document, "visibilitychange", () => {
      const hidden = document.visibilityState === "hidden";
      // A page read while the app is away is not blamed if iPadOS ends it.
      this.plugin.readingGuard.setHidden(hidden);
      if (!hidden) return;
      this.audio?.onHidden();
      // iPadOS may end the app from the background: keep the page now, and
      // a save the pen put off or one still in the background, made here
      // on the main thread, as it may not get another chance.
      this.recordLastPage();
      if (this.writeHold.savePending || this.saver.busy) void this.saveNow(false, true);
    });
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.lastPageFileMoved(oldPath, file.path)),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.lastPageFileMoved(file.path, null)),
    );
    // Only what shows the page that landed is redrawn (FineNotes#1).
    this.pdfCache.onReady = (path, page, area) => {
      this.surface?.pdfPageReady(path, page, area);
      if (!area?.region) this.sidebar?.invalidatePdfPage(path, page);
      // My templates' previews in an open template picker or Add page popover.
      if (!area?.region) this.templatePicker?.paperReady(path);
      if (!area?.region) this.addPagePopover?.popover.paperReady(path);
    };
    this.backdrops.setDeviceScale(this.surface.deviceScale);
    this.surface.setImagePainter(this.images);
    // A decoded picture repaints only the tiles and thumbnails that show it.
    this.images.onReady = (path) => {
      this.surface?.imageReady(path);
      this.sidebar?.invalidateImage(path);
    };
    // A picture's file changing under a placed image (synced in, replaced,
    // deleted, renamed away) makes it decode afresh, or show as missing.
    const imageFileChanged = (path: string): void => {
      if (!isImagePath(path) || !this.images?.forget(path)) return;
      this.surface?.imageReady(path);
      this.sidebar?.invalidateImage(path);
    };
    this.registerEvent(this.app.vault.on("create", (file) => imageFileChanged(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => imageFileChanged(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => imageFileChanged(file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        imageFileChanged(oldPath);
        imageFileChanged(file.path);
      }),
    );
    // Likewise a PDF: one moved back, or synced in, is read again instead
    // of staying "missing".
    const pdfFileChanged = (path: string): void => {
      if (/\.pdf$/i.test(path)) this.pdfText?.forget(path);
      if (!/\.pdf$/i.test(path) || !this.pdfCache?.forget(path)) return;
      this.surface?.repaint();
      this.sidebar?.invalidate();
    };
    this.registerEvent(this.app.vault.on("create", (file) => pdfFileChanged(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => pdfFileChanged(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => pdfFileChanged(file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        pdfFileChanged(oldPath);
        pdfFileChanged(file.path);
      }),
    );

    // The text layer, below the pages. What is typed there becomes the
    // note's body, behind the frontmatter it was loaded with.
    const panel = new TextPanel(root);
    panel.load(this.noteBody);
    panel.setOpen(this.textPanelOpen);
    this.registerDomEvent(panel.field, "input", () => {
      this.noteBody = panel.edited();
      this.requestBodySave();
    });
    this.textPanel = panel;

    // A theme change restyles the chrome, and the pages only when their
    // appearance follows Obsidian's theme; the options pill's size follows
    // the theme's metrics.
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.syncPaperTheme();
        this.relayout();
      }),
    );
    // Keyboard shortcuts on the page (undo, delete a selection, and so on).
    this.scope = notebookKeyScope(
      root,
      this.app.scope,
      () => this.app.workspace.getActiveViewOfType(InkView) === this,
      // The page sidebar first: Escape leaves its overview before anything else.
      (event) =>
        this.sidebar?.handleKeyDown(event) || (this.surface?.handleKeyDown(event) ?? false),
    );
    // Paste events go to whatever has focus — often the body, outside this
    // view — so they are heard on the document, and taken only while this
    // is the active view. The surface leaves text fields' pastes alone.
    // Space lets go of the hand wherever the key-up lands, and when the
    // window loses focus, which keeps the key-up from arriving at all.
    this.registerDomEvent(document, "keyup", (e) => this.surface?.handleKeyUp(e));
    this.registerDomEvent(window, "blur", () => this.surface?.setHand(false));
    this.registerDomEvent(document, "paste", (e) => {
      if (this.app.workspace.getActiveViewOfType(InkView) !== this) return;
      this.surface?.handlePaste(e);
    });

    this.registerDomEvent(root, "dragover", (event) => {
      const types = event.dataTransfer?.types ?? [];
      if (
        types.includes("Files") ||
        types.includes("text/plain") ||
        types.includes("text/uri-list")
      )
        event.preventDefault();
    });
    this.registerDomEvent(root, "drop", (event) => void this.handleFileDrop(event));

    // First layout pass: the pill has no measured size until the view is in
    // the document, so its restored position can only be applied after a frame.
    window.requestAnimationFrame(() => this.toolbar?.applyPosition());

    // The file may have loaded before the DOM was built (or not yet at all):
    // either way the chrome follows whatever document is here now.
    this.syncSingle();
    audio.syncChrome();
    this.matchPdfResolution();
  }

  // --- Note settings ----------------------------------------------------------

  // --- Save as template ---------------------------------------------------------

  /** "Save notebook as template": the notebook and its pictures as one `.finetemplate` file. */
  saveAsTemplate(): void {
    const note = this.file;
    if (!note || !this.surface) return;
    new SaveTemplateModal(this.app, { name: stripInkSuffix(note.basename) }, (details) => {
      void this.writeTemplate(details);
    }).open();
  }

  private async writeTemplate(details: TemplateDetails): Promise<void> {
    const doc = this.surface?.document;
    if (!doc) return;
    const progress = new Notice("FineNotes: saving the template…", 0);
    try {
      const paths = new Set<string>();
      for (const page of doc.pages) {
        for (const image of page.images) paths.add(image.path);
        if (page.backdrop.kind === "pdf") paths.add(page.backdrop.path);
      }
      const files = new Map<string, Uint8Array>();
      for (const path of paths) {
        const file = this.app.vault.getFileByPath(path);
        if (file) files.set(path, new Uint8Array(await this.app.vault.readBinary(file)));
      }
      const preview = await this.templatePreview(doc.pages[0]);
      const { bytes, missing } = buildTemplatePackage({
        doc,
        ...details,
        files,
        ...(preview ? { preview } : {}),
      });
      const folder = templateFolderOf(normalizeFolder(this.settings.templateFolder));
      if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
      const taken = new Set(
        this.app.vault.getFolderByPath(folder)?.children.map((child) => child.name) ?? [],
      );
      const safe = details.name.replace(/[^\w .()-]+/g, " ").trim() || "Template";
      const name = uniqueFileName(safe, `.${TEMPLATE_EXTENSION}`, taken);
      // A buffer of its own: the vault takes an ArrayBuffer, not a view on one.
      const buffer = new Uint8Array(bytes).buffer;
      const file = await this.app.vault.createBinary(normalizePath(`${folder}/${name}`), buffer);
      const left = missing.length ? ` ${missing.length} missing picture(s) were left out.` : "";
      new Notice(`FineNotes: saved the template as ${file.path}.${left}`, 8000);
    } catch (error) {
      new Notice(`FineNotes: couldn't save the template — ${errorMessage(error)}`, 8000);
    } finally {
      progress.hide();
    }
  }

  /** The template's first page as a PNG for galleries, drawn as an export draws it. */
  private async templatePreview(page: Page | undefined): Promise<Uint8Array | undefined> {
    if (!page) return undefined;
    const canvas = createEl("canvas");
    try {
      await paintPagePreview(canvas, page, this.previewSources(), 480, 1);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
    } catch {
      return undefined;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  /** Where this note saves new files of `kind`; `undefined` = Obsidian's default. */
  private attachmentFolder(kind: AttachmentKind): string | undefined {
    return resolveAttachmentFolder(this.doc, kind, attachmentDefaults(this.settings));
  }

  /** The toolbar's gear: this notebook's own settings. */
  openNoteSettings(): void {
    const apply = (command: Command): void => {
      // Allowed in a read-only notebook: these are its settings, read-only included.
      if (!this.surface || this.isDamaged()) return;
      // Through the surface's stack, so it saves with the note and undoes.
      this.surface.applyCommand(command);
    };
    new NoteSettingsModal(this.app, {
      single: this.isSinglePage,
      scrollDirection: () => scrollDirectionOf(this.doc),
      setScrollDirection: (direction) => apply(new SetScrollDirection(direction)),
      openPluginSettings: () => this.plugin.openSettingsTab(),
      update: this.plugin.updates.available,
      openUpdate: () => this.plugin.openUpdatePage(),
      updateReminders: () => this.plugin.settings.updateReminders,
      stopUpdateReminders: () => void this.plugin.setUpdateReminders(false),
      furniture: () => ({ ...this.doc.furniture }),
      setFurniture: (furniture) => {
        apply(new SetFurniture(furniture));
        this.sidebar?.setDocument(this.doc);
      },
      readOnly: () => isReadOnly(this.surface?.document ?? this.doc),
      setReadOnly: (on) => apply(new SetReadOnly(on)),
      info: () => this.notebookInfo(),
      rename: (name) => this.renameNotebook(name),
      // The first page as the sidebar shows it: the cover with its title.
      paintCover: async (canvas, cssWidth) => {
        const doc = this.surface?.document ?? this.doc;
        const page = doc.pages[0];
        if (!page || !coverColorOfDocument(doc)) return false;
        await paintPagePreview(
          canvas,
          page,
          this.previewSources(),
          cssWidth,
          window.devicePixelRatio || 1,
        );
        return true;
      },
    }).open();
  }

  /** What the gear's Notebook section shows. */
  private notebookInfo(): NotebookInfo {
    const file = this.file;
    const doc = this.surface?.document ?? this.doc;
    return {
      name: file ? notebookName(file.path) : "",
      pages: doc.pages.length,
      bytes: file?.stat.size ?? 0,
      created: file?.stat.ctime ?? 0,
      modified: file?.stat.mtime ?? 0,
      folder: file?.parent?.path === "/" ? "" : (file?.parent?.path ?? ""),
      cover: coverColorOfDocument(doc),
    };
  }

  /**
   * Rename the notebook from its settings: its own folder when it has one
   * (the notebook follows, main.ts `keepFolderNotebookPaired`), else its file.
   * Through `renameFile`, so links to it follow too.
   */
  private async renameNotebook(name: string): Promise<void> {
    const file = this.file;
    const plan = file ? renamePlan(file.path, name) : undefined;
    if (!plan) return;
    const { vault, fileManager } = this.app;
    const from = vault.getAbstractFileByPath(plan.from);
    if (!from) return;
    if (vault.getAbstractFileByPath(plan.to)) {
      new Notice(`FineNotes: "${plan.to}" already exists. Choose another name.`);
      return;
    }
    try {
      await fileManager.renameFile(from, plan.to);
    } catch (error) {
      new Notice(`FineNotes: could not rename the notebook — ${errorMessage(error)}`, 8000);
    }
  }

  // --- The Files tab ----------------------------------------------------------------

  /**
   * The page sidebar's rows for one kind of file. Pictures, PDFs and
   * recording transcripts are read from the notebook (no folder is scanned);
   * chats and exports from their folders. Asked only when the tab shows them.
   */
  private async listNotebookFiles(kind: FileKind): Promise<FileRow[]> {
    const note = this.file;
    if (!note) return [];
    const doc = this.surface?.document ?? this.doc;
    const { vault } = this.app;
    const exists = (row: FileRow) => vault.getFileByPath(row.path) !== null;
    switch (kind) {
      case "images":
        return notebookImages(doc);
      case "transcripts": {
        const sidecars = [transcriptSidecarPath(note.path), folderNotebookSidecarPath(note.path)]
          .filter((path): path is string => path !== null)
          .map((path) => ({ path, detail: "Handwriting, from the transcript server" }));
        return [...recordingTranscripts(doc), ...sidecars].filter(exists);
      }
      case "chats": {
        const chats = await listChats(this.app, note.path, this.chatsFolder());
        return chats.map((chat) => ({ path: chat.path, detail: chat.title }));
      }
      case "exports": {
        const set = this.attachmentFolder("exports");
        const dir = set === undefined ? note.parent : vault.getFolderByPath(set);
        // Without a folder of their own, exports sit beside the note among
        // other PDFs: keep the ones named after the notebook.
        const title = stripInkSuffix(note.basename).toLowerCase();
        const files = (dir?.children ?? []).filter(
          (child): child is TFile =>
            child instanceof TFile &&
            (set !== undefined || child.name.toLowerCase().startsWith(title)),
        );
        return folderRows(
          files.map((file) => ({
            path: file.path,
            extension: file.extension,
            mtime: file.stat.mtime,
          })),
          ["pdf"],
          (mtime) => new Date(mtime).toLocaleDateString(),
        );
      }
      default:
        return [];
    }
  }

  /** A tapped file row: a picture or PDF turns to its page; anything else opens in a new tab. */
  private openNotebookFile(kind: FileKind, row: FileRow): void {
    if (kind === "images" && row.page !== undefined) {
      this.surface?.goToPage(row.page, true);
      return;
    }
    const file = this.app.vault.getFileByPath(row.path);
    if (!file) {
      new Notice(`FineNotes: ${row.path} is not in the vault any more.`);
      return;
    }
    void this.app.workspace.getLeaf("tab").openFile(file);
  }

  // --- Search and links to a page -----------------------------------------------

  /**
   * The toolbar's search: every page's transcription (text layer and the
   * transcript server's sidecar file) and typed text; a tap on a result
   * turns to its page. Read-only, so a protected note may be searched too.
   */
  async openSearch(): Promise<void> {
    if (!this.file || !this.surface) return;
    const pages = await this.notebookTextIndex();
    new NotebookSearchModal(this.app, {
      index: pages,
      initial: this.lastSearch,
      onQuery: (query) => (this.lastSearch = query),
      goTo: (index, query) => void this.showSearchHits(index, query),
    }).open();
  }

  /**
   * Turn to page `index` and light up what `query` found there (2.5): the
   * handwritten words, from this device's reading of the page (read now if
   * the one kept is out of date) lined up with the page's transcript, and
   * the text boxes. Without on-device
   * reading only the text boxes light up.
   */
  private async showSearchHits(index: number, query: string): Promise<void> {
    // TODO(#46 phase 4): on a board, search flies to the word itself; going
    // to its page shows nothing there, the board being one page.
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page) return;
    surface.setSearchHits(null);
    surface.goToPage(index, true);
    let lines: ReadLine[] = [];
    const hash = pageContentHash(page);
    const kept = this.pageReadings.get(page.id);
    if (kept && kept.hash === hash) lines = kept.readLines;
    else if (this.settings.handwritingOnDevice !== false && page.strokes.length > 0) {
      try {
        const reading = await this.plugin.handwriting.readPage(page.strokes, true);
        if (this.surface !== surface || !surface.document.pages.includes(page)) return;
        lines = this.keepReading(page, hash, reading).readLines;
      } catch {
        // No model, or the page could not be read: the text boxes still light up.
      }
    }
    // The page's transcript finds the words this device misread (2.5.2).
    const transcript = (await this.notebookTextIndex())[index]?.sources
      .filter((source) => source.kind === "handwriting")
      .map((source) => source.text)
      .join("\n");
    if (this.surface !== surface || !surface.document.pages.includes(page)) return;
    const words = lineHits(query, lines, (ids) => inkBounds(page, ids), transcript);
    const { boxes } = pageHits(query, [], page.textBoxes);
    surface.setSearchHits(page.id, words, boxes);
  }

  /**
   * A link with a page in it — `[[Note#Page 3]]`, `#page=3` — opens the
   * notebook at that page. Obsidian hands the link's subpath over here,
   * sometimes before the file's pages have loaded, so it waits for them.
   */
  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const { subpath, pageIndex, match } = (state ?? {}) as {
      subpath?: unknown;
      pageIndex?: unknown;
      match?: { content?: unknown; matches?: unknown };
    };
    // A result of Obsidian's own search: its page, with the words lit up (2.5).
    const found =
      typeof match?.content === "string" && Array.isArray(match.matches)
        ? searchMatchTarget(match.content, match.matches as Array<[number, number]>)
        : null;
    if (found) {
      this.pendingSearch = found;
      this.pendingPageIndex = found.pageIndex;
    } else if (typeof subpath === "string" && subpath) this.pendingSubpath = subpath;
    else if (typeof pageIndex === "number" && Number.isInteger(pageIndex) && pageIndex >= 0) {
      // Back or Forward: the page this note was on then (see getEphemeralState).
      this.pendingPageIndex = pageIndex;
    } else return;
    if (this.loadedPath !== null && this.loadedPath === this.file?.path) this.applyPendingPage();
  }

  /** What Back and Forward come back to: the page being read. */
  override getEphemeralState(): Record<string, unknown> {
    const state = super.getEphemeralState();
    const index = this.surface?.currentPage;
    return index === undefined ? state : { ...state, pageIndex: index };
  }

  /**
   * Put the loaded notebook on its page, once the surface has a size to
   * scroll in: the page a link asked for (`#Page 3`), the page Back returns
   * to, or — the file opened anew here — the page it was left on, at fit
   * zoom, as GoodNotes reopens a notebook (research/goodnotes-smoothness §1).
   */
  private applyPendingPage(attempt = 0): void {
    const surface = this.surface;
    const path = this.loadedPath;
    if (!surface || path === null) return;
    const fresh = path !== this.restoredPath;
    const subpath = this.pendingSubpath;
    const back = this.pendingPageIndex;
    if (!fresh && subpath === null && back === null) return;
    if (surface.surfaceEl.clientHeight === 0 && attempt < 20) {
      // Not laid out yet (a new tab): goToPage would scroll by a scale of nothing.
      window.setTimeout(() => this.applyPendingPage(attempt + 1), 50);
      return;
    }
    this.pendingSubpath = null;
    this.pendingPageIndex = null;
    const pages = surface.document.pages;
    let index: number | null = null;
    if (subpath !== null) index = pageFromSubpath(subpath, pages.length);
    else if (back !== null) index = back < pages.length ? back : null;
    if (fresh) {
      // From now on the page being read is worth remembering for this file.
      this.restoredPath = path;
      // A notebook opened anew starts at fit zoom (a board at 100% on its middle),
      // whatever this leaf showed before.
      surface.showHome();
      index ??= lastPageIndex(this.loadLastPages(), path, pages);
    }
    if (index !== null) surface.goToPage(index);
    const search = this.pendingSearch;
    this.pendingSearch = null;
    if (search && search.pageIndex === index) void this.showSearchHits(index, search.query);
  }

  // --- Where each notebook was left ---------------------------------------------

  private static readonly LAST_PAGES_KEY = "goodobsidian:last-pages";

  /** This device's map of where each notebook was left (vault-scoped local storage). */
  private loadLastPages(): LastPages {
    const raw: unknown = this.app.loadLocalStorage(InkView.LAST_PAGES_KEY);
    if (typeof raw !== "string") return parseLastPages(null);
    try {
      return parseLastPages(JSON.parse(raw));
    } catch {
      return parseLastPages(null);
    }
  }

  private saveLastPages(map: LastPages): void {
    this.app.saveLocalStorage(InkView.LAST_PAGES_KEY, JSON.stringify(map));
  }

  /** The page being read changed: remember it, once the reader settles. */
  private scheduleLastPage(): void {
    window.clearTimeout(this.lastPageTimer);
    this.lastPageTimer = window.setTimeout(() => this.recordLastPage(), LAST_PAGE_DEBOUNCE_MS);
  }

  /**
   * Remember the page being read now. Only once this file has been put on
   * its remembered page: until then the surface reports page 1 of a fresh
   * layout, which must not overwrite where it was left.
   */
  private recordLastPage(): void {
    window.clearTimeout(this.lastPageTimer);
    this.lastPageTimer = 0;
    const path = this.loadedPath;
    const surface = this.surface;
    if (!path || !surface || path !== this.restoredPath || path !== this.file?.path) return;
    const index = surface.currentPage;
    const page = surface.document.pages[index];
    if (!page) return;
    this.saveLastPages(rememberPage(this.loadLastPages(), path, page.id, index, Date.now()));
  }

  /** A note was renamed or deleted: its remembered page follows it, or goes. */
  private lastPageFileMoved(from: string, to: string | null): void {
    const map = this.loadLastPages();
    const next = to === null ? forgetInLastPages(map, from) : renameInLastPages(map, from, to);
    if (next !== map) this.saveLastPages(next);
    if (to !== null && this.loadedPath === from) {
      this.loadedPath = to;
      if (this.restoredPath === from) this.restoredPath = to;
    }
  }

  // --- Export as PDF -----------------------------------------------------------

  /**
   * The share button: export the notebook, the page being read, or chosen
   * pages as a PDF, then open or share it. Saved in the note's "PDF exports"
   * folder (the gear), created if it is missing, or else next to the note.
   * Read-only on the note, but refused while it is protected: its pages may
   * not be the pages on disk.
   */
  exportPdf(chosen?: readonly number[]): void {
    // TODO(#46 phase 4): a board exports as one PDF page the size of its
    // drawing, with no "This page" or "Choose pages"; today it is the whole
    // (mostly empty) page.
    const note = this.file;
    if (this.isDamaged() || !note) return;
    const doc = this.surface?.document ?? this.doc;
    const total = doc.pages.length;
    if (total === 0) return;
    const exports = this.attachmentFolder("exports");
    const folder = exports ?? note.parent?.path ?? "";
    // Read when needed: the folder may be created, or filled, meanwhile.
    const taken = (): Set<string> => {
      const dir = exports === undefined ? note.parent : this.app.vault.getFolderByPath(exports);
      return new Set((dir?.children ?? []).map((child) => child.name));
    };
    const sources = this.previewSources();
    new ExportPdfModal(this.app, {
      noun: this.isSinglePage ? "page" : "notebook",
      pageCount: total,
      currentPage: Math.max(0, Math.min(total - 1, this.surface?.currentPage ?? 0)),
      pageSize: (i) => doc.pages[i]?.geometry ?? { width: 0, height: 0 },
      folder: exports ?? null,
      chosen,
      paintPreview: async (canvas, i, cssWidth) => {
        const page = doc.pages[i];
        if (page)
          await paintPagePreview(canvas, page, sources, cssWidth, window.devicePixelRatio || 1);
      },
      fileNameFor: (pages) =>
        uniqueFileName(exportBaseName(note.basename, pages, total), ".pdf", taken()),
      export: async (pages, onProgress, cancelled) => {
        const bytes = await exportPagesToPdf(
          pages.map((i) => doc.pages[i]),
          sources,
          { title: stripInkSuffix(note.basename), onProgress, cancelled },
        );
        // Named at save time, not when the dialog opened: another export may
        // have taken the name since.
        const name = uniqueFileName(exportBaseName(note.basename, pages, total), ".pdf", taken());
        const path = normalizePath(folder ? `${folder}/${name}` : name);
        if (exports !== undefined && !this.app.vault.getFolderByPath(exports)) {
          try {
            await this.app.vault.createFolder(exports);
          } catch {
            // Created meanwhile.
          }
        }
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        await this.app.vault.createBinary(path, buffer);
        return { path, name, bytes: buffer };
      },
      open: (path) => {
        const file = this.app.vault.getFileByPath(path);
        if (file) void this.app.workspace.getLeaf("tab").openFile(file);
      },
    }).open();
  }

  /** The page in view and its number (1-based), for tools that read its ink. */
  currentPageInk(): { page: Page; number: number } | null {
    const index = this.surface?.currentPage ?? 0;
    const page = this.doc.pages[index];
    return page ? { page, number: index + 1 } : null;
  }

  // --- Single pages -----------------------------------------------------------

  /** Whether the open document is a single page rather than a notebook. */
  /** The notebook as it is now, unsaved changes included. */
  get document(): InkDocument {
    return this.doc;
  }

  get isSinglePage(): boolean {
    return this.doc.single === true;
  }

  /** Whether the open document is an endless board (FineNotes#46); a board is a single page too. */
  get isBoard(): boolean {
    return isBoard(this.doc) && this.doc.pages.length === 1;
  }

  /** A handwriting practice file: kept to writing, its pages and paper fixed. */
  get isPractice(): boolean {
    return this.doc.practice !== undefined;
  }

  /**
   * Make the chrome match the document: a single page shows no "Add page"
   * in the toolbar or the page panel. Called whenever the document is
   * replaced or changed, because one leaf can load a single page and then a
   * notebook, and "Convert to notebook" (or its undo) flips it in place.
   */
  private syncSingle(): void {
    const single = this.isSinglePage;
    const practice = this.isPractice;
    this.toolbar?.setAddPageVisible(!single && !practice);
    // A single page takes no more pages, and a protected note takes no edits.
    this.surface?.setPullToAddPage(!single && !practice && !this.guard.locked);
    // The overview needs pages to show, as its ⤢ does.
    this.surface?.setPinchToOverview(!single && !practice);
    this.sidebar?.setSingle(single, practice);
    // A board's panel is Contents and Files; its ⋯ has no page items (`toggleMorePanel`).
    this.sidebar?.setBoard(this.isBoard);
    // A practice file has the pen and the eraser, and nothing else.
    this.toolbar?.setPractice(practice);
    // A PDF's pages become pages: a board has none to add.
    this.toolbar?.setInsertPdfVisible(!this.isBoard);
    this.surface?.setPractice(practice ? deviceKind() : null);
    if (single || practice) {
      this.addPagePopover?.popover.close();
      this.addPagePopover = null;
    }
  }

  /** A practice file says no to anything but writing; true when it did. */
  private refusePractice(): boolean {
    if (!this.isPractice) return false;
    new Notice("A practice file is for copying its lines: pen and eraser only.");
    return true;
  }

  /** "Convert to notebook": the single page becomes a notebook that takes more pages. Undoable. */
  convertToNotebook(): void {
    // A board stays a board (FineNotes#46): its page is not a sheet to add sheets to.
    if (!this.surface || this.isProtected() || !this.isSinglePage || this.isBoard) return;
    // Through the surface's stack, so Cmd/Ctrl+Z makes it a single page again;
    // its onChange re-syncs the chrome and saves.
    this.surface.applyCommand(new SetSingle(false));
    new Notice("This page is now a notebook: add pages from the toolbar or the page panel.");
  }

  /**
   * Every path that adds a page asks this first. The controls are hidden on
   * a single page, so this only speaks up if something reached one anyway.
   */
  private refuseSinglePage(): boolean {
    if (this.isPractice) {
      new Notice("A practice file keeps its pages as they are.");
      return true;
    }
    if (!this.isSinglePage) return false;
    // A board grows by itself as it is written on (FineNotes#46).
    if (this.isBoard) new Notice("A board has one page, which grows as you write near its edge.");
    else new Notice("This is a single page. Convert it to a notebook to add pages.");
    return true;
  }

  // --- Pages ----------------------------------------------------------------

  // --- Page sidebar ---------------------------------------------------------

  private toggleSidebar(): void {
    if (!this.sidebar) return;
    // Where the page is now, so it can glide from there to its new place.
    const before = this.surface?.pageClientRect() ?? null;
    // The pages take the left of the page from the Ask sidebar.
    if (!this.sidebar.isOpen) this.chatPanel?.close();
    const open = this.sidebar.toggle(true);
    if (open) this.sidebar.setCurrentPage(this.surface?.currentPage ?? 0);
    this.syncSidebarInset();
    // The surface narrows as the panel opens; its ResizeObserver would catch
    // that a frame late, so lay out now and the page never flashes clipped.
    this.surface?.layout();
    // The panel slides in (or out) while the page glides beside it, both
    // GoodNotes' 200 ms `ease`, instead of everything jumping in one frame.
    if (before) this.surface?.glideFrom(before, PANEL_SLIDE_MS);
  }

  /**
   * A pinch closed well past the fit: every page, in the sidebar's overview.
   * A shut sidebar opens under it, without its slide (the overview covers
   * it), and shuts again when the overview closes.
   */
  private openOverviewFromPinch(snapshot: PageSnapshot | null): void {
    const sidebar = this.sidebar;
    if (!sidebar || sidebar.isOverview) return;
    if (!sidebar.isOpen) {
      this.chatPanel?.close();
      sidebar.setOpen(true);
      sidebar.setCurrentPage(this.surface?.currentPage ?? 0);
      this.syncSidebarInset();
      this.surface?.layout();
      this.sidebarForOverview = true;
    }
    sidebar.setOverview(true, true, snapshot);
  }

  /** The overview closed: shut the sidebar a pinch opened for it. */
  private closeSidebarAfterOverview(): void {
    if (!this.sidebarForOverview) return;
    this.sidebarForOverview = false;
    // After the sidebar's own call returns: closing the sidebar also closes
    // the overview, and calls back here halfway through.
    queueMicrotask(() => {
      if (!this.sidebar?.isOpen || this.sidebar.isOverview) return;
      this.sidebar.setOpen(false);
      this.syncSidebarInset();
      this.surface?.layout();
    });
  }

  /** Keep the floating options pill over the page area, right of the sidebar. */
  private syncSidebarInset(): void {
    const open = this.sidebar?.isOpen ?? false;
    this.toolbar?.setThumbnailsOpen(open, open ? (this.sidebar?.el.offsetWidth ?? 0) : 0);
    if (this.chatPanel?.isOpen) this.toolbar?.setLeftInset(this.chatPanel.el.offsetWidth);
  }

  private sidebarRendering(painter: VaultBackdropRenderer): PageSidebarRenderOptions {
    return {
      painter,
      images: this.images ?? undefined,
      // The thumbnails follow the pages: dark with dark pages.
      paper: this.surface?.paperTheme ?? this.shownPaper(),
      usePressure: this.settings.pressureWidth,
      highlighterAlpha: this.settings.highlighterAlpha,
      notebookTitle: this.notebookTitle(),
    };
  }

  private updateSidebarRendering(): void {
    if (this.thumbBackdrops) {
      this.sidebar?.setRenderOptions(this.sidebarRendering(this.thumbBackdrops));
    }
  }

  /**
   * "Link to…" on lassoed ink: pick a note, a heading or a web address, and
   * link those strokes to it as one undo step; or remove their link.
   */
  private linkInk(
    index: number,
    strokeIds: string[],
    current: string | null,
    suggestion?: string,
  ): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    let read: SelectionText | null = null;
    const picker = new LinkSuggestModal(this.app, {
      notes: this.linkableNotes(),
      current,
      chosenFrom: (query) => {
        if (read) this.recordEdits(page, read.words, query);
      },
      choose: (target) => {
        // By identity: the page may move or go while the list is open.
        if (this.isProtected() || this.surface !== surface) return;
        if (!surface.document.pages.includes(page)) return;
        const commands = linkStrokes(surface.document, page, strokeIds, target);
        if (commands.length === 0) return;
        const label = target === null ? "Remove link" : "Link";
        surface.applyCommand(new CompositeCommand(label, commands));
        this.requestSave();
      },
    });
    picker.open();
    // A handwritten [[link]] starts from its name; other new links from what
    // the ink says, read on this device.
    if (suggestion) picker.suggest(suggestion);
    else if (current === null) {
      void this.readSelection(page, strokeIds).then((found) => {
        read = found;
        if (found.text) picker.suggest(found.text, found.fixes);
      });
    }
  }

  /**
   * Turn into › Task (2.5): ask what the ink says, starting from what this
   * device reads in it, and make it a checklist item.
   */
  private makeInkTask(index: number, strokeIds: string[]): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    let read: SelectionText | null = null;
    const modal = new TaskModal(this.app, undefined, (text) => {
      // By identity: the page may move or go while the dialog is open.
      if (this.isProtected() || this.surface !== surface) return;
      if (!surface.document.pages.includes(page)) return;
      if (read) this.recordEdits(page, read.words, text);
      const commands = makeTask(surface.document, page, strokeIds, text);
      if (commands.length === 0) return;
      surface.applyCommand(new CompositeCommand("Task", commands));
      this.requestSave();
    });
    modal.open();
    void this.readSelection(page, strokeIds).then((found) => {
      read = found;
      if (found.text) modal.suggest(found.text, found.fixes);
    });
  }

  /**
   * Turn into › Text (FineNotes#42): ask what the ink says, starting from
   * what this device reads in it, line by line, and replace the ink with a
   * text box saying that. Undo brings the ink back.
   */
  private turnIntoText(index: number, strokeIds: string[]): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    let read: SelectionText | null = null;
    const modal = new InkTextModal(this.app, (text) => {
      // By identity: the page may move or go while the dialog is open.
      if (this.isProtected() || this.surface !== surface) return;
      if (read) this.recordEdits(page, read.words, text);
      if (surface.turnInkIntoText(page, strokeIds, text)) this.requestSave();
    });
    modal.open();
    void this.readSelection(page, strokeIds, true).then((found) => {
      read = found;
      if (found.text) modal.suggest(found.text, found.fixes);
    });
  }

  /** Whether the lasso holds ink that "Turn selection into text" can act on. */
  get hasInkSelected(): boolean {
    return !this.isProtected() && (this.surface?.selectedInk() ?? null) !== null;
  }

  /** The "Turn selection into text" command: Turn into › Text on the lasso selection. */
  turnSelectionIntoText(): void {
    const ink = this.surface?.selectedInk();
    if (ink) this.turnIntoText(ink.index, ink.strokeIds);
  }

  /** The vault's notes for the link picker, most recently changed first. */
  private linkableNotes(): LinkableNote[] {
    const from = this.file?.path ?? "";
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path !== from)
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .map((file) => ({
        path: file.path,
        basename: file.basename,
        linktext: this.app.metadataCache.fileToLinktext(file, from, true),
        headings: (this.app.metadataCache.getFileCache(file)?.headings ?? []).map((h) => h.heading),
      }));
  }

  /**
   * Open where linked ink or a text box's link leads: a page of this
   * notebook by scrolling to it, a note or heading in a new tab, or a web
   * address.
   */
  private openInkLink(target: string): void {
    if (isExternalTarget(target)) {
      window.open(externalUrl(target));
      return;
    }
    const from = this.file?.path ?? "";
    const surface = this.surface;
    if (surface) {
      const index = pageInThisNotebook(
        target,
        surface.document.pages.length,
        (path) => this.app.metadataCache.getFirstLinkpathDest(path, from)?.path === from,
      );
      if (index !== null) {
        surface.goToPage(index, true);
        return;
      }
    }
    void this.app.workspace.openLinkText(target, from, true);
  }

  /**
   * "Add to contents" on a lasso selection: ask for the heading's title and
   * list it in the contents with its page (FineNotes#20).
   */
  private addSection(index: number, at: { x: number; y: number }, strokeIds: string[]): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    let read: SelectionText | null = null;
    const modal = new ContentsTitleModal(
      this.app,
      index,
      undefined,
      (title) => {
        // By identity: the page may move or go while the dialog is open.
        if (this.isProtected() || this.surface !== surface) return;
        if (!surface.document.pages.includes(page)) return;
        const id = nextSectionId(surface.document);
        surface.applyCommand(new SetSection(page, id, { x: at.x, y: at.y, title }));
        this.requestSave();
        if (read) this.recordEdits(page, read.words, title);
      },
      true,
    );
    modal.open();
    // The heading's ink, read on this device, fills the title once it is read.
    void this.readSelection(page, strokeIds).then((found) => {
      read = found;
      if (found.text) modal.suggest(found.text, found.fixes);
    });
  }

  /**
   * What lassoed ink says, read on this device; "" when on-device reading is
   * off, there is no ink, or it cannot be read. Never throws: a suggestion
   * that does not come is no error.
   *
   * When the selection is whole words of the page's latest reading (at the
   * page's content now), their text is used: read alone, a word loses the
   * line around it. Those words are then checked against the word list.
   */
  private async readSelection(
    page: Page,
    strokeIds: readonly string[],
    keepLines = false,
  ): Promise<SelectionText> {
    const none: SelectionText = { text: "", fixes: [], words: [] };
    if (this.settings.handwritingOnDevice === false || strokeIds.length === 0) return none;
    const entry = this.pageReadings.get(page.id);
    if (entry && entry.hash === pageContentHash(page)) {
      const words = selectionWords(entry.words, entry.read, strokeIds);
      if (words) {
        const text = keepLines ? wordsByLine(words) : words.map((w) => w.text).join(" ");
        return { text, fixes: await this.spellingFixes(page, entry, words), words };
      }
    }
    const ids = new Set(strokeIds);
    const strokes = page.strokes.filter((stroke) => ids.has(stroke.id));
    if (strokes.length === 0) return none;
    try {
      const text = await this.plugin.handwriting.readInk(strokes, keepLines);
      return { text, fixes: [], words: [] };
    } catch {
      return none;
    }
  }

  /**
   * "Did you mean …?" for the words of a lassoed selection that would be
   * underlined, from the list words their kept frames fit (lexicon.ts):
   * only below `SUGGEST_MARGIN`, cased like the word as read. When the
   * worker no longer keeps the page, it is read once more to keep it.
   */
  private async spellingFixes(
    page: Page,
    entry: PageWords,
    words: readonly ReadWord[],
    retried = false,
  ): Promise<SpellingFix[]> {
    const file = this.file;
    const lexicon = this.plugin.wordCheck.lexicon();
    if (!file || !lexicon) return [];
    try {
      const flagged = (await this.plugin.wordCheck.flags(file.path, page.id, words)).filter(
        (w) => w.at,
      );
      if (flagged.length === 0) return [];
      // The underlines' own suggestions, when this reading was checked already.
      const checked = this.checkedWords.get(page.id);
      const cached = checked?.hash === entry.hash ? checked.suggestions : undefined;
      const found = new Map<string, LexiconSuggestion | null>();
      const missing = flagged.filter((w) => {
        const hit = cached?.get(strokeKey(w.strokeIds));
        if (hit !== undefined) found.set(strokeKey(w.strokeIds), hit);
        return hit === undefined;
      });
      if (missing.length > 0) {
        const items = missing.map((w) => {
          const at = w.at as NonNullable<ReadWord["at"]>;
          return { line: at.line, text: entry.lines[at.line], start: at.start, end: at.end };
        });
        const results =
          entry.id === undefined
            ? null
            : await this.plugin.handwriting.suggest(entry.id, items, lexicon);
        if (results === null) {
          // Not kept (or never was): read the page again, keeping it, once.
          if (retried || this.deviceBusy) return [];
          this.deviceBusy = true;
          let reading: PageReading;
          try {
            reading = await this.plugin.handwriting.readPage(page.strokes, true);
          } finally {
            this.deviceBusy = false;
          }
          if (pageContentHash(page) !== entry.hash) return [];
          const again = this.keepReading(page, entry.hash, reading);
          const keys = new Set(words.map((w) => strokeKey(w.strokeIds)));
          const same = again.words.filter((w) => keys.has(strokeKey(w.strokeIds)));
          return this.spellingFixes(page, again, same, true);
        }
        missing.forEach((w, i) => found.set(strokeKey(w.strokeIds), results[i] ?? null));
      }
      const fixes: SpellingFix[] = [];
      for (const word of flagged) {
        const hit = found.get(strokeKey(word.strokeIds));
        if (!hit || hit.margin >= SUGGEST_MARGIN || hit.words.length === 0) continue;
        const { cs, ce } = wordCore({ text: word.text, start: 0, end: word.text.length });
        const core = word.text.slice(cs, ce);
        const offered = [...new Set(hit.words.map((w) => matchCase(core, w)))];
        fixes.push({ token: word.text, words: offered.map((w) => replaceCore(word.text, w)) });
      }
      return fixes;
    } catch {
      return [];
    }
  }

  /**
   * The field a lassoed selection filled was confirmed: each read word it
   * corrects (`editedWords`) is recorded as a misread of that word's ink.
   */
  private recordEdits(page: Page, words: readonly ReadWord[], final: string): void {
    const file = this.file;
    if (!file || words.length === 0) return;
    for (const { word, text } of editedWords(words, final)) {
      const ids = new Set(word.strokeIds);
      const strokes = page.strokes.filter((stroke) => ids.has(stroke.id));
      void this.plugin.wordCheck.record(
        { note: file.path, pageId: page.id, word, strokes },
        "misread",
        text,
      );
    }
  }

  /** Rename or remove a section, from its menu in the Contents tab. */
  private sectionAction(action: SectionAction, index: number, section: PageSection): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    if (action === "remove") {
      surface.applyCommand(new SetSection(page, section.id, null));
      this.requestSave();
      return;
    }
    new ContentsTitleModal(
      this.app,
      index,
      section.title,
      (title) => {
        if (this.isProtected() || this.surface !== surface) return;
        const now = page.sections?.find((s) => s.id === section.id);
        if (!surface.document.pages.includes(page) || !now) return;
        surface.applyCommand(new SetSection(page, section.id, { x: now.x, y: now.y, title }));
        this.requestSave();
      },
      true,
    ).open();
  }

  /**
   * One entry of a thumbnail's "…" menu. Each is a single undoable command on
   * the surface's stack, like every other edit.
   */
  private pageAction(action: PageAction, index: number, anchor: HTMLElement): void {
    // Not an edit: a protected note can still be linked to.
    if (action === "copy-link") {
      this.copyPageLink(index);
      return;
    }
    if (this.isProtected()) return;
    const surface = this.surface;
    if (!surface) return;
    const doc = surface.document;
    const page = doc.pages[index];
    if (!page) return;
    switch (action) {
      case "add-before":
      case "add-after":
        this.openAddPage(anchor, index, action === "add-before" ? "before" : "after");
        return;
      case "change-template":
        this.openTemplatePicker("change", index, "after");
        return;
      case "change-cover":
        this.openCoverPicker(anchor, index);
        return;
      case "convert-to-notebook":
        this.convertToNotebook();
        return;
      case "bookmark":
        surface.applyCommand(new SetPageBookmark(page, page.bookmarked !== true));
        break;
      case "tab":
        surface.applyCommand(
          new SetPageTab(page, page.tab ? null : nextTabColor(surface.document)),
        );
        break;
      case "contents":
        // By identity: the page may move or go while the dialog is open.
        new ContentsTitleModal(this.app, index, page.title, (title) => {
          if (this.isProtected() || this.surface !== surface) return;
          if (!surface.document.pages.includes(page)) return;
          surface.applyCommand(new SetPageTitle(page, title));
          this.requestSave();
        }).open();
        return;
      case "contents-remove":
        if (page.title === undefined) return;
        surface.applyCommand(new SetPageTitle(page, null));
        break;
      case "duplicate": {
        if (this.refuseSinglePage()) return;
        const copy = duplicatePageAfter(doc, index);
        if (!copy) return;
        surface.applyCommand(new AddPage(copy.index, copy.page));
        surface.goToPage(copy.index, true);
        break;
      }
      case "move-up":
      case "move-down": {
        const to = action === "move-up" ? index - 1 : index + 1;
        if (to < 0 || to >= doc.pages.length) return;
        surface.applyCommand(new MovePage(index, to));
        surface.goToPage(to, true);
        break;
      }
      case "clear":
        if (page.strokes.length === 0) return;
        surface.applyCommand(new ClearPage(page.id));
        break;
      case "delete":
        if (doc.pages.length <= 1) return;
        surface.applyCommand(new RemovePage(index));
        surface.goToPage(Math.min(index, doc.pages.length - 1));
        new Notice(`Deleted page ${index + 1}. Undo (Cmd/Ctrl+Z) brings it back.`);
        break;
    }
    this.requestSave();
  }

  /**
   * Pages dragged in the sidebar or its overview: `indexes` (page order) to
   * gap `gap`. One page is a `MovePage`, as its menu's Move up and down are;
   * several are one `MovePages`. Either way one undo step, and the page being
   * read stays the page being read (`keepsReading`).
   */
  private movePages(indexes: readonly number[], gap: number): void {
    const surface = this.surface;
    if (!surface || this.isProtected() || this.isSinglePage) return;
    const doc = surface.document;
    const total = doc.pages.length;
    if (indexes.length === 1) {
      const to = moveIndexForGap(indexes[0], gap, total);
      if (to === null) return;
      surface.applyCommand(new MovePage(indexes[0], to));
    } else {
      if (indexes.length === 0 || isNoOpBlockMove(total, indexes, gap)) return;
      surface.applyCommand(new MovePages(this.pagesAt(indexes), gap));
    }
    // Show the new order at once, not after the edit debounce.
    this.sidebar?.flush();
    this.requestSave();
  }

  /** The pages at `indexes`, by identity, for commands that must outlive a reorder. */
  private pagesAt(indexes: readonly number[]): Page[] {
    const pages = this.surface?.document.pages ?? [];
    return indexes.map((i) => pages[i]).filter((page): page is Page => page !== undefined);
  }

  /** Ask where the pages at `indexes` should go: another notebook (FineNotes#33). */
  private chooseNotebookFor(indexes: readonly number[]): void {
    const surface = this.surface;
    const file = this.file;
    if (!surface || !file || this.isDamaged()) return;
    const pages = this.pagesAt(indexes);
    if (pages.length === 0) return;
    let copyOnly: string | null = null;
    if (isReadOnly(surface.document)) {
      copyOnly = "This notebook is read-only, so its pages can be copied but not moved.";
    } else if (pages.length >= surface.document.pages.length) {
      copyOnly = "These are all the pages here, so they can be copied but not moved.";
    }
    new MovePagesModal(this.app, {
      count: pages.length,
      targets: this.plugin.transferTargets(),
      recent: this.plugin.recentTransferTargets(),
      exclude: file.path,
      copyOnly,
      onChoose: (choice) => void this.sendPages(surface, pages, choice),
    }).open();
  }

  /**
   * Copy `pages` into the notebook chosen, then (unless it is a copy) take
   * them out of this one as one undoable step. The copy is made first, so a
   * failure never costs a page. The notice's Undo takes both back.
   */
  private async sendPages(
    surface: InkSurface,
    pages: readonly Page[],
    { destination, copy }: MoveChoice,
  ): Promise<void> {
    if (this.surface !== surface) return;
    const here = pages.filter((page) => surface.document.pages.includes(page));
    if (here.length === 0) return;
    const receipt: TransferReceipt | string =
      destination.kind === "new"
        ? await this.plugin.sendPagesToNewNotebook(destination.title, here)
        : await this.plugin.sendPages(destination.target.path, here);
    if (typeof receipt === "string") {
      new Notice(`FineNotes: ${receipt}`, 8000);
      return;
    }
    this.plugin.rememberTransferTarget(receipt.path);
    let removal: RemovePages | null = null;
    if (
      !copy &&
      this.surface === surface &&
      !isReadOnly(surface.document) &&
      here.length < surface.document.pages.length
    ) {
      removal = new RemovePages(here);
      surface.applyCommand(removal);
      this.sidebar?.flush();
      this.requestSave();
    }
    const moved = removal;
    const message = transferNotice(here.length, receipt.title, moved === null);
    const notice = new Notice(
      createFragment((fragment) => {
        fragment.createSpan({ text: message });
        const undo = fragment.createEl("button", {
          cls: "goodobsidian-notice-action clickable-icon",
          text: "Undo",
        });
        undo.addEventListener("click", () => {
          notice.hide();
          void this.undoTransfer(surface, moved, receipt);
        });
      }),
      10000,
    );
  }

  /** Put the pages back here (if they were moved) and take them out of where they went. */
  private async undoTransfer(
    surface: InkSurface,
    removal: RemovePages | null,
    receipt: TransferReceipt,
  ): Promise<void> {
    if (removal) {
      // Here first: the copy over there is the only other copy of these pages.
      if (this.surface !== surface || !surface.isLatest(removal)) {
        new Notice(
          `FineNotes: this notebook changed since, so the pages stay in ${receipt.title} as well. Delete them there if you do not want them.`,
          10000,
        );
        return;
      }
      surface.undo();
      this.sidebar?.flush();
      this.requestSave();
    }
    try {
      await receipt.undo();
    } catch (error) {
      new Notice(
        `FineNotes: could not take the pages out of ${receipt.title} — ${errorMessage(error)}`,
        8000,
      );
    }
  }

  /**
   * Pages arriving from another notebook (FineNotes#33): added at the end as
   * one undoable step. Returns how to take them out again, or why they cannot
   * come.
   */
  receivePages(pages: readonly Page[]): { undo: () => Promise<void> } | string {
    const surface = this.surface;
    if (!surface) return "that notebook is not ready yet.";
    if (this.isDamaged()) return "that notebook could not be loaded safely.";
    const refusal = transferRefusal(surface.document);
    if (refusal) return refusal;
    const command = new ReceivePages(pages);
    surface.applyCommand(command);
    this.sidebar?.flush();
    this.requestSave();
    return {
      undo: () => {
        if (this.surface === surface) {
          surface.applyCommand(new RemovePages(command.added));
          this.sidebar?.flush();
          this.requestSave();
        }
        return Promise.resolve();
      },
    };
  }

  /** An action from the overview's selection bar, on the pages at `indexes`. */
  private selectionAction(action: SelectionAction, indexes: readonly number[]): void {
    if (action === "export") {
      this.exportPdf(indexes);
      return;
    }
    if (action === "move-to") {
      this.chooseNotebookFor(indexes);
      return;
    }
    const surface = this.surface;
    if (!surface || this.isProtected()) return;
    const pages = this.pagesAt(indexes);
    if (pages.length === 0) return;
    switch (action) {
      case "move-start":
        this.movePages(indexes, 0);
        return;
      case "move-end":
        this.movePages(indexes, surface.document.pages.length);
        return;
      case "duplicate":
        if (this.refuseSinglePage()) return;
        surface.applyCommand(new DuplicatePages(pages));
        break;
      case "bookmark": {
        // Like the page menu: all bookmarked already takes the bookmarks off.
        const on = !pages.every((page) => page.bookmarked === true);
        const label = on ? "Bookmark pages" : "Remove bookmarks";
        surface.applyCommand(
          new CompositeCommand(
            label,
            pages.map((page) => new SetPageBookmark(page, on)),
          ),
        );
        break;
      }
      case "delete": {
        const n = pages.length;
        if (n >= surface.document.pages.length) return;
        const what = n === 1 ? "this page" : `these ${n} pages`;
        void ConfirmModal.confirm(this.app, {
          title: n === 1 ? "Delete 1 page?" : `Delete ${n} pages?`,
          message: `Everything on ${what} goes with it. Undo (Cmd/Ctrl+Z) brings it back.`,
          cta: "Delete",
        }).then((yes) => {
          if (!yes || this.surface !== surface || this.isProtected()) return;
          surface.applyCommand(new RemovePages(pages));
          this.sidebar?.flush();
          this.requestSave();
          new Notice(
            `Deleted ${n === 1 ? "1 page" : `${n} pages`}. Undo (Cmd/Ctrl+Z) brings ${n === 1 ? "it" : "them"} back.`,
          );
        });
        return;
      }
    }
    this.sidebar?.flush();
    this.requestSave();
  }

  /** Copy the PDF text under the highlights on the page in view. */
  copyHighlightedText(): void {
    this.surface?.copyHighlightedText();
  }

  /**
   * Copy a link that opens this notebook on page `index` (0-based), in the
   * vault's own link style: `[[Physics.ink#page=3|Physics, page 3]]`.
   * GoodNotes' address bar always holds one; here `setEphemeralState` reads
   * it back. Defaults to the page being read.
   */
  copyPageLink(index = this.surface?.currentPage ?? 0): void {
    const file = this.file;
    if (!file) return;
    const page = index + 1;
    const link = this.app.fileManager.generateMarkdownLink(
      file,
      "",
      `#page=${page}`,
      pageLinkLabel(file.basename, page),
    );
    void writeSystemText(link).then(
      () => new Notice(`Link to page ${page} copied.`),
      () => new Notice("FineNotes could not use the clipboard here."),
    );
  }

  // --- The ⋯ panel -----------------------------------------------------------

  /**
   * GoodNotes' ⋯ sheet, for the page being read. A second tap on ⋯ closes it.
   * Everything it offers goes through `pageAction`, so it is undoable and
   * refused on a protected note exactly as the sidebar's page menu is.
   */
  private toggleMorePanel(anchor: HTMLElement): void {
    const open = this.morePanel;
    this.morePanel = null;
    if (open?.isOpen) {
      open.close();
      if (open.anchorEl === anchor) return;
    }
    const surface = this.surface;
    if (!surface) return;
    const doc = surface.document;
    const index = Math.max(0, Math.min(doc.pages.length - 1, surface.currentPage));
    const page = doc.pages[index];
    if (!page) return;
    const act = (action: PageAction, at: number, button: HTMLElement = anchor): void =>
      this.pageAction(action, at, button);
    this.morePanel = new MorePanel(
      anchor,
      {
        index,
        total: doc.pages.length,
        bookmarked: page.bookmarked === true,
        titled: page.title !== undefined,
        cover: page.backdrop.kind !== "pdf" && isCoverRuling(page.backdrop.kind),
        single: this.isSinglePage,
        board: this.isBoard,
        fixed: this.isPractice,
        clearable: page.strokes.length > 0,
        darkPages: surface.paperTheme.night === true,
        folded: this.toolbar?.foldedItems() ?? [],
      },
      {
        paintThumbnail: (canvas, at, width) => this.sidebar?.paintThumbnail(canvas, at, width),
        toggleBookmark: (at) => act("bookmark", at),
        editTitle: (at) => act("contents", at),
        copyLink: (at) => act("copy-link", at),
        duplicate: (at) => act("duplicate", at),
        // A cover opens its picker on ⋯ itself: the row it was chosen from is gone.
        saveAsTemplate: (at) => void this.savePageAsTemplate(at),
        changeTemplate: (at) => {
          const target = doc.pages[at];
          const cover =
            !!target && target.backdrop.kind !== "pdf" && isCoverRuling(target.backdrop.kind);
          act(cover ? "change-cover" : "change-template", at);
        },
        goToPage: (at) => surface.goToPage(at, true),
        clear: (at) => act("clear", at),
        remove: (at) => act("delete", at),
        toggleDarkPages: () =>
          void this.plugin.setPageAppearance(surface.paperTheme.night ? "light" : "dark"),
        showShortcuts: () => this.toggleShortcuts(),
        copyHomeLink: () => this.copyHomeLink(),
      },
    );
  }

  /**
   * The `obsidian://open` link to this notebook, for a home-screen shortcut
   * (the Shortcuts app's "Open URLs" on an iPad) or a bookmark.
   */
  copyHomeLink(): void {
    const file = this.file;
    if (!file) return;
    const link = obsidianOpenUri(this.app.vault.getName(), file.path);
    void writeSystemText(link).then(
      () =>
        new Notice(
          "Link copied. On an iPad, paste it into a Shortcuts shortcut's Open URLs, " +
            "then add the shortcut to your Home Screen.",
          8000,
        ),
      () => new Notice("FineNotes could not use the clipboard here."),
    );
  }

  /**
   * The keyboard and stylus shortcuts in a pop-up (? on the page, the
   * command, the ⋯ panel); asked again while it shows, it closes.
   */
  toggleShortcuts(): void {
    const open = this.shortcuts;
    this.shortcuts = null;
    if (open?.shown) {
      open.close();
      return;
    }
    const modal = new ShortcutsModal(this.app, Platform.isMacOS || Platform.isIosApp);
    modal.open();
    this.shortcuts = modal;
  }

  // --- Templates ------------------------------------------------------------

  /**
   * Open GoodNotes' "Add Page" popover on `anchor`, for page `ref`. A second
   * tap on the same control closes it.
   */
  private openAddPage(anchor: HTMLElement, ref: number, position: InsertPosition): void {
    const open = this.addPagePopover;
    this.addPagePopover = null;
    if (open?.popover.isOpen) {
      open.popover.close();
      if (open.anchor === anchor) return;
    }
    if (this.isProtected() || this.refuseSinglePage()) return;
    const at = Math.max(0, Math.min(this.doc.pages.length - 1, ref));
    const page = this.doc.pages[at];
    if (!page) return;
    // A cover is not paper: next to one, offer the notebook's paper.
    const paper = paperPageFor(this.doc.pages, at);
    // A page of My templates is repeated in its own shape.
    const shapeOf = (backdrop: Backdrop): PageGeometry =>
      backdrop.kind === "pdf" && paper ? paper.geometry : page.geometry;
    const popover = new AddPagePopover(anchor, {
      current: paper?.backdrop ?? { kind: "blank" },
      geometry: page.geometry,
      recent: this.loadRecentTemplates(),
      templateNames: this.templateNames(),
      position,
      paintPaper: (canvas, backdrop, cssWidth) =>
        this.paintPaperThumbnail(canvas, backdrop, shapeOf(backdrop), cssWidth),
      onPick: (backdrop, at) => this.addTemplatePage(backdrop, shapeOf(backdrop), at, ref),
      onMore: (at) => this.openTemplatePicker("add", ref, at),
    });
    this.addPagePopover = { popover, anchor };
  }

  /** The full template picker, to add a page or to change page `ref`'s template. */
  private openTemplatePicker(mode: "add" | "change", ref: number, position: InsertPosition): void {
    if (this.isProtected() || this.refusePractice()) return;
    if (mode === "add" && this.refuseSinglePage()) return;
    const page = this.doc.pages[ref];
    if (!page) return;
    // Adding next to a cover preselects the notebook's paper, never the cover.
    const reference = mode === "add" ? paperTemplateFor(this.doc.pages, ref) : page.backdrop;
    const picker = new TemplatePickerModal(this.app, {
      mode,
      initial: reference.kind === "pdf" ? { kind: "blank" } : reference,
      geometry: page.geometry,
      papers: this.paperLibrary(),
      onApplyPaper: (entry) => void this.applyPaper(entry, mode, position, ref),
      onApply: ({ backdrop, geometry }) => {
        if (mode === "add") {
          this.addTemplatePage(backdrop, geometry ?? page.geometry, position, ref);
          return;
        }
        if (!this.surface || this.isProtected()) return;
        this.surface.applyCommand(new SetPageTemplate(page, backdrop, geometry ?? undefined));
        this.rememberTemplate(backdrop);
        this.requestSave();
      },
    });
    this.templatePicker = picker;
    picker.open();
  }

  /**
   * "Save page as template": the page as it looks (paper, ink, text and
   * pictures) made into a PDF by the export, kept in My templates, named
   * after its title in the contents or the notebook and page number.
   */
  async savePageAsTemplate(index: number): Promise<void> {
    const note = this.file;
    const page = this.surface?.document.pages[index];
    const library = this.paperLibrary();
    if (!note || !page || !library) return;
    const name = page.title?.trim() || `${stripInkSuffix(note.basename)} page ${index + 1}`;
    const progress = new Notice("FineNotes: saving the page as a template…", 0);
    try {
      const bytes = await exportPagesToPdf([page], this.previewSources(), { title: name });
      await library.addPdf(bytes, name);
    } catch (error) {
      new Notice(`FineNotes: couldn't save the page as a template — ${errorMessage(error)}`, 8000);
    } finally {
      progress.hide();
    }
  }

  /** The template picker open now, for its previews to follow PDF pages as they render. */
  private templatePicker: TemplatePickerModal | null = null;

  /** My templates (`model/paper-library.ts`), drawn by the thumbnails' painter. */
  private paperLibrary(): VaultPaperLibrary | undefined {
    if (!this.thumbBackdrops) return undefined;
    return new VaultPaperLibrary(
      this.app,
      () => templateFolderOf(normalizeFolder(this.settings.templateFolder)),
      (canvas, backdrop, geometry, cssWidth) =>
        this.paintPaperThumbnail(canvas, backdrop, geometry, cssWidth),
      () => this.plugin.openTemplateGallery(),
      (path) => void this.plugin.openShareTemplate(path),
    );
  }

  /** The names in My templates now, which tell an older notebook's template pages apart. */
  private templateNames(): Set<string> {
    return templateNamesIn(
      this.app,
      templateFolderOf(normalizeFolder(this.settings.templateFolder)),
    );
  }

  /** An empty page with paper `backdrop` (a PDF page or a designed paper), as a thumbnail `cssWidth` wide. */
  private paintPaperThumbnail(
    canvas: HTMLCanvasElement,
    backdrop: Backdrop,
    geometry: PageGeometry,
    cssWidth: number,
  ): void {
    const painter = this.thumbBackdrops;
    if (!painter) return;
    const page: Page = {
      id: "paper",
      kind: "ink",
      geometry,
      backdrop,
      strokes: [],
      images: [],
      textBoxes: [],
    };
    renderPageThumbnail(canvas, page, painter, cssWidth, window.devicePixelRatio || 1, {
      usePressure: false,
      highlighterAlpha: this.settings.highlighterAlpha,
    });
  }

  /**
   * Put a paper from My templates on a new page (`add`) or on page `ref`
   * (`change`). The notebook gets its own copy of the paper's PDF beside it,
   * once (`existingCopy`), and the page takes the paper's shape at the
   * notebook's width.
   */
  private async applyPaper(
    entry: PaperEntry,
    mode: "add" | "change",
    position: InsertPosition,
    ref: number,
  ): Promise<void> {
    const note = this.file;
    const surface = this.surface;
    if (!note || !surface || this.isProtected()) return;
    if (mode === "add" && this.refuseSinglePage()) return;
    const source = this.app.vault.getFileByPath(entry.path);
    if (!source) {
      new Notice("FineNotes: that template's file is gone from the vault.");
      return;
    }
    let path: string;
    try {
      const name = paperName(entry.path);
      const shown = [
        ...new Set(
          surface.document.pages.flatMap((p) =>
            p.backdrop.kind === "pdf" ? [p.backdrop.path] : [],
          ),
        ),
      ].map((shownPath) => ({
        path: shownPath,
        size: this.app.vault.getFileByPath(shownPath)?.stat.size ?? -1,
      }));
      path =
        existingCopy(shown, name, source.stat.size) ??
        (
          await saveImageAttachment(
            this.app,
            {
              bytes: await this.app.vault.readBinary(source),
              mime: "application/pdf",
              ext: "pdf",
              width: 0,
              height: 0,
            },
            `${PAPER_COPY_PREFIX}${name}`,
            note.path,
            this.attachmentFolder("images"),
          )
        ).path;
    } catch (error) {
      new Notice(`FineNotes: couldn't use that template — ${errorMessage(error)}`, 8000);
      return;
    }
    // The view may have changed while the copy saved.
    if (this.surface !== surface || this.file !== note || this.isProtected()) return;
    const page = surface.document.pages[ref];
    if (!page) return;
    const backdrop = paperBackdrop(path, entry.page);
    const geometry = paperGeometry(entry, page.geometry.width);
    if (mode === "add") {
      const doc = surface.document;
      const insert = pageFromTemplate(
        doc,
        insertIndexFor(position, ref, doc.pages.length),
        backdrop,
        geometry,
      );
      surface.applyCommand(new AddPage(insert.index, insert.page));
      surface.goToPage(insert.index, true);
    } else {
      surface.applyCommand(new SetPageTemplate(page, backdrop, geometry));
    }
    this.requestSave();
  }

  /**
   * "Change cover" for cover page `index`: the design × colour picker, hung
   * from the thumbnail's "…" button. Each tap is one undoable `changeCover`
   * (the backdrop through `SetBackdrop`, the title recoloured to match). A
   * second tap on the same button closes it.
   */
  private openCoverPicker(anchor: HTMLElement, index: number): void {
    const open = this.coverPopover;
    this.coverPopover = null;
    if (open?.popover.isOpen) {
      open.popover.close();
      if (open.anchor === anchor) return;
    }
    if (this.isProtected()) return;
    const page = this.doc.pages[index];
    if (!page || page.backdrop.kind === "pdf" || !isCoverRuling(page.backdrop.kind)) return;
    const popover = new CoverPopover(anchor, {
      backdrop: page.backdrop,
      geometry: page.geometry,
      onPick: (backdrop) => {
        if (!this.surface || this.isProtected()) return;
        const now = page.backdrop;
        const same =
          now.kind !== "pdf" &&
          now.kind === backdrop.kind &&
          now.paperColor === backdrop.paperColor;
        if (same) return;
        const command = changeCover(page, backdrop);
        if (command) this.surface.applyCommand(command);
      },
    });
    this.coverPopover = { popover, anchor };
  }

  private addTemplatePage(
    backdrop: Backdrop,
    geometry: PageGeometry,
    position: InsertPosition,
    ref: number,
  ): void {
    if (!this.surface || this.isProtected() || this.refuseSinglePage()) return;
    const doc = this.surface.document;
    const index = insertIndexFor(position, ref, doc.pages.length);
    const insert = pageFromTemplate(doc, index, backdrop, geometry);
    this.surface.applyCommand(new AddPage(insert.index, insert.page));
    // Glide onto the new page, as GoodNotes does after "Add page".
    this.surface.goToPage(insert.index, true);
    if (backdrop.kind !== "pdf") this.rememberTemplate(backdrop);
    this.requestSave();
  }

  // --- Images ---------------------------------------------------------------

  /**
   * The toolbar's image menu, on `anchor`. A second tap on the button closes
   * it. Entries come from `imageMenuEntries()`, so a feature that registered
   * one (see image-menu.ts) appears here without this view knowing of it.
   */
  private openImageMenu(anchor: HTMLElement, pdf = false): void {
    const open = this.imageMenu;
    this.imageMenu = null;
    if (open?.popover.isOpen) {
      open.popover.close();
      if (open.anchor === anchor) return;
    }
    if (this.isProtected() || !this.file) return;
    const entries = pdf
      ? [
          { id: "files", icon: "file-text", label: "From files", run: () => this.importPdf() },
          {
            id: "vault",
            icon: "folder-open",
            label: "From vault",
            run: () => this.importPdf(true),
          },
        ]
      : imageMenuEntries();
    const popover = new ImageMenuPopover(
      anchor,
      entries,
      this.imageMenuContext(),
      pdf ? "Insert PDF" : "Insert image",
    );
    this.imageMenu = { popover, anchor };
  }

  private imageMenuContext(): ImageMenuContext {
    return {
      app: this.app,
      notePath: this.file?.path ?? "",
      host: this.contentEl,
      insertBytes: (bytes, mime, name, options) =>
        this.insertImageBytes(bytes, mime, name, options),
      insertVaultFile: (path, options) => this.insertImageFromVault(path, options),
    };
  }

  /**
   * Stick a note of `color` on page `index`, centred on page point `at`
   * and kept on the page (one `InsertImage`, so Undo takes it back). Unlike
   * a picture it is not selected: the next thing done with a note is
   * writing on it, and a selected one would move under the pen. The paper
   * is painted, so nothing is saved to the vault.
   */
  private insertStickyNote(color: string, index: number, at: { x: number; y: number }): void {
    const surface = this.surface;
    if (!surface || this.isProtected()) return;
    const doc = surface.document;
    const page = doc.pages[index];
    if (!page) return;
    const box = stickyBoxAt(at, STICKY_SIDE, page.geometry.width, page.geometry.height);
    const note = newStickyNote(nextImageId(doc), box, color);
    surface.applyCommand(new InsertImage(page.id, note));
  }

  /**
   * Save picture bytes as an attachment of this note and place them on a
   * page, selected — the one call every way of getting a picture in goes
   * through (Photos, the camera, and later scanning and AI generation).
   *
   * The bytes are decoded and, where it helps, downscaled to 2048 px and
   * re-encoded (JPEG 0.85; PNG when transparent; GIF and SVG untouched — see
   * `prepareImageBytes`). The file lands where the user's attachment setting
   * says, named after `suggestedName` (or "Image <timestamp>" when that is
   * generic). The placement is one `InsertImage`, so Undo takes it back; the
   * attachment file stays in the vault, as Obsidian's own pasted images do.
   *
   * Resolves with the placed element, or `null` when nothing was placed —
   * the note is protected, the view closed, or the bytes are not a picture
   * (a notice tells the user which).
   */
  async insertImageBytes(
    bytes: ArrayBuffer,
    mime: string,
    suggestedName: string,
    options: InsertImageOptions = {},
  ): Promise<ImageElement | null> {
    if (this.isProtected()) return null;
    const note = this.file;
    const surface = this.surface;
    if (!note || !surface) return null;
    const progress = new Notice("FineNotes: adding the picture…", 0);
    try {
      const prepared = await prepareImageBytes(bytes, mime);
      const file = await saveImageAttachment(
        this.app,
        prepared,
        suggestedName,
        note.path,
        this.attachmentFolder("images"),
      );
      if (this.file !== note || this.surface !== surface || this.isProtected()) return null;
      return this.placeImage(file.path, prepared.width, prepared.height, options);
    } catch (error) {
      const message = errorMessage(error);
      new Notice(`FineNotes: couldn't add that picture — ${message}`, 8000);
      return null;
    } finally {
      progress.hide();
    }
  }

  /**
   * A picture pasted from the system clipboard (Cmd/Ctrl+V, or the press
   * menu's Paste, centred on `at`): saved as an attachment and placed like
   * one from Photos. Errors end in a notice.
   */
  private async pastePictureFile(
    file: File,
    at?: { pageIndex: number; x: number; y: number },
  ): Promise<void> {
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch (error) {
      const message = errorMessage(error);
      new Notice(`FineNotes: couldn't paste that picture — ${message}`, 8000);
      return;
    }
    const options = at ? { pageIndex: at.pageIndex, center: { x: at.x, y: at.y } } : {};
    await this.insertImageBytes(bytes, file.type, file.name || "Pasted image", options);
  }

  /**
   * Place a picture that is already in the vault, by its path — nothing is
   * copied, so two notes (or two spots on one page) can show one file.
   * Resolves with the placed element, or `null` (see {@link insertImageBytes}).
   */
  async insertImageFromVault(
    path: string,
    options: InsertImageOptions = {},
  ): Promise<ImageElement | null> {
    if (this.isProtected()) return null;
    const file = this.app.vault.getFileByPath(path);
    const note = this.file;
    const surface = this.surface;
    if (!file || !surface) return null;
    try {
      const bytes = await this.app.vault.readBinary(file);
      const size = await measureImage(bytes, mimeForExtension(file.extension) ?? "");
      if (this.file !== note || this.surface !== surface || this.isProtected()) return null;
      return this.placeImage(file.path, size.width, size.height, options);
    } catch (error) {
      const message = errorMessage(error);
      new Notice(`FineNotes: couldn't place ${file.name} — ${message}`, 8000);
      return null;
    }
  }

  /**
   * Put an image of natural size `width × height` on a page through the
   * surface's undo stack, and select it. By default: the page in view,
   * centred in its visible part, fitted inside 60 % of the page.
   */
  private placeImage(
    path: string,
    width: number,
    height: number,
    options: InsertImageOptions,
  ): ImageElement | null {
    const surface = this.surface;
    if (!surface || this.isProtected()) return null;
    const doc = surface.document;
    const index = Math.max(
      0,
      Math.min(doc.pages.length - 1, options.pageIndex ?? surface.currentPage),
    );
    const page = doc.pages[index];
    if (!page) return null;
    // Centred on a point: the "visible area" is a speck around it.
    const c = options.center;
    const around = c ? { minX: c.x - 1, minY: c.y - 1, maxX: c.x + 1, maxY: c.y + 1 } : null;
    const box =
      options.box ??
      placeImageBox({ width, height }, page.geometry, around ?? surface.visibleRegion(index));
    const image = newImageElement(doc, path, box);
    surface.applyCommand(new InsertImage(page.id, image));
    if (options.select !== false) surface.selectImage(page.id, image.id);
    return image;
  }

  /**
   * File a sticker saved from a selection in the stickers folder's "My
   * stickers" collection, under a free name, and say where it went.
   */
  private async saveSticker(png: ArrayBuffer, width: number, height: number): Promise<void> {
    const note = this.file;
    if (!note) return;
    const folder = `${stickerFolderOf(this.settings.stickerFolder)}/${SAVED_STICKERS_COLLECTION}`;
    try {
      const prepared = { bytes: png, mime: "image/png", ext: "png", width, height };
      const file = await saveImageAttachment(this.app, prepared, "Sticker", note.path, folder);
      new Notice(`FineNotes: saved as a sticker in ${folder} (${file.basename}).`);
    } catch (error) {
      new Notice(`FineNotes: couldn't save the sticker — ${errorMessage(error)}`, 8000);
    }
  }

  /** Import an unchanged PDF attachment or reference an existing vault PDF. */
  importPdf(fromVault = false): void {
    if (this.isProtected() || !this.file || !this.surface || this.refusePractice()) return;
    if (this.isBoard) {
      new Notice("A board has no pages for a PDF's pages. Pictures can go on it.");
      return;
    }
    if (this.isSinglePage) {
      new Notice("Convert this single page to a notebook before importing a PDF.");
      return;
    }
    if (fromVault) {
      new VaultPdfSuggestModal(this.app, (file) => void this.importVaultPdf(file.path)).open();
    } else {
      void pickImageFile(this.contentEl, false, "application/pdf,.pdf").then((file) => {
        if (file) void this.importPdfFile(file);
      });
    }
  }

  async importVaultPdf(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    await this.preparePdfImport(() => this.app.vault.readBinary(file), file.name, path);
  }

  private async handleFileDrop(event: DragEvent): Promise<void> {
    const transfer = event.dataTransfer;
    // A practice file takes handwriting only.
    if (!transfer || this.isPractice) return;
    const isPdf = (file: File) =>
      normalizeMime(file.type) === "application/pdf" || /\.pdf$/i.test(file.name);
    const files = Array.from(transfer.files).filter(
      (file) =>
        isPdf(file) || isImagePath(file.name) || normalizeMime(file.type).startsWith("image/"),
    );
    const path = vaultPathFromDrop(
      transfer.getData("text/plain") || transfer.getData("text/uri-list"),
    );
    const resolved =
      path &&
      (this.app.vault.getFileByPath(path) ??
        this.app.metadataCache.getFirstLinkpathDest(path, this.file?.path ?? ""));
    const vaultFile =
      resolved && (/\.pdf$/i.test(resolved.path) || isImagePath(resolved.path)) ? resolved : null;
    if (!files.length && !vaultFile) return;
    event.preventDefault();
    event.stopPropagation();
    if (vaultFile) {
      if (/\.pdf$/i.test(vaultFile.path)) await this.importVaultPdf(vaultFile.path);
      else await this.insertImageFromVault(vaultFile.path);
      return;
    }
    const note = this.file;
    const surface = this.surface;
    for (const file of files) {
      if (this.file !== note || this.surface !== surface || this.isProtected()) return;
      if (isPdf(file)) await this.importPdfFile(file);
      else {
        try {
          const bytes = await file.arrayBuffer();
          if (this.file !== note || this.surface !== surface || this.isProtected()) return;
          await this.insertImageBytes(bytes, file.type, file.name);
        } catch (error) {
          new Notice(`FineNotes: couldn't read ${file.name} — ${errorMessage(error)}`, 8000);
        }
      }
    }
  }

  private async importPdfFile(file: File): Promise<void> {
    await this.preparePdfImport(() => file.arrayBuffer(), file.name);
  }

  private async preparePdfImport(
    read: () => Promise<ArrayBuffer>,
    name: string,
    savedPath?: string,
  ): Promise<void> {
    const note = this.file;
    const surface = this.surface;
    if (!note || !surface || this.isProtected()) return;
    if (this.isSinglePage) {
      new Notice("Convert this single page to a notebook before importing a PDF.");
      return;
    }
    const progress = new Notice("FineNotes: reading PDF pages…", 0);
    try {
      const bytes = await read();
      const pages = await measurePdfPages(bytes);
      if (this.file !== note || this.surface !== surface || this.isProtected()) return;
      const item: ScanItem = { kind: "pdf", bytes, name, savedPath, pages: [] };
      new PdfImportModal(this.app, name, pages.length, async (indices) => {
        if (this.file !== note || this.surface !== surface || this.isProtected()) return false;
        item.pages = indices.map((page) => ({ ...pages[page], page }));
        return this.insertScans([item], "Import PDF");
      }).open();
    } catch (error) {
      new Notice(`FineNotes: couldn't import PDF — ${errorMessage(error)}`, 8000);
    } finally {
      progress.hide();
    }
  }

  // --- Scanning -------------------------------------------------------------

  /**
   * "Scan document" (the image menu's entry and the command): the scan
   * sheet, and in the same tap the camera — on a desktop, a file picker for
   * a photo taken elsewhere. Must run synchronously inside the user's tap
   * (see `ScanSheet.pickPhoto`); if the picker does not open, the sheet's own
   * Take photo / Choose buttons are a fresh tap.
   */
  scanDocument(): void {
    if (this.isProtected() || !this.file || !this.surface || this.refusePractice()) return;
    const sheet = new ScanSheet(this.app, {
      multiPage: !this.isSinglePage,
      insert: (scans) => this.insertScans(scans),
    });
    sheet.open();
    sheet.pickPhoto(Platform.isMobile);
  }

  /**
   * Save finished scans as attachments of this note and put them in as
   * **one** undo step: new pages after the one in view — a photo scan as a
   * page holding its picture, a PDF as PDF-backed pages, one per PDF page
   * (`buildScanInsert`: `AddPage` + `InsertImage` in one `CompositeCommand`).
   * Not through `insertImageBytes`, which would push an undo step per
   * picture and re-encode a scan that is already encoded. A single page
   * takes a photo scan onto itself instead, and no PDF.
   *
   * A file saved before a later one failed keeps its path, so trying Add
   * again does not save it twice.
   */
  private async insertScans(items: ScanItem[], label?: string): Promise<boolean> {
    const note = this.file;
    if (!note || !this.surface || this.isProtected()) return false;
    const originalSurface = this.surface;
    const now = new Date();
    const photos = items.filter((item) => item.kind === "image").length;
    const saved: SavedItem[] = [];
    let photo = 0;
    for (const item of items) {
      if (item.kind === "pdf") {
        // A single page cannot take a PDF's pages (the sheet does not offer
        // one there); do not leave its file behind in the vault either.
        if (this.isSinglePage) continue;
        // Saved as it came; the source is only ever read afterwards.
        item.savedPath ??= (
          await saveImageAttachment(
            this.app,
            { bytes: item.bytes, mime: "application/pdf", ext: "pdf", width: 0, height: 0 },
            item.name,
            note.path,
            this.attachmentFolder("images"),
          )
        ).path;
        saved.push({ kind: "pdf", path: item.savedPath, pages: item.pages });
        continue;
      }
      const name = scanFileName(now, photo++, photos);
      item.savedPath ??= (
        await saveImageAttachment(this.app, item, name, note.path, this.attachmentFolder("images"))
      ).path;
      saved.push({ path: item.savedPath, width: item.width, height: item.height });
    }
    // Read the surface again: the view may have closed while the files saved.
    const surface = this.surface;
    if (!surface || surface !== originalSurface || this.file !== note || this.isProtected())
      return false;
    const insert = buildScanInsert(surface.document, surface.currentPage, saved, label);
    const first = insert?.placed[0];
    if (!insert || !first) {
      if (this.isSinglePage) {
        new Notice("A PDF adds pages, and this is a single page. Convert it to a notebook first.");
      }
      return false;
    }
    surface.applyCommand(insert.command);
    if (insert.addedPages) surface.goToPage(first.pageIndex, true);
    if (first.imageId) surface.selectImage(first.pageId, first.imageId);
    this.requestSave();
    if (!insert.addedPages) {
      new Notice(
        "This is a single page, so the scan was placed on it. " +
          "Convert it to a notebook to scan into new pages.",
      );
    }
    return true;
  }

  /**
   * Whether the notebook may not be changed now, saying why: its ink failed
   * to load (the load guard), or it was made read-only in its settings.
   * Reading it (searching, exporting, asking about it) goes through
   * `isDamaged` instead.
   */
  private isProtected(): boolean {
    if (this.isDamaged()) return true;
    if (!isReadOnly(this.surface?.document ?? this.doc)) return false;
    // Once every few seconds: a pen held down asks on every sample.
    const now = Date.now();
    if (now - this.readOnlyNoticeAt > READ_ONLY_NOTICE_MS) {
      this.readOnlyNoticeAt = now;
      new Notice(
        "FineNotes: this notebook is read-only. Turn that off in its settings (the gear).",
      );
    }
    return true;
  }

  /** Whether the notebook's ink failed to load, so it must not even be saved over. */
  private isDamaged(): boolean {
    if (!this.guard.locked) return false;
    new Notice(READ_ONLY_NOTICE);
    return true;
  }

  private static readonly RECENT_TEMPLATES_KEY = "goodobsidian:recent-templates";

  private loadRecentTemplates(): SyntheticBackdrop[] {
    const raw: unknown = this.app.loadLocalStorage(InkView.RECENT_TEMPLATES_KEY);
    if (typeof raw !== "string") return [];
    try {
      return parseRecent(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  private rememberTemplate(backdrop: SyntheticBackdrop): void {
    const next = pushRecent(this.loadRecentTemplates(), backdrop);
    this.app.saveLocalStorage(InkView.RECENT_TEMPLATES_KEY, JSON.stringify(next));
  }

  /**
   * Insert a page after `afterIndex`, with the model's `AddPage` command, on
   * the surface's undo stack — so Cmd/Ctrl+Z removes it again.
   */
  private addPage(afterIndex: number, animate = false): void {
    if (this.isProtected() || this.refuseSinglePage()) return;
    const insert = pageToInsertAfter(this.doc, afterIndex, this.templateNames());
    if (!insert || !this.surface) return;
    this.surface.applyCommand(new AddPage(insert.index, insert.page));
    this.surface.goToPage(insert.index, animate);
    this.requestSave();
  }

  /** Keep PDF pages rasterised at the resolution the surface now draws at. */
  private matchPdfResolution(): void {
    if (this.surface && this.backdrops) this.backdrops.setDeviceScale(this.surface.deviceScale);
  }

  /**
   * The toolbar's "Clear page". The page's transcription goes with its ink,
   * and only that page's: the rest of the text layer and everything the user
   * wrote around it stay. Undo brings the ink back, not the transcription;
   * running it again does.
   */
  private clearPage(): void {
    const surface = this.surface;
    const page = this.doc.pages[surface?.currentPage ?? 0];
    if (!surface?.clearStrokes()) return;
    const transcribed = readTextSection(this.noteBody) !== null;
    if (page && transcribed) this.writeTranscripts([{ page, text: "", hash: "" }]);
    // The whole-note hash from before per-page transcription no longer holds.
    this.doc.recognizedHash = undefined;
    this.requestSave();
  }
}

/**
 * The ink of an AI's mark around page box (`x0`, `y0`)-(`x1`, `y1`): a red
 * circle that leaves the box inside it, a red box a little outside it, or a
 * yellow highlighter stroke across it as tall as it. A snapped shape, so it
 * draws as clean geometry and the eraser and lasso take it as any other.
 */
function markStroke(
  doc: InkDocument,
  shape: "circle" | "box" | "highlight",
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Stroke {
  let max = 0;
  for (const page of doc.pages) {
    for (const stroke of page.strokes) {
      const match = /^s(\d+)$/.exec(stroke.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  const id = `s${max + 1}`;
  if (shape === "highlight") {
    const cy = (y0 + y1) / 2;
    return {
      id,
      color: "#ffd43b",
      size: Math.max(8, y1 - y0),
      tool: "highlighter",
      pts: [x0, cy, 0.5, x1, cy, 0.5],
      shape: "line",
    };
  }
  // A circle through the box's corners would cut them: grow it by √2 about
  // its middle, so the ellipse goes round what it marks.
  const grow = shape === "circle" ? Math.SQRT2 : 1.08;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = ((x1 - x0) / 2) * grow + 4;
  const hh = ((y1 - y0) / 2) * grow + 4;
  const preset = shape === "circle" ? "ellipse" : "rect";
  return {
    id,
    color: "#e03131",
    size: 3,
    tool: "pen",
    pts: presetGeometry(preset, { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy + hh }, 0.5),
    shape: preset,
  };
}
