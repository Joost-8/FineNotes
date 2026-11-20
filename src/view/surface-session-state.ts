/**
 * The view a {@link SurfaceSession} was left at, and the rules for putting it
 * back: the scroll, the zoom, the page being read and the layout they were
 * read against. `InkSurface.showSession` stashes the outgoing session's view
 * with these fields and restores the incoming one's before it lays out again,
 * so that layout treats the swap like a pane resize: it keeps the same spot
 * on screen if the pane did not change, and re-fits it if it did.
 *
 * Also which pages' cached tiles a swap must drop: tiles are keyed by page
 * id, and page ids are only unique within one file, so two documents shown
 * in one surface may share one.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { DocumentLayout } from "../canvas/page-layout";
import type { ViewportState } from "../canvas/viewport";
import type { Bounds, Page, ScrollDirection } from "../model/document";

/** Everything about where a session was being read, as the surface holds it. */
export interface SavedView {
  /** The scroller's position, scaled px. */
  scrollX: number;
  scrollY: number;
  userZoom: number;
  minZoom: number;
  baseScale: number;
  zoomInitialised: boolean;
  pageIndex: number;
  /** The page a zoomed-in row is held to, or null. */
  heldPage: number | null;
  direction: ScrollDirection;
  joined: boolean;
  /** A board's view (`board`, `boardRef`…): see InkSurface. */
  board: boolean;
  boardRef: Page | null;
  boardLaidOut: string | null;
  boardDrawn: Bounds | null;
  boardHold: Bounds | null;
  rowSlot: number;
  rowGap: number;
  /** The layout and viewport the fields above were read against. */
  pageLayout: DocumentLayout;
  viewport: ViewportState;
  offsetX: number;
  /** The pane's size then, CSS px: a pane resized since is laid out as a resize. */
  cssW: number;
  cssH: number;
}

/**
 * `view` made safe to restore onto a document of `pageCount` pages (it may
 * have changed while the session was hidden, a file reloaded under it):
 * page indices inside the document, a zoom that is a positive number, and
 * a scroll position that is finite. A zoom that is no number starts the
 * view afresh at the zoom floor (`zoomInitialised` false), as a first open.
 * A board that is no longer in the document is let go of.
 */
export function clampSavedView(
  view: SavedView,
  pageCount: number,
  pages: readonly Page[] = [],
): SavedView {
  const last = Math.max(0, pageCount - 1);
  const index = (i: number): number => Math.min(Math.max(0, Math.round(i) || 0), last);
  const zoomOk = Number.isFinite(view.userZoom) && view.userZoom > 0;
  const boardGone = view.boardRef !== null && !pages.includes(view.boardRef);
  return {
    ...view,
    scrollX: Number.isFinite(view.scrollX) ? view.scrollX : 0,
    scrollY: Number.isFinite(view.scrollY) ? view.scrollY : 0,
    userZoom: zoomOk ? view.userZoom : 1,
    zoomInitialised: zoomOk && view.zoomInitialised,
    pageIndex: index(view.pageIndex),
    heldPage:
      view.heldPage === null || view.heldPage < 0 || view.heldPage > last ? null : view.heldPage,
    boardRef: boardGone ? null : view.boardRef,
    boardLaidOut: boardGone ? null : view.boardLaidOut,
  };
}

/**
 * The ids among `pageIds` whose cached tiles were made for another owner
 * than `owner` (or for no owner the surface knows of), and so must be
 * dropped before `owner` is shown. `owners` maps a page id to the session
 * whose page last had tiles made under it.
 */
export function staleTilePages<T>(
  owners: ReadonlyMap<string, T>,
  owner: T,
  pageIds: Iterable<string>,
): string[] {
  const stale: string[] = [];
  for (const id of pageIds) if (owners.get(id) !== owner) stale.push(id);
  return stale;
}

/** Record that the tiles of `pageIds` are `owner`'s from now on. */
export function claimTilePages<T>(
  owners: Map<string, T>,
  owner: T,
  pageIds: Iterable<string>,
): void {
  for (const id of pageIds) owners.set(id, owner);
}
