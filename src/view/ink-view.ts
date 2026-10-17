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

import { SetNotebookPalette, paletteOf } from "../model/palette";
import { SetFurniture, furnitureText } from "../model/furniture";
import { SetPageTab, nextTabColor } from "../model/page-tabs";
import { SAVED_STICKERS_COLLECTION } from "./sticker-modal";
import { stickerFolderOf } from "../model/stickers";
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
import { type RenderedPage, renderPageForAi } from "../recognition/page-render";
import { type DeviceReading, aiKeyFolded, buildAiMenu } from "../recognition/ai-menu-model";
import { practiceFiles, writePracticePage } from "./handwriting-learning";
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
import { VaultPaperLibrary } from "./paper-library-host";
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
import { newImageElement, placeImageBox } from "../model/images";
import type { ImageElement, PageSection } from "../model/document";
import { ScanSheet } from "./scan-sheet";
import type { ScanItem } from "./scan-io";
import { type SavedItem, buildScanInsert, scanFileName } from "../model/scan-commands";
import { AiMenuPopover } from "./ai-menu";
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
import { nextDeviceStep } from "../recognition/device-reading";
import type { LinkableNote } from "../search/link-choices";
import { type PageGeometry, type SyntheticBackdrop, isCoverRuling } from "../model/document";
import { paperTemplateFor, parseRecent, pushRecent } from "../model/templates";
import { SetSingle, changeCover } from "../model/notebook-commands";
import { SetAttachmentFolder, attachmentFolder } from "../model/attachment-folders";
import { relinkDocument } from "../model/moved-files";
import { SetScrollDirection, scrollDirectionOf } from "../model/scroll-direction";
import { NoteSettingsModal } from "./note-settings-modal";
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
import { sanitizeTextStyle } from "../model/text-style";
import { DEFAULT_SHAPE_COLOR, parseHexColor, recentColorsOf } from "../model/colors";
import { AddPagePopover, TemplatePickerModal } from "./template-picker";
import { CoverPopover } from "./cover-picker";
import { type PaperTheme, paperTheme } from "../canvas/backdrop";
import { lassoFilterOf, lassoModeOf } from "../canvas/lasso";
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
import { penInksOf } from "../model/pen-inks";
import { addSavedPen, openingTool, savedPenOf, savedPensOf } from "../model/saved-pens";
import { PANEL_SLIDE_MS } from "./motion";
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
import { shownPaperTheme } from "../settings-data";
import { penCursorStyleOf } from "./pen-cursor";
import { errorMessage } from "../util/errors";
import { writeSystemText } from "./system-clipboard";
import { obsidianOpenUri } from "../model/home-link";

/** Quiet time after the page being read changes before it is remembered. */
const LAST_PAGE_DEBOUNCE_MS = 500;

/** Shown when an edit is refused because the note's load was held. */
const READ_ONLY_NOTICE = "FineNotes: this notebook is read-only until its ink loads cleanly.";

/** Shown once when a load is held (see load-guard.ts). */
const HELD_LOAD_NOTICE =
  "FineNotes: this notebook's ink did not load, perhaps because the file has not " +
  "finished syncing. Nothing on disk has changed. The notebook stays read-only until it " +
  "loads cleanly: reopen it once the sync is done.";

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

export class InkView extends TextFileView {
  /** The notebook on screen; a blank one until a file has loaded. */
  private doc: InkDocument;
  /** The note's Markdown outside the ink block: frontmatter, prose, text layer. */
  private noteBody = "";
  /** Whether the note may be saved over, and what to save while it may not. */
  private readonly guard = new LoadGuard();

  /** True from `onOpen` to `onClose`, while the view's DOM exists. */
  private mounted = false;
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private sidebar: PageSidebar | null = null;
  /** The ⋯ panel, while open. */
  private morePanel: MorePanel | null = null;
  /** The keyboard shortcuts pop-up, while it shows. */
  private shortcuts: ShortcutsModal | null = null;
  private addPagePopover: { popover: AddPagePopover; anchor: HTMLElement } | null = null;
  private coverPopover: { popover: CoverPopover; anchor: HTMLElement } | null = null;
  private aiMenu: AiMenuPopover | null = null;
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
    const { body, doc, payload, json } = parseInkFile(data, this.settings.paperWidth);
    const held = this.guard.admit({
      text: data,
      bytesOnDisk: this.file?.stat.size ?? 0,
      decoded: doc !== null,
    });
    if (held) new Notice(HELD_LOAD_NOTICE, 10000);
    this.noteBody = body;
    this.doc = doc ?? this.blankNotebook();
    if (doc && payload !== undefined && !held) this.encoder.remember(payload, json);
    // Files it points at that moved while it was closed (#14), and notes
    // its links lead to that Obsidian renamed in the links list.
    if (doc && !held && this.relinkDoc() + this.adoptRenamedLinks(body) > 0) this.requestSave();
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

  override async onClose(): Promise<void> {
    this.recordLastPage();
    this.audio?.destroy();
    this.audio = null;
    window.clearTimeout(this.transcribeTimer);
    window.clearTimeout(this.deviceTimer);
    this.deviceTimer = 0;
    window.clearTimeout(this.quietTimer);
    this.quietTimer = 0;
    this.saver.stop();
    this.surface?.destroy();
    this.surface = null;
    this.toolbar?.destroy();
    this.toolbar = null;
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
    const page = doc.pages[this.surface?.currentPage ?? 0];
    const items = buildAiMenu({
      setup: this.plugin.aiSetup(),
      pageTranscribable: !!page && hasTranscribableContent(page),
      notebookAskable: doc.pages.some(hasAskableContent),
      multiPage: doc.pages.length > 1,
      recordings: doc.recordings?.length ?? 0,
      device: this.deviceReading(),
    });
    const setup = this.plugin.aiSetup();
    this.aiMenu = new AiMenuPopover(
      anchor,
      items,
      (id) => this.aiActions()[id]?.(),
      aiKeyFolded(setup),
    );
  }

  /** The on-device reader's state for the AI menu; undefined when it is off. */
  private deviceReading(): DeviceReading | undefined {
    if (this.settings.handwritingOnDevice === false) return undefined;
    const progress = this.plugin.learner.progress;
    return {
      learned: this.settings.handwritingModel !== undefined,
      practiceFiles: practiceFiles(this.plugin.learningHost()).length,
      learning: progress ? (100 * progress.step) / progress.steps : null,
    };
  }

  /**
   * What each AI menu entry does, by the id `buildAiMenu` gave it. A new
   * entry (e.g. "transcribe-recording") is one item there and one line here.
   */
  private aiActions(): Record<string, () => void> {
    return {
      "read-page-device": () => void this.plugin.readOnDevice(this),
      learn: () => void this.plugin.learner.start(),
      practice: () => void writePracticePage(this.plugin.learningHost()),
      "device-settings": () => this.plugin.openSettingsTab(),
      "transcribe-recording": () => this.audio?.transcribeFromMenu(),
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
    if (this.isProtected()) return;
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
        const insert = pageToInsertAfter(doc, call.after - 1);
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
        reading = await this.plugin.handwriting.readPage(step.page.strokes);
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
        onEraserChange: (mode, size) => this.plugin.saveEraser(mode, size),
        sizePreviewScales: () => this.surface?.sizePreviewScales() ?? { pen: 1, eraser: 1 },
        onEraserFilterChange: (filter) => this.plugin.saveEraserFilter(filter),
        onLassoChange: (mode, filter) => {
          this.surface?.refreshLassoChrome();
          this.plugin.saveLasso(mode, filter);
        },
        onToggleThumbnails: () => this.toggleSidebar(),
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
        notebookColors: () => paletteOf(this.doc).colors,
        onRecentColors: (colors) => this.plugin.saveRecentColors(colors),
        onPickFromPage: (done) => {
          if (this.surface) this.surface.pickColorFromPage(done);
          else done(null);
        },
        onPenColors: (colors) => this.plugin.savePenColors(colors),
        onPenInks: (inks) => this.plugin.savePenInks(inks),
        onTextToolChange: (style, pinned, dragSize) =>
          this.plugin.saveTextTool(style, pinned, dragSize),
        onInsertImage: (anchor) => this.openImageMenu(anchor),
        onInsertPdf: (anchor) => this.openImageMenu(anchor, true),
        onAi: (anchor) => this.openAiMenu(anchor),
        // Inside the tap: the microphone is only granted from a user gesture.
        onRecord: () => this.audio?.toggleRecording(),
        onSettings: () => this.openNoteSettings(),
        onShare: () => this.exportPdf(),
        onSearch: () => void this.openSearch(),
        onMore: (anchor) => this.toggleMorePanel(anchor),
      },
      {
        defaultSize: this.settings.defaultSize,
        reservedColors: [this.settings.defaultColor, ...this.settings.customColors],
      },
    );

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
        onOverviewChange: (open) => root.toggleClass("goodobsidian-overview-open", open),
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
        isLocked: () => this.isProtected(),
        returnToPenOnReselect: () => this.settings.returnToPenOnReselect === true,
        returnToPenAfterUse: () => this.settings.returnToPenAfterUse === true,
        straightenHighlighter: () => this.settings.straightHighlighter !== false,
        textDragSize: () => this.settings.textDragSize === true,
        fingerTapUndo: () => this.settings.fingerTapUndo !== false,
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
        onPageChange: (index) => {
          this.sidebar?.setCurrentPage(index);
          this.scheduleLastPage();
        },
        onReadingPoint: (index, y) => this.sidebar?.setReadingPoint(index, y),
        onAddSection: (index, at, strokeIds) => this.addSection(index, at, strokeIds),
        onLinkStrokes: (index, strokeIds, current) => this.linkInk(index, strokeIds, current),
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
      // My templates' previews in an open template picker.
      if (!area?.region) this.templatePicker?.paperReady(path);
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
      const folder = normalizeFolder(this.settings.templateFolder) || "FineNotes templates";
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
    return attachmentFolder(this.doc, kind);
  }

  /** The toolbar's gear: where this note's pictures and recordings are saved. */
  openNoteSettings(): void {
    const apply = (command: Command): void => {
      if (!this.surface || this.isProtected()) {
        new Notice(READ_ONLY_NOTICE);
        return;
      }
      // Through the surface's stack, so it saves with the note and undoes.
      this.surface.applyCommand(command);
    };
    new NoteSettingsModal(this.app, {
      single: this.isSinglePage,
      folders: () => ({ ...this.doc.folders }),
      setFolder: (kind, folder) => apply(new SetAttachmentFolder(kind, folder)),
      scrollDirection: () => scrollDirectionOf(this.doc),
      setScrollDirection: (direction) => apply(new SetScrollDirection(direction)),
      openPluginSettings: () => this.plugin.openSettingsTab(),
      furniture: () => ({ ...this.doc.furniture }),
      setFurniture: (furniture) => {
        apply(new SetFurniture(furniture));
        this.sidebar?.setDocument(this.doc);
      },
      palette: () => paletteOf(this.doc),
      setPalette: (palette) => apply(new SetNotebookPalette(palette)),
    }).open();
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
      goTo: (index) => this.surface?.goToPage(index, true),
    }).open();
  }

  /**
   * A link with a page in it — `[[Note#Page 3]]`, `#page=3` — opens the
   * notebook at that page. Obsidian hands the link's subpath over here,
   * sometimes before the file's pages have loaded, so it waits for them.
   */
  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const { subpath, pageIndex } = (state ?? {}) as { subpath?: unknown; pageIndex?: unknown };
    if (typeof subpath === "string" && subpath) this.pendingSubpath = subpath;
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
      // A notebook opened anew starts at fit zoom, whatever this leaf showed before.
      surface.resetView();
      index ??= lastPageIndex(this.loadLastPages(), path, pages);
    }
    if (index !== null) surface.goToPage(index);
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
    const note = this.file;
    if (this.isProtected() || !note) return;
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
    this.sidebar?.setSingle(single, practice);
    // A practice file has the pen and the eraser, and nothing else.
    this.toolbar?.setPractice(practice);
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
    if (!this.surface || this.isProtected() || !this.isSinglePage) return;
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
    new Notice("This is a single page. Convert it to a notebook to add pages.");
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
    const picker = new LinkSuggestModal(this.app, {
      notes: this.linkableNotes(),
      current,
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
      void this.readSelectedInk(page, strokeIds).then((text) => {
        if (text) picker.suggest(text);
      });
    }
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
      },
      true,
    );
    modal.open();
    // The heading's ink, read on this device, fills the title once it is read.
    void this.readSelectedInk(page, strokeIds).then((text) => {
      if (text) modal.suggest(text);
    });
  }

  /**
   * What lassoed ink says, read on this device; "" when on-device reading is
   * off, there is no ink, or it cannot be read. Never throws: a suggestion
   * that does not come is no error.
   */
  private async readSelectedInk(page: Page, strokeIds: readonly string[]): Promise<string> {
    if (this.settings.handwritingOnDevice === false || strokeIds.length === 0) return "";
    const ids = new Set(strokeIds);
    const strokes = page.strokes.filter((stroke) => ids.has(stroke.id));
    if (strokes.length === 0) return "";
    try {
      return await this.plugin.handwriting.readInk(strokes);
    } catch {
      return "";
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

  /** An action from the overview's selection bar, on the pages at `indexes`. */
  private selectionAction(action: SelectionAction, indexes: readonly number[]): void {
    if (action === "export") {
      this.exportPdf(indexes);
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
        fixed: this.isPractice,
        clearable: page.strokes.length > 0,
        darkPages: surface.paperTheme.night === true,
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
    const popover = new AddPagePopover(anchor, {
      // A cover is not paper: next to one, offer the notebook's paper.
      current: paperTemplateFor(this.doc.pages, at),
      geometry: page.geometry,
      recent: this.loadRecentTemplates(),
      position,
      onPick: (backdrop, at) => this.addTemplatePage(backdrop, page.geometry, at, ref),
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
    const painter = this.thumbBackdrops;
    if (!painter) return undefined;
    return new VaultPaperLibrary(
      this.app,
      () => normalizeFolder(this.settings.templateFolder) || "FineNotes templates",
      (canvas, backdrop, geometry, cssWidth) => {
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
      },
      () => this.plugin.openTemplateGallery(),
    );
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
    backdrop: SyntheticBackdrop,
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
    this.rememberTemplate(backdrop);
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
   * True, once the user has been told, while the note is read-only because
   * its load was held. Every edit asks this first.
   */
  private isProtected(): boolean {
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
    const insert = pageToInsertAfter(this.doc, afterIndex);
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
