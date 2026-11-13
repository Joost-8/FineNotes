/**
 * The settings tab, built from Obsidian 1.13's setting definitions: Obsidian
 * draws the rows, searches them, and calls `getControlValue` /
 * `setControlValue` for the plain controls. The tab draws only what a plain
 * control cannot: callouts, the rows that set two switches at once, the
 * fields that check what is typed, the saved pens, the models, and the API
 * key rows.
 *
 * The tab is a list of sections and the chosen section beside it (CLAUDE.md):
 * each section is a run of Obsidian's own groups, and a row is a drawing of
 * its effect (`view/settings-art.ts`) or an icon tile, its name, one short
 * line, and its control.
 *
 * What is stored, and how, lives in `settings-data.ts`.
 */

import {
  deleteLearnedModel,
  learnedFiles,
  learnedRecord,
  practiceSheets,
  progressLabel,
  readCorrections,
  swapWithPrevious,
  symbolsToWrite,
} from "./view/handwriting-learning";
import {
  type PracticeSheet,
  deleteQuestion,
  learnSummary,
  learnedBadge,
} from "./recognition/hwr/learned-model";
import { PRACTICE_SETS } from "./recognition/practice";
import { PLUGIN_PAGE_URL } from "./model/update-check";
import { t } from "./i18n/translate";
import { INTERFACE_LANGUAGES, resolveLanguage } from "./i18n/languages";
import { LANGUAGE_ALIASES, drawLanguageRow } from "./view/language-row";
import { obsidianLanguage } from "./view/interface-language";
import { type ArtId, artStateOf, drawArt, paintArt } from "./view/settings-art";
import {
  type App,
  Menu,
  Platform,
  PluginSettingTab,
  type Setting,
  type SettingControl,
  type SettingDefinition,
  type SettingDefinitionGroup,
  type SettingDefinitionItem,
  setIcon,
} from "obsidian";
import { ICON_NEW_NOTEBOOK, SIZES } from "./constants";
import { SHORTCUT_NEW_NOTEBOOK_URL, SHORTCUT_PDF_URL } from "./model/inbox";
import {
  ASSETS_FOLDER,
  DEFAULT_STICKER_FOLDER,
  DEFAULT_TEMPLATE_FOLDER,
  chosenFolder,
} from "./model/vault-folders";
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
import { DEFAULT_AUDIO_MODELS, type KeySlot, audioService } from "./recognition/audio-request";
import { type SpeechService, isOnlineSpeechService } from "./audio/online-speech";
import { providerLabel } from "./recognition/registry";
import {
  type GoodObsidianSettings,
  PAPER_WIDTH_RANGE,
  type PageAppearance,
  SETTINGS_SECTIONS,
  type SettingsSection,
  changesTabLayout,
  endpointWarning,
  handwritingReaderOf,
  paperWidthFrom,
  parseColorList,
  AUTO_RECOGNITION,
  recognitionChoiceOf,
  shownSectionOf,
  storeRecognitionChoice,
  shownValue,
  storeShownValue,
  withShownSection,
} from "./settings-data";
import { SHORTCUT_GROUPS, shortcutText } from "./model/shortcuts";
import {
  type ShortcutAction,
  type ShortcutGroupKey,
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
  speechChoiceLabel,
  speechModelInfo,
  speechModelsFor,
} from "./audio/speech-models";
import type { AssetStore } from "./downloads/model-store";
import { OCR_TIERS, effectiveOcrTier } from "./recognition/ocr/ocr-model";
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
import { learnWindow } from "./recognition/hwr/learn-window-model";
import { lookPaletteNames, lookPaletteOf, lookStyleNames, lookStyleOf } from "./model/look";

export { DEFAULT_SETTINGS, type GoodObsidianSettings, type ToolId } from "./settings-data";

type SettingKey = keyof GoodObsidianSettings;
type Visible = boolean | (() => boolean);

// --- Wording -----------------------------------------------------------------

/** A callout's one line, and what to do about it if the line needs more. */
interface Callout {
  title: string;
  detail?: string;
}

function callouts() {
  return {
    scribble: {
      title: t("settings.callout.scribble.title"),
      detail: t("settings.callout.scribble.detail"),
    },
    incompleteUrl: {
      title: t("settings.callout.incompleteUrl.title"),
      detail: t("settings.callout.incompleteUrl.detail"),
    },
    plainHttp: {
      title: t("settings.callout.plainHttp.title"),
      detail: t("settings.callout.plainHttp.detail"),
    },
    pressure: {
      title: t("settings.callout.pressure.title"),
      detail: t("settings.callout.pressure.detail"),
    },
    noKeychain: {
      title: t("settings.callout.noKeychain.title"),
      detail: t("settings.callout.noKeychain.detail"),
    },
  } satisfies Record<string, Callout>;
}

/** Under the Paper width field while what is typed is not a width. */
function paperWidthError(): string {
  return t("settings.paperWidth.error", {
    min: PAPER_WIDTH_RANGE.min,
    max: PAPER_WIDTH_RANGE.max,
  });
}

/** The page appearances, as the section's status names them. */
function pageAppearances(): Record<PageAppearance, string> {
  return {
    light: t("settings.pageAppearance.light"),
    dark: t("settings.pageAppearance.dark"),
    system: t("settings.pageAppearance.system"),
  };
}

/** The keys whose change redraws every open notebook's pages (`applyPageAppearance`). */
const PAGE_LOOK_KEYS = new Set(["pageAppearance", "invertPdfPages"]);

/** The cursors over the page, as "Cursor over the page" names them (FineNotes#27). */
function penCursorNames(): Record<PenCursorStyle, string> {
  return {
    ink: t("settings.penCursor.ink"),
    crosshair: t("settings.penCursor.crosshair"),
    arrow: t("settings.penCursor.arrow"),
    none: t("settings.penCursor.none"),
  };
}

/** "Read handwriting with", as its dropdown and the section's status name the choices. */
function readerNames() {
  return {
    off: t("common.off"),
    grape: "Grape",
    mine: t("settings.reader.mine"),
  } as const;
}

/** "Updates": how a newer FineNotes is told, as its dropdown names the choices. */
function updateChoices() {
  return {
    remind: t("settings.updates.remind"),
    dot: t("settings.updates.dot"),
    off: t("common.off"),
  } as const;
}

/** The "Updates" choice the two stored switches add up to. */
function updateChoiceOf(settings: GoodObsidianSettings): "remind" | "dot" | "off" {
  if (!settings.checkForUpdates) return "off";
  return settings.updateReminders ? "remind" : "dot";
}

/** What the barrel button can do, as its dropdown names it. */
function barrelNames(): Record<BarrelAction, string> {
  return {
    erase: t("settings.barrel.erase"),
    lasso: t("settings.barrel.lasso"),
    pan: t("settings.barrel.pan"),
    none: t("settings.barrel.none"),
  };
}

/** What a click of the barrel button in the air can do, as its dropdown names it. */
function stylusClickNames(): Record<StylusClickAction, string> {
  return {
    "pen-menu": t("settings.stylusClick.penMenu"),
    eraser: t("settings.stylusClick.eraser"),
    none: t("settings.stylusClick.none"),
  };
}

/** The sections, as the list names them. */
function sectionNames(): Record<SettingsSection, string> {
  return {
    general: t("settings.section.general"),
    writing: t("settings.writing.heading"),
    pages: t("settings.section.pages"),
    shortcuts: t("settings.shortcuts.heading"),
    reading: t("settings.section.reading"),
    ai: t("settings.section.ai"),
    files: t("settings.section.files"),
    troubleshooting: t("settings.section.troubleshooting"),
  };
}

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
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return [t(action.groupKey).toLowerCase(), ...words, "shortcut", "key", "hotkey", "stylus"];
}

/** The tools an ink note can open with, as the dropdown names them. */
function toolNames() {
  return {
    pen: t("settings.tool.pen"),
    highlighter: t("settings.tool.highlighter"),
    eraser: t("settings.tool.eraser"),
    select: t("settings.tool.select"),
  };
}

/** What the key rows need to know about a slot: a chat vendor, or Groq. */
function slotService(slot: KeySlot): { label: string; userEndpoint: boolean } {
  return slot === "groq" ? audioService("groq") : VENDORS[slot];
}

function speechServiceLabels(): Record<SpeechService, string> {
  return {
    device: t("settings.speechService.device"),
    groq: "Groq",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    google: "Google (Gemini)",
    custom: t("settings.speechService.custom"),
  };
}

function imageVendorLabels(): Record<ImageVendorChoice, string> {
  return {
    same: t("settings.imageVendor.same"),
    openai: "OpenAI (GPT Image)",
    google: "Google (Gemini)",
    openrouter: "OpenRouter",
  };
}

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

/** One piece of a section's state in the list: words, a dot of a tone, or a colour. */
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

/** The class of every group that belongs to a section; `-<section>` says which. */
const SECTION_CLS = "goodobsidian-sec";

/** What heads a row: a drawing of its effect, or a tile when there is nothing to draw. */
type RowMark = { art: ArtId } | { icon: string };

/** The Lucide icon on each section in the list. */
const SECTION_ICONS: Record<SettingsSection, string> = {
  general: "palette",
  writing: "pencil",
  pages: "file-text",
  shortcuts: "keyboard",
  reading: "scan-text",
  ai: "sparkles",
  files: "folder",
  troubleshooting: "wrench",
};

/** Each shortcut's tile. An action not named here (a saved pen) has the keyboard's. */
const SHORTCUT_ICONS: Record<string, string> = {
  "tool.pen": "pen-tool",
  "tool.highlighter": "highlighter",
  "tool.eraser": "eraser",
  "tool.select": "lasso",
  "tool.shape": "shapes",
  "tool.text": "type",
  "tool.laser": "wand",
  "tool.pan": "hand",
  "tool.zoom": "search",
  "edit.undo": "undo-2",
  "edit.redo": "redo-2",
  "edit.select-all": "text-select",
  "edit.delete": "trash-2",
  "edit.copy": "copy",
  "edit.cut": "scissors",
  "edit.paste": "clipboard-paste",
  "edit.turn-into-text": "type",
  "view.zoom-in": "zoom-in",
  "view.zoom-out": "zoom-out",
  "view.zoom-fit": "maximize-2",
  "view.next-page": "arrow-down",
  "view.previous-page": "arrow-up",
  "view.fullscreen": "expand",
  "view.shortcuts": "circle-help",
  "bar.image": "image-plus",
  "bar.pdf": "file-plus-2",
  "bar.sticker": "smile",
  "bar.sticky": "sticky-note",
  "bar.ruler": "ruler",
  "bar.record": "mic",
  "bar.stylus": "pen-line",
};

/**
 * A saved pen's stroke on paper, px (styles.css sizes it the same): the
 * drawing column's size, tall enough for the thickest sample
 * (`SAMPLE_MAX_THICKNESS`) with room to wave.
 */
const PEN_SAMPLE = { width: 72, height: 48 } as const;

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

/** A note that shows only while it is true: its one line, and what to do about it. */
function callout({ title, detail }: Callout, visible: Visible): SettingDefinition {
  return block((el) => {
    const box = el.createDiv({ cls: "goodobsidian-callout" });
    box.createDiv({ cls: "goodobsidian-callout-title", text: title });
    if (detail) box.createDiv({ cls: "goodobsidian-callout-detail", text: detail });
  }, visible);
}

// --- The tab -----------------------------------------------------------------

/** Where notebooks without a folder of their own save each kind of file. */
function folderRows() {
  return [
    [
      "imagesFolder",
      t("settings.folders.images.name"),
      t("settings.folders.images.desc"),
      t("settings.folders.images.placeholder"),
    ],
    [
      "recordingsFolder",
      t("settings.folders.recordings.name"),
      t("settings.folders.recordings.line"),
      t("settings.folders.recordings.placeholder"),
    ],
    [
      "transcriptsFolder",
      t("settings.folders.transcripts.name"),
      t("settings.folders.transcripts.desc"),
      t("settings.folders.transcripts.placeholder"),
    ],
    [
      "chatsFolder",
      t("settings.folders.chats.name"),
      t("settings.folders.chats.desc"),
      t("settings.folders.chats.placeholder"),
    ],
    [
      "exportsFolder",
      t("settings.folders.exports.name"),
      t("settings.folders.exports.desc"),
      t("settings.folders.exports.placeholder"),
    ],
  ] as const;
}

export class GoodObsidianSettingTab extends PluginSettingTab {
  /** What heads each row, by row name; filled as the rows are defined. */
  private readonly marks = new Map<string, RowMark>();
  /** Each section's entry in the list, for its state and for showing it as chosen. */
  private readonly navItems = new Map<SettingsSection, { item: HTMLElement; state: HTMLElement }>();
  /** The back control over an opened section on a narrow pane, and its name. */
  private navBackName: HTMLElement | null = null;
  /** Which saved pen each drawn pen row shows, behind the one click listener it gets. */
  private readonly penRowTargets = new WeakMap<HTMLElement, number>();
  /** The binding slot listening for an input, while one records. */
  private shortcutRecorder: ShortcutRecorder | null = null;
  constructor(
    app: App,
    private readonly plugin: GoodObsidianPlugin,
  ) {
    super(app, plugin);
    this.containerEl.addClass("goodobsidian-settings");
    // Obsidian draws the plain controls' rows itself: each gets its drawing
    // as it appears. A search result flashes its row: its section is shown.
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver((changes) => this.onDrawn(changes)).observe(this.containerEl, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  /** Rebuild the rows, e.g. after a key was added or OpenRouter connected. */
  refresh(): void {
    this.update();
  }

  /**
   * Show the row called `name` as a search result is shown: flashing it
   * switches to its section and scrolls to it (`reveal`). The tab may still
   * be drawing when this is called, so it looks a few times.
   */
  revealRow(name: string, triesLeft = 8): void {
    const row = Array.from(this.containerEl.querySelectorAll<HTMLElement>(".setting-item")).find(
      (el) =>
        !el.hasClass("setting-item-heading") &&
        el.querySelector(".setting-item-name")?.textContent?.trim() === name,
    );
    if (!row) {
      if (triesLeft > 0) window.setTimeout(() => this.revealRow(name, triesLeft - 1), 80);
      return;
    }
    row.addClass("is-flashing");
    this.reveal(row);
    window.setTimeout(() => row.removeClass("is-flashing"), 750);
  }

  /** The row `def` headed by the drawing `art`. */
  private art<T extends SettingDefinition>(def: T, art: ArtId): T {
    this.marks.set(def.name, { art });
    return def;
  }

  /** The row `def` headed by a tile with the Lucide icon `icon`. */
  private tile<T extends SettingDefinition>(def: T, icon: string): T {
    this.marks.set(def.name, { icon });
    return def;
  }

  /** What heads the row called `name`, if anything does. */
  markOf(name: string): RowMark | undefined {
    return this.marks.get(name);
  }

  private onDrawn(changes: MutationRecord[]): void {
    if (changes.some((change) => change.type === "childList")) this.decorate();
    for (const change of changes) {
      const target = change.target;
      if (change.type !== "attributes" || !target.instanceOf(HTMLElement)) continue;
      if (target.hasClass("is-flashing")) this.reveal(target);
    }
  }

  /**
   * Give every row its drawing or tile, as the first thing in the row: not
   * in its name or description, which Obsidian empties on each `update()`,
   * nor its controls. A row that has the right one keeps it, so it can
   * animate from the old state to the new.
   */
  private decorate(): void {
    for (const row of Array.from(this.containerEl.querySelectorAll<HTMLElement>(".setting-item"))) {
      const name = row.querySelector(".setting-item-name")?.textContent?.trim();
      // A group's heading can share its name with a row.
      const mark = name && !row.hasClass("setting-item-heading") ? this.marks.get(name) : undefined;
      if (!mark) continue;
      const key = "art" in mark ? `art:${mark.art}` : `icon:${mark.icon}`;
      const first = row.firstElementChild;
      if (first?.hasClass("goodobsidian-mark")) {
        if (first.getAttribute("data-mark") === key) continue;
        first.remove();
      }
      const el = row.createDiv({
        cls: `goodobsidian-mark ${"art" in mark ? "goodobsidian-art" : "goodobsidian-tile"}`,
        attr: { "data-mark": key },
      });
      if ("art" in mark) el.append(drawArt(mark.art, row.doc));
      else setIcon(el, mark.icon);
      row.prepend(el);
    }
    this.paintRows();
  }

  // --- The section list ------------------------------------------------------

  /** The section shown; which one is kept in `settingsOpen`. */
  private get shown(): SettingsSection {
    return shownSectionOf(this.plugin.settings.settingsOpen);
  }

  /**
   * A section's groups, one rounded card under a small heading each. Which
   * section is shown is an attribute on the tab, read by the stylesheet,
   * never the rows' `visible`: Obsidian's search leaves out rows that are
   * not visible, and every row must be found. Obsidian applies `cls` when it
   * first draws a group; `id` keeps a group the same one across redraws.
   */
  private sectionGroups(
    section: SettingsSection,
    cards: ReadonlyArray<readonly [string, string, SettingDefinition[]]>,
  ): SettingDefinitionItem[] {
    return cards.map(([key, heading, items], index) => {
      const cls = [SECTION_CLS, `${SECTION_CLS}-${section}`, index === 0 ? "is-first" : ""];
      const group: SettingDefinitionGroup & { id: string } = {
        type: "group",
        id: `${section}.${key}`,
        heading,
        items,
        cls: cls.filter(Boolean).join(" "),
      };
      return group;
    });
  }

  /** Show section `id` and remember it; on a narrow pane it opens over the list. */
  private showSection(id: SettingsSection): void {
    const settings = this.plugin.settings;
    if (this.shown !== id) {
      settings.settingsOpen = withShownSection(id);
      void this.plugin.saveSettings();
    }
    this.containerEl.addClass("is-section-open");
    this.paintShown();
    this.containerEl.scrollTop = 0;
  }

  /** Back to the section list on a narrow pane. */
  private showList(): void {
    this.containerEl.removeClass("is-section-open");
    this.containerEl.scrollTop = 0;
  }

  /**
   * A search result scrolls to its row and flashes it. A row in a section
   * not shown cannot be scrolled to, so the flash shows that section and
   * the row is scrolled to again.
   */
  private reveal(target: HTMLElement): void {
    const group = target.closest<HTMLElement>(`.${SECTION_CLS}`);
    const section = SETTINGS_SECTIONS.find((id) => group?.hasClass(`${SECTION_CLS}-${id}`));
    if (section) this.showSection(section);
    else if (target.closest(".goodobsidian-nav-group")) this.showList();
    target.scrollIntoView({ block: "center" });
  }

  private paintShown(): void {
    const shown = this.shown;
    this.containerEl.setAttribute("data-section", shown);
    for (const [id, { item }] of this.navItems) {
      item.toggleClass("is-current", id === shown);
      if (id === shown) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    }
    this.navBackName?.setText(sectionNames()[shown]);
  }

  /** The section list, and the back control a narrow pane shows over a section. */
  private navRow(): SettingDefinition {
    return block((el) => {
      el.addClass("goodobsidian-nav-row");
      this.navItems.clear();
      const back = el.createEl("button", { cls: "goodobsidian-nav-back clickable-icon" });
      back.setAttribute("type", "button");
      setIcon(back.createSpan({ cls: "goodobsidian-nav-back-icon" }), "chevron-left");
      this.navBackName = back.createSpan({ cls: "goodobsidian-nav-back-name" });
      back.setAttribute("aria-label", t("settings.section.back"));
      back.addEventListener("click", () => this.showList());
      const list = el.createDiv({ cls: "goodobsidian-nav" });
      const names = sectionNames();
      for (const id of SETTINGS_SECTIONS) {
        const item = list.createEl("button", { cls: "goodobsidian-nav-item clickable-icon" });
        item.setAttribute("type", "button");
        item.setAttribute("data-section", id);
        setIcon(item.createSpan({ cls: "goodobsidian-tile" }), SECTION_ICONS[id]);
        const text = item.createSpan({ cls: "goodobsidian-nav-text" });
        text.createSpan({ cls: "goodobsidian-nav-name", text: names[id] });
        const state = text.createSpan({ cls: "goodobsidian-nav-state" });
        const chevron = item.createSpan({ cls: "goodobsidian-nav-chevron" });
        setIcon(chevron, "chevron-right");
        item.addEventListener("click", () => this.showSection(id));
        this.navItems.set(id, { item, state });
      }
      this.paintNav();
      this.paintShown();
    });
  }

  /** Every section's state in the list. */
  private paintNav(): void {
    for (const [id, { state }] of this.navItems) {
      state.empty();
      for (const part of this.sectionStatus(id)) {
        const el = state.createSpan({
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
    }
  }

  /** What a section's row in the list says about it. */
  private sectionStatus(id: SettingsSection): StatusPart[] {
    const settings = this.plugin.settings;
    switch (id) {
      case "general": {
        const code = resolveLanguage(settings.interfaceLanguage, obsidianLanguage());
        const language = INTERFACE_LANGUAGES.find((l) => l.code === code)?.name ?? "English";
        return [{ text: language }];
      }
      case "writing":
        return [
          {
            text: t("settings.writing.status", {
              tool: toolNames()[settings.defaultTool] ?? toolNames().pen,
              width: defaultWidthText(settings.defaultTool, settings.defaultSize),
            }),
          },
          { color: settings.defaultColor },
        ];
      case "pages":
        return [
          {
            text: t("settings.pages.status", {
              appearance: pageAppearances()[settings.pageAppearance] ?? pageAppearances().light,
              width: settings.paperWidth,
            }),
          },
        ];
      case "shortcuts": {
        const table = this.plugin.shortcuts.table;
        if (table.conflicts.length > 0)
          return [{ text: t("settings.shortcuts.clash"), tone: "failed" }];
        return table.customized > 0
          ? [{ text: t("settings.shortcuts.changed", { count: table.customized }) }]
          : [];
      }
      case "reading":
        return [
          {
            text: t("settings.models.statusVoice"),
            tone: stateTone(this.plugin.speech.store().state),
          },
          {
            text: t("settings.models.statusHandwriting"),
            tone:
              settings.handwritingOnDevice !== false
                ? stateTone(this.plugin.grape.model.state)
                : "off",
          },
        ];
      case "ai":
        return [
          {
            text: aiKeyFolded(this.plugin.aiSetup())
              ? t("settings.ai.notSetUp")
              : VENDORS[settings.llmVendor].label,
          },
        ];
      default:
        return [];
    }
  }

  /** Put the settings' current values on every drawing; each moves to its new state. */
  private paintRows(): void {
    const settings = this.plugin.settings;
    paintArt(
      this.containerEl,
      artStateOf(settings, {
        dark: activeDocument.body.hasClass("theme-dark"),
        reader: handwritingReaderOf(settings, this.ownModelHere()),
        updates: updateChoiceOf(settings),
        autoRecognizing: recognitionChoiceOf(settings) === AUTO_RECOGNITION,
      }),
    );
  }

  /** The list's states and the row drawings, after a value changed. */
  private syncStatuses(): void {
    this.paintNav();
    this.paintRows();
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    this.marks.clear();
    this.containerEl.setAttribute("data-section", this.shown);
    return [
      this.calloutsGroup(),
      {
        type: "group",
        id: "nav",
        cls: "goodobsidian-nav-group",
        items: [this.navRow(), this.footerRow()],
      } as SettingDefinitionItem,
      ...this.generalGroups(),
      ...this.writingGroups(),
      ...this.pagesGroups(),
      ...this.shortcutsGroups(),
      ...this.readingGroups(),
      ...this.aiGroups(),
      ...this.filesGroups(),
      ...this.troubleshootingGroups(),
    ];
  }

  override getControlValue(key: string): unknown {
    if (key === "checkForUpdates") return updateChoiceOf(this.plugin.settings);
    if (key === "handwritingOnDevice") {
      return handwritingReaderOf(this.plugin.settings, this.ownModelHere());
    }
    if (key === "recognitionProviderId") return recognitionChoiceOf(this.plugin.settings);
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
    if (key === "handwritingOnDevice") {
      // Saved by the plugin, which offers Grape if it is needed now.
      await this.plugin.setHandwritingReader(String(value));
      // Its rows show only while something reads.
      this.update();
      return;
    }
    if (key === "recognitionProviderId") {
      // One choice, two keys: which reads, and whether Cloud AI runs by itself.
      storeRecognitionChoice(this.plugin.settings, String(value));
      await this.plugin.saveSettings();
      this.update();
      return;
    }
    if (key === "gestureHints") {
      // Saved by the plugin, which forgets what it counted when the hints go off.
      await this.plugin.setGestureHints(value === true);
      return;
    }
    if (key === "pressureWidth") {
      // Saved by the plugin, which redraws every open notebook's ink.
      await this.plugin.setPressureWidth(value as boolean);
      this.update();
      return;
    }
    if (PAGE_LOOK_KEYS.has(key)) {
      // Saved by the plugin, which redraws every open notebook with it.
      storeShownValue(this.plugin.settings, key, value);
      await this.plugin.applyPageAppearance();
      return;
    }
    if (key === "llmVendor") {
      // An approval still pending in the browser would otherwise land on the
      // vendor the user just left.
      this.plugin.cancelOpenRouterConnect();
      // Saved by the plugin, which keeps the key and model of the one left.
      await this.plugin.switchLlmVendor(value as LlmVendor);
      this.update();
      return;
    }
    storeShownValue(this.plugin.settings, key, value);
    await this.plugin.saveSettings();
    // A newly chosen speech model is registered before the tab is rebuilt, so its row shows it.
    if (key === "speechModel") this.plugin.speech.store();
    if (changesTabLayout(key)) this.update();
    // Turned on: Grape is needed now, so offer it if it is not here.
    if (key === "checkHandwrittenWords" && value === true) {
      await this.plugin.grape.model.check();
      this.plugin.grape.offer("ask");
    }
  }

  // --- Sections --------------------------------------------------------------

  /**
   * Above the sections: a newer FineNotes, while one is out, with Obsidian's
   * own Update a tap away; and the iPad's Scribble, which loses strokes,
   * until its ✕.
   */
  private calloutsGroup(): SettingDefinitionItem {
    const update = this.plugin.updates.available;
    const updateRow = block((el) => {
      const box = el.createDiv({ cls: "goodobsidian-callout goodobsidian-update-callout" });
      const line = box.createDiv({ cls: "goodobsidian-callout-title" });
      line.createSpan({ text: t("settings.update.out", { version: update ?? "" }) });
      const open = line.createEl("button", { cls: "mod-cta", text: t("settings.update.button") });
      open.setAttribute("aria-label", t("settings.update.tip"));
      open.addEventListener("click", () => window.open(PLUGIN_PAGE_URL));
    });
    const shown = (): boolean =>
      Platform.isIosApp && Platform.isTablet && !this.plugin.settings.scribbleTipDismissed;
    const { title, detail } = callouts().scribble;
    return {
      type: "group",
      id: "callouts",
      cls: "goodobsidian-callouts",
      items: [
        // Only while one is out: the tab is rebuilt when checking is switched.
        ...(update !== null ? [updateRow] : []),
        block((el) => {
          const box = el.createDiv({ cls: "goodobsidian-callout" });
          const line = box.createDiv({ cls: "goodobsidian-callout-title", text: title });
          if (detail) box.createDiv({ cls: "goodobsidian-callout-detail", text: detail });
          const close = line.createSpan({ cls: "goodobsidian-callout-close clickable-icon" });
          setIcon(close, "x");
          close.setAttribute("role", "button");
          close.setAttribute("aria-label", t("common.dismiss"));
          close.addEventListener("click", () => {
            this.plugin.settings.scribbleTipDismissed = true;
            void this.plugin.saveSettings();
            this.refreshDomState();
          });
        }, shown),
      ],
    } as SettingDefinitionItem;
  }

  /** The tab's own language and looks, and how updates are announced. */
  private generalGroups(): SettingDefinitionItem[] {
    return this.sectionGroups("general", [
      [
        "main",
        "",
        [
          this.tile(
            drawnRow(
              t("language.name"),
              t("settings.language.line"),
              (s) => this.drawLanguage(s),
              LANGUAGE_ALIASES,
            ),
            "languages",
          ),
          this.art(
            drawnRow(
              t("settings.look.styleLabel"),
              t("settings.look.styleLine"),
              (s) => this.drawStyle(s),
              ["look", "style", "theme"],
            ),
            "style",
          ),
          this.art(
            drawnRow(
              t("settings.look.paletteLabel"),
              t("settings.look.paletteLine"),
              (s) => this.drawPalette(s),
              ["look", "colours", "colors", "palette", "theme"],
            ),
            "palette",
          ),
          this.art(
            toggle("simpleLook", t("settings.simpleLook.name"), t("settings.simpleLook.line"), [
              "simple",
              "look",
              "hide",
              "sidebar",
              "ribbon",
            ]),
            "simpleLook",
          ),
          this.tile(
            toggle(
              "gestureHints",
              t("settings.gestureHints.name"),
              t("settings.gestureHints.line"),
              ["hint", "tip", "suggest", "gesture"],
            ),
            "lightbulb",
          ),
          this.art(
            dropdown(
              "checkForUpdates",
              t("settings.updates.name"),
              t("settings.updates.line"),
              updateChoices(),
              ["check for updates", "new version", "release", "notification", "reminder"],
            ),
            "updates",
          ),
        ],
      ],
    ]);
  }

  /** The pens, the gestures, the stylus, and the colours of a new note. */
  private writingGroups(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    return this.sectionGroups("writing", [
      [
        "pens",
        t("settings.writing.pensHeading"),
        [
          this.art(
            drawnRow(
              t("settings.startWith.name"),
              t("settings.startWith.line"),
              (s) => this.drawStartWith(s),
              [
                "default tool",
                "default stroke size",
                "pen size",
                "line width",
                "default ink color",
                "pen color",
              ],
            ),
            "startWith",
          ),
          this.tile(
            drawnRow(
              t("settings.savedPens.name"),
              t("settings.savedPens.line"),
              (s) => this.drawSavedPensRow(s),
              ["favorite pens", "presets", "number key", "add pen", "new pen", "restore defaults"],
            ),
            "pencil-line",
          ),
          ...savedPensOf(settings.savedPens).map((pen, index) => ({
            // Two pens can read the same: Obsidian keys a row by this.
            id: `saved-pen-${index}`,
            ...drawnRow(savedPenLabel(pen), "", (s) => this.drawSavedPen(s, pen, index), [
              "saved pen",
              "preset",
              "edit pen",
              "delete pen",
            ]),
          })),
        ],
      ],
      [
        "gestures",
        t("settings.writing.gesturesHeading"),
        [
          this.art(
            toggle(
              "fingerTapUndo",
              t("settings.fingerTapUndo.name"),
              t("settings.fingerTapUndo.desc"),
              ["undo", "redo", "gesture", "fingers", "tap"],
            ),
            "undo",
          ),
          this.art(
            toggle(
              "lassoTouches",
              t("settings.lassoTouches.name"),
              t("settings.lassoTouches.line"),
              ["lasso", "select", "selection", "notability"],
            ),
            "lasso",
          ),
          this.art(
            toggle(
              "textDragSize",
              t("settings.textDragSize.name"),
              t("settings.textDragSize.line"),
              ["text", "text box", "size", "drag"],
            ),
            "textDrag",
          ),
        ],
      ],
      [
        "stylus",
        t("settings.writing.stylusHeading"),
        [
          this.art(
            drawnRow(
              t("settings.barrel.name"),
              Platform.isIosApp ? t("settings.barrel.line") : t("settings.barrel.bothLine"),
              (s) => this.drawSideButton(s),
              [
                "barrel button",
                "pen tablet",
                "wacom",
                "stylus",
                "side button click",
                "barrel click",
                "s pen",
                "pen menu",
                "eraser",
              ],
            ),
            "barrel",
          ),
          this.art(
            toggle("pressureWidth", t("settings.pressure.name"), t("settings.pressure.line"), [
              "pressure sensitivity",
              "stylus",
              "Apple Pencil",
              "fountain pen",
              "brush pen",
            ]),
            "pressure",
          ),
          callout(callouts().pressure, () => settings.pressureWidth),
          this.art(
            toggle("pencilTilt", t("settings.pencilTilt.name"), t("settings.pencilTilt.line"), [
              "tilt",
              "shading",
              "Apple Pencil",
              "stylus",
              "brush pen",
            ]),
            "tilt",
          ),
          {
            ...this.art(
              dropdown(
                "penCursor",
                t("settings.penCursor.name"),
                t("settings.penCursor.line"),
                penCursorNames(),
                ["cursor", "pointer", "crosshair"],
              ),
              "cursor",
            ),
            visible: !Platform.isMobile,
          },
        ],
      ],
      [
        "colours",
        t("settings.writing.coloursHeading"),
        [
          this.art(
            drawnRow(
              t("settings.customColors.name"),
              t("settings.customColors.line"),
              (s) => this.drawCustomColors(s),
              ["palette"],
            ),
            "customColors",
          ),
        ],
      ],
    ]);
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
      for (const [id, name] of Object.entries(toolNames())) d.addOption(id, name);
      d.selectEl.setAttribute("aria-label", t("settings.startWith.tool"));
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
      d.selectEl.setAttribute("aria-label", t("settings.startWith.size"));
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
        .setTooltip(
          full
            ? t("settings.savedPens.full", { max: MAX_SAVED_PENS })
            : t("settings.savedPens.add"),
        )
        .setDisabled(full)
        .onClick(() => {
          if (!full) this.openPenDialog(null);
        }),
    );
    setting.addExtraButton((button) =>
      button
        .setIcon("rotate-ccw")
        .setTooltip(t("settings.savedPens.restoreTip"))
        .onClick(async () => {
          const yes = await ConfirmModal.confirm(this.app, {
            title: t("settings.savedPens.restoreTitle"),
            message: t("settings.savedPens.restoreMessage"),
            cta: t("settings.savedPens.restore"),
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
    const label = t("settings.savedPens.penLabel", {
      number: index + 1,
      label: savedPenLabel(pen),
    });
    const mark = name.createEl("button", { cls: "goodobsidian-saved-pen-mark clickable-icon" });
    mark.setAttribute("aria-label", label);
    mark.setAttribute("title", label);
    mark.createSpan({ cls: "goodobsidian-saved-pen-key", text: String(index + 1) });
    mark.append(penGlyph(pen.type, pen.color, doc));
    mark.createSpan({ cls: "goodobsidian-saved-pen-name", text: savedPenLabel(pen) });
    removeOwn(setting.settingEl, "goodobsidian-pen-art");
    const art = setting.settingEl.createDiv({ cls: "goodobsidian-mark goodobsidian-pen-art" });
    setting.settingEl.prepend(art);
    const paper = art.createSpan({ cls: "goodobsidian-size-preview goodobsidian-pen-sample" });
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
    art.addEventListener("click", () => this.openPenDialog(index));
    setting.addExtraButton((button) =>
      button
        .setIcon("trash-2")
        .setTooltip(t("common.delete"))
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
   * The keys of the notebook, as a key map (FineNotes#25): each action with
   * the key that picks it and a slot that records a new one. Everything here
   * is per device (`view/shortcut-store.ts`), so the laptop and the tablet
   * keep their own.
   */
  private shortcutsGroups(): SettingDefinitionItem[] {
    const isTool = (action: ShortcutAction): boolean => action.id.startsWith("tool.");
    const inGroup = (group: ShortcutGroupKey, extra: (a: ShortcutAction) => boolean = () => true) =>
      SHORTCUT_ACTIONS.filter((action) => action.groupKey === group && extra(action)).map((a) =>
        this.shortcutRow(a),
      );
    return this.sectionGroups("shortcuts", [
      [
        "tools",
        t("toolbar.shortcut.group.tools"),
        [
          block((el) =>
            el.createDiv({
              cls: "goodobsidian-models-intro",
              text: t("settings.shortcuts.line"),
            }),
          ),
          block(
            (el) => this.drawShortcutConflicts(el),
            () => this.plugin.shortcuts.table.conflicts.length > 0,
          ),
          ...inGroup("toolbar.shortcut.group.tools", isTool),
        ],
      ],
      [
        "editing",
        t("toolbar.shortcut.group.selectionEditing"),
        inGroup("toolbar.shortcut.group.selectionEditing"),
      ],
      ["view", t("toolbar.shortcut.group.viewZoom"), inGroup("toolbar.shortcut.group.viewZoom")],
      [
        "toolbar",
        t("settings.shortcuts.toolbarHeading"),
        inGroup("toolbar.shortcut.group.tools", (action) => !isTool(action)),
      ],
      ["pens", t("toolbar.shortcut.group.savedPens"), inGroup("toolbar.shortcut.group.savedPens")],
      [
        "reset",
        "",
        [
          this.tile(
            drawnRow(
              t("settings.shortcuts.resetAll"),
              t("settings.shortcuts.resetLine"),
              (s) => this.drawResetShortcuts(s),
              ["restore keys", "default keys", "hotkeys"],
            ),
            "rotate-ccw",
          ),
        ],
      ],
    ]);
  }

  /** One action's row: its name, and the slot that shows and records its key. */
  private shortcutRow(action: ShortcutAction): SettingDefinition {
    return this.tile(
      drawnRow(
        action.label,
        action.hint ?? "",
        (setting) => this.drawShortcutRow(setting, action),
        shortcutAliases(action),
      ),
      SHORTCUT_ICONS[action.id] ?? "keyboard",
    );
  }

  /**
   * Two rows on one key: a callout while it is true, naming the key and the
   * rows. Neither row acts until one of them changes.
   */
  private drawShortcutConflicts(el: HTMLElement): void {
    const conflicts = this.plugin.shortcuts.table.conflicts;
    if (conflicts.length === 0) return;
    const detail = conflicts
      .map((conflict) => {
        const names = conflict.rows
          .map((row) => row.action.label)
          .reduce((a, b) => t("settings.shortcuts.nameJoin", { a, b }));
        return t("settings.shortcuts.conflictLine", {
          keys: inputsText([conflict.input], this.apple),
          names,
        });
      })
      .reduce((a, b) => t("settings.shortcuts.conflictJoin", { a, b }));
    const box = el.createDiv({ cls: "goodobsidian-callout" });
    box.createDiv({ cls: "goodobsidian-callout-title", text: t("settings.shortcuts.conflict") });
    box.createDiv({
      cls: "goodobsidian-callout-detail",
      text: t("settings.shortcuts.conflictDetail", { conflicts: detail }),
    });
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
          .setTooltip(t("settings.shortcuts.resetTip"))
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
          .setTooltip(hold ? t("settings.shortcuts.holdOn") : t("settings.shortcuts.holdOff"))
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
    slot.setAttribute(
      "aria-label",
      t("settings.shortcuts.slotLabel", {
        action: row.action.label,
        keys: inputsText(row.inputs, apple),
      }),
    );
    if (row.inputs.length === 0) {
      slot.createSpan({ cls: "goodobsidian-shortcut-unset", text: "—" });
      return;
    }
    for (const [index, input] of row.inputs.entries()) {
      if (index > 0) {
        slot.createSpan({ cls: "goodobsidian-shortcut-sep", text: t("settings.shortcuts.or") });
      }
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
    slot.setAttribute("aria-label", t("settings.shortcuts.recordLabel", { action: action.label }));
    slot.createSpan({
      cls: "goodobsidian-shortcut-recording",
      text: t("settings.shortcuts.recording"),
    });
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
        .setButtonText(t("settings.shortcuts.reset"))
        .setDestructive()
        .setDisabled(this.plugin.shortcuts.customized === 0)
        .onClick(() => void this.resetAllShortcuts()),
    );
  }

  private async resetAllShortcuts(): Promise<void> {
    const yes = await ConfirmModal.confirm(this.app, {
      title: t("settings.shortcuts.resetTitle"),
      message: t("settings.shortcuts.resetMessage"),
      cta: t("settings.shortcuts.reset"),
    });
    if (!yes) return;
    this.plugin.shortcuts.resetAll();
    this.update();
  }

  /** Whether this device's keys are named with ⌘ ⌥ ⇧ or with Ctrl, Alt, Shift. */
  private get apple(): boolean {
    return Platform.isMacOS || Platform.isIosApp;
  }

  /** The paper, where new notebooks go, and what Obsidian's file list shows. */
  private pagesGroups(): SettingDefinitionItem[] {
    return this.sectionGroups("pages", [
      [
        "paper",
        t("settings.pages.paperHeading"),
        [
          this.art(
            dropdown(
              "pageAppearance",
              t("settings.pageAppearance.name"),
              t("settings.pageAppearance.line"),
              pageAppearances(),
              ["dark mode", "night mode", "invert", "theme"],
            ),
            "pageAppearance",
          ),
          this.art(
            drawnRow(
              t("settings.paperWidth.name"),
              t("settings.paperWidth.desc"),
              (s) => this.drawPaperWidth(s),
              ["canvas size", "page width"],
            ),
            "paperWidth",
          ),
        ],
      ],
      [
        "notebooks",
        t("settings.pages.notebooksHeading"),
        [
          this.tile(
            drawnRow(
              t("settings.notebookFolder.name"),
              t("settings.notebookFolder.line"),
              (s) => this.drawNotebookFolder(s),
              [
                "default folder for new notebooks",
                "folder",
                "location",
                "new notebook",
                "new page",
              ],
            ),
            "folder-input",
          ),
          this.art(
            toggle(
              "notebookOwnFolder",
              t("settings.notebookOwnFolder.name"),
              t("settings.notebookOwnFolder.line"),
              ["folder", "own folder", "new notebook", "attachments"],
            ),
            "ownFolder",
          ),
          // Shortcuts exist on Apple devices only.
          ...(this.apple
            ? [
                this.tile(
                  drawnRow(
                    t("settings.shortcutsApp.name"),
                    t("settings.shortcutsApp.line"),
                    (s) => this.drawShortcutLinks(s),
                    ["shortcuts", "share sheet", "home screen", "pdf", "inbox"],
                  ),
                  "share",
                ),
              ]
            : []),
        ],
      ],
      [
        "explorer",
        t("settings.pages.explorerHeading"),
        [
          this.art(
            toggle(
              "showNewNotebookInContextMenu",
              t("settings.newNotebookContextMenu.name"),
              t("settings.newNotebookContextMenu.line"),
              ["context menu", "file explorer", "new notebook"],
            ),
            "contextMenu",
          ),
          this.art(
            toggle(
              "showNewNotebookInExplorer",
              t("settings.libraryExplorer.name"),
              t("settings.libraryExplorer.line"),
              ["toolbar", "file explorer", "library", "new notebook"],
            ),
            "libraryButton",
          ),
          this.art(
            toggle(
              "folderNotebooks",
              t("settings.folderNotebooks.name"),
              t("settings.folderNotebooks.line"),
              ["file explorer", "folder", "folder note", "icons"],
            ),
            "folderNotebooks",
          ),
        ],
      ],
    ]);
  }

  /** Where FineNotes keeps what you add and make. */
  private filesGroups(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    // A field that left the tab stays while it holds a value of its own, so
    // it can be cleared. Read once per build: a row that vanished while it
    // was being typed in would take the keyboard with it.
    const holds = (key: "transcriptsFolder" | "hwrModelPath"): boolean =>
      (settings[key] ?? "").trim() !== "";
    const folderIcons: Record<string, string> = {
      imagesFolder: "images",
      recordingsFolder: "audio-lines",
      transcriptsFolder: "file-text",
      chatsFolder: "messages-square",
      exportsFolder: "file-output",
    };
    return this.sectionGroups("files", [
      [
        "library",
        t("settings.files.libraryHeading"),
        [
          this.tile(
            controlRow(
              t("settings.assetsFolder.name"),
              t("settings.assetsFolder.line"),
              { type: "text", key: "assetsFolder", placeholder: ASSETS_FOLDER },
              [
                "sticker",
                "stickers folder",
                "template",
                "templates folder",
                "collection",
                "folder",
              ],
            ),
            "folder-heart",
          ),
          this.tile(
            {
              ...controlRow(
                t("settings.stickerFolder.name"),
                t("settings.folders.ownLine"),
                { type: "text", key: "stickerFolder", placeholder: DEFAULT_STICKER_FOLDER },
                ["sticker", "collection", "folder"],
              ),
              visible: chosenFolder(settings.stickerFolder, "stickers") !== null,
            },
            "sticker",
          ),
          this.tile(
            {
              ...controlRow(
                t("settings.templateFolder.name"),
                t("settings.folders.ownLine"),
                { type: "text", key: "templateFolder", placeholder: DEFAULT_TEMPLATE_FOLDER },
                ["template", "folder", "share"],
              ),
              visible: chosenFolder(settings.templateFolder, "templates") !== null,
            },
            "layout-template",
          ),
          this.tile(
            controlRow(
              t("settings.templateGallery.name"),
              t("settings.templateGallery.line"),
              {
                type: "text",
                key: "templateGalleryUrl",
                placeholder: t("settings.templateGallery.placeholder"),
              },
              ["template", "gallery", "community", "share"],
            ),
            "globe",
          ),
        ],
      ],
      [
        "saved",
        t("settings.files.savedHeading"),
        folderRows().map(([key, name, desc, placeholder]) =>
          this.tile(
            {
              ...controlRow(name, desc, { type: "text", key, placeholder }, [
                "folder",
                "attachments",
                "where files are saved",
                ...(key === "recordingsFolder" ? ["transcripts", "recording transcripts"] : []),
              ]),
              visible: key !== "transcriptsFolder" || holds("transcriptsFolder"),
            },
            folderIcons[key] ?? "folder",
          ),
        ),
      ],
      [
        "model",
        t("settings.files.modelHeading"),
        [
          this.tile(
            {
              ...controlRow(
                t("settings.hwrModelFile.name"),
                t("settings.folders.ownLine"),
                { type: "text", key: "hwrModelPath", placeholder: "FineNotes/finenotes-hwr.bin" },
                ["handwriting", "recognition", "model"],
              ),
              visible: holds("hwrModelPath"),
            },
            "file-cog",
          ),
        ],
      ],
    ]);
  }

  /** The switch to reach for when strokes go missing or break. */
  private troubleshootingGroups(): SettingDefinitionItem[] {
    return this.sectionGroups("troubleshooting", [
      [
        "main",
        "",
        [
          this.art(
            toggle("debugHud", t("settings.debugHud.name"), t("settings.debugHud.line"), [
              "diagnostics",
              "HUD",
              "troubleshooting",
              "support",
            ]),
            "debugHud",
          ),
        ],
      ],
    ]);
  }

  /**
   * "AI with your own key". The vendors are read once per build of the rows:
   * changing one rebuilds them (`changesTabLayout`). The endpoint URL is
   * read on every visibility check, as it changes while being typed.
   */
  private aiGroups(): SettingDefinitionItem[] {
    const { settings } = this.plugin;
    const providers: Record<string, string> = {};
    for (const id of this.plugin.providers.keys()) providers[id] = providerLabel(id);
    // Cloud AI by itself, after Cloud AI: automatic recognition, as a choice.
    const recognitionChoices: Record<string, string> = {};
    for (const [id, label] of Object.entries(providers)) {
      recognitionChoices[id] = label;
      if (id === LLM_PROVIDER_ID)
        recognitionChoices[AUTO_RECOGNITION] = t("settings.recognition.auto");
    }
    const vendor = settings.llmVendor;
    const custom = VENDORS[vendor].userEndpoint;
    const imageVendor = resolveImageVendor(settings.imageVendor, vendor);
    const makesImages = canGenerateImages(imageVendor);
    const usingEndpoint = () => VENDORS[settings.llmVendor].userEndpoint;
    const endpointShows = (warning: ReturnType<typeof endpointWarning>) => () =>
      usingEndpoint() && endpointWarning(settings.llmBaseUrl) === warning;
    const imageModel = makesImages ? DEFAULT_IMAGE_MODELS[imageVendor] : "";
    const keyName = custom
      ? t("settings.ai.endpointKey")
      : t("settings.ai.keyName", { service: VENDORS[vendor].label });
    const imageKeyName = t("settings.ai.imageKeyName", { service: VENDORS[imageVendor].label });
    const speechService = settings.speechService ?? "device";
    const speechOnline = isOnlineSpeechService(speechService);
    const speechModel = DEFAULT_AUDIO_MODELS[speechOnline ? speechService : "groq"];
    const speechKeyName = !speechOnline
      ? t("settings.ai.speechKeyName", { service: "Groq" })
      : speechService === "custom"
        ? t("settings.ai.endpointKey")
        : t("settings.ai.speechKeyName", { service: slotService(speechService).label });

    return this.sectionGroups("ai", [
      [
        "service",
        t("settings.ai.serviceHeading"),
        [
          this.tile(
            dropdown(
              "llmVendor",
              t("settings.ai.service.name"),
              t("settings.ai.service.line"),
              VENDOR_LABELS,
              [
                "Anthropic",
                "Claude",
                "OpenAI",
                "GPT",
                "Gemini",
                "OpenRouter",
                "Cloud AI",
                "AI",
                "transcribe",
              ],
            ),
            "bot",
          ),
          this.tile(
            drawnRow(
              t("settings.ai.endpointUrl.name"),
              t("settings.ai.endpointUrl.line"),
              (s) => this.drawEndpointUrl(s),
              ["self-hosted", "local server"],
              usingEndpoint,
            ),
            "server",
          ),
          callout(callouts().incompleteUrl, endpointShows("incomplete")),
          callout(callouts().plainHttp, endpointShows("plain-http")),
          this.tile(
            drawnRow(
              t("settings.openRouter.name"),
              t("settings.openRouter.line"),
              (s) => this.drawOpenRouterConnect(s),
              undefined,
              () => VENDORS[settings.llmVendor].oauthConnect,
            ),
            "plug",
          ),
          this.tile(
            controlRow(
              t("settings.aiModel.name"),
              t("settings.ai.empty", { model: DEFAULT_MODELS[vendor] }),
              {
                type: "text",
                key: "llmModel",
                placeholder: DEFAULT_MODELS[vendor],
              },
            ),
            "cpu",
          ),
          this.tile(
            drawnRow(keyName, this.keyLine(vendor), (s) => this.renderKeyRow(s, vendor), [
              "token",
              "secret",
              "API key",
            ]),
            "key-round",
          ),
          callout(callouts().noKeychain, !this.plugin.keys.secure),
        ],
      ],
      [
        "transcribing",
        t("settings.ai.transcribingHeading"),
        [
          this.art(
            dropdown(
              "recognitionProviderId",
              t("settings.recognition.name"),
              t("settings.recognition.line"),
              recognitionChoices,
              ["OCR", "handwriting to text", "auto recognition", "recognize automatically"],
            ),
            "autoRecognize",
          ),
        ],
      ],
      [
        "recordings",
        t("settings.ai.recordingsHeading"),
        [
          this.tile(
            dropdown(
              "speechService",
              t("settings.speechService.name"),
              t("settings.speechService.line"),
              speechServiceLabels(),
              ["transcribe", "transcription", "speech to text", "Whisper", "Groq", "audio"],
            ),
            "audio-lines",
          ),
          this.tile(
            {
              ...controlRow(
                t("settings.speechServiceModel.name"),
                t("settings.ai.empty", { model: speechModel }),
                { type: "text", key: "speechServiceModel", placeholder: speechModel },
              ),
              visible: speechOnline,
            },
            "cpu",
          ),
          this.tile(
            {
              ...controlRow(
                t("settings.speechBaseUrl.name"),
                t("settings.speechBaseUrl.line"),
                {
                  type: "text",
                  key: "speechBaseUrl",
                  placeholder: settings.llmBaseUrl || "http://localhost:8000/v1",
                },
                ["Speaches", "faster-whisper", "self-hosted"],
              ),
              visible: speechService === "custom",
            },
            "server",
          ),
          this.tile(
            drawnRow(
              speechKeyName,
              this.keyLine(speechOnline ? speechService : "groq"),
              (s) => {
                if (isOnlineSpeechService(speechService)) this.renderKeyRow(s, speechService);
              },
              ["transcription key", "Groq key"],
              speechOnline && speechService !== vendor,
            ),
            "key-round",
          ),
        ],
      ],
      [
        "ask",
        t("settings.ai.askHeading"),
        [
          this.art(
            toggle(
              "askAttachPage",
              t("settings.askAttachPage.name"),
              t("settings.askAttachPage.line"),
              ["attach page", "current page", "Ask AI", "chat"],
            ),
            "askPage",
          ),
          {
            ...this.tile(
              toggle(
                "openRouterSkipCompressed",
                t("settings.openRouterSkipCompressed.name"),
                t("settings.openRouterSkipCompressed.line"),
                ["provider", "quantization", "fp4", "fp8", "OpenRouter"],
              ),
              "minimize-2",
            ),
            visible: () => settings.llmVendor === "openrouter",
          },
        ],
      ],
      [
        "pictures",
        t("settings.ai.picturesHeading"),
        [
          this.tile(
            dropdown(
              "imageVendor",
              t("settings.imageVendor.name"),
              t("settings.imageVendor.line"),
              imageVendorLabels(),
              ["generate image", "picture", "DALL-E", "GPT Image", "Nano Banana"],
            ),
            "image",
          ),
          callout({ title: `${imageUnsupportedReason(imageVendor)}.` }, !makesImages),
          this.tile(
            {
              ...controlRow(
                t("settings.imageModel.name"),
                makesImages ? t("settings.ai.empty", { model: imageModel }) : "",
                {
                  type: "text",
                  key: "imageModel",
                  placeholder: imageModel,
                },
              ),
              visible: makesImages,
            },
            "cpu",
          ),
          this.tile(
            drawnRow(
              imageKeyName,
              this.keyLine(imageVendor),
              (s) => this.renderKeyRow(s, imageVendor),
              ["image key"],
              makesImages && imageVendor !== vendor,
            ),
            "key-round",
          ),
        ],
      ],
    ]);
  }
  /** Whether a model learned from the user's handwriting is on this device. */
  private ownModelHere(): boolean {
    return this.learningState?.files.current ?? false;
  }

  /**
   * Reading handwriting on this device, which model reads (none, Grape, or
   * the one learned from the user's own writing: one choice where there were
   * two switches in two places), and while one does, what else reads with
   * it; then the models themselves: the voice model (Whisper), Grape
   * (the handwriting recognizer model), the model learned from the user's
   * handwriting and the OCR reader, each one row with its state after a dot,
   * Download while it is missing and the rest in its ⋯ menu. A model a
   * feature registered that is none of these is listed at the end.
   */
  private readingGroups(): SettingDefinitionItem[] {
    const { settings } = this.plugin;
    const reading = (): boolean => settings.handwritingOnDevice !== false;
    // Whether "Your model" is offered depends on the files: the tab is
    // rebuilt once they are read. Only while the tab is on screen: Obsidian
    // also asks for the rows when the plugin loads, for its search, and
    // state read then would be shown, out of date, when the tab opens.
    if (this.containerEl.isConnected) this.loadLearning();
    const readers = readerNames();
    const choices: Record<string, string> = { off: readers.off, grape: readers.grape };
    if (this.ownModelHere()) choices.mine = readers.mine;
    const grape = this.plugin.grape.model;
    const speech = this.plugin.speech.store();
    // The OCR models have their own rows below, not one row each here.
    const ocrIds = new Set(OCR_TIERS.map((t) => t.asset.id));
    const others = this.plugin.models
      .all()
      .filter((s) => s !== grape && s !== speech && !ocrIds.has(s.asset.id));
    const mobile = Platform.isMobile;
    const voice = speechModelInfo(effectiveSpeechModel(settings.speechModel, mobile)).label;
    const ocrTier = effectiveOcrTier(settings.ocrModel, mobile);
    const ocrStore = this.plugin.models.get(ocrTier.asset.id);
    return this.sectionGroups("reading", [
      [
        "handwriting",
        t("settings.reading.handwritingHeading"),
        [
          this.art(
            // One choice stored as two switches: getControlValue and
            // storeControlValue read and write both under this key.
            controlRow(
              t("settings.readWith.name"),
              t("settings.readWith.line"),
              { type: "dropdown", key: "handwritingOnDevice", options: choices },
              [
                "read handwriting on this device",
                "read with my model",
                "handwriting model",
                "handwriting",
                "recognition",
                "grape",
                "learned",
                "search",
                "offline",
              ],
            ),
            "readWith",
          ),
          {
            ...this.art(
              toggle(
                "checkHandwrittenWords",
                t("settings.checkWords.name"),
                t("settings.checkWords.line"),
                ["handwriting", "spelling", "correct", "misread", "underline"],
              ),
              "underline",
            ),
            visible: reading,
          },
          {
            ...this.art(
              toggle("calcNotes", t("settings.calcNotes.name"), t("settings.calcNotes.line"), [
                "calculation notes",
                "calculate",
                "calculator",
                "maths",
                "math",
                "sum",
                "equals",
                "answer",
              ]),
              "calc",
            ),
            visible: reading,
          },
          this.tile(
            drawnRow(
              t("settings.learn.name"),
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
            "graduation-cap",
          ),
        ],
      ],
      [
        "models",
        t("settings.models.heading"),
        [
          block((el) =>
            el.createDiv({
              cls: "goodobsidian-models-intro",
              text: t("settings.models.intro"),
            }),
          ),
          this.tile(
            drawnRow(
              t("settings.models.voiceRow", { voice }),
              "",
              (s) => this.drawDownload(s, speech),
              [
                "voice model",
                "audio",
                "speech",
                "whisper",
                "transcribe",
                "model",
                "download",
                "offline",
              ],
            ),
            "mic",
          ),
          this.tile(
            drawnRow(
              t("settings.speech.name"),
              t("settings.speech.line"),
              (s) => this.drawSpeechChoices(s),
              [
                "voice model size",
                "spoken language",
                "audio",
                "speech",
                "whisper",
                "transcribe",
                "offline",
              ],
            ),
            "audio-lines",
          ),
          this.tile(
            drawnRow(
              t("settings.models.grapeRow", { version: grape.asset.version }),
              "",
              (s) => this.drawDownload(s, grape),
              ["handwriting model", "grape", "recognition", "model", "download", "offline"],
            ),
            "grape",
          ),
          this.tile(
            drawnRow(
              t("settings.models.learnedName"),
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
            "signature",
          ),
          ...(ocrStore
            ? [
                this.tile(
                  drawnRow(
                    t("settings.models.ocrRow", { tier: ocrTier.label }),
                    "",
                    (s) => {
                      this.drawDownload(s, ocrStore);
                      s.addExtraButton((b) =>
                        b
                          .setIcon("trash-2")
                          .setTooltip(t("settings.models.removeOtherOcr"))
                          .onClick(() => void this.plugin.removeOtherOcrModels()),
                      );
                    },
                    ["ocr", "scan", "scanned", "model", "fast", "accurate", "download", "offline"],
                  ),
                  "scan-text",
                ),
              ]
            : []),
          ...others.map((store) =>
            this.tile(
              drawnRow(store.asset.label, "", (s) => this.drawDownload(s, store), [
                "model",
                "download",
                "offline",
                store.asset.id,
              ]),
              "box",
            ),
          ),
        ],
      ],
    ]);
  }
  /** Ideas, bugs, support and FineNotes' accounts: one line of links at the very end. */
  private footerRow(): SettingDefinition {
    return {
      name: t("settings.feedback.name"),
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
        const link = (
          label: string,
          key: string,
          url: string,
          icon?: string,
          iconOnly = false,
        ): void => {
          const button = row.createEl("button", {
            cls: `goodobsidian-footer-link clickable-icon is-${key}`,
          });
          if (icon) setIcon(button.createSpan({ cls: "goodobsidian-footer-icon" }), icon);
          if (iconOnly) button.setAttribute("aria-label", label);
          else button.createSpan({ text: label });
          button.addEventListener("click", () => window.open(url));
        };
        link(t("settings.feedback.ideas"), "ideas", COMMUNITY_LINKS.discussions, "lightbulb");
        link(t("settings.feedback.bug"), "report", COMMUNITY_LINKS.bugReport, "bug");
        link(t("settings.feedback.support"), "support", COMMUNITY_LINKS.support, "heart", true);
        for (const { label, url } of COMMUNITY_LINKS.social) {
          link(label, label.toLowerCase().split(" ")[0] ?? "", url);
        }
      },
    };
  }

  /** The voice model's size and spoken language, side by side. */
  private drawSpeechChoices(setting: Setting): void {
    const settings = this.plugin.settings;
    const mobile = Platform.isMobile;
    setting.addDropdown((d) => {
      for (const m of speechModelsFor(mobile)) {
        d.addOption(m.id, speechChoiceLabel(m.id, formatSize(totalBytes(speechAsset(m.id)))));
      }
      d.selectEl.setAttribute("aria-label", t("settings.speech.sizeLabel"));
      d.setValue(effectiveSpeechModel(settings.speechModel, mobile));
      d.onChange((value) => void this.setControlValue("speechModel", value));
    });
    setting.addDropdown((d) => {
      for (const l of SPEECH_LANGUAGES) d.addOption(l.code, l.name);
      d.selectEl.setAttribute("aria-label", t("settings.speech.languageLabel"));
      d.setValue(settings.speechLanguage ?? SPEECH_LANGUAGES[0].code);
      d.onChange((value) => void this.setControlValue("speechLanguage", value));
    });
  }

  /**
   * The stylus side button: what it does while the pen writes, and what a
   * click of it does with the pen held above the page. The Apple Pencil has
   * no side button to click (`stylus-click.ts`), so an iPhone or iPad gets
   * the first only.
   */
  private drawSideButton(setting: Setting): void {
    const settings = this.plugin.settings;
    setting.addDropdown((d) => {
      for (const [id, name] of Object.entries(barrelNames())) d.addOption(id, name);
      d.selectEl.setAttribute("aria-label", t("settings.barrel.whileWriting"));
      d.setValue(String(shownValue(settings, "barrelButton")));
      d.onChange((value) => void this.setControlValue("barrelButton", value));
    });
    if (Platform.isIosApp) return;
    setting.addDropdown((d) => {
      for (const [id, name] of Object.entries(stylusClickNames())) d.addOption(id, name);
      d.selectEl.setAttribute("aria-label", t("settings.stylusClick.name"));
      d.setValue(String(shownValue(settings, "stylusButtonClick")));
      d.onChange((value) => void this.setControlValue("stylusButtonClick", value));
    });
  }

  /** The chrome's style and colours (`model/look.ts`). */
  private drawStyle(setting: Setting): void {
    const settings = this.plugin.settings;
    setting.addDropdown((d) => {
      for (const [id, name] of Object.entries(lookStyleNames())) d.addOption(id, name);
      d.selectEl.setAttribute("aria-label", t("settings.look.styleLabel"));
      d.setValue(lookStyleOf(settings.lookStyle));
      d.onChange((value) => {
        settings.lookStyle = value;
        void this.wearLook();
      });
    });
  }

  private drawPalette(setting: Setting): void {
    const settings = this.plugin.settings;
    setting.addDropdown((d) => {
      for (const [id, name] of Object.entries(lookPaletteNames())) d.addOption(id, name);
      d.selectEl.setAttribute("aria-label", t("settings.look.paletteLabel"));
      d.setValue(lookPaletteOf(settings.lookPalette));
      d.onChange((value) => {
        settings.lookPalette = value;
        void this.wearLook();
      });
    });
  }

  private async wearLook(): Promise<void> {
    this.plugin.applyLook();
    this.syncStatuses();
    await this.plugin.saveSettings();
  }

  /** The interface language: stored, its table fetched, and the tab drawn in it. */
  private drawLanguage(setting: Setting): void {
    drawLanguageRow(setting, {
      chosen: () => this.plugin.settings.interfaceLanguage,
      choose: async (code) => {
        this.plugin.settings.interfaceLanguage = code;
        await this.plugin.saveSettings();
        return this.plugin.language.apply();
      },
      redraw: () => this.update(),
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
        this.addMenuButton(setting, t("settings.models.redownloadOrRemove"), [
          {
            title: t("settings.models.redownload"),
            icon: "refresh-cw",
            run: () => {
              this.plugin.modelReleased(store.asset.id);
              return store.redownload();
            },
          },
          {
            title: t("common.remove"),
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
          .setButtonText(
            state.kind === "failed" ? t("common.retry") : t("settings.models.download"),
          )
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
    // A narrow pane opens on the list the next time.
    this.containerEl.removeClass("is-section-open");
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
      modelStatus(setting, t("settings.models.looking"), "busy");
      return;
    }
    const { settings } = this.plugin;
    const record = learnedRecord(settings, this.plugin.grape.id);
    const inUse = settings.useLearnedHandwriting !== false;
    const badge = learnedBadge(record, learning.files.current, inUse);
    const status = learning.files.current
      ? t("settings.models.withSize", {
          status: badge.text,
          size: formatSize(learning.files.bytes),
        })
      : badge.text;
    modelStatus(setting, status, badge.tone);
    const entries: MenuEntry[] = [];
    if (learning.files.previous) {
      entries.push({
        title: t("settings.models.goBack"),
        icon: "undo-2",
        run: () => this.swapLearned(),
      });
    }
    if (learning.files.current || learning.files.previous || record) {
      entries.push({
        title: t("settings.models.deleteEllipsis"),
        icon: "trash-2",
        warning: true,
        run: () => this.deleteLearned(),
      });
    }
    if (entries.length > 0)
      this.addMenuButton(setting, t("settings.models.previousOrDelete"), entries);
  }

  /**
   * "Learn your handwriting": how far it has come, and one button that opens
   * the Learn your handwriting window, named for its next step (Write sheet
   * 1, Learn now). While a run is on it shows the progress, filling up as a
   * bar; Stop is in the window. Closing the settings leaves a run going.
   */
  private drawLearnRow(setting: Setting): void {
    setting.settingEl.addClass("goodobsidian-learn-step");
    const learning = this.learningState;
    if (!learning) {
      this.loadLearning();
      return;
    }
    const learner = this.plugin.learner;
    setting.setDesc(learnSummary(learning.sheets, PRACTICE_SETS.length));
    // One button: the window's next step, which it opens (view/learn-window.ts).
    setting.addButton((open) => {
      open.buttonEl.addClass("goodobsidian-learn-button");
      // Filled, as the next step; while a run is on, the bar fills it instead.
      open.setCta();
      open.onClick(() => {
        this.plugin.closeSettings();
        this.plugin.openLearnWindow();
      });
      const show = (): void => {
        const progress = learner.progress;
        const view = learnWindow({
          sheets: learning.sheets,
          sets: PRACTICE_SETS.length,
          corrections: learning.answeredAt.length,
          run: progress,
          result: null,
          symbolsWanted: false,
          now: Date.now(),
        });
        const next = view.buttons.find((button) => button.cta) ?? view.buttons[0];
        open.setButtonText(
          progress
            ? progressLabel(progress, Date.now())
            : (next?.label ?? t("settings.learn.open")),
        );
        open.buttonEl.toggleClass("mod-cta", progress === null);
        open.buttonEl.setCssProps({
          "--gob-learn-progress": progress
            ? `${Math.round((100 * progress.step) / progress.steps)}%`
            : "0%",
        });
        open.buttonEl.toggleClass("is-learning", progress !== null);
      };
      let running = learner.progress !== null;
      const unsubscribe = learner.subscribe(() => {
        // The tab was closed or redrawn: this row is gone.
        if (!open.buttonEl.isConnected) {
          unsubscribe();
          return;
        }
        const now = learner.progress !== null;
        // A run ended: the model and its sheets change with it.
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
      title: t("settings.models.deleteTitle"),
      message: deleteQuestion(record, this.learningState?.files.previous ?? false),
      cta: t("common.delete"),
      warning: true,
    });
    if (!yes) return;
    await deleteLearnedModel(host);
    this.reloadLearning();
  }

  // --- Rows the tab draws itself ---------------------------------------------

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
        this.syncStatuses();
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
      text: paperWidthError(),
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
      button
        .setButtonText(
          connected ? t("settings.openRouter.reconnect") : t("settings.openRouter.connect"),
        )
        .setCta();
      button.onClick(() => void this.plugin.startOpenRouterConnect());
    });
  }

  /** "New notebooks go in" (0.5): a text field with folder type-ahead. */
  /** The two published shortcuts: each opens its iCloud page, where Shortcuts adds it. */
  private drawShortcutLinks(setting: Setting): void {
    setting.addExtraButton((button) =>
      button
        .setIcon(ICON_NEW_NOTEBOOK)
        .setTooltip(t("settings.shortcutsApp.addNotebook"))
        .onClick(() => window.open(SHORTCUT_NEW_NOTEBOOK_URL)),
    );
    setting.addExtraButton((button) =>
      button
        .setIcon("file-input")
        .setTooltip(t("settings.shortcutsApp.addPdf"))
        .onClick(() => window.open(SHORTCUT_PDF_URL)),
    );
  }

  private drawNotebookFolder(setting: Setting): void {
    setting.addText((text) => {
      text
        .setPlaceholder(t("settings.notebookFolder.placeholder"))
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

  /** A key row's one line: where the key lives and where it goes. */
  private keyLine(slot: KeySlot): string {
    if (slotService(slot).userEndpoint) return t("settings.key.endpointLine");
    const service = slotService(slot).label;
    return this.plugin.keys.secure
      ? t("settings.key.keychainLine", { service })
      : t("settings.key.vaultLine", { service });
  }

  /**
   * A key's status with Add / Replace / Remove. The key itself is never put
   * back on screen — not even masked in a field, where it could be copied out.
   */
  private renderKeyRow(setting: Setting, slot: KeySlot): void {
    const set = this.plugin.apiKeyFor(slot) !== "";
    const optional = slotService(slot).userEndpoint;
    setting.controlEl.createSpan({
      cls: `goodobsidian-key-status${set ? " is-set" : ""}`,
      text: set
        ? t("settings.key.set")
        : optional
          ? t("settings.key.notSetOptional")
          : t("settings.key.notSet"),
    });
    setting.addButton((button) => {
      button
        .setButtonText(set ? t("settings.key.replace") : t("settings.key.add"))
        .onClick(() => this.promptForKey(slot));
      if (!set && !optional) button.setCta();
    });
    if (set) {
      // Not styled as destructive: `setWarning` is deprecated, and the
      // confirmation says what removing does.
      setting.addButton((button) => {
        button.setButtonText(t("common.remove")).onClick(() => void this.removeKey(slot));
      });
    }
  }

  private promptForKey(slot: KeySlot): void {
    new ApiKeyModal(this.app, {
      title: slotService(slot).userEndpoint
        ? t("settings.ai.endpointKey")
        : t("settings.ai.keyName", { service: slotService(slot).label }),
      placeholder: slotService(slot).userEndpoint ? t("settings.key.usuallyEmpty") : "sk-…",
      where: this.plugin.keys.secure
        ? t("settings.key.whereKeychain")
        : t("settings.key.whereVault"),
      onSave: (key) => {
        // Entering a key by hand invalidates any in-flight OpenRouter connect,
        // so a stale browser approval cannot overwrite it later.
        if (!slotService(slot).userEndpoint) this.plugin.cancelOpenRouterConnect();
        this.plugin.storeApiKey(slot, key);
        this.refresh();
      },
    }).open();
  }

  private async removeKey(slot: KeySlot): Promise<void> {
    const sure = await ConfirmModal.confirm(this.app, {
      title: slotService(slot).userEndpoint
        ? t("settings.key.removeEndpointTitle")
        : t("settings.key.removeTitle", { service: slotService(slot).label }),
      message: t("settings.key.removeMessage"),
      cta: t("common.remove"),
    });
    if (!sure) return;
    this.plugin.removeApiKey(slot);
    this.refresh();
  }
}
