/**
 * Where each notebook was left, so reopening it lands on that page. Pure.
 *
 * GoodNotes reopens a notebook on the page you were reading, at fit zoom
 * (research/goodnotes-smoothness §1). The page is remembered, not the
 * scroll offset: a scroll offset means something only at one pane size and
 * zoom, and a coordinate that depends on the viewport must never be stored
 * (CLAUDE.md, "Coordinates that depend on pane width cannot survive sync").
 * The view keeps the map per device, in Obsidian's vault-scoped local
 * storage; nothing is written into the note.
 *
 * An endless board (FineNotes#46) is one page, so its page says nothing:
 * it keeps the point in the middle of the view, in page px, and the zoom,
 * which on a board is real size and so means the same on every pane.
 */

/** Where a board was left: the page point in the middle of the view, and the zoom. */
export interface BoardSpot {
  x: number;
  y: number;
  zoom: number;
}

/** Where one notebook was left. */
export interface LastPage {
  /** Id of the page being read; survives pages added or moved before it. */
  page: string;
  /** Its index then; the fallback when that id is gone (a page deleted, a file replaced). */
  index: number;
  /** When it was recorded (ms since the epoch), for pruning the oldest. */
  at: number;
  /** On a board, where on its page. */
  spot?: BoardSpot;
}

/** Notebook path → where it was left. */
export type LastPages = Record<string, LastPage>;

/** The most notebooks remembered; beyond this the longest unread are forgotten. */
export const LAST_PAGES_MAX = 200;

/** Read a stored map, dropping anything malformed rather than trusting it. */
export function parseLastPages(raw: unknown): LastPages {
  const out: LastPages = Object.create(null) as LastPages;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!path || typeof value !== "object" || value === null) continue;
    const { page, index, at } = value as Record<string, unknown>;
    if (typeof page !== "string" || !page) continue;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) continue;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    const spot = parseSpot((value as Record<string, unknown>).spot);
    out[path] = { page, index, at, ...(spot ? { spot } : {}) };
  }
  return out;
}

/** A stored board spot, or `undefined` when it is not a whole one. */
function parseSpot(raw: unknown): BoardSpot | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { x, y, zoom } = raw as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return undefined;
  if (![x, y, zoom].every(Number.isFinite) || !(zoom > 0)) return undefined;
  return { x, y, zoom };
}

/**
 * Record that `path` was left on page `pageId` (at `index`), at time `at`,
 * and on a board at `spot`. Returns a new map, pruned to
 * {@link LAST_PAGES_MAX} by dropping the longest unread.
 */
export function rememberPage(
  map: LastPages,
  path: string,
  pageId: string,
  index: number,
  at: number,
  spot?: BoardSpot,
): LastPages {
  const next: LastPages = Object.create(null) as LastPages;
  Object.assign(next, map);
  if (!path || !pageId || !Number.isInteger(index) || index < 0) return next;
  const kept = parseSpot(spot);
  next[path] = { page: pageId, index, at, ...(kept ? { spot: kept } : {}) };
  const paths = Object.keys(next);
  if (paths.length > LAST_PAGES_MAX) {
    paths.sort((a, b) => next[a].at - next[b].at);
    for (const old of paths.slice(0, paths.length - LAST_PAGES_MAX)) delete next[old];
  }
  return next;
}

/** A notebook was renamed or moved: its entry follows it. */
export function renameInLastPages(map: LastPages, from: string, to: string): LastPages {
  const entry = hasEntry(map, from) ? map[from] : undefined;
  if (!entry || from === to) return map;
  const next: LastPages = Object.create(null) as LastPages;
  Object.assign(next, map);
  delete next[from];
  next[to] = entry;
  return next;
}

/** A notebook was deleted: forget it. */
export function forgetInLastPages(map: LastPages, path: string): LastPages {
  if (!hasEntry(map, path)) return map;
  const next: LastPages = Object.create(null) as LastPages;
  Object.assign(next, map);
  delete next[path];
  return next;
}

/**
 * The page to reopen `path` on, among `pages`: the remembered page by id,
 * else the remembered index if the notebook still has that many pages, else
 * `null` (open as if for the first time).
 */
export function lastPageIndex(
  map: LastPages,
  path: string,
  pages: ReadonlyArray<{ id: string }>,
): number | null {
  const entry = hasEntry(map, path) ? map[path] : undefined;
  if (!entry) return null;
  const byId = pages.findIndex((page) => page.id === entry.page);
  if (byId >= 0) return byId;
  return entry.index < pages.length ? entry.index : null;
}

/** Where the board at `path` was left, or `null` (open it on its middle). */
export function lastBoardSpot(map: LastPages, path: string): BoardSpot | null {
  return (hasEntry(map, path) ? map[path].spot : undefined) ?? null;
}

/** An own entry: a path like "constructor" must not find Object.prototype's. */
function hasEntry(map: LastPages, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, path);
}
