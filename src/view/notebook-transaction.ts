import { type App, TFile, normalizePath } from "obsidian";
import { VIEW_TYPE_INK } from "../constants";
import type { InkDocument } from "../model/document";
import { idsIn, type DotClock } from "../model/dot-ids";
import { devicePagesFolderOf, isDevicePagesPayload, notebookIdOf } from "../model/device-pages";
import { buildInkFile, parseInkFile } from "../model/serialize";
import { rememberNotebookId } from "./device-pages-files";
import { DevicePagesSession, deviceIdOf } from "./device-pages-session";

const activeLocks = new Map<string, Promise<unknown>>();

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

async function ensureFolderRecursive(app: App, path: string): Promise<void> {
  if (!path || app.vault.getAbstractFileByPath(path)) return;
  await ensureFolderRecursive(app, parentOf(path));
  try {
    await app.vault.createFolder(path);
  } catch (error) {
    if (!app.vault.getAbstractFileByPath(path)) throw error;
  }
}

export function notebookIsOpen(app: App, file: TFile): boolean {
  return app.workspace
    .getLeavesOfType(VIEW_TYPE_INK)
    .some((leaf) => (leaf.view as { file?: TFile | null })?.file?.path === file.path);
}

/**
 * Reads a closed notebook whether it uses the single-file format or the
 * per-device page-files layout (`DevicePages`).
 */
export async function readClosedNotebook(
  app: App,
  file: TFile,
  paperWidth: number,
): Promise<InkDocument> {
  const raw = await app.vault.read(file);
  const parsed = parseInkFile(raw, paperWidth);
  if (parsed.doc) return parsed.doc;
  if (parsed.payload && isDevicePagesPayload(parsed.payload)) {
    const id = notebookIdOf(parsed.payload);
    rememberNotebookId(file.path, id);
    if (id) {
      const folder = devicePagesFolderOf(file.path, id);
      const session = new DevicePagesSession(
        app,
        file.path,
        parsed.payload,
        folder,
        deviceIdOf(app),
      );
      const texts = await session.readFiles();
      const load = session.load(texts, paperWidth);
      if (load.syncing) throw new Error("Notebook is still syncing; try again in a moment.");
      session.clock.raise(idsIn(load.doc));
      return load.doc;
    }
  }
  throw new Error("Could not read notebook ink data.");
}

/**
 * Serialized read-modify-write transaction for a closed backing notebook.
 * Supports both classic single-file notebooks and `DevicePages` notebooks, and
 * prevents concurrent inline sessions or commands from clobbering each other.
 * An inline editor supplies its clock so element IDs and change stamps share
 * one counter across saves, including while a vault write is in flight.
 */
export async function editClosedNotebook<T>(
  app: App,
  file: TFile,
  paperWidth: number,
  mutate: (doc: InkDocument) => T | Promise<T>,
  changedPageIds?: ReadonlySet<string> | null,
  clock: DotClock | null = null,
): Promise<T> {
  const key = file.path;
  const prev = activeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  activeLocks.set(
    key,
    prev.then(() => next),
  );

  await prev;
  try {
    if (notebookIsOpen(app, file)) {
      throw new Error("Close the full notebook editor before writing inline.");
    }
    const raw = await app.vault.read(file);
    const parsed = parseInkFile(raw, paperWidth);

    if (parsed.doc) {
      const result = await mutate(parsed.doc);
      if (notebookIsOpen(app, file)) {
        throw new Error("The notebook was opened in another tab while saving.");
      }
      const updated = buildInkFile(parsed.body, parsed.doc);
      await app.vault.modify(file, updated);
      return result;
    }

    if (parsed.payload && isDevicePagesPayload(parsed.payload)) {
      const id = notebookIdOf(parsed.payload);
      rememberNotebookId(file.path, id);
      if (!id) throw new Error("The handwriting notebook could not be read.");
      const folder = devicePagesFolderOf(file.path, id);
      const session = new DevicePagesSession(
        app,
        file.path,
        parsed.payload,
        folder,
        clock?.device ?? deviceIdOf(app),
        null,
        clock,
      );
      const texts = await session.readFiles();
      const load = session.load(texts, paperWidth);
      if (load.syncing || !session.writer) {
        throw new Error("Notebook is still syncing; try again in a moment.");
      }
      const result = await mutate(load.doc);
      if (notebookIsOpen(app, file)) {
        throw new Error("The notebook was opened in another tab while saving.");
      }
      const writes = session.writer.save(load.doc, changedPageIds ?? null);
      if (writes.length > 0) {
        await ensureFolderRecursive(app, folder);
        for (const { name, text } of writes) {
          const path = normalizePath(`${folder}/${name}`);
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof TFile) await app.vault.modify(existing, text);
          else await app.vault.create(path, text);
        }
      }
      return result;
    }

    throw new Error("The handwriting notebook could not be read.");
  } finally {
    release();
    if (activeLocks.get(key) === next) activeLocks.delete(key);
  }
}
