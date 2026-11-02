/**
 * Fonts fetched for this vault (`model/font-catalogue.ts` says which and
 * why): kept in `FineNotes assets/Fonts`, so the vault's sync carries one
 * download to every device, and registered with `document.fonts` the first
 * time a notebook names a family this device lacks. The DOM text boxes and
 * the canvas both draw with them from then on.
 *
 * Nothing is fetched by itself: `fetch` runs from a tap (the font menu's
 * download mark, the import result's row). A file is written only once its
 * SHA-256 matches the catalogue, and a stored file that no longer matches is
 * not used. Requests go through `requestUrl`: `fetch` is blocked on the iPad.
 */

import { type App, normalizePath, requestUrl } from "obsidian";
import {
  type FontFaceFile,
  type FontFile,
  type FontSource,
  FONT_FOLDER,
  fontPath,
  fontSourceFor,
  fontUrl,
  licencePath,
} from "../model/font-catalogue";
import { toHex } from "../downloads/model-manifest";
import { hasFamily } from "./device-fonts";

/**
 * How this device shows a family: it has it (`installed`), FineNotes loaded
 * it or its stand-in (`loaded`), FineNotes could (`fetchable`), or neither
 * (`missing`).
 */
export type FontState = "installed" | "loaded" | "fetchable" | "missing";

/** The face descriptors, with `sizeAdjust`, which TypeScript's DOM library lacks. */
type FaceDescriptors = FontFaceDescriptors & { sizeAdjust?: string };

class FontStore {
  /** Faces registered, by name (lower-cased), with the FontFace objects. */
  private readonly faces = new Map<string, FontFace[]>();
  /** Loads under way, by face name (lower-cased). */
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly app: App) {}

  /** Call `listener` whenever a face was loaded; returns the unsubscribe. */
  onLoad(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  state(family: string): FontState {
    const source = fontSourceFor(family);
    if (source && this.faces.has(source.face.toLowerCase())) return "loaded";
    if (hasFamily(family)) return "installed";
    return source ? "fetchable" : "missing";
  }

  /** What a download for `family` fetches, or undefined when there is none. */
  source(family: string): FontSource | undefined {
    return fontSourceFor(family);
  }

  /**
   * Load the faces for those of `families` this device lacks from the vault,
   * where they were fetched before (on this device or another). Fetches
   * nothing. Resolves true when a face was loaded.
   */
  async use(families: Iterable<string>): Promise<boolean> {
    const loads: Array<Promise<boolean>> = [];
    for (const family of families) {
      if (this.state(family) === "fetchable") loads.push(this.load(family, false));
    }
    return (await Promise.all(loads)).some(Boolean);
  }

  /** Fetch what is missing for `family`, write it to the vault and load it. */
  fetch(family: string): Promise<boolean> {
    return this.load(family, true);
  }

  /** Take every registered face out of the document (the plugin unloads). */
  dispose(): void {
    for (const faces of this.faces.values()) {
      for (const face of faces) document.fonts.delete(face);
    }
    this.faces.clear();
    this.listeners.clear();
  }

  private load(family: string, fetch: boolean): Promise<boolean> {
    const source = fontSourceFor(family);
    if (!source) return Promise.resolve(false);
    const key = source.face.toLowerCase();
    if (this.faces.has(key)) return Promise.resolve(true);
    const running = this.pending.get(key);
    // A fetch asked for while a vault-only load runs goes on to fetch.
    if (running && !fetch) return running;
    const job = (running ?? Promise.resolve(false))
      .then((done) => done || this.loadNow(source, fetch))
      .finally(() => {
        if (this.pending.get(key) === job) this.pending.delete(key);
      });
    this.pending.set(key, job);
    return job;
  }

  private async loadNow(source: FontSource, fetch: boolean): Promise<boolean> {
    const key = source.face.toLowerCase();
    if (this.faces.has(key)) return true;
    const files: Array<{ file: FontFaceFile; bytes: ArrayBuffer }> = [];
    for (const file of source.font.files) {
      const bytes = await this.file(source, file, fontPath(file), fetch);
      if (!bytes) return false;
      files.push({ file, bytes });
    }
    if (fetch) await this.file(source, source.font.licence, licencePath(source.font), true);
    const faces = await Promise.all(
      files.map(async ({ file, bytes }) => {
        const descriptors: FaceDescriptors = { weight: file.weight, style: file.style };
        if (source.sizeAdjust !== undefined) {
          descriptors.sizeAdjust = `${(source.sizeAdjust * 100).toFixed(2)}%`;
        }
        return new FontFace(source.face, bytes, descriptors).load();
      }),
    );
    for (const face of faces) document.fonts.add(face);
    this.faces.set(key, faces);
    for (const listener of [...this.listeners]) listener();
    return true;
  }

  /**
   * A file's bytes: from the vault when it is there and intact, else (when
   * `fetch`) downloaded, checked and written. Null when neither worked; a
   * failed download throws, with what went wrong.
   */
  private async file(
    source: FontSource,
    file: FontFile,
    path: string,
    fetch: boolean,
  ): Promise<ArrayBuffer | null> {
    const adapter = this.app.vault.adapter;
    const at = normalizePath(path);
    if (await adapter.exists(at)) {
      const stored = await adapter.readBinary(at);
      if (await matches(stored, file)) return stored;
      if (!fetch) return null;
    } else if (!fetch) {
      return null;
    }
    const answer = await requestUrl({ url: fontUrl(source.font, file), throw: false });
    if (answer.status !== 200) throw new Error(`${file.name}: HTTP ${answer.status}`);
    const bytes = answer.arrayBuffer;
    if (!(await matches(bytes, file))) throw new Error(`${file.name} is not the expected file`);
    await this.write(at, bytes);
    return bytes;
  }

  private async write(path: string, bytes: ArrayBuffer): Promise<void> {
    const vault = this.app.vault;
    const folder = normalizePath(FONT_FOLDER);
    if (!vault.getFolderByPath(folder)) {
      try {
        await vault.createFolder(folder);
      } catch {
        // Created meanwhile.
      }
    }
    const existing = vault.getFileByPath(path);
    if (existing) await vault.modifyBinary(existing, bytes);
    else await vault.createBinary(path, bytes);
  }
}

async function matches(bytes: ArrayBuffer, file: FontFile): Promise<boolean> {
  if (bytes.byteLength !== file.bytes) return false;
  return toHex(await crypto.subtle.digest("SHA-256", bytes)) === file.sha256;
}

let store: FontStore | null = null;

/** This vault's fonts: one store for the plugin, made on first use. */
export function vaultFonts(app: App): FontStore {
  store ??= new FontStore(app);
  return store;
}

/** The store when a notebook made it, else null (nothing fetched can be shown yet). */
export function loadedVaultFonts(): FontStore | null {
  return store;
}

/** Drop the store and its faces (the plugin unloads). */
export function disposeVaultFonts(): void {
  store?.dispose();
  store = null;
}
