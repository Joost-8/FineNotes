/**
 * Companion PDFs: a PDF of a notebook that FineNotes keeps up to date.
 * Pure: the frontmatter keys, paths, the per-device journal and the
 * state mark. No platform dependencies.
 *
 * Where the truth lives:
 * - the notebook's frontmatter (synced): whether it has a companion, where
 *   the PDF is, and whether the PDF follows the notebook's name;
 * - the PDF's Subject (synced): which notebook it belongs to and which
 *   content it shows (`export/companion-metadata.ts`);
 * - this device's journal (local storage, never synced): whether the
 *   notebook changed since the last export, an interrupted write, the last
 *   error, and the size and time of the PDF this device wrote, so its own
 *   write is trusted without reading it back.
 */
import { INK_FILE_SUFFIXES } from "../constants";
import { pdfName } from "../export/export-name";
import type { InkDocument } from "./document";
import { stripInkSuffix } from "./new-notebook";

export const COMPANION_ID_KEY = "finenotes-companion-id";
export const COMPANION_PDF_KEY = "finenotes-companion-pdf";
export const COMPANION_FOLLOW_KEY = "finenotes-companion-follow";
const COMPANION_KEYS = [COMPANION_ID_KEY, COMPANION_PDF_KEY, COMPANION_FOLLOW_KEY] as const;

export interface CompanionFrontmatterMeta {
  id: string;
  pdfPath?: string;
  followName?: boolean;
}

/** Why the last update failed, as a code: the words are looked up where shown. */
export type CompanionErrorCode =
  "missing" | "occupied" | "source" | "export" | "write" | "frontmatter" | "path" | "duplicate";

const ERROR_CODES: readonly CompanionErrorCode[] = [
  "missing",
  "occupied",
  "source",
  "export",
  "write",
  "frontmatter",
  "path",
  "duplicate",
];

/** A failure that carries its code; any other error is an export failure. */
export class CompanionError extends Error {
  constructor(readonly code: CompanionErrorCode) {
    super(code);
    this.name = "CompanionError";
  }
}

export function companionErrorCode(error: unknown): CompanionErrorCode {
  return error instanceof CompanionError ? error.code : "export";
}

/** A file as Obsidian last listed it: what tells this device's own write from another's. */
export interface CompanionStat {
  path: string;
  mtime: number;
  size: number;
}

/** A PDF this device looked at: its listing and what its Subject said. */
export interface CompanionSeen extends CompanionStat {
  /** The notebook's id in the Subject, or `null` when it names none. */
  id: string | null;
  hash: string | null;
}

export interface CompanionTransaction {
  target: string;
  stage: string;
  backup: string;
  /** The stage was written in full (only then may it become the PDF). */
  staged?: boolean;
}

/** This device's record of one companion, by the notebook's id. */
export interface CompanionEntry {
  notebookPath: string;
  pdfPath: string;
  enabled: boolean;
  followName: boolean;
  /** The notebook may have changed since the PDF was last checked. */
  dirty: boolean;
  /** The PDF this device wrote last, with the content hash it carries. */
  written?: CompanionSeen;
  /** The last PDF read here that this device did not write. */
  seen?: CompanionSeen;
  error?: CompanionErrorCode;
  transaction?: CompanionTransaction;
  /** An export is rendering: found at start, the app ended during it (the crash guard). */
  exporting?: true;
  /** Automatic exports wait for Update now (an export may have ended the app). */
  halted?: true;
  /** This device's export switches the PDF was last made or accepted with. */
  optionsKey?: string;
}

export interface CompanionJournal {
  version: 2;
  entries: Record<string, CompanionEntry>;
}

export function isCompanionNotebookPath(path: string): boolean {
  const lower = path.toLowerCase();
  return INK_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function validCompanionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
}

export function validCompanionHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
}

const FRONTMATTER = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n|$)/;

/** The frontmatter's YAML (without its fences), or `null` when the text has none. */
export function companionFrontmatter(body: string): string | null {
  return FRONTMATTER.exec(body)?.[2] ?? null;
}

function unquoteYamlString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      /* Not JSON-compatible: taken as written between the quotes. */
    }
    return trimmed.slice(1, -1);
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

export function companionIdFromBody(body: string): string | null {
  const front = companionFrontmatter(body) ?? "";
  return /^finenotes-companion-id:\s*["']?([a-f0-9]{16})["']?\s*$/m.exec(front)?.[1] ?? null;
}

/** The companion keys of a notebook's frontmatter: the same on every device. */
export function companionMetaFromBody(body: string): CompanionFrontmatterMeta | null {
  const id = companionIdFromBody(body);
  if (!id) return null;
  const front = companionFrontmatter(body) ?? "";
  const meta: CompanionFrontmatterMeta = { id };
  const pdf = /^finenotes-companion-pdf:[ \t]*(.+?)\s*$/m.exec(front)?.[1];
  if (pdf) {
    const path = companionPathOrNull(unquoteYamlString(pdf));
    if (path) meta.pdfPath = path;
  }
  const follow = /^finenotes-companion-follow:\s*(true|false)\s*$/im.exec(front)?.[1];
  if (follow) meta.followName = follow.toLowerCase() === "true";
  return meta;
}

/** What to set: a key given `null` is removed, one left out is kept. */
export interface CompanionKeys {
  id?: string | null;
  pdfPath?: string | null;
  followName?: boolean | null;
}

function keyLines(keys: CompanionKeys, current: CompanionFrontmatterMeta | null): string[] {
  const id = keys.id === undefined ? (current?.id ?? null) : keys.id;
  const pdf = keys.pdfPath === undefined ? (current?.pdfPath ?? null) : keys.pdfPath;
  const follow = keys.followName === undefined ? (current?.followName ?? null) : keys.followName;
  const lines: string[] = [];
  // Quoted: an id of digits (or digits and one "e") would read back as a number.
  if (id !== null) lines.push(`${COMPANION_ID_KEY}: "${id}"`);
  if (pdf !== null) lines.push(`${COMPANION_PDF_KEY}: ${JSON.stringify(pdf)}`);
  if (follow !== null) lines.push(`${COMPANION_FOLLOW_KEY}: ${follow ? "true" : "false"}`);
  return lines;
}

const OWN_LINE = /^finenotes-companion-(?:id|pdf|follow):.*$/;

/**
 * The text with the companion keys set as asked, and every other line of it
 * as it was: only lines of the three keys are removed or added, at the end
 * of the frontmatter. A text without frontmatter gains one when a key is set.
 */
export function withCompanionKeys(text: string, keys: CompanionKeys): string {
  const current = companionMetaFromBody(text);
  const lines = keyLines(keys, current);
  const match = FRONTMATTER.exec(text);
  if (!match) {
    if (lines.length === 0) return text;
    const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
    return `${bom}---\n${lines.join("\n")}\n---\n${text.slice(bom.length)}`;
  }
  const [whole, open, yaml, close, end] = match;
  const eol = open.endsWith("\r\n") ? "\r\n" : "\n";
  const kept = yaml.split(/\r?\n/).filter((line) => !OWN_LINE.test(line));
  const body = [...kept, ...lines];
  // A frontmatter that held only these keys goes with its fences.
  if (body.every((line) => line.trim() === "")) return text.slice(whole.length);
  return open + body.join(eol) + close + end + text.slice(whole.length);
}

/** A copy's text: the copy is a notebook of its own, with no companion. */
export function withoutCompanionKeys(text: string): string {
  if (!COMPANION_KEYS.some((key) => (companionFrontmatter(text) ?? "").includes(key))) return text;
  return withCompanionKeys(text, { id: null, pdfPath: null, followName: null });
}

function companionPathOrNull(raw: string): string | null {
  const parts = raw
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== ".");
  if (
    !parts.length ||
    parts.some(
      (p) =>
        p === ".." ||
        p.startsWith(".") ||
        /[:*?"<>|]/.test(p) ||
        Array.from(p).some((char) => char.charCodeAt(0) < 32),
    )
  )
    return null;
  const path = parts.join("/");
  return path.toLowerCase().endsWith(".pdf") ? path : null;
}

/** A vault path for a companion PDF, or a `path` error for one that cannot be. */
export function companionPath(raw: string): string {
  const path = companionPathOrNull(raw);
  if (!path) throw new CompanionError("path");
  return path;
}

/** The PDF's file name for a notebook: its name without the notebook suffix. */
export function companionName(notePath: string): string {
  const name = notePath.split("/").pop()!.replace(/\.md$/i, "");
  return `${stripInkSuffix(name)}.pdf`;
}

export function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `folder/name`, or `name` at the vault's root. */
export function inCompanionFolder(folder: string, name: string): string {
  return companionPath(folder ? `${folder}/${name}` : name);
}

/**
 * Where a companion goes when `preferred` is wanted: there when no file is,
 * or when the file there is the notebook's own (`own`: the one its export
 * or its companion last wrote); else a free name beside it (`Name 1.pdf`),
 * never over someone else's file. The Export dialog's own rule (#318,
 * `pdfName`), so both name a notebook's PDF alike. `taken`: the names in
 * that folder now.
 */
export function companionPlace(
  preferred: string,
  taken: ReadonlySet<string>,
  own: boolean,
): string {
  const name = fileNameOf(preferred);
  const base = name.replace(/\.pdf$/i, "");
  return inCompanionFolder(
    folderOf(preferred),
    pdfName(base, name, taken, own ? name : undefined).name,
  );
}

/** Where the PDF goes when the notebook is renamed and the PDF follows its name. */
export function followedCompanionPath(pdfPath: string, notePath: string): string {
  return inCompanionFolder(folderOf(pdfPath), companionName(notePath));
}

/**
 * The companion's file name: the notebook's PDF name typed in the Export
 * dialog (FineNotes#318) when it has one, else the notebook's own name. One
 * rule for both, so an export of that name and the companion are one file.
 */
export function companionFileName(notePath: string, typed?: string): string {
  return typed ? `${typed}.pdf` : companionName(notePath);
}

/** Whether a PDF's name is the notebook's own (it follows the name), not one the user gave it. */
export function followsName(pdfPath: string, notePath: string): boolean {
  return fileNameOf(pdfPath).toLowerCase() === companionName(notePath).toLowerCase();
}

/**
 * This device's staging and backup files beside the PDF. The device id is
 * in their names, so a stray copy synced from another device never blocks
 * this one, and this device never takes another's half-written file. Each
 * write's names are new (`write`), so a scratch file just deleted, which the
 * vault may still list for a moment, is never in the way of the next.
 */
export function companionTransaction(
  target: string,
  id: string,
  device: string,
  write = 0,
): CompanionTransaction {
  const own = device.replace(/[^A-Za-z0-9]/g, "").slice(0, 16) || "device";
  const tag = `${id}-${own}-${Math.max(0, Math.floor(write)).toString(36)}`;
  return {
    target,
    stage: `${target}.fn-${tag}-pending.pdf`,
    backup: `${target}.fn-${tag}-backup.pdf`,
  };
}

/** Whether a path is one of FineNotes' staging or backup files. */
export function isCompanionScratch(path: string): boolean {
  return /\.pdf\.fn-[a-f0-9]{16}-[A-Za-z0-9]+-[a-z0-9]+-(?:pending|backup)\.pdf$/i.test(path);
}

function readStat(raw: unknown): CompanionStat | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CompanionStat>;
  if (typeof value.path !== "string" || !companionPathOrNull(value.path)) return null;
  if (typeof value.mtime !== "number" || !Number.isFinite(value.mtime)) return null;
  if (typeof value.size !== "number" || !Number.isFinite(value.size)) return null;
  return { path: value.path, mtime: value.mtime, size: value.size };
}

function readSeen(raw: unknown): CompanionSeen | undefined {
  const stat = readStat(raw);
  if (!stat) return undefined;
  const value = raw as Partial<CompanionSeen>;
  return {
    ...stat,
    id: validCompanionId(value.id) ? value.id : null,
    hash: validCompanionHash(value.hash) ? value.hash : null,
  };
}

/** The journal as kept in local storage, with anything malformed left out. */
export function parseCompanionJournal(raw: unknown): CompanionJournal {
  const out: CompanionJournal = { version: 2, entries: {} };
  let source: unknown = raw;
  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      return out;
    }
  }
  if (!source || typeof source !== "object") return out;
  const { version, entries } = source as Partial<CompanionJournal>;
  if (version !== 2 || !entries || typeof entries !== "object") return out;
  for (const [id, value] of Object.entries(entries)) {
    if (!validCompanionId(id) || !value || typeof value !== "object") continue;
    const notebookPath = value.notebookPath;
    if (typeof notebookPath !== "string" || !isCompanionNotebookPath(notebookPath)) continue;
    const pdfPath = typeof value.pdfPath === "string" ? companionPathOrNull(value.pdfPath) : null;
    if (!pdfPath) continue;
    const entry: CompanionEntry = {
      notebookPath,
      pdfPath,
      enabled: value.enabled === true,
      followName: value.followName !== false,
      dirty: value.dirty !== false,
    };
    const written = readSeen(value.written);
    if (written) entry.written = written;
    const seen = readSeen(value.seen);
    if (seen) entry.seen = seen;
    if (ERROR_CODES.includes(value.error as CompanionErrorCode)) entry.error = value.error;
    if (value.exporting === true) entry.exporting = true;
    if (value.halted === true) entry.halted = true;
    if (typeof value.optionsKey === "string") entry.optionsKey = value.optionsKey;
    const tx = value.transaction;
    if (
      tx &&
      typeof tx.target === "string" &&
      typeof tx.stage === "string" &&
      typeof tx.backup === "string" &&
      isCompanionScratch(tx.stage) &&
      isCompanionScratch(tx.backup) &&
      tx.stage.startsWith(`${tx.target}.fn-${id}-`) &&
      tx.backup.startsWith(`${tx.target}.fn-${id}-`) &&
      companionPathOrNull(tx.target)
    ) {
      entry.transaction = { target: tx.target, stage: tx.stage, backup: tx.backup };
      if (tx.staged === true) entry.transaction.staged = true;
    }
    out.entries[id] = entry;
  }
  return out;
}

/** The files a notebook's pages are drawn from: imported PDFs and pictures. */
export function companionResources(doc: Pick<InkDocument, "pages">): string[] {
  return [
    ...new Set(
      doc.pages.flatMap((page) => [
        ...(page.backdrop.kind === "pdf" ? [page.backdrop.path] : []),
        ...page.images.map((image) => image.path),
      ]),
    ),
  ].sort();
}

/** What the state mark shows. */
export type CompanionMark = "off" | "current" | "stale" | "busy" | "error";

export function companionMark(
  entry: CompanionEntry | undefined,
  running: boolean,
  pdfExists: boolean,
): CompanionMark {
  if (!entry?.enabled) return "off";
  if (running) return "busy";
  if (entry.error) return "error";
  if (!pdfExists) return "stale";
  return entry.dirty ? "stale" : "current";
}

/** Whether a file listing is exactly one this device recorded. */
export function sameStat(a: CompanionStat | undefined, b: CompanionStat | null): boolean {
  return !!a && !!b && a.path === b.path && a.mtime === b.mtime && a.size === b.size;
}
