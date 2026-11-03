/**
 * Starred notebooks and folders in the library. A star is the item's vault
 * path; the list lives in the plugin's settings, so it follows the vault's
 * owner from the laptop to the iPad.
 */

/** The saved list, cleaned: strings only, no blanks, no repeats, order kept. */
export function starsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string" && item.trim() !== "") seen.add(item);
  }
  return [...seen];
}

/** Starred when it is in the list. */
export function isStarred(stars: readonly string[], path: string): boolean {
  return stars.includes(path);
}

/** The list with `path` starred, or unstarred if it was. */
export function toggleStar(stars: readonly string[], path: string): string[] {
  return isStarred(stars, path) ? stars.filter((s) => s !== path) : [...stars, path];
}

/** Starred items first, the rest in their given order. */
export function starredFirst<T>(
  items: readonly T[],
  stars: readonly string[],
  pathOf: (item: T) => string,
): T[] {
  const starred = items.filter((item) => isStarred(stars, pathOf(item)));
  const rest = items.filter((item) => !isStarred(stars, pathOf(item)));
  return [...starred, ...rest];
}
