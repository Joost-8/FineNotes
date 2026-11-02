/**
 * What a language's table looks like on disk and on the wire. PURE.
 *
 * Published: `src/i18n/locales/<code>.json` in the repository, a flat
 * object of key to text, fetched at the tag of the running version so its
 * keys always match the build. Cached: `<plugin>/languages/<code>.json`,
 * `{ version, texts }`, so the language opens offline and a new version
 * knows to fetch again.
 */

import type { TextTable } from "./translate";

const REPO_RAW = "https://raw.githubusercontent.com/Joost-8/FineNotes";

/** Where `code`'s table for plugin `version` is published. */
export function tableUrl(version: string, code: string): string {
  return `${REPO_RAW}/${encodeURIComponent(version)}/src/i18n/locales/${encodeURIComponent(code)}.json`;
}

/** The cache file's path inside the plugin folder. */
export function cachePath(pluginDir: string, code: string): string {
  return `${pluginDir}/languages/${code}.json`;
}

/** Only the string entries of a parsed table; null when it is not an object. */
export function tableOf(raw: unknown): TextTable | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value !== "") texts[key] = value;
  }
  return texts;
}

export interface CachedTable {
  version: string;
  texts: TextTable;
}

/** A cache file's contents, or null when it is damaged or not a cache. */
export function readCache(json: string): CachedTable | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { version, texts } = raw as { version?: unknown; texts?: unknown };
  const table = tableOf(texts);
  if (typeof version !== "string" || !table) return null;
  return { version, texts: table };
}

export function writeCache(version: string, texts: TextTable): string {
  return JSON.stringify({ version, texts });
}
