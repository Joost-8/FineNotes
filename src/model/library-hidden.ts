/**
 * Notebooks, files and folders hidden from the library (Home). Hiding only
 * takes an item off Home: the file stays in the vault and opens as before.
 * Like the stars, the list is vault paths in the plugin's settings, so it
 * follows the vault to every device; a folder hidden hides all it holds.
 */

/** The path in `hidden` that hides `path`: itself, or the nearest folder above it; null when shown. */
export function hiddenBy(hidden: readonly string[], path: string): string | null {
  let best: string | null = null;
  for (const h of hidden) {
    if ((path === h || path.startsWith(`${h}/`)) && (best === null || h.length > best.length))
      best = h;
  }
  return best;
}

/** Whether `path` is off Home: it, or a folder it lies in, is hidden. */
export function isHidden(hidden: readonly string[], path: string): boolean {
  return hiddenBy(hidden, path) !== null;
}

/** The list with `path` hidden. */
export function hide(hidden: readonly string[], path: string): string[] {
  return hidden.includes(path) ? [...hidden] : [...hidden, path];
}

/**
 * The list with `path` shown again: the entry that hides it removed, and
 * any below it, so the item shows with everything in it.
 */
export function unhide(hidden: readonly string[], path: string): string[] {
  const by = hiddenBy(hidden, path) ?? path;
  return hidden.filter((h) => h !== by && !h.startsWith(`${by}/`));
}

/** `items` whose paths Home shows: all of them while `showHidden`. */
export function shownItems<T>(
  items: readonly T[],
  hidden: readonly string[],
  pathOf: (item: T) => string,
  showHidden: boolean,
): T[] {
  if (showHidden || hidden.length === 0) return [...items];
  return items.filter((item) => !isHidden(hidden, pathOf(item)));
}
