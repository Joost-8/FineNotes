/**
 * The page overview's commands on several pages at once: move, delete and
 * duplicate. Each must undo exactly, by identity, since ids can repeat.
 */

import { describe, expect, it } from "vitest";
import { History } from "../../src/model/history";
import { MovePage } from "../../src/model/page-commands";
import {
  DuplicatePages,
  MovePages,
  RemovePages,
  isNoOpBlockMove,
  moveIndexForGap,
  orderAfterBlockMove,
} from "../../src/model/page-order";
import { type InkDocument, type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import { encodeDocument } from "../../src/model/serialize";

function stroke(id: string): Stroke {
  return { id, color: "#1a1a1a", size: 3, tool: "pen", pts: [1, 2, 0.5, 3, 4, 0.5] };
}

/** Pages p1..pN, page i holding stroke s<i>. */
function pages(n: number): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].strokes.push(stroke("s1"));
  for (let i = 2; i <= n; i++) {
    const page = blankPage(`p${i}`);
    page.strokes.push(stroke(`s${i}`));
    doc.pages.push(page);
  }
  return doc;
}

const ids = (doc: InkDocument): string[] => doc.pages.map((page) => page.id);

describe("moveIndexForGap", () => {
  it("maps a gap to MovePage's target index", () => {
    expect(moveIndexForGap(0, 3, 5)).toBe(2);
    expect(moveIndexForGap(4, 0, 5)).toBe(0);
    expect(moveIndexForGap(1, 5, 5)).toBe(4);
  });

  it("is null for the gaps either side of the page itself, and out of range", () => {
    expect(moveIndexForGap(2, 2, 5)).toBeNull();
    expect(moveIndexForGap(2, 3, 5)).toBeNull();
    expect(moveIndexForGap(-1, 0, 5)).toBeNull();
    expect(moveIndexForGap(5, 0, 5)).toBeNull();
    expect(moveIndexForGap(0, 6, 5)).toBeNull();
    expect(moveIndexForGap(0, -1, 5)).toBeNull();
  });

  it("agrees with MovePage on where the page lands", () => {
    for (let from = 0; from < 5; from++) {
      for (let gap = 0; gap <= 5; gap++) {
        const doc = pages(5);
        const page = doc.pages[from];
        const to = moveIndexForGap(from, gap, 5);
        if (to !== null) new MovePage(from, to).apply(doc);
        const other = pages(5);
        const twin = other.pages[from];
        new MovePages([twin], gap).apply(other);
        expect(ids(doc)).toEqual(ids(other));
        expect(doc.pages.indexOf(page)).toBe(other.pages.indexOf(twin));
      }
    }
  });
});

describe("orderAfterBlockMove", () => {
  it("gathers the moving pages in page order at the gap", () => {
    expect(orderAfterBlockMove(6, [4, 1], 0)).toEqual([1, 4, 0, 2, 3, 5]);
    expect(orderAfterBlockMove(6, [0, 2], 6)).toEqual([1, 3, 4, 5, 0, 2]);
    expect(orderAfterBlockMove(6, [0, 5], 3)).toEqual([1, 2, 0, 5, 3, 4]);
  });

  it("ignores out-of-range and repeated indexes, and clamps the gap", () => {
    expect(orderAfterBlockMove(3, [2, 2, 7, -1], -4)).toEqual([2, 0, 1]);
    expect(orderAfterBlockMove(3, [0], 99)).toEqual([1, 2, 0]);
  });

  it("knows a drop inside or beside a contiguous block changes nothing", () => {
    expect(isNoOpBlockMove(6, [2, 3], 2)).toBe(true);
    expect(isNoOpBlockMove(6, [2, 3], 3)).toBe(true);
    expect(isNoOpBlockMove(6, [2, 3], 4)).toBe(true);
    expect(isNoOpBlockMove(6, [2, 3], 5)).toBe(false);
    // Not contiguous: gathering them is a change wherever it lands.
    expect(isNoOpBlockMove(6, [1, 3], 2)).toBe(false);
  });
});

describe("MovePages", () => {
  it("moves pages together and undoes back to the original order", () => {
    const doc = pages(6);
    const before = encodeDocument(doc);
    const command = new MovePages([doc.pages[4], doc.pages[1]], 0);
    command.apply(doc);
    expect(ids(doc)).toEqual(["p2", "p5", "p1", "p3", "p4", "p6"]);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(encodeDocument(doc)).toBe(before);
  });

  it("moves to the end and back", () => {
    const doc = pages(5);
    const command = new MovePages([doc.pages[0], doc.pages[2]], 5);
    command.apply(doc);
    expect(ids(doc)).toEqual(["p2", "p4", "p5", "p1", "p3"]);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("redoes through the history as often as asked", () => {
    const doc = pages(5);
    const history = new History();
    history.push(doc, new MovePages([doc.pages[3], doc.pages[4]], 1));
    const moved = ids(doc);
    expect(moved).toEqual(["p1", "p4", "p5", "p2", "p3"]);
    for (let round = 0; round < 3; round++) {
      history.undo(doc);
      expect(ids(doc)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
      history.redo(doc);
      expect(ids(doc)).toEqual(moved);
    }
  });

  it("is a no-op both ways when nothing would change, or no page is in the document", () => {
    const doc = pages(4);
    const keep = new MovePages([doc.pages[1], doc.pages[2]], 3);
    keep.apply(doc);
    keep.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3", "p4"]);
    const stranger = new MovePages([blankPage("p9")], 0);
    stranger.apply(doc);
    stranger.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("puts back the very pages it moved when ids repeat", () => {
    const doc = pages(4);
    doc.pages[3].id = "p1";
    const [first, , , last] = doc.pages;
    const command = new MovePages([last], 0);
    command.apply(doc);
    expect(doc.pages[0]).toBe(last);
    expect(doc.pages[1]).toBe(first);
    command.invert(doc);
    expect(doc.pages[0]).toBe(first);
    expect(doc.pages[3]).toBe(last);
  });

  it("names itself for one page or several, and keeps the reader", () => {
    const doc = pages(3);
    expect(new MovePages([doc.pages[0]], 2).label).toBe("Move page");
    expect(new MovePages(doc.pages.slice(0, 2), 3).label).toBe("Move pages");
    expect(new MovePages([doc.pages[0]], 2).keepsReading).toBe(true);
    expect(new MovePage(0, 1).keepsReading).toBe(true);
  });
});

describe("RemovePages", () => {
  it("deletes the pages and undoes each back to its place", () => {
    const doc = pages(6);
    const before = encodeDocument(doc);
    const command = new RemovePages([doc.pages[5], doc.pages[0], doc.pages[3]]);
    command.apply(doc);
    expect(ids(doc)).toEqual(["p2", "p3", "p5"]);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(encodeDocument(doc)).toBe(before);
    expect(command.label).toBe("Delete pages");
  });

  it("never deletes every page", () => {
    const doc = pages(2);
    const command = new RemovePages(doc.pages.slice());
    command.apply(doc);
    expect(ids(doc)).toEqual(["p1", "p2"]);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2"]);
  });

  it("skips pages that are not in the document and counts each page once", () => {
    const doc = pages(3);
    const page = doc.pages[1];
    const command = new RemovePages([page, page, blankPage("p8")]);
    command.apply(doc);
    expect(ids(doc)).toEqual(["p1", "p3"]);
    command.invert(doc);
    expect(doc.pages[1]).toBe(page);
    expect(new RemovePages([page]).label).toBe("Delete page");
  });

  it("restores the right page when ids repeat", () => {
    const doc = pages(3);
    doc.pages[2].id = "p1";
    const twin = doc.pages[2];
    const command = new RemovePages([twin]);
    command.apply(doc);
    expect(doc.pages).not.toContain(twin);
    expect(doc.pages[0].strokes[0].id).toBe("s1");
    command.invert(doc);
    expect(doc.pages[2]).toBe(twin);
  });
});

describe("DuplicatePages", () => {
  it("puts each copy after its original, with fresh ids, and undoes", () => {
    const doc = pages(4);
    const before = encodeDocument(doc);
    const command = new DuplicatePages([doc.pages[2], doc.pages[0]]);
    command.apply(doc);
    expect(ids(doc)).toEqual(["p1", "p5", "p2", "p3", "p6", "p4"]);
    // Above the highest stroke id in the document, the first copy's included.
    expect(doc.pages[1].strokes[0].id).toBe("s5");
    expect(doc.pages[4].strokes[0].id).toBe("s6");
    expect(command.added.map((page) => page.id)).toEqual(["p5", "p6"]);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(encodeDocument(doc)).toBe(before);
    expect(command.added).toEqual([]);
  });

  it("redoes with the same copies", () => {
    const doc = pages(2);
    const history = new History();
    const command = new DuplicatePages([doc.pages[1]]);
    history.push(doc, command);
    const copy = doc.pages[2];
    history.undo(doc);
    expect(ids(doc)).toEqual(["p1", "p2"]);
    history.redo(doc);
    expect(doc.pages[2]).toBe(copy);
    expect(command.label).toBe("Duplicate page");
    expect(new DuplicatePages(doc.pages.slice()).label).toBe("Duplicate pages");
  });

  it("does nothing for pages that are not in the document", () => {
    const doc = pages(2);
    const command = new DuplicatePages([blankPage("p7")]);
    command.apply(doc);
    command.invert(doc);
    expect(ids(doc)).toEqual(["p1", "p2"]);
    expect(command.added).toEqual([]);
  });
});
