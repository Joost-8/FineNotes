/**
 * Saved Ask AI chats on disk: one markdown note per conversation (the format
 * is `ask-chat-file.ts`'s) in the notebook's AI chats folder, which the view
 * resolves (its own setting, else "AI chats" beside the notebook).
 */

import { type App, TFile, normalizePath } from "obsidian";
import { availablePath } from "../canvas/image-raster";
import type { ChatFile } from "../recognition/ai-chat";
import { attachKind, attachmentFromBytes } from "../recognition/ask-attachments";
import {
  type SavedChat,
  buildChatFile,
  chatFileName,
  chatTitle,
  parseChatFile,
} from "../recognition/ask-chat-file";

export interface SavedChatEntry {
  path: string;
  title: string;
  /** ISO time of its first question; "" when unknown. */
  created: string;
}

/**
 * Write `chat`, over the note at `path` when it is still there, else as a new
 * note in `folder` (made when missing). Resolves to where it now is.
 */
export async function writeChat(
  app: App,
  chat: SavedChat,
  path: string | null,
  folder: string,
): Promise<string> {
  const text = buildChatFile(chat);
  const existing = path ? app.vault.getFileByPath(path) : null;
  if (existing) {
    await app.vault.modify(existing, text);
    return existing.path;
  }
  const dir = normalizePath(folder);
  if (!app.vault.getFolderByPath(dir)) {
    try {
      await app.vault.createFolder(dir);
    } catch {
      // Created meanwhile.
    }
  }
  const base = chatFileName(chat).replace(/\.md$/, "");
  const free = normalizePath(
    availablePath(dir, base, "md", (p) => app.vault.getAbstractFileByPath(p) !== null),
  );
  const file = await app.vault.create(free, text);
  return file.path;
}

/** Move a saved chat to the trash the user chose in Obsidian's settings. */
export async function trashChat(app: App, path: string): Promise<void> {
  const file = app.vault.getFileByPath(path);
  if (file) await app.fileManager.trashFile(file);
}

/** A saved chat, or null when the note is gone or is not one. */
export async function readChat(app: App, path: string): Promise<SavedChat | null> {
  const file = app.vault.getFileByPath(path);
  if (!file) return null;
  return parseChatFile(await app.vault.cachedRead(file));
}

/** The saved chats in `folder` of the notebook at `notebookPath`, newest first. */
export async function listChats(
  app: App,
  notebookPath: string,
  folder: string,
): Promise<SavedChatEntry[]> {
  const dir = app.vault.getFolderByPath(normalizePath(folder));
  if (!dir) return [];
  const entries: SavedChatEntry[] = [];
  for (const child of dir.children) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const chat = parseChatFile(await app.vault.cachedRead(child));
    if (!chat) continue;
    // Several notebooks can share a folder: keep the ones that link to this one.
    const target =
      app.metadataCache.getFirstLinkpathDest(chat.notebookLink, child.path)?.path ?? chat.notebook;
    if (target !== notebookPath) continue;
    entries.push({ path: child.path, title: chatTitle(chat.turns), created: chat.created });
  }
  return entries.sort((a, b) => b.created.localeCompare(a.created));
}

/** A vault file as an attachment, or null when it is gone or is a kind the AI cannot read. */
export async function readAttachment(app: App, path: string): Promise<ChatFile | null> {
  const file = app.vault.getFileByPath(path);
  if (!file || !attachKind(file.name)) return null;
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  return attachmentFromBytes(file.name, bytes, file.path);
}

/** Every vault file a chat can attach, newest first. */
export function attachableFiles(app: App): TFile[] {
  return app.vault
    .getFiles()
    .filter((file) => attachKind(file.name) !== null)
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
}
