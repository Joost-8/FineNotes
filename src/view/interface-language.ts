/**
 * Which language FineNotes' interface is in, and getting its table.
 *
 * English is built in. Any other language's table is fetched once from the
 * repository, at the tag of the running version (`table-file.ts`; the main branch when
 * that tag has none, as in a build between releases), and kept
 * in the plugin folder, so it opens offline from then on. As in Obsidian, a
 * new language shows everywhere after a relaunch; the settings tab shows it
 * at once. A table that cannot be had leaves the interface in English.
 */

import { type DataAdapter, getLanguage, requestUrl } from "obsidian";
import { resolveLanguage } from "../i18n/languages";
import { cachePath, readCache, tableOf, tableUrl, writeCache } from "../i18n/table-file";
import { type TextTable, useLanguage } from "../i18n/translate";

/** How long a fetch may take before it is given up. */
const FETCH_TIMEOUT_MS = 15000;

export interface LanguageHost {
  readonly version: string;
  pluginDir(): string;
  readonly adapter: DataAdapter;
  /** The stored choice: a code, or "auto". */
  chosen(): string | undefined;
}

export class InterfaceLanguage {
  constructor(private readonly host: LanguageHost) {}

  /** The language to show now: the choice, or Obsidian's. */
  wanted(): string {
    return resolveLanguage(this.host.chosen(), obsidianLanguage());
  }

  /**
   * Before anything is drawn: the language's table from the cache, if it is
   * there. One cached for an older version still serves (missing texts show
   * in English) while the current one is fetched for the next start; a
   * language not cached yet is fetched in the background, for the same.
   */
  async start(): Promise<void> {
    const code = this.wanted();
    if (code === "en") {
      useLanguage("en");
      return;
    }
    const cached = await this.readCached(code);
    useLanguage(cached ? code : "en", cached?.texts);
    if (!cached || cached.version !== this.host.version) void this.fetch(code);
  }

  /**
   * After a choice in settings: the table, fetched if need be, and put in
   * use, so the settings tab shows it. True when the language is ready;
   * false when it could not be had (the interface stays as it was).
   */
  async apply(): Promise<boolean> {
    const code = this.wanted();
    if (code === "en") {
      useLanguage("en");
      return true;
    }
    const cached = await this.readCached(code);
    const texts =
      cached && cached.version === this.host.version
        ? cached.texts
        : ((await this.fetch(code)) ?? cached?.texts);
    if (!texts) return false;
    useLanguage(code, texts);
    return true;
  }

  private async readCached(code: string): Promise<{ version: string; texts: TextTable } | null> {
    const path = cachePath(this.host.pluginDir(), code);
    try {
      if (!(await this.host.adapter.exists(path))) return null;
      return readCache(await this.host.adapter.read(path));
    } catch {
      return null;
    }
  }

  /**
   * Fetch `code`'s table for this version and cache it; null on any failure.
   * A version whose tag does not have the table (a build made between
   * releases) takes it from the main branch instead.
   */
  private async fetch(code: string): Promise<TextTable | null> {
    try {
      let response = await withTimeout(
        requestUrl({ url: tableUrl(this.host.version, code), throw: false }),
        FETCH_TIMEOUT_MS,
      );
      if (response?.status === 404) {
        response = await withTimeout(
          requestUrl({ url: tableUrl("main", code), throw: false }),
          FETCH_TIMEOUT_MS,
        );
      }
      if (!response || response.status !== 200) return null;
      const texts = tableOf(response.json);
      if (!texts) return null;
      const dir = `${this.host.pluginDir()}/languages`;
      if (!(await this.host.adapter.exists(dir))) await this.host.adapter.mkdir(dir);
      await this.host.adapter.write(
        cachePath(this.host.pluginDir(), code),
        writeCache(this.host.version, texts),
      );
      return texts;
    } catch {
      return null;
    }
  }
}

/** The language Obsidian is in, as Obsidian reports it. */
export function obsidianLanguage(): string {
  try {
    return getLanguage();
  } catch {
    return "en";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
