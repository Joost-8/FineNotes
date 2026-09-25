/**
 * What the AI menu offers, and why an entry is greyed out.
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
  | "transcribe-page"
  | "transcribe-notebook"
  | "transcribe-recording"
  | "ask-page"
  | "ask-notebook"
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
}

export interface AiMenuContext {
  setup: AiSetup;
  /** The page being read has ink or typed text. */
  pageTranscribable: boolean;
  /** The page being read has anything at all to ask about. */
  pageAskable: boolean;
  notebookTranscribable: boolean;
  notebookAskable: boolean;
  /** More than one page (otherwise the notebook entries say nothing new). */
  multiPage: boolean;
  /**
   * How many audio recordings the note has. Absent where recording does not
   * exist (no "Transcribe recording" entry at all); `0` shows the entry
   * greyed out, saying why.
   */
  recordings?: number;
}

function gate(base: Availability, contentOk: boolean, emptyReason: string): Availability {
  if (!base.enabled) return base;
  return contentOk ? OK : no(emptyReason);
}

/** The AI menu's entries, in order, with availability. */
export function buildAiMenu(ctx: AiMenuContext): AiMenuItem[] {
  const text = textAvailability(ctx.setup);
  const items: AiMenuItem[] = [
    {
      id: "transcribe-page",
      label: "Transcribe this page",
      icon: "file-text",
      ...gate(text, ctx.pageTranscribable, "Nothing written on this page yet"),
    },
  ];
  if (ctx.multiPage) {
    items.push({
      id: "transcribe-notebook",
      label: "Transcribe whole notebook",
      icon: "book-open",
      ...gate(text, ctx.notebookTranscribable, "Nothing written in this notebook yet"),
    });
  }
  if (ctx.recordings !== undefined) {
    // Speech needs a speech-capable vendor, whatever transcribes the ink.
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
    id: "ask-page",
    label: "Ask about this page…",
    icon: "message-square",
    ...gate(text, ctx.pageAskable, "This page is empty"),
  });
  if (ctx.multiPage) {
    items.push({
      id: "ask-notebook",
      label: "Ask about this notebook…",
      icon: "messages-square",
      ...gate(text, ctx.notebookAskable, "This notebook is empty"),
    });
  }
  items.push({
    id: "generate-image",
    label: "Generate image…",
    icon: "image-plus",
    ...imageAvailability(ctx.setup),
  });
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
