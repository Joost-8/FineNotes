/**
 * Grape's language packs on this device (recognition/hwr/language-packs.ts):
 * which are here, their bytes for the reader's worker (handwriting.ts), and
 * their word lists for the word check (word-check.ts).
 *
 * Published (`LANGUAGE_PACKS_HOSTED`): a pack is registered with the model
 * registry (and so listed in Settings › Models on this device) once its
 * file is here or a page in its language has been read, and that first page
 * offers its download, once a session (the registry's "Not now"). Nothing
 * is offered in advance.
 *
 * Not published yet: a pack whose file is in the folder (by sync, or copied
 * there) is read straight from it and checked against its pinned SHA-256,
 * and never registered: Settings would offer Re-download, which deletes the
 * file and then cannot fetch it.
 */

import { type App, normalizePath } from "obsidian";
import type { AssetStore } from "../downloads/model-store";
import type { ModelAsset } from "../downloads/model-manifest";
import { packFormatOf, packWords } from "../recognition/hwr/language-pack";
import {
  LANGUAGE_PACKS_HOSTED,
  PACK_LANGUAGES,
  languagePackAsset,
} from "../recognition/hwr/language-packs";
import type { PageLanguage } from "../recognition/hwr/page-language";
import type { StoredModel } from "./handwriting";
import { type ModelRegistry, modelFolder } from "./model-downloads";

/** A pack's word list, as the word check uses it. */
export interface PackWords {
  words: ReadonlySet<string>;
  /** Whether words not in it are underlined (the pack says; measured per language). */
  underline: boolean;
}

/** How long a "not here" answer is trusted before the folder is looked at again (vault sync). */
const RECHECK_MS = 30_000;

/** Lower-case hex SHA-256 of `bytes`. */
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class LanguagePacks {
  private readonly stores = new Map<PageLanguage, AssetStore>();
  /** Packs whose file is in the folder, as last looked (unpublished packs only). */
  private present = new Set<PageLanguage>();
  /** Word lists read so far, by language, with the file key they came from. */
  private readonly lists = new Map<PageLanguage, { key: string; list: PackWords }>();
  private lastLook = 0;
  private looking: Promise<void> | null = null;

  constructor(
    private readonly app: App,
    private readonly pluginDir: () => string,
    private readonly registry: ModelRegistry,
    private readonly hosted = LANGUAGE_PACKS_HOSTED,
  ) {}

  private path(asset: ModelAsset): string {
    return normalizePath(`${modelFolder(this.pluginDir(), asset)}/${asset.files[0].name}`);
  }

  /** The pack's store, registered on first need (published packs only). */
  private store(language: PageLanguage): AssetStore | null {
    const known = this.stores.get(language);
    if (known) return known;
    const asset = languagePackAsset(language);
    if (!asset || !this.hosted) return null;
    const store = this.registry.register(asset, { formatOf: packFormatOf });
    this.stores.set(language, store);
    return store;
  }

  /** Find the packs whose files are in the folder (at most every `RECHECK_MS`). */
  private look(): Promise<void> {
    if (Date.now() - this.lastLook < RECHECK_MS) return this.looking ?? Promise.resolve();
    this.lastLook = Date.now();
    this.looking = (async () => {
      const present = new Set<PageLanguage>();
      for (const language of PACK_LANGUAGES) {
        const asset = languagePackAsset(language);
        if (asset && (await this.app.vault.adapter.exists(this.path(asset)))) present.add(language);
      }
      this.present = present;
      if (!this.hosted) return;
      for (const language of present) this.store(language);
      // A pack verified once stays so; only the others are looked at again.
      const unsure = [...this.stores.values()].filter((s) => s.state.kind !== "ready");
      await Promise.all(unsure.map((s) => s.check(true)));
    })();
    return this.looking;
  }

  /** The languages whose pack is here and usable. */
  private here(): PageLanguage[] {
    if (!this.hosted) return [...this.present];
    return [...this.stores].filter(([, s]) => s.state.kind === "ready").map(([l]) => l);
  }

  /** A pack's bytes: from its store, or (unpublished) its file, only when it is the pinned one. */
  private async bytes(language: PageLanguage): Promise<ArrayBuffer | null> {
    const asset = languagePackAsset(language);
    if (!asset) return null;
    if (this.hosted) return (await this.stores.get(language)?.bytes()) ?? null;
    const data = await this.app.vault.adapter.readBinary(this.path(asset));
    const pin = asset.files[0];
    if (data.byteLength !== pin.bytes || (await sha256(data)) !== pin.sha256) {
      throw new Error(`the ${language} language pack is not the one this build expects`);
    }
    return data;
  }

  /** The packs here, for the reader's worker. */
  async ready(): Promise<StoredModel[]> {
    await this.look();
    const out: StoredModel[] = [];
    for (const language of this.here()) {
      const asset = languagePackAsset(language);
      if (!asset) continue;
      out.push({
        key: `${asset.id}|${asset.version}`,
        read: async () => {
          const data = await this.bytes(language);
          if (!data) throw new Error(`the ${language} language pack is not on this device`);
          return data;
        },
      });
    }
    return out;
  }

  /** `language`'s word list, when its pack is here; null otherwise. */
  async words(language: PageLanguage): Promise<PackWords | null> {
    if (language === "en") return null;
    await this.look();
    const asset = languagePackAsset(language);
    if (!asset || !this.here().includes(language)) return null;
    const key = `${asset.id}|${asset.version}`;
    const known = this.lists.get(language);
    if (known?.key === key) return known.list;
    let data: ArrayBuffer | null;
    try {
      data = await this.bytes(language);
    } catch {
      return null;
    }
    if (!data) return null;
    const read = packWords(data);
    const list = { words: new Set(read.words), underline: read.underline };
    this.lists.set(language, { key, list });
    return list;
  }

  /**
   * A page was read as being in `language`: once the packs are published,
   * offer its pack when it is not here (once a session, the registry's own
   * "Not now").
   */
  seen(language: PageLanguage): void {
    if (language === "en" || !this.hosted) return;
    const store = this.store(language);
    if (!store || store.state.kind === "ready") return;
    const asset = languagePackAsset(language);
    if (asset) this.registry.offer(asset.id, "auto");
  }

  /** A pack was removed (Settings): its list is forgotten. */
  released(id: string): boolean {
    const language = PACK_LANGUAGES.find((l) => languagePackAsset(l)?.id === id);
    if (!language) return false;
    this.lists.delete(language);
    this.lastLook = 0;
    return true;
  }
}
