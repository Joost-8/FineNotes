/** Optional Companion PDF associations; pure model with no platform dependencies. */
import { INK_FILE_SUFFIXES } from "../constants";
import { t } from "../i18n/translate";
import type { InkDocument } from "./document";
import { readFurniture } from "./furniture";
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
  /** A path received in frontmatter whose PDF can arrive separately. */
  awaitingPdf?: boolean;
  deletedAt?: number;
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

/**
 * A copy a sync tool made when two devices changed the same file: Syncthing's
 * `name.sync-conflict-20261125-120000-ABCDEFG.pdf`, Dropbox's and Nextcloud's
 * `name (… conflicted copy …).pdf`. It carries the same Subject identity as
 * the companion it was copied from, so it is never taken for that companion.
 */
export function isSyncConflictCopy(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return (
    /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(?:\.[^./]+)?$/i.test(name) ||
    /\([^)]*conflicted copy[^)]*\)/i.test(name)
  );
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
    throw new Error(t("notebooks.companion.errInvalidPath"));
  const path = parts.join("/");
  if (!path.toLowerCase().endsWith(".pdf")) throw new Error(t("notebooks.companion.errNotPdf"));
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
      if (value.awaitingPdf === true) entry.awaitingPdf = true;
      if (entry.enabled && typeof value.deletedAt === "number" && Number.isFinite(value.deletedAt))
        entry.deletedAt = value.deletedAt;
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

export type CompanionDocument = Pick<InkDocument, "pages" | "furniture" | "endless">;

function companionPagesPayload(doc: Pick<InkDocument, "pages">): unknown[] {
  return doc.pages.map((page) => {
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
  });
}

/**
 * Device-independent content payload (pages + referenced assets, excluding
 * per-device render settings like pressure width or highlighter alpha).
 * Hashed into the PDF Subject so stale synced PDFs are caught without causing
 * two devices with different pen settings to rewrite each other.
 */
export function companionContentOnly(doc: CompanionDocument, resources: unknown): string {
  return JSON.stringify({
    pages: companionPagesPayload(doc),
    furniture: doc.endless ? undefined : readFurniture(doc.furniture),
    resources,
  });
}

/**
 * Only exported graphics & export switches; navigation, audio and bookmarks are
 * excluded. Uses an exclude-list on Page so any future visual element added to
 * Page is automatically fingerprinted without touching Companion PDFs.
 */
export function companionContent(
  doc: CompanionDocument,
  options: CompanionExportOptions,
  resources: unknown,
): string {
  return JSON.stringify({
    pages: companionPagesPayload(doc),
    furniture: doc.endless ? undefined : readFurniture(doc.furniture),
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
  contentHash?: string;
  resources: string[];
  export: () => Promise<Uint8Array>;
}

export interface CompanionIO {
  exists: (path: string) => boolean;
  pdfIdentity: (path: string) => Promise<string | null>;
  pdfContentHash?: (path: string) => Promise<string | null>;
  pdfPaths: () => string[];
  rename: (from: string, to: string) => Promise<void>;
  replace: (entry: CompanionEntry, bytes: Uint8Array, id: string) => Promise<boolean | void>;
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
  /** Targets the user chose by hand: written where chosen, never searched for, until written. */
  private readonly chosen = new Set<string>();

  constructor(
    readonly store: CompanionStore,
    private readonly io: CompanionIO,
  ) {}

  revision(id: string): number {
    return this.revisions.get(id) ?? 0;
  }

  markChanged(id: string): boolean {
    const entry = this.store.entries[id];
    if (!entry?.enabled) return false;
    this.revisions.set(id, this.revision(id) + 1);
    const transitioned = !entry.dirty;
    entry.dirty = true;
    return transitioned;
  }

  async resolve(id: string, allowFullScan = true): Promise<string | null> {
    const entry = this.store.entries[id];
    if (!entry) return null;
    const expected = entry.pdfPath;
    const ownedTarget = this.io.exists(expected) && (await this.io.pdfIdentity(expected)) === id;
    if (expected !== entry.pdfPath) return this.resolve(id, allowFullScan);
    if (ownedTarget) return expected;
    if (entry.awaitingPdf || this.chosen.has(id)) {
      if (this.io.exists(entry.pdfPath)) throw new Error(t("notebooks.companion.errUnrelatedFile"));
      return null;
    }
    const allCandidates = this.io
      .pdfPaths()
      .filter(
        (path) =>
          path !== entry.pdfPath &&
          !/[.]pdf[.]fn-[a-f0-9]{16}-(?:pending|backup)[.]pdf$/i.test(path) &&
          !isSyncConflictCopy(path),
      );
    const parentOf = (p: string): string => {
      const i = p.lastIndexOf("/");
      return i < 0 ? "" : p.slice(0, i);
    };
    const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1).toLowerCase();
    const noteDir = parentOf(entry.notebookPath);
    const pdfDir = parentOf(entry.pdfPath);
    const expectedNames = new Set([
      baseOf(entry.pdfPath),
      companionName(entry.notebookPath).toLowerCase(),
    ]);
    const isLikely = (p: string): boolean => {
      const dir = parentOf(p);
      return dir === pdfDir || dir === noteDir || expectedNames.has(baseOf(p));
    };
    const candidates = allowFullScan
      ? allCandidates
      : allCandidates
          .filter(isLikely)
          .sort(
            (a, b) => Number(expectedNames.has(baseOf(b))) - Number(expectedNames.has(baseOf(a))),
          )
          .slice(0, 16);
    const owned: string[] = [];
    for (const path of candidates) {
      if ((await this.io.pdfIdentity(path)) === id) owned.push(path);
    }
    if (expected !== entry.pdfPath) return this.resolve(id, allowFullScan);
    if (owned.length > 1) throw new Error(t("notebooks.companion.errMultiplePdfs"));
    if (owned.length === 1) {
      entry.pdfPath = owned[0];
      await this.io.persist();
      return owned[0];
    }
    if (this.io.exists(entry.pdfPath)) throw new Error(t("notebooks.companion.errUnrelatedFile"));
    return null;
  }

  claim(id: string, path: string): void {
    const clean = companionPath(path);
    if (
      Object.entries(this.store.entries).some(
        ([other, e]) => other !== id && e.pdfPath.toLowerCase() === clean.toLowerCase(),
      )
    )
      throw new Error(t("notebooks.companion.errOwnedByOther"));
    this.store.entries[id].pdfPath = clean;
    this.store.entries[id].dirty = true;
    delete this.store.entries[id].awaitingPdf;
    this.chosen.add(id);
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
    if (entry.awaitingPdf) {
      entry.notebookPath = notebookPath;
      await this.io.persist();
      return;
    }
    const current = await this.resolve(id, false);
    const folder = entry.pdfPath.split("/").slice(0, -1).join("/");
    const next = defaultCompanionPath(notebookPath, folder);
    if (next === entry.pdfPath) {
      entry.notebookPath = notebookPath;
      await this.io.persist();
      return;
    }
    if (this.io.exists(next)) throw new Error(t("notebooks.companion.errFollowOccupied"));
    if (current) await this.io.rename(current, next);
    entry.pdfPath = next;
    entry.notebookPath = notebookPath;
    await this.io.persist();
  }

  async isCurrent(
    entry: CompanionEntry,
    target: string,
    current: CompanionSnapshot,
  ): Promise<boolean> {
    if (current.contentHash && this.io.pdfContentHash) {
      // Identity-only PDFs are refreshed once to upgrade to portable freshness.
      return (await this.io.pdfContentHash(target)) === current.contentHash;
    }
    return current.fingerprint === entry.lastFingerprint;
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
          const revision = this.revision(id);
          try {
            const current = await request.snapshot();
            const target = await this.resolve(id, request.force);
            if (current.resources.includes(entry.pdfPath))
              throw new Error(t("notebooks.companion.errSourceConflict"));
            if (!request.force && target && (await this.isCurrent(entry, target, current))) {
              const dirty = this.revision(id) !== revision;
              const changed =
                entry.dirty !== dirty ||
                entry.error !== undefined ||
                entry.awaitingPdf === true ||
                entry.lastFingerprint !== current.fingerprint;
              entry.dirty = dirty;
              entry.lastFingerprint = current.fingerprint;
              delete entry.error;
              delete entry.awaitingPdf;
              if (changed) await this.io.persist();
              continue;
            }
            if (!target && (entry.lastFingerprint || entry.awaitingPdf) && !request.force)
              throw new Error(t("notebooks.companion.errMissing"));
            this.rendered.add(id);
            const queuedNext = this.pending.get(id);
            if (queuedNext) queuedNext.force = false;
            const bytes = await current.export();
            if (!entry.enabled || this.store.entries[id] !== entry) continue;
            // A moved or removed target can change while the renderer yields.
            const latestTarget = await this.resolve(id, false);
            if (
              !latestTarget &&
              ((target && !this.io.exists(target)) || entry.awaitingPdf) &&
              !request.force
            )
              throw new Error(t("notebooks.companion.errMissing"));
            if (current.resources.includes(entry.pdfPath))
              throw new Error(t("notebooks.companion.errSourceConflict"));
            if (!entry.enabled || this.store.entries[id] !== entry) continue;
            if ((await this.io.replace(entry, bytes, id)) === false) continue;
            if (!entry.enabled || this.store.entries[id] !== entry) continue;
            this.chosen.delete(id);
            delete entry.awaitingPdf;
            entry.lastFingerprint = current.fingerprint;
            entry.dirty = this.pending.has(id) || this.revision(id) !== revision;
            delete entry.error;
            await this.io.persist();
          } catch (error) {
            if (!entry.enabled || this.store.entries[id] !== entry) continue;
            entry.dirty = true;
            entry.error = error instanceof Error ? error.message : String(error);
            await this.io.persist();
            if (!this.pending.has(id)) throw error;
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
