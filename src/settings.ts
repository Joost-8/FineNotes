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
} from "./view/handwriting-learning";
import {
  type PracticeSheet,
  deleteQuestion,
  learnInfoText,
  learnSummary,
  learnedBadge,
  learnedResult,
  learnedStatus,
  newCorrections,
  undoText,
} from "./recognition/hwr/learned-model";
import { PRACTICE_SETS } from "./recognition/practice";
import { PLUGIN_PAGE_URL } from "./model/update-check";
import { t } from "./i18n/translate";
import { LANGUAGE_ALIASES, drawLanguageRow } from "./view/language-row";
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
import { ICON_NEW_NOTEBOOK, SIZES } from "./constants";
import { SHORTCUT_NEW_NOTEBOOK_URL, SHORTCUT_PDF_URL } from "./model/inbox";
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
  type GoodObsidianSettings,
  PAPER_WIDTH_RANGE,
  type PageAppearance,
  type SettingsSection,
  changesTabLayout,
  endpointWarning,
  handwritingReaderOf,
  paperWidthFrom,
  parseColorList,
  sectionOpen,
  shownValue,
  storeShownValue,
  withSection,
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

export { DEFAULT_SETTINGS, type GoodObsidianSettings, type ToolId } from "./settings-data";

type SettingKey = keyof GoodObsidianSettings;
type Visible = boolean | (() => boolean);

// --- Wording -----------------------------------------------------------------

/** A callout's one line, and what its ⓘ opens if the line needs more. */
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
    none: t("settings.stylusClick.none"),
  };
}

/** Shortcuts → More: the actions after the tools, in this order. */
const SHORTCUT_MORE_ORDER: readonly ShortcutGroupKey[] = [
  "toolbar.shortcut.group.selectionEditing",
  "toolbar.shortcut.group.viewZoom",
  "toolbar.shortcut.group.tools",
  "toolbar.shortcut.group.savedPens",
];

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

/** What each on-device model is and does: the start of its row's ⓘ. */
function modelPurpose() {
  return {
    voice: t("settings.models.purpose.voice"),
    grape: t("settings.models.purpose.grape"),
    ocr: t("settings.models.purpose.ocr"),
    learned: t("settings.models.purpose.learned"),
  };
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
  button.setAttribute("aria-label", t("settings.moreAbout"));
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
 * description. A row that has one keeps it and takes the new text. When
 * Obsidian draws the row again (each `update()`), `setName` empties the
 * name and takes the button with it, and the old text stays behind: both
 * are made again, so the ⓘ says what the row says now.
 */
export function addInfo(settingEl: HTMLElement, text: string): void {
  const nameEl = settingEl.querySelector<HTMLElement>(".setting-item-name");
  const infoEl = settingEl.querySelector<HTMLElement>(".setting-item-info");
  if (!nameEl || !infoEl) return;
  const more = infoEl.querySelector<HTMLElement>(".goodobsidian-info-text");
  if (more && nameEl.querySelector(".goodobsidian-info")) {
    if (more.textContent !== text) more.setText(text);
    return;
  }
  more?.remove();
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

/** Advanced: where notebooks without a folder of their own save each kind of file. */
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
      t("settings.folders.recordings.desc"),
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

  /** Give every drawn row that has an ⓘ text its button, with the text it has now. */
  private decorate(): void {
    for (const el of Array.from(this.containerEl.querySelectorAll<HTMLElement>(".setting-item"))) {
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
      chevron.setAttribute(
        "aria-label",
        open ? t("settings.section.fold", { heading }) : t("settings.section.unfold", { heading }),
      );
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
      t("common.more"),
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
    if (key === "handwritingOnDevice") {
      return handwritingReaderOf(this.plugin.settings, this.ownModelHere());
    }
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
   * Above every section: a newer FineNotes, while one is out, with Obsidian's
   * own Update a tap away; and the iPad's Scribble, which loses strokes,
   * until its ✕.
   */
  private topRows(): SettingDefinition[] {
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
        close.setAttribute("aria-label", t("common.dismiss"));
        close.addEventListener("click", () => {
          this.plugin.settings.scribbleTipDismissed = true;
          void this.plugin.saveSettings();
          this.refreshDomState();
        });
      }, shown),
      // Below the notices, above the sections: found without opening one.
      this.info(
        drawnRow(t("language.name"), "", (s) => this.drawLanguage(s), LANGUAGE_ALIASES),
        t("language.info"),
      ),
      this.info(
        toggle("simpleLook", t("settings.simpleLook.name"), "", [
          "simple",
          "look",
          "hide",
          "sidebar",
          "ribbon",
        ]),
        t("settings.simpleLook.info"),
      ),
    ];
  }

  /** How the pen, the tools and the gestures behave, and what a new note starts with. */
  private writingGroup(): SettingDefinitionItem {
    const settings = this.plugin.settings;
    return this.section(
      "writing",
      t("settings.writing.heading"),
      "pencil",
      [
        drawnRow(t("settings.startWith.name"), "", (s) => this.drawStartWith(s), [
          "default tool",
          "default stroke size",
          "pen size",
          "line width",
          "default ink color",
          "pen color",
        ]),
        this.info(
          drawnRow(t("settings.savedPens.name"), "", (s) => this.drawSavedPensRow(s), [
            "favorite pens",
            "presets",
            "number key",
            "add pen",
            "new pen",
            "restore defaults",
          ]),
          t("settings.savedPens.info"),
        ),
        ...savedPensOf(settings.savedPens).map((pen, index) =>
          drawnRow(savedPenLabel(pen), "", (s) => this.drawSavedPen(s, pen, index), [
            "saved pen",
            "preset",
            "edit pen",
            "delete pen",
          ]),
        ),
        toggle(
          "fingerTapUndo",
          t("settings.fingerTapUndo.name"),
          t("settings.fingerTapUndo.desc"),
          ["undo", "redo", "gesture", "fingers", "tap"],
        ),
        this.more(
          "writing",
          Platform.isMobile
            ? t("settings.writing.more.mobile")
            : t("settings.writing.more.desktop"),
        ),
        this.info(
          toggle("textDragSize", t("settings.textDragSize.name"), "", [
            "text",
            "text box",
            "size",
            "drag",
          ]),
          t("settings.textDragSize.info"),
        ),
        this.info(
          drawnRow(t("settings.customColors.name"), "", (s) => this.drawCustomColors(s), [
            "palette",
          ]),
          t("settings.customColors.info"),
        ),
        this.info(
          toggle("lassoTouches", t("settings.lassoTouches.name"), "", [
            "lasso",
            "select",
            "selection",
            "notability",
          ]),
          t("settings.lassoTouches.info"),
        ),
        {
          ...this.info(
            dropdown("penCursor", t("settings.penCursor.name"), "", penCursorNames(), [
              "cursor",
              "pointer",
              "crosshair",
            ]),
            t("settings.penCursor.info"),
          ),
          visible: !Platform.isMobile,
        },
      ],
      () => [
        {
          text: t("settings.writing.status", {
            tool: toolNames()[settings.defaultTool] ?? toolNames().pen,
            width: defaultWidthText(settings.defaultTool, settings.defaultSize),
          }),
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
      SHORTCUT_ACTIONS.filter((action) => action.groupKey === group && !tools.includes(action)),
    );
    return this.section(
      "shortcuts",
      t("settings.shortcuts.heading"),
      "keyboard",
      [
        block(
          (el) => this.drawShortcutConflicts(el),
          () => this.plugin.shortcuts.table.conflicts.length > 0,
        ),
        ...tools.map((action) => this.shortcutRow(action)),
        this.info(
          dropdown("barrelButton", t("settings.barrel.name"), "", barrelNames(), [
            "barrel button",
            "pen tablet",
            "wacom",
            "stylus",
          ]),
          t("settings.barrel.info"),
        ),
        {
          ...this.info(
            dropdown("stylusButtonClick", t("settings.stylusClick.name"), "", stylusClickNames(), [
              "barrel click",
              "s pen",
              "pen menu",
              "stylus",
            ]),
            t("settings.stylusClick.info"),
          ),
          // The Apple Pencil has no side button (`stylus-click.ts`).
          visible: !Platform.isIosApp,
        },
        this.more("shortcuts", t("settings.shortcuts.more")),
        ...rest.map((action) => this.shortcutRow(action)),
        this.info(
          drawnRow(t("settings.shortcuts.resetAll"), "", (s) => this.drawResetShortcuts(s), [
            "restore keys",
            "default keys",
            "hotkeys",
          ]),
          t("settings.shortcuts.info"),
        ),
      ],
      () => {
        const table = this.plugin.shortcuts.table;
        if (table.conflicts.length > 0) {
          return [{ text: t("settings.shortcuts.clash"), tone: "failed" }];
        }
        return table.customized > 0
          ? [{ text: t("settings.shortcuts.changed", { count: table.customized }) }]
          : [];
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
    const line = box.createDiv({
      cls: "goodobsidian-callout-title",
      text: t("settings.shortcuts.conflict"),
    });
    infoToggle(line, box, t("settings.shortcuts.conflictDetail", { conflicts: detail }));
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

  /** The paper, and where new notebooks go and how they are made. */
  private pagesGroup(): SettingDefinitionItem {
    const settings = this.plugin.settings;
    return this.section(
      "pages",
      t("settings.pages.heading"),
      "file-text",
      [
        this.info(
          dropdown("pageAppearance", t("settings.pageAppearance.name"), "", pageAppearances(), [
            "dark mode",
            "night mode",
            "invert",
            "theme",
          ]),
          t("settings.pageAppearance.info"),
        ),
        drawnRow(
          t("settings.paperWidth.name"),
          t("settings.paperWidth.desc"),
          (s) => this.drawPaperWidth(s),
          ["canvas size", "page width"],
        ),
        this.more("pages", t("settings.pages.more")),
        this.info(
          drawnRow(t("settings.notebookFolder.name"), "", (s) => this.drawNotebookFolder(s), [
            "default folder for new notebooks",
            "folder",
            "location",
            "new notebook",
            "new page",
          ]),
          t("settings.notebookFolder.info"),
        ),
        // Shortcuts exist on Apple devices only.
        ...(this.apple
          ? [
              this.info(
                drawnRow(t("settings.shortcutsApp.name"), "", (s) => this.drawShortcutLinks(s), [
                  "shortcuts",
                  "share sheet",
                  "home screen",
                  "pdf",
                  "inbox",
                ]),
                t("settings.shortcutsApp.info"),
              ),
            ]
          : []),
        this.info(
          toggle("notebookOwnFolder", t("settings.notebookOwnFolder.name"), "", [
            "folder",
            "own folder",
            "new notebook",
            "attachments",
          ]),
          t("settings.notebookOwnFolder.info"),
        ),
        this.info(
          controlRow(
            t("settings.stickerFolder.name"),
            "",
            { type: "text", key: "stickerFolder", placeholder: DEFAULT_STICKER_FOLDER },
            ["sticker", "collection", "folder"],
          ),
          t("settings.stickerFolder.info"),
        ),
        this.info(
          controlRow(
            t("settings.templateFolder.name"),
            "",
            { type: "text", key: "templateFolder", placeholder: DEFAULT_TEMPLATE_FOLDER },
            ["template", "folder", "share"],
          ),
          t("settings.templateFolder.info"),
        ),
        this.info(
          controlRow(
            t("settings.templateGallery.name"),
            "",
            {
              type: "text",
              key: "templateGalleryUrl",
              placeholder: t("settings.templateGallery.placeholder"),
            },
            ["template", "gallery", "community", "share"],
          ),
          t("settings.templateGallery.info"),
        ),
        this.info(
          toggle("showNewNotebookInContextMenu", t("settings.newNotebookContextMenu.name"), "", [
            "context menu",
            "file explorer",
            "new notebook",
          ]),
          t("settings.newNotebookContextMenu.info"),
        ),
        this.info(
          toggle("showNewNotebookInExplorer", t("settings.libraryExplorer.name"), "", [
            "toolbar",
            "file explorer",
            "library",
            "new notebook",
          ]),
          t("settings.libraryExplorer.info"),
        ),
        this.info(
          toggle("folderNotebooks", t("settings.folderNotebooks.name"), "", [
            "file explorer",
            "folder",
            "folder note",
            "icons",
          ]),
          t("settings.folderNotebooks.info"),
        ),
      ],
      () => [
        {
          text: t("settings.pages.status", {
            appearance: pageAppearances()[settings.pageAppearance] ?? pageAppearances().light,
            width: settings.paperWidth,
          }),
        },
      ],
    );
  }

  /** Rendering, input and files: the switches most people never need. */
  private advancedGroup(): SettingDefinitionItem {
    const settings = this.plugin.settings;
    return this.section(
      "advanced",
      t("settings.advanced.heading"),
      "sliders-horizontal",
      [
        this.info(
          toggle("pressureWidth", t("settings.pressure.name"), "", [
            "pressure sensitivity",
            "stylus",
            "Apple Pencil",
            "fountain pen",
            "brush pen",
          ]),
          t("settings.pressure.info"),
        ),
        callout(callouts().pressure, () => settings.pressureWidth),
        this.info(
          toggle("pencilTilt", t("settings.pencilTilt.name"), "", [
            "tilt",
            "shading",
            "Apple Pencil",
            "stylus",
            "brush pen",
          ]),
          t("settings.pencilTilt.info"),
        ),
        this.info(
          toggle("holdFitWidth", t("settings.holdFitWidth.name"), "", [
            "fit to width",
            "double tap",
            "scroll sideways",
            "snap",
          ]),
          t("settings.holdFitWidth.info"),
        ),
        this.info(
          toggle("desynchronizedCanvas", t("settings.desynchronized.name"), "", [
            "latency",
            "glitch",
            "artifacts",
          ]),
          t("settings.desynchronized.info"),
        ),
        this.info(
          dropdown("checkForUpdates", t("settings.updates.name"), "", updateChoices(), [
            "check for updates",
            "new version",
            "release",
            "notification",
            "reminder",
          ]),
          t("settings.updates.info"),
        ),
        this.info(
          toggle("debugHud", t("settings.debugHud.name"), "", [
            "diagnostics",
            "HUD",
            "troubleshooting",
            "support",
          ]),
          t("settings.debugHud.info"),
        ),
        this.info(
          controlRow(
            t("settings.hwrModelFile.name"),
            "",
            { type: "text", key: "hwrModelPath", placeholder: "FineNotes/finenotes-hwr.bin" },
            ["handwriting", "recognition", "model"],
          ),
          t("settings.hwrModelFile.info"),
        ),
        this.more("advanced", t("settings.advanced.more")),
        ...folderRows().map(([key, name, desc, placeholder]) =>
          this.info(
            controlRow(name, "", { type: "text", key, placeholder }, [
              "folder",
              "attachments",
              "where files are saved",
            ]),
            t("settings.folders.info", { desc, note: t("settings.folders.note") }),
          ),
        ),
      ],
      () => [
        ...(settings.pressureWidth ? [{ text: t("settings.advanced.pressureOn") }] : []),
        ...(settings.pencilTilt ? [{ text: t("settings.advanced.tiltOn") }] : []),
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
    const keyName = custom
      ? t("settings.ai.endpointKey")
      : t("settings.ai.keyName", { service: VENDORS[vendor].label });
    const imageKeyName = t("settings.ai.imageKeyName", { service: VENDORS[imageVendor].label });

    const rows: SettingDefinition[] = [
      this.info(
        dropdown("llmVendor", t("settings.ai.service.name"), "", VENDOR_LABELS, [
          "Anthropic",
          "Claude",
          "OpenAI",
          "GPT",
          "Gemini",
          "OpenRouter",
          "Cloud AI",
        ]),
        t("settings.ai.service.info"),
      ),
      this.info(
        drawnRow(
          t("settings.ai.endpointUrl.name"),
          "",
          (s) => this.drawEndpointUrl(s),
          ["self-hosted", "local server"],
          usingEndpoint,
        ),
        t("settings.ai.endpointUrl.info"),
      ),
      callout(callouts().incompleteUrl, endpointShows("incomplete")),
      callout(callouts().plainHttp, endpointShows("plain-http")),
      this.info(
        drawnRow(
          t("settings.openRouter.name"),
          "",
          (s) => this.drawOpenRouterConnect(s),
          undefined,
          () => VENDORS[settings.llmVendor].oauthConnect,
        ),
        t("settings.openRouter.info"),
      ),
      this.info(
        controlRow(
          t("settings.aiModel.name"),
          t("settings.ai.empty", { model: DEFAULT_MODELS[vendor] }),
          {
            type: "text",
            key: "llmModel",
            placeholder: DEFAULT_MODELS[vendor],
          },
        ),
        t("settings.aiModel.info", { model: DEFAULT_MODELS[vendor] }),
      ),
      this.info(
        drawnRow(keyName, "", (s) => this.renderKeyRow(s, vendor), ["token", "secret", "API key"]),
        this.keyDesc(vendor, "text"),
      ),
      callout(callouts().noKeychain, !this.plugin.keys.secure),
      this.info(
        dropdown("recognitionProviderId", t("settings.recognition.name"), "", providers, [
          "OCR",
          "handwriting to text",
        ]),
        t("settings.recognition.info"),
      ),
      {
        ...this.info(
          toggle("autoRecognize", t("settings.autoRecognize.name"), "", ["auto recognition"]),
          t("settings.autoRecognize.info"),
        ),
        visible: () => settings.recognitionProviderId === LLM_PROVIDER_ID,
      },
      // OpenRouter's providers and pictures are the AI rows fewest people change.
      this.more(
        "ai",
        vendor === "openrouter" ? t("settings.ai.more.openrouter") : t("settings.ai.more.other"),
      ),
      this.info(
        toggle("askAttachPage", t("settings.askAttachPage.name"), "", [
          "attach page",
          "current page",
          "Ask AI",
          "chat",
        ]),
        t("settings.askAttachPage.info"),
      ),
      {
        ...this.info(
          toggle("openRouterSkipCompressed", t("settings.openRouterSkipCompressed.name"), "", [
            "provider",
            "quantization",
            "fp4",
            "fp8",
            "OpenRouter",
          ]),
          t("settings.openRouterSkipCompressed.info"),
        ),
        visible: () => settings.llmVendor === "openrouter",
      },
      this.info(
        dropdown("imageVendor", t("settings.imageVendor.name"), "", imageVendorLabels(), [
          "generate image",
          "picture",
          "DALL-E",
          "GPT Image",
          "Nano Banana",
        ]),
        t("settings.imageVendor.info"),
      ),
      callout({ title: `${imageUnsupportedReason(imageVendor)}.` }, !makesImages),
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
      t("settings.ai.heading"),
      "sparkles",
      [
        ...this.handwritingRows(),
        drawnRow(
          t("settings.ai.setUp.name"),
          t("settings.ai.setUp.desc"),
          (setting) => this.drawAiFold(setting),
          ["API key", "AI", "transcribe"],
          folded,
        ),
        ...rows.map(fold),
      ],
      () => [
        {
          text: t("settings.ai.status", {
            reader: readerNames()[handwritingReaderOf(settings, this.ownModelHere())],
            service: folded() ? t("settings.ai.notSetUp") : VENDORS[settings.llmVendor].label,
          }),
        },
      ],
    );
  }

  /** Whether a model learned from the user's handwriting is on this device. */
  private ownModelHere(): boolean {
    return this.learningState?.files.current ?? false;
  }

  /**
   * Reading handwriting on this device, at the head of "AI and handwriting":
   * which model reads (none, Grape, or the one learned from the user's own
   * writing: one choice where there were two switches in two places), and
   * while one does, what else reads with it. The models themselves are
   * downloaded and managed under "Models on this device".
   */
  private handwritingRows(): SettingDefinition[] {
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
    return [
      this.info(
        // One choice stored as two switches: getControlValue and
        // storeControlValue read and write both under this key.
        controlRow(
          t("settings.readWith.name"),
          "",
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
        t("settings.readWith.info"),
      ),
      {
        ...this.info(
          toggle("checkHandwrittenWords", t("settings.checkWords.name"), "", [
            "handwriting",
            "spelling",
            "correct",
            "misread",
            "underline",
          ]),
          t("settings.checkWords.info"),
        ),
        visible: reading,
      },
      {
        ...this.info(
          toggle("calcNotes", t("settings.calcNotes.name"), "", [
            "calculation notes",
            "calculate",
            "calculator",
            "maths",
            "math",
            "sum",
            "equals",
            "answer",
          ]),
          t("settings.calcNotes.info"),
        ),
        visible: reading,
      },
      this.info(
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
        this.learnInfo(),
      ),
    ];
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

  // --- Models on this device ---------------------------------------------------

  /**
   * "Models on this device": the voice model (Whisper), Grape (the
   * handwriting recognizer model) and the model learned from the user's
   * handwriting, each one row with its state after a dot, Download while it
   * is missing and the rest in its ⋯ menu; what each is for is behind its
   * ⓘ. The OCR reader is one row for the chosen model, with its size choice
   * under it, shown while OCR is on. A model a feature registered that is none
   * of these is listed at the end.
   */
  private modelsGroup(): SettingDefinitionItem {
    const { settings } = this.plugin;
    const grape = this.plugin.grape.model;
    const speech = this.plugin.speech.store();
    // The OCR models have their own rows below, not one row each here.
    const ocrIds = new Set(OCR_TIERS.map((t) => t.asset.id));
    const others = this.plugin.models
      .all()
      .filter((s) => s !== grape && s !== speech && !ocrIds.has(s.asset.id));
    const reading = (): boolean => settings.handwritingOnDevice !== false;
    const learning = this.learningState;
    const record = learnedRecord(settings, this.plugin.grape.id);
    const onDevice = learning?.files.current ?? false;
    const mobile = Platform.isMobile;
    const download = t("settings.models.downloadsOnce");
    const purpose = modelPurpose();
    const voice = speechModelInfo(effectiveSpeechModel(settings.speechModel, mobile)).label;
    const ocrTier = effectiveOcrTier(settings.ocrModel, mobile);
    const ocrStore = this.plugin.models.get(ocrTier.asset.id);
    return this.section(
      "on-device",
      t("settings.models.heading"),
      "cpu",
      [
        block((el) =>
          el.createDiv({
            cls: "goodobsidian-models-intro",
            text: t("settings.models.intro"),
          }),
        ),
        this.info(
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
          t("settings.models.withDownload", { purpose: purpose.voice, download }),
        ),
        this.info(
          drawnRow(t("settings.speech.name"), "", (s) => this.drawSpeechChoices(s), [
            "voice model size",
            "spoken language",
            "audio",
            "speech",
            "whisper",
            "transcribe",
            "offline",
          ]),
          mobile ? t("settings.speech.info.mobile") : t("settings.speech.info.desktop"),
        ),
        this.info(
          drawnRow(
            t("settings.models.grapeRow", { version: grape.asset.version }),
            "",
            (s) => this.drawDownload(s, grape),
            ["handwriting model", "grape", "recognition", "model", "download", "offline"],
          ),
          t("settings.models.withDownload", { purpose: purpose.grape, download }),
        ),
        this.info(
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
          [
            purpose.learned,
            learnedStatus(record, onDevice, settings.useLearnedHandwriting !== false).text,
            record && onDevice ? learnedResult(record) : "",
            learning?.files.previous ? undoText(settings[previousKey(this.plugin.grape.id)]) : "",
          ]
            .filter(Boolean)
            .join(" "),
        ),
        ...(ocrStore
          ? [
              this.info(
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
                t("settings.models.withDownload", { purpose: purpose.ocr, download }),
              ),
            ]
          : []),
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
        { text: t("settings.models.statusVoice"), tone: stateTone(speech.state) },
        {
          text: t("settings.models.statusHandwriting"),
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

  /** Show or Hide: the AI group's rows, when no AI service is set up. */
  private drawAiFold(setting: Setting): void {
    setting.addButton((b) => {
      b.setButtonText(this.aiOpen ? t("settings.ai.hide") : t("settings.ai.show"));
      b.onClick(() => {
        this.aiOpen = !this.aiOpen;
        b.setButtonText(this.aiOpen ? t("settings.ai.hide") : t("settings.ai.show"));
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

  /** What a key row's ⓘ says about where the key lives and where it goes. */
  private keyDesc(slot: LlmVendor, use: "text" | "image"): string {
    if (VENDORS[slot].userEndpoint) {
      return t("settings.key.endpointInfo");
    }
    const secure = this.plugin.keys.secure;
    const service = VENDORS[slot].label;
    if (use === "image") {
      return secure
        ? t("settings.key.image.keychain", { service })
        : t("settings.key.image.vault", { service });
    }
    return secure
      ? t("settings.key.text.keychain", { service })
      : t("settings.key.text.vault", { service });
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

  private promptForKey(slot: LlmVendor): void {
    new ApiKeyModal(this.app, {
      title: VENDORS[slot].userEndpoint
        ? t("settings.ai.endpointKey")
        : t("settings.ai.keyName", { service: VENDORS[slot].label }),
      placeholder: VENDORS[slot].userEndpoint ? t("settings.key.usuallyEmpty") : "sk-…",
      where: this.plugin.keys.secure
        ? t("settings.key.whereKeychain")
        : t("settings.key.whereVault"),
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
    const sure = await ConfirmModal.confirm(this.app, {
      title: VENDORS[slot].userEndpoint
        ? t("settings.key.removeEndpointTitle")
        : t("settings.key.removeTitle", { service: VENDORS[slot].label }),
      message: t("settings.key.removeMessage"),
      cta: t("common.remove"),
    });
    if (!sure) return;
    this.plugin.removeApiKey(slot);
    this.refresh();
  }
}
