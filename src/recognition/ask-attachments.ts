/**
 * Files attached to an Ask AI question: which kinds are accepted, how bytes
 * become a `ChatFile`, the size limit, and which of the notebook's own PDFs
 * sit behind the pages picked (the chat offers to attach those).
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import type { Backdrop } from "../model/document";
import { type ChatFile, PDF_MIME } from "./ai-chat";
import { bytesToBase64 } from "./audio-request";

export type AttachKind = "pdf" | "image" | "text";

/**
 * Most a conversation's attached files may add up to, bytes. Every follow-up
 * resends them, and the APIs refuse a request over about 32 MB once base64
 * has grown it by a third.
 */
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "csv",
  "tsv",
  "json",
  "tex",
  "bib",
  "py",
  "js",
  "ts",
  "java",
  "c",
  "h",
  "cpp",
  "hs",
  "m",
  "r",
  "sql",
  "html",
  "css",
  "xml",
  "yaml",
  "yml",
]);

/** The file picker's `accept`: every extension `attachKind` takes. */
export const ATTACH_ACCEPT = [
  ".pdf",
  ...Object.keys(IMAGE_TYPES).map((e) => `.${e}`),
  ...[...TEXT_EXTENSIONS].map((e) => `.${e}`),
].join(",");

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** What a file is, by its name; null for a kind the AI cannot read. */
export function attachKind(name: string): AttachKind | null {
  const ext = extensionOf(name);
  if (ext === "pdf") return "pdf";
  if (ext in IMAGE_TYPES) return "image";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return null;
}

/** A file's bytes as an attachment, or null for a kind the AI cannot read. */
export function attachmentFromBytes(
  name: string,
  bytes: Uint8Array,
  path?: string,
): ChatFile | null {
  const kind = attachKind(name);
  if (!kind) return null;
  const at = path ? { path } : {};
  if (kind === "text") {
    return { name, mimeType: "text/plain", text: new TextDecoder().decode(bytes), ...at };
  }
  const mimeType = kind === "pdf" ? PDF_MIME : IMAGE_TYPES[extensionOf(name)];
  return { name, mimeType, base64: bytesToBase64(bytes), ...at };
}

/** About how many bytes a file adds to every request it is in. */
export function attachmentBytes(file: ChatFile): number {
  if (file.text !== undefined) return new TextEncoder().encode(file.text).length;
  return Math.floor(((file.base64?.length ?? 0) * 3) / 4);
}

/** "2.4 MB", "830 KB". */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Whether two attachments are the same file (by vault path, else name and size). */
export function sameAttachment(a: ChatFile, b: ChatFile): boolean {
  if (a.path || b.path) return a.path === b.path;
  return a.name === b.name && attachmentBytes(a) === attachmentBytes(b);
}

/**
 * Why `file` cannot join a conversation that already holds `held` (attached
 * and sent), or null when it can.
 */
export function attachRefusal(file: ChatFile, held: readonly ChatFile[]): string | null {
  if (held.some((other) => sameAttachment(other, file))) return `${file.name} is already attached.`;
  const total = held.reduce((sum, f) => sum + attachmentBytes(f), attachmentBytes(file));
  if (total > ATTACH_MAX_BYTES) {
    return (
      `${file.name} is too big: a chat's files can add up to ${sizeLabel(ATTACH_MAX_BYTES)}, ` +
      "since every question sends them again."
    );
  }
  return null;
}

/** A PDF behind some of the picked pages. */
export interface PdfBehind {
  /** Vault path of the PDF. */
  path: string;
  /** 1-based notebook pages, of those picked, printed on it. */
  pages: number[];
}

/**
 * The notebook's own PDFs behind the picked pages (1-based), in the order
 * their first picked page comes. `backdrops[i]` is page i + 1's.
 */
export function pdfsBehind(
  backdrops: readonly (Backdrop | undefined)[],
  picked: readonly number[],
): PdfBehind[] {
  const byPath = new Map<string, number[]>();
  for (const page of [...picked].sort((a, b) => a - b)) {
    const backdrop = backdrops[page - 1];
    if (backdrop?.kind !== "pdf") continue;
    const pages = byPath.get(backdrop.path) ?? [];
    pages.push(page);
    byPath.set(backdrop.path, pages);
  }
  return [...byPath].map(([path, pages]) => ({ path, pages }));
}

/** The name a vault path shows: its last part. */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
