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
  learnedRecord,
  learnedSummary,
  practiceFiles,
  progressLabel,
  resetLearnedModel,
  writePracticePage,
} from "./view/handwriting-learning";
import {
  type App,
  type ExtraButtonComponent,
  Platform,
  PluginSettingTab,
  type Setting,
  type SettingControl,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
import { SIZES } from "./constants";
import { DEFAULT_STICKER_FOLDER } from "./model/stickers";
import type GoodObsidianPlugin from "./main";
import { normalizeFolder } from "./model/new-notebook";
import {
  type ImageVendorChoice,
  aiKeyFolded,
  resolveImageVendor,
} from "./recognition/ai-menu-model";
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
  type PageAppearance,
  type SettingsSection,
  changesTabLayout,
  endpointWarning,
  paperWidthFrom,
  parseColorList,
  sectionOpen,
  shownValue,
  storeShownValue,
  withSection,
} from "./settings-data";
import { SHORTCUT_GROUPS, shortcutText } from "./model/shortcuts";
import { renderShortcutList } from "./view/shortcut-list";
import { ApiKeyModal } from "./ui/api-key-modal";
import { ConfirmModal } from "./ui/confirm-modal";
import { formatSize, isBusy, stateText, totalBytes } from "./downloads/model-manifest";
import { GRAPE2_MODEL, GRAPE_MODEL } from "./recognition/hwr/grape-model";
import { SPEECH_LANGUAGES, speechAsset, speechModelsFor } from "./audio/speech-models";
import type { AssetStore } from "./downloads/model-store";
import { FolderInputSuggest } from "./view/folder-suggest";
import {
  MAX_SAVED_PENS,
  SAVED_PEN_TYPES,
  type SavedPen,
  type SavedPenType,
  addSavedPen,
  defaultSavedPens,
  editSavedPen,
  mmText,
  moveSavedPen,
  removeSavedPen,
  savedPenIndex,
  savedPenLabel,
  savedPenOf,
  savedPensOf,
  widthFromMm,
} from "./model/saved-pens";
import type { BarrelAction } from "./input/pen-modifiers";
import { type PenCursorStyle, penCursorStyleOf } from "./view/pen-cursor";

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
  pressure: {
    title: "Writing is less smooth with pressure on",
    detail:
      "A line whose width changes is drawn as short pieces of one width each: slower to " +
      "draw on a full page, and close up the pieces can show. Switch it off if writing " +
      "feels less fluid.",
  },
  noKeychain: {
    title: "API keys are stored in this vault's plugin data",
    detail:
      "This Obsidian version has no keychain. Obsidian 1.11.4 and newer keep keys outside the vault's files.",
  },
} satisfies Record<string, Callout>;

/** The page appearances, as the dropdown names them. */
const PAGE_APPEARANCES: Record<PageAppearance, string> = {
  light: "Light",
  dark: "Dark",
  system: "Match Obsidian's theme",
};

/** The pen types, as the saved pens' dropdowns name them. */
const PEN_TYPE_NAMES: Record<SavedPenType, string> = {
  fountain: "Fountain pen",
  ball: "Ball pen",
  brush: "Brush pen",
  calligraphy: "Calligraphy pen",
  highlighter: "Highlighter",
};

/** The cursors over the page, as "Cursor over the page" names them (FineNotes#27). */
const PEN_CURSOR_NAMES: Record<PenCursorStyle, string> = {
  ink: "Ink dot",
  crosshair: "Crosshair",
  arrow: "Arrow",
};

/** What the barrel button can do, as its dropdown names it. */
const BARREL_NAMES: Record<BarrelAction, string> = {
  erase: "Erase",
  lasso: "Lasso select",
  pan: "Move the page",
  none: "Nothing",
};

/**
 * The keyboard and stylus shortcuts as plain text, one `[keys, action]` pair
 * each, in the order the settings list them (FineNotes#25). `apple` names
 * the keys as Obsidian does on a Mac or an iPad (⌘ for Ctrl).
 */
export function shortcutList(apple: boolean): Array<[string, string]> {
  return SHORTCUT_GROUPS.flatMap((group) =>
    group.shortcuts.map((shortcut): [string, string] => [
      shortcutText(shortcut, apple),
      shortcut.action,
    ]),
  );
}

/** The tools an ink note can open with, as the dropdown names them. */
const TOOL_NAMES = { pen: "Pen", highlighter: "Highlighter", eraser: "Eraser", select: "Select" };

const DESC = {
  pressure:
    "Turn this on to tell the pens apart: the Fountain pen gets wider the harder you press, " +
    "the Brush pen swells and tapers much more, and the Ball pen stays even. Off, every pen " +
    "draws one even width, which is the smoothest to write with.",
  drawAndHold:
    "Draw a rough line, circle or polygon in one stroke and keep the pen still at the end: it snaps to a clean shape, which you can still resize and rotate before lifting.",
  desynchronized:
    "Asks the browser to draw ink with less delay. Switch it off if ink looks garbled on " +
    "your device; iOS WebKit has had trouble with it.",
  paperWidth: "The paper's width in pixels, before it is scaled to fit the screen.",
  pageAppearance:
    "Show pages dark for writing at night: the paper turns dark and ink light, keeping its " +
    "color. Only the view changes: ink is saved, exported and printed in its true color, " +
    "and pictures are left as they are. White ink stays the color of the paper, so it " +
    "disappears on dark pages as it does on white ones.",
  invertPdfPages:
    "Turn PDF pages dark with the rest. Switch it off for PDFs that are dark already, " +
    "such as slides with a dark background.",
  notebookFolder:
    "Where the New notebook dialog puts new notebooks and pages. Leave empty to use the " +
    "folder of the note that is open.",
  inkColor: "The pen color an ink note opens with.",
  tool: "The tool that is picked when you open an ink note.",
  strokeSize: "How thick the pen writes when you open an ink note.",
  highlighter: "How opaque highlighter strokes are.",
  customColors:
    "Your own colors, as hex separated by commas, such as #ff8800, #00ccaa. Each keeps a " +
    "spot in the pen's color row, after the default ink color (four at most), and appears " +
    "in the color picker.",
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
    "repository walks through the setup. For Ask to read pages, pick a vision model; for " +
    "it to use the notebook (search, add text boxes and pages, draw), the model and server " +
    "must support tool calling (llama.cpp: start it with --jinja).",
  openRouter:
    "Get a key for your OpenRouter account from the browser, without copying and pasting " +
    "it. You approve it on openrouter.ai, and nothing is sent before you do.",
  imageVendor:
    "Who makes pictures for “Generate image”. Claude and self-hosted endpoints cannot, so " +
    "with those pick OpenAI, Google or OpenRouter here and add that service's key.",
  savedPens:
    "Up to eight pens with their own type, colour and width, picked from the star in the " +
    "pen's toolbar or with the keys 1 to 8. Change one here; the arrows reorder them.",
  barrel:
    "What a pen tablet's side button does while you write with it. The eraser end of the " +
    "pen always erases.",
  straightHighlighter:
    "A highlighter stroke drawn along a line becomes a perfectly straight line when you lift " +
    "the pen. While you draw it follows your hand, and a curve stays as you drew it.",
  penCursor:
    "On a computer, the pointer over the page while a pen, the highlighter or the laser is " +
    "in hand: a dot in the ink colour as wide as the pen writes, a small crosshair, or the arrow.",
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

const REPO_URL = "https://github.com/Joost-8/FineNotes";

/** Where FineNotes' people are: the repository's Discussions and issues, and its accounts. */
export const COMMUNITY_LINKS = {
  discussions: `${REPO_URL}/discussions`,
  bugReport: `${REPO_URL}/issues/new/choose`,
  social: [
    { label: "X", url: "https://x.com/finenotes_" },
    { label: "Instagram", url: "https://www.instagram.com/finenotesobsidian/" },
    { label: "TikTok", url: "https://www.tiktok.com/@finenotesobsidian" },
    { label: "YouTube", url: "https://www.youtube.com/@FineNotesAtObsidian" },
  ],
} as const;

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

/** The class every folding section carries; `is-folded` beside it hides its rows. */
const SECTION_CLS = "goodobsidian-section";

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

/** Applies to every folder row below: what they do and do not reach. */
const FOLDER_NOTE =
  "For notebooks without a folder of their own; a notebook with its own folder keeps its files there. Leave empty for the default.";

/** Advanced: where notebooks without a folder of their own save each kind of file. */
const FOLDER_ROWS = [
  [
    "imagesFolder",
    "Folder for pictures and PDFs",
    "Inserted, pasted, scanned and generated pictures, and imported PDFs.",
    "Obsidian's attachment folder",
  ],
  [
    "recordingsFolder",
    "Folder for recordings",
    "Audio recorded with the microphone button.",
    "Obsidian's attachment folder",
  ],
  [
    "transcriptsFolder",
    "Folder for recording transcripts",
    "Notes made by transcribing a recording.",
    "Next to the recording",
  ],
  [
    "chatsFolder",
    "Folder for AI chats",
    "Ask AI conversations you save.",
    "AI chats, next to the notebook",
  ],
  [
    "exportsFolder",
    "Folder for PDF exports",
    "PDFs made with the share button.",
    "Next to the notebook",
  ],
] as const;

export class GoodObsidianSettingTab extends PluginSettingTab {
  /**
   * The Paper width field holds text that is not a valid width. Only the
   * field's state: the stored width stays the last valid one.
   */
  private paperWidthRejected = false;
  /** The AI group, opened by hand when no AI service is set up. */
  private aiOpen = false;
  /** Redraws "Save the pen in hand" for these saved pens, without rebuilding the tab. */
  private savePenRow: ((pens: readonly SavedPen[]) => void) | undefined;

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

  // --- Folding ---------------------------------------------------------------

  /**
   * A section under a header that folds it: tapping the header (or its
   * chevron) hides or shows the rows, and the tab remembers which are folded
   * (`foldedSettingsSections`). Folding is a class on the group, never the
   * rows' `visible`: Obsidian's search leaves out rows that are not visible,
   * and a folded row must still be found. Obsidian applies `cls` when it
   * first draws the group; after that the class on the group is the state.
   */
  private section(
    id: SettingsSection,
    heading: string,
    items: SettingDefinition[],
  ): SettingDefinitionItem {
    const open = sectionOpen(this.plugin.settings.foldedSettingsSections, id);
    return {
      type: "group",
      heading,
      items,
      cls: open ? SECTION_CLS : `${SECTION_CLS} is-folded`,
      extraButtons: [(button) => this.foldButton(button, id, heading)],
    };
  }

  /**
   * The chevron in a section's header, and the header made the control that
   * folds it. Obsidian puts the button in the header's control column, so
   * the header and the group are its ancestors.
   */
  private foldButton(button: ExtraButtonComponent, id: SettingsSection, heading: string): void {
    const chevron = button.extraSettingsEl;
    const header = chevron.closest<HTMLElement>(".setting-item-heading");
    const group = chevron.closest<HTMLElement>(".setting-group");
    if (!header || !group) return;
    button.setIcon("chevron-right");
    chevron.addClass("goodobsidian-fold-chevron");
    header.addClass("goodobsidian-fold-header");
    const sync = (): void => {
      const open = !group.hasClass("is-folded");
      chevron.setAttribute("role", "button");
      chevron.setAttribute("aria-expanded", String(open));
      chevron.setAttribute("aria-label", `${open ? "Fold" : "Unfold"} ${heading}`);
    };
    const toggle = (): void => {
      const open = group.hasClass("is-folded");
      group.toggleClass("is-folded", !open);
      sync();
      this.rememberFold(id, open);
    };
    sync();
    // The whole header is the target, chevron included: one click, one toggle.
    header.addEventListener("click", toggle);
    chevron.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
    this.unfoldOnFlash(group, () => {
      group.removeClass("is-folded");
      sync();
      this.rememberFold(id, true);
    });
  }

  /**
   * A search result opens its row by scrolling to it and flashing it
   * (`is-flashing`). A row in a folded section cannot be scrolled to, so the
   * flash unfolds the section, and the row is scrolled to again.
   */
  private unfoldOnFlash(container: HTMLElement, unfold: () => void): void {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((changes) => {
      if (!container.hasClass("is-folded")) return;
      for (const change of changes) {
        const target = change.target;
        if (!target.instanceOf(HTMLElement) || !target.hasClass("is-flashing")) continue;
        unfold();
        target.scrollIntoView({ block: "center" });
        return;
      }
    });
    observer.observe(container, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  /** Save a section opened or folded. */
  private rememberFold(id: SettingsSection, open: boolean): void {
    const settings = this.plugin.settings;
    settings.foldedSettingsSections = withSection(settings.foldedSettingsSections, id, open);
    void this.plugin.saveSettings();
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    // By theme: writing, pages, reading handwriting, AI, then the switches
    // few people need, and support.
    return [
      ...this.topRows(),
      this.writingGroup(),
      this.pensGroup(),
      this.pagesGroup(),
      this.handwritingGroup(),
      this.recordingsGroup(),
      this.modelsGroup(),
      this.aiGroup(),
      this.advancedGroup(),
      this.supportGroup(),
      this.communityGroup(),
    ];
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
    if (key === "penCursor") {
      // Saved by the plugin, which changes the cursor in every open notebook.
      await this.plugin.setPenCursor(penCursorStyleOf(value));
      return;
    }
    if (key === "pressureWidth") {
      // Saved by the plugin, which redraws every open notebook's ink.
      await this.plugin.setPressureWidth(value as boolean);
      this.update();
      return;
    }
    if (key === "pageAppearance" || key === "invertPdfPages") {
      // Saved by the plugin, which redraws every open notebook; the PDF row
      // shows only with dark pages.
      storeShownValue(this.plugin.settings, key, value);
      await this.plugin.applyPageAppearance();
      this.update();
      return;
    }
    if (key === "llmVendor") {
      // An approval still pending in the browser would otherwise land on the
      // vendor the user just left.
      this.plugin.cancelOpenRouterConnect();
    }
    storeShownValue(this.plugin.settings, key, value);
    await this.plugin.saveSettings();
    // A newly chosen speech model joins Models (registered) before the tab is rebuilt.
    if (key === "speechModel") this.plugin.speech.store();
    if (changesTabLayout(key)) this.update();
    // Another Grape: the reader loads it on its next page (and Models lists it).
    if (key === "grapeModel") {
      this.plugin.handwriting.dispose();
      this.update();
    }
    // Turned on or switched: Grape is needed now, so offer it if it is not here.
    if (
      ((key === "handwritingOnDevice" || key === "checkHandwrittenWords") && value === true) ||
      (key === "grapeModel" && this.plugin.settings.handwritingOnDevice !== false)
    ) {
      await this.plugin.grape.model.check();
      this.plugin.grape.offer("ask");
    }
  }

  // --- Sections --------------------------------------------------------------

  /** The callout above every section: the iPad's Scribble, which loses strokes. */
  private topRows(): SettingDefinition[] {
    return [callout(CALLOUTS.scribble, Platform.isIosApp && Platform.isTablet)];
  }

  /** How the pen, the tools and the gestures behave, and what a new note starts with. */
  private writingGroup(): SettingDefinitionItem {
    const widths = Object.fromEntries(SIZES.map((size) => [String(size), String(size)]));
    return this.section("writing", "Writing and tools", [
      toggle("drawAndHold", "Draw and hold to make shapes", DESC.drawAndHold, [
        "shape recognition",
        "straighten",
        "snap",
      ]),
      toggle(
        "returnToPenOnReselect",
        "Select active tool again to return to pen",
        "Select the active eraser, lasso, text or shape tool again to return to your previous pen or highlighter.",
        ["tool", "eraser", "lasso", "text", "shape"],
      ),
      toggle(
        "returnToPenAfterUse",
        "Return to pen after one use",
        "Return to your previous pen or highlighter after an eraser stroke, shape or finished text editing (unless Text is pinned). Lasso returns when you click outside its selection, or delete or cut it.",
        ["tool", "eraser", "lasso", "text", "shape"],
      ),
      toggle(
        "textDragSize",
        "Drag to size text boxes",
        "With the Text tool, drag on the page to draw a new text box's size. Off, every new box fits its text as you type. A tap makes a box either way.",
        ["text", "text box", "size", "drag"],
      ),
      toggle(
        "fingerTapUndo",
        "Double-tap with fingers to undo and redo",
        "Double-tap the page with two fingers to undo, or with three fingers to redo.",
        ["undo", "redo", "gesture", "fingers", "tap"],
      ),
      dropdown("defaultTool", "Default tool", DESC.tool, TOOL_NAMES),
      dropdown("defaultSize", "Default stroke size", DESC.strokeSize, widths, [
        "pen size",
        "line width",
      ]),
      controlRow("Default ink color", DESC.inkColor, { type: "color", key: "defaultColor" }, [
        "pen color",
      ]),
      drawnRow("Custom colors", DESC.customColors, (s) => this.drawCustomColors(s), ["palette"]),
      controlRow(
        "Highlighter opacity",
        DESC.highlighter,
        // In percent; data.json keeps 0–1 (settings-data.ts converts).
        { type: "slider", key: "highlighterAlpha", min: 10, max: 100, step: 5 },
        ["transparency", "alpha"],
      ),
    ]);
  }

  /**
   * Saved pens, the stylus buttons, the cursor, and every shortcut
   * (FineNotes#24, #25).
   */
  private pensGroup(): SettingDefinitionItem {
    const pens = savedPensOf(this.plugin.settings.savedPens);
    const rows: SettingDefinition[] = pens.map((pen, index) =>
      drawnRow(
        `Saved pen ${index + 1}`,
        savedPenLabel(pen),
        (s) => this.drawSavedPen(s, pens, index),
        ["favorite pen", "preset", "number key"],
      ),
    );
    return this.section("pens", "Pens and shortcuts", [
      drawnRow("Saved pens", DESC.savedPens, (s) => this.drawRestorePens(s), [
        "favorite pens",
        "presets",
      ]),
      ...rows,
      drawnRow("Save the pen in hand", this.lastPenDesc(pens), (s) => this.drawSavePen(s, pens), [
        "favorite pen",
        "preset",
      ]),
      toggle("straightHighlighter", "Straighten highlighter strokes", DESC.straightHighlighter, [
        "highlighter",
        "straight",
        "line",
      ]),
      dropdown("barrelButton", "Stylus side button", DESC.barrel, BARREL_NAMES, [
        "barrel button",
        "pen tablet",
        "wacom",
        "stylus",
      ]),
      {
        ...dropdown("penCursor", "Cursor over the page", DESC.penCursor, PEN_CURSOR_NAMES, [
          "cursor",
          "pointer",
          "crosshair",
        ]),
        visible: !Platform.isMobile,
      },
      drawnRow(
        "Keyboard and stylus shortcuts",
        "None of them act while you type in a text box.",
        (s) => this.drawShortcuts(s),
        ["hotkeys", "keys", "modifier"],
      ),
    ]);
  }

  /** What "Save the pen in hand" would add, or why it cannot. */
  private lastPenDesc(pens: readonly SavedPen[]): string {
    const last = savedPenOf(this.plugin.settings.lastPen);
    if (!last) return "Write with a pen first; the one you last wrote with is saved.";
    if (savedPenIndex(pens, last) >= 0) return `${savedPenLabel(last)}: saved already.`;
    if (pens.length >= MAX_SAVED_PENS) {
      return `${savedPenLabel(last)}: all ${MAX_SAVED_PENS} places are taken, so delete one first.`;
    }
    return `Adds the pen you last wrote with: ${savedPenLabel(last)}, ${last.color}.`;
  }

  private savePens(pens: readonly SavedPen[]): void {
    this.plugin.saveSavedPens(pens);
    this.update();
  }

  /** A saved pen's row: its type, colour and width, then up, down and delete. */
  private drawSavedPen(setting: Setting, pens: readonly SavedPen[], index: number): void {
    const pen = pens[index];
    setting.setClass("goodobsidian-saved-pen-setting");
    const swatch = setting.nameEl.createSpan({ cls: "goodobsidian-saved-pen-swatch" });
    swatch.setCssStyles({ backgroundColor: pen.color });
    // A colour or a width is saved as it changes, without rebuilding the tab
    // under the picker or the field being typed in; this row's label and the
    // "Save the pen in hand" row (the edit may make it match) follow.
    const edit = (patch: Partial<SavedPen>): SavedPen => {
      const edited = editSavedPen(savedPensOf(this.plugin.settings.savedPens), index, patch);
      this.plugin.saveSavedPens(edited);
      setting.setDesc(savedPenLabel(edited[index]));
      this.savePenRow?.(edited);
      return edited[index];
    };
    setting.addDropdown((dropdown) => {
      for (const type of SAVED_PEN_TYPES) dropdown.addOption(type, PEN_TYPE_NAMES[type]);
      dropdown.setValue(pen.type).onChange((type) => {
        edit({ type: type as SavedPenType });
        this.update();
      });
    });
    setting.addColorPicker((picker) => {
      picker.setValue(pen.color).onChange((color) => {
        swatch.setCssStyles({ backgroundColor: edit({ color }).color });
      });
    });
    setting.addText((text) => {
      text.inputEl.addClass("goodobsidian-saved-pen-width");
      text.inputEl.setAttribute("inputmode", "decimal");
      text.inputEl.setAttribute("aria-label", "Width in millimetres");
      text.setValue(mmText(pen.size));
      text.onChange((typed) => {
        const size = widthFromMm(typed);
        text.inputEl.toggleClass("is-invalid", size === null);
        if (size !== null) edit({ size });
      });
    });
    const move = (step: number): void =>
      this.savePens(moveSavedPen(savedPensOf(this.plugin.settings.savedPens), index, step));
    setting.addExtraButton((button) => {
      button
        .setIcon("arrow-up")
        .setTooltip("Move up")
        .onClick(() => move(-1));
      button.setDisabled(index === 0);
    });
    setting.addExtraButton((button) => {
      button
        .setIcon("arrow-down")
        .setTooltip("Move down")
        .onClick(() => move(1));
      button.setDisabled(index === pens.length - 1);
    });
    setting.addExtraButton((button) => {
      button
        .setIcon("trash-2")
        .setTooltip("Delete")
        .onClick(() =>
          this.savePens(removeSavedPen(savedPensOf(this.plugin.settings.savedPens), index)),
        );
    });
  }

  private drawSavePen(setting: Setting, pens: readonly SavedPen[]): void {
    const last = savedPenOf(this.plugin.settings.lastPen);
    setting.addButton((button) => {
      button.setButtonText("Save pen");
      button.onClick(() => {
        if (last) this.savePens(addSavedPen(savedPensOf(this.plugin.settings.savedPens), last));
      });
      const show = (now: readonly SavedPen[]): void => {
        const can = last !== null && savedPenIndex(now, last) < 0 && now.length < MAX_SAVED_PENS;
        button.setDisabled(!can);
        setting.setDesc(this.lastPenDesc(now));
      };
      show(pens);
      this.savePenRow = show;
    });
  }

  private drawRestorePens(setting: Setting): void {
    setting.addButton((button) => {
      button.setButtonText("Restore defaults");
      button.onClick(() => this.savePens(defaultSavedPens()));
    });
  }

  /**
   * The shortcuts, under their row and the full width of it, in groups, with
   * each key a key cap as Obsidian's Hotkeys tab draws them. Folded at
   * first: the row (or its chevron) unfolds it, and the tab remembers.
   */
  private drawShortcuts(setting: Setting): void {
    const apple = Platform.isMacOS || Platform.isIosApp;
    const row = setting.settingEl;
    row.addClass("goodobsidian-shortcuts-row");
    const list = renderShortcutList(row, apple);
    const folded = (): boolean => row.hasClass("is-folded");
    row.toggleClass(
      "is-folded",
      !sectionOpen(this.plugin.settings.foldedSettingsSections, "shortcuts"),
    );
    setting.addExtraButton((button) => {
      button.setIcon("chevron-right");
      const chevron = button.extraSettingsEl;
      chevron.addClass("goodobsidian-fold-chevron");
      const sync = (): void => {
        chevron.setAttribute("role", "button");
        chevron.setAttribute("aria-expanded", String(!folded()));
        chevron.setAttribute("aria-label", folded() ? "Show the shortcuts" : "Hide the shortcuts");
      };
      const toggle = (): void => {
        const open = folded();
        row.toggleClass("is-folded", !open);
        sync();
        this.rememberFold("shortcuts", open);
      };
      sync();
      row.addEventListener("click", (event) => {
        // A tap on the list itself is reading, not folding.
        if (list.contains(event.target as Node | null)) return;
        toggle();
      });
      chevron.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      });
    });
  }

  /** The paper, and where new notebooks go and how they are made. */
  private pagesGroup(): SettingDefinitionItem {
    const settings = this.plugin.settings;
    return this.section("pages", "Pages and notebooks", [
      dropdown("pageAppearance", "Page appearance", DESC.pageAppearance, PAGE_APPEARANCES, [
        "dark mode",
        "night mode",
        "invert",
        "theme",
      ]),
      {
        ...toggle("invertPdfPages", "Dark PDF pages", DESC.invertPdfPages, [
          "dark mode",
          "invert",
          "slides",
        ]),
        visible: () => settings.pageAppearance === "dark" || settings.pageAppearance === "system",
      },
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
      toggle(
        "notebookOwnFolder",
        "Give new notebooks their own folder",
        "A folder named after the notebook, holding it and the folders its pictures, recordings, transcripts, AI chats and exports go in. Off: just the notebook file. Notebooks you already have stay as they are.",
        ["folder", "own folder", "new notebook", "attachments"],
      ),
      controlRow(
        "Stickers folder",
        "Where your own stickers live, one folder per collection. Stickers you save from a selection go into “My stickers” there.",
        { type: "text", key: "stickerFolder", placeholder: DEFAULT_STICKER_FOLDER },
        ["sticker", "collection", "folder"],
      ),
      controlRow(
        "Templates folder",
        "Where Save as template puts .finetemplate files, and New notebook from template looks first.",
        { type: "text", key: "templateFolder", placeholder: "FineNotes templates" },
        ["template", "folder", "share"],
      ),
      controlRow(
        "Template gallery",
        "Where Browse template gallery looks. Empty: FineNotes' own gallery on GitHub. Or the address of another gallery's index (a JSON file listing templates).",
        { type: "text", key: "templateGalleryUrl", placeholder: "FineNotes' own gallery" },
        ["template", "gallery", "community", "share"],
      ),
      toggle(
        "showNewNotebookInContextMenu",
        "Show New notebook in right-click menu",
        "Add New notebook to the file explorer menu. New notebooks start in the selected folder.",
        ["context menu", "file explorer", "new notebook"],
      ),
      toggle(
        "showNewNotebookInExplorer",
        "Show New notebook in file explorer bar",
        "Add a New notebook button beside New note and New folder in the file explorer.",
        ["toolbar", "file explorer", "new notebook"],
      ),
      toggle(
        "folderNotebooks",
        "Show notebook folders as notebooks",
        "In the file explorer, a notebook with its own folder shows as that folder: tap its name to open the notebook, or its arrow for its pictures, recordings and other files. Renaming one renames the other.",
        ["file explorer", "folder", "folder note", "icons"],
      ),
    ]);
  }

  /** Rendering and input switches most people never need. */
  private advancedGroup(): SettingDefinitionItem {
    return this.section("advanced", "Advanced", [
      toggle("desynchronizedCanvas", "Desynchronized canvas", DESC.desynchronized, [
        "latency",
        "glitch",
        "artifacts",
      ]),
      toggle("pressureWidth", "Pressure-sensitive pens (advanced)", DESC.pressure, [
        "pressure sensitivity",
        "stylus",
        "Apple Pencil",
        "fountain pen",
        "brush pen",
      ]),
      callout(CALLOUTS.pressure, () => this.plugin.settings.pressureWidth),
      controlRow(
        "Handwriting model file",
        "Leave blank to use Grape (handwriting recognizer model). Or give the vault path of " +
          "another model file, such as one tuned to your handwriting. It is read on this " +
          "device only.",
        { type: "text", key: "hwrModelPath", placeholder: "FineNotes/finenotes-hwr.bin" },
        ["handwriting", "recognition", "model"],
      ),
      ...FOLDER_ROWS.map(([key, name, desc, placeholder]) =>
        controlRow(name, `${desc} ${FOLDER_NOTE}`, { type: "text", key, placeholder }, [
          "folder",
          "attachments",
          "where files are saved",
        ]),
      ),
    ]);
  }

  /** Reading handwriting on this device, and learning the user's. */
  private handwritingGroup(): SettingDefinitionItem {
    const { settings } = this.plugin;
    return this.section("handwriting", "Handwriting", [
      toggle(
        "handwritingOnDevice",
        "Read handwriting on this device (beta)",
        "Reads your handwriting with Grape (handwriting recognizer model), downloaded " +
          "once, on this device: notebook search and Obsidian's search find it, and a " +
          "lassoed heading or word fills in its title or link. Nothing leaves the device. " +
          "In beta: it misreads some words, more so in small or hurried writing, so check " +
          "what it reads before relying on it.",
        ["handwriting", "recognition", "search", "offline"],
      ),
      {
        ...dropdown(
          "grapeModel",
          "Handwriting model",
          "Grape 1.0 is the default. Grape 2 is a preview: a larger model that reads small, " +
            "quick note writing better, takes about half as long again to read a page, and " +
            "needs more memory to learn your handwriting. Downloaded once when chosen. What " +
            "you learned with one Grape is used with that Grape only.",
          {
            grape: `Grape 1.0 (${formatSize(totalBytes(GRAPE_MODEL))})`,
            "grape-2": `Grape 2, preview (${formatSize(totalBytes(GRAPE2_MODEL))})`,
          },
          ["handwriting", "recognition", "model", "Grape 2", "preview"],
        ),
        visible: () => settings.handwritingOnDevice !== false,
      },
      {
        ...toggle(
          "checkHandwrittenWords",
          "Underline words it may have misread (test)",
          "After a page is read, words Grape is not sure of get a dotted underline. Tap one " +
            "with a finger to correct the reading, confirm it, or ignore the word; Learn my " +
            "handwriting learns from your answers. Uses the word list built into FineNotes, " +
            "plus your own words.txt in the plugin's handwriting folder.",
          ["handwriting", "spelling", "correct", "misread", "underline"],
        ),
        visible: () => settings.handwritingOnDevice !== false,
      },
      drawnRow(
        "Learn my handwriting",
        learnedSummary(learnedRecord(settings, this.plugin.grape.id)),
        (setting) => this.drawLearning(setting),
        ["handwriting", "practice", "fine-tune", "personal", "recognition"],
        () => settings.handwritingOnDevice !== false,
      ),
    ]);
  }

  /**
   * Transcribing recordings on this device: which speech model, and the
   * language spoken. The model itself is listed under Models once chosen.
   */
  private recordingsGroup(): SettingDefinitionItem {
    const mobile = Platform.isMobile;
    const models: Record<string, string> = {};
    for (const m of speechModelsFor(mobile)) {
      models[m.id] = `${m.label} (${formatSize(totalBytes(speechAsset(m.id)))})`;
    }
    const languages: Record<string, string> = {};
    for (const l of SPEECH_LANGUAGES) languages[l.code] = l.name;
    return this.section("recordings", "Recordings", [
      dropdown(
        "speechModel",
        "Speech model on this device",
        "Transcribe on this device uses this model, downloaded the first time. Tiny is " +
          "quickest; base is more accurate and the default." +
          (mobile
            ? " Small is offered on desktop only: it needs more memory than an iPad has to spare."
            : " Small is the most accurate and about three times slower than base.") +
          " For long lectures an AI key or your own server is faster.",
        models,
        ["audio", "speech", "whisper", "transcribe", "offline", "model"],
      ),
      dropdown(
        "speechLanguage",
        "Spoken language",
        "Detect works for most recordings; choosing the language helps with short ones.",
        languages,
        ["audio", "speech", "language", "transcribe"],
      ),
    ]);
  }

  /**
   * "AI with your own key". The vendors are read once per build of the rows:
   * changing one rebuilds them (`changesTabLayout`). The endpoint URL is
   * read on every visibility check, as it changes while being typed.
   */
  private aiGroup(): SettingDefinitionItem {
    const { settings } = this.plugin;
    const providers: Record<string, string> = {};
    for (const id of this.plugin.providers.keys()) providers[id] = providerLabel(id);
    // Without a key the group is one row, opened on request, so it does not
    // crowd the settings of anyone who reads handwriting on the device only.
    const shown = (): boolean => this.aiOpen || !aiKeyFolded(this.plugin.aiSetup());
    const fold = (item: SettingDefinition): SettingDefinition => {
      const own = item.visible;
      return {
        ...item,
        visible: () => shown() && (typeof own === "function" ? own() : own !== false),
      };
    };
    const vendor = settings.llmVendor;
    const custom = VENDORS[vendor].userEndpoint;
    const imageVendor = resolveImageVendor(settings.imageVendor, vendor);
    const makesImages = canGenerateImages(imageVendor);
    const usingEndpoint = () => VENDORS[settings.llmVendor].userEndpoint;
    const endpointShows = (warning: ReturnType<typeof endpointWarning>) => () =>
      usingEndpoint() && endpointWarning(settings.llmBaseUrl) === warning;
    const imageModel = makesImages ? DEFAULT_IMAGE_MODELS[imageVendor] : "";

    const rows: SettingDefinition[] = [
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
    return this.section("ai", "AI with your own key", [
      drawnRow(
        "Set up an AI service",
        "Transcribe pages, ask about your notes and make pictures with an AI service you " +
          "have a key for. Reading handwriting on this device needs none.",
        (setting) => this.drawAiFold(setting),
        ["API key", "AI", "transcribe"],
        () => aiKeyFolded(this.plugin.aiSetup()),
      ),
      ...rows.map(fold),
    ]);
  }

  private supportGroup(): SettingDefinitionItem {
    return this.section("support", "Support and diagnostics", [
      toggle("debugHud", "Input debug overlay", DESC.debugHud, [
        "diagnostics",
        "HUD",
        "troubleshooting",
      ]),
    ]);
  }

  /** Ideas, bugs and FineNotes' accounts: each a link that opens in the browser. */
  private communityGroup(): SettingDefinitionItem {
    const links = (setting: Setting, items: readonly { label: string; url: string }[]): void => {
      for (const { label, url } of items) {
        setting.addButton((b) => b.setButtonText(label).onClick(() => window.open(url)));
      }
    };
    return this.section("community", "Feedback and community", [
      drawnRow(
        "Ideas and questions",
        "Share an idea, ask how something works, or show what you made with FineNotes, in " +
          "the repository's Discussions.",
        (s) => links(s, [{ label: "Open Discussions", url: COMMUNITY_LINKS.discussions }]),
        ["feedback", "idea", "question", "suggestion", "community"],
      ),
      drawnRow(
        "Report a bug",
        "Opens a bug report on GitHub. It says which diagnostics help with which problem.",
        (s) => links(s, [{ label: "Report a bug", url: COMMUNITY_LINKS.bugReport }]),
        ["bug", "issue", "problem", "GitHub"],
      ),
      drawnRow(
        "Follow FineNotes",
        "News, tips and demos.",
        (s) => links(s, COMMUNITY_LINKS.social),
        ["social", "X", "Twitter", "Instagram", "TikTok", "YouTube"],
      ),
    ]);
  }

  // --- Rows the tab draws itself ---------------------------------------------

  /**
   * A text field rather than Obsidian's number control: that control clamps
   * what is typed to its range without a word, and the user should see why
   * 5000 did not take.
   */
  /**
   * Practice files, learning from them, and going back to the built-in
   * model. While a run is on, Learn now shows its progress, filling up as
   * a bar, and Stop ends it; closing the settings leaves it running.
   */
  /**
   * "Models": every model a feature downloads on first use
   * (view/model-downloads.ts), one row each, whatever feature registered it.
   */
  private modelsGroup(): SettingDefinitionItem {
    return this.section(
      "models",
      "Models",
      this.plugin.models
        .all()
        .map((store) =>
          drawnRow(
            store.asset.label,
            stateText(store.asset, store.state),
            (setting) => this.drawDownload(setting, store),
            ["model", "download", "offline", store.asset.id],
          ),
        ),
    );
  }

  /**
   * A downloaded model's row: its state and size, with Download, or
   * Re-download and Remove; the progress while it downloads.
   */
  private drawDownload(setting: Setting, store: AssetStore): void {
    const show = (): void => {
      const state = store.state;
      setting.setDesc(stateText(store.asset, state));
      setting.controlEl.empty();
      if (isBusy(state)) return;
      if (state.kind === "ready") {
        setting.addButton((b) =>
          b.setButtonText("Re-download").onClick(() => {
            this.plugin.modelReleased(store.asset.id);
            void store.redownload();
          }),
        );
        setting.addButton((b) =>
          b.setButtonText("Remove").onClick(() => {
            this.plugin.modelReleased(store.asset.id);
            void store.remove();
          }),
        );
        return;
      }
      if (state.kind === "unknown") return;
      setting.addButton((b) =>
        b
          .setButtonText(state.kind === "failed" ? "Try again" : "Download")
          .setCta()
          .onClick(() => void store.download()),
      );
    };
    const unsubscribe = store.subscribe(() => {
      // The tab was closed or redrawn: this row is gone.
      if (!setting.settingEl.isConnected) {
        unsubscribe();
        return;
      }
      show();
    });
    show();
    void store.check(true);
  }

  private drawLearning(setting: Setting): void {
    const host = this.plugin.learningHost();
    const learner = this.plugin.learner;
    const files = practiceFiles(host).length;
    setting.addButton((b) =>
      b
        .setButtonText(files > 0 ? "Write another practice set" : "Write practice page")
        .onClick(async () => {
          await writePracticePage(host);
          // The first practice file brings "Learn now"; the button's wording changes too.
          if (setting.settingEl.isConnected) this.update();
        }),
    );
    if (files > 0 || learner.progress) {
      setting.addButton((learn) => {
        learn.buttonEl.addClass("goodobsidian-learn-button");
        learn.setCta().onClick(() => void learner.start());
        const stop = setting.controlEl.createEl("button", {
          text: "Stop",
          cls: "goodobsidian-learn-stop",
        });
        const show = (): void => {
          const progress = learner.progress;
          learn.setDisabled(progress !== null);
          learn.setButtonText(progress ? progressLabel(progress, Date.now()) : "Learn now");
          learn.buttonEl.setCssProps({
            "--gob-learn-progress": progress
              ? `${Math.round((100 * progress.step) / progress.steps)}%`
              : "0%",
          });
          learn.buttonEl.toggleClass("is-learning", progress !== null);
          stop.toggleClass("is-hidden", progress === null);
        };
        stop.addEventListener("click", () => learner.stop());
        let running = learner.progress !== null;
        const unsubscribe = learner.subscribe(() => {
          // The tab was closed or redrawn: this row is gone.
          if (!learn.buttonEl.isConnected) {
            unsubscribe();
            return;
          }
          const now = learner.progress !== null;
          // A run ended: the summary and the buttons change with it.
          if (running && !now) {
            unsubscribe();
            this.update();
            return;
          }
          running = now;
          show();
        });
        show();
      });
    }
    if (learnedRecord(this.plugin.settings, this.plugin.grape.id)) {
      setting.addButton((b) =>
        b.setButtonText("Use Grape").onClick(async () => {
          await resetLearnedModel(host);
          this.update();
        }),
      );
    }
  }

  /** Show or Hide: the AI group's rows, when no AI service is set up. */
  private drawAiFold(setting: Setting): void {
    setting.addButton((b) => {
      b.setButtonText(this.aiOpen ? "Hide" : "Show");
      b.onClick(() => {
        this.aiOpen = !this.aiOpen;
        b.setButtonText(this.aiOpen ? "Hide" : "Show");
        this.refreshDomState();
      });
    });
  }

  /**
   * Only hex colours are kept (`parseColorList`): the field is marked while it
   * holds anything else, and shows what was kept once it is left.
   */
  private drawCustomColors(setting: Setting): void {
    setting.addText((text) => {
      text.inputEl.addClass("goodobsidian-color-list");
      text
        .setPlaceholder("#ff8800, #00ccaa")
        .setValue(shownValue(this.plugin.settings, "customColors") as string);
      text.onChange(async (typed) => {
        const kept = parseColorList(typed);
        const entries = typed.split(",").filter((part) => part.trim() !== "");
        text.inputEl.toggleClass("is-invalid", kept.length < entries.length);
        storeShownValue(this.plugin.settings, "customColors", typed);
        await this.plugin.saveSettings();
      });
      text.inputEl.addEventListener("blur", () => {
        text.setValue(shownValue(this.plugin.settings, "customColors") as string);
        text.inputEl.removeClass("is-invalid");
      });
    });
  }

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
