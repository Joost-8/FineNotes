/**
 * The settings tab, built from Obsidian 1.13's setting definitions: Obsidian
 * draws the rows, searches them, and calls `getControlValue` /
 * `setControlValue` for the plain controls. The tab draws only what a plain
 * control cannot: callouts, the paper width and endpoint fields that check
 * what is typed, the folder field, and the API key rows.
 *
 * What is stored, and how, lives in `settings-data.ts`.
 */

import {
  type App,
  Platform,
  PluginSettingTab,
  type Setting,
  type SettingControl,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
import { SIZES } from "./constants";
import type GoodObsidianPlugin from "./main";
import { normalizeFolder } from "./model/new-notebook";
import { type ImageVendorChoice, resolveImageVendor } from "./recognition/ai-menu-model";
import {
  DEFAULT_IMAGE_MODELS,
  canGenerateImages,
  imageUnsupportedReason,
} from "./recognition/ai-image";
import {
  DEFAULT_MODELS,
  LLM_PROVIDER_ID,
  type LlmVendor,
  VENDOR_LABELS,
  VENDORS,
} from "./recognition/llm-request";
import { providerLabel } from "./recognition/registry";
import {
  type GoodObsidianSettings,
  PAPER_WIDTH_RANGE,
  changesTabLayout,
  endpointWarning,
  paperWidthFrom,
  shownValue,
  storeShownValue,
} from "./settings-data";
import { ApiKeyModal } from "./ui/api-key-modal";
import { ConfirmModal } from "./ui/confirm-modal";
import { FolderInputSuggest } from "./view/folder-suggest";

export { DEFAULT_SETTINGS, type GoodObsidianSettings, type ToolId } from "./settings-data";

type SettingKey = keyof GoodObsidianSettings;
type Visible = boolean | (() => boolean);

// --- Wording -----------------------------------------------------------------

/** A callout's bold first line, and the text under it if the line needs any. */
interface Callout {
  title: string;
  detail?: string;
}

const CALLOUTS = {
  scribble: {
    title: "iPad: switch off Scribble so no strokes go missing",
    detail:
      "Scribble, the iPadOS handwriting feature, can take a fast Apple Pencil stroke for " +
      "itself before FineNotes sees it. Switch it off in the iPad's Settings app, under " +
      "Apple Pencil → Scribble.",
  },
  paperWidth: {
    title: `Paper width must be ${PAPER_WIDTH_RANGE.min} to ${PAPER_WIDTH_RANGE.max}`,
    detail:
      "Type a whole number of pixels in that range; 1024 is the default. Until you do, " +
      "the last valid width is kept.",
  },
  incompleteUrl: {
    title: "This endpoint URL is not complete",
    detail:
      "Type the whole address, starting with http:// or https://, such as " +
      "http://localhost:11434/v1 or https://server.your-tailnet.ts.net/v1.",
  },
  plainHttp: {
    title: "iPhone and iPad often refuse plain HTTP",
    detail:
      "To reach this server from a phone or tablet, serve it over HTTPS, for instance with " +
      "“tailscale serve” or a Cloudflare Tunnel (SELF_HOSTING.md shows how). And on an " +
      "iPad, “localhost” is the iPad itself, not your server.",
  },
  noKeychain: {
    title: "API keys are stored in this vault's plugin data",
    detail:
      "This Obsidian version has no keychain. Obsidian 1.11.4 and newer keep keys outside the vault's files.",
  },
} satisfies Record<string, Callout>;

/** The tools an ink note can open with, as the dropdown names them. */
const TOOL_NAMES = { pen: "Pen", highlighter: "Highlighter", eraser: "Eraser", select: "Select" };

const DESC = {
  pressure: "Let pen pressure change how wide a stroke is. Only a pen or stylus reports it.",
  drawAndHold:
    "Draw a rough line, circle or polygon in one stroke and keep the pen still at the end: it snaps to a clean shape, which you can still resize and rotate before lifting.",
  desynchronized:
    "Asks the browser to draw ink with less delay. Switch it off if ink looks garbled on " +
    "your device; iOS WebKit has had trouble with it.",
  paperWidth: "The paper's width in pixels, before it is scaled to fit the screen.",
  notebookFolder:
    "Where the New notebook dialog puts new notebooks and pages. Leave empty to use the " +
    "folder of the note that is open.",
  inkColor: "The pen color an ink note opens with.",
  tool: "The tool that is picked when you open an ink note.",
  strokeSize: "How thick the pen writes when you open an ink note.",
  highlighter: "How opaque highlighter strokes are.",
  customColors:
    "More swatches for the palette: hex colors separated by commas, such as #ff8800, #00ccaa.",
  recognition:
    "What the “Recognize handwriting” command and automatic recognition use. Manual = you " +
    "type the transcription; Cloud AI sends an image of each page to the AI service below. " +
    "The AI menu's Transcribe entries always use AI.",
  autoRecognize:
    "Transcribe the page you are writing on in the background about 30 seconds after you " +
    "stop, and only when it actually changed. Requires the one-time consent (run a " +
    "transcription by hand once first).",
  aiService:
    "Transcribes pages and answers your questions about them, with your own API key. " +
    "Nothing is sent until you start an AI action, and the first one asks first.",
  endpoint:
    "The base URL of an OpenAI-compatible server, with /v1 if the server uses it. Ollama, " +
    "LM Studio, llama.cpp, vLLM and LocalAI all work; SELF_HOSTING.md in the plugin's " +
    "repository walks through the setup.",
  openRouter:
    "Get a key for your OpenRouter account from the browser, without copying and pasting " +
    "it. You approve it on openrouter.ai, and nothing is sent before you do.",
  imageVendor:
    "Who makes pictures for “Generate image”. Claude and self-hosted endpoints cannot, so " +
    "with those pick OpenAI, Google or OpenRouter here and add that service's key.",
  debugHud:
    "Print the raw pen and touch events over the page: their order, coalesced samples, gaps " +
    "in time and stroke counts. Turn it on when reporting strokes that go missing or break.",
};

function modelDesc(vendor: LlmVendor): string {
  return (
    `For transcription and questions. Leave empty for the default (${DEFAULT_MODELS[vendor]}). ` +
    "Any model that reads images will do; a cheaper one, such as claude-haiku-4-5, saves " +
    "money at some cost in accuracy."
  );
}

function imageModelDesc(vendor: LlmVendor): string {
  return canGenerateImages(vendor)
    ? `Leave empty for the default (${DEFAULT_IMAGE_MODELS[vendor]}).`
    : "";
}

const IMAGE_VENDOR_LABELS: Record<ImageVendorChoice, string> = {
  same: "Same as the AI service",
  openai: "OpenAI (GPT Image)",
  google: "Google (Gemini)",
  openrouter: "OpenRouter",
};

const ISSUES_URL = "https://github.com/Joost-8/FineNotes/issues";

// --- Row builders ------------------------------------------------------------

// Each row is named, described and given extra search words in one call;
// Obsidian draws the control and reads and writes it through the tab.

function controlRow(
  name: string,
  desc: string,
  control: SettingControl<SettingKey>,
  aliases?: string[],
): SettingDefinition {
  return { name, desc, aliases, control };
}

function toggle(
  key: SettingKey,
  name: string,
  desc: string,
  aliases?: string[],
): SettingDefinition {
  return controlRow(name, desc, { type: "toggle", key }, aliases);
}

function dropdown(
  key: SettingKey,
  name: string,
  desc: string,
  options: Record<string, string>,
  aliases?: string[],
): SettingDefinition {
  return controlRow(name, desc, { type: "dropdown", key, options }, aliases);
}

/** A row whose control the tab draws itself. */
function drawnRow(
  name: string,
  desc: string,
  draw: (setting: Setting) => void,
  aliases?: string[],
  visible: Visible = true,
): SettingDefinition {
  return { name, desc, aliases, visible, render: draw };
}

function group(heading: string, items: SettingDefinition[]): SettingDefinitionItem {
  return { type: "group", heading, items };
}

/**
 * A row with no name or control, filled edge to edge by `draw` (a callout or
 * the footer). It is kept out of search, since it is not a setting.
 */
function block(draw: (el: HTMLElement) => void, visible: Visible = true): SettingDefinition {
  return {
    name: "",
    searchable: false,
    visible,
    render: (setting) => {
      setting.settingEl.empty();
      setting.settingEl.addClass("goodobsidian-plain-row");
      draw(setting.settingEl);
    },
  };
}

function callout({ title, detail }: Callout, visible: Visible): SettingDefinition {
  return block((el) => {
    const box = el.createDiv({ cls: "goodobsidian-callout" });
    box.createDiv({ cls: "goodobsidian-callout-title", text: title });
    if (detail) box.createDiv({ text: detail });
  }, visible);
}

// --- The tab -----------------------------------------------------------------

export class GoodObsidianSettingTab extends PluginSettingTab {
  /**
   * The Paper width field holds text that is not a valid width. Only the
   * field's state: the stored width stays the last valid one.
   */
  private paperWidthRejected = false;

  constructor(
    app: App,
    private readonly plugin: GoodObsidianPlugin,
  ) {
    super(app, plugin);
  }

  /** Rebuild the rows, e.g. after a key was added or OpenRouter connected. */
  refresh(): void {
    this.update();
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [...this.writingRows(), ...this.recognitionRows(), this.aiGroup(), this.supportGroup()];
  }

  override getControlValue(key: string): unknown {
    return shownValue(this.plugin.settings, key);
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "debugHud") {
      // The plugin saves this one itself, and shows or hides the overlay in
      // every open note.
      await this.plugin.setDebugHud(value as boolean);
      return;
    }
    if (key === "llmVendor") {
      // An approval still pending in the browser would otherwise land on the
      // vendor the user just left.
      this.plugin.cancelOpenRouterConnect();
    }
    storeShownValue(this.plugin.settings, key, value);
    await this.plugin.saveSettings();
    if (changesTabLayout(key)) this.update();
  }

  // --- Sections --------------------------------------------------------------

  /** Pen, paper and the defaults an ink note opens with. */
  private writingRows(): SettingDefinition[] {
    const widths = Object.fromEntries(SIZES.map((size) => [String(size), String(size)]));
    return [
      callout(CALLOUTS.scribble, Platform.isIosApp && Platform.isTablet),
      toggle("pressureEnabled", "Pressure sensitivity", DESC.pressure, ["stylus", "Apple Pencil"]),
      toggle("drawAndHold", "Draw and hold to make shapes", DESC.drawAndHold, [
        "shape recognition",
        "straighten",
        "snap",
      ]),
      toggle("desynchronizedCanvas", "Desynchronized canvas", DESC.desynchronized, [
        "latency",
        "glitch",
        "artifacts",
      ]),
      drawnRow("Paper width", DESC.paperWidth, (s) => this.drawPaperWidth(s), [
        "canvas size",
        "page width",
      ]),
      callout(CALLOUTS.paperWidth, () => this.paperWidthRejected),
      drawnRow(
        "Default folder for new notebooks",
        DESC.notebookFolder,
        (s) => this.drawNotebookFolder(s),
        ["folder", "location", "new notebook", "new page"],
      ),
      controlRow("Default ink color", DESC.inkColor, { type: "color", key: "defaultColor" }, [
        "pen color",
      ]),
      dropdown("defaultTool", "Default tool", DESC.tool, TOOL_NAMES),
      dropdown("defaultSize", "Default stroke size", DESC.strokeSize, widths, [
        "pen size",
        "line width",
      ]),
      controlRow(
        "Highlighter opacity",
        DESC.highlighter,
        // In percent; data.json keeps 0–1 (settings-data.ts converts).
        { type: "slider", key: "highlighterAlpha", min: 10, max: 100, step: 5 },
        ["transparency", "alpha"],
      ),
      controlRow(
        "Custom colors",
        DESC.customColors,
        { type: "text", key: "customColors", placeholder: "#ff8800, #00ccaa" },
        ["palette"],
      ),
    ];
  }

  private recognitionRows(): SettingDefinition[] {
    const providers: Record<string, string> = {};
    for (const id of this.plugin.providers.keys()) providers[id] = providerLabel(id);
    const { settings } = this.plugin;
    return [
      dropdown("recognitionProviderId", "Handwriting recognition", DESC.recognition, providers, [
        "OCR",
        "handwriting to text",
      ]),
      {
        ...toggle("autoRecognize", "Recognize automatically", DESC.autoRecognize, [
          "auto recognition",
        ]),
        visible: () => settings.recognitionProviderId === LLM_PROVIDER_ID,
      },
    ];
  }

  /**
   * "AI with your own key". The vendors are read once per build of the rows:
   * changing one rebuilds them (`changesTabLayout`). The endpoint URL is
   * read on every visibility check, as it changes while being typed.
   */
  private aiGroup(): SettingDefinitionItem {
    const { settings } = this.plugin;
    const vendor = settings.llmVendor;
    const custom = VENDORS[vendor].userEndpoint;
    const imageVendor = resolveImageVendor(settings.imageVendor, vendor);
    const makesImages = canGenerateImages(imageVendor);
    const usingEndpoint = () => VENDORS[settings.llmVendor].userEndpoint;
    const endpointShows = (warning: ReturnType<typeof endpointWarning>) => () =>
      usingEndpoint() && endpointWarning(settings.llmBaseUrl) === warning;
    const imageModel = makesImages ? DEFAULT_IMAGE_MODELS[imageVendor] : "";

    return group("AI with your own key", [
      dropdown("llmVendor", "AI service", DESC.aiService, VENDOR_LABELS, [
        "Anthropic",
        "Claude",
        "OpenAI",
        "GPT",
        "Gemini",
        "OpenRouter",
        "Cloud AI",
      ]),
      drawnRow(
        "Endpoint URL",
        DESC.endpoint,
        (s) => this.drawEndpointUrl(s),
        ["self-hosted", "local server"],
        usingEndpoint,
      ),
      callout(CALLOUTS.incompleteUrl, endpointShows("incomplete")),
      callout(CALLOUTS.plainHttp, endpointShows("plain-http")),
      drawnRow(
        "Connect OpenRouter",
        DESC.openRouter,
        (s) => this.drawOpenRouterConnect(s),
        undefined,
        () => VENDORS[settings.llmVendor].oauthConnect,
      ),
      controlRow("AI model", modelDesc(vendor), {
        type: "text",
        key: "llmModel",
        placeholder: DEFAULT_MODELS[vendor],
      }),
      drawnRow(
        custom ? "Endpoint API key" : `${VENDORS[vendor].label} API key`,
        this.keyDesc(vendor, "text"),
        (s) => this.renderKeyRow(s, vendor),
        ["token", "secret", "API key"],
      ),
      callout(CALLOUTS.noKeychain, !this.plugin.keys.secure),
      dropdown("imageVendor", "Image generation", DESC.imageVendor, IMAGE_VENDOR_LABELS, [
        "generate image",
        "picture",
        "DALL-E",
        "GPT Image",
        "Nano Banana",
      ]),
      callout({ title: `${imageUnsupportedReason(imageVendor)}.` }, !makesImages),
      {
        ...controlRow("Image model", imageModelDesc(imageVendor), {
          type: "text",
          key: "imageModel",
          placeholder: imageModel,
        }),
        visible: makesImages,
      },
      drawnRow(
        `${VENDORS[imageVendor].label} API key for images`,
        this.keyDesc(imageVendor, "image"),
        (s) => this.renderKeyRow(s, imageVendor),
        ["image key"],
        makesImages && imageVendor !== vendor,
      ),
    ]);
  }

  private supportGroup(): SettingDefinitionItem {
    return group("Support and diagnostics", [
      toggle("debugHud", "Input debug overlay", DESC.debugHud, [
        "diagnostics",
        "HUD",
        "troubleshooting",
      ]),
      block((el) => {
        const footer = el.createDiv({ cls: "goodobsidian-support" });
        footer.appendText("Found a bug, or have a question? ");
        footer.createEl("a", { text: "Open an issue on GitHub", href: ISSUES_URL });
      }),
    ]);
  }

  // --- Rows the tab draws itself ---------------------------------------------

  /**
   * A text field rather than Obsidian's number control: that control clamps
   * what is typed to its range without a word, and the user should see why
   * 5000 did not take.
   */
  private drawPaperWidth(setting: Setting): void {
    this.paperWidthRejected = false;
    setting.addText((text) => {
      text.setValue(String(this.plugin.settings.paperWidth));
      text.onChange(async (typed) => {
        const width = paperWidthFrom(typed);
        this.paperWidthRejected = width === null;
        this.refreshDomState();
        if (width === null) return;
        this.plugin.settings.paperWidth = width;
        await this.plugin.saveSettings();
      });
    });
  }

  private drawEndpointUrl(setting: Setting): void {
    // Full width, so a long URL stays readable on a phone.
    setting.setClass("goodobsidian-wide-text");
    setting.addText((text) => {
      text.setPlaceholder("http://localhost:11434/v1").setValue(this.plugin.settings.llmBaseUrl);
      text.onChange(async (typed) => {
        this.plugin.settings.llmBaseUrl = typed.trim();
        this.refreshDomState(); // the two URL callouts follow the field
        await this.plugin.saveSettings();
      });
    });
  }

  private drawOpenRouterConnect(setting: Setting): void {
    const connected = this.plugin.apiKeyFor("openrouter") !== "";
    setting.addButton((button) => {
      button.setButtonText(connected ? "Reconnect" : "Connect OpenRouter").setCta();
      button.onClick(() => void this.plugin.startOpenRouterConnect());
    });
  }

  /** "Default folder for new notebooks" (0.5): a text field with folder type-ahead. */
  private drawNotebookFolder(setting: Setting): void {
    setting.addText((text) => {
      text
        .setPlaceholder("Folder of the open note")
        .setValue(this.plugin.settings.newNotebookFolder)
        .onChange(async (value) => {
          this.plugin.settings.newNotebookFolder = normalizeFolder(value);
          await this.plugin.saveSettings();
        });
      new FolderInputSuggest(this.app, text.inputEl, (path) => {
        this.plugin.settings.newNotebookFolder = path;
        void this.plugin.saveSettings();
      });
    });
  }

  /** What a key row says about where the key lives and where it goes. */
  private keyDesc(slot: LlmVendor, use: "text" | "image"): string {
    if (VENDORS[slot].userEndpoint) {
      return (
        "Optional — most self-hosted servers don't need one. Kept apart from your cloud keys " +
        "and sent only to your endpoint."
      );
    }
    const where = this.plugin.keys.secure
      ? "Kept in Obsidian's keychain (Settings → Keychain), outside this vault's files"
      : "Stored in this vault's plugin data";
    const label = VENDORS[slot].label;
    return use === "image"
      ? `Your own ${label} key, used only to generate images. ${where}; sent only to ${label}.`
      : `Your own key. ${where}; sent only to ${label}, and only when you start an AI action.`;
  }

  /**
   * A key's status with Add / Replace / Remove. The key itself is never put
   * back on screen — not even masked in a field, where it could be copied out.
   */
  private renderKeyRow(setting: Setting, slot: LlmVendor): void {
    const set = this.plugin.apiKeyFor(slot) !== "";
    const optional = VENDORS[slot].userEndpoint;
    setting.controlEl.createSpan({
      cls: `goodobsidian-key-status${set ? " is-set" : ""}`,
      text: set ? "Set" : optional ? "Not set (optional)" : "Not set",
    });
    setting.addButton((button) => {
      button.setButtonText(set ? "Replace" : "Add key").onClick(() => this.promptForKey(slot));
      if (!set && !optional) button.setCta();
    });
    if (set) {
      // Not styled as destructive: `setWarning` is deprecated, and the
      // confirmation says what removing does.
      setting.addButton((button) => {
        button.setButtonText("Remove").onClick(() => void this.removeKey(slot));
      });
    }
  }

  private promptForKey(slot: LlmVendor): void {
    const label = VENDORS[slot].userEndpoint ? "Endpoint" : VENDORS[slot].label;
    new ApiKeyModal(this.app, {
      title: `${label} API key`,
      placeholder: VENDORS[slot].userEndpoint ? "(usually empty)" : "sk-…",
      where: this.plugin.keys.secure
        ? "Saved in Obsidian's keychain on this device, not in the vault's files."
        : "Saved in this vault's plugin data.",
      onSave: (key) => {
        // Entering a key by hand invalidates any in-flight OpenRouter connect,
        // so a stale browser approval cannot overwrite it later.
        if (!VENDORS[slot].userEndpoint) this.plugin.cancelOpenRouterConnect();
        this.plugin.storeApiKey(slot, key);
        this.refresh();
      },
    }).open();
  }

  private async removeKey(slot: LlmVendor): Promise<void> {
    const label = VENDORS[slot].userEndpoint ? "endpoint" : VENDORS[slot].label;
    const sure = await ConfirmModal.confirm(this.app, {
      title: `Remove the ${label} key?`,
      message: "AI features that need it stop working on this device until you add a key again.",
      cta: "Remove",
    });
    if (!sure) return;
    this.plugin.removeApiKey(slot);
    this.refresh();
  }
}
