/**
 * What Home has already worked out, kept on this device so opening it again
 * costs nothing (FineNotes#146): each notebook's library entry, and each PDF
 * cover as a small JPEG. Both live in IndexedDB, outside the vault, so no
 * sync carries them; one database per vault.
 *
 * A notebook's entry is valid while its file's mtime and size match; a
 * cover's key holds the PDF's own mtime and size (`coverKey`), so a changed
 * PDF simply misses. Covers seen this session are also kept in memory as
 * object URLs, so a repaint (search, a tab switch) draws them at once.
 *
 * Browser APIs only (no Obsidian). Every failure is a miss, never an error:
 * without IndexedDB, Home works as before.
 */

import type { LibraryEntry } from "../model/library";

const STORE_ENTRIES = "entries";
const STORE_COVERS = "covers";
/** Covers kept on disk; the least recently made go first. About 30 KB each. */
const MAX_COVERS = 600;
/** Covers kept in memory as object URLs this session. */
const MAX_URLS = 400;
/**
 * The shape of a kept entry. Bump it whenever `LibraryEntry` (or what
 * `entryFromText` reads into it) changes: older entries are then read again.
 */
const ENTRY_VERSION = 1;

export interface CachedRead {
  mtime: number;
  size: number;
  entry: LibraryEntry;
}

interface CoverRecord {
  blob: Blob;
  at: number;
}

const databases = new Map<string, Promise<IDBDatabase | null>>();

function database(vault: string): Promise<IDBDatabase | null> {
  let opening = databases.get(vault);
  if (!opening) {
    opening = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = indexedDB.open(`finenotes-home:${vault}`, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE_ENTRIES);
          request.result.createObjectStore(STORE_COVERS);
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

function run<T>(
  vault: string,
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return database(vault).then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(store, mode);
          let result: T | undefined;
          const request = work(tx.objectStore(store));
          if (request) request.onsuccess = () => (result = request.result);
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** Every notebook entry Home read on this device before, by path. */
export async function loadEntries(vault: string): Promise<Map<string, CachedRead>> {
  const out = new Map<string, CachedRead>();
  await run(vault, STORE_ENTRIES, "readonly", (store) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) return;
      const value = at.value as Partial<CachedRead> | undefined;
      if (
        typeof at.key === "string" &&
        value &&
        typeof value.mtime === "number" &&
        typeof value.size === "number" &&
        (value as { v?: unknown }).v === ENTRY_VERSION &&
        value.entry &&
        value.entry.path === at.key
      )
        out.set(at.key, { mtime: value.mtime, size: value.size, entry: value.entry });
      at.continue();
    };
  });
  return out;
}

/** Remembers what was read; `null` forgets a path. Written in one transaction. */
export function saveEntries(vault: string, changes: Map<string, CachedRead | null>): void {
  if (changes.size === 0) return;
  void run(vault, STORE_ENTRIES, "readwrite", (store) => {
    for (const [path, read] of changes) {
      if (read) store.put({ ...read, v: ENTRY_VERSION }, path);
      else store.delete(path);
    }
  });
}

const urls = new Map<string, string>();

/** A cover already seen this session: draw it at once. */
export function coverUrlNow(key: string): string | null {
  const url = urls.get(key);
  if (url === undefined) return null;
  // Most recently used last.
  urls.delete(key);
  urls.set(key, url);
  return url;
}

function remember(key: string, blob: Blob): string {
  const known = urls.get(key);
  if (known !== undefined) return known;
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  while (urls.size > MAX_URLS) {
    const [oldKey, oldUrl] = urls.entries().next().value as [string, string];
    urls.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

/** A cover made on this device before, as an object URL, or null. */
export async function loadCover(vault: string, key: string): Promise<string | null> {
  const now = coverUrlNow(key);
  if (now) return now;
  const record = await run<CoverRecord>(vault, STORE_COVERS, "readonly", (store) => store.get(key));
  if (!record || !(record.blob instanceof Blob)) return null;
  return remember(key, record.blob);
}

let writes = 0;

/** Keeps a freshly drawn cover, on disk and in memory; returns its object URL, or null. */
export async function saveCover(
  vault: string,
  key: string,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, "image/jpeg", 0.85);
    } catch {
      resolve(null);
    }
  });
  if (!blob) return null;
  const url = remember(key, blob);
  await run(vault, STORE_COVERS, "readwrite", (store) => {
    store.put({ blob, at: Date.now() } satisfies CoverRecord, key);
  });
  if (++writes % 25 === 0) void trimCovers(vault);
  return url;
}

/** Keeps the newest `MAX_COVERS` covers; older keys (old PDF versions, gone notebooks) go. */
async function trimCovers(vault: string): Promise<void> {
  const ages: Array<[IDBValidKey, number]> = [];
  await run(vault, STORE_COVERS, "readonly", (store) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) return;
      ages.push([at.key, (at.value as CoverRecord | undefined)?.at ?? 0]);
      at.continue();
    };
  });
  if (ages.length <= MAX_COVERS) return;
  ages.sort((a, b) => a[1] - b[1]);
  const drop = ages.slice(0, ages.length - MAX_COVERS);
  await run(vault, STORE_COVERS, "readwrite", (store) => {
    for (const [key] of drop) store.delete(key);
  });
}
