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

import {
  Notice,
  Platform,
  TextFileView,
  type TFile,
  type WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import { AUTO_RECOGNIZE_IDLE_MS, ICON_INK_VIEW, PALETTE, SIZES, VIEW_TYPE_INK } from "../constants";
import {
  type AttachmentKind,
  type InkDocument,
  type Page,
  type TextBoxElement,
  emptyDocument,
} from "../model/document";
import { buildInkFile, parseInkFile } from "../model/serialize";
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
  updatePageTranscripts,
} from "../recognition/page-transcripts";
import { type RenderedPage, renderPageForAi } from "../recognition/page-render";
import { buildAiMenu } from "../recognition/ai-menu-model";
import {
  type AskScope,
  type ChatImage,
  ASK_MAX_PAGES,
  buildAskSystemPrompt,
  selectAskPages,
} from "../recognition/ai-chat";
import { generatedImageName } from "../recognition/ai-image";
import { nextElementId, textBoxFrame } from "../recognition/ai-placement";
import { type GeneratedPicture, askAi, generateImage, targetLabel } from "../recognition/ai-client";
import { InkSurface } from "./ink-surface";
import { PdfBackdropCache } from "./pdf-backdrop";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import { VaultImageCache } from "./image-cache";
import { measureImage, prepareImageBytes, saveImageAttachment } from "./image-import";
import { copyPictureToSystemClipboard } from "./picture-clipboard";
import {
  ImageMenuPopover,
  type ImageMenuContext,
  type InsertImageOptions,
  imageMenuEntries,
} from "./image-menu";
import { isImagePath, mimeForExtension } from "../canvas/image-raster";
import { newImageElement, placeImageBox } from "../model/images";
import type { ImageElement } from "../model/document";
import { ScanSheet } from "./scan-sheet";
import type { ScanItem } from "./scan-io";
import { type SavedItem, buildScanInsert, scanFileName } from "../model/scan-commands";
import { AiMenuPopover } from "./ai-menu";
import { type AskPages, AskAiModal } from "./ask-ai-modal";
import { GenerateImageModal } from "./generate-image-modal";
import { AddPage, type Command, InsertImage, RemovePage } from "../model/commands";
import {
  AddTextBoxToPage,
  ClearPage,
  MovePage,
  duplicatePageAfter,
  pageToInsertAfter,
  type InsertPosition,
  SetPageBookmark,
  SetPageTemplate,
  insertIndexFor,
  pageFromTemplate,
} from "../model/page-commands";
import { type PageGeometry, type SyntheticBackdrop, isCoverRuling } from "../model/document";
import { paperTemplateFor, parseRecent, pushRecent } from "../model/templates";
import { SetSingle, changeCover } from "../model/notebook-commands";
import { SetAttachmentFolder, attachmentFolder } from "../model/attachment-folders";
import { SetScrollDirection, scrollDirectionOf } from "../model/scroll-direction";
import { NoteSettingsModal } from "./note-settings-modal";
import { ExportPdfModal } from "./export-modal";
import { penGesturesOf } from "../ink/pen-gestures";
import { NotebookSearchModal } from "./search-modal";
import { collectPageText, pageFromSubpath, transcriptSidecarPath } from "../search/notebook-search";
import { exportPagesToPdf, paintPagePreview } from "./pdf-export";
import { exportBaseName } from "../export/page-range";
import { stripInkSuffix, uniqueFileName } from "../model/new-notebook";
import { MorePanel } from "./more-panel";
import { sanitizeTextStyle } from "../model/text-style";
import { DEFAULT_SHAPE_COLOR, parseHexColor, recentColorsOf } from "../model/colors";
import { AddPagePopover, TemplatePickerModal } from "./template-picker";
import { CoverPopover } from "./cover-picker";
import { paperTheme } from "../canvas/backdrop";
import { lassoFilterOf, lassoModeOf } from "../canvas/lasso";
import { eraserFilterOf } from "../ink/stroke-eraser";
import { type PageAction, PageSidebar, type PageSidebarRenderOptions } from "./page-sidebar";
import { Toolbar, type ToolbarState } from "./toolbar";
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
import { errorMessage } from "../util/errors";

/** Quiet time after the page being read changes before it is remembered. */
const LAST_PAGE_DEBOUNCE_MS = 500;

/** Shown when an edit is refused because the note's load was held. */
const READ_ONLY_NOTICE = "FineNotes: this notebook is read-only until its ink loads cleanly.";

/** Shown once when a load is held (see load-guard.ts). */
const HELD_LOAD_NOTICE =
  "FineNotes: this notebook's ink did not load, perhaps because the file has not " +
  "finished syncing. Nothing on disk has changed. The notebook stays read-only until it " +
  "loads cleanly: reopen it once the sync is done.";

/** For toolbar callbacks this view has nothing to do for. */
const ignore = (): void => undefined;

/** The tools as the settings left them, for a view that has just opened. */
function toolStateFrom(s: GoodObsidianSettings): ToolbarState {
  return {
    tool: s.defaultTool,
    color: s.defaultColor,
    size: s.defaultSize,
    pressureEnabled: s.pressureEnabled,
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
    recentColors: recentColorsOf(s.recentColors),
  };
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
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private sidebar: PageSidebar | null = null;
  /** The ⋯ panel, while open. */
  private morePanel: MorePanel | null = null;
  private addPagePopover: { popover: AddPagePopover; anchor: HTMLElement } | null = null;
  private coverPopover: { popover: CoverPopover; anchor: HTMLElement } | null = null;
  private aiMenu: AiMenuPopover | null = null;
  /** The transcription in progress, if any; `cancelled` is set by tapping its notice. */
  private transcription: { cancelled: boolean } | null = null;
  private pdfCache: PdfBackdropCache | null = null;
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
  private images: VaultImageCache | null = null;
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

  /** Whether the input debug overlay is on. */
  private showHud: boolean;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: GoodObsidianPlugin,
  ) {
    super(leaf);
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
    return this.guard.contents(() => buildInkFile(this.noteBody, this.doc));
  }

  /** Obsidian read the file (on open, or because it changed on disk). */
  setViewData(data: string, _clear: boolean): void {
    const { body, doc } = parseInkFile(data, this.settings.paperWidth);
    const held = this.guard.admit({
      text: data,
      bytesOnDisk: this.file?.stat.size ?? 0,
      decoded: doc !== null,
    });
    if (held) new Notice(HELD_LOAD_NOTICE, 10000);
    this.noteBody = body;
    this.doc = doc ?? this.blankNotebook();
    this.loadedPath = this.file?.path ?? null;
    this.textPanel?.load(body);
    if (!this.mounted) return;
    this.showDocument();
    this.matchPdfResolution();
    // A recording still running here means the file changed underneath
    // it: it stops, and joins the document now shown.
    this.audio?.documentReplaced();
    this.applyPendingPage();
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
    if (await this.audio?.finishForUnload()) await this.save();
    await super.onUnloadFile(file);
  }

  override async onClose(): Promise<void> {
    this.recordLastPage();
    this.audio?.destroy();
    this.audio = null;
    window.clearTimeout(this.transcribeTimer);
    this.surface?.destroy();
    this.surface = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.sidebar?.destroy();
    this.sidebar = null;
    this.morePanel?.close();
    this.morePanel = null;
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
    this.backdrops = null;
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
    updates: ReadonlyArray<TranscriptUpdate | { page: Page; text: string; hash: string }>,
  ): void {
    const keys = pageKeys(this.doc.pages);
    const resolved: TranscriptUpdate[] = [];
    for (const update of updates) {
      if (!("page" in update)) {
        resolved.push(update);
        continue;
      }
      const index = this.doc.pages.indexOf(update.page);
      if (index >= 0) resolved.push({ key: keys[index], text: update.text, hash: update.hash });
    }
    const section = updatePageTranscripts(readTextSection(this.noteBody), keys, resolved);
    this.noteBody = writeTextSection(this.noteBody, section);
    this.textPanel?.load(this.noteBody);
    this.requestSave();
  }

  /** The page as the reader sees it, sized for a vision model. */
  private async renderForAi(page: Page): Promise<RenderedPage | null> {
    if (!this.backdrops) return null;
    return renderPageForAi(page, this.backdrops, {
      usePressure: this.toolState.pressureEnabled,
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
      pageAskable: !!page && hasAskableContent(page),
      notebookTranscribable: doc.pages.some(hasTranscribableContent),
      notebookAskable: doc.pages.some(hasAskableContent),
      multiPage: doc.pages.length > 1,
      recordings: doc.recordings?.length ?? 0,
    });
    this.aiMenu = new AiMenuPopover(anchor, items, (id) => this.aiActions()[id]?.());
  }

  /**
   * What each AI menu entry does, by the id `buildAiMenu` gave it. A new
   * entry (e.g. "transcribe-recording") is one item there and one line here.
   */
  private aiActions(): Record<string, () => void> {
    return {
      "transcribe-page": () => void this.transcribeFromMenu("page"),
      "transcribe-notebook": () => void this.transcribeFromMenu("notebook"),
      "transcribe-recording": () => this.audio?.transcribeFromMenu(),
      "ask-page": () => this.openAsk("page"),
      "ask-notebook": () => this.openAsk("notebook"),
      "generate-image": () => this.openGenerateImage(),
      settings: () => this.plugin.openSettingsTab(),
    };
  }

  private async transcribeFromMenu(scope: "page" | "notebook"): Promise<void> {
    const provider = this.plugin.aiTranscriber();
    if (provider.requiresNetwork) {
      const confirmed = await this.plugin.confirmAiSend(
        this.plugin.textAiConfig(),
        scope === "page" ? "Transcribing this page" : "Transcribing the notebook",
        scope === "page"
          ? "an image of the page (its ink, typed text and paper)"
          : "an image of each page that changed since it was last transcribed, one page " +
              "per request,",
      );
      if (!confirmed) return;
    }
    await this.transcribe(provider, scope);
  }

  // --- Ask AI ---------------------------------------------------------------

  private openAsk(scope: AskScope): void {
    if (this.isProtected()) return;
    new AskAiModal(this.app, {
      scope,
      multiPage: this.doc.pages.length > 1,
      sourcePath: this.file?.path ?? "",
      describe: (s) => this.describeAsk(s),
      confirm: () =>
        this.plugin.confirmAiSend(
          this.plugin.textAiConfig(),
          "Asking about your notes",
          "images of the pages you ask about, together with your question,",
        ),
      prepare: (s) => this.collectAskPages(s),
      ask: (turns) => askAi(this.plugin.textAiConfig(), buildAskSystemPrompt(), turns),
      insert: (text) => this.insertAnswer(text),
    }).open();
  }

  /** Which pages a question sends, as indexes. */
  private askPageIndexes(scope: AskScope): number[] {
    const current = this.surface?.currentPage ?? 0;
    if (scope === "page") return this.doc.pages[current] ? [current] : [];
    return selectAskPages(this.doc.pages.map(hasAskableContent), current);
  }

  private describeAsk(scope: AskScope): string {
    const target = targetLabel(this.plugin.textAiConfig());
    const indexes = this.askPageIndexes(scope);
    if (scope === "page") {
      return `Sends page ${indexes[0] + 1} as an image, with your question, to ${target}.`;
    }
    const withContent = this.doc.pages.filter(hasAskableContent).length;
    const limit =
      withContent > indexes.length
        ? ` At most ${ASK_MAX_PAGES} pages go with a question — the ones nearest this page.`
        : "";
    return (
      `Sends ${indexes.length} page${indexes.length === 1 ? "" : "s"} as images, with your ` +
      `question, to ${target}.${limit}`
    );
  }

  private async collectAskPages(scope: AskScope): Promise<AskPages> {
    const images: ChatImage[] = [];
    const pageNumbers: number[] = [];
    for (const index of this.askPageIndexes(scope)) {
      const page = this.doc.pages[index];
      if (!page) continue;
      const rendered = await this.renderForAi(page);
      if (!rendered) continue;
      images.push({ base64: rendered.base64, mimeType: "image/png" });
      pageNumbers.push(index + 1);
    }
    return { images, pageNumbers, totalPages: this.doc.pages.length };
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
        onToolChange: (tool) => {
          this.surface?.setTool(tool);
          if (tool === "text" && this.surface) this.plugin.offerTextHint(this.surface);
        },
        // The toolbar writes colour and size into the shared tool state,
        // which is where the surface reads them.
        onColorChange: ignore,
        onSizeChange: ignore,
        onPressureToggle: () => this.updateSidebarRendering(),
        onUndo: () => this.surface?.undo(),
        onRedo: () => this.surface?.redo(),
        onClear: () => this.clearPage(),
        onAddPage: (anchor) => this.openAddPage(anchor, this.surface?.currentPage ?? 0, "after"),
        onPenTypeChange: () => this.toolbar?.syncActive(),
        onEraserChange: (mode, size) => this.plugin.saveEraser(mode, size),
        onEraserFilterChange: (filter) => this.plugin.saveEraserFilter(filter),
        onLassoChange: (mode, filter) => this.plugin.saveLasso(mode, filter),
        onToggleThumbnails: () => this.toggleSidebar(),
        onTextStyle: (patch) => this.surface?.applyTextStyle(patch),
        onTextList: (kind) => void this.surface?.applyTextList(kind),
        onTextDelete: () => void this.surface?.deleteEditingTextBox(),
        onPenAutoShapeChange: (enabled) => this.plugin.savePenAutoShape(enabled),
        onPenGesturesChange: (gestures) => this.plugin.savePenGestures(gestures),
        onShapeColorChange: (color) => this.plugin.saveShapeColor(color),
        onRecentColors: (colors) => this.plugin.saveRecentColors(colors),
        onTextToolChange: (style, pinned, dragSize) =>
          this.plugin.saveTextTool(style, pinned, dragSize),
        onInsertImage: (anchor) => this.openImageMenu(anchor),
        onAi: (anchor) => this.openAiMenu(anchor),
        // Inside the tap: the microphone is only granted from a user gesture.
        onRecord: () => this.audio?.toggleRecording(),
        onSettings: () => this.openNoteSettings(),
        onShare: () => this.exportPdf(),
        onSearch: () => void this.openSearch(),
        onMore: (anchor) => this.toggleMorePanel(anchor),
      },
      { defaultSize: this.settings.defaultSize },
    );

    this.pdfCache = new PdfBackdropCache(this.app);
    this.backdrops = new VaultBackdropRenderer(this.pdfCache);
    this.images = new VaultImageCache(this.app);

    const body = root.createDiv({ cls: "goodobsidian-body" });
    this.sidebar = new PageSidebar(
      body,
      {
        // A tapped thumbnail glides to its page, as GoodNotes does.
        onSelectPage: (index) => this.surface?.goToPage(index, true),
        onPageAction: (action, index, anchor) => this.pageAction(action, index, anchor),
        onAddPage: (anchor) => this.openAddPage(anchor, this.doc.pages.length - 1, "last"),
        onClose: () => {
          if (this.sidebar?.isOpen) this.toggleSidebar();
        },
      },
      this.sidebarRendering(this.backdrops),
    );
    this.sidebar.setDocument(this.doc);

    this.surface = new InkSurface(
      body,
      this.doc,
      this.toolState,
      {
        desynchronizedCanvas: this.settings.desynchronizedCanvas,
        highlighterAlpha: this.settings.highlighterAlpha,
        debug: this.showHud,
        palette,
      },
      {
        onRecentColors: (colors) => this.plugin.saveRecentColors(colors),
        onChange: () => {
          if (this.surface) this.sidebar?.setDocument(this.surface.document);
          // Undoing or redoing "Convert to notebook" flips `single`.
          this.syncSingle();
          // …and undo can take a recording off the note, or bring one back.
          this.audio?.syncChrome();
          this.scheduleAutoTranscription();
          this.requestSave();
        },
        // The zoom or the screen changed: keep PDF pages as sharp as the ink.
        onStatus: () => this.matchPdfResolution(),
        isLocked: () => this.isProtected(),
        onToolChange: (tool) => {
          this.toolbar?.setState(this.toolState);
          if (tool === "text" && this.surface) this.plugin.offerTextHint(this.surface);
        },
        onPageChange: (index) => {
          this.sidebar?.setCurrentPage(index);
          this.scheduleLastPage();
        },
        onHistoryChange: (canUndo, canRedo) => this.toolbar?.setHistoryState(canUndo, canRedo),
        onAddPageRequested: (afterIndex) => this.addPage(afterIndex, true),
        // Pulled past the last page: a blank page on the last page's paper,
        // then glide onto it, as GoodNotes does.
        onPullAddPage: () => this.addPage(this.doc.pages.length - 1, true),
        onTextEditing: (style) => this.toolbar?.setTextTarget(style),
        // A copied picture also goes to the system clipboard, for other apps;
        // one pasted from there comes in as any other picture does.
        onCopyImage: (image) => copyPictureToSystemClipboard(this.app, image),
        onPasteImage: (file) => void this.pastePictureFile(file),
      },
    );
    this.surface.setBackdropPainter(this.backdrops);
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
      if (document.visibilityState !== "hidden") return;
      this.audio?.onHidden();
      // iPadOS may end the app from the background: keep the page now.
      this.recordLastPage();
    });
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.lastPageFileMoved(oldPath, file.path)),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.lastPageFileMoved(file.path, null)),
    );
    this.pdfCache.onReady = () => {
      this.surface?.repaint();
      this.sidebar?.invalidate();
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

    // The text layer, below the pages. What is typed there becomes the
    // note's body, behind the frontmatter it was loaded with.
    const panel = new TextPanel(root);
    panel.load(this.noteBody);
    panel.setOpen(this.textPanelOpen);
    this.registerDomEvent(panel.field, "input", () => {
      this.noteBody = panel.edited();
      this.requestSave();
    });
    this.textPanel = panel;

    // A theme change restyles the chrome, never the paper or the ink, but
    // the options pill's size follows the theme's metrics.
    this.registerEvent(this.app.workspace.on("css-change", () => this.relayout()));
    // Keyboard shortcuts on the page (undo, delete a selection, and so on).
    this.registerDomEvent(root, "keydown", (event) => this.surface?.handleKeyDown(event));
    // Paste events go to whatever has focus — often the body, outside this
    // view — so they are heard on the document, and taken only while this
    // is the active view. The surface leaves text fields' pastes alone.
    this.registerDomEvent(document, "paste", (e) => {
      if (this.app.workspace.getActiveViewOfType(InkView) !== this) return;
      this.surface?.handlePaste(e);
    });

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
    }).open();
  }

  // --- Search and links to a page -----------------------------------------------

  /**
   * The toolbar's search: every page's transcription (text layer and the
   * transcript server's sidecar file) and typed text; a tap on a result
   * turns to its page. Read-only, so a protected note may be searched too.
   */
  async openSearch(): Promise<void> {
    const note = this.file;
    if (!note || !this.surface) return;
    const sidecarPath = transcriptSidecarPath(note.path);
    const sidecarFile = sidecarPath ? this.app.vault.getFileByPath(sidecarPath) : null;
    let sidecar: string | null = null;
    if (sidecarFile) {
      try {
        sidecar = await this.app.vault.cachedRead(sidecarFile);
      } catch {
        // Not synced yet or unreadable: search what the note itself holds.
      }
    }
    const doc = this.surface?.document ?? this.doc;
    new NotebookSearchModal(this.app, {
      index: collectPageText(doc.pages, readTextSection(this.noteBody), sidecar),
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
  exportPdf(): void {
    const note = this.file;
    if (this.isProtected() || !note) return;
    const doc = this.surface?.document ?? this.doc;
    const total = doc.pages.length;
    if (total === 0) return;
    const chosen = this.attachmentFolder("exports");
    const folder = chosen ?? note.parent?.path ?? "";
    // Read when needed: the folder may be created, or filled, meanwhile.
    const taken = (): Set<string> => {
      const dir = chosen === undefined ? note.parent : this.app.vault.getFolderByPath(chosen);
      return new Set((dir?.children ?? []).map((child) => child.name));
    };
    const sources = {
      pdf: this.pdfCache,
      images: this.images,
      paper: paperTheme(false),
      usePressure: this.toolState.pressureEnabled,
      highlighterAlpha: this.settings.highlighterAlpha,
    };
    new ExportPdfModal(this.app, {
      noun: this.isSinglePage ? "page" : "notebook",
      pageCount: total,
      currentPage: Math.max(0, Math.min(total - 1, this.surface?.currentPage ?? 0)),
      pageSize: (i) => doc.pages[i]?.geometry ?? { width: 0, height: 0 },
      folder: chosen ?? null,
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
        if (chosen !== undefined && !this.app.vault.getFolderByPath(chosen)) {
          try {
            await this.app.vault.createFolder(chosen);
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

  // --- Single pages -----------------------------------------------------------

  /** Whether the open document is a single page rather than a notebook. */
  get isSinglePage(): boolean {
    return this.doc.single === true;
  }

  /**
   * Make the chrome match the document: a single page shows no "Add page"
   * in the toolbar or the page panel. Called whenever the document is
   * replaced or changed, because one leaf can load a single page and then a
   * notebook, and "Convert to notebook" (or its undo) flips it in place.
   */
  private syncSingle(): void {
    const single = this.isSinglePage;
    this.toolbar?.setAddPageVisible(!single);
    // A single page takes no more pages, and a protected note takes no edits.
    this.surface?.setPullToAddPage(!single && !this.guard.locked);
    this.sidebar?.setSingle(single);
    if (single) {
      this.addPagePopover?.popover.close();
      this.addPagePopover = null;
    }
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
  }

  private sidebarRendering(painter: VaultBackdropRenderer): PageSidebarRenderOptions {
    return {
      painter,
      images: this.images ?? undefined,
      paper: paperTheme(false),
      usePressure: this.toolState.pressureEnabled,
      highlighterAlpha: this.settings.highlighterAlpha,
    };
  }

  private updateSidebarRendering(): void {
    if (this.backdrops) this.sidebar?.setRenderOptions(this.sidebarRendering(this.backdrops));
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
      `${stripInkSuffix(file.basename)}, page ${page}`,
    );
    void navigator.clipboard.writeText(link).then(
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
        cover: page.backdrop.kind !== "pdf" && isCoverRuling(page.backdrop.kind),
        single: this.isSinglePage,
        clearable: page.strokes.length > 0,
      },
      {
        paintThumbnail: (canvas, at, width) => this.sidebar?.paintThumbnail(canvas, at, width),
        toggleBookmark: (at) => act("bookmark", at),
        copyLink: (at) => act("copy-link", at),
        duplicate: (at) => act("duplicate", at),
        // A cover opens its picker on ⋯ itself: the row it was chosen from is gone.
        changeTemplate: (at) => {
          const target = doc.pages[at];
          const cover =
            !!target && target.backdrop.kind !== "pdf" && isCoverRuling(target.backdrop.kind);
          act(cover ? "change-cover" : "change-template", at);
        },
        goToPage: (at) => surface.goToPage(at, true),
        clear: (at) => act("clear", at),
        remove: (at) => act("delete", at),
      },
    );
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
    if (this.isProtected()) return;
    if (mode === "add" && this.refuseSinglePage()) return;
    const page = this.doc.pages[ref];
    if (!page) return;
    // Adding next to a cover preselects the notebook's paper, never the cover.
    const reference = mode === "add" ? paperTemplateFor(this.doc.pages, ref) : page.backdrop;
    new TemplatePickerModal(this.app, {
      mode,
      initial: reference.kind === "pdf" ? { kind: "blank" } : reference,
      geometry: page.geometry,
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
    }).open();
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
  private openImageMenu(anchor: HTMLElement): void {
    const open = this.imageMenu;
    this.imageMenu = null;
    if (open?.popover.isOpen) {
      open.popover.close();
      if (open.anchor === anchor) return;
    }
    if (this.isProtected() || !this.file) return;
    const popover = new ImageMenuPopover(anchor, imageMenuEntries(), this.imageMenuContext());
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
    if (!note || !this.surface) return null;
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
   * A picture pasted from the system clipboard (Cmd/Ctrl+V): saved as an
   * attachment and placed like one from Photos. Errors end in a notice.
   */
  private async pastePictureFile(file: File): Promise<void> {
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch (error) {
      const message = errorMessage(error);
      new Notice(`FineNotes: couldn't paste that picture — ${message}`, 8000);
      return;
    }
    await this.insertImageBytes(bytes, file.type, file.name || "Pasted image");
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
    if (!file || !this.surface) return null;
    try {
      const bytes = await this.app.vault.readBinary(file);
      const size = await measureImage(bytes, mimeForExtension(file.extension) ?? "");
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
    const box =
      options.box ?? placeImageBox({ width, height }, page.geometry, surface.visibleRegion(index));
    const image = newImageElement(doc, path, box);
    surface.applyCommand(new InsertImage(page.id, image));
    if (options.select !== false) surface.selectImage(page.id, image.id);
    return image;
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
    if (this.isProtected() || !this.file || !this.surface) return;
    const sheet = new ScanSheet(this.app, {
      multiPage: !this.isSinglePage,
      insert: (scans) => this.insertScans(scans),
    });
    sheet.open();
    sheet.pickPhoto(Platform.isMobile);
  }

  /**
   * "Scanned PDF from Files": the scan sheet with a PDF picker, for a
   * document scanned with the Files app's own "Scan Documents". A single
   * page cannot take a PDF's pages, so it says so instead.
   */
  scanPdf(): void {
    if (this.isProtected() || !this.file || !this.surface) return;
    if (this.isSinglePage) {
      new Notice("A PDF adds pages, and this is a single page. Convert it to a notebook first.");
      return;
    }
    const sheet = new ScanSheet(this.app, {
      multiPage: true,
      insert: (scans) => this.insertScans(scans),
    });
    sheet.open();
    sheet.pickPdf();
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
  private async insertScans(items: ScanItem[]): Promise<boolean> {
    const note = this.file;
    if (!note || !this.surface || this.isProtected()) return false;
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
    if (!surface || this.isProtected()) return false;
    const insert = buildScanInsert(surface.document, surface.currentPage, saved);
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
