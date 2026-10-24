/**
 * Full screen for notebooks on a tablet: while it is on, a tab group whose
 * tab in front is a notebook loses Obsidian's chrome above the page (the tab
 * bar and the view header). PURE: the plugin hands in where its notebooks
 * are and puts the class on the groups this returns.
 */

/** Where a notebook view is: its tab group, and whether it is the tab in front there. */
export interface NotebookPlace<G> {
  group: G;
  shown: boolean;
}

/**
 * The tab groups to show full screen: those whose tab in front is a
 * notebook, while `on`. A group showing another kind of tab keeps its
 * chrome, so the way out of a notebook is never hidden behind a note.
 */
export function fullScreenGroups<G>(on: boolean, places: readonly NotebookPlace<G>[]): Set<G> {
  const groups = new Set<G>();
  if (!on) return groups;
  for (const place of places) if (place.shown) groups.add(place.group);
  return groups;
}

/** What this device stored (`app.loadLocalStorage`): on only for exactly "1". */
export function parseFullScreen(raw: unknown): boolean {
  return raw === "1";
}

/** What to store for `on`. */
export function storedFullScreen(on: boolean): string {
  return on ? "1" : "0";
}
