/**
 * `src/view/surface-session.ts` and `surface-session-state.ts`: a session's
 * own history and id counters, the saved view made safe to restore, and
 * which pages' tiles a swap drops.
 */

import { describe, expect, it } from "vitest";
import { layoutPages } from "../../src/canvas/page-layout";
import { AddPage } from "../../src/model/commands";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import { newSession } from "../../src/view/surface-session";
import {
  type SavedView,
  claimTilePages,
  clampSavedView,
  staleTilePages,
} from "../../src/view/surface-session-state";

function docOf(...ids: string[]): InkDocument {
  const doc = emptyDocument();
  doc.pages = ids.map((id) => blankPage(id));
  return doc;
}

function view(over: Partial<SavedView> = {}): SavedView {
  return {
    scrollX: 10,
    scrollY: 400,
    userZoom: 1.5,
    minZoom: 0.8,
    baseScale: 0.9,
    zoomInitialised: true,
    pageIndex: 2,
    heldPage: 2,
    direction: "vertical",
    joined: false,
    board: false,
    boardRef: null,
    boardLaidOut: null,
    boardDrawn: null,
    boardHold: null,
    rowSlot: 0,
    rowGap: Number.NaN,
    pageLayout: layoutPages([]),
    viewport: { scrollY: 400, scale: 1.35, width: 800 },
    offsetX: 0,
    cssW: 800,
    cssH: 600,
    ...over,
  };
}

describe("newSession", () => {
  it("starts with an empty history and ids past the document's", () => {
    const doc = docOf("p1");
    doc.pages[0].strokes.push({
      id: "s7",
      tool: "pen",
      color: "#000",
      size: 2,
      points: [0, 0, 0.5],
    } as never);
    doc.pages[0].textBoxes.push({ id: "t3" } as never);
    const session = newSession(doc, { fixedPages: true });
    expect(session.history.canUndo()).toBe(false);
    expect(session.strokeIds.next()).toBe("s8");
    expect(session.textBoxIds.next()).toBe("t4");
    expect(session.fixedPages).toBe(true);
    expect(session.view).toBeNull();
    expect(session.indexed).toBe(false);
  });

  it("gives each session a history of its own", () => {
    const a = newSession(docOf("p1"));
    const b = newSession(docOf("q1"));
    a.history.push(a.doc, new AddPage(1, blankPage("p2")));
    expect(a.history.canUndo()).toBe(true);
    expect(b.history.canUndo()).toBe(false);
    expect(newSession(docOf("p1")).fixedPages).toBe(false);
  });

  it("passes the surface's filter to its stroke index", () => {
    const skip = (): boolean => true;
    expect(newSession(docOf("p1"), {}, skip).strokeIndex.skip).toBe(skip);
  });
});

describe("clampSavedView", () => {
  it("keeps a view that still fits the document", () => {
    const v = view();
    expect(clampSavedView(v, 5)).toEqual(v);
  });

  it("brings page indices inside a document that shrank", () => {
    const v = clampSavedView(view({ pageIndex: 9, heldPage: 9 }), 3);
    expect(v.pageIndex).toBe(2);
    expect(v.heldPage).toBeNull();
    expect(clampSavedView(view({ pageIndex: -4, heldPage: -1 }), 3).pageIndex).toBe(0);
    expect(clampSavedView(view({ pageIndex: Number.NaN }), 3).pageIndex).toBe(0);
    expect(clampSavedView(view({ pageIndex: 4 }), 0).pageIndex).toBe(0);
  });

  it("opens afresh on a zoom that is no number", () => {
    const v = clampSavedView(view({ userZoom: Number.NaN }), 5);
    expect(v.userZoom).toBe(1);
    expect(v.zoomInitialised).toBe(false);
    expect(clampSavedView(view({ userZoom: 0 }), 5).zoomInitialised).toBe(false);
  });

  it("puts a scroll that is no number at the start", () => {
    const v = clampSavedView(view({ scrollX: Infinity, scrollY: Number.NaN }), 5);
    expect([v.scrollX, v.scrollY]).toEqual([0, 0]);
  });

  it("lets go of a board no longer in the document", () => {
    const doc = docOf("b1");
    const gone = blankPage("b0");
    const v = clampSavedView(view({ boardRef: gone, boardLaidOut: "b0" }), 1, doc.pages);
    expect(v.boardRef).toBeNull();
    expect(v.boardLaidOut).toBeNull();
    const kept = clampSavedView(view({ boardRef: doc.pages[0], boardLaidOut: "b1" }), 1, doc.pages);
    expect(kept.boardRef).toBe(doc.pages[0]);
  });
});

describe("tiles across sessions", () => {
  it("drops only the pages whose tiles another session made", () => {
    const owners = new Map<string, string>();
    claimTilePages(owners, "notes", ["p1", "p2"]);
    claimTilePages(owners, "pdf", ["x1"]);
    // A page id both share, and one never claimed, are dropped; its own are kept.
    expect(staleTilePages(owners, "pdf", ["x1", "p2", "x9"])).toEqual(["p2", "x9"]);
    claimTilePages(owners, "pdf", ["x1", "p2"]);
    expect(staleTilePages(owners, "notes", ["p1", "p2"])).toEqual(["p2"]);
  });
});
