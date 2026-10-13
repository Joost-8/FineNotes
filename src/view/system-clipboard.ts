/**
 * Reading the system clipboard for the press menu's Paste
 * (`paste-choice.ts` has the rules for which clipboard wins).
 *
 * `navigator.clipboard.read()` must be called inside the tap that asked for
 * it, so {@link readSystemClipboard} starts the read synchronously. On iPad
 * WebKit shows its own "Paste" bubble at the tap first, unless the clipboard
 * holds what this page itself wrote; declining it rejects the read. Nothing
 * here can tell the bubble from a refusal, so both end the same way.
 */

import { cleanPastedText, pickClipboardType } from "./paste-choice";

/** What the system clipboard held, as the press menu pastes it. */
export type SystemPaste =
  | { kind: "image"; file: File }
  | { kind: "text"; text: string }
  /** It could be read, and held nothing a page takes. */
  | { kind: "empty" }
  /** It could not be read: no API here, a declined bubble, or a refusal. */
  | { kind: "unavailable" };

/** Told each time FineNotes writes text to the system clipboard. */
const textWritten = new Set<() => void>();

/** Call `listener` whenever {@link writeSystemText} succeeds; returns the unsubscribe. */
export function onSystemTextWritten(listener: () => void): () => void {
  textWritten.add(listener);
  return () => textWritten.delete(listener);
}

/**
 * Put `text` on the system clipboard. Every copy of text in FineNotes goes
 * through here, so the plugin's own ink clipboard learns it is now the
 * older of the two: a Paste after "Copy text" pastes the text, not ink
 * copied before it.
 */
export function writeSystemText(text: string): Promise<void> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip || typeof clip.writeText !== "function") {
    return Promise.reject(new Error("No clipboard here"));
  }
  return clip.writeText(text).then(() => {
    for (const listener of textWritten) listener();
  });
}

/** Whether this engine can read the system clipboard at all. */
export function canReadSystemClipboard(): boolean {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return !!clip && (typeof clip.read === "function" || typeof clip.readText === "function");
}

/** Read the system clipboard: a picture first, then text. Never rejects. */
export function readSystemClipboard(): Promise<SystemPaste> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip) return Promise.resolve({ kind: "unavailable" });
  if (typeof clip.read === "function") {
    return clip.read().then(fromItems, () => ({ kind: "unavailable" }) as const);
  }
  if (typeof clip.readText === "function") {
    return clip.readText().then(fromText, () => ({ kind: "unavailable" }) as const);
  }
  return Promise.resolve({ kind: "unavailable" });
}

async function fromItems(items: readonly ClipboardItem[]): Promise<SystemPaste> {
  try {
    let text: string | null = null;
    for (const item of items) {
      const pick = pickClipboardType(item.types);
      if (pick?.kind === "image") {
        const blob = await item.getType(pick.type);
        return { kind: "image", file: new File([blob], "Pasted image", { type: pick.type }) };
      }
      if (pick?.kind === "text" && text === null) {
        text = await (await item.getType(pick.type)).text();
      }
    }
    return fromText(text ?? "");
  } catch {
    return { kind: "unavailable" };
  }
}

function fromText(raw: string): SystemPaste {
  const text = cleanPastedText(raw);
  return text ? { kind: "text", text } : { kind: "empty" };
}
