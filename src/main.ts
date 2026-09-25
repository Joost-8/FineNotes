import { DEFAULT_SHAPE_COLOR, parseHexColor, recentColorsOf } from "./model/colors";
import { type PenGestures, penGesturesOf } from "./ink/pen-gestures";
import {
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  type RequestUrlResponse,
  TFile,
  type ViewState,
  WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import { ICON_NEW_NOTEBOOK, PREVIOUS_PLUGIN_ID, VIEW_TYPE_INK } from "./constants";
import { DEFAULT_SETTINGS, GoodObsidianSettingTab, type GoodObsidianSettings } from "./settings";
import { buildInkFile } from "./model/serialize";
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
import { changelogSince, releasedChangelog } from "./changelog";
import { InkView } from "./view/ink-view";
import { MARKDOWN_VIEW_TYPE, ViewRouter, isInkNote, showAs } from "./view/view-routing";
import type { EraserMode } from "./view/toolbar";
import type { EraserFilter } from "./ink/stroke-eraser";
import type { LassoFilter, LassoMode } from "./canvas/lasso";
import {
  type NotebookChoices,
  buildNewDocument,
  cleanTitle,
  joinVaultPath,
  newNoteBody,
  normalizeFolder,
  notebookPaths,
  parseNotebookChoices,
  stripInkSuffix,
  targetFolder,
} from "./model/new-notebook";
import { NewNotebookModal } from "./view/new-notebook-modal";
import { registerImageMenuEntry } from "./view/image-menu";
import type { InkSurface } from "./view/ink-surface";
import type { TextStyle } from "./model/text-style";
import { errorMessage } from "./util/errors";
import changelogMd from "../CHANGELOG.md";

/** How many times the Text tool's hint pill is shown before it stops by itself. */
const TEXT_HINT_SHOWS = 3;
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
  override settings!: GoodObsidianSettings;
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

  /** Which view each note opens in (see view-routing.ts). */
  private readonly router = new ViewRouter();

  /** The transcription engine chosen in the settings; Manual when it is gone. */
  activeProvider(): RecognitionProvider {
    return resolveProvider(this.providers, this.settings.recognitionProviderId);
  }

  override async onload(): Promise<void> {
    // Each vendor reads only its own key slot, so a cloud key can never reach
    // an arbitrary user-configured URL (the custom endpoint has a slot of its own).
    // Registered before the settings load, which check the saved provider
    // against this registry; the config is read lazily, on each request.
    const cloud = new LlmProvider(() => this.textAiConfig());
    this.providers.set(cloud.id, cloud);

    await this.loadSettings();
    await this.setUpKeyStore();

    this.registerView(VIEW_TYPE_INK, (leaf) => new InkView(leaf, this));
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
    // Apple's own scanner, one tap away: Files → Scan Documents saves a PDF,
    // and this adds its pages after the current one.
    this.register(
      registerImageMenuEntry({
        id: "scan-pdf",
        icon: "file-text",
        label: "Scanned PDF from Files",
        order: 45,
        isAvailable: () => !this.app.workspace.getActiveViewOfType(InkView)?.isSinglePage,
        run: () => this.app.workspace.getActiveViewOfType(InkView)?.scanPdf(),
      }),
    );
    this.routeInkNotes();

    this.addRibbonIcon(ICON_NEW_NOTEBOOK, "New notebook", () => this.openNewNotebookDialog());
    this.addCommands();

    this.settingTab = new GoodObsidianSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // OpenRouter's sign-in page sends the browser back to
    // obsidian://goodobsidian-openrouter with a one-time code.
    this.registerObsidianProtocolHandler(OPENROUTER_CALLBACK_ACTION, (params) => {
      void this.handleOpenRouterCallback(params);
    });
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
      callback: () =>
        void this.createNotebook("", parseNotebookChoices(this.settings.lastNotebookChoices)),
    });

    this.notebookCommand(
      "convert-to-notebook",
      "Convert single page to notebook",
      (view) => view.convertToNotebook(),
      (view) => view.isSinglePage,
    );
    this.notebookCommand("scan-document", "Scan document into this notebook", (view) =>
      view.scanDocument(),
    );
    this.notebookCommand("search-notebook", "Search this notebook…", (view) => view.openSearch());
    this.notebookCommand("copy-page-link", "Copy link to current page", (view) =>
      view.copyPageLink(),
    );
    this.notebookCommand("export-pdf", "Export as PDF…", (view) => view.exportPdf());

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
    this.notebookCommand("fit-reset-view", "Fit the page and go to the top", (view) =>
      view.resetView(),
    );
    this.notebookCommand("zoom-in", "Zoom in", (view) => view.zoomIn());
    this.notebookCommand("zoom-out", "Zoom out", (view) => view.zoomOut());

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
    delete loaded.trocrModel;
    // Settings found under the old id are written to this id's folder at
    // once, so the carry-over happens exactly one time.
    if (own === null && saved !== null) await this.saveSettings();
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

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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

  /** Remember the pen's auto-shape toggle, for the next session. */
  savePenAutoShape(enabled: boolean): void {
    this.settings.penAutoShape = enabled;
    void this.saveSettings();
  }

  /** Remember which pen gestures are on, for the next session. */
  savePenGestures(gestures: PenGestures): void {
    this.settings.penGestures = penGesturesOf(gestures);
    void this.saveSettings();
  }

  /** Remember the Shape tool's colour, for the next session. */
  saveShapeColor(color: string): void {
    this.settings.shapeColor = parseHexColor(color) ?? DEFAULT_SHAPE_COLOR;
    void this.saveSettings();
  }

  /** Remember the custom colours picked lately, for every colour picker. */
  saveRecentColors(colors: readonly string[]): void {
    this.settings.recentColors = recentColorsOf(colors);
    void this.saveSettings();
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
      await navigator.clipboard.writeText(report);
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
      void this.showWhatsNew();
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

  /** The "New notebook" dialog, preset with the last choices and the default folder. */
  openNewNotebookDialog(): void {
    new NewNotebookModal(this.app, {
      choices: parseNotebookChoices(this.settings.lastNotebookChoices),
      folder: this.newNotebookFolder(),
      onCreate: ({ title, choices, folder }) => {
        this.settings.lastNotebookChoices = { ...choices };
        void this.saveSettings();
        void this.createNotebook(title, choices, folder);
      },
    }).open();
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
   * created if it does not exist — and open it. With `choices.ownFolder` it is
   * `<folder>/<title>/<title>.notebook.md` beside `Images/` and `Recordings/`,
   * where its pictures and recordings then go. `folder` undefined means the
   * default one.
   */
  async createNotebook(title: string, choices: NotebookChoices, folder?: string): Promise<void> {
    const dir = normalizeFolder(folder ?? this.newNotebookFolder());
    try {
      const parent = dir ? this.app.vault.getFolderByPath(dir) : this.app.vault.getRoot();
      const taken = new Set(parent?.children.map((child) => child.name) ?? []);
      const paths = notebookPaths(dir, title, choices.type, choices.ownFolder, taken);
      for (const path of paths.folders) {
        if (!this.app.vault.getFolderByPath(path)) await this.app.vault.createFolder(path);
      }
      const name = paths.fileName;
      const heading = cleanTitle(title) || stripInkSuffix(name);
      const content = buildInkFile(
        newNoteBody(heading, new Date().toISOString()),
        buildNewDocument(choices, heading, paths.attachments),
      );
      const file = await this.app.vault.create(
        normalizePath(joinVaultPath(paths.folder, name)),
        content,
      );
      // Straight into the notebook view, in the current tab, focused.
      const tab = this.app.workspace.getLeaf(false);
      await tab.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: file.path } });
      await this.app.workspace.revealLeaf(tab);
    } catch (error) {
      new Notice(`FineNotes: could not create the notebook — ${errorMessage(error)}`, 8000);
    }
  }
}
