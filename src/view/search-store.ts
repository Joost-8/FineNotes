/**
 * What Home's search inside notebooks keeps on this device
 * (`src/search/library-search.ts`), in IndexedDB outside the vault, so no
 * sync carries it and no note is rewritten for it; one database per vault.
 *
 * - `notebooks`: each notebook's own text (transcriptions, text boxes), by
 *   path, valid while the file's time and size match. Home's read loop
 *   writes it from the read worker.
 * - `readings`: Grape's reading of a page, by notebook path and page id,
 *   with the page's content hash: a page changed since is read again by
 *   the notebook, and until then its old reading is not searched.
 * - `printed`: a PDF page's printed text, by PDF path and page, with the
 *   PDF's own time and size.
 *
 * The notebook writes the last two as it reads pages, so what it already
 * worked out is never worked out again. Browser APIs only (no Obsidian).
 * Every failure is a miss, never an error: without IndexedDB, Home's
 * search finds titles as before.
 */

import type { IndexedPage } from "../search/library-search";

const STORE_NOTEBOOKS = "notebooks";
const STORE_READINGS = "readings";
const STORE_PRINTED = "printed";
const STORES = [STORE_NOTEBOOKS, STORE_READINGS, STORE_PRINTED];
/** Bump when `IndexedPage` or `notebookText` changes: notebooks are then read again. */
const TEXT_VERSION = 2;

export interface NotebookTextRecord {
  mtime: number;
  size: number;
  pages: IndexedPage[];
}

export interface KeptReading {
  hash: string;
  text: string;
}

export interface KeptPrinted {
  /** The PDF's `mtime:size` when it was read. */
  stamp: string;
  text: string;
}

const databases = new Map<string, Promise<IDBDatabase | null>>();

function database(vault: string): Promise<IDBDatabase | null> {
  let opening = databases.get(vault);
  if (!opening) {
    opening = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = indexedDB.open(`finenotes-search:${vault}`, 1);
        request.onupgradeneeded = () => {
          for (const name of STORES)
            if (!request.result.objectStoreNames.contains(name))
              request.result.createObjectStore(name);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    databases.set(vault, opening);
  }
  return opening;
}

function run(
  vault: string,
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  return database(vault).then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
          const tx = db.transaction(store, mode);
          work(tx.objectStore(store));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

/** Every record of a store, by key, that `valid` accepts. */
async function loadAll<T>(
  vault: string,
  store: string,
  valid: (value: unknown) => value is T,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  await run(vault, store, "readonly", (s) => {
    const cursor = s.openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) return;
      if (typeof at.key === "string" && valid(at.value)) out.set(at.key, at.value);
      at.continue();
    };
  });
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// --- Notebooks' own text ----------------------------------------------------

export function loadNotebookTexts(vault: string): Promise<Map<string, NotebookTextRecord>> {
  return loadAll(
    vault,
    STORE_NOTEBOOKS,
    (v): v is NotebookTextRecord =>
      isRecord(v) &&
      v.v === TEXT_VERSION &&
      typeof v.mtime === "number" &&
      typeof v.size === "number" &&
      Array.isArray(v.pages),
  );
}

/** Remembers each notebook's text; `null` forgets a path. One transaction. */
export function saveNotebookTexts(
  vault: string,
  changes: ReadonlyMap<string, NotebookTextRecord | null>,
): void {
  if (changes.size === 0) return;
  // Copied now: the caller may reuse its map before the database is open.
  const copy = [...changes];
  void run(vault, STORE_NOTEBOOKS, "readwrite", (store) => {
    for (const [path, record] of copy) {
      if (record) store.put({ ...record, v: TEXT_VERSION }, path);
      else store.delete(path);
    }
  });
}

// --- Grape's readings -----------------------------------------------------------

export function readingKey(notebook: string, pageId: string): string {
  return `${notebook}\n${pageId}`;
}

export function loadReadings(vault: string): Promise<Map<string, KeptReading>> {
  return loadAll(
    vault,
    STORE_READINGS,
    (v): v is KeptReading =>
      isRecord(v) && typeof v.hash === "string" && typeof v.text === "string",
  );
}

/** Pending readings, written together a moment later: a notebook read on open sends many at once. */
const pendingReadings = new Map<string, Map<string, KeptReading>>();
let readingTimer: number | null = null;

export function saveReading(
  vault: string,
  notebook: string,
  pageId: string,
  reading: KeptReading,
): void {
  // No IndexedDB (or no window, under tests): nothing is kept, and reading goes on.
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  let forVault = pendingReadings.get(vault);
  if (!forVault) {
    forVault = new Map<string, KeptReading>();
    pendingReadings.set(vault, forVault);
  }
  forVault.set(readingKey(notebook, pageId), reading);
  readingTimer ??= window.setTimeout(flushReadings, 1000);
}

function flushReadings(): void {
  readingTimer = null;
  for (const [vault, readings] of [...pendingReadings]) {
    void run(vault, STORE_READINGS, "readwrite", (store) => {
      for (const [key, reading] of readings) store.put(reading, key);
    });
  }
  pendingReadings.clear();
}

/** Forgets the readings of notebooks no longer in the vault (renamed or deleted). */
export function pruneReadings(vault: string, keep: (notebook: string) => boolean): void {
  void run(vault, STORE_READINGS, "readwrite", (store) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) return;
      if (typeof at.key === "string" && !keep(at.key.slice(0, at.key.indexOf("\n")))) at.delete();
      at.continue();
    };
  });
}

// --- PDFs' printed text --------------------------------------------------------

export function printedKey(pdf: string, page: number): string {
  return `${pdf}\n${page}`;
}

export function loadPrinted(vault: string): Promise<Map<string, KeptPrinted>> {
  return loadAll(
    vault,
    STORE_PRINTED,
    (v): v is KeptPrinted =>
      isRecord(v) && typeof v.stamp === "string" && typeof v.text === "string",
  );
}

/** The printed text kept for these PDF pages (by {@link printedKey}). */
export async function getPrinted(
  vault: string,
  keys: readonly string[],
): Promise<Map<string, KeptPrinted>> {
  const out = new Map<string, KeptPrinted>();
  if (keys.length === 0) return out;
  await run(vault, STORE_PRINTED, "readonly", (store) => {
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        const v: unknown = request.result;
        if (isRecord(v) && typeof v.stamp === "string" && typeof v.text === "string")
          out.set(key, { stamp: v.stamp, text: v.text });
      };
    }
  });
  return out;
}

export function savePrinted(vault: string, entries: ReadonlyMap<string, KeptPrinted>): void {
  if (entries.size === 0) return;
  // Copied now: the caller may reuse its map before the database is open.
  const copy = [...entries];
  void run(vault, STORE_PRINTED, "readwrite", (store) => {
    for (const [key, kept] of copy) store.put(kept, key);
  });
}

/** Which vault's database: Obsidian's app id, else the vault's name (as Home's cache keys it). */
export function vaultKeyOf(app: unknown): string {
  const a = (app ?? {}) as { appId?: unknown; vault?: { getName?: () => string } };
  if (typeof a.appId === "string" && a.appId !== "") return a.appId;
  return a.vault?.getName?.() ?? "vault";
}
