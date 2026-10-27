import {
  DEFAULT_GALLERY_URL,
  type GalleryEntry,
  TEMPLATE_EXTENSION,
  readGalleryIndex,
} from "./import/template-package";
import {
  ShareTemplateModal,
  TemplateFileSuggestModal,
  TemplateGalleryModal,
} from "./view/template-ui";
import type { PickedFile } from "./view/import-notebook-modal";
import { mimeForExtension } from "./canvas/image-raster";
import { StickerModal } from "./view/sticker-modal";
import { stickerFileName, stickerFolderOf, stickerSvg } from "./model/stickers";
import { type ShapeToolStyle, readShapeToolStyle } from "./model/shape-style";
import { FileExplorerNotebookButton } from "./view/file-explorer-notebook-button";
import { ExplorerFolderNotebooks } from "./view/explorer-folder-notebooks";
import { WordCheck } from "./view/word-check";
import { followPairRename } from "./model/folder-notebook";
import { DEFAULT_SHAPE_COLOR, parseHexColor, recentColorsOf } from "./model/colors";
import { type PenGestures, penGesturesOf } from "./ink/pen-gestures";
import {
  MarkdownView,
  Notice,
  addIcon,
  getIcon,
  Platform,
  Plugin,
  type RequestUrlResponse,
  requestUrl,
  type TAbstractFile,
  TFile,
  TFolder,
  type ViewState,
  WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import {
  ICON_IMPORT_NOTEBOOK,
  ICON_IMPORT_NOTEBOOK_SVG,
  ICON_NEW_NOTEBOOK,
  ICON_STYLUS_ONLY,
  ICON_STYLUS_ONLY_SVG,
  PREVIOUS_PLUGIN_ID,
  VIEW_TYPE_INK,
} from "./constants";
import { DEFAULT_SETTINGS, GoodObsidianSettingTab, type GoodObsidianSettings } from "./settings";
import { type PageAppearance, shownPaperTheme } from "./settings-data";
import { type PenCursorStyle, penCursorStyleOf } from "./view/pen-cursor";
import { fullScreenGroups, parseFullScreen, storedFullScreen } from "./view/full-screen-model";
import { type PillDock, parsePillDock } from "./view/pill-dock-model";
import { buildInkFile, parseInkFile } from "./model/serialize";
import {
  ReceivePages,
  type TransferTarget,
  prepareTransfer,
  rememberTarget,
  removePagesById,
  transferRefusal,
} from "./model/page-transfer";
import type { RecognitionProvider } from "./recognition/provider";
import { createProviderRegistry, resolveProvider } from "./recognition/registry";
import { MANUAL_PROVIDER_ID } from "./recognition/manual";
import { LlmProvider } from "./recognition/llm";
import { LLM_PROVIDER_ID, type LlmVendor, VENDORS } from "./recognition/llm-request";
import { postJson } from "./recognition/http";
import {
  type KeyStore,
  type SecretStorageLike,
  SecretKeyStore,
  SettingsKeyStore,
  migrateKeys,
} from "./recognition/key-store";
import { type AiSetup, resolveImageVendor } from "./recognition/ai-menu-model";
import { DEFAULT_IMAGE_MODELS, canGenerateImages } from "./recognition/ai-image";
import {
  type AiVendorConfig,
  type ImageConfig,
  assertConfigured,
  targetLabel,
  transcribeAudio,
} from "./recognition/ai-client";
import { audioUnsupportedReason, canTranscribeAudio } from "./recognition/audio-request";
import {
  OPENROUTER_CALLBACK_ACTION,
  buildKeyExchangeRequest,
  buildOpenRouterAuthUrl,
  codeChallenge,
  extractOpenRouterKey,
  generateCodeVerifier,
} from "./recognition/openrouter-auth";
import { ConfirmModal } from "./ui/confirm-modal";
import { WhatsNewModal } from "./ui/whats-new-modal";
import { PLUGIN_PAGE_URL } from "./model/update-check";
import {
  HANDWRITING_FOLDER,
  folderMoves,
  legacyCorrectionsFile,
  movedPath,
  templateFolderOf,
} from "./model/vault-folders";
import { UpdateNotice } from "./view/update-notice";
import { changelogSince, releasedChangelog } from "./changelog";
import { InkView } from "./view/ink-view";
import { MARKDOWN_VIEW_TYPE, ViewRouter, isInkNote, showAs } from "./view/view-routing";
import { PageEmbeds } from "./view/page-embed";
import type { EraserMode } from "./view/toolbar";
import type { EraserFilter } from "./ink/stroke-eraser";
import type { LassoFilter, LassoMode } from "./canvas/lasso";
import type { RulerKind } from "./canvas/ruler-geometry";
import {
  DEFAULT_NOTEBOOK_CHOICES,
  type NotebookChoices,
  buildNewDocument,
  buildPdfNotebook,
  cleanTitle,
  joinVaultPath,
  newNoteBody,
  normalizeFolder,
  notebookPaths,
  parseNotebookChoices,
  parseNotebookTemplate,
  stripInkSuffix,
  targetFolder,
  uniqueFileName,
} from "./model/new-notebook";
import { NewNotebookModal } from "./view/new-notebook-modal";
import { openImportNotebookModal } from "./view/import-notebook-modal";
import {
  type StickerPaths,
  WELCOME_TITLE,
  buildWelcomeNotebook,
  shouldShowWelcome,
  welcomeStickerFiles,
} from "./model/welcome";
import { WelcomeModal } from "./view/welcome-modal";
import { saveImageAttachment } from "./view/image-import";
import { VaultPaperLibrary } from "./view/paper-library-host";
import { PdfBackdropCache } from "./view/pdf-backdrop";
import { VaultBackdropRenderer } from "./view/backdrop-renderer";
import { thumbnailRasterScale } from "./view/page-sidebar";
import { renderPageThumbnail } from "./canvas/renderer";
import { PAPER_COPY_PREFIX, type PaperEntry, paperName } from "./model/paper-library";
import { buildDesignedNotebook } from "./model/paper-design";

/** Where the name a user shares templates under is remembered, on this device. */
const SHARE_AUTHOR_KEY = "finenotes:share-author";
/** The notebooks pages were sent to last, in this device's local storage. */
const RECENT_TARGETS_KEY = "goodobsidian:move-targets";

/** Pages were added to a notebook; `undo` takes exactly those pages (or the new notebook) away. */
export interface TransferReceipt {
  path: string;
  /** What the notebook is called, for the notice. */
  title: string;
  undo: () => Promise<void>;
}
import { FileMoveTracker } from "./view/file-moves";
import { measurePdfPages } from "./view/pdf-pages";
import { VaultPdfSuggestModal } from "./view/pdf-import-modal";
import type { AttachmentFolders, InkDocument, Page } from "./model/document";
import { type ImageMenuContext, registerImageMenuEntry } from "./view/image-menu";
import type { InkSurface } from "./view/ink-surface";
import { GrapeFiles } from "./view/grape-files";
import { StartupLog } from "./view/startup-log";
import { DeviceTranscriber } from "./view/device-transcriber";
import { ModelRegistry } from "./view/model-downloads";
import { HandwritingReader } from "./view/handwriting";
import { ReadingGuard } from "./recognition/reading-guard";
import {
  HandwritingLearner,
  type LearningHost,
  learnedModelPath,
  learnedRecord,
  showRelearnNotice,
  writePracticePage,
  writeSymbolPractice,
} from "./view/handwriting-learning";
import { buildPracticeFile, isSymbolSet } from "./recognition/practice";
import { relearnDue } from "./recognition/hwr/learned-model";
import { NOTEBOOK_FILE_SUFFIX, PRACTICE_FILE_SUFFIX, SINGLE_PAGE_FILE_SUFFIX } from "./constants";
import { DEFAULT_PAGE_GEOMETRY } from "./model/document";
import type { TextStyle } from "./model/text-style";
import { errorMessage } from "./util/errors";
import changelogMd from "../CHANGELOG.md";
import { type PenInks } from "./model/pen-inks";
import { type PenStabilization, penStabilizationOf } from "./model/pen-stabilization";
import { type SavedPen, savedPensOf } from "./model/saved-pens";
import { type ToolbarLayout, normalizeLayout } from "./view/toolbar-layout";
import {
  type CalculatorData,
  parseCalculatorData,
  renameCalculatorHistory,
} from "./model/calculator-store";
import { writeSystemText } from "./view/system-clipboard";

/** How many times the Text tool's hint pill is shown before it stops by itself. */
const TEXT_HINT_SHOWS = 3;

/** The pen in hand is saved once it has been left alone this long, ms: a width slider drags. */
const LAST_PEN_SAVE_MS = 600;

/** How long after the layout is ready a bundled Grape is written to disk: off the startup path. */
const GRAPE_BRIDGE_DELAY_MS = 8000;

/** How long after the layout is ready the daily update check runs: off the startup path. */
const UPDATE_CHECK_DELAY_MS = 20_000;
/** This device's record of the last update check (update-notice.ts). */
const UPDATE_KEY = "finenotes:update-check";

/** How long after load the main thread is watched for stalls (startup-log.ts), and how often. */
const STARTUP_WATCH_MS = 90_000;
const STARTUP_TICK_MS = 250;

/** What the Text tool's hint says: what a tap and a drag do with it. */
const TEXT_HINT = "Tap to add a text box. It grows as you type.";

/**
 * What `runRecognition` transcribes: the notebook view. An interface so the
 * consent logic below does not depend on the view's whole surface.
 */
export interface RecognitionTarget {
  recognize(engine: RecognitionProvider, background?: boolean): Promise<void>;
}

/** Where a key exchange with OpenRouter ended: a key, or what to tell the user. */
type OpenRouterOutcome = { key: string } | { problem: string };

export default class GoodObsidianPlugin extends Plugin {
  private readonly explorerNotebookButton = new FileExplorerNotebookButton(() =>
    this.openNewNotebookDialog(),
  );

  private readonly explorerFolderNotebooks = new ExplorerFolderNotebooks({
    folder: (path) => this.app.vault.getFolderByPath(path),
    open: (file, newTab) => {
      const tab = this.app.workspace.getLeaf(newTab);
      void tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: file.path } });
    },
  });

  private syncExplorerNotebookButton(): void {
    const explorers = this.app.workspace.getLeavesOfType("file-explorer").map((leaf) => leaf.view);
    this.explorerNotebookButton.sync(
      explorers.map((view) => view.containerEl),
      this.settings.showNewNotebookInExplorer,
    );
    this.explorerFolderNotebooks.sync(explorers, this.settings.folderNotebooks);
  }

  override settings!: GoodObsidianSettings;
  /** `![[Notebook#page=3]]` previews in notes; repainted when the page appearance changes. */
  private pageEmbeds: PageEmbeds | null = null;
  /** Transcription engines by id. Manual always; the cloud one is added on load. */
  readonly providers = createProviderRegistry();
  /** Where API keys live: Obsidian's keychain when it has one (see key-store.ts). */
  keys!: KeyStore;

  /**
   * The PKCE secret of the OpenRouter sign-in the user started, until the
   * browser comes back with a code or the settings change under it. Memory
   * only: saved with the settings it would sync to every device and outlive
   * an abandoned sign-in. Losing it (Obsidian restarted meanwhile) just means
   * pressing Connect again.
   */
  private openRouterVerifier: string | null = null;
  private settingTab: GoodObsidianSettingTab | null = null;

  /** True when this vault had no saved settings: a new install, with no news to show. */
  private firstInstall = false;
  /** A save of the pen in hand, waiting for the picking to rest. */
  private lastPenTimer = 0;

  /** Which view each note opens in (see view-routing.ts). */
  private readonly router = new ViewRouter();

  /** Models downloaded on first use, listed under Settings › Models on this device (model-downloads.ts). */
  readonly models = new ModelRegistry(this.app, () => this.pluginDir);

  /** Transcribing recordings on this device: one job at a time (device-transcriber.ts). */
  readonly speech = new DeviceTranscriber({
    app: this.app,
    models: this.models,
    speechSettings: () => ({
      model: this.settings.speechModel,
      language: this.settings.speechLanguage,
    }),
  });

  /** Grape, downloaded on first use, or written from the bundle (grape-files.ts). */
  readonly grape = new GrapeFiles(this.models);
  /** Whether a newer FineNotes is out: the dot on the gear (update-notice.ts). */
  readonly updates = new UpdateNotice({
    current: this.manifest.version,
    enabled: () => this.settings.checkForUpdates,
    remind: () => this.settings.updateReminders,
    load: () => this.app.loadLocalStorage(UPDATE_KEY) as unknown,
    save: (record) => this.app.saveLocalStorage(UPDATE_KEY, record),
  });

  /** The first 90 s: steps and main-thread stalls, for the diagnostics export (startup-log.ts). */
  readonly startup = new StartupLog(() => performance.now());

  /** The on-device handwriting reader, started on first use. */
  readonly handwriting = new HandwritingReader(
    this.app,
    () => ({
      customPath: this.settings.hwrModelPath ?? "",
      // Each Grape reads with the model learned from it, when its file is
      // here and "Read with my learned model" is on. The file decides, not
      // the record: a model put back by hand reads too.
      learnedPath:
        this.settings.useLearnedHandwriting !== false
          ? learnedModelPath(this.pluginDir, false, this.grape.id)
          : "",
    }),
    () => this.grape.source(),
  );

  /**
   * Keeps a page that took the app down while it was read on this device
   * from being read again at every launch (set up in `onload`).
   */
  readingGuard!: ReadingGuard;

  /** Learning the user's handwriting, in the background; one run at a time. */
  readonly learner = new HandwritingLearner(() => this.learningHost());

  /** Checking words read on the device, and the answers to learn from. */
  readonly wordCheck = new WordCheck(this.app, () => this.pluginDir);

  /** This plugin's folder in the vault. */
  get pluginDir(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  /** What learning the user's handwriting needs from the plugin. */
  learningHost(): LearningHost {
    return {
      app: this.app,
      pluginDir: this.pluginDir,
      settings: this.settings,
      saveSettings: () => this.saveSettings(),
      createPracticeFile: (set) => this.createPracticeFile(set),
      reloadReader: () => this.handwriting.dispose(),
      baseId: this.grape.id,
      baseModel: async () => {
        const grape = await this.grape.source("ask");
        return grape ? grape.read() : null;
      },
      openNotebook: (path) => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_INK)) {
          const view = leaf.view;
          if (view instanceof InkView && view.file?.path === path) return view.document;
        }
        return null;
      },
    };
  }

  /** Notes keep pointing at the PDFs, pictures and recordings that move (#14). */
  readonly fileMoves = new FileMoveTracker(this.app, {
    isInkFile: (file) => file instanceof TFile && this.isInkFile(file),
    openNotePaths: () =>
      new Set(this.openNotebooks().flatMap((view) => (view.file ? [view.file.path] : []))),
    relinkOpen: () => {
      for (const view of this.openNotebooks()) view.relinkMovedFiles();
    },
    paperWidth: () => this.settings.paperWidth,
  });

  /** The transcription engine chosen in the settings; Manual when it is gone. */
  activeProvider(): RecognitionProvider {
    return resolveProvider(this.providers, this.settings.recognitionProviderId);
  }

  override async onload(): Promise<void> {
    this.startup.mark("onload");
    this.watchStartup();
    // Each vendor reads only its own key slot, so a cloud key can never reach
    // an arbitrary user-configured URL (the custom endpoint has a slot of its own).
    // Registered before the settings load, which check the saved provider
    // against this registry; the config is read lazily, on each request.
    const cloud = new LlmProvider(() => this.textAiConfig());
    this.providers.set(cloud.id, cloud);

    await this.loadSettings();
    this.installFullScreen();
    // The chosen speech model shows under Settings › Models on this device from the start.
    this.speech.store();
    await this.setUpKeyStore();
    // A pen picked just before the plugin stops is still kept.
    this.register(() => {
      if (!this.lastPenTimer) return;
      window.clearTimeout(this.lastPenTimer);
      void this.saveSettings();
    });

    this.setUpReadingGuard();
    this.registerView(VIEW_TYPE_INK, (leaf) => new InkView(leaf, this));
    // FineNotes' own icons, before any button that uses them is made.
    addIcon(ICON_IMPORT_NOTEBOOK, ICON_IMPORT_NOTEBOOK_SVG);
    addIcon(ICON_STYLUS_ONLY, ICON_STYLUS_ONLY_SVG);
    // The image menu's "Generate with AI" row: the same modal as the AI menu,
    // listed only when an image service is configured.
    this.register(
      registerImageMenuEntry({
        id: "generate-ai",
        icon: "sparkles",
        label: "Generate with AI",
        order: 50,
        isAvailable: () => this.imageAiConfig() !== null,
        run: () => this.app.workspace.getActiveViewOfType(InkView)?.openGenerateImage(),
      }),
    );
    // "Scan document": straight into the camera from the tap that chose it
    // (the scan sheet opens the picker synchronously).
    this.register(
      registerImageMenuEntry({
        id: "scan",
        icon: "scan-line",
        label: "Scan document",
        order: 40,
        run: () => this.app.workspace.getActiveViewOfType(InkView)?.scanDocument(),
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source === "file-explorer-context-menu" && this.settings.showNewNotebookInContextMenu) {
          const folder = file instanceof TFolder ? file : file.parent;
          menu.addItem((item) =>
            item
              .setTitle("New notebook")
              .setIcon(ICON_NEW_NOTEBOOK)
              .setSection("action-primary")
              .onClick(() =>
                this.openNewNotebookDialog(folder && !folder.isRoot() ? folder.path : ""),
              ),
          );
          // Right below it: a notebook from another app, into the folder clicked.
          menu.addItem((item) =>
            item
              .setTitle("Import notebook (beta)…")
              .setIcon(ICON_IMPORT_NOTEBOOK)
              .setSection("action-primary")
              .onClick(() =>
                this.openImportNotebook(folder && !folder.isRoot() ? folder.path : ""),
              ),
          );
        }
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== "pdf") return;
        menu.addItem((item) =>
          item
            .setTitle("New notebook from PDF")
            .setIcon(ICON_NEW_NOTEBOOK)
            .onClick(() => void this.createNotebookFromPdf(file)),
        );
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (!view) return;
        menu.addItem((item) =>
          item
            .setTitle("Import PDF into notebook")
            .setIcon("file-text")
            .onClick(() => void view.importVaultPdf(file.path)),
        );
      }),
    );
    this.routeInkNotes();
    // `![[Physics.notebook#page=3]]` in any note shows that page (page-embed.ts).
    this.pageEmbeds = this.addChild(
      new PageEmbeds({
        app: this.app,
        isInkFile: (file) => this.isInkFile(file),
        paperWidth: () => this.settings.paperWidth,
        usePressure: () => this.settings.pressureWidth,
        highlighterAlpha: () => this.settings.highlighterAlpha,
        paper: () => shownPaperTheme(this.settings, document.body.hasClass("theme-dark")),
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.fileMoves.renamed(file, oldPath);
        this.keepFolderNotebookPaired(file, oldPath);
        this.calculatorFileMoved(oldPath, file.path);
      }),
    );
    this.register(() => this.fileMoves.destroy());
    this.wordCheck.answered = (count) => this.remindToRelearn(count);
    // The reader's and the learner's workers end with the plugin.
    this.register(() => {
      this.learner.dispose();
      this.handwriting.dispose();
      this.speech.dispose();
      this.models.dispose();
    });
    // A release that still bundles Grape writes it to the handwriting folder,
    // once, in the background and well after startup (grape-files.ts).
    this.app.workspace.onLayoutReady(() => {
      this.startup.mark("layout ready");
      const timer = window.setTimeout(() => {
        const began = performance.now();
        void this.grape.bridge().finally(() => {
          this.startup.timed("grape bridge", performance.now() - began);
        });
      }, GRAPE_BRIDGE_DELAY_MS);
      this.register(() => window.clearTimeout(timer));
      const check = window.setTimeout(() => void this.updates.check(), UPDATE_CHECK_DELAY_MS);
      this.register(() => window.clearTimeout(check));
      this.moveOwnFolders().catch((error: unknown) => {
        console.warn("FineNotes: could not move its folders", error);
      });
    });

    this.register(() => this.explorerNotebookButton.destroy());
    this.register(() => this.explorerFolderNotebooks.destroy());
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.syncExplorerNotebookButton()),
    );
    this.app.workspace.onLayoutReady(() => this.syncExplorerNotebookButton());
    this.addRibbonIcon(ICON_NEW_NOTEBOOK, "New notebook", () => this.openNewNotebookDialog());
    this.addCommands();

    this.settingTab = new GoodObsidianSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // OpenRouter's sign-in page sends the browser back to
    // obsidian://goodobsidian-openrouter with a one-time code.
    this.registerObsidianProtocolHandler(OPENROUTER_CALLBACK_ACTION, (params) => {
      void this.handleOpenRouterCallback(params);
    });
    this.startup.mark("onload done");
  }

  /**
   * A timer due every STARTUP_TICK_MS for the first STARTUP_WATCH_MS: how late
   * each one comes is how long the main thread was held (startup-log.ts).
   */
  private watchStartup(): void {
    const end = performance.now() + STARTUP_WATCH_MS;
    let due = performance.now() + STARTUP_TICK_MS;
    let timer = 0;
    const tick = (): void => {
      // A plugin built in a test and never unloaded must not outlive its window.
      if (typeof window === "undefined") return;
      const now = performance.now();
      this.startup.late(now - due);
      if (now >= end) {
        this.startup.stop();
        return;
      }
      due = now + STARTUP_TICK_MS;
      timer = window.setTimeout(tick, STARTUP_TICK_MS);
    };
    timer = window.setTimeout(tick, STARTUP_TICK_MS);
    this.register(() => window.clearTimeout(timer));
  }

  // --- Commands ---------------------------------------------------------------

  /**
   * The command palette's entries. Ids are what users' hotkeys are bound to,
   * so an id never changes once shipped, even where its name has.
   */
  private addCommands(): void {
    // The id predates the dialog; kept so existing hotkeys still work.
    this.addCommand({
      id: "create-handwriting-note",
      name: "New notebook or page…",
      callback: () => this.openNewNotebookDialog(),
    });

    this.addCommand({
      id: "create-notebook-with-last-settings",
      name: "Create notebook with last settings",
      callback: () => void this.createNotebookWithLastSettings(),
    });

    this.addCommand({
      id: "show-welcome",
      name: "Show the welcome",
      callback: () => this.showWelcome(),
    });

    this.addCommand({
      id: "create-notebook-from-pdf",
      name: "New notebook from a PDF in the vault…",
      callback: () =>
        new VaultPdfSuggestModal(this.app, (file) => void this.createNotebookFromPdf(file)).open(),
    });

    this.notebookCommand(
      "convert-to-notebook",
      "Convert single page to notebook",
      (view) => view.convertToNotebook(),
      (view) => view.isSinglePage && !view.isBoard,
    );
    this.notebookCommand("scan-document", "Scan document into this notebook", (view) =>
      view.scanDocument(),
    );
    this.notebookCommand("import-pdf", "Import PDF…", (view) => view.importPdf());
    // An endless board (FineNotes#46) has no pages to add, link to or save as a template.
    const pages = (view: InkView): boolean => !view.isBoard;
    this.notebookCommand(
      "import-vault-pdf",
      "Import PDF from vault…",
      (view) => view.importPdf(true),
      pages,
    );
    this.notebookCommand("search-notebook", "Search this notebook…", (view) => view.openSearch());
    this.notebookCommand(
      "copy-page-link",
      "Copy link to current page",
      (view) => view.copyPageLink(),
      pages,
    );
    this.notebookCommand("copy-highlighted-text", "Copy highlighted text on this page", (view) =>
      view.copyHighlightedText(),
    );
    // No default hotkey: desktop users give it one (FineNotes#42).
    this.notebookCommand(
      "turn-selection-into-text",
      "Turn selection into text",
      (view) => view.turnSelectionIntoText(),
      (view) => view.hasInkSelected,
    );
    this.notebookCommand("export-pdf", "Export as PDF…", (view) => view.exportPdf());
    this.notebookCommand(
      "save-as-template",
      "Save notebook as template…",
      (view) => view.saveAsTemplate(),
      pages,
    );
    this.notebookCommand(
      "save-page-as-template",
      "Save page as template",
      (view) => {
        const shown = view.currentPageInk();
        if (shown) void view.savePageAsTemplate(shown.number - 1);
      },
      pages,
    );
    this.addCommand({
      id: "new-from-template",
      name: "New notebook from template…",
      callback: () =>
        new TemplateFileSuggestModal(this.app, (file) =>
          this.openImportNotebook("", [
            { name: file.name, read: () => this.app.vault.readBinary(file) },
          ]),
        ).open(),
    });
    this.addCommand({
      id: "template-gallery",
      name: "Browse template gallery…",
      callback: () => void this.openTemplateGallery(),
    });
    this.addCommand({
      id: "share-template",
      name: "Share a template with the community…",
      callback: () => void this.openShareTemplate(),
    });

    this.addCommand({
      id: "toggle-canvas-markdown-view",
      name: "Switch between notebook and Markdown view",
      checkCallback: (checking) => {
        const leaf = this.switchableLeaf();
        if (leaf && !checking) void this.switchView(leaf);
        return leaf !== null;
      },
    });

    this.notebookCommand("toggle-text-layer", "Show or hide the text layer", (view) =>
      view.toggleTextPanel(),
    );
    this.notebookCommand(
      "recognize-handwriting",
      "Transcribe this notebook's handwriting",
      (view) => this.runRecognition(view),
    );
    this.addCommand({
      id: "write-handwriting-practice",
      name: "Write a handwriting practice set",
      callback: () => void writePracticePage(this.learningHost()),
    });
    this.addCommand({
      id: "write-symbol-practice",
      name: "Write the symbol practice sheet (digits, operators, signs)",
      callback: () => void writeSymbolPractice(this.learningHost()),
    });
    this.addCommand({
      id: "learn-handwriting",
      name: "Learn my handwriting from the practice files",
      callback: () => void this.learner.start(),
    });
    this.notebookCommand("show-keyboard-shortcuts", "Show keyboard shortcuts", (view) =>
      view.toggleShortcuts(),
    );
    this.notebookCommand(
      "read-handwriting-on-device",
      "Show this page read on this device",
      (view) => this.readOnDevice(view),
      () => this.settings.handwritingOnDevice !== false,
    );
    this.notebookCommand("fit-reset-view", "Fit the page and go to the top", (view) =>
      view.resetView(),
    );
    this.notebookCommand("zoom-in", "Zoom in", (view) => view.zoomIn());
    this.notebookCommand("zoom-out", "Zoom out", (view) => view.zoomOut());

    this.addCommand({
      id: "toggle-only-stylus-mode",
      name: "Turn Stylus-only mode on or off",
      callback: () => void this.setOnlyStylusMode(!this.settings.onlyStylusMode),
    });

    this.addCommand({
      id: "toggle-input-debug-overlay",
      name: "Show or hide the input debug overlay",
      callback: () => void this.setDebugHud(!this.settings.debugHud, true),
    });

    this.addCommand({
      id: "copy-shape-diagnostics",
      name: "Copy shape diagnostics",
      callback: () => void this.copyShapeDiagnostics(),
    });

    this.addCommand({
      id: "view-changelog",
      name: "Show the changelog",
      callback: () => this.showChangelog(releasedChangelog(changelogMd)),
    });
  }

  /**
   * A command that is only offered while a notebook is the active view, and
   * acts on that view. `available` narrows it further (a single page, say).
   */
  private notebookCommand(
    id: string,
    name: string,
    act: (view: InkView) => unknown,
    available: (view: InkView) => boolean = () => true,
  ): void {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (!view || !available(view)) return false;
        if (!checking) void act(view);
        return true;
      },
    });
  }

  private showChangelog(markdown: string): void {
    new WhatsNewModal(this.app, markdown, this).open();
  }

  // --- Settings ---------------------------------------------------------------

  async loadSettings(): Promise<void> {
    const own = (await this.loadData()) as Partial<GoodObsidianSettings> | null;
    const saved = own ?? (await this.settingsFromPreviousId());
    this.firstInstall = saved === null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // A record of its own: the key store mutates it, and the default's must
    // stay empty.
    const keys = saved?.apiKeys;
    this.settings.apiKeys = typeof keys === "object" && keys !== null ? { ...keys } : {};
    // A saved provider this build does not have (on-device recognition,
    // "trocr-local", was removed in 2026-09) lands on Manual, so the settings
    // dropdown never shows a blank choice. The removed provider's own two
    // settings are dropped, so they are not written back.
    if (!this.providers.has(this.settings.recognitionProviderId)) {
      this.settings.recognitionProviderId = MANUAL_PROVIDER_ID;
    }
    const loaded = this.settings as unknown as Record<string, unknown>;
    delete loaded.experimentalTrocr;
    // "Pressure sensitivity", on by default until 2026-09-30: pressure is
    // now the advanced `pressureWidth`, off by default, and the old choice is
    // not carried over.
    delete loaded.pressureEnabled;
    delete loaded.trocrModel;
    // The folded sections before the compact settings (2026-10-21): now the
    // open ones are kept, and every section starts folded.
    delete loaded.foldedSettingsSections;
    // A list of its own, read as pens: the default's must stay as it is.
    this.settings.savedPens = savedPensOf(this.settings.savedPens);
    const toolbar = normalizeLayout(this.settings.toolbarItems, this.settings.toolbarOff);
    this.settings.toolbarItems = toolbar.bar;
    this.settings.toolbarOff = toolbar.off;
    // "Crosshair cursor" was a toggle until FineNotes#27: on is now the ink dot.
    this.settings.penCursor = penCursorStyleOf(this.settings.penCursor);
    // Settings found under the old id are written to this id's folder at
    // once, so the carry-over happens exactly one time.
    if (own === null && saved !== null) await this.saveSettings();
  }

  /**
   * After every `RELEARN_AFTER` corrected words, a notice offers to learn
   * the handwriting again (or for the first time, from corrections alone).
   */
  private remindToRelearn(count: number): void {
    if (this.learner.progress) return;
    const record = learnedRecord(this.settings, this.grape.id);
    const fresh = relearnDue(count, record?.corrections, this.settings.relearnRemindedAt);
    if (fresh === 0) return;
    this.settings.relearnRemindedAt = count;
    void this.saveSettings();
    showRelearnNotice(fresh, record !== undefined, () => void this.learner.start());
  }

  /**
   * FineNotes' own folders, moved to where 2.6 keeps them
   * (model/vault-folders.ts): templates and stickers into FineNotes assets,
   * with the last template the New notebook dialog remembers; the corrected
   * words out of the plugin's folder (word-check.ts does that part). Run on
   * every start: each step does nothing once done, and catches an old folder
   * that sync brings back from a device on an older FineNotes.
   */
  private async moveOwnFolders(): Promise<void> {
    let changed = false;
    for (const move of folderMoves(this.settings)) {
      const old = this.app.vault.getFolderByPath(move.from);
      try {
        if (old) await this.mergeFolder(old, move.to);
      } catch (error) {
        console.warn(`FineNotes: could not move ${move.from} to ${move.to}`, error);
        continue;
      }
      const remembered = parseNotebookTemplate(this.settings.lastNotebookTemplate);
      const path = remembered && movedPath(remembered.path, move.from, move.to);
      if (move.key === "templateFolder" && remembered && path) {
        this.settings.lastNotebookTemplate = { path, page: remembered.page };
        changed = true;
      }
      if (this.settings[move.key] !== move.to) {
        this.settings[move.key] = move.to;
        changed = true;
      }
    }
    if (changed) await this.saveSettings();
    if (await this.app.vault.adapter.exists(normalizePath(legacyCorrectionsFile(this.pluginDir)))) {
      await this.wordCheck.reload();
    }
  }

  /**
   * Folder `from` moved to `to`; when `to` is there already, its contents
   * moved into it one by one. A file whose name is taken on both sides
   * stays where it was, and so does the old folder then.
   */
  private async mergeFolder(from: TFolder, to: string): Promise<void> {
    const { vault, fileManager } = this.app;
    const there = vault.getAbstractFileByPath(to);
    if (!there) {
      const parent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
      if (parent && !vault.getFolderByPath(parent)) await vault.createFolder(parent);
      await fileManager.renameFile(from, to);
      return;
    }
    if (!(there instanceof TFolder)) return;
    for (const child of [...from.children]) {
      const target = `${to}/${child.name}`;
      const taken = vault.getAbstractFileByPath(target);
      if (!taken) await fileManager.renameFile(child, target);
      else if (child instanceof TFolder && taken instanceof TFolder) {
        await this.mergeFolder(child, target);
      }
    }
    if (from.children.length === 0) await fileManager.trashFile(from);
  }

  /**
   * Obsidian keeps a plugin's settings in `plugins/<id>/data.json`, so a
   * plugin that changes its id starts from nothing. The first load under a
   * new id reads the folder of the id it was published under before. The
   * old folder is left alone: it belongs to whatever is installed there.
   */
  private async settingsFromPreviousId(): Promise<Partial<GoodObsidianSettings> | null> {
    if (this.manifest.id === PREVIOUS_PLUGIN_ID) return null;
    const { vault } = this.app;
    const path = `${vault.configDir}/plugins/${PREVIOUS_PLUGIN_ID}/data.json`;
    try {
      if (!(await vault.adapter.exists(path))) return null;
      const parsed: unknown = JSON.parse(await vault.adapter.read(path));
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      // Unreadable or not JSON: start from the defaults, as a new install does.
      return null;
    }
  }

  /**
   * A model's files are about to be removed or replaced (Settings › Models on this device):
   * whatever holds it in memory lets go, and loads it again when next needed.
   */
  modelReleased(id: string): void {
    if (id === "grape" || id === "grape-2") this.handwriting.dispose();
    if (id.startsWith("whisper-")) this.speech.release();
  }

  /** Switch corrections (underlined misreads) on or off, and show it in every open notebook. */
  async setWordChecking(on: boolean): Promise<void> {
    this.settings.checkHandwrittenWords = on;
    await this.saveSettings();
    for (const view of this.openNotebooks()) view.wordCheckingChanged();
  }

  /** Keep the calculator's switches and history (model/calculator-store.ts). */
  saveCalculator(data: CalculatorData): void {
    this.settings.calculator = data;
    void this.saveSettings();
  }

  /** A notebook's calculator history follows it when it is renamed or moved. */
  private calculatorFileMoved(from: string, to: string): void {
    const moved = renameCalculatorHistory(parseCalculatorData(this.settings.calculator), from, to);
    if (moved) this.saveCalculator(moved);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.syncExplorerNotebookButton();
  }

  /**
   * The reading guard, on this device's own storage, and what it found: if
   * the last run ended while a page was read, that page is skipped from now
   * on and automatic reading waits for the next start.
   */
  private setUpReadingGuard(): void {
    const key = "finenotes:device-reading";
    this.readingGuard = new ReadingGuard(
      {
        load: () => {
          const raw: unknown = this.app.loadLocalStorage(key);
          return raw;
        },
        save: (value) => this.app.saveLocalStorage(key, value),
      },
      this.manifest.version,
    );
    const crash = this.readingGuard.crash;
    if (!crash) return;
    const name = crash.path.split("/").pop() ?? crash.path;
    new Notice(
      `FineNotes: Obsidian closed while page ${crash.page} of "${name}" was being read on this ` +
        "device. That page is skipped until it changes, and reading on this device is paused " +
        'until Obsidian restarts. If this happens again, turn off "Read handwriting on this ' +
        'device" in the settings.',
      20_000,
    );
  }

  // --- API keys and AI configuration -----------------------------------------

  /**
   * Pick the key store and move keys out of plain-text settings into it.
   * Obsidian's keychain (`app.secretStorage`, 1.11.4) is always there on the
   * versions this plugin supports; the check by shape only keeps a build
   * without it (the UI gallery's stand-in, say) on the plain-text store.
   */
  private async setUpKeyStore(): Promise<void> {
    const storage = this.app.secretStorage as SecretStorageLike | undefined;
    this.keys =
      storage && typeof storage.getSecret === "function" && typeof storage.setSecret === "function"
        ? new SecretKeyStore(storage)
        : new SettingsKeyStore(this.settings.apiKeys, () => void this.saveSettings());
    // Each plaintext copy is blanked only after its key reads back from the
    // store (key-store.ts `migrateKeys`).
    const moved = migrateKeys(this.settings, this.keys);
    if (moved === 0) return;
    await this.saveSettings();
    if (this.keys.secure) {
      new Notice(
        `FineNotes moved your API ${moved === 1 ? "key" : "keys"} out of this vault's ` +
          "plugin data into Obsidian's keychain (Settings → Keychain). If another device " +
          "asks for a key, enter it there once.",
        12000,
      );
    }
  }

  /**
   * The key for one vendor slot, or "". A pre-0.5 key whose vendor could not
   * be told from its prefix stays in `llmApiKey` (see `planKeyMigration`) and
   * keeps working exactly as it did: for the selected cloud vendor only.
   */
  apiKeyFor(slot: LlmVendor): string {
    const stored = this.keys.get(slot);
    if (stored) return stored;
    if (slot === this.settings.llmVendor && !VENDORS[slot].userEndpoint) {
      return this.settings.llmApiKey.trim();
    }
    return "";
  }

  /** Store a key; false (with a notice) when it did not read back. */
  storeApiKey(slot: LlmVendor, key: string): boolean {
    const ok = this.keys.set(slot, key);
    if (ok && slot === this.settings.llmVendor && this.settings.llmApiKey) {
      // The slot now has a key of its own; drop the unassigned legacy one.
      this.settings.llmApiKey = "";
      void this.saveSettings();
    }
    if (!ok) new Notice("FineNotes could not store the API key. Try again, or restart Obsidian.");
    return ok;
  }

  /** Forget a key. */
  removeApiKey(slot: LlmVendor): void {
    if (slot === this.settings.llmVendor && this.settings.llmApiKey) {
      this.settings.llmApiKey = "";
      void this.saveSettings();
    }
    if (!this.keys.remove(slot)) {
      new Notice("FineNotes could not remove the key here — remove it under Settings → Keychain.");
    }
  }

  /** The text/vision vendor: transcription and questions. */
  textAiConfig(): AiVendorConfig {
    const vendor = this.settings.llmVendor;
    return {
      vendor,
      model: this.settings.llmModel,
      apiKey: this.apiKeyFor(vendor),
      baseUrl: this.settings.llmBaseUrl,
    };
  }

  /** The image vendor, or null when the configured one cannot make images. */
  imageAiConfig(): ImageConfig | null {
    const vendor = resolveImageVendor(this.settings.imageVendor, this.settings.llmVendor);
    if (!canGenerateImages(vendor)) return null;
    return {
      vendor,
      model: this.settings.imageModel.trim() || DEFAULT_IMAGE_MODELS[vendor],
      apiKey: this.apiKeyFor(vendor),
    };
  }

  /** What the AI menu needs to decide what is available. */
  aiSetup(): AiSetup {
    return {
      vendor: this.settings.llmVendor,
      baseUrl: this.settings.llmBaseUrl,
      imageVendor: this.settings.imageVendor,
      hasKey: (slot) => this.apiKeyFor(slot) !== "",
    };
  }

  /**
   * Whether the user has already agreed to send notes to `vendor`'s kind of
   * destination. The user's own endpoint and the named cloud services are
   * asked about separately.
   */
  consentedTo(vendor: LlmVendor): boolean {
    return VENDORS[vendor].userEndpoint
      ? this.settings.customConsentGiven
      : this.settings.cloudConsentGiven;
  }

  /**
   * One-time consent before the first request that sends anything off the
   * device, stating what goes where. Scoped: named cloud vendors and the
   * user-configured endpoint are different destinations, so consenting to one
   * must not silently authorize the other after a vendor switch. `action` and
   * `what` complete "<action> sends <what> to <destination>".
   */
  async confirmAiSend(
    target: { vendor: LlmVendor; baseUrl: string },
    action: string,
    what: string,
  ): Promise<boolean> {
    const custom = VENDORS[target.vendor].userEndpoint;
    if (this.consentedTo(target.vendor)) return true;
    const confirmed = await ConfirmModal.confirm(this.app, {
      title: custom ? "Send to your endpoint?" : "Send to a cloud AI service?",
      message:
        `${action} sends ${what} to ${targetLabel(target)}` +
        (custom
          ? ". It leaves this app for that request only — where it goes is up to whoever " +
            "operates that server. "
          : " using your API key. It leaves your device for that request only. ") +
        "FineNotes asks once per vault: after this, the AI features you start send what " +
        "they need without asking again. Nothing is sent unless you start it, and manual " +
        "transcription never uses the network.",
      cta: "Send",
    });
    if (!confirmed) return false;
    this.settings[custom ? "customConsentGiven" : "cloudConsentGiven"] = true;
    await this.saveSettings();
    return true;
  }

  /**
   * Transcribe an audio recording with the configured AI service, after the
   * one-time consent. Resolves to the transcript, or `null` when the user
   * declined to send it; throws an `Error` with a Notice-ready message
   * otherwise (unsupported vendor, no key, too large, network, HTTP). The
   * audio feature's entry point — see `transcribeAudio` in ai-client.ts.
   */
  async transcribeAudioFile(
    bytes: ArrayBuffer,
    mimeType: string,
    onProgress?: (message: string) => void,
  ): Promise<string | null> {
    const text = this.textAiConfig();
    // The text model is not a speech model except on Gemini, which does both.
    const config = { ...text, model: text.vendor === "google" ? text.model : "" };
    // Refuse what cannot work before asking to send anything.
    if (!canTranscribeAudio(config.vendor)) {
      throw new Error(`${audioUnsupportedReason(config.vendor)}.`);
    }
    assertConfigured(config);
    if (!(await this.confirmAiSend(config, "Transcribing a recording", "the audio file"))) {
      return null;
    }
    return transcribeAudio(config, bytes, mimeType, onProgress);
  }

  /** Close the settings window, to show a note opened from it (the same app API as below). */
  closeSettings(): void {
    (this.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
  }

  /** FineNotes' page under Community plugins, where Obsidian's own Update button is. */
  openUpdatePage(): void {
    window.open(PLUGIN_PAGE_URL);
  }

  /** "Update available" pops up every other day (on), or the gear's dot alone says it. */
  async setUpdateReminders(on: boolean): Promise<void> {
    this.settings.updateReminders = on;
    await this.saveSettings();
    this.updates.changed();
  }

  /** Open this plugin's settings tab (an undocumented but long-stable app API). */
  openSettingsTab(): void {
    const setting = (
      this.app as unknown as {
        setting?: { open?: () => void; openTabById?: (id: string) => unknown };
      }
    ).setting;
    if (setting?.open && setting.openTabById) {
      setting.open();
      setting.openTabById(this.manifest.id);
      return;
    }
    new Notice("Open Settings → FineNotes to set up AI.");
  }

  /**
   * After an update, once: the changelog since the version this vault last
   * ran. The version seen is kept in the plugin's data, which syncs with the
   * vault, so a user with three devices reads the news once, not three times.
   */
  private async showWhatsNew(): Promise<void> {
    const version = this.manifest.version;
    const seen = this.settings.lastSeenVersion;
    if (seen === version) return;
    // A new install has nothing to catch up on; it only starts the record.
    const news = this.firstInstall ? "" : changelogSince(changelogMd, seen || null);
    this.settings.lastSeenVersion = version;
    await this.saveSettings();
    if (news) this.showChangelog(news);
  }

  /** Remember the eraser's mode and size for the next session (and device). */
  saveEraser(mode: EraserMode, size: number): void {
    this.settings.eraserMode = mode;
    this.settings.eraserSize = size;
    void this.saveSettings();
  }

  /** Remember what the eraser erases ("highlighter only", "pen only"), for the next session. */
  saveEraserFilter(filter: EraserFilter): void {
    this.settings.eraserFilter = filter;
    void this.saveSettings();
  }

  /** Remember "Grey out while erasing" (the eraser's mode list), for the next session. */
  saveEraserGrey(on: boolean): void {
    this.settings.greyWhileErasing = on;
    void this.saveSettings();
  }

  /** Remember the pen's auto-shape toggle, for the next session. */
  savePenAutoShape(enabled: boolean): void {
    this.settings.penAutoShape = enabled;
    void this.saveSettings();
  }

  /** Remember which pen gestures are on, for the next session. */
  /** Remember the ruler's kind and its angle snapping, for the next session. */
  saveRuler(kind: RulerKind, snap: number): void {
    this.settings.ruler = { kind, snap };
    void this.saveSettings();
  }

  savePenGestures(gestures: PenGestures): void {
    this.settings.penGestures = penGesturesOf(gestures);
    void this.saveSettings();
  }

  /** Remember the Shape tool's colour, for the next session. */
  saveShapeColor(color: string): void {
    this.settings.shapeColor = parseHexColor(color) ?? DEFAULT_SHAPE_COLOR;
    void this.saveSettings();
  }

  /** Remember whether new tables get a header row, for the next session. */
  saveTableHeader(on: boolean): void {
    this.settings.tableHeader = on;
    void this.saveSettings();
  }

  /** Remember the Shape tool's fill, line, corners and arrowheads, for the next session. */
  saveShapeStyle(style: ShapeToolStyle): void {
    this.settings.shapeStyle = readShapeToolStyle(style);
    void this.saveSettings();
  }

  /** Remember the custom colours picked lately, for every colour picker. */
  saveRecentColors(colors: readonly string[]): void {
    this.settings.recentColors = recentColorsOf(colors);
    void this.saveSettings();
  }

  /** Remember the pen row's picked colours, for every notebook. */
  savePenColors(colors: readonly string[]): void {
    this.settings.penColors = [...colors];
    void this.saveSettings();
  }

  /**
   * Remember each pen type's stroke stabilization, for every notebook. Saved
   * once the slider rests: it reports every step of a drag.
   */
  savePenStabilization(all: PenStabilization): void {
    this.settings.penStabilization = penStabilizationOf(all);
    window.clearTimeout(this.lastPenTimer);
    this.lastPenTimer = window.setTimeout(() => {
      this.lastPenTimer = 0;
      void this.saveSettings();
    }, LAST_PEN_SAVE_MS);
  }

  /**
   * Remember each pen type's own colour, row and width, for every notebook.
   * Saved once the picking rests, as the last pen is: the width slider
   * reports every step of a drag.
   */
  savePenInks(inks: PenInks): void {
    this.settings.penInks = { ...inks };
    window.clearTimeout(this.lastPenTimer);
    this.lastPenTimer = window.setTimeout(() => {
      this.lastPenTimer = 0;
      void this.saveSettings();
    }, LAST_PEN_SAVE_MS);
  }

  /**
   * Remember the pen in hand (type, colour, width) for every notebook and
   * the next start (FineNotes#24). Saved once the picking rests, since a
   * width slider reports every step of a drag.
   */
  saveLastPen(pen: SavedPen): void {
    this.settings.lastPen = { ...pen };
    window.clearTimeout(this.lastPenTimer);
    this.lastPenTimer = window.setTimeout(() => {
      this.lastPenTimer = 0;
      void this.saveSettings();
    }, LAST_PEN_SAVE_MS);
  }

  /** Keep the saved pens (FineNotes#24), and show them in every open notebook's toolbar. */
  saveSavedPens(pens: readonly SavedPen[]): void {
    this.settings.savedPens = pens.map((pen) => ({ ...pen }));
    void this.saveSettings();
  }

  /**
   * "Stickers", the tool bar's own button: the built-in pack and the user's
   * own collections. A pick is saved beside the notebook (a copy, never a
   * link to the stickers folder) and placed like any picture.
   */
  openStickerPicker(ctx: Pick<ImageMenuContext, "insertBytes">): void {
    new StickerModal(this.app, stickerFolderOf(this.settings.stickerFolder), (choice) => {
      void (async () => {
        if (choice.kind === "builtin") {
          const svg = stickerSvg(choice.sticker, choice.color);
          const bytes = new TextEncoder().encode(svg).buffer;
          await ctx.insertBytes(
            bytes,
            "image/svg+xml",
            stickerFileName(choice.sticker, choice.color),
          );
          return;
        }
        const bytes = await this.app.vault.readBinary(choice.file);
        const mime = mimeForExtension(choice.file.extension) ?? "image/png";
        await ctx.insertBytes(bytes, mime, choice.file.basename);
      })();
    }).open();
  }

  /** Customize toolbar changed the bar or its menu: every open notebook shows the new one. */
  saveToolbarLayout(layout: ToolbarLayout): void {
    const toolbar = normalizeLayout(layout.bar, layout.off);
    this.settings.toolbarItems = toolbar.bar;
    this.settings.toolbarOff = toolbar.off;
    void this.saveSettings();
    for (const view of this.openNotebooks()) view.setToolbarItems(toolbar);
  }

  /** "Cursor over the page" changed: every open notebook shows the new cursor. */
  async setPenCursor(style: PenCursorStyle): Promise<void> {
    this.settings.penCursor = style;
    await this.saveSettings();
    for (const view of this.openNotebooks()) view.setPenCursor(style);
  }

  /**
   * Stylus-only mode was switched from the toolbar or a command: save it and
   * give every open notebook its toggle in one go.
   */
  async setOnlyStylusMode(on: boolean): Promise<void> {
    this.settings.onlyStylusMode = on;
    await this.saveSettings();
    for (const view of this.openNotebooks()) view.setOnlyStylusMode(on);
  }

  /** Remember the lasso's type and what it picks up, for the next session. */
  saveLasso(mode: LassoMode, filter: LassoFilter): void {
    this.settings.lassoMode = mode;
    this.settings.lassoFilter = { ...filter };
    void this.saveSettings();
  }

  /** Remember the Text tool's style for new boxes and its pin, for the next session. */
  saveTextTool(style: TextStyle, pinned: boolean, dragSize: boolean): void {
    this.settings.textStyle = { ...style };
    this.settings.textToolPinned = pinned;
    this.settings.textDragSize = dragSize;
    void this.saveSettings();
  }

  /**
   * The Text tool's hint pill, as GoodNotes shows it: the first few times the
   * tool is picked, and never again once its × was tapped. Kept in plugin
   * data (per vault, so it syncs) rather than `app.saveLocalStorage`.
   */
  offerTextHint(surface: InkSurface): void {
    const settings = this.settings;
    if (settings.textHintDismissed || settings.textHintShown >= TEXT_HINT_SHOWS) return;
    settings.textHintShown += 1;
    void this.saveSettings();
    surface.showTextHint(TEXT_HINT, () => {
      settings.textHintDismissed = true;
      void this.saveSettings();
    });
  }

  /**
   * On an iPad, the first time a notebook opens: iPadOS Scribble can take
   * fast Pencil strokes as handwriting for itself before the page ever sees
   * them, and only the user can switch it off. The notice stays until it is
   * tapped away, and the flag syncs, so it is shown once per vault.
   */
  async maybeShowScribbleNotice(): Promise<void> {
    const onIPad = Platform.isIosApp && Platform.isTablet;
    if (!onIPad || this.settings.scribbleNoticeShown) return;
    this.settings.scribbleNoticeShown = true;
    await this.saveSettings();
    new Notice(
      "FineNotes: if strokes go missing while you write, switch off Scribble in the " +
        "iPad's Settings → Apple Pencil. iPadOS reads fast Pencil strokes as its own " +
        "handwriting input and can keep them from the page.",
      0,
    );
  }

  /**
   * Transcribe `target` with the engine chosen in the settings. An engine
   * that sends pages off the device needs the user's consent first; a
   * background run (`background`) never asks, and goes ahead only where that
   * consent was already given.
   */
  async runRecognition(target: RecognitionTarget, background = false): Promise<void> {
    const engine = this.activeProvider();
    if (engine.requiresNetwork && !(await this.maySendPages(background))) return;
    await target.recognize(engine, background);
  }

  private maySendPages(background: boolean): Promise<boolean> {
    if (background) return Promise.resolve(this.consentedTo(this.settings.llmVendor));
    return this.confirmAiSend(
      this.textAiConfig(),
      "Transcription",
      "an image of each page that changed since it was last transcribed (its ink, typed " +
        "text and paper), one page per request,",
    );
  }

  /**
   * The engine the AI menu's "Transcribe" entries use: cloud AI — also when
   * the recognition setting says "manual", since tapping Transcribe in the AI
   * menu is asking for a machine transcription.
   */
  aiTranscriber(): RecognitionProvider {
    return resolveProvider(this.providers, LLM_PROVIDER_ID);
  }

  // --- OpenRouter's one-click connect -------------------------------------------

  /**
   * Send the user to OpenRouter to approve a key for FineNotes (OAuth
   * with PKCE). Pressing Connect again before coming back reuses the same
   * secret, so whichever browser tab the user approves in still matches.
   */
  async startOpenRouterConnect(): Promise<void> {
    this.openRouterVerifier ??= generateCodeVerifier();
    const challenge = await codeChallenge(this.openRouterVerifier);
    window.open(buildOpenRouterAuthUrl(challenge));
  }

  /**
   * Forget a sign-in in progress. The settings call this when the vendor or a
   * key is changed by hand, so an approval that arrives later cannot undo
   * what the user set up in the meantime.
   */
  cancelOpenRouterConnect(): void {
    this.openRouterVerifier = null;
  }

  /** The browser came back from OpenRouter: exchange its code, and use the key. */
  async handleOpenRouterCallback(params: Record<string, string>): Promise<void> {
    const outcome = await this.exchangeOpenRouterCode(params.code);
    if ("problem" in outcome) {
      new Notice(outcome.problem);
      return;
    }
    if (!this.storeApiKey("openrouter", outcome.key)) return;
    // The key is OpenRouter's, whatever vendor was picked while the browser was open.
    this.settings.llmVendor = "openrouter";
    await this.saveSettings();
    new Notice("FineNotes is now connected to OpenRouter.");
    // The settings may be open behind the notice: show them the new key.
    const tab = this.settingTab;
    if (tab && tab.containerEl.isConnected) tab.refresh();
  }

  /**
   * Trade the one-time `code` for a key. The secret is spent by the attempt,
   * whether it works or not: a code can be exchanged once.
   */
  private async exchangeOpenRouterCode(code: string | undefined): Promise<OpenRouterOutcome> {
    if (!code) return { problem: "OpenRouter sent no sign-in code back. Try Connect again." };
    const verifier = this.openRouterVerifier;
    if (verifier === null) {
      return {
        problem:
          "FineNotes was not waiting for an OpenRouter sign-in. Start again with " +
          "Connect in the settings.",
      };
    }
    this.openRouterVerifier = null;
    const request = buildKeyExchangeRequest(code, verifier);
    let reply: RequestUrlResponse;
    try {
      reply = await postJson(request.url, request.headers, request.body);
    } catch {
      return { problem: "Could not reach openrouter.ai. Check the connection and try again." };
    }
    const succeeded = reply.status >= 200 && reply.status < 300;
    if (!succeeded)
      return { problem: `OpenRouter refused the key exchange (HTTP ${reply.status}).` };
    let key = "";
    try {
      key = extractOpenRouterKey(reply.json);
    } catch {
      // A body that is not JSON carries no key either.
    }
    return key ? { key } : { problem: "OpenRouter sent no API key back. Try connecting again." };
  }

  // --- Diagnostics ----------------------------------------------------------------

  /** The input debug overlay, on or off in every open notebook (the setting and the command). */
  async setDebugHud(enabled: boolean, announce = false): Promise<void> {
    this.settings.debugHud = enabled;
    await this.saveSettings();
    for (const view of this.openNotebooks()) view.setDebug(enabled);
    if (announce) new Notice(`FineNotes: input debug overlay ${enabled ? "shown" : "hidden"}.`);
  }

  /** Read the page in view on this device and show what it says, line by line. */
  /** Read the page in view on this device, and show what it says. */
  async readOnDevice(view: InkView): Promise<void> {
    const { showPageReading } = await import("./view/hwr-reader");
    await showPageReading(this.app, this.handwriting, view);
  }

  /** Pressure-sensitive pens, on or off, in every open notebook (the setting). */
  async setPressureWidth(enabled: boolean): Promise<void> {
    this.settings.pressureWidth = enabled;
    await this.saveSettings();
    for (const view of this.openNotebooks()) view.setPressureWidth(enabled);
  }

  /** Show pages light, dark or as Obsidian's theme is, in every open notebook (the setting). */
  async setPageAppearance(appearance: PageAppearance): Promise<void> {
    this.settings.pageAppearance = appearance;
    await this.applyPageAppearance();
  }

  /** Save the dark pages settings, and redraw every open notebook with them. */
  async applyPageAppearance(): Promise<void> {
    await this.saveSettings();
    for (const view of this.openNotebooks()) view.syncPaperTheme();
    this.pageEmbeds?.repaintAll();
  }

  // --- Full screen (tablets) ---------------------------------------------------

  private static readonly FULL_SCREEN_KEY = "goodobsidian:full-screen";
  /** On a tab group showing a notebook full screen; styles.css hides its chrome. */
  private static readonly FULL_SCREEN_CLASS = "goodobsidian-full-screen";

  /** Whether notebooks show full screen on this device (stored per device). */
  fullScreen = false;
  /** The tab groups given the full-screen class, each to get its chrome back. */
  private fullScreenGroups = new Set<HTMLElement>();

  /**
   * Full screen is a tablet's: there Obsidian's tab bar and view header take
   * 90 px above the page. A desktop window keeps its own controls in that bar.
   */
  get fullScreenOffered(): boolean {
    return Platform.isTablet;
  }

  toggleFullScreen(): void {
    this.fullScreen = !this.fullScreen;
    this.app.saveLocalStorage(
      GoodObsidianPlugin.FULL_SCREEN_KEY,
      storedFullScreen(this.fullScreen),
    );
    for (const view of this.openNotebooks()) view.showFullScreen(this.fullScreen);
    this.syncFullScreen();
  }

  /** Put the class on the tab groups whose tab in front is a notebook, and only on those. */
  syncFullScreen(): void {
    const places = this.openNotebooks().flatMap((view) => {
      const group = view.containerEl.closest<HTMLElement>(".workspace-tabs");
      return group ? [{ group, shown: view.containerEl.isShown() }] : [];
    });
    const groups = fullScreenGroups(this.fullScreen && this.fullScreenOffered, places);
    const cls = GoodObsidianPlugin.FULL_SCREEN_CLASS;
    for (const group of this.fullScreenGroups) if (!groups.has(group)) group.removeClass(cls);
    for (const group of groups) group.addClass(cls);
    this.fullScreenGroups = groups;
  }

  private installFullScreen(): void {
    this.fullScreen = parseFullScreen(
      this.app.loadLocalStorage(GoodObsidianPlugin.FULL_SCREEN_KEY),
    );
    if (!this.fullScreenOffered) return;
    const sync = (): void => this.syncFullScreen();
    this.registerEvent(this.app.workspace.on("layout-change", sync));
    this.registerEvent(this.app.workspace.on("active-leaf-change", sync));
    this.app.workspace.onLayoutReady(sync);
    this.register(() => {
      for (const group of this.fullScreenGroups) {
        group.removeClass(GoodObsidianPlugin.FULL_SCREEN_CLASS);
      }
      this.fullScreenGroups.clear();
    });
  }

  // --- Where the tool options pill rests ---------------------------------------

  private static readonly PILL_DOCK_KEY = "goodobsidian:pill-dock";

  /**
   * Where the tool options pill rests (pill-dock-model.ts): every tool's,
   * in every notebook, kept per device, as the iPad and a laptop want
   * different places.
   */
  get pillDock(): PillDock {
    this.pillDockSeen ??= parsePillDock(
      this.app.loadLocalStorage(GoodObsidianPlugin.PILL_DOCK_KEY),
    );
    return this.pillDockSeen;
  }

  private pillDockSeen: PillDock | null = null;

  /** The pill was dragged to `dock` in one notebook: keep it, and move every other's. */
  setPillDock(dock: PillDock): void {
    if (dock === this.pillDock) return;
    this.pillDockSeen = dock;
    this.app.saveLocalStorage(GoodObsidianPlugin.PILL_DOCK_KEY, dock);
    for (const view of this.openNotebooks()) view.showPillDock(dock);
  }

  /** Every notebook view open in the workspace. */
  private openNotebooks(): InkView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_INK)
      .map((leaf) => leaf.view)
      .filter((view): view is InkView => view instanceof InkView);
  }

  /**
   * Save the open ink view's recent strokes and recogniser verdicts to a note
   * (and the clipboard, where the platform allows it) for a bug report. Made
   * for the iPad, where there is no console and a screen recording cannot show
   * what the recogniser thought.
   */
  private async copyShapeDiagnostics(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(InkView) ?? this.openNotebooks()[0];
    const report = view?.exportDiagnostics();
    if (!report) {
      new Notice("Open a handwriting note and draw a few shapes first.");
      return;
    }
    const path = normalizePath("FineNotes shape diagnostics.md");
    const body = `Paste this file's contents into the bug report.\n\n\`\`\`json\n${report}\n\`\`\`\n`;
    const existing = this.app.vault.getFileByPath(path);
    if (existing) await this.app.vault.modify(existing, body);
    else await this.app.vault.create(path, body);
    let copied = false;
    try {
      await writeSystemText(report);
      copied = true;
    } catch {
      // iOS refuses clipboard writes outside a direct user gesture; the note is the fallback.
    }
    new Notice(`Shape diagnostics ${copied ? "copied, and " : ""}saved to "${path}".`);
  }

  // --- Which view a note opens in ---------------------------------------------------

  /**
   * Open ink notes in the notebook view. Obsidian opens every `.md` file as
   * Markdown, so the request is changed where it is made: in
   * `WorkspaceLeaf.setViewState`, before a Markdown view exists. Swapping the
   * view after it opened would leave a Markdown entry in the leaf's history,
   * and Back would stop on it (see view-routing.ts). Other plugins with their
   * own view for `.md` files do the same. Leaves already showing an ink note
   * as Markdown when the plugin loads, or when the layout changes, are
   * switched over too.
   */
  private routeInkNotes(): void {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only ever called with a leaf as `this` (below), and put back as-is on unload
    const setViewState = WorkspaceLeaf.prototype.setViewState;
    const route = (state: ViewState): ViewState => {
      const type = this.router.typeToOpen(state.type, state.state?.file, (path) =>
        this.isInkPath(path),
      );
      return type === state.type ? state : { ...state, type };
    };
    WorkspaceLeaf.prototype.setViewState = function (
      this: WorkspaceLeaf,
      state: ViewState,
      eState?: unknown,
    ): Promise<void> {
      return setViewState.call(this, route(state), eState);
    };
    this.register(() => {
      WorkspaceLeaf.prototype.setViewState = setViewState;
    });

    this.registerEvent(this.app.workspace.on("layout-change", () => this.moveInkNotesOver()));
    this.app.workspace.onLayoutReady(() => {
      this.moveInkNotesOver();
      // Read before showWhatsNew, which starts the record of what this vault has seen.
      const welcome = shouldShowWelcome(this.firstInstall, this.hasNotebooks());
      void this.showWhatsNew();
      if (welcome) this.showWelcome();
    });
  }

  /** Whether `file` is an ink note (see `isInkNote`). */
  isInkFile(file: TFile): boolean {
    return isInkNote(
      file.extension,
      file.name,
      () => this.app.metadataCache.getFileCache(file)?.frontmatter,
    );
  }

  private isInkPath(path: string): boolean {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && this.isInkFile(file);
  }

  /** Markdown leaves showing an ink note switch to the notebook view. */
  private moveInkNotesOver(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW_TYPE)) {
      const file = leaf.view instanceof MarkdownView ? leaf.view.file : null;
      if (file && this.router.wantsNotebook(file.path, () => this.isInkFile(file))) {
        void this.showIn(leaf, VIEW_TYPE_INK, file);
      }
    }
  }

  /** The active leaf, when it shows an ink note in either view. */
  private switchableLeaf(): WorkspaceLeaf | null {
    const workspace = this.app.workspace;
    const view =
      workspace.getActiveViewOfType(InkView) ?? workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!view || !file) return null;
    return view instanceof InkView || this.isInkFile(file) ? view.leaf : null;
  }

  /** The toggle command: notebook to Markdown or back, remembered for the session. */
  private async switchView(leaf: WorkspaceLeaf): Promise<void> {
    const view = leaf.view;
    const file = view instanceof InkView || view instanceof MarkdownView ? view.file : null;
    if (!file) return;
    await this.showIn(leaf, this.router.toggle(file.path, view instanceof InkView), file);
  }

  private async showIn(leaf: WorkspaceLeaf, type: string, file: TFile): Promise<void> {
    await leaf.setViewState(showAs(leaf.getViewState(), type, file.path));
  }

  // --- New notebook ---------------------------------------------------------

  /**
   * Import a notebook from another note-taking app into `folder` (vault
   * relative; undefined means the default notebook folder). Called from the
   * file explorer's right-click menu and the New notebook dialog.
   */
  openImportNotebook(folder = "", preset?: readonly PickedFile[]): void {
    openImportNotebookModal(this.app, {
      ...(preset ? { preset } : {}),
      folder: folder || this.newNotebookFolder(),
      ownFolder: this.settings.notebookOwnFolder,
      open: async (file) => {
        const tab = this.app.workspace.getLeaf(false);
        await tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: file.path } });
        await this.app.workspace.revealLeaf(tab);
      },
    });
  }

  /**
   * The template gallery: FineNotes' own (`DEFAULT_GALLERY_URL`), or the one
   * whose index the settings name. Fetched only now, when it is opened, and
   * listed; a chosen paper goes into My templates, a notebook template opens
   * as a new notebook.
   */
  async openTemplateGallery(): Promise<boolean> {
    // Empty means FineNotes' own gallery; another address is another gallery.
    const url = this.settings.templateGalleryUrl.trim() || DEFAULT_GALLERY_URL;
    if (!/^https:\/\//i.test(url)) {
      new Notice(
        "FineNotes: a template gallery's address must start with https:// (Settings → Pages and notebooks).",
        8000,
      );
      return false;
    }
    let entries: GalleryEntry[];
    try {
      entries = readGalleryIndex((await requestUrl({ url })).json);
    } catch (error) {
      new Notice(`FineNotes: couldn't read the template gallery — ${errorMessage(error)}`, 8000);
      return false;
    }
    // Settles once the gallery is closed: true when a paper went into My templates.
    return new Promise<boolean>((resolve) => {
      let installing: Promise<boolean> | null = null;
      new TemplateGalleryModal(
        this.app,
        entries,
        (entry) => {
          installing = this.installTemplate(entry);
        },
        undefined,
        () => {
          // An install closes the gallery first, then downloads.
          window.setTimeout(() => {
            if (installing) void installing.then(resolve, () => resolve(false));
            else resolve(false);
          }, 0);
        },
        () => void this.openShareTemplate(),
      ).open();
    });
  }

  /** Add a gallery template: a paper to My templates, a notebook as a new notebook. True for a paper added. */
  private async installTemplate(entry: GalleryEntry): Promise<boolean> {
    const progress = new Notice(`FineNotes: downloading “${entry.name}”…`, 0);
    try {
      const bytes = (await requestUrl({ url: entry.download })).arrayBuffer;
      // A paper goes into My templates, checked by its bytes there (PDF,
      // PNG, JPEG or WebP only, 40 MB at most); no previews are drawn here.
      if (entry.kind === "paper") {
        const library = new VaultPaperLibrary(
          this.app,
          () => templateFolderOf(normalizeFolder(this.settings.templateFolder)),
          () => undefined,
        );
        const ext = entry.download.split(/[?#]/)[0].split(".").pop() ?? "pdf";
        return await library.addFile(bytes, `${entry.name}.${ext}`);
      }
      const folder = templateFolderOf(normalizeFolder(this.settings.templateFolder));
      if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
      const name = `${entry.name.replace(/[\\/:*?"<>|#^[\]]+/g, " ").trim() || "Template"}.${TEMPLATE_EXTENSION}`;
      const path = normalizePath(`${folder}/${name}`);
      const existing = this.app.vault.getFileByPath(path);
      if (existing) await this.app.vault.modifyBinary(existing, bytes);
      else await this.app.vault.createBinary(path, bytes);
      this.openImportNotebook("", [{ name, read: () => Promise.resolve(bytes) }]);
      return false;
    } catch (error) {
      new Notice(`FineNotes: couldn't download that template — ${errorMessage(error)}`, 8000);
      return false;
    } finally {
      progress.hide();
    }
  }

  /** Whether the vault holds any notebook or page yet. */
  private hasNotebooks(): boolean {
    return this.app.vault.getMarkdownFiles().some((file) => this.isInkFile(file));
  }

  /** The welcome: the tour, the importer, or a new notebook (welcome-modal.ts). */
  showWelcome(): void {
    new WelcomeModal(this.app, {
      openTour: () => void this.openWelcomeTour(),
      importNotebooks: () => this.openImportNotebook(),
      newNotebook: () => this.openNewNotebookDialog(),
    }).open();
  }

  /** The welcome notebook: the one already in the vault, or a new one in the default folder. */
  async openWelcomeTour(): Promise<void> {
    const name = `${WELCOME_TITLE}${NOTEBOOK_FILE_SUFFIX}`;
    const existing = this.app.vault.getMarkdownFiles().find((file) => file.name === name);
    if (existing) {
      const tab = this.app.workspace.getLeaf(false);
      await tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: existing.path } });
      await this.app.workspace.revealLeaf(tab);
      return;
    }
    const folder = normalizeFolder(this.newNotebookFolder());
    const stickers = await this.saveWelcomeStickers(joinVaultPath(folder, name));
    await this.createNotebook(
      WELCOME_TITLE,
      { ...DEFAULT_NOTEBOOK_CHOICES },
      folder,
      (heading, attachments) => buildWelcomeNotebook(heading, attachments, stickers),
      // The tour's only files of its own are its stickers: no folder for it.
      false,
    );
  }

  /**
   * The welcome tour's stickers and toolbar picture, saved where a picture
   * added to a note at `notePath` would go. One that cannot be saved is left
   * off its page (the toolbar page then draws the bar by hand).
   */
  private async saveWelcomeStickers(notePath: string): Promise<StickerPaths> {
    const paths: Record<string, string> = {};
    // The toolbar's picture is drawn with Obsidian's own icons, as the bar shows them.
    const icon = (id: string): string | null => getIcon(id)?.innerHTML ?? null;
    for (const { key, name, svg } of welcomeStickerFiles(icon)) {
      try {
        const bytes = new TextEncoder().encode(svg).buffer;
        const prepared = { bytes, mime: "image/svg+xml", ext: "svg", width: 0, height: 0 };
        paths[key] = (await saveImageAttachment(this.app, prepared, name, notePath)).path;
      } catch (error) {
        console.warn(`FineNotes: could not save the welcome sticker ${name}`, error);
      }
    }
    return paths;
  }

  /** The "New notebook" dialog, preset with the last choices and the default folder. */
  openNewNotebookDialog(folder?: string): void {
    // My templates' previews: a PDF cache of the dialog's own, let go when it closes.
    const cache = new PdfBackdropCache(this.app);
    const painter = new VaultBackdropRenderer(cache);
    painter.setDeviceScale(thumbnailRasterScale(window.devicePixelRatio || 1));
    const library = this.paperLibrary((canvas, backdrop, geometry, cssWidth) => {
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
    });
    const modal = new NewNotebookModal(this.app, {
      choices: parseNotebookChoices(this.settings.lastNotebookChoices),
      template: parseNotebookTemplate(this.settings.lastNotebookTemplate),
      folder: folder ?? this.newNotebookFolder(),
      papers: library,
      onClosed: () => cache.destroy(),
      onImport: (folder) => this.openImportNotebook(folder),
      onCreate: ({ title, choices, folder, template }) => {
        this.settings.lastNotebookChoices = { ...choices };
        // A board takes no template: the notebook's last one stays remembered.
        if (choices.type !== "endless") {
          this.settings.lastNotebookTemplate = template
            ? { path: template.path, page: template.page }
            : null;
        }
        void this.saveSettings();
        if (template)
          void this.createNotebookFromTemplate(title, choices, folder, template, library);
        else void this.createNotebook(title, choices, folder);
      },
    });
    cache.onReady = (path) => modal.paperReady(path);
    modal.open();
  }

  /**
   * The dialog's last choices without the dialog: the template it made a
   * notebook of last time while that is still in My templates, else the paper.
   */
  private async createNotebookWithLastSettings(): Promise<void> {
    const choices = parseNotebookChoices(this.settings.lastNotebookChoices);
    const remembered = parseNotebookTemplate(this.settings.lastNotebookTemplate);
    if (remembered && choices.type !== "endless") {
      const library = this.paperLibrary();
      const entries = await library.list().catch(() => []);
      const entry = entries.find((e) => e.path === remembered.path && e.page === remembered.page);
      if (entry) {
        await this.createNotebookFromTemplate(
          "",
          choices,
          this.newNotebookFolder(),
          entry,
          library,
        );
        return;
      }
    }
    await this.createNotebook("", choices);
  }

  /** My templates, painting previews with `paint`, and with the community gallery. */
  private paperLibrary(
    paint: ConstructorParameters<typeof VaultPaperLibrary>[2] = () => undefined,
  ): VaultPaperLibrary {
    return new VaultPaperLibrary(
      this.app,
      () => templateFolderOf(normalizeFolder(this.settings.templateFolder)),
      paint,
      () => this.openTemplateGallery(),
      (path) => void this.openShareTemplate(path),
    );
  }

  /**
   * "Share…": one of My templates to the community gallery. The share
   * dialog asks for its details, then GitHub's submission form opens filled
   * in, and a notice says which file to attach there.
   */
  async openShareTemplate(initial?: string): Promise<void> {
    // A designed paper is not a file the gallery takes.
    const entries = (await this.paperLibrary().list()).filter((entry) => !entry.design);
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.path, (counts.get(entry.path) ?? 0) + 1);
    const templates = [...counts].map(([path, pages]) => ({ path, name: paperName(path), pages }));
    const saved: unknown = this.app.loadLocalStorage(SHARE_AUTHOR_KEY);
    new ShareTemplateModal(
      this.app,
      templates,
      initial,
      (url, template, author) => {
        this.app.saveLocalStorage(SHARE_AUTHOR_KEY, author);
        window.open(url);
        new Notice(
          `FineNotes: in the form on GitHub, attach “${template.path}” under Files, then submit. ` +
            "A bot replies there in a minute or two. If GitHub's app shows a plain issue " +
            "instead of the form, open the link in Safari.",
          20000,
        );
      },
      typeof saved === "string" ? saved : "",
    ).open();
  }

  /**
   * A new notebook made of a template from My templates: the cover chosen,
   * then every page of the template's PDF, which is copied beside the
   * notebook first (a notebook keeps its own files, Joost 2026-10-17), so its
   * links work and deleting the template never blanks it.
   */
  private async createNotebookFromTemplate(
    title: string,
    choices: NotebookChoices,
    folder: string,
    template: PaperEntry,
    library: VaultPaperLibrary,
  ): Promise<void> {
    // A designed paper: the cover chosen, then a page of it; no file to copy.
    const design = template.design;
    if (design) {
      await this.createNotebook(title, choices, folder, (heading, attachments) =>
        buildDesignedNotebook(choices, heading, attachments, design),
      );
      return;
    }
    const source = this.app.vault.getFileByPath(template.path);
    if (!source) {
      new Notice("FineNotes: that template's file is gone from the vault.");
      return;
    }
    const sizes = (await library.list())
      .filter((entry) => entry.path === template.path)
      .sort((a, b) => a.page - b.page)
      .map(({ width, height }) => ({ width, height }));
    const bytes = await this.app.vault.readBinary(source);
    await this.createNotebook(title, choices, folder, async (heading, attachments, home) => {
      const dir = attachments?.images ?? home;
      if (dir && !this.app.vault.getFolderByPath(dir)) {
        await this.app.vault.createFolder(dir).catch(() => undefined);
      }
      const stem = `${PAPER_COPY_PREFIX}${paperName(template.path)}`;
      let path = normalizePath(joinVaultPath(dir, `${stem}.pdf`));
      for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
        path = normalizePath(joinVaultPath(dir, `${stem} ${n}.pdf`));
      }
      await this.app.vault.createBinary(path, bytes);
      return buildPdfNotebook(choices, heading, attachments, path, sizes, true);
    });
  }

  /**
   * A notebook and its own folder keep one name: renaming either renames
   * the other (`followPairRename`). Run after Obsidian's own rename has
   * finished, through `fileManager.renameFile` so links follow too.
   */
  private keepFolderNotebookPaired(file: TAbstractFile, oldPath: string): void {
    if (!this.settings.folderNotebooks) return;
    const folder = file instanceof TFolder ? file : file.parent;
    if (!folder) return;
    const entries = folder.children.map((child) => ({
      name: child.name,
      folder: child instanceof TFolder,
    }));
    const pair = followPairRename(oldPath, file.path, file instanceof TFolder, entries);
    if (!pair) return;
    window.setTimeout(() => {
      const from = this.app.vault.getAbstractFileByPath(pair.from);
      if (!from || this.app.vault.getAbstractFileByPath(pair.to)) return;
      this.app.fileManager.renameFile(from, pair.to).catch((error: unknown) => {
        new Notice(`FineNotes: could not rename ${pair.from} — ${errorMessage(error)}`, 8000);
      });
    }, 0);
  }

  /** The setting's folder, or the active file's (the behaviour before the setting existed). */
  private newNotebookFolder(): string {
    const parent = this.app.workspace.getActiveFile()?.parent;
    const active = parent && !parent.isRoot() ? parent.path : "";
    return targetFolder(this.settings.newNotebookFolder, active);
  }

  /**
   * Write `<folder>/<title>.notebook.md` (`.page.md` for a single page) — a
   * unique, sanitised name, the folder
   * created if it does not exist — and open it. With the "own folder" setting
   * it is `<folder>/<title>/<title>.notebook.md` beside `Images/`,
   * `Recordings/`, `Transcripts/`, `AI chats/` and `Exports/`, where those
   * then go (`ownFolder`, the setting unless given). `folder` undefined
   * means the default one.
   */
  async createNotebook(
    title: string,
    choices: NotebookChoices,
    folder?: string,
    /** The notebook, given its title, its own folders and the folder it is made in. */
    build: (
      heading: string,
      attachments: AttachmentFolders | undefined,
      folder: string,
    ) => InkDocument | Promise<InkDocument> = (heading, attachments) =>
      buildNewDocument(choices, heading, attachments),
    ownFolder = this.settings.notebookOwnFolder,
    /** Open it in the current tab; false leaves the view where it is. */
    open = true,
  ): Promise<TFile | null> {
    const dir = normalizeFolder(folder ?? this.newNotebookFolder());
    try {
      const parent = dir ? this.app.vault.getFolderByPath(dir) : this.app.vault.getRoot();
      const taken = new Set(parent?.children.map((child) => child.name) ?? []);
      const paths = notebookPaths(dir, title, choices.type, ownFolder, taken);
      for (const path of paths.folders) {
        if (!this.app.vault.getFolderByPath(path)) await this.app.vault.createFolder(path);
      }
      const name = paths.fileName;
      const heading = cleanTitle(title) || stripInkSuffix(name);
      const content = buildInkFile(
        newNoteBody(heading, new Date().toISOString()),
        await build(heading, paths.attachments, paths.folder),
      );
      const file = await this.app.vault.create(
        normalizePath(joinVaultPath(paths.folder, name)),
        content,
      );
      if (!open) return file;
      // Straight into the notebook view, in the current tab, focused.
      const tab = this.app.workspace.getLeaf(false);
      await tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: file.path } });
      await this.app.workspace.revealLeaf(tab);
      return file;
    } catch (error) {
      new Notice(`FineNotes: could not create the notebook — ${errorMessage(error)}`, 8000);
      return null;
    }
  }

  // --- Pages sent to another notebook (FineNotes#33) ---------------------------

  /** Every notebook pages could be sent to: not a single page, not a practice set. */
  transferTargets(): TransferTarget[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        const name = file.name.toLowerCase();
        return (
          this.isInkFile(file) &&
          !name.endsWith(SINGLE_PAGE_FILE_SUFFIX) &&
          !name.endsWith(PRACTICE_FILE_SUFFIX)
        );
      })
      .map((file) => ({
        path: file.path,
        title: stripInkSuffix(file.name),
        mtime: file.stat.mtime,
      }));
  }

  /** The notebooks pages went to last, most recent first (kept on this device). */
  recentTransferTargets(): string[] {
    const raw: unknown = this.app.loadLocalStorage(RECENT_TARGETS_KEY);
    if (typeof raw !== "string") return [];
    try {
      const list: unknown = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
    } catch {
      return [];
    }
  }

  rememberTransferTarget(path: string): void {
    const next = rememberTarget(this.recentTransferTargets(), path);
    this.app.saveLocalStorage(RECENT_TARGETS_KEY, JSON.stringify(next));
  }

  /**
   * Add copies of `pages` to the end of the notebook at `path`: through its
   * view when it is open (so the view keeps owning the file), else by
   * rewriting the file. A string comes back when it cannot be done.
   */
  async sendPages(path: string, pages: readonly Page[]): Promise<TransferReceipt | string> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return "that notebook is gone.";
    const title = stripInkSuffix(file.name);
    const view = this.openNotebooks().find((open) => open.file?.path === path);
    if (view) {
      const received = view.receivePages(pages);
      return typeof received === "string" ? received : { path, title, undo: received.undo };
    }
    const outcome: { refusal: string | null; added: string[] } = { refusal: null, added: [] };
    try {
      await this.app.vault.process(file, (data) => {
        const parsed = parseInkFile(data, this.settings.paperWidth);
        if (!parsed.doc) {
          outcome.refusal = "that notebook could not be read.";
          return data;
        }
        outcome.refusal = transferRefusal(parsed.doc);
        if (outcome.refusal) return data;
        const command = new ReceivePages(pages);
        command.apply(parsed.doc);
        outcome.added = command.added.map((page) => page.id);
        return buildInkFile(parsed.body, parsed.doc);
      });
    } catch (error) {
      return `could not write to ${title} — ${errorMessage(error)}`;
    }
    if (outcome.refusal) return outcome.refusal;
    const { added } = outcome;
    return {
      path,
      title,
      undo: async () => {
        await this.app.vault.process(file, (data) => {
          const parsed = parseInkFile(data, this.settings.paperWidth);
          if (!parsed.doc || removePagesById(parsed.doc, added) === 0) return data;
          return buildInkFile(parsed.body, parsed.doc);
        });
      },
    };
  }

  /** A new notebook that starts with copies of `pages`, left unopened. */
  async sendPagesToNewNotebook(
    title: string,
    pages: readonly Page[],
  ): Promise<TransferReceipt | string> {
    const choices: NotebookChoices = {
      ...parseNotebookChoices(this.settings.lastNotebookChoices),
      type: "notebook",
      cover: "none",
    };
    const file = await this.createNotebook(
      title || "Moved pages",
      choices,
      undefined,
      (heading, attachments) => {
        const doc = buildNewDocument(choices, heading, attachments);
        const copies = prepareTransfer(pages, { ...doc, pages: [] });
        if (copies.length > 0) {
          doc.pages = copies;
          doc.view.width = copies[0].geometry.width;
        }
        return doc;
      },
      this.settings.notebookOwnFolder,
      false,
    );
    if (!file) return "the new notebook could not be made.";
    return {
      path: file.path,
      title: stripInkSuffix(file.name),
      undo: async () => {
        await this.app.fileManager.trashFile(file);
      },
    };
  }

  /**
   * Practice set `set` as a new `.practice.md` file in FineNotes
   * assets/Handwriting sheets, opened at its cover. Sheets made elsewhere before
   * 2.6 stay where they are: learning finds them anywhere in the vault.
   */
  async createPracticeFile(set: number): Promise<TFile | null> {
    const dir = HANDWRITING_FOLDER;
    try {
      if (dir && !this.app.vault.getFolderByPath(dir)) await this.app.vault.createFolder(dir);
      const parent = dir ? this.app.vault.getFolderByPath(dir) : this.app.vault.getRoot();
      const taken = new Set(parent?.children.map((child) => child.name) ?? []);
      const base = isSymbolSet(set) ? "Symbol practice" : `Handwriting practice ${set}`;
      const name = uniqueFileName(base, PRACTICE_FILE_SUFFIX, taken);
      const geometry = { ...DEFAULT_PAGE_GEOMETRY, width: this.settings.paperWidth };
      const content = buildInkFile(
        newNoteBody(stripInkSuffix(name), new Date().toISOString()),
        buildPracticeFile(set, geometry),
      );
      const file = await this.app.vault.create(normalizePath(joinVaultPath(dir, name)), content);
      const tab = this.app.workspace.getLeaf(false);
      await tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: file.path } });
      await this.app.workspace.revealLeaf(tab);
      return file;
    } catch (error) {
      new Notice(`FineNotes: could not create the practice file — ${errorMessage(error)}`, 8000);
      return null;
    }
  }

  /**
   * A new notebook beside `pdf` whose pages are the PDF's pages (#14), with
   * the last notebook choices for size and folder layout. The PDF is only
   * read: it stays where it is, and the notebook follows it if it moves.
   */
  async createNotebookFromPdf(pdf: TFile): Promise<void> {
    const progress = new Notice("FineNotes: reading PDF pages…", 0);
    let sizes: Array<{ width: number; height: number }>;
    try {
      sizes = await measurePdfPages(await this.app.vault.readBinary(pdf));
    } catch (error) {
      new Notice(`FineNotes: couldn't read the PDF — ${errorMessage(error)}`, 8000);
      return;
    } finally {
      progress.hide();
    }
    if (sizes.length === 0) {
      new Notice("FineNotes: that PDF has no pages.");
      return;
    }
    const choices: NotebookChoices = {
      ...parseNotebookChoices(this.settings.lastNotebookChoices),
      type: "notebook",
    };
    const folder = pdf.parent && !pdf.parent.isRoot() ? pdf.parent.path : "";
    await this.createNotebook(pdf.basename, choices, folder, (heading, attachments) =>
      buildPdfNotebook(choices, heading, attachments, pdf.path, sizes),
    );
  }
}
