/**
 * A notebook kept as one file per page per device (FineNotes#274, layout
 * (c3) of the sync research note): the files, their names and their text.
 *
 * Obsidian Sync keeps every uploaded version of a file for a month and
 * caps a file at 5 MB on its Standard plan, and merges a Markdown file two
 * devices changed with a fuzzy patch that drops one side's ink. Kept as one
 * file per page per device, a save writes only this device's file for the
 * page it changed, and no file is ever changed on two devices.
 *
 * ```
 * Physics/Physics.notebook.md    prose, and the notebook as it was, labelled
 *                                with its id (`v2+device-pages=n7k2q9ab:`)
 * Physics/Pages/n7k2q9ab/
 *   p1.ab12cd34.md               page p1, as device ab12cd34 wrote it
 *   p1.ef56gh78.md               page p1, as device ef56gh78 wrote it
 *   _meta.ab12cd34.md            ab12cd34's settings, page list, and rev + hash
 *                                of each of its page files
 * ```
 *
 * The page folder is named by the notebook's id, so two notebooks in one
 * folder never share a file, and renaming a notebook leaves it in place.
 * Each file holds one block: `%%finenotes-page` or `%%finenotes-meta`, then a
 * `v2[+features]:<base64 DEFLATE JSON>` payload, as a notebook block does.
 *
 * This build only reads the layout: such a notebook is shown read-only and
 * nothing is written. Joining the files is `device-pages-union`.
 *
 * Pure: no DOM, no Obsidian.
 */

import { type InkDocument } from "./document";
import {
  type DevicePagesSources,
  type DevicePagesUnion,
  type MetaPageEntry,
  type MetaRead,
  type PageFileRead,
  type Tombstone,
  ELEMENT_LISTS,
  PAGE_FIELDS,
  joinDevicePages,
} from "./device-pages-union";
import { BLOCK_LABEL } from "../constants";
import { isLabelProblem, needsNewerReader, readPayloadLabel } from "./format-features";
import { isDeviceId, readVersionVector } from "./provenance";
import { payloadFeatures, readLabelledJson, readStoredDocument } from "./serialize";

/** The folder beside the notebook file that holds the page folders, one per notebook id. */
export const PAGES_FOLDER = "Pages";

/** The block a page file keeps its page in. */
export const PAGE_BLOCK_LABEL = "finenotes-page";

/** The block a device's meta file keeps its meta in. */
export const META_BLOCK_LABEL = "finenotes-meta";

/** The stem of a meta file's name: `_meta.<device>.md`. */
const META_STEM = "_meta";

/** What a notebook id may be made of: it names a folder. */
const NOTEBOOK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether `id` is usable as a notebook id. */
export function isNotebookId(id: unknown): id is string {
  return typeof id === "string" && NOTEBOOK_ID.test(id);
}

/** Whether a notebook payload is one kept as one file per page per device. */
export function isDevicePagesPayload(payload: string): boolean {
  return payloadFeatures(payload)?.includes("device-pages") === true;
}

// --- The notebook's id -----------------------------------------------------------

/**
 * The id of a notebook kept as page files, from its payload's label
 * (`device-pages=<id>`), or `null` when the label names none.
 */
export function notebookIdOf(payload: string): string | null {
  const text = payload.trim();
  const colon = text.indexOf(":");
  if (colon < 0) return null;
  const label = readPayloadLabel(text.slice(0, colon));
  return isLabelProblem(label) ? null : (label.pagesId ?? null);
}

/** The block a notebook file keeps its payload in: where its label starts. */
const BLOCK_START = `%%${BLOCK_LABEL}`;

/**
 * The id of a notebook kept as page files from its whole file text, reading
 * only its block's label: cheap enough for Home to ask of every notebook.
 */
export function notebookIdOfText(text: string): string | null {
  const at = text.indexOf(BLOCK_START);
  if (at < 0) return null;
  const start = text.indexOf("\n", at);
  if (start < 0) return null;
  const colon = text.indexOf(":", start);
  if (colon < 0 || colon - start > 400) return null;
  return notebookIdOf(text.slice(start + 1, colon + 1));
}

// --- Paths ---------------------------------------------------------------------

/** The folder a vault path is in ("" for the root). */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** The folder holding the page files of notebook `notebookId` at `notebookPath`. */
export function devicePagesFolderOf(notebookPath: string, notebookId: string): string {
  const folder = folderOf(notebookPath);
  return folder ? `${folder}/${PAGES_FOLDER}/${notebookId}` : `${PAGES_FOLDER}/${notebookId}`;
}

/**
 * The page folder to move when the notebook kept as page files with `id`
 * moved from `from` to `to` (paths of the notebook file): exactly its old
 * folder to its new place, `null` when the place does not change (a rename
 * in the same folder, or a notebook whose own folder moved with it, whose
 * pages are already there) or `exists` says either side is not as expected
 * (nothing at the old place, or something at the new one). Never a search:
 * another notebook's folder is never taken.
 */
export function pagesFolderMove(
  from: string,
  to: string,
  id: string,
  exists: (path: string) => boolean,
): { from: string; to: string } | null {
  const old = devicePagesFolderOf(from, id);
  const next = devicePagesFolderOf(to, id);
  if (old === next || !exists(old) || exists(next)) return null;
  return { from: old, to: next };
}

/** What a file in a page folder is, by its name. */
export type DeviceFileName =
  | { readonly kind: "meta"; readonly device: string }
  | { readonly kind: "page"; readonly device: string };

/**
 * A file name in a page folder read: `_meta.<device>.md` is a device's meta,
 * `<anything>.<device>.md` a page file of that device (the page's id is in
 * the file, so the name before the device is only for people). `null` for
 * anything else: no `.md`, no device, or a name with a slash.
 */
export function readDeviceFileName(name: string): DeviceFileName | null {
  if (!name.endsWith(".md") || name.includes("/") || name.includes("\\")) return null;
  const stem = name.slice(0, -3);
  const dot = stem.lastIndexOf(".");
  if (dot <= 0) return null;
  const device = stem.slice(dot + 1);
  if (!isDeviceId(device)) return null;
  return stem.slice(0, dot) === META_STEM ? { kind: "meta", device } : { kind: "page", device };
}

// --- File text -----------------------------------------------------------------

function blockRe(label: string): RegExp {
  return new RegExp(
    `(?:^|\\n)[ \\t]*%%${label}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*%%[ \\t]*(?:\\r?\\n|$)`,
  );
}

const PAGE_BLOCK_RE = blockRe(PAGE_BLOCK_LABEL);
const META_BLOCK_RE = blockRe(META_BLOCK_LABEL);

/** A page file's text: its payload in a block of its own. */
export function pageFileText(payload: string): string {
  return `%%${PAGE_BLOCK_LABEL}\n${payload}\n%%\n`;
}

/** A meta file's text: its payload in a block of its own. */
export function metaFileText(payload: string): string {
  return `%%${META_BLOCK_LABEL}\n${payload}\n%%\n`;
}

/** The payload in a page file's block, or `null` when the text is not a page file. */
export function pagePayloadOf(text: string): string | null {
  const block = PAGE_BLOCK_RE.exec(text);
  return block ? block[1].trim() : null;
}

/** The payload in a meta file's block, or `null` when the text is not a meta file. */
export function metaPayloadOf(text: string): string | null {
  const block = META_BLOCK_RE.exec(text);
  return block ? block[1].trim() : null;
}

/**
 * The hash a meta keeps of each of its page files: FNV-1a, 64 bits, as 16
 * hex digits, of the payload's UTF-8 bytes (trimmed). It tells an
 * out-of-step copy from the file its meta describes; it is no defence
 * against tampering.
 */
export function payloadHash(payload: string): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (const byte of new TextEncoder().encode(payload.trim())) {
    lo ^= byte;
    // Times the prime 2^40 + 0x1b3, in 16-bit limbs: lo * 0x1b3, plus lo << 40.
    const l0 = lo & 0xffff;
    const l1 = lo >>> 16;
    const p0 = l0 * 0x1b3;
    const p1 = l1 * 0x1b3 + (p0 >>> 16);
    const p2 = (hi & 0xffff) * 0x1b3 + (p1 >>> 16) + l0 * 0x100;
    const p3 = (hi >>> 16) * 0x1b3 + (p2 >>> 16) + l1 * 0x100;
    lo = (((p1 & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
    hi = (((p3 & 0xffff) << 16) | (p2 & 0xffff)) >>> 0;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

// --- Reading the files -----------------------------------------------------------

/** Why a file of the layout was not read. */
export type DeviceFileProblem = "not-a-file" | "unreadable" | "newer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** The labelled JSON of a block, or why it cannot be read. */
function jsonOf(payload: string | null, what: string): unknown {
  if (payload === null) return "not-a-file";
  try {
    return readLabelledJson(payload, what);
  } catch {
    // An unknown feature: from a newer FineNotes. Anything else: cut short, or not ours.
    return needsNewerReader(payload) ? "newer" : "unreadable";
  }
}

function problemOf(value: unknown): DeviceFileProblem | null {
  return value === "not-a-file" || value === "unreadable" || value === "newer" ? value : null;
}

/**
 * A page file read, as device `device` (from its name) wrote it. Its JSON:
 * `{ dev, page, rev, vv, <element lists as a stored page has them>, tomb }`.
 * A file whose `dev` is not the one its name says is not read: a copy.
 */
export function readPageFile(text: string, device: string): PageFileRead | DeviceFileProblem {
  const payload = pagePayloadOf(text);
  const json = jsonOf(payload, "the page");
  const problem = problemOf(json);
  if (problem) return problem;
  if (!isRecord(json) || json.dev !== device) return "unreadable";
  if (typeof json.page !== "string" || !json.page || !isCount(json.rev)) return "unreadable";
  const lists: Record<string, readonly unknown[]> = {};
  for (const list of ELEMENT_LISTS) {
    const entries = json[list];
    if (Array.isArray(entries)) lists[list] = entries;
  }
  const tomb: Tombstone[] = [];
  for (const entry of Array.isArray(json.tomb) ? json.tomb : []) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) continue;
    tomb.push({
      id: entry.id,
      ...(typeof entry.d === "string" ? { d: entry.d } : {}),
      ...(typeof entry.l === "string" ? { l: entry.l } : {}),
    });
  }
  return {
    device,
    page: json.page,
    rev: json.rev,
    vv: readVersionVector(json.vv),
    hash: payloadHash(payload ?? ""),
    lists,
    tomb,
  };
}

/**
 * A device's meta read. Its JSON: `{ dev, vv, clock, settings: { c, …head },
 * pages: [{ id, key, c, gone?, …page fields }], files: { <page id>: { rev,
 * hash } } }`. Entries that cannot be read are skipped, and a page named
 * twice keeps its first entry.
 */
export function readMetaFile(text: string, device: string): MetaRead | DeviceFileProblem {
  const json = jsonOf(metaPayloadOf(text), "the meta");
  const problem = problemOf(json);
  if (problem) return problem;
  if (!isRecord(json) || json.dev !== device) return "unreadable";
  let settings: MetaRead["settings"];
  if (isRecord(json.settings) && isCount(json.settings.c)) {
    const head: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(json.settings)) {
      if (key !== "c" && key !== "pages") head[key] = value;
    }
    settings = { c: json.settings.c, head };
  }
  const pages: MetaPageEntry[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(json.pages) ? json.pages : []) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) {
      continue;
    }
    if (typeof entry.key !== "string" || !isCount(entry.c)) continue;
    seen.add(entry.id);
    const fields: Record<string, unknown> = {};
    for (const name of PAGE_FIELDS) if (entry[name] !== undefined) fields[name] = entry[name];
    pages.push({ id: entry.id, key: entry.key, c: entry.c, gone: entry.gone === true, fields });
  }
  const files: Record<string, { rev: number; hash: string }> = {};
  if (isRecord(json.files)) {
    for (const [page, entry] of Object.entries(json.files)) {
      if (isRecord(entry) && isCount(entry.rev) && typeof entry.hash === "string") {
        files[page] = { rev: entry.rev, hash: entry.hash };
      }
    }
  }
  return { device, vv: readVersionVector(json.vv), settings, pages, files };
}

// --- The notebook -----------------------------------------------------------------

/** A notebook kept as one file per page per device, read, and what of it is not here yet. */
export interface DevicePagesLoad {
  readonly doc: InkDocument;
  /** Pages shown from a copy older than its device's meta says. */
  readonly stale: string[];
  /** Pages with a file a meta names that is not there yet. */
  readonly missing: string[];
  /** Pages known only from a page file, their entry not here yet. */
  readonly unlisted: string[];
  /** Files of the layout that could not be read, by vault path. */
  readonly unreadable: string[];
  /** Files from a newer FineNotes, by vault path. */
  readonly newer: string[];
  /** Whether anything above is not up to date: show the "still syncing" mark. */
  readonly syncing: boolean;
  /** What was read and how it was joined, for the writer (`device-pages-writer`). */
  readonly sources: DevicePagesSources;
  readonly union: DevicePagesUnion;
}

/**
 * Read a notebook kept as one file per page per device. `payload` is the
 * notebook file's block (labelled `device-pages`), `files` the text of each
 * file in its page folder by name. Throws a `SerializeError` only when the
 * notebook file's own payload cannot be read at all.
 */
export function readDevicePagesNotebook(
  payload: string,
  files: ReadonlyMap<string, string>,
  fallbackWidth?: number,
): DevicePagesLoad {
  const legacy = readLabelledJson(payload, "the notebook");
  const metas: MetaRead[] = [];
  const pages: PageFileRead[] = [];
  const unreadable: string[] = [];
  const newer: string[] = [];
  for (const [name, text] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const kind = readDeviceFileName(name);
    if (!kind) continue;
    const read =
      kind.kind === "meta" ? readMetaFile(text, kind.device) : readPageFile(text, kind.device);
    if (read === "newer") newer.push(name);
    else if (read === "unreadable" || read === "not-a-file") unreadable.push(name);
    else if (kind.kind === "meta") metas.push(read as MetaRead);
    else pages.push(read as PageFileRead);
  }
  const sources: DevicePagesSources = { legacy: isRecord(legacy) ? legacy : null, metas, pages };
  const union = joinDevicePages(sources);
  const doc = readStoredDocument(union.stored, fallbackWidth);
  return {
    doc,
    stale: union.stale,
    missing: union.missing,
    unlisted: union.unlisted,
    unreadable,
    newer,
    syncing:
      union.stale.length +
        union.missing.length +
        union.unlisted.length +
        unreadable.length +
        newer.length >
      0,
    sources,
    union,
  };
}

// --- Home -------------------------------------------------------------------------

/** A file's size and last change, as the vault reports them. */
export interface FileStamp {
  mtime: number;
  size: number;
}

/**
 * A notebook's size and last change counting its page files: the newest
 * change among the notebook file and the files in its page folder, and
 * their total size. Home keys what it read of a notebook on this, since a
 * save leaves the notebook file as it was. Without page files it is the
 * file's own.
 */
export function notebookStat(notebook: FileStamp, pages: readonly FileStamp[]): FileStamp {
  let { mtime, size } = notebook;
  for (const page of pages) {
    mtime = Math.max(mtime, page.mtime);
    size += page.size;
  }
  return { mtime, size };
}

/**
 * The page folder a vault path is a file of (`…/Pages/<id>`), or `null` when
 * it is not named as a file of the layout is.
 */
export function devicePagesFolderOfFile(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!readDeviceFileName(name)) return null;
  const folder = folderOf(path);
  const id = folder.slice(folder.lastIndexOf("/") + 1);
  const pages = folderOf(folder);
  const pagesName = pages.slice(pages.lastIndexOf("/") + 1);
  return folder.includes("/") && pagesName === PAGES_FOLDER && isNotebookId(id) ? folder : null;
}
