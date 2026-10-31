/**
 * The settings tab, built from Obsidian 1.13's setting definitions: Obsidian
 * draws the rows, searches them, and calls `getControlValue` /
 * `setControlValue` for the plain controls. The tab draws only what a plain
 * control cannot: callouts, the rows that set two switches at once, the
 * fields that check what is typed, the saved pens, the models, and the API
 * key rows.
 *
 * Compact by rule (CLAUDE.md, "show more by showing less"): every section
 * starts folded with its state beside its heading; a row says its name and
 * at most one short line; the longer explanation waits behind the ⓘ after
 * its name; rows few people need sit under the section's "More".
 *
 * What is stored, and how, lives in `settings-data.ts`.
 */

import {
  deleteLearnedModel,
  learnedFiles,
  learnedRecord,
  practiceSheets,
  previousKey,
  progressLabel,
  readCorrections,
  swapWithPrevious,
  symbolsToWrite,
  writePracticePage,
  writeSymbolPractice,
} from "./view/handwriting-learning";
import {
  MIN_PRACTICE_LINES,
  type PracticeSheet,
  deleteQuestion,
  RELEARN_AFTER,
  correctionsText,
  learnInfoText,
  learnSummary,
  learnedBadge,
  learnedResult,
  learnedStatus,
  nextSheetAction,
  sheetText,
  sheetUse,
  newCorrections,
  undoText,
} from "./recognition/hwr/learned-model";
import { PRACTICE_SETS, isSymbolSet } from "./recognition/practice";
import { PLUGIN_PAGE_URL } from "./model/update-check";
import {
  type App,
  type ExtraButtonComponent,
  Menu,
  Platform,
  PluginSettingTab,
  type Setting,
  type SettingControl,
  type SettingDefinition,
  type SettingDefinitionItem,
  setIcon,
} from "obsidian";
import { SIZES } from "./constants";
import { DEFAULT_STICKER_FOLDER, DEFAULT_TEMPLATE_FOLDER } from "./model/vault-folders";
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
  type AppearanceChoice,
  type GoodObsidianSettings,
  PAPER_WIDTH_RANGE,
  type PageAppearance,
  type SettingsSection,
  appearanceChoiceOf,
  changesTabLayout,
  endpointWarning,
  paperWidthFrom,
  parseColorList,
  sectionOpen,
  shownValue,
  storeAppearanceChoice,
  storeShownValue,
  withSection,
} from "./settings-data";
import { SHORTCUT_GROUPS, shortcutText } from "./model/shortcuts";
import {
  type ShortcutAction,
  type ShortcutRow,
  SHORTCUT_ACTIONS,
  inputCaps,
  inputsText,
} from "./model/shortcut-bindings";
import { type ShortcutRecorder, recordShortcut } from "./view/shortcut-recorder";
import { ApiKeyModal } from "./ui/api-key-modal";
import { ConfirmModal } from "./ui/confirm-modal";
import {
  type AssetState,
  formatSize,
  isBusy,
  stateText,
  totalBytes,
} from "./downloads/model-manifest";
import {
  SPEECH_LANGUAGES,
  effectiveSpeechModel,
  speechAsset,
  speechModelInfo,
  speechModelsFor,
} from "./audio/speech-models";
import type { AssetStore } from "./downloads/model-store";
import { FolderInputSuggest } from "./view/folder-suggest";
import { penGlyph, penSample } from "./view/pen-glyph-svg";
import {
  MAX_SAVED_PENS,
  type SavedPen,
  defaultSavedPens,
  defaultWidthText,
  newPenDraft,
  putSavedPen,
  removeSavedPen,
  sampleThickness,
  savedPenLabel,
  savedPensOf,
} from "./model/saved-pens";
import { pushRecentColor } from "./model/colors";
import { relativeLuminance } from "./model/cover";
import { SavedPenModal } from "./view/saved-pen-modal";
import type { BarrelAction } from "./input/pen-modifiers";
import type { StylusClickAction } from "./input/stylus-click";
import { type PenCursorStyle, penCursorStyleOf } from "./view/pen-cursor";
import { PEN_OPTIONS_ON_WRITE_NAMES } from "./view/tool-return";

export { DEFAULT_SETTINGS, type GoodObsidianSettings, type ToolId } from "./settings-data";

type SettingKey = keyof GoodObsidianSettings;
type Visible = boolean | (() => boolean);

// --- Wording -----------------------------------------------------------------

/** A callout's one line, and what its ⓘ opens if the line needs more. */
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

/** "Calculate lines that end in ="'s ⓘ. */
const CALC_NOTES_INFO =
  "Write a sum ending in = (12x4 =; an x between numbers is times) and lift the pen: " +
  "FineNotes reads the line on this device and shows what it read and the answer beside " +
  "it. Tap that to write the answer after the =, at your writing's size, in your own hand " +
  "once you have written the symbol practice sheet (a command); keep writing to leave the " +
  "page as it was. A letter set on a line above (a = 5) can be used. Check what it read " +
  "before you tap: a misread digit gives a wrong answer.";

/** Under the Paper width field while what is typed is not a width. */
const PAPER_WIDTH_ERROR = `Use ${PAPER_WIDTH_RANGE.min} to ${PAPER_WIDTH_RANGE.max}; the last valid width is kept until then.`;

/** The page appearances, as the section's status names them. */
const PAGE_APPEARANCES: Record<PageAppearance, string> = {
  light: "Light",
  dark: "Dark",
  system: "Match Obsidian",
};

/** "Page appearance" with the PDF choice folded in, as its dropdown names them. */
const APPEARANCE_CHOICES: Record<AppearanceChoice, string> = {
  light: "Light",
  dark: "Dark",
  "dark-pdf-light": "Dark, PDFs as they are",
  system: "Match Obsidian",
  "system-pdf-light": "Match Obsidian, PDFs as they are",
};

/** The cursors over the page, as "Cursor over the page" names them (FineNotes#27). */
const PEN_CURSOR_NAMES: Record<PenCursorStyle, string> = {
  ink: "Ink dot",
  crosshair: "Crosshair",
  arrow: "Arrow",
};

/** "Updates": how a newer FineNotes is told, as its dropdown names the choices. */
const UPDATE_CHOICES = {
  remind: "Remind me",
  dot: "Dot on the gear",
  off: "Off",
} as const;

/** The "Updates" choice the two stored switches add up to. */
function updateChoiceOf(settings: GoodObsidianSettings): keyof typeof UPDATE_CHOICES {
  if (!settings.checkForUpdates) return "off";
  return settings.updateReminders ? "remind" : "dot";
}

/** What the barrel button can do, as its dropdown names it. */
const BARREL_NAMES: Record<BarrelAction, string> = {
  erase: "Erase",
  lasso: "Lasso select",
  pan: "Move the page",
  none: "Nothing",
};

/** What a click of the barrel button in the air can do, as its dropdown names it. */
const STYLUS_CLICK_NAMES: Record<StylusClickAction, string> = {
  "pen-menu": "Open the pen menu",
  none: "Nothing",
};

/** Shortcuts → More: the actions after the tools, in this order. */
const SHORTCUT_MORE_ORDER = ["Selection and editing", "View and zoom", "Tools", "Saved pens"];

/**
 * The keyboard and stylus shortcuts as plain text, one `[keys, action]` pair
 * each, in the order the shortcut sheet lists them (FineNotes#25). `apple`
 * names the keys as Obsidian does on a Mac or an iPad (⌘ for Ctrl).
 */
export function shortcutList(apple: boolean): Array<[string, string]> {
  return SHORTCUT_GROUPS.flatMap((group) =>
    group.shortcuts.map((shortcut): [string, string] => [
      shortcutText(shortcut, apple),
      shortcut.action,
    ]),
  );
}

/** The words that find an action row: its name, its group, and what it is. */
function shortcutAliases(action: ShortcutAction): string[] {
  const words = action.label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return [action.group.toLowerCase(), ...words, "shortcut", "key", "hotkey", "stylus"];
}

/** The tools an ink note can open with, as the dropdown names them. */
const TOOL_NAMES = { pen: "Pen", highlighter: "Highlighter", eraser: "Eraser", select: "Select" };

/** What each row's ⓘ opens: everything a row's one line leaves out. */
const DESC = {
  pressure:
    "Turn this on to tell the pens apart: the Fountain pen gets wider the harder you press, " +
    "the Brush pen swells and tapers much more, and the Ball pen stays even. Off, every pen " +
    "draws one even width, which is the smoothest to write with.",
  pencilTilt:
    "Hold the Pencil flat and the Brush pen paints a wider stroke, up to three times its " +
    "width, for shading. Held as you write, nothing changes. Only pens and tablets that " +
    "report tilt do this (the Apple Pencil does). Shaded strokes keep their width when this " +
    "is off. An older FineNotes opens a notebook with them read-only.",
  textDragSize:
    "With the Text tool, drag on the page to draw a new text box's size. Off, every new box fits its text as you type. A tap makes a box either way.",
  desynchronized:
    "Asks the browser to draw ink with less delay. Switch it off if ink looks garbled on " +
    "your device; iOS WebKit has had trouble with it.",
  pageAppearance:
    "Show pages dark for writing at night: the paper turns dark and ink light, keeping its " +
    "color. Only the view changes: ink is saved, exported and printed in its true color, " +
    "and pictures are left as they are. PDF pages turn dark too, unless you pick “PDFs as " +
    "they are”, for slides that are dark already.",
  notebookFolder:
    "Where the New notebook dialog puts new notebooks and pages. Leave empty to use the " +
    "folder of the note that is open.",
  customColors:
    "Your own colors, as hex separated by commas, such as #ff8800, #00ccaa. Each keeps a " +
    "spot in the pen's color row, after the default ink color (four at most), and appears " +
    "in the color picker.",
  recognition:
    "What the “Recognize handwriting” command and automatic recognition use. Manual = you " +
    "type the transcription; Cloud AI sends an image of each page to the AI service above. " +
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
  openRouterSkipCompressed:
    "OpenRouter serves a model through several providers. Some run compressed (fp4) versions " +
    "that are cheaper but read handwriting less accurately. This skips the ones that say they " +
    "are compressed, and OpenRouter picks among the rest as usual. A model that only " +
    "compressed providers serve then gives no answer.",
  imageVendor:
    "Who makes pictures for “Generate image”. Claude and self-hosted endpoints cannot, so " +
    "with those pick OpenAI, Google or OpenRouter here and add that service's key.",
  savedPens:
    "Up to eight pens with their own type, colour and width, picked from the star in the " +
    "pen's toolbar or with the keys 1 to 8. Add one with + here or with that star; tap one " +
    "to change it. The arrow restores FineNotes' own eight.",
  barrel:
    "What a pen tablet's side button does while you write with it. The eraser end of the " +
    "pen always erases.",
  stylusClick:
    "What a click of the side button does with the pen held just above the page, not " +
    "touching it. A second click closes the menu again.",
  tuckPenOptionsOnWrite:
    "As soon as the pen or highlighter starts writing, the options under the tool bar (pen " +
    "type, widths and colors) tuck away, as a second tap on the pen does. Until you tap " +
    "the pen: they stay away until you tap it. Until the pen lifts: they come back by " +
    "themselves a second after the pen leaves the page. The other tools keep theirs.",
  straightHighlighter:
    "A highlighter stroke drawn along a line becomes a perfectly straight line when you lift " +
    "the pen. While you draw it follows your hand, and a curve stays as you drew it.",
  lassoAnyPart:
    "On (the default), the lasso takes a stroke or shape when any part of it is inside the loop or " +
    "touches its line, as Notability does. Off, at least half of it must be inside, as in " +
    "Goodnotes. Pictures and text boxes are taken by their middle either way.",
  penCursor:
    "On a computer, the pointer over the page while a pen, the highlighter or the laser is " +
    "in hand: a dot in the ink colour as wide as the pen writes, a small crosshair, or the arrow.",
  checkForUpdates:
    "Once a day, FineNotes reads the number of its newest release from GitHub " +
    "(github.com/Joost-8/FineNotes) and puts a dot on the toolbar's gear when it is newer. " +
    'With Remind me, "Update available" also pops up under the gear every other day until ' +
    "you update. Nothing about you or your notes is sent. Updating is still Obsidian's: its " +
    "Update button, under Community plugins.",
  shortcuts:
    "Tap a key to record a new one; Escape or a tap anywhere cancels. The keys are kept on " +
    "this device only, so a laptop and a tablet each have their own. A tool with the hand " +
    "icon on is in hand only while its key is held, then the tool before it is back. Two " +
    "shortcuts on one key " +
    "both stop until one of them changes. None act while you type in a text box; ? in a " +
    "notebook lists them all.",
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
  /** The same page as `fundingUrl` in manifest.json and `.github/FUNDING.yml`. */
  support: "https://github.com/sponsors/Joost-8",
  social: [
    { label: "X", url: "https://x.com/finenotes_" },
    { label: "Instagram", url: "https://www.instagram.com/finenotesobsidian/" },
    { label: "TikTok", url: "https://www.tiktok.com/@finenotesobsidian" },
    { label: "YouTube", url: "https://www.youtube.com/@FineNotesAtObsidian" },
  ],
} as const;

// --- Row builders ------------------------------------------------------------

// Each row is named, described and given extra search words in one call;
// Obsidian draws the control and reads and writes it through the tab. An
// empty description is left out, so the row is its name alone.

function controlRow(
  name: string,
  desc: string,
  control: SettingControl<SettingKey>,
  aliases?: string[],
): SettingDefinition {
  return { name, desc: desc || undefined, aliases, control };
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
  return { name, desc: desc || undefined, aliases, visible, render: draw };
}

/** What each on-device model is and does: the start of its row's ⓘ. */
const MODEL_PURPOSE = {
  voice:
    "Whisper (speech recognizer model) turns recordings into text when you pick “Transcribe on this device” on a recording.",
  grape:
    "Grape (handwriting recognizer model) reads your handwriting: notebook search and Obsidian's search find it, and a lassoed heading or word fills in its title or link.",
  learned:
    "Grape tuned to your own handwriting, learned on this device from the practice sheets you write (Learn your handwriting, below).",
};

/** How a model's state reads at a glance: the colour of the dot before its state. */
type ModelTone = "ready" | "off" | "missing" | "busy" | "failed";

function stateTone(state: AssetState): ModelTone {
  switch (state.kind) {
    case "ready":
      return "ready";
    case "missing":
    case "outdated":
      return "missing";
    case "failed":
      return "failed";
    default:
      return "busy";
  }
}

/** A model row's one line: its state after a dot in the state's colour. */
function modelStatus(setting: Setting, status: string, tone: ModelTone): void {
  const desc = setting.descEl;
  desc.empty();
  const line = desc.createDiv({ cls: `goodobsidian-model-status is-${tone}` });
  line.createSpan({ cls: "goodobsidian-model-dot" });
  line.createSpan({ text: status });
}

/** What the learned-model rows show, read once each time the tab opens. */
interface LearningState {
  sheets: PracticeSheet[];
  /** When each corrected word was saved (ms), oldest first. */
  answeredAt: number[];
  /** Symbol-sheet lines no symbol sheet asks for yet; null without a symbol sheet. */
  newSymbols: number[] | null;
  files: { current: boolean; previous: boolean; bytes: number };
}

/** One piece of a section's state beside its heading: words, a dot of a tone, or a colour. */
interface StatusPart {
  text?: string;
  tone?: ModelTone;
  color?: string;
}

/** An entry of a row's ⋯ menu. */
interface MenuEntry {
  title: string;
  icon: string;
  run: () => unknown;
  /** Deletes or overwrites: Obsidian draws it red. */
  warning?: boolean;
}

/** The class every folding section carries; `is-folded` beside it hides its rows. */
const SECTION_CLS = "goodobsidian-section";

/** A row that has its ⓘ already. */
const INFO_CLS = "goodobsidian-has-info";

/**
 * A saved pen row's strip of paper, px (styles.css sizes it the same): tall
 * enough for the thickest sample (`SAMPLE_MAX_THICKNESS`) with room to wave.
 */
const PEN_SAMPLE = { width: 112, height: 28 } as const;

/**
 * An ⓘ in `buttonParent` that opens `text` at the end of `textParent`, in
 * place, and closes it again. A tap on it is not a tap on its row.
 */
function infoToggle(buttonParent: HTMLElement, textParent: HTMLElement, text: string): void {
  const button = buttonParent.createSpan({ cls: "goodobsidian-info clickable-icon" });
  setIcon(button, "info");
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.setAttribute("aria-label", "More about this");
  button.setAttribute("aria-expanded", "false");
  const more = textParent.createDiv({ cls: "goodobsidian-info-text is-hidden", text });
  const flip = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const open = more.hasClass("is-hidden");
    more.toggleClass("is-hidden", !open);
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", flip);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") flip(event);
  });
}

/**
 * Give a drawn settings row its ⓘ: after its name, opening `text` under its
 * description. Once per row.
 */
export function addInfo(settingEl: HTMLElement, text: string): void {
  if (settingEl.hasClass(INFO_CLS)) return;
  const nameEl = settingEl.querySelector<HTMLElement>(".setting-item-name");
  const infoEl = settingEl.querySelector<HTMLElement>(".setting-item-info");
  if (!nameEl || !infoEl) return;
  settingEl.addClass(INFO_CLS);
  infoToggle(nameEl, infoEl, text);
}

/**
 * A row with no name or control, filled edge to edge by `draw` (a callout).
 * It is kept out of search, since it is not a setting.
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

/**
 * Remove what an earlier draw of a row put in `parent` with class `cls`:
 * Obsidian redraws a row in place, and keeps what a row added outside its
 * name, description and controls.
 */
function removeOwn(parent: HTMLElement, cls: string): void {
  for (let el = parent.querySelector(`.${cls}`); el; el = parent.querySelector(`.${cls}`)) {
    el.remove();
  }
}

/** A note that shows only while it is true: one line, the rest behind its ⓘ. */
function callout({ title, detail }: Callout, visible: Visible): SettingDefinition {
  return block((el) => {
    const box = el.createDiv({ cls: "goodobsidian-callout" });
    const line = box.createDiv({ cls: "goodobsidian-callout-title", text: title });
    if (detail) infoToggle(line, box, detail);
  }, visible);
}

// --- The tab -----------------------------------------------------------------

/** Applies to every folder row under Advanced → More: what they do and do not reach. */
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
  /** The AI group, opened by hand when no AI service is set up. */
  private aiOpen = false;
  /** Sections whose "More" rows are shown, for this opening of the settings. */
  private readonly moreOpen = new Set<SettingsSection>();
  /** Each row's ⓘ text, by row name; filled as the rows are defined. */
  private readonly infos = new Map<string, string>();
  /** Each drawn section header's status, redrawn after a value changes. */
  private readonly statuses = new Map<SettingsSection, () => void>();
  /** Each section header's current toggle, behind the one click listener it gets. */
  private readonly headerToggles = new WeakMap<HTMLElement, () => void>();
  /** Each drawn section's fold, for folding the others when one opens on a tablet. */
  private readonly folds = new Map<SettingsSection, (open: boolean) => void>();
  /** Which saved pen each drawn pen row shows, behind the one click listener it gets. */
  private readonly penRowTargets = new WeakMap<HTMLElement, number>();
  /** The binding slot listening for an input, while one records. */
  private shortcutRecorder: ShortcutRecorder | null = null;
  constructor(
    app: App,
    private readonly plugin: GoodObsidianPlugin,
  ) {
    super(app, plugin);
    // Obsidian draws the plain controls' rows itself: each gets its ⓘ as it
    // appears.
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(() => this.decorate()).observe(this.containerEl, {
        childList: true,
        subtree: true,
      });
    }
  }

  /** Rebuild the rows, e.g. after a key was added or OpenRouter connected. */
  refresh(): void {
    this.update();
  }

  /** One section open at a time on an iPad or a phone, where the screen holds one. */
  private get alone(): boolean {
    return Platform.isMobile;
  }

  /** Register `text` as the ⓘ of `def`'s row. */
  private info<T extends SettingDefinition>(def: T, text: string): T {
    this.infos.set(def.name, text);
    return def;
  }

  /** The ⓘ of the row called `name`, if it has one. */
  infoOf(name: string): string | undefined {
    return this.infos.get(name);
  }

  /** Give every drawn row that has an ⓘ text and no button yet its button. */
  private decorate(): void {
    for (const el of Array.from(this.containerEl.querySelectorAll<HTMLElement>(".setting-item"))) {
      if (el.hasClass(INFO_CLS)) continue;
      const name = el.querySelector(".setting-item-name")?.textContent?.trim();
      const text = name ? this.infos.get(name) : undefined;
      if (text) addInfo(el, text);
    }
  }

  // --- Folding ---------------------------------------------------------------

  /**
   * A section under a header that folds it: tapping the header (or its
   * chevron) hides or shows the rows, and the tab remembers which are open
   * (`settingsOpen`). The header carries the section's icon and, beside the
   * chevron, its state in a few words, so a folded section rarely needs
   * opening. Folding is a class on the group, never the rows' `visible`:
   * Obsidian's search leaves out rows that are not visible, and a folded
   * row must still be found. Obsidian applies `cls` when it first draws the
   * group; after that the class on the group is the state.
   */
  private section(
    id: SettingsSection,
    heading: string,
    icon: string,
    items: SettingDefinition[],
    status: () => StatusPart[] = () => [],
  ): SettingDefinitionItem {
    const open = sectionOpen(this.plugin.settings.settingsOpen, id, this.alone);
    const cls = [SECTION_CLS, open ? "" : "is-folded", this.moreOpen.has(id) ? "is-more-open" : ""];
    return {
      type: "group",
      heading,
      items,
      cls: cls.filter(Boolean).join(" "),
      extraButtons: [(button) => this.foldButton(button, id, heading, icon, status)],
    };
  }

  /**
   * The chevron in a section's header, and the header made the control that
   * folds it. Obsidian puts the button in the header's control column, so
   * the header and the group are its ancestors.
   */
  private foldButton(
    button: ExtraButtonComponent,
    id: SettingsSection,
    heading: string,
    icon: string,
    status: () => StatusPart[],
  ): void {
    const chevron = button.extraSettingsEl;
    const header = chevron.closest<HTMLElement>(".setting-item-heading");
    const group = chevron.closest<HTMLElement>(".setting-group");
    if (!header || !group) return;
    button.setIcon("chevron-right");
    chevron.addClass("goodobsidian-fold-chevron");
    header.addClass("goodobsidian-fold-header");
    const nameEl = header.querySelector<HTMLElement>(".setting-item-name");
    if (nameEl && !nameEl.querySelector(".goodobsidian-section-icon")) {
      const iconEl = nameEl.createSpan({ cls: "goodobsidian-section-icon" });
      setIcon(iconEl, icon);
      nameEl.prepend(iconEl);
    }
    const control = chevron.parentElement;
    if (control) {
      removeOwn(control, "goodobsidian-section-status");
      const statusEl = control.createSpan({ cls: "goodobsidian-section-status" });
      control.prepend(statusEl);
      const show = (): void => {
        statusEl.empty();
        for (const part of status()) {
          const el = statusEl.createSpan({
            cls: `goodobsidian-status-part${part.tone ? ` is-${part.tone}` : ""}`,
          });
          if (part.tone) el.createSpan({ cls: "goodobsidian-model-dot" });
          if (part.color) {
            el.createSpan({ cls: "goodobsidian-status-swatch" }).setCssStyles({
              backgroundColor: part.color,
            });
          }
          if (part.text) el.createSpan({ text: part.text });
        }
      };
      show();
      this.statuses.set(id, show);
    }
    const sync = (): void => {
      const open = !group.hasClass("is-folded");
      chevron.setAttribute("role", "button");
      chevron.setAttribute("aria-expanded", String(open));
      chevron.setAttribute("aria-label", `${open ? "Fold" : "Unfold"} ${heading}`);
    };
    const setOpen = (open: boolean): void => {
      group.toggleClass("is-folded", !open);
      sync();
    };
    this.folds.set(id, setOpen);
    const open = (): void => {
      setOpen(true);
      if (!this.alone) return;
      for (const [other, fold] of this.folds) if (other !== id) fold(false);
      header.scrollIntoView({ block: "nearest" });
    };
    const toggle = (): void => {
      const opening = group.hasClass("is-folded");
      if (opening) open();
      else setOpen(false);
      this.rememberFold(id, opening);
    };
    sync();
    // The whole header is the target, chevron included: one click, one
    // toggle. Obsidian may draw a header again in place: it keeps one
    // listener, which runs the latest toggle.
    const wired = this.headerToggles.has(header);
    this.headerToggles.set(header, toggle);
    if (!wired) header.addEventListener("click", () => this.headerToggles.get(header)?.());
    chevron.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
    if (wired) return;
    this.revealOnFlash(group, () => {
      open();
      group.addClass("is-more-open");
      this.moreOpen.add(id);
      this.rememberFold(id, true);
    });
  }

  /**
   * A search result opens its row by scrolling to it and flashing it
   * (`is-flashing`). A row in a folded section, or under a closed "More",
   * cannot be scrolled to, so the flash opens both, and the row is scrolled
   * to again.
   */
  private revealOnFlash(group: HTMLElement, reveal: () => void): void {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((changes) => {
      if (!group.hasClass("is-folded") && group.hasClass("is-more-open")) return;
      for (const change of changes) {
        const target = change.target;
        if (!target.instanceOf(HTMLElement) || !target.hasClass("is-flashing")) continue;
        reveal();
        target.scrollIntoView({ block: "center" });
        return;
      }
    });
    observer.observe(group, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  /** Save a section opened or folded; on a tablet, opening one folds the rest. */
  private rememberFold(id: SettingsSection, open: boolean): void {
    const settings = this.plugin.settings;
    settings.settingsOpen = withSection(settings.settingsOpen, id, open, this.alone);
    void this.plugin.saveSettings();
  }

  /**
   * A row that opens or closes the rows below it, like "More": Obsidian
   * draws the action row and its chevron; the caller says whether it is
   * open and what a tap does.
   */
  private disclosure(
    name: string,
    what: string,
    open: (row: HTMLElement) => boolean,
    toggle: (row: HTMLElement, open: boolean) => void,
  ): SettingDefinition {
    return {
      name,
      desc: what,
      searchable: false,
      action: (row) => toggle(row, !open(row)),
    };
  }

  /**
   * "More": the section's rows after it stay hidden until it is tapped, by
   * a class on the group (so search still finds them, and opens it). It
   * says what is under it.
   */
  private more(id: SettingsSection, what: string): SettingDefinition {
    return this.disclosure(
      "More",
      what,
      (row) => row.closest<HTMLElement>(".setting-group")?.hasClass("is-more-open") ?? false,
      (row, open) => {
        const group = row.closest<HTMLElement>(".setting-group");
        if (!group) return;
        group.toggleClass("is-more-open", open);
        if (open) this.moreOpen.add(id);
        else this.moreOpen.delete(id);
      },
    );
  }

  /** Redraw every section header's state, after a value changed. */
  private syncStatuses(): void {
    for (const show of this.statuses.values()) show();
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    this.infos.clear();
    this.statuses.clear();
    this.folds.clear();
    // By theme: writing (pens included), shortcuts, pages, the models on this
    // device, AI, then the switches few people need; feedback last.
    return [
      ...this.topRows(),
      this.writingGroup(),
      this.shortcutsGroup(),
      this.pagesGroup(),
      this.modelsGroup(),
      this.aiGroup(),
      this.advancedGroup(),
      this.footerRow(),
    ];
  }

  override getControlValue(key: string): unknown {
    if (key === "checkForUpdates") return updateChoiceOf(this.plugin.settings);
    return shownValue(this.plugin.settings, key);
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    await this.storeControlValue(key, value);
    this.syncStatuses();
  }

  private async storeControlValue(key: string, value: unknown): Promise<void> {
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
    if (key === "checkForUpdates") {
      // One choice, two switches: whether to check, and whether to pop up.
      const on = value !== "off";
      this.plugin.settings.checkForUpdates = on;
      this.plugin.settings.updateReminders = value !== "dot";
      await this.plugin.saveSettings();
      // The marks follow at once; switched on, the check runs if it is due.
      this.plugin.updates.changed();
      if (on) void this.plugin.updates.check();
      this.update();
      return;
    }
    if (key === "pressureWidth") {
      // Saved by the plugin, which redraws every open notebook's ink.
      await this.plugin.setPressureWidth(value as boolean);
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
    // A newly chosen speech model is registered before the tab is rebuilt, so its row shows it.
    if (key === "speechModel") this.plugin.speech.store();
    if (changesTabLayout(key)) this.update();
    // Turned on: Grape is needed now, so offer it if it is not here.
    if ((key === "handwritingOnDevice" || key === "checkHandwrittenWords") && value === true) {
      await this.plugin.grape.model.check();
      this.plugin.grape.offer("ask");
    }
  }

  // --- Sections --------------------------------------------------------------

  /**
   * Above every section: a newer FineNotes, while one is out, with Obsidian's
   * own Update a tap away; and the iPad's Scribble, which loses strokes,
   * until its ✕.
   */
  private topRows(): SettingDefinition[] {
    const update = this.plugin.updates.available;
    const updateRow = block((el) => {
      const box = el.createDiv({ cls: "goodobsidian-callout goodobsidian-update-callout" });
      const line = box.createDiv({ cls: "goodobsidian-callout-title" });
      line.createSpan({ text: `FineNotes ${update ?? ""} is out` });
      const open = line.createEl("button", { cls: "mod-cta", text: "Update" });
      open.setAttribute("aria-label", "Open FineNotes in Community plugins to update it");
      open.addEventListener("click", () => window.open(PLUGIN_PAGE_URL));
    });
    const shown = (): boolean =>
      Platform.isIosApp && Platform.isTablet && !this.plugin.settings.scribbleTipDismissed;
    const { title, detail } = CALLOUTS.scribble;
    return [
      // Only while one is out: the tab is rebuilt when checking is switched.
      ...(update !== null ? [updateRow] : []),
      block((el) => {
        const box = el.createDiv({ cls: "goodobsidian-callout" });
        const line = box.createDiv({ cls: "goodobsidian-callout-title", text: title });
        infoToggle(line, box, detail);
        const close = line.createSpan({ cls: "goodobsidian-callout-close clickable-icon" });
        setIcon(close, "x");
        close.setAttribute("role", "button");
        close.setAttribute("aria-label", "Dismiss");
        close.addEventListener("click", () => {
          this.plugin.settings.scribbleTipDismissed = true;
          void this.plugin.saveSettings();
          this.refreshDomState();
        });
      }, shown),
    ];
  }

  /** How the pen, the tools and the gestures behave, and what a new note starts with. */
  private writingGroup(): SettingDefinitionItem {
    const settings = this.plugin.settings;
    return this.section(
      "writing",
      "Writing",
      "pencil",
      [
        drawnRow("Start with", "", (s) => this.drawStartWith(s), [
          "default tool",
          "default stroke size",
          "pen size",
          "line width",
          "default ink color",
          "pen color",
        ]),
        this.info(
          drawnRow("Saved pens", "", (s) => this.drawSavedPensRow(s), [
            "favorite pens",
            "presets",
            "number key",
            "add pen",
            "new pen",
            "restore defaults",
          ]),
          DESC.savedPens,
        ),
        ...savedPensOf(settings.savedPens).map((pen, index) =>
          drawnRow(savedPenLabel(pen), "", (s) => this.drawSavedPen(s, pen, index), [
            "saved pen",
            "preset",
            "edit pen",
            "delete pen",
          ]),
        ),
        toggle("fingerTapUndo", "Two-finger double-tap to undo", "Three fingers redo.", [
          "undo",
          "redo",
          "gesture",
          "fingers",
          "tap",
        ]),
        this.more("writing", "Pen options, text boxes, colors, highlighter, lasso"),
        this.info(
          dropdown(
            "tuckPenOptionsOnWrite",
            "Hide pen options while writing",
            "",
            PEN_OPTIONS_ON_WRITE_NAMES,
            ["pen", "options", "pill", "hide", "tuck", "toolbar"],
          ),
          DESC.tuckPenOptionsOnWrite,
        ),
        this.info(
          toggle("textDragSize", "Drag to size text boxes", "", [
            "text",
            "text box",
            "size",
            "drag",
          ]),
          DESC.textDragSize,
        ),
        this.info(
          drawnRow("Custom colors", "", (s) => this.drawCustomColors(s), ["palette"]),
          DESC.customColors,
        ),
        controlRow(
          "Highlighter opacity",
          "",
          // In percent; data.json keeps 0–1 (settings-data.ts converts).
          { type: "slider", key: "highlighterAlpha", min: 10, max: 100, step: 5 },
          ["transparency", "alpha"],
        ),
        this.info(
          toggle("straightHighlighter", "Straighten highlighter strokes", "", [
            "highlighter",
            "straight",
            "line",
          ]),
          DESC.straightHighlighter,
        ),
        this.info(
          toggle("lassoTouches", "Lasso takes what it touches", "", [
            "lasso",
            "select",
            "selection",
            "notability",
          ]),
          DESC.lassoAnyPart,
        ),
        controlRow(
          "Zoom box line spacing",
          "Page px added after each line; negative overlaps.",
          { type: "slider", key: "zoomBoxLineStep", min: -50, max: 100, step: 5 },
          ["magnifier", "zoom", "line", "spacing", "offset", "overlap"],
        ),
        toggle(
          "zoomBoxAutoAdvance",
          "Zoom box auto-advance",
          "Moves right after a stroke reaches two thirds, then wraps.",
          ["magnifier", "zoom", "advance", "line", "scroll"],
        ),
        controlRow(
          "Zoom box auto-advance threshold",
          "Triggers in the right percentage; 33% means the right third.",
          { type: "slider", key: "zoomBoxAutoAdvanceThreshold", min: 10, max: 50, step: 1 },
          ["magnifier", "zoom", "advance", "threshold", "trigger", "percentage"],
        ),
        {
          ...this.info(
            dropdown("penCursor", "Cursor over the page", "", PEN_CURSOR_NAMES, [
              "cursor",
              "pointer",
              "crosshair",
            ]),
            DESC.penCursor,
          ),
          visible: !Platform.isMobile,
        },
      ],
      () => [
        {
          text: `${TOOL_NAMES[settings.defaultTool] ?? TOOL_NAMES.pen} · ${defaultWidthText(settings.defaultTool, settings.defaultSize)}`,
        },
        { color: settings.defaultColor },
      ],
    );
  }

  /** "Start with": the tool, the width and the colour a note opens with, side by side. */
  private drawStartWith(setting: Setting): void {
    const settings = this.plugin.settings;
    // The widths read as the ink they lay down with the tool chosen beside them.
    let sizes: HTMLSelectElement | null = null;
    const nameSizes = (tool: string): void => {
      for (const option of Array.from(sizes?.options ?? [])) {
        option.text = defaultWidthText(tool, Number(option.value));
      }
    };
    setting.addDropdown((d) => {
      for (const [id, name] of Object.entries(TOOL_NAMES)) d.addOption(id, name);
      d.selectEl.setAttribute("aria-label", "Tool");
      d.setValue(String(shownValue(settings, "defaultTool")));
      d.onChange((value) => {
        nameSizes(value);
        void this.setControlValue("defaultTool", value);
      });
    });
    setting.addDropdown((d) => {
      sizes = d.selectEl;
      for (const size of SIZES) d.addOption(String(size), String(size));
      nameSizes(String(shownValue(settings, "defaultTool")));
      d.selectEl.setAttribute("aria-label", "Stroke size");
      d.setValue(String(shownValue(settings, "defaultSize")));
      d.onChange((value) => void this.setControlValue("defaultSize", value));
    });
    setting.addColorPicker((c) => {
      c.setValue(String(shownValue(settings, "defaultColor")));
      c.onChange((value) => void this.setControlValue("defaultColor", value));
    });
  }

  private savePens(pens: readonly SavedPen[]): void {
    this.plugin.saveSavedPens(pens);
    this.update();
  }

  /** "Saved pens": add a pen (while there is room), and restore FineNotes' own eight, after asking. */
  private drawSavedPensRow(setting: Setting): void {
    const full = savedPensOf(this.plugin.settings.savedPens).length >= MAX_SAVED_PENS;
    setting.addExtraButton((button) =>
      button
        .setIcon("plus")
        .setTooltip(full ? `Saved pens are full (${MAX_SAVED_PENS})` : "Add a pen")
        .setDisabled(full)
        .onClick(() => {
          if (!full) this.openPenDialog(null);
        }),
    );
    setting.addExtraButton((button) =>
      button
        .setIcon("rotate-ccw")
        .setTooltip("Restore the default pens")
        .onClick(async () => {
          const yes = await ConfirmModal.confirm(this.app, {
            title: "Restore the default pens?",
            message: "Your saved pens are replaced by FineNotes' own eight.",
            cta: "Restore",
          });
          if (yes) this.savePens(defaultSavedPens());
        }),
    );
  }

  /**
   * A saved pen's row: its number key, its type's icon in its ink, and its
   * stroke on a strip of paper at its width, then delete. Its name and
   * width in words are the row's label and tooltip: the stroke shows them.
   * A tap on the row changes the pen. Obsidian redraws a row in place and
   * puts the row's name back, so the name is emptied first.
   */
  private drawSavedPen(setting: Setting, pen: SavedPen, index: number): void {
    setting.setClass("goodobsidian-saved-pen-row");
    const name = setting.nameEl;
    const doc = name.ownerDocument;
    name.empty();
    const label = `Pen ${index + 1}: ${savedPenLabel(pen)}`;
    const mark = name.createEl("button", { cls: "goodobsidian-saved-pen-mark clickable-icon" });
    mark.setAttribute("aria-label", label);
    mark.setAttribute("title", label);
    mark.createSpan({ cls: "goodobsidian-saved-pen-key", text: String(index + 1) });
    mark.append(penGlyph(pen.type, pen.color, doc));
    const paper = mark.createSpan({ cls: "goodobsidian-size-preview goodobsidian-pen-sample" });
    paper.toggleClass("is-highlighter", pen.type === "highlighter");
    paper.toggleClass("is-light-ink", relativeLuminance(pen.color) > 0.75);
    paper.append(
      penSample(
        pen.type,
        pen.color,
        sampleThickness(pen),
        PEN_SAMPLE.width,
        PEN_SAMPLE.height,
        this.plugin.settings.highlighterAlpha,
        doc,
      ),
    );
    // The whole of the row's left side is the target; the mark is what a
    // keyboard reaches. Obsidian keeps the info element across redraws: one
    // listener, which opens whichever pen the row shows now.
    const info = setting.infoEl;
    const wired = this.penRowTargets.has(info);
    this.penRowTargets.set(info, index);
    if (!wired) {
      info.addEventListener("click", () => {
        const at = this.penRowTargets.get(info);
        if (at !== undefined) this.openPenDialog(at);
      });
    }
    setting.addExtraButton((button) =>
      button
        .setIcon("trash-2")
        .setTooltip("Delete")
        .onClick(() =>
          this.savePens(removeSavedPen(savedPensOf(this.plugin.settings.savedPens), index)),
        ),
    );
  }

  /**
   * The pen dialog: a new pen (`index` null, starting from the pen last
   * written with) or saved pen `index`, saved when the dialog hands it back.
   */
  private openPenDialog(index: number | null): void {
    const settings = this.plugin.settings;
    const pens = savedPensOf(settings.savedPens);
    const pen = index === null ? newPenDraft(settings.lastPen) : pens[index];
    if (!pen) return;
    new SavedPenModal(this.app, {
      pen,
      index,
      pens,
      highlighterAlpha: settings.highlighterAlpha,
      recent: settings.recentColors,
      palette: settings.customColors,
      onCustomColor: (color) => {
        settings.recentColors = pushRecentColor(settings.recentColors, color);
        void this.plugin.saveSettings();
      },
      onSave: (saved) => {
        const next = putSavedPen(savedPensOf(settings.savedPens), saved, index);
        if (next) this.savePens(next);
      },
    }).open();
  }

  /**
   * The keys of the notebook, as a key map (FineNotes#25): the tools in
   * view, each with the key that picks it, and a slot that records a new
   * one; the pen tablet's side button under them, as it always was; the
   * rest of the actions under More. Everything here but the side button is
   * per device (`view/shortcut-store.ts`), so the laptop and the tablet keep
   * their own.
   */
  private shortcutsGroup(): SettingDefinitionItem {
    const tools = SHORTCUT_ACTIONS.filter((action) => action.id.startsWith("tool."));
    const rest = SHORTCUT_MORE_ORDER.flatMap((group) =>
      SHORTCUT_ACTIONS.filter((action) => action.group === group && !tools.includes(action)),
    );
    return this.section(
      "shortcuts",
      "Shortcuts",
      "keyboard",
      [
        block(
          (el) => this.drawShortcutConflicts(el),
          () => this.plugin.shortcuts.table.conflicts.length > 0,
        ),
        ...tools.map((action) => this.shortcutRow(action)),
        this.info(
          dropdown("barrelButton", "Stylus side button", "", BARREL_NAMES, [
            "barrel button",
            "pen tablet",
            "wacom",
            "stylus",
          ]),
          DESC.barrel,
        ),
        {
          ...this.info(
            dropdown("stylusButtonClick", "Side button click", "", STYLUS_CLICK_NAMES, [
              "barrel click",
              "s pen",
              "pen menu",
              "stylus",
            ]),
            DESC.stylusClick,
          ),
          // The Apple Pencil has no side button (`stylus-click.ts`).
          visible: !Platform.isIosApp,
        },
        this.more("shortcuts", "Editing, view, toolbar, saved pens"),
        ...rest.map((action) => this.shortcutRow(action)),
        this.info(
          drawnRow("Reset all shortcuts", "", (s) => this.drawResetShortcuts(s), [
            "restore keys",
            "default keys",
            "hotkeys",
          ]),
          DESC.shortcuts,
        ),
      ],
      () => {
        const table = this.plugin.shortcuts.table;
        if (table.conflicts.length > 0) return [{ text: "Clash", tone: "failed" }];
        return table.customized > 0 ? [{ text: `${table.customized} changed` }] : [];
      },
    );
  }

  /** One action's row: its name (and ⓘ), and the slot that shows and records its key. */
  private shortcutRow(action: ShortcutAction): SettingDefinition {
    const row = drawnRow(
      action.label,
      "",
      (setting) => this.drawShortcutRow(setting, action),
      shortcutAliases(action),
    );
    return action.hint ? this.info(row, action.hint) : row;
  }

  /**
   * Two rows on one key: a one-line callout while it is true, its ⓘ naming
   * the key and the rows. Neither row acts until one of them changes.
   */
  private drawShortcutConflicts(el: HTMLElement): void {
    const conflicts = this.plugin.shortcuts.table.conflicts;
    if (conflicts.length === 0) return;
    const detail = conflicts
      .map((conflict) => {
        const names = conflict.rows.map((row) => row.action.label).join(" and ");
        return `${inputsText([conflict.input], this.apple)}: ${names}`;
      })
      .join(". ");
    const box = el.createDiv({ cls: "goodobsidian-callout" });
    const line = box.createDiv({
      cls: "goodobsidian-callout-title",
      text: "Two shortcuts share a key; neither works",
    });
    infoToggle(line, box, `${detail}. Change or reset one of them.`);
  }

  /**
   * An action's controls: Reset once the row was changed, Hold (a tool that
   * has a key, as an icon that is on or off), and the slot with its key caps.
   */
  private drawShortcutRow(setting: Setting, action: ShortcutAction): void {
    const row = this.plugin.shortcuts.table.rows.find(
      (candidate) => candidate.action.id === action.id,
    );
    if (!row) return;
    setting.setClass("goodobsidian-shortcut-row");
    setting.settingEl.toggleClass("is-conflicted", row.conflicted);
    if (row.customized) {
      setting.addExtraButton((button) =>
        button
          .setIcon("rotate-ccw")
          .setTooltip("Reset to FineNotes' own key")
          .onClick(() => {
            this.plugin.shortcuts.reset(action.id);
            this.update();
          }),
      );
    }
    if (action.holdable && row.inputs.length > 0) {
      const hold = row.mode === "hold";
      setting.addExtraButton((button) => {
        button
          .setIcon("hand-grab")
          .setTooltip(hold ? "Only while the key is held" : "Hold the key to use the tool")
          .onClick(() => {
            this.plugin.shortcuts.setMode(action.id, hold ? "press" : "hold");
            this.update();
          });
        button.extraSettingsEl.toggleClass("is-active", hold);
        button.extraSettingsEl.setAttribute("aria-pressed", String(hold));
      });
    }
    const slot = setting.controlEl.createEl("button", {
      cls: "goodobsidian-shortcut-slot clickable-icon",
    });
    slot.setAttribute("type", "button");
    this.paintShortcutSlot(slot, row);
    slot.addEventListener("click", () => this.startRecording(setting, action, slot, row));
  }

  /** A slot's key caps, or a dash for a row with none. */
  private paintShortcutSlot(slot: HTMLElement, row: ShortcutRow): void {
    const apple = this.apple;
    slot.empty();
    slot.toggleClass("is-conflicted", row.conflicted);
    slot.setAttribute("aria-label", `${row.action.label}: ${inputsText(row.inputs, apple)}`);
    if (row.inputs.length === 0) {
      slot.createSpan({ cls: "goodobsidian-shortcut-unset", text: "—" });
      return;
    }
    for (const [index, input] of row.inputs.entries()) {
      if (index > 0) slot.createSpan({ cls: "goodobsidian-shortcut-sep", text: "or" });
      const way = slot.createSpan({ cls: "goodobsidian-shortcut-way" });
      for (const [capIndex, cap] of inputCaps(input, apple).entries()) {
        if (capIndex > 0 && !apple)
          way.createSpan({ cls: "goodobsidian-shortcut-plus", text: "+" });
        const key = way.createEl("kbd", { cls: "goodobsidian-key", text: cap });
        // ⌘ ⌥ ⇧ are small in most fonts: their caps set them larger, as the ? sheet does.
        if (/^[⌘⌥⇧]$/.test(cap)) key.addClass("is-glyph");
      }
    }
  }

  /** Listen for one key and keep it; Escape, a tap anywhere or a second tap cancels. */
  private startRecording(
    setting: Setting,
    action: ShortcutAction,
    slot: HTMLElement,
    row: ShortcutRow,
  ): void {
    if (this.shortcutRecorder) {
      this.shortcutRecorder.cancel();
      return;
    }
    slot.addClass("is-recording");
    slot.empty();
    slot.setAttribute("aria-label", `${action.label}: press the new key`);
    slot.createSpan({ cls: "goodobsidian-shortcut-recording", text: "Press a key or button" });
    const doc = setting.settingEl.ownerDocument ?? activeDocument;
    this.shortcutRecorder = recordShortcut(doc, {
      record: (input) => {
        this.shortcutRecorder = null;
        this.plugin.shortcuts.set(action.id, input, row.mode);
        this.update();
      },
      cancel: () => {
        this.shortcutRecorder = null;
        // Redraw the row as it was. The listeners are gone first, so the key
        // that cancelled recording never reaches the notebook.
        this.update();
      },
    });
  }

  /** Every shortcut on this device back to FineNotes' own, after asking. */
  private drawResetShortcuts(setting: Setting): void {
    setting.addButton((button) =>
      button
        .setButtonText("Reset")
        .setDestructive()
        .setDisabled(this.plugin.shortcuts.customized === 0)
        .onClick(() => void this.resetAllShortcuts()),
    );
  }

  private async resetAllShortcuts(): Promise<void> {
    const yes = await ConfirmModal.confirm(this.app, {
      title: "Reset every shortcut on this device?",
      message: "Every key goes back to FineNotes' own. Other devices keep theirs.",
      cta: "Reset",
    });
    if (!yes) return;
    this.plugin.shortcuts.resetAll();
    this.update();
  }

  /** Whether this device's keys are named with ⌘ ⌥ ⇧ or with Ctrl, Alt, Shift. */
  private get apple(): boolean {
    return Platform.isMacOS || Platform.isIosApp;
  }

  /** The paper, and where new notebooks go and how they are made. */
  private pagesGroup(): SettingDefinitionItem {
    const settings = this.plugin.settings;
    return this.section(
      "pages",
      "Pages and notebooks",
      "file-text",
      [
        this.info(
          drawnRow("Page appearance", "", (s) => this.drawAppearance(s), [
            "dark mode",
            "night mode",
            "invert",
            "theme",
            "dark PDF pages",
            "slides",
          ]),
          DESC.pageAppearance,
        ),
        drawnRow(
          "Paper width",
          "In pixels, before it is fitted to the screen.",
          (s) => this.drawPaperWidth(s),
          ["canvas size", "page width"],
        ),
        this.more("pages", "Folders, templates, file explorer"),
        this.info(
          drawnRow("New notebooks go in", "", (s) => this.drawNotebookFolder(s), [
            "default folder for new notebooks",
            "folder",
            "location",
            "new notebook",
            "new page",
          ]),
          DESC.notebookFolder,
        ),
        this.info(
          toggle("notebookOwnFolder", "Each notebook gets its own folder", "", [
            "folder",
            "own folder",
            "new notebook",
            "attachments",
          ]),
          "A folder named after the notebook, holding it and the folders its pictures, recordings, transcripts, AI chats and exports go in. Off: just the notebook file. Notebooks you already have stay as they are.",
        ),
        this.info(
          controlRow(
            "Stickers folder",
            "",
            { type: "text", key: "stickerFolder", placeholder: DEFAULT_STICKER_FOLDER },
            ["sticker", "collection", "folder"],
          ),
          "Where your own stickers live, one folder per collection. Stickers you save from a selection go into “My stickers” there.",
        ),
        this.info(
          controlRow(
            "Templates folder",
            "",
            { type: "text", key: "templateFolder", placeholder: DEFAULT_TEMPLATE_FOLDER },
            ["template", "folder", "share"],
          ),
          "Where Save as template puts .finetemplate files, and New notebook from template looks first.",
        ),
        this.info(
          controlRow(
            "Template gallery",
            "",
            { type: "text", key: "templateGalleryUrl", placeholder: "FineNotes' own gallery" },
            ["template", "gallery", "community", "share"],
          ),
          "Where Browse template gallery looks. Empty: FineNotes' own gallery on GitHub. Or the address of another gallery's index (a JSON file listing templates).",
        ),
        this.info(
          toggle("showNewNotebookInContextMenu", "New notebook in the right-click menu", "", [
            "context menu",
            "file explorer",
            "new notebook",
          ]),
          "Add New notebook to the file explorer menu. New notebooks start in the selected folder.",
        ),
        this.info(
          toggle("showNewNotebookInExplorer", "New notebook button in the file explorer", "", [
            "toolbar",
            "file explorer",
            "new notebook",
          ]),
          "Add a New notebook button beside New note and New folder in the file explorer.",
        ),
        this.info(
          toggle("folderNotebooks", "Show notebook folders as notebooks", "", [
            "file explorer",
            "folder",
            "folder note",
            "icons",
          ]),
          "In the file explorer, a notebook with its own folder shows as that folder: tap its name to open the notebook, or its arrow for its pictures, recordings and other files. Renaming one renames the other.",
        ),
      ],
      () => [
        {
          text: `${PAGE_APPEARANCES[settings.pageAppearance] ?? PAGE_APPEARANCES.light} · ${settings.paperWidth} px`,
        },
      ],
    );
  }

  /** "Page appearance": the appearance and whether PDF pages turn dark with it, as one choice. */
  private drawAppearance(setting: Setting): void {
    const settings = this.plugin.settings;
    setting.addDropdown((d) => {
      for (const [id, name] of Object.entries(APPEARANCE_CHOICES)) d.addOption(id, name);
      d.setValue(appearanceChoiceOf(settings));
      d.onChange(async (value) => {
        storeAppearanceChoice(settings, value);
        // Saved by the plugin, which redraws every open notebook.
        await this.plugin.applyPageAppearance();
        this.syncStatuses();
      });
    });
  }

  /** Rendering, input and files: the switches most people never need. */
  private advancedGroup(): SettingDefinitionItem {
    const settings = this.plugin.settings;
    return this.section(
      "advanced",
      "Advanced",
      "sliders-horizontal",
      [
        this.info(
          toggle("pressureWidth", "Pressure-sensitive pens", "", [
            "pressure sensitivity",
            "stylus",
            "Apple Pencil",
            "fountain pen",
            "brush pen",
          ]),
          DESC.pressure,
        ),
        callout(CALLOUTS.pressure, () => settings.pressureWidth),
        this.info(
          toggle("pencilTilt", "Pencil tilt", "", [
            "tilt",
            "shading",
            "Apple Pencil",
            "stylus",
            "brush pen",
          ]),
          DESC.pencilTilt,
        ),
        this.info(
          toggle("desynchronizedCanvas", "Desynchronized canvas", "", [
            "latency",
            "glitch",
            "artifacts",
          ]),
          DESC.desynchronized,
        ),
        this.info(
          dropdown("checkForUpdates", "Updates", "", UPDATE_CHOICES, [
            "check for updates",
            "new version",
            "release",
            "notification",
            "reminder",
          ]),
          DESC.checkForUpdates,
        ),
        this.info(
          toggle("debugHud", "Input debug overlay", "", [
            "diagnostics",
            "HUD",
            "troubleshooting",
            "support",
          ]),
          DESC.debugHud,
        ),
        this.info(
          controlRow(
            "Handwriting model file",
            "",
            { type: "text", key: "hwrModelPath", placeholder: "FineNotes/finenotes-hwr.bin" },
            ["handwriting", "recognition", "model"],
          ),
          "Leave blank to use Grape (handwriting recognizer model). Or give the vault path of " +
            "another model file, such as one tuned to your handwriting. It is read on this " +
            "device only.",
        ),
        this.more("advanced", "Where files are saved"),
        ...FOLDER_ROWS.map(([key, name, desc, placeholder]) =>
          this.info(
            controlRow(name, "", { type: "text", key, placeholder }, [
              "folder",
              "attachments",
              "where files are saved",
            ]),
            `${desc} ${FOLDER_NOTE}`,
          ),
        ),
      ],
      () => [
        ...(settings.pressureWidth ? [{ text: "Pressure on" }] : []),
        ...(settings.pencilTilt ? [{ text: "Tilt on" }] : []),
      ],
    );
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
    const folded = (): boolean => aiKeyFolded(this.plugin.aiSetup());
    const shown = (): boolean => this.aiOpen || !folded();
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
    const keyName = custom ? "Endpoint API key" : `${VENDORS[vendor].label} API key`;
    const imageKeyName = `${VENDORS[imageVendor].label} API key for images`;

    const rows: SettingDefinition[] = [
      this.info(
        dropdown("llmVendor", "AI service", "", VENDOR_LABELS, [
          "Anthropic",
          "Claude",
          "OpenAI",
          "GPT",
          "Gemini",
          "OpenRouter",
          "Cloud AI",
        ]),
        DESC.aiService,
      ),
      this.info(
        drawnRow(
          "Endpoint URL",
          "",
          (s) => this.drawEndpointUrl(s),
          ["self-hosted", "local server"],
          usingEndpoint,
        ),
        DESC.endpoint,
      ),
      callout(CALLOUTS.incompleteUrl, endpointShows("incomplete")),
      callout(CALLOUTS.plainHttp, endpointShows("plain-http")),
      this.info(
        drawnRow(
          "Connect OpenRouter",
          "",
          (s) => this.drawOpenRouterConnect(s),
          undefined,
          () => VENDORS[settings.llmVendor].oauthConnect,
        ),
        DESC.openRouter,
      ),
      this.info(
        controlRow("AI model", `Empty: ${DEFAULT_MODELS[vendor]}`, {
          type: "text",
          key: "llmModel",
          placeholder: DEFAULT_MODELS[vendor],
        }),
        modelDesc(vendor),
      ),
      this.info(
        drawnRow(keyName, "", (s) => this.renderKeyRow(s, vendor), ["token", "secret", "API key"]),
        this.keyDesc(vendor, "text"),
      ),
      callout(CALLOUTS.noKeychain, !this.plugin.keys.secure),
      this.info(
        dropdown("recognitionProviderId", "Handwriting recognition", "", providers, [
          "OCR",
          "handwriting to text",
        ]),
        DESC.recognition,
      ),
      {
        ...this.info(
          toggle("autoRecognize", "Recognize automatically", "", ["auto recognition"]),
          DESC.autoRecognize,
        ),
        visible: () => settings.recognitionProviderId === LLM_PROVIDER_ID,
      },
      // OpenRouter's providers and pictures are the AI rows fewest people change.
      this.more(
        "ai",
        vendor === "openrouter"
          ? "OpenRouter providers; pictures: service, model and key"
          : "Pictures: service, model and key",
      ),
      {
        ...this.info(
          toggle("openRouterSkipCompressed", "Skip compressed providers", "", [
            "provider",
            "quantization",
            "fp4",
            "fp8",
            "OpenRouter",
          ]),
          DESC.openRouterSkipCompressed,
        ),
        visible: () => settings.llmVendor === "openrouter",
      },
      this.info(
        dropdown("imageVendor", "Image generation", "", IMAGE_VENDOR_LABELS, [
          "generate image",
          "picture",
          "DALL-E",
          "GPT Image",
          "Nano Banana",
        ]),
        DESC.imageVendor,
      ),
      callout({ title: `${imageUnsupportedReason(imageVendor)}.` }, !makesImages),
      {
        ...controlRow("Image model", makesImages ? `Empty: ${imageModel}` : "", {
          type: "text",
          key: "imageModel",
          placeholder: imageModel,
        }),
        visible: makesImages,
      },
      this.info(
        drawnRow(
          imageKeyName,
          "",
          (s) => this.renderKeyRow(s, imageVendor),
          ["image key"],
          makesImages && imageVendor !== vendor,
        ),
        this.keyDesc(imageVendor, "image"),
      ),
    ];
    return this.section(
      "ai",
      "AI with your own key",
      "sparkles",
      [
        drawnRow(
          "Set up an AI service",
          "Transcribe, ask and make pictures with your own key.",
          (setting) => this.drawAiFold(setting),
          ["API key", "AI", "transcribe"],
          folded,
        ),
        ...rows.map(fold),
      ],
      () => [{ text: folded() ? "Not set up" : VENDORS[settings.llmVendor].label }],
    );
  }

  /** Ideas, bugs, support and FineNotes' accounts: one line of links at the very end. */
  private footerRow(): SettingDefinition {
    return {
      name: "Feedback and community",
      aliases: [
        "feedback",
        "idea",
        "question",
        "suggestion",
        "community",
        "report a bug",
        "issue",
        "problem",
        "GitHub",
        "social",
        "X",
        "Twitter",
        "Instagram",
        "TikTok",
        "YouTube",
        "support",
        "sponsor",
        "donate",
        "coffee",
      ],
      render: (setting) => {
        const row = setting.settingEl;
        row.empty();
        row.addClass("goodobsidian-plain-row", "goodobsidian-settings-footer");
        // The list it sits in loses its box (styles.css), marked here rather
        // than found with `:has()`, which the plugin review flags as slow.
        // Obsidian has placed the row in its list before `render` runs.
        row.parentElement?.addClass("goodobsidian-footer-items");
        // Each link in its own colour: FineNotes' three with an icon, the
        // accounts in their brands' colours. The heart says what it is on its
        // own, so its name is only its tooltip and the line stays one line.
        const link = (label: string, url: string, icon?: string, iconOnly = false): void => {
          const key = label.toLowerCase().split(" ")[0];
          const button = row.createEl("button", {
            cls: `goodobsidian-footer-link clickable-icon is-${key}`,
          });
          if (icon) setIcon(button.createSpan({ cls: "goodobsidian-footer-icon" }), icon);
          if (iconOnly) button.setAttribute("aria-label", label);
          else button.createSpan({ text: label });
          button.addEventListener("click", () => window.open(url));
        };
        link("Ideas and questions", COMMUNITY_LINKS.discussions, "lightbulb");
        link("Report a bug", COMMUNITY_LINKS.bugReport, "bug");
        link("Support FineNotes", COMMUNITY_LINKS.support, "heart", true);
        for (const { label, url } of COMMUNITY_LINKS.social) link(label, url);
      },
    };
  }

  // --- Models on this device ---------------------------------------------------

  /**
   * "Models on this device": the voice model (Whisper), Grape (the
   * handwriting recognizer model) and the model learned from the user's
   * handwriting, each one row with its state after a dot, Download while it
   * is missing and the rest in its ⋯ menu; what each is for is behind its
   * ⓘ. A model a feature registered that is none of these is listed at the
   * end.
   */
  private modelsGroup(): SettingDefinitionItem {
    const { settings } = this.plugin;
    const grape = this.plugin.grape.model;
    const speech = this.plugin.speech.store();
    const others = this.plugin.models.all().filter((s) => s !== grape && s !== speech);
    const reading = (): boolean => settings.handwritingOnDevice !== false;
    const learning = this.learningState;
    const record = learnedRecord(settings, this.plugin.grape.id);
    const onDevice = learning?.files.current ?? false;
    const mobile = Platform.isMobile;
    const download =
      "It downloads once, the first time it is needed, and runs on this device only.";
    const voice = speechModelInfo(effectiveSpeechModel(settings.speechModel, mobile)).label;
    return this.section(
      "on-device",
      "Models on this device",
      "cpu",
      [
        block((el) =>
          el.createDiv({
            cls: "goodobsidian-models-intro",
            text: "They run here: nothing they read or hear leaves this device.",
          }),
        ),
        this.info(
          drawnRow(`Voice · ${voice}`, "", (s) => this.drawDownload(s, speech), [
            "voice model",
            "audio",
            "speech",
            "whisper",
            "transcribe",
            "model",
            "download",
            "offline",
          ]),
          `${MODEL_PURPOSE.voice} ${download}`,
        ),
        this.info(
          drawnRow("Size and language", "", (s) => this.drawSpeechChoices(s), [
            "voice model size",
            "spoken language",
            "audio",
            "speech",
            "whisper",
            "transcribe",
            "offline",
          ]),
          "Tiny is quickest; base is more accurate and the default." +
            (mobile
              ? " Small is offered on desktop only: it needs more memory than an iPad has to spare."
              : " Small is the most accurate and about three times slower than base.") +
            " A new size downloads the first time you use it. For long lectures an AI key or your own server is faster. Detect finds the language of most recordings; choosing it helps with short ones.",
        ),
        this.info(
          drawnRow(
            `Handwriting · Grape ${grape.asset.version}`,
            "",
            (s) => this.drawDownload(s, grape),
            ["handwriting model", "grape", "recognition", "model", "download", "offline"],
          ),
          `${MODEL_PURPOSE.grape} ${download}`,
        ),
        this.info(
          toggle("handwritingOnDevice", "Read handwriting on this device (beta)", "", [
            "handwriting",
            "recognition",
            "search",
            "offline",
          ]),
          "Reads your notebooks with Grape, or with your own model below. In beta: it " +
            "misreads some words, more so in small or hurried writing, so check what it reads " +
            "before relying on it.",
        ),
        {
          ...this.info(
            toggle("checkHandwrittenWords", "Underline words it may have misread", "", [
              "handwriting",
              "spelling",
              "correct",
              "misread",
              "underline",
            ]),
            "A test. After a page is read, words it is not sure of get a dotted underline. Tap " +
              "one with a finger to correct the reading, confirm it, or ignore the word; " +
              "learning your handwriting uses your answers too. Uses the word list built into " +
              "FineNotes, plus your own words.txt in the plugin's handwriting folder.",
          ),
          visible: reading,
        },
        {
          ...this.info(
            toggle("calcNotes", "Calculate lines that end in =", "", [
              "calculation notes",
              "calculate",
              "calculator",
              "maths",
              "math",
              "sum",
              "equals",
              "answer",
            ]),
            CALC_NOTES_INFO,
          ),
          visible: reading,
        },
        this.info(
          drawnRow(
            "Your handwriting model",
            "",
            (s) => this.drawLearnedModel(s),
            [
              "learned handwriting model",
              "handwriting",
              "learned",
              "personal",
              "fine-tune",
              "model",
              "go back to the previous learned model",
              "undo",
              "previous",
              "delete my learned model",
              "remove",
            ],
            reading,
          ),
          [
            MODEL_PURPOSE.learned,
            learnedStatus(record, onDevice, settings.useLearnedHandwriting !== false).text,
            record && onDevice ? learnedResult(record) : "",
            learning?.files.previous ? undoText(settings[previousKey(this.plugin.grape.id)]) : "",
          ]
            .filter(Boolean)
            .join(" "),
        ),
        {
          ...this.info(
            toggle("useLearnedHandwriting", "Read with my model", "", [
              "handwriting",
              "learned",
              "personal",
              "grape",
              "fine-tune",
            ]),
            "On: your notebooks are read with the model learned from your handwriting. Off: " +
              "with Grape alone. Switching it off keeps your model on this device, ready to " +
              "switch on again.",
          ),
          visible: () => reading() && onDevice,
        },
        this.info(
          drawnRow(
            "Learn your handwriting",
            "",
            (s) => this.drawLearnRow(s),
            [
              "write the practice sheets",
              "learn my handwriting",
              "handwriting",
              "practice",
              "sheet",
              "learn",
              "personal",
              "fine-tune",
              "recognition",
            ],
            reading,
          ),
          this.learnInfo(),
        ),
        ...others.map((store) =>
          this.info(
            drawnRow(store.asset.label, "", (s) => this.drawDownload(s, store), [
              "model",
              "download",
              "offline",
              store.asset.id,
            ]),
            store.asset.purpose,
          ),
        ),
      ],
      () => [
        { text: "Voice", tone: stateTone(speech.state) },
        {
          text: "Handwriting",
          tone: reading() ? stateTone(grape.state) : "off",
        },
      ],
    );
  }

  /** "Learn your handwriting"'s ⓘ: what learning needs, what there is, what comes next. */
  private learnInfo(): string {
    const learning = this.learningState;
    const record = learnedRecord(this.plugin.settings, this.plugin.grape.id);
    const answeredAt = learning?.answeredAt ?? [];
    return learnInfoText({
      sheets: learning?.sheets ?? [],
      sets: PRACTICE_SETS.length,
      corrections: answeredAt.length,
      fresh: newCorrections(answeredAt, record),
      model: record,
      onDevice: learning?.files.current ?? false,
    });
  }

  /** The voice model's size and spoken language, side by side. */
  private drawSpeechChoices(setting: Setting): void {
    const settings = this.plugin.settings;
    const mobile = Platform.isMobile;
    setting.addDropdown((d) => {
      for (const m of speechModelsFor(mobile)) {
        d.addOption(m.id, `${m.label} (${formatSize(totalBytes(speechAsset(m.id)))})`);
      }
      d.selectEl.setAttribute("aria-label", "Voice model size");
      d.setValue(effectiveSpeechModel(settings.speechModel, mobile));
      d.onChange((value) => void this.setControlValue("speechModel", value));
    });
    setting.addDropdown((d) => {
      for (const l of SPEECH_LANGUAGES) d.addOption(l.code, l.name);
      d.selectEl.setAttribute("aria-label", "Spoken language");
      d.setValue(settings.speechLanguage ?? SPEECH_LANGUAGES[0].code);
      d.onChange((value) => void this.setControlValue("speechLanguage", value));
    });
  }

  /** A row's ⋯: a menu of `entries` under `anchor`. */
  private showMenu(anchor: HTMLElement, entries: readonly MenuEntry[]): void {
    const menu = new Menu();
    for (const entry of entries) {
      menu.addItem((item) => {
        item
          .setTitle(entry.title)
          .setIcon(entry.icon)
          .onClick(() => void entry.run());
        if (entry.warning) item.setWarning(true);
      });
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }

  /** A ⋯ button at the end of a row, for `entries`. */
  private addMenuButton(setting: Setting, label: string, entries: readonly MenuEntry[]): void {
    setting.addExtraButton((button) =>
      button
        .setIcon("more-horizontal")
        .setTooltip(label)
        .onClick(() => this.showMenu(button.extraSettingsEl, entries)),
    );
  }

  /**
   * A model's row: its state and size after a dot of its colour, and
   * Download while it is missing (Try again after a failure), or its ⋯ with
   * Re-download and Remove; nothing while it downloads.
   */
  private drawDownload(setting: Setting, store: AssetStore): void {
    setting.settingEl.addClass("goodobsidian-model-head");
    const show = (): void => {
      const state = store.state;
      modelStatus(setting, stateText(store.asset, state), stateTone(state));
      setting.controlEl.empty();
      if (isBusy(state) || state.kind === "unknown") return;
      if (state.kind === "ready") {
        this.addMenuButton(setting, "Re-download or remove", [
          {
            title: "Re-download",
            icon: "refresh-cw",
            run: () => {
              this.plugin.modelReleased(store.asset.id);
              return store.redownload();
            },
          },
          {
            title: "Remove",
            icon: "trash-2",
            warning: true,
            run: () => {
              this.plugin.modelReleased(store.asset.id);
              return store.remove();
            },
          },
        ]);
        return;
      }
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
      this.syncStatuses();
    });
    show();
    void store.check(true);
  }

  // --- The learned handwriting model -------------------------------------------

  /**
   * What the learned-model rows show: the practice sheets with their copied
   * lines, the corrected words, and which model files are here. Read when
   * those rows are first drawn, then the tab is rebuilt with it; forgotten
   * when the tab closes, or when learning, undo or delete changes it.
   */
  private learningState: LearningState | null = null;
  private learningLoad: Promise<void> | null = null;

  /** Read the learning state once, and rebuild the tab with it. */
  private loadLearning(): void {
    if (this.learningState || this.learningLoad) return;
    const host = this.plugin.learningHost();
    this.learningLoad = (async () => {
      const [sheets, corrections, newSymbols, files] = await Promise.all([
        practiceSheets(host),
        readCorrections(host),
        symbolsToWrite(host),
        learnedFiles(host),
      ]);
      const answeredAt = corrections.corrections.map((c) => c.at);
      this.learningState = { sheets, answeredAt, newSymbols, files };
    })()
      .catch(() => {
        this.learningState = {
          sheets: [],
          answeredAt: [],
          newSymbols: null,
          files: { current: false, previous: false, bytes: 0 },
        };
      })
      .finally(() => {
        this.learningLoad = null;
        if (this.containerEl.isConnected) this.update();
      });
  }

  /** Forget the learning state and read it again (after learning, undo or delete). */
  private reloadLearning(): void {
    this.learningState = null;
    this.update();
  }

  override hide(): void {
    // A binding slot must not keep listening once the tab is gone.
    this.shortcutRecorder?.cancel();
    this.shortcutRecorder = null;
    this.learningState = null;
    this.moreOpen.clear();
    super.hide();
  }

  /**
   * The learned model's row: in use with how well it reads, off, or not
   * learned yet; its ⋯ goes back to the previous model and deletes it.
   */
  private drawLearnedModel(setting: Setting): void {
    setting.settingEl.addClass("goodobsidian-model-head");
    const learning = this.learningState;
    if (!learning) {
      this.loadLearning();
      modelStatus(setting, "Looking for it…", "busy");
      return;
    }
    const { settings } = this.plugin;
    const record = learnedRecord(settings, this.plugin.grape.id);
    const inUse = settings.useLearnedHandwriting !== false;
    const badge = learnedBadge(record, learning.files.current, inUse);
    const size = learning.files.current ? ` · ${formatSize(learning.files.bytes)}` : "";
    modelStatus(setting, badge.text + size, badge.tone);
    const entries: MenuEntry[] = [];
    if (learning.files.previous) {
      entries.push({
        title: "Go back to the previous model",
        icon: "undo-2",
        run: () => this.swapLearned(),
      });
    }
    if (learning.files.current || learning.files.previous || record) {
      entries.push({
        title: "Delete…",
        icon: "trash-2",
        warning: true,
        run: () => this.deleteLearned(),
      });
    }
    if (entries.length > 0) this.addMenuButton(setting, "Previous model or delete", entries);
  }

  /**
   * "Learn your handwriting": how far it has come, a button for the next
   * practice sheet and one to learn, and the sheets as chips under the row,
   * each opening its sheet. While a run is on, the learn button shows its
   * progress, filling up as a bar, and Stop ends it; closing the settings
   * leaves it running.
   */
  private drawLearnRow(setting: Setting): void {
    setting.settingEl.addClass("goodobsidian-learn-step");
    removeOwn(setting.settingEl, "goodobsidian-sheet-chips");
    const learning = this.learningState;
    if (!learning) {
      this.loadLearning();
      return;
    }
    const host = this.plugin.learningHost();
    const learner = this.plugin.learner;
    const record = learnedRecord(this.plugin.settings, this.plugin.grape.id);
    const lines = learning.sheets.reduce((sum, sheet) => sum + sheet.written, 0);
    const enough = lines + learning.answeredAt.length >= MIN_PRACTICE_LINES;
    setting.setDesc(learnSummary(learning.sheets, PRACTICE_SETS.length));
    const next = nextSheetAction(learning.sheets, PRACTICE_SETS.length);
    setting.addButton((b) => {
      b.setButtonText(next.label).onClick(async () => {
        this.plugin.closeSettings();
        if (next.kind === "continue") await this.app.workspace.openLinkText(next.path, "", false);
        else await writePracticePage(host);
      });
      // The first thing to do, until there is enough to learn from.
      if (!enough) b.setCta();
    });
    setting.addButton((learn) => {
      learn.buttonEl.addClass("goodobsidian-learn-button");
      learn.onClick(() => void learner.start());
      if (enough) learn.setCta();
      const stop = setting.controlEl.createEl("button", {
        text: "Stop",
        cls: "goodobsidian-learn-stop",
      });
      const show = (): void => {
        const progress = learner.progress;
        learn.setDisabled(progress !== null || !enough);
        learn.setButtonText(
          progress
            ? progressLabel(progress, Date.now())
            : learning.files.current
              ? "Learn again"
              : "Learn now",
        );
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
        // A run ended: the model, its sheets and the buttons change with it.
        if (running && !now) {
          unsubscribe();
          this.reloadLearning();
          return;
        }
        running = now;
        show();
      });
      show();
    });
    const list = setting.settingEl.createDiv({ cls: "goodobsidian-sheet-chips" });
    for (const sheet of learning.sheets) {
      const use = sheetUse(sheet, record);
      const done = sheet.written >= sheet.prompts;
      const chip = list.createEl("button", {
        cls: `goodobsidian-sheet-chip clickable-icon${use === "used" ? " is-used" : ""}`,
      });
      chip.setAttribute("aria-label", `${sheet.title}: ${sheetText(sheet, use)}`);
      setIcon(
        chip.createSpan({ cls: "goodobsidian-sheet-mark" }),
        use === "used" ? "circle-check" : done || sheet.written > 0 ? "circle-dot" : "circle",
      );
      chip.createSpan({
        cls: "goodobsidian-sheet-title",
        text: isSymbolSet(sheet.set) ? "Symbols" : sheet.set ? `Sheet ${sheet.set}` : sheet.title,
      });
      chip.createSpan({
        cls: "goodobsidian-sheet-state",
        text: `${sheet.written}/${sheet.prompts}`,
      });
      chip.addEventListener("click", () => {
        this.plugin.closeSettings();
        void this.app.workspace.openLinkText(sheet.path, "", false);
      });
    }
    // The symbol sheet sits among the sheets from the start: learning takes
    // the text sheets, the symbol sheet, or both, whichever were written.
    // Beside a symbol sheet written before symbols were added, a chip writes
    // a sheet of just those.
    const added = learning.newSymbols;
    if (!learning.sheets.some((sheet) => isSymbolSet(sheet.set)) || (added && added.length > 0)) {
      const chip = list.createEl("button", { cls: "goodobsidian-sheet-chip clickable-icon" });
      chip.setAttribute(
        "aria-label",
        added && added.length > 0
          ? `Write the ${added.length} symbols added since your symbol sheet: links and maths signs`
          : "Write the symbol sheet: digits, operators and signs",
      );
      setIcon(chip.createSpan({ cls: "goodobsidian-sheet-mark" }), "circle-plus");
      chip.createSpan({
        cls: "goodobsidian-sheet-title",
        text: added && added.length > 0 ? "New symbols" : "Symbols",
      });
      chip.addEventListener("click", () => {
        this.plugin.closeSettings();
        void writeSymbolPractice(host);
      });
    }
    // The corrected words the model has not learned from, toward the next
    // round: a tracker, not a button.
    const fresh = newCorrections(learning.answeredAt, record);
    const words = list.createDiv({
      cls: `goodobsidian-sheet-chip goodobsidian-words-chip${fresh >= RELEARN_AFTER ? " is-due" : ""}`,
      attr: { role: "img" },
    });
    words.setAttribute(
      "aria-label",
      correctionsText(fresh, learning.answeredAt.length, record !== undefined),
    );
    setIcon(words.createSpan({ cls: "goodobsidian-sheet-mark" }), "spell-check");
    words.createSpan({ cls: "goodobsidian-sheet-title", text: "Words" });
    words.createSpan({ cls: "goodobsidian-sheet-state", text: `${fresh}/${RELEARN_AFTER}` });
  }

  /** Swap the learned model for the one before the last learning; swapping again goes forward. */
  private async swapLearned(): Promise<void> {
    if (this.plugin.learner.progress) return;
    await swapWithPrevious(this.plugin.learningHost());
    this.reloadLearning();
  }

  /** Delete the learned model, after a dialog that says what goes and how to keep it instead. */
  private async deleteLearned(): Promise<void> {
    const host = this.plugin.learningHost();
    const record = learnedRecord(this.plugin.settings, this.plugin.grape.id);
    const yes = await ConfirmModal.confirm(this.app, {
      title: "Delete your learned handwriting model?",
      message: deleteQuestion(record, this.learningState?.files.previous ?? false),
      cta: "Delete",
      warning: true,
    });
    if (!yes) return;
    await deleteLearnedModel(host);
    this.reloadLearning();
  }

  // --- Rows the tab draws itself ---------------------------------------------

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

  /**
   * A text field rather than Obsidian's number control: that control clamps
   * what is typed to its range without a word, and the user should see why
   * 5000 did not take. The reason is one red line under the field, while it
   * is true; the stored width stays the last valid one.
   */
  private drawPaperWidth(setting: Setting): void {
    removeOwn(setting.descEl, "goodobsidian-field-error");
    const error = setting.descEl.createDiv({
      cls: "goodobsidian-field-error is-hidden",
      text: PAPER_WIDTH_ERROR,
    });
    setting.addText((text) => {
      text.setValue(String(this.plugin.settings.paperWidth));
      text.onChange(async (typed) => {
        const width = paperWidthFrom(typed);
        error.toggleClass("is-hidden", width !== null);
        text.inputEl.toggleClass("is-invalid", width === null);
        if (width === null) return;
        this.plugin.settings.paperWidth = width;
        await this.plugin.saveSettings();
        this.syncStatuses();
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

  /** "New notebooks go in" (0.5): a text field with folder type-ahead. */
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

  /** What a key row's ⓘ says about where the key lives and where it goes. */
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
