/**
 * `src/model/page-commands.ts` — the page-addressed stroke commands.
 *
 * A stroke command that ignored its page would quietly move ink drawn on page 3
 * onto page 1. So the first thing each test here checks is that the command
 * touched **the page it was addressed to and no other**.
 */

import { describe, expect, it } from "vitest";
import type { Command } from "../../src/model/commands";
import {
  AddStrokeToPage,
  AddTextBoxToPage,
  ClearPage,
  CompositeCommand,
  MoveStrokesOnPage,
  RemoveStrokesFromPage,
  RemoveTextBoxFromPage,
  SetTextBoxFrame,
  nextPageId,
  pageToInsertAfter,
} from "../../src/model/page-commands";
import {
  type InkDocument,
  type Stroke,
  blankPage,
  emptyDocument,
  pageById,
} from "../../src/model/document";
import { dequantizePts, quantizePts } from "../../src/model/serialize";

function stroke(id: string, pts: number[] = [1, 2, 0.5, 3, 4, 0.5]): Stroke {
  return { id, color: "#1a1a1a", size: 3, tool: "pen", pts };
}

function threePages(): InkDocument {
  const doc = emptyDocument();
  doc.pages.push(blankPage("p2"), blankPage("p3"));
  doc.pages[0].strokes.push(stroke("a"), stroke("b"));
  doc.pages[1].strokes.push(stroke("c"), stroke("d"), stroke("e"));
  doc.pages[2].strokes.push(stroke("f"));
  return doc;
}

function ids(doc: InkDocument, pageId: string): string[] {
  return (pageById(doc, pageId)?.strokes ?? []).map((s) => s.id);
}

function assertRoundTrip(doc: InkDocument, cmd: Command): void {
  const before = JSON.stringify(doc);
  cmd.apply(doc);
  const after = JSON.stringify(doc);
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: undo`).toBe(before);
  cmd.apply(doc);
  expect(JSON.stringify(doc), `${cmd.label}: redo`).toBe(after);
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: undo after redo`).toBe(before);
}

function assertNoOp(doc: InkDocument, cmd: Command): void {
  const before = JSON.stringify(doc);
  cmd.apply(doc);
  expect(JSON.stringify(doc), `${cmd.label}: no-op apply`).toBe(before);
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: no-op invert`).toBe(before);
}

describe("AddStrokeToPage", () => {
  it("appends to the addressed page and leaves the others untouched", () => {
    const doc = threePages();
    const cmd = new AddStrokeToPage("p2", stroke("new"));
    cmd.apply(doc);
    expect(ids(doc, "p2")).toEqual(["c", "d", "e", "new"]);
    expect(ids(doc, "p1")).toEqual(["a", "b"]);
    expect(ids(doc, "p3")).toEqual(["f"]);
    cmd.invert(doc);
    expect(ids(doc, "p2")).toEqual(["c", "d", "e"]);
  });

  it("round-trips exactly, on the first page and on the last", () => {
    assertRoundTrip(threePages(), new AddStrokeToPage("p1", stroke("new")));
    assertRoundTrip(threePages(), new AddStrokeToPage("p3", stroke("new")));
  });

  it("is a no-op for an unknown page id", () => {
    assertNoOp(threePages(), new AddStrokeToPage("nope", stroke("new")));
  });

  it("inverts cleanly when the stroke has already been erased", () => {
    const doc = threePages();
    const cmd = new AddStrokeToPage("p2", stroke("new"));
    cmd.apply(doc);
    doc.pages[1].strokes = doc.pages[1].strokes.filter((s) => s.id !== "new");
    const before = JSON.stringify(doc);
    cmd.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("AddTextBoxToPage", () => {
  it("adds only to its addressed page and round-trips through undo", () => {
    const doc = threePages();
    const textBox = {
      id: "t1",
      x: 20,
      y: 40,
      w: 320,
      text: "A note",
      color: "#1a1a1a",
      fontSize: 22,
    };
    const command = new AddTextBoxToPage("p2", textBox);
    command.apply(doc);
    expect(doc.pages[1].textBoxes).toEqual([textBox]);
    expect(doc.pages[0].textBoxes).toEqual([]);
    command.invert(doc);
    expect(doc.pages[1].textBoxes).toEqual([]);
  });

  it("is a no-op for an unknown page", () => {
    assertNoOp(
      threePages(),
      new AddTextBoxToPage("nope", {
        id: "t1",
        x: 0,
        y: 0,
        w: 320,
        text: "",
        color: "#1a1a1a",
        fontSize: 22,
      }),
    );
  });
});

describe("RemoveTextBoxFromPage", () => {
  function note(id: string) {
    return { id, x: 0, y: 0, w: 200, text: "", color: "#1a1a1a", fontSize: 22 };
  }

  it("removes the box and restores it at the same index", () => {
    const doc = threePages();
    doc.pages[1].textBoxes.push(note("t1"), note("t2"), note("t3"));
    const cmd = new RemoveTextBoxFromPage("p2", "t2");
    cmd.apply(doc);
    expect(doc.pages[1].textBoxes.map((t) => t.id)).toEqual(["t1", "t3"]);
    cmd.invert(doc);
    expect(doc.pages[1].textBoxes.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("round-trips exactly", () => {
    const doc = threePages();
    doc.pages[1].textBoxes.push(note("t1"), note("t2"));
    assertRoundTrip(doc, new RemoveTextBoxFromPage("p2", "t1"));
  });

  it("is a no-op for an unknown page or box", () => {
    const doc = threePages();
    doc.pages[1].textBoxes.push(note("t1"));
    assertNoOp(doc, new RemoveTextBoxFromPage("nope", "t1"));
    assertNoOp(doc, new RemoveTextBoxFromPage("p2", "nope"));
  });
});

describe("SetTextBoxFrame", () => {
  function withBox(): InkDocument {
    const doc = threePages();
    doc.pages[1].textBoxes.push({
      id: "t1",
      x: 20,
      y: 40,
      w: 320,
      text: "A note",
      color: "#1a1a1a",
      fontSize: 22,
    });
    return doc;
  }

  it("moves and sizes the box, and round-trips through undo", () => {
    const doc = withBox();
    const cmd = new SetTextBoxFrame("p2", "t1", { x: 50, y: 60, w: 200, h: 90 });
    cmd.apply(doc);
    expect(doc.pages[1].textBoxes[0]).toMatchObject({ x: 50, y: 60, w: 200, h: 90 });
    assertRoundTrip(withBox(), cmd);
  });

  it("restores an auto-height box to having no height at all", () => {
    const doc = withBox();
    const cmd = new SetTextBoxFrame("p2", "t1", { x: 20, y: 40, w: 320, h: 120 });
    cmd.apply(doc);
    cmd.invert(doc);
    expect("h" in doc.pages[1].textBoxes[0]).toBe(false);
  });

  it("drops a fitted box's fit flag on resize, and undo puts it back in place", () => {
    const fitted = (): InkDocument => {
      const doc = threePages();
      doc.pages[1].textBoxes.push({
        id: "t1",
        x: 20,
        y: 40,
        w: 60,
        fit: true,
        text: "Hi",
        color: "#1a1a1a",
        fontSize: 22,
      });
      return doc;
    };
    const doc = fitted();
    const cmd = new SetTextBoxFrame("p2", "t1", { x: 20, y: 40, w: 200, h: 90 });
    cmd.apply(doc);
    expect("fit" in doc.pages[1].textBoxes[0]).toBe(false);
    // The key order is part of the saved bytes: undo must restore it too.
    assertRoundTrip(fitted(), cmd);
  });

  it("keeps a fitted box fitted when the frame says so (a move)", () => {
    const doc = withBox();
    new SetTextBoxFrame("p2", "t1", { x: 5, y: 5, w: 90, fit: true }).apply(doc);
    expect(doc.pages[1].textBoxes[0].fit).toBe(true);
  });

  it("is a no-op for an unknown page or box", () => {
    assertNoOp(withBox(), new SetTextBoxFrame("nope", "t1", { x: 0, y: 0, w: 100 }));
    assertNoOp(withBox(), new SetTextBoxFrame("p2", "nope", { x: 0, y: 0, w: 100 }));
  });
});

describe("RemoveStrokesFromPage", () => {
  it("restores every removed stroke at its original index", () => {
    const doc = threePages();
    const cmd = new RemoveStrokesFromPage("p2", new Set(["c", "e"]));
    cmd.apply(doc);
    expect(ids(doc, "p2")).toEqual(["d"]);
    cmd.invert(doc);
    expect(ids(doc, "p2")).toEqual(["c", "d", "e"]);
  });

  it("round-trips whether it removes one, some or all of a page's strokes", () => {
    assertRoundTrip(threePages(), new RemoveStrokesFromPage("p2", new Set(["d"])));
    assertRoundTrip(threePages(), new RemoveStrokesFromPage("p2", new Set(["c", "e"])));
    assertRoundTrip(threePages(), new RemoveStrokesFromPage("p2", new Set(["c", "d", "e"])));
  });

  it("only erases from the page it was addressed to", () => {
    // Ids repeat across pages in a real notebook; erasing on page 2 must not
    // reach page 1.
    const doc = emptyDocument();
    doc.pages.push(blankPage("p2"));
    doc.pages[0].strokes.push(stroke("same"));
    doc.pages[1].strokes.push(stroke("same"));
    new RemoveStrokesFromPage("p2", new Set(["same"])).apply(doc);
    expect(ids(doc, "p1")).toEqual(["same"]);
    expect(ids(doc, "p2")).toEqual([]);
  });

  it("is a no-op for an unknown page id or a set that matches nothing", () => {
    assertNoOp(threePages(), new RemoveStrokesFromPage("nope", new Set(["c"])));
    assertNoOp(threePages(), new RemoveStrokesFromPage("p2", new Set(["zzz"])));
    assertNoOp(threePages(), new RemoveStrokesFromPage("p2", new Set()));
  });

  it("takes a custom label for the undo menu", () => {
    expect(new RemoveStrokesFromPage("p1", new Set(), "Delete selection").label).toBe(
      "Delete selection",
    );
    expect(new RemoveStrokesFromPage("p1", new Set()).label).toBe("Erase");
  });
});

describe("MoveStrokesOnPage", () => {
  it("translates only the selected strokes on only the addressed page", () => {
    const doc = threePages();
    const cmd = new MoveStrokesOnPage("p2", new Set(["c"]), 5, -3);
    cmd.apply(doc);
    expect(doc.pages[1].strokes[0].pts).toEqual([6, -1, 0.5, 8, 1, 0.5]);
    expect(doc.pages[1].strokes[1].pts).toEqual([1, 2, 0.5, 3, 4, 0.5]);
    expect(doc.pages[0].strokes[0].pts).toEqual([1, 2, 0.5, 3, 4, 0.5]);
    cmd.invert(doc);
    expect(doc.pages[1].strokes[0].pts).toEqual([1, 2, 0.5, 3, 4, 0.5]);
  });

  it("never touches the pressure channel", () => {
    const doc = threePages();
    new MoveStrokesOnPage("p1", new Set(["a"]), 7, 9).apply(doc);
    expect(doc.pages[0].strokes[0].pts[2]).toBe(0.5);
    expect(doc.pages[0].strokes[0].pts[5]).toBe(0.5);
  });

  it("round-trips exactly for integer coordinates and deltas", () => {
    assertRoundTrip(threePages(), new MoveStrokesOnPage("p1", new Set(["a", "b"]), 40, -25));
  });

  it("round-trips through quantization even where binary floats do not cancel", () => {
    // `x + d - d !== x` in IEEE 754 for plenty of ordinary values (3.45 - 12.5
    // + 12.5 lands one ulp low), so a raw translate-and-undo can leave a
    // coordinate a hair off. What must hold is that the document *as written
    // to disk* is unchanged: serialize quantizes to 1/100 px.
    for (const [dx, dy] of [
      [0.2, 0.2],
      [7.77, -12.5],
      [-1234.5678, 0.001],
    ]) {
      const doc = emptyDocument();
      doc.pages[0].strokes.push(
        stroke(
          "a",
          dequantizePts(quantizePts([0.1, 0.1, 0.5, 12.34, 567.89, 0.5, 90.12, 3.45, 0.7])),
        ),
      );
      const quantizedBefore = quantizePts(doc.pages[0].strokes[0].pts);
      const cmd = new MoveStrokesOnPage("p1", new Set(["a"]), dx, dy);
      cmd.apply(doc);
      cmd.invert(doc);
      expect(quantizePts(doc.pages[0].strokes[0].pts)).toEqual(quantizedBefore);
    }
  });

  it("is a no-op for an unknown page id, an empty set, or a zero delta", () => {
    assertNoOp(threePages(), new MoveStrokesOnPage("nope", new Set(["c"]), 5, 5));
    assertNoOp(threePages(), new MoveStrokesOnPage("p2", new Set(), 5, 5));
    assertNoOp(threePages(), new MoveStrokesOnPage("p2", new Set(["c"]), 0, 0));
  });

  it("never changes how many numbers a well-formed stroke has", () => {
    // NOTE for the orchestrator: this holds only while `pts.length` is a
    // multiple of 3. With a ragged stroke (e.g. `[10, 20, 0.5, 30]`) the
    // translate loop writes one slot past the end and *grows* the array with a
    // NaN. See the report; not fixed here, this file may not touch src/.
    const doc = emptyDocument();
    doc.pages[0].strokes.push(stroke("a", [10, 20, 0.5, 30, 40, 0.5, 50, 60, 0.5]));
    new MoveStrokesOnPage("p1", new Set(["a"]), 1, 2).apply(doc);
    expect(doc.pages[0].strokes[0].pts).toEqual([11, 22, 0.5, 31, 42, 0.5, 51, 62, 0.5]);
    expect(doc.pages[0].strokes[0].pts.every(Number.isFinite)).toBe(true);
  });
});

describe("ClearPage", () => {
  it("clears one page and restores it, leaving neighbours alone", () => {
    const doc = threePages();
    const cmd = new ClearPage("p2");
    cmd.apply(doc);
    expect(ids(doc, "p2")).toEqual([]);
    expect(ids(doc, "p1")).toEqual(["a", "b"]);
    cmd.invert(doc);
    expect(ids(doc, "p2")).toEqual(["c", "d", "e"]);
  });

  it("round-trips, including on a page that is already empty", () => {
    assertRoundTrip(threePages(), new ClearPage("p2"));
    const doc = threePages();
    doc.pages[1].strokes = [];
    assertRoundTrip(doc, new ClearPage("p2"));
  });

  it("leaves images alone — it clears ink, not the page", () => {
    const doc = threePages();
    doc.pages[1].images.push({ id: "i1", path: "a.png", x: 0, y: 0, w: 10, h: 10 });
    new ClearPage("p2").apply(doc);
    expect(doc.pages[1].images).toHaveLength(1);
  });

  it("is a no-op for an unknown page id", () => {
    assertNoOp(threePages(), new ClearPage("nope"));
  });
});

describe("CompositeCommand", () => {
  it("applies in order and inverts in reverse order", () => {
    const trace: string[] = [];
    const part = (name: string): Command => ({
      label: name,
      apply: () => void trace.push(`+${name}`),
      invert: () => void trace.push(`-${name}`),
    });
    const composite = new CompositeCommand("Erase across pages", [part("a"), part("b"), part("c")]);
    const doc = threePages();
    composite.apply(doc);
    composite.invert(doc);
    expect(trace).toEqual(["+a", "+b", "+c", "-c", "-b", "-a"]);
  });

  it("undoes an eraser drag that crossed a page gap as one step", () => {
    const doc = threePages();
    const composite = new CompositeCommand("Erase", [
      new RemoveStrokesFromPage("p1", new Set(["b"])),
      new RemoveStrokesFromPage("p2", new Set(["c", "d"])),
    ]);
    assertRoundTrip(doc, composite);
    composite.apply(doc);
    expect(ids(doc, "p1")).toEqual(["a"]);
    expect(ids(doc, "p2")).toEqual(["e"]);
  });

  it("reverse order matters when the parts touch the same stroke", () => {
    // Add a stroke then erase it. Undoing forwards would re-add before
    // un-erasing and leave a duplicate; reverse order is what makes it work.
    const doc = threePages();
    const composite = new CompositeCommand("Draw and erase", [
      new AddStrokeToPage("p3", stroke("temp")),
      new RemoveStrokesFromPage("p3", new Set(["temp"])),
    ]);
    assertRoundTrip(doc, composite);
    composite.apply(doc);
    expect(ids(doc, "p3")).toEqual(["f"]);
    composite.invert(doc);
    expect(ids(doc, "p3")).toEqual(["f"]);
  });

  it("an empty composite is a no-op", () => {
    assertNoOp(threePages(), new CompositeCommand("Nothing", []));
  });
});

describe("pageToInsertAfter", () => {
  it("inherits the geometry and backdrop of the page it follows", () => {
    const doc = threePages();
    doc.pages[1].geometry = { width: 800, height: 1200 };
    doc.pages[1].backdrop = { kind: "cornell", spacing: 40, paperColor: "#fbf8ed" };
    const result = pageToInsertAfter(doc, 1);
    expect(result?.index).toBe(2);
    expect(result?.page.geometry).toEqual({ width: 800, height: 1200 });
    expect(result?.page.backdrop).toEqual({ kind: "cornell", spacing: 40, paperColor: "#fbf8ed" });
    expect(result?.page.strokes).toEqual([]);
    expect(result?.page.images).toEqual([]);
  });

  it("copies the geometry rather than aliasing it", () => {
    const doc = threePages();
    const result = pageToInsertAfter(doc, 0);
    result!.page.geometry.width = 1;
    expect(doc.pages[0].geometry.width).not.toBe(1);
  });

  it("copies the backdrop rather than aliasing it", () => {
    const doc = threePages();
    doc.pages[0].backdrop = { kind: "lined", spacing: 40 };
    const result = pageToInsertAfter(doc, 0);
    (result!.page.backdrop as { spacing?: number }).spacing = 99;
    expect((doc.pages[0].backdrop as { spacing?: number }).spacing).toBe(40);
  });

  it("does not inherit a PDF backdrop — it points at one specific source page", () => {
    const doc = threePages();
    doc.pages[2].backdrop = { kind: "pdf", path: "Slides/deck.pdf", page: 3 };
    expect(pageToInsertAfter(doc, 2)?.page.backdrop).toEqual({ kind: "blank" });
  });

  it("gives the new page an id that is free in this document", () => {
    const doc = threePages();
    const result = pageToInsertAfter(doc, 0);
    expect(doc.pages.some((p) => p.id === result?.page.id)).toBe(false);
  });

  it("falls back to the last page as the template for an out-of-range index", () => {
    const doc = threePages();
    doc.pages[2].geometry = { width: 640, height: 480 };
    expect(pageToInsertAfter(doc, 99)?.page.geometry).toEqual({ width: 640, height: 480 });
  });

  it("returns null for a document with no pages at all", () => {
    const doc: InkDocument = { version: 2, view: { scrollY: 0, width: 1024, scale: 1 }, pages: [] };
    expect(pageToInsertAfter(doc, 0)).toBeNull();
  });
});

describe("nextPageId", () => {
  it("is max + 1, never count + 1, so a deleted id is not reused", () => {
    const doc = emptyDocument();
    doc.pages = [blankPage("p1"), blankPage("p7")];
    expect(nextPageId(doc)).toBe("p8");
  });

  it("ignores ids that are not p<digits>", () => {
    const doc = emptyDocument();
    doc.pages = [blankPage("cover"), blankPage("p-001"), blankPage("p2x"), blankPage("p3")];
    expect(nextPageId(doc)).toBe("p4");
  });

  it("starts at p1 for a document with no numbered pages", () => {
    const doc: InkDocument = { version: 2, view: { scrollY: 0, width: 1024, scale: 1 }, pages: [] };
    expect(nextPageId(doc)).toBe("p1");
  });
});
