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
import { DEFAULT_FILL_COLOR, type FillGap, readFillGap } from "./model/fill-region";
import { FileExplorerNotebookButton } from "./view/file-explorer-notebook-button";
import { ExplorerFolderNotebooks } from "./view/explorer-folder-notebooks";
import { WordCheck } from "./view/word-check";
import {
  followPairRename,
  isNotebookOwnFolder,
  outsideNotebookFolder,
} from "./model/folder-notebook";
import { DEFAULT_SHAPE_COLOR, parseHexColor, recentColorsOf } from "./model/colors";
import { tapeColorOf, tapeHeightOf } from "./model/cover-tape";
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
import { disposeVaultFonts } from "./view/font-store";
import {
  ICON_IMPORT_NOTEBOOK,
  ICON_IMPORT_NOTEBOOK_SVG,
  ICON_LIBRARY,
  ICON_LIBRARY_SVG,
  ICON_NEW_NOTEBOOK,
  ICON_STYLUS_ONLY,
  ICON_STYLUS_ONLY_SVG,
  PREVIOUS_PLUGIN_ID,
  VIEW_TYPE_INK,
  VIEW_TYPE_LIBRARY,
} from "./constants";
import { DEFAULT_SETTINGS, GoodObsidianSettingTab, type GoodObsidianSettings } from "./settings";
import { laserDefaultColorOf } from "./settings-data";
import {
  type PageAppearance,
  type PenPreferences,
  loadSnapSettings,
  shownPaperTheme,
  storeHandwritingReader,
  storePenPreferences,
  switchLlmVendor,
} from "./settings-data";
import { type PenCursorStyle, penCursorStyleOf } from "./view/pen-cursor";
import { LearnWindow } from "./view/learn-window";
import { fullScreenGroups, parseFullScreen, storedFullScreen } from "./view/full-screen-model";
import { type PillDock, parsePillDock } from "./view/pill-dock-model";
import { type BarDock, parseBarDock, pillAfterBarMove } from "./view/bar-dock-model";
import { parsePillRowOn } from "./view/pill-row-model";
import { ShortcutStore } from "./view/shortcut-store";
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
import { INBOX_FOLDER, InboxRuns, isInboxPdf } from "./model/inbox";
import {
  FINENOTES_LINK_ACTION,
  parseFinenotesLink,
  pdfByName,
  pdfCandidates,
} from "./model/finenotes-link";
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
import { starsOf } from "./model/favorites";
import { SIMPLE_CLASS, simpleClasses } from "./model/simple-mode";
import { HOME_FILE, HOME_FILE_TEXT, isOwnHomeText } from "./model/home-file";
import {
  dropPaths,
  dropStyles,
  folderStylesOf,
  movePaths,
  moveStyles,
} from "./model/library-style";
import { prepareImageBytes } from "./view/image-import";
import { LibraryView } from "./view/library-view";
import { MARKDOWN_VIEW_TYPE, ViewRouter, isInkNote, showAs } from "./view/view-routing";
import { PageEmbeds } from "./view/page-embed";
import type { EraserMode } from "./view/toolbar";
import type { EraserFilter } from "./ink/stroke-eraser";
import type { LassoFilter, LassoMode } from "./canvas/lasso";
import type { RulerKind } from "./canvas/ruler-geometry";
import {
  DEFAULT_NOTEBOOK_CHOICES,
  type NotebookChoices,
  type NotebookType,
  buildNewDocument,
  buildImageNotebook,
  buildPdfNotebook,
  cleanTitle,
  dialogChoices,
  joinVaultPath,
  newNoteBody,
  normalizeFolder,
  notebookPaths,
  parseNotebookChoices,
  parseNotebookTemplate,
  sanitizeFileName,
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
/** The notebook files this device has seen are endless boards (FineNotes#46), by path. */
const BOARDS_KEY = "goodobsidian:boards";

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
import { newCorrections, relearnDue } from "./recognition/hwr/learned-model";
import { NOTEBOOK_FILE_SUFFIX, PRACTICE_FILE_SUFFIX, SINGLE_PAGE_FILE_SUFFIX } from "./constants";
import { DEFAULT_PAGE_GEOMETRY } from "./model/document";
import type { TextStyle } from "./model/text-style";
import { errorMessage } from "./util/errors";
import changelogMd from "../CHANGELOG.md";
import { type PenInks } from "./model/pen-inks";
import { type PenStabilization, penStabilizationOf } from "./model/pen-stabilization";
import { type SavedPen, savedPensOf } from "./model/saved-pens";
import {
  type ToolbarLayout,
  isItemOff,
  migrateLayout,
  normalizeLayout,
  placeOf,
} from "./view/toolbar-layout";
import {
  type CalculatorData,
  parseCalculatorData,
  renameCalculatorHistory,
} from "./model/calculator-store";
import { writeSystemText } from "./view/system-clipboard";
import { InterfaceLanguage } from "./view/interface-language";
import { EN } from "./i18n/en";
import { t, tn } from "./i18n/translate";

/** How many times the Text tool's hint pill is shown before it stops by itself. */
const TEXT_HINT_SHOWS = 3;

/** The pen in hand is saved once it has been left alone this long, ms: a width slider drags. */
const LAST_PEN_SAVE_MS = 600;

/** How long after the layout is ready a bundled Grape is written to disk: off the startup path. */
const GRAPE_BRIDGE_DELAY_MS = 8000;

/** How long after the layout is ready the daily update check runs: off the startup path. */
const UPDATE_CHECK_DELAY_MS = 20_000;
/** How long a new install waits before making the Home note: a vault syncing in has notes by then. */
const HOME_FILE_DELAY_MS = 5000;
/** How long an `obsidian://finenotes?do=pdf` link waits for its file to reach the vault. */
const PDF_LINK_WAIT_MS = 15_000;
/** How long an inbox notebook waits for a link to claim it before a notice says it is there. */
const INBOX_LINK_GRACE_MS = 1500;
/** This device's record of the last update check (update-notice.ts). */
const UPDATE_KEY = "finenotes:update-check";

/** How long after load the main thread is watched for stalls (startup-log.ts), and how often. */
const STARTUP_WATCH_MS = 90_000;
const STARTUP_TICK_MS = 250;

/**
 * What `runRecognition` transcribes: the notebook view. An interface so the
 * consent logic below does not depend on the view's whole surface.
 */
export interface RecognitionTarget {
  recognize(engine: RecognitionProvider, background?: boolean): Promise<void>;
}

/** Where a key exchange with OpenRouter ended: a key, or what to tell the user. */
type OpenRouterOutcome = { key: string } | { problem: string };

/** How long after start the simple-look note waits, so the welcome is up first, ms. */
const SIMPLE_HINT_DELAY_MS = 2500;
/** How long the note stays, ms. */
const SIMPLE_HINT_MS = 20000;

export default class GoodObsidianPlugin extends Plugin {
  private readonly explorerNotebookButton = new FileExplorerNotebookButton(
    () => void this.openLibrary(),
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

  /** The language of the interface, and getting its table (interface-language.ts). */
  readonly language = new InterfaceLanguage({
    version: this.manifest.version,
    pluginDir: () => this.pluginDir,
    adapter: this.app.vault.adapter,
    chosen: () => this.settings.interfaceLanguage,
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
      createPracticeFile: (set, only) => this.createPracticeFile(set, only),
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
    // Before anything with words in it is made.
    await this.language.start();
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
    this.applySimpleLook();
    this.register(() => {
      if (typeof document !== "undefined") document.body.classList.remove(SIMPLE_CLASS);
    });
    // Fonts fetched for text boxes leave the document with the plugin.
    this.register(disposeVaultFonts);
    this.registerView(VIEW_TYPE_INK, (leaf) => new InkView(leaf, this));
    this.registerView(
      VIEW_TYPE_LIBRARY,
      (leaf) =>
        new LibraryView(leaf, {
          newNotebook: (folder) => this.openNewNotebookDialog(folder),
          newBoard: (folder) => this.openNewNotebookDialog(folder, "endless"),
          importFromApp: (folder) => this.openImportNotebook(folder),
          importImage: (file, folder) => void this.createNotebookFromImage(file, folder),
          openSettings: () => this.openOwnSettings(),
          update: () => this.updates.available,
          openUpdate: () => this.openUpdatePage(),
          importPdf: (source, folder) => {
            const name = source.file.name.replace(/\.pdf$/i, "");
            void this.createNotebookFromPdfBytes(
              name,
              this.pdfNotebookChoices(),
              folder,
              () =>
                source.kind === "vault"
                  ? this.app.vault.readBinary(source.file)
                  : source.file.arrayBuffer(),
              source.kind === "vault" ? source.file.path : { name },
            );
          },
          stars: () => this.settings.libraryStars,
          setStars: (stars) => {
            this.settings.libraryStars = stars;
            void this.saveSettings();
          },
          folderStyles: () => this.settings.libraryFolders,
          setFolderStyles: (styles) => {
            this.settings.libraryFolders = styles;
            void this.saveSettings();
          },
          exportPdf: async (file) => {
            const leaf = this.app.workspace.getLeaf("tab");
            await leaf.openFile(file);
            if (leaf.view instanceof InkView) leaf.view.exportPdf();
          },
          isInkFile: (file) => this.isInkFile(file),
        }),
    );
    // FineNotes' own icons, before any button that uses them is made.
    addIcon(ICON_IMPORT_NOTEBOOK, ICON_IMPORT_NOTEBOOK_SVG);
    addIcon(ICON_LIBRARY, ICON_LIBRARY_SVG);
    addIcon(ICON_STYLUS_ONLY, ICON_STYLUS_ONLY_SVG);
    // The image menu's "Generate with AI" row: the same modal as the AI menu,
    // listed only when an image service is configured.
    this.register(
      registerImageMenuEntry({
        id: "generate-ai",
        icon: "sparkles",
        label: t("notebooks.imageMenu.generateAi"),
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
        label: t("notebooks.imageMenu.scan"),
        order: 40,
        // A scan fills its page, and a board's page is metres across (FineNotes#46).
        isAvailable: () => this.app.workspace.getActiveViewOfType(InkView)?.isBoard !== true,
        run: () => this.app.workspace.getActiveViewOfType(InkView)?.scanDocument(),
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source === "file-explorer-context-menu" && this.settings.showNewNotebookInContextMenu) {
          const folder = file instanceof TFolder ? file : file.parent;
          menu.addItem((item) =>
            item
              .setTitle(t("notebooks.menu.newNotebook"))
              .setIcon(ICON_NEW_NOTEBOOK)
              .setSection("action-primary")
              .onClick(() =>
                this.openNewNotebookDialog(folder && !folder.isRoot() ? folder.path : ""),
              ),
          );
          // Right below it: a notebook from another app, into the folder clicked.
          menu.addItem((item) =>
            item
              .setTitle(t("notebooks.menu.importNotebook"))
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
            .setTitle(t("notebooks.menu.newFromPdf"))
            .setIcon(ICON_NEW_NOTEBOOK)
            .onClick(() => void this.createNotebookFromPdf(file)),
        );
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (!view) return;
        menu.addItem((item) =>
          item
            .setTitle(t("notebooks.menu.importPdfInto"))
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
        this.libraryPathChanged(oldPath, file.path);
        this.calculatorFileMoved(oldPath, file.path);
        this.practiceNotebookMoved(oldPath, file.path);
        if (this.knownBoards().has(oldPath)) {
          this.noteBoard(oldPath, false);
          this.noteBoard(file.path, true);
        }
      }),
    );
    this.registerEvent(this.app.vault.on("delete", (file) => this.libraryPathChanged(file.path)));
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
      this.startInbox();
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
    // The library is the way in: notebooks are made there (its +), not from a ribbon icon of their own.
    // Obsidian keeps a ribbon icon's place (hidden, moved) by its title, so the
    // title stays English; the tooltip shows the language in use.
    this.addRibbonIcon(
      ICON_LIBRARY,
      EN["notebooks.ribbon.library"],
      () => void this.openLibrary(),
    ).setAttribute("aria-label", t("notebooks.ribbon.library"));
    this.addCommands();

    this.settingTab = new GoodObsidianSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // OpenRouter's sign-in page sends the browser back to
    // obsidian://goodobsidian-openrouter with a one-time code.
    this.registerObsidianProtocolHandler(OPENROUTER_CALLBACK_ACTION, (params) => {
      void this.handleOpenRouterCallback(params);
    });
    // obsidian://finenotes?do=… from the Shortcuts app (finenotes-link.ts).
    // A cold start can hand the link over before the workspace is up.
    this.registerObsidianProtocolHandler(FINENOTES_LINK_ACTION, (params) => {
      this.app.workspace.onLayoutReady(() => void this.handleFinenotesLink(params));
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

  /** The notebook library: the tab that is already open, or a new one. */
  /** FineNotes' own page in Obsidian's settings. */
  private openOwnSettings(): void {
    const setting = (
      this.app as unknown as {
        setting?: { open(): void; openTabById(id: string): void };
      }
    ).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  async openLibrary(): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIBRARY)[0];
    const leaf = open ?? this.app.workspace.getLeaf("tab");
    if (!open) await leaf.setViewState({ type: VIEW_TYPE_LIBRARY, active: true });
    // Pinned, the first tab: a link or a notebook never replaces it.
    leaf.setPinned(true);
    await this.app.workspace.revealLeaf(leaf);
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
      name: t("notebooks.command.newNotebookOrPage"),
      callback: () => this.openNewNotebookDialog(),
    });

    this.addCommand({
      id: "create-notebook-with-last-settings",
      name: t("notebooks.command.createWithLastSettings"),
      callback: () => void this.createNotebookWithLastSettings(),
    });

    this.addCommand({
      id: "open-library",
      name: t("notebooks.command.openLibrary"),
      callback: () => void this.openLibrary(),
    });

    this.addCommand({
      id: "toggle-simple-look",
      name: t("notebooks.command.simpleLook"),
      callback: () => this.setSimpleLook(!this.settings.simpleLook),
    });

    this.addCommand({
      id: "show-welcome",
      name: t("notebooks.command.showWelcome"),
      callback: () => this.showWelcome(),
    });

    this.addCommand({
      id: "create-notebook-from-pdf",
      name: t("notebooks.command.newFromPdf"),
      callback: () =>
        new VaultPdfSuggestModal(this.app, (file) => void this.createNotebookFromPdf(file)).open(),
    });

    this.notebookCommand(
      "convert-to-notebook",
      t("notebooks.command.convertToNotebook"),
      (view) => view.convertToNotebook(),
      (view) => view.isSinglePage && !view.isBoard,
    );
    // An endless board (FineNotes#46) has no pages to add, scan or import
    // onto, link to or save as a template, and never a PDF's text.
    const pages = (view: InkView): boolean => !view.isBoard;
    this.notebookCommand(
      "scan-document",
      t("notebooks.command.scanDocument"),
      (view) => view.scanDocument(),
      pages,
    );
    this.notebookCommand(
      "import-pdf",
      t("notebooks.command.importPdf"),
      (view) => view.importPdf(),
      pages,
    );
    this.notebookCommand(
      "import-vault-pdf",
      t("notebooks.command.importVaultPdf"),
      (view) => view.importPdf(true),
      pages,
    );
    this.notebookCommand("search-notebook", t("notebooks.command.searchNotebook"), (view) =>
      view.openSearch(),
    );
    // The way in besides the More tools menu, whatever the bar shows.
    this.notebookCommand("customize-toolbar", t("toolbar.customize.title"), (view) =>
      view.customizeToolbar(),
    );
    this.notebookCommand(
      "copy-page-link",
      t("notebooks.command.copyPageLink"),
      (view) => view.copyPageLink(),
      pages,
    );
    this.notebookCommand(
      "copy-highlighted-text",
      t("notebooks.command.copyHighlighted"),
      (view) => view.copyHighlightedText(),
      pages,
    );
    // No default hotkey: desktop users give it one (FineNotes#42).
    this.notebookCommand(
      "turn-selection-into-text",
      t("notebooks.command.selectionToText"),
      (view) => view.turnSelectionIntoText(),
      (view) => view.hasInkSelected,
    );
    this.notebookCommand("export-pdf", t("notebooks.command.exportPdf"), (view) =>
      view.exportPdf(),
    );
    this.notebookCommand(
      "save-as-template",
      t("notebooks.command.saveAsTemplate"),
      (view) => view.saveAsTemplate(),
      pages,
    );
    this.notebookCommand(
      "save-page-as-template",
      t("notebooks.command.savePageAsTemplate"),
      (view) => {
        const shown = view.currentPageInk();
        if (shown) void view.savePageAsTemplate(shown.number - 1);
      },
      pages,
    );
    this.addCommand({
      id: "new-from-template",
      name: t("notebooks.command.newFromTemplate"),
      callback: () =>
        new TemplateFileSuggestModal(this.app, (file) =>
          this.openImportNotebook("", [
            { name: file.name, read: () => this.app.vault.readBinary(file) },
          ]),
        ).open(),
    });
    this.addCommand({
      id: "template-gallery",
      name: t("notebooks.command.templateGallery"),
      callback: () => void this.openTemplateGallery(),
    });
    this.addCommand({
      id: "share-template",
      name: t("notebooks.command.shareTemplate"),
      callback: () => void this.openShareTemplate(),
    });

    this.addCommand({
      id: "toggle-canvas-markdown-view",
      name: t("notebooks.command.switchView"),
      checkCallback: (checking) => {
        const leaf = this.switchableLeaf();
        if (leaf && !checking) void this.switchView(leaf);
        return leaf !== null;
      },
    });

    this.notebookCommand("toggle-text-layer", t("notebooks.command.toggleTextLayer"), (view) =>
      view.toggleTextPanel(),
    );
    this.notebookCommand("recognize-handwriting", t("notebooks.command.transcribe"), (view) =>
      this.runRecognition(view),
    );
    this.addCommand({
      id: "write-handwriting-practice",
      name: t("notebooks.command.practiceSet"),
      callback: () => void writePracticePage(this.learningHost()),
    });
    this.addCommand({
      id: "write-symbol-practice",
      name: t("notebooks.command.symbolPractice"),
      callback: () => void writeSymbolPractice(this.learningHost()),
    });
    this.addCommand({
      id: "learn-handwriting",
      name: t("notebooks.command.learnHandwriting"),
      callback: () => void this.learner.start(),
    });
    this.notebookCommand(
      "show-keyboard-shortcuts",
      t("notebooks.command.keyboardShortcuts"),
      (view) => view.toggleShortcuts(),
    );
    this.notebookCommand(
      "read-handwriting-on-device",
      t("notebooks.command.readOnDevice"),
      (view) => this.readOnDevice(view),
      () => this.settings.handwritingOnDevice !== false,
    );
    this.notebookCommand(
      "fit-reset-view",
      t("notebooks.command.fitReset"),
      (view) => view.resetView(),
      pages,
    );
    // The same on a board (FineNotes#46), which has no page or top to go to.
    this.notebookCommand(
      "fit-board-drawing",
      t("notebooks.command.fitBoard"),
      (view) => view.resetView(),
      (view) => view.isBoard,
    );
    this.notebookCommand("zoom-in", t("notebooks.command.zoomIn"), (view) => view.zoomIn());
    this.notebookCommand("zoom-out", t("notebooks.command.zoomOut"), (view) => view.zoomOut());

    this.addCommand({
      id: "toggle-only-stylus-mode",
      name: t("notebooks.command.stylusOnly"),
      callback: () => void this.setOnlyStylusMode(!this.stylusOnly),
    });

    this.addCommand({
      id: "toggle-input-debug-overlay",
      name: t("notebooks.command.debugOverlay"),
      callback: () => void this.setDebugHud(!this.settings.debugHud, true),
    });

    this.addCommand({
      id: "copy-shape-diagnostics",
      name: t("notebooks.command.shapeDiagnostics"),
      callback: () => void this.copyShapeDiagnostics(),
    });

    this.addCommand({
      id: "view-changelog",
      name: t("notebooks.command.changelog"),
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
    loadSnapSettings(this.settings, saved ?? {});
    this.settings.laserDefaultColor = laserDefaultColorOf(this.settings.laserDefaultColor);
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
    // The laser's dot frequency is gone: the trail is one smooth line now.
    delete loaded.laserDotFrequency;
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
    // The whole bar's layout (discussion #43) replaced the tools' three
    // lists: a vault that has only those is read as the bar it showed.
    const toolbar =
      saved !== null && "toolbarLayout" in saved
        ? normalizeLayout(this.settings.toolbarLayout)
        : migrateLayout(loaded.toolbarItems, loaded.toolbarOff, loaded.toolbarHome);
    // The Home button (2.8) joins a bar customized before it: once, at the
    // front of the start; a person who moves it away is not asked again.
    if (saved !== null && !("toolbarHomeAdded" in saved) && placeOf(toolbar, "home") === "menu") {
      toolbar.start.unshift("home");
    }
    this.settings.toolbarHomeAdded = true;
    this.settings.toolbarLayout = toolbar;
    delete loaded.toolbarItems;
    delete loaded.toolbarOff;
    delete loaded.toolbarHome;
    this.settings.libraryStars = starsOf(this.settings.libraryStars);
    this.settings.libraryFolders = folderStylesOf(this.settings.libraryFolders);
    // Stylus only shown nowhere cannot be on: nothing would show it or turn it off.
    if (isItemOff(toolbar, "stylus")) this.settings.onlyStylusMode = false;
    // A Zoom box line step outside the slider's range is a hand-edited file,
    // not a value to honour; a negative step overlaps the next line.
    const lineStep = Number(this.settings.zoomBoxLineStep);
    this.settings.zoomBoxLineStep = Number.isFinite(lineStep)
      ? Math.max(-50, Math.min(100, lineStep))
      : 0;
    this.settings.openRouterSkipCompressed = this.settings.openRouterSkipCompressed === true;
    const models: unknown = this.settings.llmModels;
    if (typeof models !== "object" || models === null || Array.isArray(models)) {
      this.settings.llmModels = {};
    }
    this.settings.zoomBoxAutoAdvance = this.settings.zoomBoxAutoAdvance === true;
    this.settings.magnifierZoomBox = this.settings.magnifierZoomBox === true;
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
    const fresh = relearnDue(
      newCorrections(this.wordCheck.answeredAt, record),
      count,
      this.settings.relearnRemindedAt,
    );
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

  /**
   * Read handwriting on this device with nothing, Grape, or the model
   * learned from the user's (the AI menu's "Read with", the settings' "Read
   * handwriting with"). Grape is offered for download if it is needed now.
   */
  async setHandwritingReader(choice: string): Promise<void> {
    storeHandwritingReader(this.settings, choice);
    await this.saveSettings();
    if (choice !== "off") {
      await this.grape.model.check();
      this.grape.offer("ask");
    }
  }

  /** The Learn your handwriting window: the AI menu's row, the settings, a practice sheet's button. */
  openLearnWindow(): void {
    new LearnWindow(this.app, this).open();
  }

  /** Keep the calculator's switches and history (model/calculator-store.ts). */
  saveCalculator(data: CalculatorData): void {
    this.settings.calculator = data;
    void this.saveSettings();
  }

  /**
   * The practice notebook from before practice files is found by the path
   * the settings keep: that path follows the notebook when it moves.
   */
  private practiceNotebookMoved(from: string, to: string): void {
    if (this.settings.practiceNotebookPath !== from) return;
    this.settings.practiceNotebookPath = to;
    void this.saveSettings();
  }

  /** A notebook's calculator history follows it when it is renamed or moved. */
  private calculatorFileMoved(from: string, to: string): void {
    const moved = renameCalculatorHistory(parseCalculatorData(this.settings.calculator), from, to);
    if (moved) this.saveCalculator(moved);
  }

  /** Once: the simple look is on, and one switch brings normal Obsidian back. */
  private sayWhereSimpleLookIs(): void {
    if (!this.settings.simpleLook || this.settings.simpleLookHinted) return;
    this.settings.simpleLookHinted = true;
    void this.saveSettings();
    const notice: Notice = new Notice(
      createFragment((fragment) => {
        fragment.createDiv({
          text: t("notebooks.simpleLook.newLook"),
        });
        const undo = fragment.createEl("button", { text: t("common.undo") });
        undo.addEventListener("click", () => {
          notice.hide();
          this.setSimpleLook(false);
        });
      }),
      SIMPLE_HINT_MS,
    );
  }

  /** Wear the body classes the simple look asks for now (none when it is off). */
  applySimpleLook(): void {
    if (typeof document === "undefined") return;
    const body = document.body;
    body.classList.remove(SIMPLE_CLASS);
    body.classList.add(...simpleClasses(this.settings.simpleLook));
  }

  setSimpleLook(on: boolean): void {
    this.settings.simpleLook = on;
    void this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    this.applySimpleLook();
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
    new Notice(t("notebooks.notice.readingCrash", { page: crash.page, name }), 20_000);
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
      new Notice(tn("notebooks.notice.keysMoved", moved), 12000);
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
    if (!ok) new Notice(t("notebooks.notice.keyNotStored"));
    return ok;
  }

  /**
   * Change the AI service and keep what the one left was set up with: its
   * key stays in its own slot, and its model comes back when it is chosen
   * again. A key from before 0.5 means "the service chosen", so it is
   * pinned to the service being left before the choice moves.
   */
  async switchLlmVendor(next: LlmVendor): Promise<void> {
    const from = this.settings.llmVendor;
    const legacy = this.settings.llmApiKey.trim();
    if (legacy && from !== next && !VENDORS[from].userEndpoint) {
      // Kept in `from`'s own slot (unless one is there already), it no
      // longer means "whichever service is chosen", so it must not follow.
      if (this.keys.get(from) || this.storeApiKey(from, legacy)) this.settings.llmApiKey = "";
    }
    switchLlmVendor(this.settings, next);
    await this.saveSettings();
  }

  /** Forget a key. */
  removeApiKey(slot: LlmVendor): void {
    if (slot === this.settings.llmVendor && this.settings.llmApiKey) {
      this.settings.llmApiKey = "";
      void this.saveSettings();
    }
    if (!this.keys.remove(slot)) {
      new Notice(t("notebooks.notice.keyNotRemoved"));
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
      skipCompressed: this.settings.openRouterSkipCompressed,
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
      title: custom ? t("notebooks.consent.titleCustom") : t("notebooks.consent.titleCloud"),
      message: t(custom ? "notebooks.consent.messageCustom" : "notebooks.consent.messageCloud", {
        action,
        what,
        target: targetLabel(target),
      }),
      cta: t("notebooks.consent.send"),
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
    const action = t("notebooks.consent.audioAction");
    if (!(await this.confirmAiSend(config, action, t("notebooks.consent.audioWhat")))) {
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
    new Notice(t("notebooks.notice.openAiSettings"));
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

  /** Store what a pen menu changed for every pen, and give it to every open notebook. */
  savePenPreferences(patch: Partial<PenPreferences>): void {
    const alpha = this.settings.highlighterAlpha;
    storePenPreferences(this.settings, patch);
    for (const view of this.openNotebooks()) {
      view.syncPenPreferences();
      // Opacity is how highlights already on the page are drawn too.
      if (this.settings.highlighterAlpha !== alpha) view.setHighlighterAlpha();
    }
    void this.saveSettings();
  }

  /** Remember the Shape tool's colour, for the next session. */
  saveShapeColor(color: string): void {
    this.settings.shapeColor = parseHexColor(color) ?? DEFAULT_SHAPE_COLOR;
    void this.saveSettings();
  }

  /** Remember cover tape's colour and height, for the next session. */
  saveTape(color: string, height: number): void {
    this.settings.tapeColor = tapeColorOf(color);
    this.settings.tapeHeight = tapeHeightOf(height);
    void this.saveSettings();
  }

  /** Remember whether new tables get a header row, for the next session. */
  saveTableHeader(on: boolean): void {
    this.settings.tableHeader = on;
    void this.saveSettings();
  }

  /** Remember how far the Fill tool reaches past gaps, for the next session. */
  saveFillColor(color: string): void {
    this.settings.fillColor = parseHexColor(color) ?? DEFAULT_FILL_COLOR;
    void this.saveSettings();
  }

  /** Remember how far the Fill tool reaches past gaps, for the next session. */
  saveFillGap(gap: FillGap): void {
    this.settings.fillGap = readFillGap(gap);
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

  /** Remember the pen types' order in the pen's row, for every notebook. */
  savePenTypeOrder(order: readonly string[]): void {
    this.settings.penTypeOrder = [...order];
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
    const toolbar = normalizeLayout(layout);
    this.settings.toolbarLayout = toolbar;
    void this.saveSettings();
    // Each notebook ends what an item now shown nowhere left on (effectsOfOffItems).
    for (const view of this.openNotebooks()) view.setToolbarItems(toolbar);
    if (this.settings.onlyStylusMode && isItemOff(toolbar, "stylus")) {
      void this.setOnlyStylusMode(false);
    }
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
    // Shown nowhere, Stylus only stays off: a command must not turn it on unseen.
    if (on && isItemOff(this.settings.toolbarLayout, "stylus")) return;
    this.settings.onlyStylusMode = on;
    // Asking for the pen alone means the Pencil is in hand: fingers stop drawing.
    if (on) this.setFingerDrawing(false);
    await this.saveSettings();
    for (const view of this.openNotebooks()) view.setOnlyStylusMode(on);
  }

  /**
   * Fingers draw while the Pencil is away (`input/finger-draw.ts`, the ⋯
   * panel's "Draw with finger"). Not a setting: the first pen event ends it,
   * and so does closing Obsidian. While it is on, Stylus-only mode rests.
   */
  fingerDrawing = false;

  /** Whether only the pen acts on the page now: the setting, unless fingers draw. */
  get stylusOnly(): boolean {
    return this.settings.onlyStylusMode === true && !this.fingerDrawing;
  }

  /** Fingers start or stop drawing, in every open notebook at once. */
  setFingerDrawing(on: boolean): void {
    if (this.fingerDrawing === on) return;
    this.fingerDrawing = on;
    for (const view of this.openNotebooks()) view.setFingerDrawing(on);
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
    surface.showTextHint(t("notebooks.hint.text"), () => {
      settings.textHintDismissed = true;
      void this.saveSettings();
    });
  }

  /**
   * The first time a pen stroke snaps to a shape, once per vault: where to
   * change when that happens (Pen gestures › Make shapes), in the Text
   * tool's hint pill.
   */
  offerShapeHint(surface: InkSurface): void {
    if (this.settings.shapeHintShown) return;
    this.settings.shapeHintShown = true;
    void this.saveSettings();
    surface.showTextHint(t("notebooks.hint.shape"), () => undefined);
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
    new Notice(t("notebooks.notice.scribble"), 0);
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
      t("notebooks.consent.pagesAction"),
      t("notebooks.consent.pagesWhat"),
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
    new Notice(t("notebooks.openRouter.connected"));
    // The settings may be open behind the notice: show them the new key.
    const tab = this.settingTab;
    if (tab && tab.containerEl.isConnected) tab.refresh();
  }

  /**
   * Trade the one-time `code` for a key. The secret is spent by the attempt,
   * whether it works or not: a code can be exchanged once.
   */
  private async exchangeOpenRouterCode(code: string | undefined): Promise<OpenRouterOutcome> {
    if (!code) return { problem: t("notebooks.openRouter.noCode") };
    const verifier = this.openRouterVerifier;
    if (verifier === null) {
      return { problem: t("notebooks.openRouter.notWaiting") };
    }
    this.openRouterVerifier = null;
    const request = buildKeyExchangeRequest(code, verifier);
    let reply: RequestUrlResponse;
    try {
      reply = await postJson(request.url, request.headers, request.body);
    } catch {
      return { problem: t("notebooks.openRouter.unreachable") };
    }
    const succeeded = reply.status >= 200 && reply.status < 300;
    if (!succeeded) {
      return { problem: t("notebooks.openRouter.refused", { status: reply.status }) };
    }
    let key = "";
    try {
      key = extractOpenRouterKey(reply.json);
    } catch {
      // A body that is not JSON carries no key either.
    }
    return key ? { key } : { problem: t("notebooks.openRouter.noKey") };
  }

  // --- Diagnostics ----------------------------------------------------------------

  /** The input debug overlay, on or off in every open notebook (the setting and the command). */
  async setDebugHud(enabled: boolean, announce = false): Promise<void> {
    this.settings.debugHud = enabled;
    await this.saveSettings();
    for (const view of this.openNotebooks()) view.setDebug(enabled);
    if (announce) {
      new Notice(t(enabled ? "notebooks.notice.debugShown" : "notebooks.notice.debugHidden"));
    }
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

  // --- Shortcuts on this device -------------------------------------------------

  /**
   * This device's shortcut rows (`view/shortcut-store.ts`), read once from
   * `localStorage`: a laptop's keys and an Android tablet's stylus button do
   * not belong in the synced settings.
   */
  get shortcuts(): ShortcutStore {
    this.shortcutsSeen ??= new ShortcutStore(this.app);
    return this.shortcutsSeen;
  }

  private shortcutsSeen: ShortcutStore | null = null;

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

  private static readonly PILL_ROW_KEY = "goodobsidian:pill-row";

  /**
   * "Dock tool options" (pill-row-model.ts): the pill by a bar along the top
   * or bottom becomes a row the page starts past. Off until chosen, so no
   * one's page moves; kept per device, as the bar's and the pill's places are.
   */
  get pillRow(): boolean {
    this.pillRowSeen ??= parsePillRowOn(this.app.loadLocalStorage(GoodObsidianPlugin.PILL_ROW_KEY));
    return this.pillRowSeen;
  }

  private pillRowSeen: boolean | null = null;

  /** The ⋯ panel switched "Dock tool options": keep it on this device, in every open notebook. */
  setPillRow(on: boolean): void {
    if (on === this.pillRow) return;
    this.pillRowSeen = on;
    this.app.saveLocalStorage(GoodObsidianPlugin.PILL_ROW_KEY, on ? "on" : null);
    for (const view of this.openNotebooks()) view.showPillRow(on);
  }

  private static readonly BAR_DOCK_KEY = "goodobsidian:bar-dock";

  /**
   * Where the tool bar rests (bar-dock-model.ts): along the top until the
   * "Toolbar" setting says otherwise. Kept per device, as the pill's place is,
   * not in the synced settings: an iPad and a laptop want different places.
   */
  get barDock(): BarDock {
    this.barDockSeen ??= parseBarDock(this.app.loadLocalStorage(GoodObsidianPlugin.BAR_DOCK_KEY));
    return this.barDockSeen;
  }

  private barDockSeen: BarDock | null = null;

  /**
   * The "Toolbar" setting chose `dock`: keep it on this device and move every
   * open notebook's bar. A pill resting by the bar goes with it
   * (`pillAfterBarMove`).
   */
  setBarDock(dock: BarDock): void {
    const from = this.barDock;
    if (dock === from) return;
    this.barDockSeen = dock;
    this.app.saveLocalStorage(GoodObsidianPlugin.BAR_DOCK_KEY, dock);
    for (const view of this.openNotebooks()) view.showBarDock(dock);
    this.setPillDock(pillAfterBarMove(this.pillDock, from, dock));
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
      new Notice(t("notebooks.notice.drawShapesFirst"));
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
    new Notice(
      t(copied ? "notebooks.notice.diagnosticsCopied" : "notebooks.notice.diagnosticsSaved", {
        path,
      }),
    );
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
      // A vault with notes is not new to Obsidian, whatever the plugin's data says.
      if (this.firstInstall && this.app.vault.getMarkdownFiles().length === 0) {
        const timer = window.setTimeout(() => void this.makeHomeFile(), HOME_FILE_DELAY_MS);
        this.register(() => window.clearTimeout(timer));
      }
      if (this.settings.simpleLook && !this.settings.simpleLookHinted) {
        if (typeof window !== "undefined") {
          // Cleared on unload: a plugin turned off in those seconds says nothing.
          const hint = window.setTimeout(() => this.sayWhereSimpleLookIs(), SIMPLE_HINT_DELAY_MS);
          this.register(() => window.clearTimeout(hint));
        }
      }
    });
    // Opening FineNotes' own Home note opens the library instead.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file?.path !== HOME_FILE) return;
        void this.app.vault.cachedRead(file).then(async (text) => {
          if (!isOwnHomeText(text)) return;
          const home: WorkspaceLeaf[] = [];
          this.app.workspace.iterateAllLeaves((leaf) => {
            const open = (leaf.view as { file?: TFile | null }).file;
            if (leaf.view.getViewType() === "markdown" && open?.path === HOME_FILE) home.push(leaf);
          });
          // The library first: with the Home note the only tab, closing it first
          // leaves no tab group to open the library in ("No tab group found").
          await this.openLibrary();
          for (const leaf of home) leaf.detach();
        });
      }),
    );
  }

  /**
   * A note called Home at the vault's root for someone new to Obsidian: it
   * opens the library, so there is always a file to click when the welcome
   * is closed. Made once, on a new install, a moment after start: a second
   * device whose vault is still syncing in has notes by then, and makes none.
   * Deleting it changes nothing.
   */
  private async makeHomeFile(): Promise<void> {
    if (this.app.vault.getAbstractFileByPath(HOME_FILE)) return;
    // Notebooks may be the new user's own by now (the welcome makes one); notes came with a sync.
    if (this.app.vault.getMarkdownFiles().some((file) => !this.isInkFile(file))) return;
    try {
      await this.app.vault.create(HOME_FILE, HOME_FILE_TEXT);
    } catch {
      // A name taken at the same moment: no home file is no harm.
    }
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
      folder: folder ? this.outsideNotebook(folder) : this.newNotebookFolder(),
      ownFolder: this.settings.notebookOwnFolder,
      placeFolder: (picked) => this.outsideNotebook(picked),
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
      new Notice(t("notebooks.notice.galleryHttps"), 8000);
      return false;
    }
    let entries: GalleryEntry[];
    try {
      entries = readGalleryIndex((await requestUrl({ url })).json);
    } catch (error) {
      new Notice(t("notebooks.notice.galleryUnreadable", { reason: errorMessage(error) }), 8000);
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
    const progress = new Notice(t("notebooks.notice.templateDownloading", { name: entry.name }), 0);
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
      new Notice(
        t("notebooks.notice.templateDownloadFailed", { reason: errorMessage(error) }),
        8000,
      );
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
      openHome: () => void this.openLibrary(),
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

  /**
   * The "New notebook" dialog, preset with the last choices and the default
   * folder. It opens as a notebook unless asked for a board, whatever was made last.
   */
  openNewNotebookDialog(folder?: string, kind: NotebookType = "notebook"): void {
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
      choices: dialogChoices(this.settings.lastNotebookChoices, kind),
      template: parseNotebookTemplate(this.settings.lastNotebookTemplate),
      // A folder given (the file list's right-click, a link) is stepped out
      // of a notebook's own folder too, so the chip shows where it will go.
      folder: folder === undefined ? this.newNotebookFolder() : this.outsideNotebook(folder),
      placeFolder: (picked) => this.outsideNotebook(picked),
      papers: library,
      onClosed: () => cache.destroy(),
      onImport: (folder) => this.openImportNotebook(folder),
      onImportPdf: ({ title, choices, folder }, source) => {
        this.settings.lastNotebookChoices = { ...choices };
        void this.saveSettings();
        const name = source.file.name.replace(/\.pdf$/i, "");
        const read = (): Promise<ArrayBuffer> =>
          source.kind === "vault"
            ? this.app.vault.readBinary(source.file)
            : source.file.arrayBuffer();
        void this.createNotebookFromPdfBytes(
          title.trim() || name,
          { ...choices, type: "notebook" },
          folder,
          read,
          source.kind === "vault" ? source.file.path : { name },
        );
      },
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
   * Always a notebook, even right after a board.
   */
  private async createNotebookWithLastSettings(): Promise<void> {
    const choices = dialogChoices(this.settings.lastNotebookChoices);
    const remembered = parseNotebookTemplate(this.settings.lastNotebookTemplate);
    if (remembered) {
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
        new Notice(t("notebooks.notice.shareForm", { path: template.path }), 20000);
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
      new Notice(t("notebooks.notice.templateGone"));
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
        new Notice(
          t("notebooks.notice.renameFailed", { path: pair.from, reason: errorMessage(error) }),
          8000,
        );
      });
    }, 0);
  }

  /**
   * The library's stars and folder looks follow a file or folder renamed or
   * moved to `to`, and go with one deleted (no `to`). Here rather than in
   * the library, so they follow while Home is closed too.
   */
  private libraryPathChanged(from: string, to?: string): void {
    const { libraryStars: stars, libraryFolders: styles } = this.settings;
    const nextStars = to === undefined ? dropPaths(stars, from) : movePaths(stars, from, to);
    const nextStyles = to === undefined ? dropStyles(styles, from) : moveStyles(styles, from, to);
    const starsChanged =
      nextStars.length !== stars.length || nextStars.some((p, i) => p !== stars[i]);
    const stylesChanged = JSON.stringify(nextStyles) !== JSON.stringify(styles);
    if (!starsChanged && !stylesChanged) return;
    this.settings.libraryStars = nextStars;
    this.settings.libraryFolders = nextStyles;
    void this.saveSettings();
  }

  /**
   * The setting's folder, or the active file's (the behaviour before the
   * setting existed); out of a notebook's own folder either way.
   */
  private newNotebookFolder(): string {
    const parent = this.app.workspace.getActiveFile()?.parent;
    const active = parent && !parent.isRoot() ? parent.path : "";
    return this.outsideNotebook(targetFolder(this.settings.newNotebookFolder, active));
  }

  /**
   * `folder`, or the folder the notebook lives in when `folder` is a
   * notebook's own folder or one of its folders for files: a new notebook
   * never goes in another's (discussion #43, where the active notebook's
   * folder was the default). Whether the explorer shows such folders as
   * notebooks does not matter: the folder is the notebook's either way.
   */
  private outsideNotebook(folder: string): string {
    return outsideNotebookFolder(normalizeFolder(folder), (path) => {
      const dir = this.app.vault.getFolderByPath(path);
      if (!dir) return false;
      const entries = dir.children.map((child) => ({
        name: child.name,
        folder: child instanceof TFolder,
      }));
      return isNotebookOwnFolder(dir.name, entries);
    });
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
    const dir = this.outsideNotebook(folder ?? this.newNotebookFolder());
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
      if (choices.type === "endless") this.noteBoard(file.path, true);
      if (!open) return file;
      // Straight into the notebook view, in the current tab, focused; made
      // from Home it gets a tab of its own, so Home stays where it is.
      const fromHome =
        this.app.workspace.getMostRecentLeaf()?.view.getViewType() === VIEW_TYPE_LIBRARY;
      const tab = this.app.workspace.getLeaf(fromHome ? "tab" : false);
      await tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: file.path } });
      await this.app.workspace.revealLeaf(tab);
      return file;
    } catch (error) {
      new Notice(t("notebooks.notice.createFailed", { reason: errorMessage(error) }), 8000);
      return null;
    }
  }

  // --- Pages sent to another notebook (FineNotes#33) ---------------------------

  /**
   * Every notebook pages could be sent to: not a single page, not a practice
   * set, and not a board this device has seen (a board is a `.notebook.md`
   * too, and only its file's ink says so).
   */
  transferTargets(): TransferTarget[] {
    const boards = this.knownBoards();
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        const name = file.name.toLowerCase();
        return (
          this.isInkFile(file) &&
          !name.endsWith(SINGLE_PAGE_FILE_SUFFIX) &&
          !name.endsWith(PRACTICE_FILE_SUFFIX) &&
          !boards.has(file.path)
        );
      })
      .map((file) => ({
        path: file.path,
        title: stripInkSuffix(file.name),
        mtime: file.stat.mtime,
      }));
  }

  /** {@link BOARDS_KEY}, read once. */
  private boards: Set<string> | null = null;

  /** The paths of the boards this device has opened or made (vault-scoped local storage). */
  knownBoards(): ReadonlySet<string> {
    if (!this.boards) {
      const raw: unknown = this.app.loadLocalStorage(BOARDS_KEY);
      let list: unknown = [];
      try {
        list = typeof raw === "string" ? JSON.parse(raw) : [];
      } catch {
        // Unreadable: start again; opening a board adds it back.
      }
      this.boards = new Set(
        Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [],
      );
    }
    return this.boards;
  }

  /** Whether the notebook at `path` is a board, as a view or a new file just showed. */
  noteBoard(path: string, board: boolean): void {
    const boards = this.knownBoards() as Set<string>;
    if (!path || boards.has(path) === board) return;
    if (board) boards.add(path);
    else boards.delete(path);
    this.app.saveLocalStorage(BOARDS_KEY, JSON.stringify([...boards]));
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
   * `only`: the symbol sheet's lines to write, when not all of them.
   */
  async createPracticeFile(set: number, only?: readonly number[]): Promise<TFile | null> {
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
        buildPracticeFile(set, geometry, only),
      );
      const file = await this.app.vault.create(normalizePath(joinVaultPath(dir, name)), content);
      const tab = this.app.workspace.getLeaf(false);
      await tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: file.path } });
      await this.app.workspace.revealLeaf(tab);
      return file;
    } catch (error) {
      new Notice(t("notebooks.notice.practiceFailed", { reason: errorMessage(error) }), 8000);
      return null;
    }
  }

  /**
   * A new notebook beside `pdf` whose pages are the PDF's pages (#14), with
   * the last notebook choices for size and folder layout. The PDF is only
   * read: it stays where it is, and the notebook follows it if it moves.
   */
  async createNotebookFromPdf(pdf: TFile, open = true): Promise<TFile | null> {
    const folder = pdf.parent && !pdf.parent.isRoot() ? pdf.parent.path : "";
    return this.createNotebookFromPdfBytes(
      pdf.basename,
      this.pdfNotebookChoices(),
      folder,
      () => this.app.vault.readBinary(pdf),
      pdf.path,
      open,
    );
  }

  /**
   * A new notebook with a picture on its first page (Home › New › Add image),
   * made with the last notebook choices; the picture is prepared as an
   * inserted one is and saved beside the notebook's attachments.
   */
  private async createNotebookFromImage(file: File, folder: string): Promise<void> {
    const choices = this.pdfNotebookChoices();
    let prepared: Awaited<ReturnType<typeof prepareImageBytes>>;
    try {
      prepared = await prepareImageBytes(await file.arrayBuffer(), file.type);
    } catch (error) {
      new Notice(t("notebooks.home.imageUnreadable", { reason: errorMessage(error) }), 8000);
      return;
    }
    const name = file.name.replace(/\.[^.]+$/, "");
    await this.createNotebook(
      name,
      choices,
      folder,
      async (heading, attachments, home) => {
        const dir = attachments?.images ?? home;
        if (dir && !this.app.vault.getFolderByPath(dir)) {
          await this.app.vault.createFolder(dir).catch(() => undefined);
        }
        const stem = sanitizeFileName(name) || t("notebooks.home.pictureName");
        let path = normalizePath(joinVaultPath(dir, `${stem}.${prepared.ext}`));
        for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
          path = normalizePath(joinVaultPath(dir, `${stem} ${n}.${prepared.ext}`));
        }
        await this.app.vault.createBinary(path, prepared.bytes);
        return buildImageNotebook(choices, heading, attachments, path, {
          width: prepared.width,
          height: prepared.height,
        });
      },
      this.settings.notebookOwnFolder,
      true,
    );
  }

  /** The last notebook choices, as a notebook (a PDF's pages are never a single page). */
  private pdfNotebookChoices(): NotebookChoices {
    return { ...parseNotebookChoices(this.settings.lastNotebookChoices), type: "notebook" };
  }

  /**
   * A new notebook whose pages are a PDF's. `pdf` is the vault path of a PDF
   * already in the vault, which the notebook reads where it is; or the name of
   * one from the device, whose bytes are saved beside the notebook first (a
   * notebook keeps its own files); or a vault PDF to `move` in beside it (the
   * inbox's). `folder` undefined is the new-notebook folder. The notebook, or
   * `null` when none was made.
   */
  private async createNotebookFromPdfBytes(
    title: string,
    choices: NotebookChoices,
    folder: string | undefined,
    read: () => Promise<ArrayBuffer>,
    pdf: string | { name: string } | { move: TFile },
    open = true,
  ): Promise<TFile | null> {
    const progress = new Notice(t("notebooks.notice.readingPdf"), 0);
    let sizes: Array<{ width: number; height: number }>;
    let bytes: ArrayBuffer;
    try {
      bytes = await read();
      // pdf.js may take the buffer it is given: measure a copy, keep the original.
      sizes = await measurePdfPages(bytes.slice(0));
    } catch (error) {
      new Notice(t("notebooks.notice.pdfUnreadable", { reason: errorMessage(error) }), 8000);
      return null;
    } finally {
      progress.hide();
    }
    if (sizes.length === 0) {
      new Notice(t("notebooks.notice.pdfEmpty"));
      return null;
    }
    const ownFolder = this.settings.notebookOwnFolder;
    if (typeof pdf === "string") {
      return this.createNotebook(
        title,
        choices,
        folder,
        (heading, attachments) => buildPdfNotebook(choices, heading, attachments, pdf, sizes),
        ownFolder,
        open,
      );
    }
    return this.createNotebook(
      title,
      choices,
      folder,
      async (heading, attachments, home) => {
        const dir = attachments?.images ?? home;
        if (dir && !this.app.vault.getFolderByPath(dir)) {
          await this.app.vault.createFolder(dir).catch(() => undefined);
        }
        const stem = sanitizeFileName("move" in pdf ? pdf.move.basename : pdf.name) || "PDF";
        let path = normalizePath(joinVaultPath(dir, `${stem}.pdf`));
        for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
          path = normalizePath(joinVaultPath(dir, `${stem} ${n}.pdf`));
        }
        if ("move" in pdf) await this.app.fileManager.renameFile(pdf.move, path);
        else await this.app.vault.createBinary(path, bytes);
        return buildPdfNotebook(choices, heading, attachments, path, sizes);
      },
      ownFolder,
      open,
    );
  }

  // --- The FineNotes inbox (inbox.ts) -------------------------------------------

  /** Each inbox PDF's notebook, shared by the folder watcher and a link that names it. */
  private readonly inboxRuns = new InboxRuns<TFile | null>();
  /** Inbox PDFs are read one at a time: each one runs pdf.js over the whole file. */
  private inboxQueue: Promise<unknown> = Promise.resolve();

  /**
   * Make the inbox if it is missing, turn what already waits in it into
   * notebooks, and watch it: a file that arrives (created, or moved in), and
   * a return to the app, since iPadOS may only show Obsidian a file saved by
   * another app once it is in front again.
   */
  private startInbox(): void {
    const arrived = (file: TAbstractFile): void => {
      if (file instanceof TFile && isInboxPdf(file.path)) void this.inboxArrived(file);
    };
    this.registerEvent(this.app.vault.on("create", arrived));
    this.registerEvent(this.app.vault.on("rename", arrived));
    // A plugin built in a test has no document.
    if (typeof document !== "undefined") {
      this.registerDomEvent(document, "visibilitychange", () => {
        if (document.visibilityState === "visible") this.sweepInbox();
      });
    }
    void (async () => {
      if (!this.app.vault.getFolderByPath(INBOX_FOLDER)) {
        await this.app.vault.createFolder(INBOX_FOLDER).catch(() => undefined);
      }
      this.sweepInbox();
    })();
  }

  private sweepInbox(): void {
    for (const file of this.app.vault.getFolderByPath(INBOX_FOLDER)?.children ?? []) {
      if (file instanceof TFile && isInboxPdf(file.path)) void this.inboxArrived(file);
    }
  }

  /**
   * The notebook an inbox PDF becomes: made in the new-notebook folder (the
   * root when none is set), with the PDF moved in beside it, so the inbox is
   * empty again. Started once, however many times the PDF is seen.
   */
  private importInbox(pdf: TFile): Promise<TFile | null> {
    return this.inboxRuns.run(pdf.path, () => {
      const run = this.inboxQueue.then(() =>
        // Gone meanwhile (the user moved it, or another run took it): nothing to do.
        this.app.vault.getFileByPath(pdf.path) === pdf
          ? this.createNotebookFromPdfBytes(
              pdf.basename,
              this.pdfNotebookChoices(),
              // The new-notebook folder, or the root: not the folder of
              // whatever happens to be open, which an arrival knows nothing of.
              targetFolder(this.settings.newNotebookFolder, ""),
              () => this.app.vault.readBinary(pdf),
              { move: pdf },
              false,
            )
          : null,
      );
      this.inboxQueue = run.catch(() => undefined);
      return run;
    });
  }

  /**
   * A PDF that turned up in the inbox by itself. A link that named it opens
   * its notebook; otherwise a notice says it is there, without leaving the
   * page being written on.
   */
  private async inboxArrived(pdf: TFile): Promise<void> {
    const path = pdf.path;
    const notebook = await this.importInbox(pdf);
    if (!notebook) return;
    // A link usually lands with the file or just after it: give it a moment.
    await new Promise((resolve) => window.setTimeout(resolve, INBOX_LINK_GRACE_MS));
    if (this.inboxRuns.claimed(path)) return;
    const notice = new Notice(
      t("notebooks.notice.notebookReady", { name: stripInkSuffix(notebook.name) }),
      8000,
    );
    notice.messageEl.addEventListener("click", () => void this.showNotebook(notebook));
  }

  /** Open `file` as a notebook in the current tab. */
  private async showNotebook(file: TFile): Promise<void> {
    const tab = this.app.workspace.getLeaf(false);
    await tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: file.path } });
    await this.app.workspace.revealLeaf(tab);
  }

  /**
   * The notebook a `do=pdf` link asks for. The inbox may have taken the PDF
   * already, or take it while the link waits for the file to show up; then
   * the link opens what the inbox made. A PDF anywhere else becomes a
   * notebook beside it, as "New notebook from PDF" does.
   */
  private async notebookForPdfLink(file: string): Promise<TFile | null> {
    const known = this.inboxRuns.claim(file);
    if (known) return known;
    const pdf = await this.waitForPdf(file);
    if (!pdf) return null;
    const meanwhile = this.inboxRuns.claim(file);
    if (meanwhile) return meanwhile;
    if (isInboxPdf(pdf.path)) {
      const run = this.importInbox(pdf);
      // Ours to open: the watcher, which sees it too, stays quiet.
      return this.inboxRuns.claim(pdf.path) ?? run;
    }
    return this.createNotebookFromPdf(pdf, false);
  }

  // --- obsidian://finenotes links ------------------------------------------------

  private async handleFinenotesLink(params: Record<string, string>): Promise<void> {
    const request = parseFinenotesLink(params);
    if (request.do === "new" && !request.last) {
      this.openNewNotebookDialog(request.folder ?? "");
    } else if (request.do === "new") {
      await this.createNotebook(
        request.name,
        dialogChoices(this.settings.lastNotebookChoices),
        request.folder,
      );
    } else if (request.do === "pdf") {
      const notebook = await this.notebookForPdfLink(request.file);
      if (notebook) await this.showNotebook(notebook);
    } else {
      new Notice(t("notebooks.notice.linkUnknown", { what: request.what }));
    }
  }

  /**
   * The vault PDF a link names. A shortcut saves the file and opens the link
   * at once, so Obsidian may not have seen the file yet: look again every
   * half second for up to PDF_LINK_WAIT_MS. When it never shows up, say
   * whether it is on disk at all, which tells "not indexed" from "not there".
   */
  private async waitForPdf(file: string): Promise<TFile | null> {
    const find = (): TFile | null => {
      for (const path of pdfCandidates(file)) {
        const found = this.app.vault.getFileByPath(normalizePath(path));
        if (found) return found;
      }
      const pdfs = this.app.vault
        .getFiles()
        .filter((f) => f.extension.toLowerCase() === "pdf")
        .map((f) => ({ path: f.path, name: f.name, mtime: f.stat.mtime }));
      const byName = pdfByName(file, pdfs);
      return byName ? this.app.vault.getFileByPath(byName) : null;
    };
    let found = find();
    if (found) return found;
    const waiting = new Notice(t("notebooks.notice.waitingForPdf", { file }), 0);
    try {
      const until = Date.now() + PDF_LINK_WAIT_MS;
      while (!found && Date.now() < until) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        found = find();
      }
    } finally {
      waiting.hide();
    }
    if (found) return found;
    const onDisk = await Promise.all(
      pdfCandidates(file).map((path) => this.app.vault.adapter.exists(normalizePath(path))),
    );
    new Notice(
      onDisk.some(Boolean)
        ? t("notebooks.notice.pdfNotIndexed", { file })
        : t("notebooks.notice.pdfMissing", { file }),
      10000,
    );
    return null;
  }
}
