/**
 * What the PDF tab strip and its + list show (`view/pdf-tab-strip.ts`): the
 * tabs in the strip, a tab's name, the attached PDFs and the PDFs beside the
 * notebook that are not attached yet, searched; and the device's memory of
 * which tab each notebook was left on.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { BesidePdf, InkDocument } from "./document";

/** The Notes tab's id in the strip; a PDF tab's id is its `BesidePdf.id`. */
export const NOTES_TAB = "notes";

/** A PDF file in the vault, as the + list offers it. */
export interface VaultPdf {
  path: string;
  /** Last modified, ms since the Unix epoch. */
  mtime: number;
}

/** One row of the + list's "In this notebook". */
export interface AttachedRow {
  id: string;
  label: string;
  path: string;
  /** Shown in the strip now (not closed). */
  open: boolean;
  /** The file is not in the vault. */
  missing: boolean;
}

/** The + list: what is attached, and what lies beside the notebook unattached. */
export interface PlusList {
  attached: AttachedRow[];
  /** How many PDFs are attached, whatever the search. */
  attachedTotal: number;
  inFolder: VaultPdf[];
}

/** The file's name without its folder and `.pdf`. */
export function pdfBaseName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.pdf$/i, "");
}

/** The folder a vault path is in ("" for the vault's root). */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** A tab's name: the one given, or the file's. */
export function tabLabel(beside: Pick<BesidePdf, "label" | "path">): string {
  return beside.label ?? pdfBaseName(beside.path);
}

/** The PDF tabs the strip shows, in the order they were attached: every one not closed. */
export function stripTabs(doc: InkDocument): BesidePdf[] {
  return (doc.beside ?? []).filter((beside) => beside.hidden !== true);
}

/** Whether the strip shows at all: once a PDF is attached (closed or not). */
export function showsStrip(doc: InkDocument): boolean {
  return (doc.beside?.length ?? 0) > 0;
}

/**
 * Whether `text` matches `query`: every word of the query appears in it,
 * ignoring case and accents. An empty query matches everything.
 */
export function matchesQuery(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(text);
  return words.every((word) => hay.includes(word));
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The + list for `doc`, a notebook at `notePath`. "In this notebook": every
 * attached PDF, the most recently attached first (so this week's slides are
 * on top). "In this folder": PDFs in the notebook's own folder (not in
 * folders below it) that are not attached, newest first. Both filtered by
 * `query`, matched against the tab's name and the file's path.
 */
export function plusList(
  doc: InkDocument,
  notePath: string,
  vaultPdfs: readonly VaultPdf[],
  query: string,
  exists: (path: string) => boolean,
): PlusList {
  const beside = doc.beside ?? [];
  const attached = beside
    .map((b) => ({
      id: b.id,
      label: tabLabel(b),
      path: b.path,
      open: b.hidden !== true,
      missing: !exists(b.path),
    }))
    .reverse()
    .filter((row) => matchesQuery(`${row.label} ${row.path}`, query));
  const taken = new Set(beside.map((b) => b.path));
  const folder = folderOf(notePath);
  const inFolder = vaultPdfs
    .filter((pdf) => /\.pdf$/i.test(pdf.path))
    .filter((pdf) => folderOf(pdf.path) === folder && !taken.has(pdf.path))
    .filter((pdf) => matchesQuery(pdf.path, query))
    .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
  return { attached, attachedTotal: beside.length, inFolder };
}

/**
 * The tab to show after closing tab `id`: the one before it in the strip,
 * else the one after, else the notes.
 */
export function tabAfterClosing(doc: InkDocument, id: string): string {
  const tabs = stripTabs(doc);
  const at = tabs.findIndex((beside) => beside.id === id);
  if (at < 0) return NOTES_TAB;
  return tabs[at - 1]?.id ?? tabs[at + 1]?.id ?? NOTES_TAB;
}

// --- Which tab each notebook was left on (this device) ---------------------------------

/** Notebook path → the PDF tab it was left on. A notebook left on its notes is absent. */
export type LastTabs = Record<string, string>;

/** How many notebooks the map remembers; the oldest entries go first. */
export const LAST_TABS_MAX = 200;

/** A stored map, made safe. */
export function parseLastTabs(raw: unknown): LastTabs {
  const map: LastTabs = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return map;
  for (const [path, tab] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof tab === "string" && tab.length > 0 && tab !== NOTES_TAB) map[path] = tab;
  }
  return map;
}

/** Remember that `path` was left on `tab` (the notes: forgotten). */
export function rememberTab(map: LastTabs, path: string, tab: string): LastTabs {
  if (tab === NOTES_TAB) return forgetTab(map, path);
  if (map[path] === tab) return map;
  const next: LastTabs = {};
  for (const [key, value] of Object.entries(map)) if (key !== path) next[key] = value;
  next[path] = tab;
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - LAST_TABS_MAX))) delete next[key];
  return next;
}

/** Forget `path`. */
export function forgetTab(map: LastTabs, path: string): LastTabs {
  if (!(path in map)) return map;
  const next = { ...map };
  delete next[path];
  return next;
}

/** A notebook renamed from `from` to `to`: its tab follows it. */
export function renameInLastTabs(map: LastTabs, from: string, to: string): LastTabs {
  const tab = map[from];
  if (tab === undefined || from === to) return map;
  return rememberTab(forgetTab(map, from), to, tab);
}

/** Where the map is kept (vault-scoped local storage): which tab each notebook was left on. */
export const LAST_TABS_KEY = "goodobsidian:last-tabs";

/** Where this device keeps that the strip was folded away (`stripCollapsedFrom`). */
export const STRIP_COLLAPSED_KEY = "goodobsidian:pdf-tabs-collapsed";

/** Where this device keeps that "Drag it onto Notes" was shown once. */
export const SNIPPET_HINT_KEY = "goodobsidian:snippet-hint-shown";

/**
 * A yes/no kept in local storage, as read back: only the string "1" is yes,
 * so anything missing, cleared or written by another version is no.
 */
export function storedFlag(raw: unknown): boolean {
  return raw === "1";
}

/** A yes/no as it is kept in local storage (`storedFlag` reads it back). */
export function flagToStore(on: boolean): string {
  return on ? "1" : "0";
}
