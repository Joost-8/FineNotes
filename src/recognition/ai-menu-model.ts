/**
 * What the AI menu offers, and why an entry is greyed out.
 *
 * Two sections: the handwriting reader on this device first (underlining
 * words it may have misread, learning the user's handwriting), which works
 * for everyone; then
 * the features that need the user's own AI key. Without a key that second
 * section is folded into one row ({@link aiKeyFolded}), so it does not get
 * in the way of someone who never set one up.
 *
 * The menu is a plain list of {@link AiMenuItem}s — id, label, icon, enabled,
 * a one-line reason — built here from the configuration, then given handlers
 * by id in the view. Adding a feature is one item here and one handler there;
 * "Transcribe recording" (audio) is meant to arrive exactly that way, using
 * {@link audioAvailability}.
 *
 * No DOM, no Obsidian.
 */

import { t, tn } from "../i18n/translate";
import { type ImageVendor, canGenerateImages, imageUnsupportedReason } from "./ai-image";
import { audioUnsupportedReason, canTranscribeAudio } from "./audio-request";
import { type LlmVendor, VENDORS, chatCompletionsUrl } from "./llm-request";

/** The image-generation setting: follow the text vendor, or a vendor of its own. */
export type ImageVendorChoice = "same" | ImageVendor;

export const IMAGE_VENDOR_CHOICES: readonly ImageVendorChoice[] = [
  "same",
  "openai",
  "google",
  "openrouter",
];

export interface AiSetup {
  /** The text/vision vendor: transcription and questions. */
  vendor: LlmVendor;
  /** The custom endpoint's base URL (only read for `custom`). */
  baseUrl: string;
  imageVendor: ImageVendorChoice;
  /** Whether a key is stored for a slot. */
  hasKey: (slot: LlmVendor) => boolean;
}

export interface Availability {
  enabled: boolean;
  /** Why not, in one line; "" when enabled. */
  reason: string;
}

const OK: Availability = { enabled: true, reason: "" };
const no = (reason: string): Availability => ({ enabled: false, reason });

/** "Needs an OpenAI key", "Needs a Google key" … for reasons; `forImages` adds " for images". */
function needsKey(vendor: LlmVendor, forImages: boolean): string {
  const name = VENDORS[vendor].label.replace(/\s*\(.*\)$/, "");
  const an = /^[AEIOU]/i.test(name);
  if (forImages) return t(an ? "ai.menu.needsKeyImagesAn" : "ai.menu.needsKeyImagesA", { name });
  return t(an ? "ai.menu.needsKeyAn" : "ai.menu.needsKeyA", { name });
}

function endpointUsable(baseUrl: string): boolean {
  try {
    chatCompletionsUrl(baseUrl);
    return true;
  } catch {
    return false;
  }
}

/** The vendor images are generated with. */
export function resolveImageVendor(choice: ImageVendorChoice, textVendor: LlmVendor): LlmVendor {
  return choice === "same" ? textVendor : choice;
}

/** Transcription and questions (a vision chat model). */
export function textAvailability(setup: AiSetup): Availability {
  const vendor = VENDORS[setup.vendor];
  if (vendor.userEndpoint) {
    return endpointUsable(setup.baseUrl) ? OK : no(t("ai.menu.needsEndpoint"));
  }
  return setup.hasKey(setup.vendor) ? OK : no(needsKey(setup.vendor, false));
}

/** Image generation, with whichever vendor the setting resolves to. */
export function imageAvailability(setup: AiSetup): Availability {
  const vendor = resolveImageVendor(setup.imageVendor, setup.vendor);
  if (!canGenerateImages(vendor)) return no(imageUnsupportedReason(vendor));
  return setup.hasKey(vendor) ? OK : no(needsKey(vendor, true));
}

/** Audio transcription with the text vendor (for the audio feature). */
export function audioAvailability(setup: AiSetup): Availability {
  if (!canTranscribeAudio(setup.vendor)) return no(audioUnsupportedReason(setup.vendor));
  return textAvailability(setup);
}

export type AiMenuId =
  | "check-words"
  | "learn"
  | "practice"
  | "device-settings"
  | "transcribe-recording"
  | "transcribe-device"
  | "transcribe-device-cancel"
  | "ask"
  | "generate-image"
  | "settings";

export interface AiMenuItem {
  /** Handler key. Built-ins are {@link AiMenuId}s; features may add their own. */
  id: string;
  label: string;
  /** Lucide icon name. */
  icon: string;
  enabled: boolean;
  /** Shown under a disabled entry. */
  reason: string;
  /** Shown under an enabled entry: where it stands. */
  detail?: string;
  /** Rendered below a divider, after the actions. */
  footer?: boolean;
  /** Which section: the on-device reader, or the features that need a key (the default). */
  section?: "device" | "key";
  /** A mark at the row's end: the reader still has to be downloaded. */
  mark?: "download";
  /** A switch rather than an action: its state. A tap flips it and leaves the menu open. */
  on?: boolean;
  /**
   * A choice rather than an action: its options, shown side by side, and
   * {@link value} the one picked. A tap picks one and leaves the menu open.
   */
  choices?: ReadonlyArray<{ id: string; label: string }>;
  value?: string;
}

/** The on-device reader's state, for its section of the menu. */
export interface DeviceReading {
  /** A model learned from the user's handwriting is in use. */
  learned: boolean;
  /** Practice files in the vault. */
  practiceFiles: number;
  /** A learning run's progress, 0..100, or null when none is running. */
  learning: number | null;
  /** Words it may have misread are underlined, to correct with a tap. */
  checkingWords: boolean;
  /** Lines that end in = are worked out and answered on the page. */
  calculating: boolean;
}

/** What reads handwriting on this device: nothing, Grape, or the model learned from the user's. */
export interface HandwritingReading {
  value: "off" | "grape" | "mine";
  /** A model learned from the user's handwriting is here, so "Mine" can be picked. */
  ownModel: boolean;
}

/** Reading scanned PDF pages (OCR), for the notebooks that have PDF pages. */
export interface ScanReading {
  /** The switch: scanned pages are read. */
  on: boolean;
  /** The reader is on this device; if not, the row is the download. */
  ready: boolean;
}

export interface AiMenuContext {
  setup: AiSetup;
  /** Some page has anything at all to ask about (the chat picks which). */
  notebookAskable: boolean;
  /** More than one page (otherwise the notebook entries say nothing new). */
  multiPage: boolean;
  /**
   * How many audio recordings the note has. Absent where recording does not
   * exist (no "Transcribe recording" entry at all); `0` shows the entry
   * greyed out, saying why.
   */
  recordings?: number;
  /** The on-device reader; absent when it is switched off. */
  device?: DeviceReading;
  /** Which model reads, as the section's first row picks it; absent, the row is left out. */
  reading?: HandwritingReading;
  /** Scanned PDF pages; absent when the notebook has no PDF page, which leaves the row out. */
  scan?: ScanReading;
  /** Progress of an on-device transcription running now, 0..100; absent when none runs. */
  transcribing?: number;
}

/**
 * Whether the key section folds into one row: nothing in it can run, since
 * no AI service is set up for text or for images.
 */
export function aiKeyFolded(setup: AiSetup): boolean {
  return !textAvailability(setup).enabled && !imageAvailability(setup).enabled;
}

/**
 * The on-device section: the corrections switch, and learning the user's
 * handwriting. Reading a page to see what Grape made of it is a command
 * ("Show this page read on this device"), not an entry here.
 */
function deviceItems(ctx: AiMenuContext): AiMenuItem[] {
  const device = ctx.device;
  const reader = readerItem(ctx.reading);
  if (!device) {
    if (reader) return [reader];
    return [
      {
        id: "device-settings",
        label: t("ai.menu.readOnDevice"),
        icon: "scan-text",
        enabled: true,
        reason: "",
        section: "device",
      },
    ];
  }
  const items: AiMenuItem[] = [
    ...(reader ? [reader] : []),
    {
      id: "check-words",
      label: t("ai.menu.corrections"),
      icon: "spell-check",
      enabled: true,
      reason: t("ai.menu.correctionsHint"),
      section: "device",
      on: device.checkingWords,
    },
    {
      id: "calc-notes",
      label: t("ai.menu.calculations"),
      icon: "equal",
      enabled: true,
      reason: t("ai.menu.calculationsHint"),
      section: "device",
      on: device.calculating,
    },
  ];
  // One row for the whole of learning: it opens the Learn your handwriting
  // window, which shows the next step (view/learn-window.ts).
  items.push({
    id: "learn-window",
    label: t("ai.menu.learn"),
    icon: "graduation-cap",
    enabled: true,
    reason: "",
    detail: learnDetail(device),
    section: "device",
  });
  return items;
}

/** Where learning stands, under its row: a run's share, or what there is so far. */
function learnDetail(device: DeviceReading): string {
  if (device.learning !== null) {
    return t("ai.menu.learning", { percent: Math.round(device.learning) });
  }
  if (device.learned) return t("ai.menu.learned");
  if (device.practiceFiles === 0) return t("ai.menu.copyToStart");
  return tn("ai.menu.practiceSheets", device.practiceFiles);
}

/**
 * "Read with": Off, Grape, or Mine once a model has been learned from the
 * user's handwriting. One choice for what were two switches in the settings.
 */
function readerItem(reading: HandwritingReading | undefined): AiMenuItem | null {
  if (!reading) return null;
  const choices = [
    { id: "off", label: t("common.off") },
    { id: "grape", label: "Grape" },
    ...(reading.ownModel ? [{ id: "mine", label: t("ai.menu.mine") }] : []),
  ];
  return {
    id: "reader",
    label: t("ai.menu.readWith"),
    icon: "scan-text",
    enabled: true,
    reason: "",
    section: "device",
    choices,
    value: reading.value === "mine" && !reading.ownModel ? "grape" : reading.value,
  };
}

function gate(base: Availability, contentOk: boolean, emptyReason: string): Availability {
  if (!base.enabled) return base;
  return contentOk ? OK : no(emptyReason);
}

/**
 * The AI menu's entries with availability: the device's section, then the
 * key's. The menu shows the key's first (`view/ai-menu.ts`).
 */
export function buildAiMenu(ctx: AiMenuContext): AiMenuItem[] {
  return [...deviceItems(ctx), ...speechItems(ctx), ...scanItems(ctx), ...keyItems(ctx)];
}

/**
 * Reading scanned PDF pages: a switch like Corrections, last in the on-device
 * section. Until the reader is on this device the row is its download, marked
 * with the download symbol, and a tap asks which reader to get.
 */
function scanItems(ctx: AiMenuContext): AiMenuItem[] {
  const scan = ctx.scan;
  if (!scan) return [];
  const base = { label: "Scanned pages", icon: "file-scan", enabled: true, reason: "" };
  if (!scan.ready) {
    return [{ ...base, id: "scan-pdf-download", mark: "download", section: "device" }];
  }
  return [{ ...base, id: "scan-pdf", on: scan.on, section: "device" }];
}

/**
 * Transcribing a recording on this device: no key, so it sits in the
 * device's section; while one runs, the entry cancels it.
 */
function speechItems(ctx: AiMenuContext): AiMenuItem[] {
  if (ctx.transcribing !== undefined) {
    return [
      {
        id: "transcribe-device-cancel",
        label: t("ai.menu.stopTranscribing", { percent: Math.round(ctx.transcribing) }),
        icon: "square",
        enabled: true,
        reason: t("ai.menu.transcribingNow"),
        section: "device",
      },
    ];
  }
  if (ctx.recordings === undefined) return [];
  return [
    {
      id: "transcribe-device",
      label: t("ai.menu.transcribeOnDevice"),
      icon: "audio-waveform",
      enabled: ctx.recordings > 0,
      reason: ctx.recordings > 0 ? "" : t("ai.menu.noRecordings"),
      section: "device",
    },
  ];
}

/** The features that need the user's own AI key. */
function keyItems(ctx: AiMenuContext): AiMenuItem[] {
  const text = textAvailability(ctx.setup);
  const items: AiMenuItem[] = [];
  // One way into the chat, whose page picker chooses what it is about.
  items.push({
    id: "ask",
    label: t("ai.menu.ask"),
    icon: "messages-square",
    ...gate(
      text,
      ctx.notebookAskable,
      ctx.multiPage ? t("ai.menu.notebookEmpty") : t("ai.menu.pageEmpty"),
    ),
  });
  items.push({
    id: "generate-image",
    label: t("ai.menu.generateImage"),
    icon: "image-plus",
    ...imageAvailability(ctx.setup),
  });
  // Last: it needs a speech-capable vendor, which the rest do not.
  if (ctx.recordings !== undefined) {
    items.push({
      id: "transcribe-recording",
      label: t("ai.menu.transcribeRecording"),
      icon: "mic",
      ...gate(audioAvailability(ctx.setup), ctx.recordings > 0, t("ai.menu.noRecordings")),
    });
  }
  items.push({
    id: "settings",
    label: text.enabled ? t("ai.menu.settings") : t("ai.menu.setUp"),
    icon: "settings",
    enabled: true,
    reason: "",
    footer: true,
  });
  return items;
}
