/** Optional Companion PDF associations; pure model with no platform dependencies. */
import { INK_FILE_SUFFIXES } from "../constants";
import type { InkDocument } from "./document";
import { stripInkSuffix } from "./new-notebook";

export const COMPANION_ID_KEY = "finenotes-companion-id";
export const COMPANION_PDF_KEY = "finenotes-companion-pdf";
export const COMPANION_FOLLOW_KEY = "finenotes-companion-follow";

export interface CompanionFrontmatterMeta {
  id: string;
  pdfPath?: string;
  followName?: boolean;
}

export interface CompanionTransaction {
  target: string;
  stage: string;
  backup: string;
}

export interface CompanionEntry {
  notebookPath: string;
  pdfPath: string;
  enabled: boolean;
  followName: boolean;
  dirty: boolean;
  lastFingerprint?: string;
  error?: string;
  transaction?: CompanionTransaction;
}

export interface CompanionStore {
  version: 1;
  entries: Record<string, CompanionEntry>;
}

export function isCompanionNotebookPath(path: string): boolean {
  const lower = path.toLowerCase();
  return INK_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function validCompanionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
}

function frontmatterBlock(body: string): string {
  return /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1] ?? "";
}

function unquoteYamlString(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function companionIdFromBody(body: string): string | null {
  const front = frontmatterBlock(body);
  const id = /^finenotes-companion-id:\s*["']?([a-f0-9]{16})["']?\s*$/m.exec(front)?.[1];
  return id ?? null;
}

/**
 * Reads portable companion settings from a notebook's frontmatter so enabling
 * a companion PDF on one device travels cleanly to other synced devices.
 */
export function companionMetaFromBody(body: string): CompanionFrontmatterMeta | null {
  const id = companionIdFromBody(body);
  if (!id) return null;
  const front = frontmatterBlock(body);
  const meta: CompanionFrontmatterMeta = { id };
  const pdfMatch = /^finenotes-companion-pdf:\s*(.+?)\s*$/m.exec(front)?.[1];
  if (pdfMatch) {
    try {
      meta.pdfPath = companionPath(unquoteYamlString(pdfMatch));
    } catch {
      /* Ignore malformed frontmatter path. */
    }
  }
  const followMatch = /^finenotes-companion-follow:\s*(true|false)\s*$/im.exec(front)?.[1];
  if (followMatch) {
    meta.followName = followMatch.toLowerCase() === "true";
  }
  return meta;
}

export function companionPath(raw: string): string {
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
    throw new Error("Choose a vault-relative PDF path without hidden folders or parent traversal.");
  const path = parts.join("/");
  if (!path.toLowerCase().endsWith(".pdf"))
    throw new Error("The companion target must be a PDF file.");
  return path;
}

/** Clean human-readable filename matching the notebook title (no suffix tag). */
export function companionName(notePath: string): string {
  const name = notePath.split("/").pop()!.replace(/\.md$/i, "");
  return `${stripInkSuffix(name)}.pdf`;
}

export function defaultCompanionPath(notePath: string, exportFolder?: string): string {
  const folder = exportFolder ?? notePath.split("/").slice(0, -1).join("/");
  return companionPath(folder ? `${folder}/${companionName(notePath)}` : companionName(notePath));
}

export function parseCompanionStore(raw: unknown): CompanionStore {
  const out: CompanionStore = { version: 1, entries: {} };
  if (!raw || typeof raw !== "object") return out;
  const source = raw as Partial<CompanionStore>;
  if (source.version !== 1 || !source.entries || typeof source.entries !== "object") return out;
  for (const [id, value] of Object.entries(source.entries)) {
    if (!validCompanionId(id) || !value || typeof value !== "object") continue;
    try {
      const notebookPath = value.notebookPath;
      if (typeof notebookPath !== "string" || !isCompanionNotebookPath(notebookPath)) continue;
      const entry: CompanionEntry = {
        notebookPath,
        pdfPath: companionPath(value.pdfPath),
        enabled: value.enabled === true,
        followName: value.followName !== false,
        dirty: value.dirty !== false,
      };
      if (typeof value.lastFingerprint === "string") entry.lastFingerprint = value.lastFingerprint;
      if (typeof value.error === "string") entry.error = value.error;
      if (
        value.transaction &&
        value.transaction.stage === `${value.transaction.target}.fn-${id}-pending.pdf` &&
        value.transaction.backup === `${value.transaction.target}.fn-${id}-backup.pdf`
      ) {
        entry.transaction = {
          target: companionPath(value.transaction.target),
          stage: companionPath(value.transaction.stage),
          backup: companionPath(value.transaction.backup),
        };
      }
      out.entries[id] = entry;
    } catch {
      /* Keep malformed records out of active write targets. */
    }
  }
  return out;
}

export interface CompanionExportOptions {
  highlighterAlpha: number;
  usePressure: boolean;
  plainPaper?: boolean;
  withoutTapes?: boolean;
  margins?: string;
}

/**
 * Only exported graphics & export switches; navigation, audio and bookmarks are
 * excluded. Uses an exclude-list on Page so any future visual element added to
 * Page is automatically fingerprinted without touching Companion PDFs.
 */
export function companionContent(
  doc: Pick<InkDocument, "pages">,
  options: CompanionExportOptions,
  resources: unknown,
): string {
  return JSON.stringify({
    pages: doc.pages.map((page) => {
      const { id: _id, bookmarked: _bookmarked, title: _title, ...visual } = page;
      return {
        ...visual,
        strokes: page.strokes.map(({ id: _sid, t0: _t0, ...graphics }) => graphics),
        images: page.images.map(({ id: _iid, ...image }) => image),
        textBoxes: page.textBoxes.map(({ id: _tid, ...text }) => text),
        tables: (page.tables ?? []).map(({ id: _tbid, ...table }) => table),
        graphs: (page.graphs ?? []).map(({ id: _gid, ...graph }) => graph),
        equations: (page.equations ?? []).map(({ id: _eid, ...eq }) => eq),
      };
    }),
    options,
    resources,
  });
}

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

export interface CompanionSnapshot {
  fingerprint: string;
  resources: string[];
  export: () => Promise<Uint8Array>;
}

export interface CompanionIO {
  exists: (path: string) => boolean;
  pdfIdentity: (path: string) => Promise<string | null>;
  pdfPaths: () => string[];
  rename: (from: string, to: string) => Promise<void>;
  replace: (entry: CompanionEntry, bytes: Uint8Array, id: string) => Promise<void>;
  persist: () => Promise<void>;
}

/** Exports coalesce per identity; only a manual/close request can initiate rendering. */
export class CompanionController {
  private readonly running = new Map<string, Promise<void>>();
  private readonly pending = new Map<
    string,
    { snapshot: () => Promise<CompanionSnapshot>; force: boolean }
  >();
  private readonly revisions = new Map<string, number>();
  private readonly rendered = new Set<string>();

  constructor(
    readonly store: CompanionStore,
    private readonly io: CompanionIO,
  ) {}

  markChanged(id: string): boolean {
    const entry = this.store.entries[id];
    if (!entry?.enabled) return false;
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    const transitioned = !entry.dirty;
    entry.dirty = true;
    return transitioned;
  }

  async resolve(id: string): Promise<string | null> {
    const entry = this.store.entries[id];
    if (!entry) return null;
    if (this.io.exists(entry.pdfPath) && (await this.io.pdfIdentity(entry.pdfPath)) === id)
      return entry.pdfPath;
    const candidates = this.io
      .pdfPaths()
      .filter(
        (path) =>
          path !== entry.pdfPath &&
          !/[.]pdf[.]fn-[a-f0-9]{16}-(?:pending|backup)[.]pdf$/i.test(path),
      );
    const owned: string[] = [];
    for (const path of candidates) {
      if ((await this.io.pdfIdentity(path)) === id) owned.push(path);
    }
    if (owned.length > 1)
      throw new Error("Multiple PDFs have this companion identity. Choose one target explicitly.");
    if (owned.length === 1) {
      entry.pdfPath = owned[0];
      await this.io.persist();
      return owned[0];
    }
    if (this.io.exists(entry.pdfPath))
      throw new Error("An unrelated file occupies the companion path. Choose another target.");
    return null;
  }

  claim(id: string, path: string): void {
    const clean = companionPath(path);
    if (
      Object.entries(this.store.entries).some(
        ([other, e]) => other !== id && e.pdfPath.toLowerCase() === clean.toLowerCase(),
      )
    )
      throw new Error("Another notebook already owns this PDF target.");
    this.store.entries[id].pdfPath = clean;
    this.store.entries[id].dirty = true;
  }

  async followNotebookName(id: string, notebookPath: string, force = false): Promise<void> {
    const entry = this.store.entries[id];
    if (!entry) return;
    const changedName = entry.notebookPath.split("/").pop() !== notebookPath.split("/").pop();
    if ((!changedName && !force) || !entry.followName) {
      entry.notebookPath = notebookPath;
      await this.io.persist();
      return;
    }
    const current = await this.resolve(id);
    const folder = entry.pdfPath.split("/").slice(0, -1).join("/");
    const next = defaultCompanionPath(notebookPath, folder);
    if (next === entry.pdfPath) {
      entry.notebookPath = notebookPath;
      await this.io.persist();
      return;
    }
    if (this.io.exists(next))
      throw new Error("Cannot follow the notebook name: another file occupies that path.");
    if (current) await this.io.rename(current, next);
    entry.pdfPath = next;
    entry.notebookPath = notebookPath;
    await this.io.persist();
  }

  update(id: string, snapshot: () => Promise<CompanionSnapshot>, force = false): Promise<void> {
    if (!this.store.entries[id]?.enabled) return Promise.resolve();
    const existing = this.running.get(id);
    const queued = this.pending.get(id);
    this.pending.set(id, {
      snapshot,
      force: this.rendered.has(id) ? false : force || queued?.force === true,
    });
    if (existing) return existing;
    const run = Promise.resolve()
      .then(async () => {
        while (this.pending.has(id)) {
          const request = this.pending.get(id)!;
          this.pending.delete(id);
          const entry = this.store.entries[id];
          if (!entry?.enabled) break;
          const revision = this.revisions.get(id) ?? 0;
          try {
            const current = await request.snapshot();
            const target = await this.resolve(id);
            if (current.resources.includes(entry.pdfPath))
              throw new Error(
                "A companion PDF cannot also be this notebook's imported PDF or picture source.",
              );
            if (!request.force && target && current.fingerprint === entry.lastFingerprint) {
              const dirty = (this.revisions.get(id) ?? 0) !== revision;
              const changed = entry.dirty !== dirty || entry.error !== undefined;
              entry.dirty = dirty;
              delete entry.error;
              if (changed) await this.io.persist();
              continue;
            }
            if (!target && entry.lastFingerprint && !request.force)
              throw new Error(
                "PDF missing. Choose its moved path, or use Update PDF now to recreate it.",
              );
            this.rendered.add(id);
            const queuedNext = this.pending.get(id);
            if (queuedNext) queuedNext.force = false;
            const bytes = await current.export();
            if (!entry.enabled) break;
            // The PDF may have moved while it was rendered; resolve again before writing.
            await this.resolve(id);
            if (current.resources.includes(entry.pdfPath))
              throw new Error("Companion target is a notebook source.");
            await this.io.replace(entry, bytes, id);
            entry.lastFingerprint = current.fingerprint;
            const latest = await request.snapshot();
            entry.dirty =
              latest.fingerprint !== current.fingerprint ||
              (this.revisions.get(id) ?? 0) !== revision;
            delete entry.error;
            await this.io.persist();
          } catch (error) {
            entry.dirty = true;
            entry.error = error instanceof Error ? error.message : String(error);
            await this.io.persist();
            throw error;
          }
        }
      })
      .finally(() => {
        this.running.delete(id);
        this.pending.delete(id);
        this.rendered.delete(id);
      });
    this.running.set(id, run);
    return run;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  wait(id: string): Promise<void> {
    return this.running.get(id) ?? Promise.resolve();
  }
}
