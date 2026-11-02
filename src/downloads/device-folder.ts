/**
 * A model's folder kept on this device only, in IndexedDB, outside the
 * vault: no vault sync (Obsidian Sync, Syncthing, iCloud) ever carries it,
 * replaces it or deletes it. For a model only a desktop can run, which
 * would otherwise sync hundreds of MB to an iPad that cannot use it.
 *
 * One database for the app, so a model downloaded once serves every vault
 * on this computer. Files are stored as Blobs (Chromium keeps large ones on
 * disk); a key is `<folder>/<name>`.
 *
 * Browser APIs only (no Obsidian), so a browser can test it.
 */

import type { AssetStoreDeps } from "./model-store";

const DB_NAME = "finenotes-models";
const STORE = "files";
/** Above every character a name can hold: the end of a folder's key range. */
const LAST = String.fromCharCode(0xffff);

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB did not open"));
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

/** Run `work` in one transaction and resolve with its result once the transaction has committed. */
async function inStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await database();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T | undefined;
    const request = work(tx.objectStore(STORE));
    if (request) request.onsuccess = () => (result = request.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** The folder part of `AssetStoreDeps` for `folder`, on this device only. */
export function deviceFolder(
  folder: string,
): Pick<AssetStoreDeps, "list" | "read" | "write" | "rename" | "remove"> {
  const key = (name: string): string => `${folder}/${name}`;
  const prefix = `${folder}/`;
  return {
    list: async () => {
      const keys = await inStore("readonly", (store) =>
        store.getAllKeys(IDBKeyRange.bound(prefix, prefix + LAST)),
      );
      return (keys ?? [])
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.slice(prefix.length));
    },
    read: async (name) => {
      const value = await inStore<unknown>("readonly", (store) => store.get(key(name)));
      if (!(value instanceof Blob)) throw new Error(`${name} is not on this device`);
      return value.arrayBuffer();
    },
    write: async (name, data) => {
      await inStore("readwrite", (store) => store.put(new Blob([data]), key(name)));
    },
    rename: async (from, to) => {
      const value = await inStore<unknown>("readonly", (store) => store.get(key(from)));
      if (!(value instanceof Blob)) throw new Error(`${from} is not on this device`);
      await inStore("readwrite", (store) => {
        store.put(value, key(to));
        return store.delete(key(from));
      });
    },
    remove: async (name) => {
      await inStore("readwrite", (store) => store.delete(key(name)));
    },
  };
}
