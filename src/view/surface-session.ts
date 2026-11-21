/**
 * One document shown by an `InkSurface`, with everything that belongs to it
 * and not to the surface: its undo history, the counters its new ids come
 * from, its stroke index and the view it was left at. A notebook view with
 * tabs (the notes, and each PDF beside them) keeps one session per tab on
 * one surface and swaps them (`InkSurface.showSession`): a swap keeps each
 * tab's undo steps, its scroll and zoom, and its tiles in the shared cache.
 *
 * What the surface holds, and what a swap does with it:
 *
 * Carried per session (here): the document; History; the stroke and text
 * box id sequences; the StrokeIndex; the saved view (scroll, zoom, page,
 * held page, direction, joined, board view, layout); the mirror-sync mark
 * (`mirroredStep`, a step of this history); handwritten-link suggestions
 * and Grape's word flags (by page id, supplied by the host per document).
 *
 * Derived from the document, so rebuilt by the layout after a swap: the
 * page layout of a restored view is put back and laid out again; joined-
 * page mirrors live in the document itself (`canvas/mirrors.ts`), so they
 * travel with it; comment markers, lock badges, section ribbons and page
 * tabs are read from the document on every sync.
 *
 * Reset on a swap (they describe a gesture or a moment, not a document):
 * the stroke being drawn, a press or hold, a picture or group drag, a crop,
 * a graph being explored, the zoom box and its position history, the
 * selection (lasso, image, connector), the eraser's gesture state, a held,
 * parked or just-added text box and every text box element (keyed by page
 * and box id, which two documents may share), the circle-to-lasso loop and
 * press, the off-page and text-copy notices, a highlighter text mark,
 * search hits, faded (playback) strokes and the active word flag (the host
 * supplies them again for the document it shows: `onSessionChange`), a
 * pinch, zoom spring, row settle and fling.
 *
 * Shared by every session (the surface's own): the renderer and its tile
 * and preview caches (keyed by page id; a page id two documents share has
 * its tiles dropped on the swap, `staleTilePages`), stroke paths (a
 * WeakMap by stroke object), the tool, pen and paper settings, the ruler,
 * the PDF text source and backdrop painter (per view, keyed by the page's
 * backdrop), board spots (a WeakMap by page object).
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "../model/commands";
import type { InkDocument, Stroke } from "../model/document";
import { History } from "../model/history";
import type { HandwrittenLink } from "../recognition/handwritten-links";
import { IdSequence, strokeIdsOf, textBoxIdsOf } from "./id-sequence";
import { StrokeIndex } from "./stroke-index";
import type { SavedView } from "./surface-session-state";

export interface SurfaceSessionOptions {
  /**
   * The document's pages are fixed (a PDF's tab): no page is added, removed
   * or moved. Read by the surface's tools from a later phase on.
   */
  fixedPages?: boolean;
}

export interface SurfaceSession {
  doc: InkDocument;
  readonly history: History;
  readonly strokeIds: IdSequence;
  readonly textBoxIds: IdSequence;
  readonly strokeIndex: StrokeIndex;
  readonly fixedPages: boolean;
  /** The view it was left at; null until it has been shown and left once. */
  view: SavedView | null;
  /** Whether the stroke index has read the document yet (on first show). */
  indexed: boolean;
  /** The newest step whose mirrors were brought in line (`syncMirrors`). */
  mirroredStep: Command | null;
  readonly linkSuggestions: Map<string, readonly HandwrittenLink[]>;
  readonly wordFlags: Map<string, ReadonlyArray<readonly string[]>>;
}

/**
 * A session for `doc`, its history empty and its id counters past the ids
 * `doc` holds. `skip` is the stroke index's filter (the surface's: mirrors
 * while the pages are joined). The index reads the document when the
 * session is first shown.
 */
export function newSession(
  doc: InkDocument,
  options: SurfaceSessionOptions = {},
  skip: ((stroke: Stroke) => boolean) | null = null,
): SurfaceSession {
  // The session's document may be swapped (`setDocument`): ids come from the one it holds.
  let session: SurfaceSession | null = null;
  const docOf = (): InkDocument => session?.doc ?? doc;
  const strokeIds = new IdSequence("s", docOf);
  const textBoxIds = new IdSequence("t", docOf);
  strokeIds.restart(strokeIdsOf(doc));
  textBoxIds.restart(textBoxIdsOf(doc));
  const strokeIndex = new StrokeIndex();
  strokeIndex.skip = skip;
  session = {
    doc,
    history: new History(),
    strokeIds,
    textBoxIds,
    strokeIndex,
    fixedPages: options.fixedPages === true,
    view: null,
    indexed: false,
    mirroredStep: null,
    linkSuggestions: new Map(),
    wordFlags: new Map(),
  };
  return session;
}
