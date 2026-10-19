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

/** "an OpenAI key", "a Google key" … for reasons. */
function keyPhrase(vendor: LlmVendor): string {
  const name = VENDORS[vendor].label.replace(/\s*\(.*\)$/, "");
  return `${/^[AEIOU]/i.test(name) ? "an" : "a"} ${name} key`;
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
    return endpointUsable(setup.baseUrl) ? OK : no("Needs your endpoint's URL in settings");
  }
  return setup.hasKey(setup.vendor) ? OK : no(`Needs ${keyPhrase(setup.vendor)}`);
}

/** Image generation, with whichever vendor the setting resolves to. */
export function imageAvailability(setup: AiSetup): Availability {
  const vendor = resolveImageVendor(setup.imageVendor, setup.vendor);
  if (!canGenerateImages(vendor)) return no(imageUnsupportedReason(vendor));
  return setup.hasKey(vendor) ? OK : no(`Needs ${keyPhrase(vendor)} for images`);
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
  /** Rendered below a divider, after the actions. */
  footer?: boolean;
  /** Which section: the on-device reader, or the features that need a key (the default). */
  section?: "device" | "key";
  /** A switch rather than an action: its state. A tap flips it and leaves the menu open. */
  on?: boolean;
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
  /** The on-device reader; absent when it is switched off in the settings. */
  device?: DeviceReading;
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
  if (!device) {
    return [
      {
        id: "device-settings",
        label: "Read handwriting on this device…",
        icon: "scan-text",
        enabled: true,
        reason: "",
        section: "device",
      },
    ];
  }
  const items: AiMenuItem[] = [
    {
      id: "check-words",
      label: "Corrections",
      icon: "spell-check",
      enabled: true,
      reason: "Underline words it may have misread; tap one to correct it",
      section: "device",
      on: device.checkingWords,
    },
  ];
  if (device.learning !== null) {
    items.push({
      id: "learn",
      label: `Learning your handwriting · ${Math.round(device.learning)} %`,
      icon: "graduation-cap",
      enabled: false,
      reason: "Runs in the background; stop it in Settings, Handwriting",
      section: "device",
    });
  } else if (device.practiceFiles === 0) {
    items.push({
      id: "practice",
      label: "Teach it your handwriting…",
      icon: "graduation-cap",
      enabled: true,
      reason: "",
      section: "device",
    });
  } else {
    items.push(
      {
        id: "learn",
        label: device.learned ? "Learn my handwriting again" : "Learn my handwriting",
        icon: "graduation-cap",
        enabled: true,
        reason: "",
        section: "device",
      },
      {
        id: "practice",
        label: "Write another practice set",
        icon: "pen-line",
        enabled: true,
        reason: "",
        section: "device",
      },
    );
  }
  return items;
}

function gate(base: Availability, contentOk: boolean, emptyReason: string): Availability {
  if (!base.enabled) return base;
  return contentOk ? OK : no(emptyReason);
}

/** The AI menu's entries, in order, with availability: the device's section, then the key's. */
export function buildAiMenu(ctx: AiMenuContext): AiMenuItem[] {
  return [...deviceItems(ctx), ...speechItems(ctx), ...keyItems(ctx)];
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
        label: `Stop transcribing · ${Math.round(ctx.transcribing)} %`,
        icon: "square",
        enabled: true,
        reason: "Transcribing a recording on this device",
        section: "device",
      },
    ];
  }
  if (ctx.recordings === undefined) return [];
  return [
    {
      id: "transcribe-device",
      label: "Transcribe on this device…",
      icon: "audio-waveform",
      enabled: ctx.recordings > 0,
      reason: ctx.recordings > 0 ? "" : "No recordings in this note yet — tap the mic to record",
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
    label: "Ask…",
    icon: "messages-square",
    ...gate(
      text,
      ctx.notebookAskable,
      ctx.multiPage ? "This notebook is empty" : "This page is empty",
    ),
  });
  items.push({
    id: "generate-image",
    label: "Generate image…",
    icon: "image-plus",
    ...imageAvailability(ctx.setup),
  });
  // Last: it needs a speech-capable vendor, which the rest do not.
  if (ctx.recordings !== undefined) {
    items.push({
      id: "transcribe-recording",
      label: "Transcribe recording…",
      icon: "mic",
      ...gate(
        audioAvailability(ctx.setup),
        ctx.recordings > 0,
        "No recordings in this note yet — tap the mic to record",
      ),
    });
  }
  items.push({
    id: "settings",
    label: text.enabled ? "AI settings…" : "Set up AI…",
    icon: "settings",
    enabled: true,
    reason: "",
    footer: true,
  });
  return items;
}
