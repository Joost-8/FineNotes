/**
 * Grape's language packs on this device (recognition/hwr/language-packs.ts):
 * which are here, their bytes for the reader's worker (handwriting.ts), and
 * their word lists for the word check (word-check.ts).
 *
 * A pack is registered with the model registry (and so listed in Settings ›
 * Models on this device) only once its file is here or a page in its
 * language has been read: nothing is offered in advance. When the packs are
 * published (`LANGUAGE_PACKS_HOSTED`), the first page read in a language
 * offers that language's pack, once a session (the registry's "Not now").
 */

import { type App, normalizePath } from "obsidian";
import type { AssetStore } from "../downloads/model-store";
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

export class LanguagePacks {
  private readonly stores = new Map<PageLanguage, AssetStore>();
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

  /** The pack's store, registered on first need. */
  private store(language: PageLanguage): AssetStore | null {
    const known = this.stores.get(language);
    if (known) return known;
    const asset = languagePackAsset(language);
    if (!asset) return null;
    const store = this.registry.register(asset, { formatOf: packFormatOf });
    this.stores.set(language, store);
    return store;
  }

  /** Register the packs whose files are in the folder (at most every `RECHECK_MS`). */
  private look(): Promise<void> {
    if (Date.now() - this.lastLook < RECHECK_MS) return this.looking ?? Promise.resolve();
    this.lastLook = Date.now();
    this.looking = (async () => {
      for (const language of PACK_LANGUAGES) {
        if (this.stores.has(language)) continue;
        const asset = languagePackAsset(language);
        if (!asset) continue;
        const path = normalizePath(
          `${modelFolder(this.pluginDir(), asset)}/${asset.files[0].name}`,
        );
        if (await this.app.vault.adapter.exists(path)) this.store(language);
      }
      // A pack verified once stays so; only the others are looked at again.
      const unsure = [...this.stores.values()].filter((s) => s.state.kind !== "ready");
      await Promise.all(unsure.map((s) => s.check(true)));
    })();
    return this.looking;
  }

  /** The packs here and verified, for the reader's worker. */
  async ready(): Promise<StoredModel[]> {
    await this.look();
    const out: StoredModel[] = [];
    for (const [language, store] of this.stores) {
      if (store.state.kind !== "ready") continue;
      const asset = languagePackAsset(language);
      if (!asset) continue;
      out.push({
        key: `${asset.id}|${asset.version}`,
        read: async () => {
          const bytes = await store.bytes();
          if (!bytes) throw new Error(`the ${language} language pack is not on this device`);
          return bytes;
        },
      });
    }
    return out;
  }

  /** `language`'s word list, when its pack is here; null otherwise. */
  async words(language: PageLanguage): Promise<PackWords | null> {
    if (language === "en") return null;
    await this.look();
    const store = this.stores.get(language);
    const asset = languagePackAsset(language);
    if (!store || !asset || store.state.kind !== "ready") return null;
    const key = `${asset.id}|${asset.version}`;
    const known = this.lists.get(language);
    if (known?.key === key) return known.list;
    const bytes = await store.bytes();
    if (!bytes) return null;
    const read = packWords(bytes);
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
}
