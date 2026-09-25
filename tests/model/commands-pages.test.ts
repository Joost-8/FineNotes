/**
 * The seven GoodObsidian commands of contracts/api.md §3, plus the page
 * helpers in `document.ts` they are built from.
 *
 * The central assertion is the same for every one of them: **apply -> invert
 * leaves the document `JSON.stringify`-identical, and apply again reproduces
 * the applied state exactly.** Undo that is merely "equal" is not undo — a
 * changed key order or a resurrected key changes what gets written to the
 * vault, and the history stack replays these in both directions forever.
 *
 * `JSON.stringify` alone is not enough for the one thing the contract calls
 * out by name: it *drops* `undefined` properties, so `{rotation: undefined}`
 * and a deleted `rotation` stringify identically. Those are checked with
 * explicit key assertions instead.
 */

import { describe, expect, it } from "vitest";
import {
  type Command,
  AddPage,
  InsertImage,
  RemoveImage,
  RemovePage,
  SetBackdrop,
  SnapStrokeToShape,
  TransformImage,
} from "../../src/model/commands";
import {
  type ImageElement,
  type InkDocument,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
  imageById,
  insertPage,
  pageById,
  pageIndexById,
  removePageAt,
  strokeById,
} from "../../src/model/document";

function stroke(id: string, pts: number[] = [1, 2, 0.5, 3, 4, 0.5]): Stroke {
  return { id, color: "#1a1a1a", size: 3, tool: "pen", pts };
}

function image(id: string, x = 10, y = 20): ImageElement {
  return { id, path: `Attachments/${id}.png`, x, y, w: 100, h: 80 };
}

function page(id: string): Page {
  const p = blankPage(id);
  p.strokes.push(stroke(`${id}-s1`));
  return p;
}

/** A three-page document with ink, images and a snapped stroke on it. */
function sampleDoc(): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].strokes.push(stroke("s1"), { ...stroke("s2"), shape: "line" });
  doc.pages[0].images.push(image("i1"), { ...image("i2", 300, 40), rotation: 0.3 }, image("i3"));
  doc.pages.push(page("p2"), page("p3"));
  doc.pages[1].backdrop = { kind: "ruled-wide", spacing: 40, color: "#ccd5e0" };
  doc.pages[2].backdrop = { kind: "pdf", path: "Slides/week1.pdf", page: 4 };
  return doc;
}

/**
 * apply -> invert -> apply -> invert, asserting exact JSON identity at every
 * stage. A command that is only correct on the first undo is not correct.
 */
function assertRoundTrip(doc: InkDocument, cmd: Command): { before: string; after: string } {
  const before = JSON.stringify(doc);
  cmd.apply(doc);
  const after = JSON.stringify(doc);
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: undo`).toBe(before);
  cmd.apply(doc);
  expect(JSON.stringify(doc), `${cmd.label}: redo`).toBe(after);
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: undo after redo`).toBe(before);
  return { before, after };
}

/** A command whose apply() changes nothing must still invert to nothing. */
function assertNoOp(doc: InkDocument, cmd: Command): void {
  const before = JSON.stringify(doc);
  cmd.apply(doc);
  expect(JSON.stringify(doc), `${cmd.label}: no-op apply`).toBe(before);
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: no-op invert`).toBe(before);
  // An invert with no preceding apply is what a corrupted history replays.
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: bare invert`).toBe(before);
}

describe("AddPage", () => {
  it("round-trips at the front, the middle and the end", () => {
    for (const index of [0, 1, 3]) {
      const doc = sampleDoc();
      const { after } = assertRoundTrip(doc, new AddPage(index, page("pNew")));
      expect(JSON.parse(after).pages[index].id).toBe("pNew");
    }
  });

  it("clamps an out-of-range index and still inverts exactly", () => {
    const doc = sampleDoc();
    assertRoundTrip(doc, new AddPage(99, page("pNew")));
    const negative = sampleDoc();
    assertRoundTrip(negative, new AddPage(-5, page("pNew")));
  });

  it("inverts by page id, not by the raw index it was handed", () => {
    // `insertPage` clamps, so an inverse that trusted `index` would delete a
    // page the user still has.
    const doc = sampleDoc();
    const cmd = new AddPage(99, page("pNew"));
    cmd.apply(doc);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p2", "p3", "pNew"]);
    cmd.invert(doc);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("is the inverse of RemovePage at the same index, per the contract table", () => {
    const doc = sampleDoc();
    const before = JSON.stringify(doc);
    new AddPage(1, page("pNew")).apply(doc);
    new RemovePage(1).apply(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("preserves the added page's strokes and images through a round-trip", () => {
    const doc = sampleDoc();
    const rich = page("pRich");
    rich.images.push({ ...image("ri1"), rotation: 1.2 });
    const cmd = new AddPage(1, rich);
    cmd.apply(doc);
    expect(doc.pages[1].strokes).toHaveLength(1);
    expect(doc.pages[1].images[0].rotation).toBe(1.2);
    cmd.invert(doc);
    cmd.apply(doc);
    expect(doc.pages[1].images[0].rotation).toBe(1.2);
  });
});

describe("RemovePage", () => {
  it("round-trips from every index", () => {
    for (const index of [0, 1, 2]) {
      assertRoundTrip(sampleDoc(), new RemovePage(index));
    }
  });

  it("restores the page at its original index, not at the end", () => {
    const doc = sampleDoc();
    const cmd = new RemovePage(1);
    cmd.apply(doc);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p3"]);
    cmd.invert(doc);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("is a no-op on the last remaining page, and so is its inverse", () => {
    const doc = emptyDocument();
    doc.pages[0].strokes.push(stroke("s1"));
    assertNoOp(doc, new RemovePage(0));
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].strokes).toHaveLength(1);
  });

  it("is a no-op for an out-of-range or non-integer index", () => {
    for (const index of [-1, 3, 99, 1.5, NaN, Infinity]) {
      assertNoOp(sampleDoc(), new RemovePage(index));
    }
  });
});

describe("SetBackdrop", () => {
  const backdrops = [
    { kind: "blank" } as const,
    { kind: "dotted", spacing: 40 } as const,
    { kind: "cornell", color: "#aabbcc", paperColor: "#fbf8ed" } as const,
    { kind: "pdf", path: "Slides/deck.pdf", page: 7 } as const,
  ];

  it.each(backdrops.map((b) => [b.kind, b] as const))(
    "round-trips a %s backdrop",
    (_k, backdrop) => {
      assertRoundTrip(sampleDoc(), new SetBackdrop("p1", backdrop));
    },
  );

  it("restores the previous backdrop's exact key set, not a rebuilt one", () => {
    const doc = sampleDoc();
    // p3 is a PDF backdrop; swapping it for a blank and back must not leave a
    // stray `path`/`page` behind, nor lose them.
    const cmd = new SetBackdrop("p3", { kind: "blank" });
    cmd.apply(doc);
    expect(Object.keys(doc.pages[2].backdrop)).toEqual(["kind"]);
    cmd.invert(doc);
    expect(doc.pages[2].backdrop).toEqual({ kind: "pdf", path: "Slides/week1.pdf", page: 4 });
  });

  it("is a no-op for an unknown page id", () => {
    assertNoOp(sampleDoc(), new SetBackdrop("nope", { kind: "lined" }));
  });
});

describe("InsertImage", () => {
  it("round-trips a plain image and a rotated one", () => {
    assertRoundTrip(sampleDoc(), new InsertImage("p2", image("iNew")));
    assertRoundTrip(sampleDoc(), new InsertImage("p2", { ...image("iNew"), rotation: -0.4 }));
  });

  it("appends on top of the existing stack", () => {
    const doc = sampleDoc();
    const cmd = new InsertImage("p1", image("iNew"));
    cmd.apply(doc);
    expect(doc.pages[0].images.map((i) => i.id)).toEqual(["i1", "i2", "i3", "iNew"]);
    cmd.invert(doc);
    expect(doc.pages[0].images.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("is a no-op for an unknown page id", () => {
    assertNoOp(sampleDoc(), new InsertImage("nope", image("iNew")));
  });

  it("inverts cleanly even if the image was already removed by something else", () => {
    const doc = sampleDoc();
    const cmd = new InsertImage("p1", image("iNew"));
    cmd.apply(doc);
    doc.pages[0].images = doc.pages[0].images.filter((i) => i.id !== "iNew");
    const before = JSON.stringify(doc);
    cmd.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("TransformImage", () => {
  it("round-trips a move, a resize and a rotation", () => {
    assertRoundTrip(
      sampleDoc(),
      new TransformImage("p1", "i1", { x: 200, y: 300, w: 400, h: 500 }),
    );
    assertRoundTrip(
      sampleDoc(),
      new TransformImage("p1", "i2", { x: 5, y: 6, w: 7, h: 8, rotation: 1.4 }),
    );
  });

  it("DELETES rotation rather than setting it to undefined when undoing to none", () => {
    // contracts/api.md §3. `toEqual` and `JSON.stringify` both treat
    // `{rotation: undefined}` as absent, so this needs a key check.
    const doc = sampleDoc();
    const img = () => doc.pages[0].images[0];
    expect(Object.keys(img())).not.toContain("rotation");
    const cmd = new TransformImage("p1", "i1", { x: 1, y: 2, w: 3, h: 4, rotation: 0.9 });
    cmd.apply(doc);
    expect(img().rotation).toBe(0.9);
    cmd.invert(doc);
    expect(Object.keys(img())).not.toContain("rotation");
    expect(Object.prototype.hasOwnProperty.call(img(), "rotation")).toBe(false);
  });

  it("DELETES rotation on apply too, when the new box has none", () => {
    const doc = sampleDoc();
    const img = () => doc.pages[0].images[1];
    expect(img().rotation).toBe(0.3);
    const cmd = new TransformImage("p1", "i2", { x: 1, y: 2, w: 3, h: 4 });
    cmd.apply(doc);
    expect(Object.prototype.hasOwnProperty.call(img(), "rotation")).toBe(false);
    cmd.invert(doc);
    expect(img().rotation).toBe(0.3);
  });

  it("keeps a rotation of exactly 0, which is not the same as absent", () => {
    const doc = sampleDoc();
    const cmd = new TransformImage("p1", "i1", { x: 1, y: 2, w: 3, h: 4, rotation: 0 });
    cmd.apply(doc);
    expect(Object.prototype.hasOwnProperty.call(doc.pages[0].images[0], "rotation")).toBe(true);
    expect(doc.pages[0].images[0].rotation).toBe(0);
    cmd.invert(doc);
    expect(Object.prototype.hasOwnProperty.call(doc.pages[0].images[0], "rotation")).toBe(false);
  });

  it("does not reorder the image within the stack", () => {
    const doc = sampleDoc();
    new TransformImage("p1", "i1", { x: 900, y: 900, w: 10, h: 10 }).apply(doc);
    expect(doc.pages[0].images.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("is a no-op for an unknown page or image id", () => {
    assertNoOp(sampleDoc(), new TransformImage("nope", "i1", { x: 1, y: 2, w: 3, h: 4 }));
    assertNoOp(sampleDoc(), new TransformImage("p1", "nope", { x: 1, y: 2, w: 3, h: 4 }));
  });
});

describe("RemoveImage", () => {
  it("round-trips from every position in the stack", () => {
    for (const id of ["i1", "i2", "i3"]) {
      assertRoundTrip(sampleDoc(), new RemoveImage("p1", id));
    }
  });

  it("restores z-order, not just membership (contracts/api.md §3)", () => {
    const doc = sampleDoc();
    const cmd = new RemoveImage("p1", "i2");
    cmd.apply(doc);
    expect(doc.pages[0].images.map((i) => i.id)).toEqual(["i1", "i3"]);
    cmd.invert(doc);
    expect(doc.pages[0].images.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("restores a rotated image with its rotation key intact", () => {
    const doc = sampleDoc();
    const cmd = new RemoveImage("p1", "i2");
    cmd.apply(doc);
    cmd.invert(doc);
    expect(Object.prototype.hasOwnProperty.call(doc.pages[0].images[1], "rotation")).toBe(true);
    expect(doc.pages[0].images[1].rotation).toBe(0.3);
  });

  it("is a no-op for an unknown page or image id", () => {
    assertNoOp(sampleDoc(), new RemoveImage("nope", "i1"));
    assertNoOp(sampleDoc(), new RemoveImage("p1", "nope"));
  });

  it("is the inverse of InsertImage with the removed element", () => {
    const doc = sampleDoc();
    const before = JSON.stringify(doc);
    const removed = { ...doc.pages[0].images[2] };
    new RemoveImage("p1", "i3").apply(doc);
    new InsertImage("p1", removed).apply(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("SnapStrokeToShape", () => {
  const snapped = [100, 100, 0.5, 400, 100, 0.5];

  it("round-trips a freehand stroke becoming a line", () => {
    assertRoundTrip(sampleDoc(), new SnapStrokeToShape("p1", "s1", snapped, "line"));
  });

  it("round-trips a re-snap of an already-snapped stroke", () => {
    assertRoundTrip(sampleDoc(), new SnapStrokeToShape("p1", "s2", snapped, "rect"));
  });

  it("DELETES shape on undo rather than setting it to undefined", () => {
    // contracts/api.md §3: an undone snap must be indistinguishable from never
    // having snapped, and `undefined` is not the same as absent on the wire.
    const doc = sampleDoc();
    const s = () => doc.pages[0].strokes[0];
    expect(Object.keys(s())).not.toContain("shape");
    const cmd = new SnapStrokeToShape("p1", "s1", snapped, "circle");
    cmd.apply(doc);
    expect(s().shape).toBe("circle");
    cmd.invert(doc);
    expect(Object.prototype.hasOwnProperty.call(s(), "shape")).toBe(false);
  });

  it("restores the previous shape kind when re-snapping a snapped stroke", () => {
    const doc = sampleDoc();
    const s = () => doc.pages[0].strokes[1];
    expect(s().shape).toBe("line");
    const cmd = new SnapStrokeToShape("p1", "s2", snapped, "arrow");
    cmd.apply(doc);
    expect(s().shape).toBe("arrow");
    cmd.invert(doc);
    expect(s().shape).toBe("line");
  });

  it("restores the exact original points, not a copy that lost precision", () => {
    const doc = sampleDoc();
    const original = [...doc.pages[0].strokes[0].pts];
    const cmd = new SnapStrokeToShape("p1", "s1", snapped, "line");
    cmd.apply(doc);
    cmd.invert(doc);
    expect(doc.pages[0].strokes[0].pts).toEqual(original);
  });

  it("leaves every other stroke field alone", () => {
    const doc = sampleDoc();
    const cmd = new SnapStrokeToShape("p1", "s1", snapped, "line");
    cmd.apply(doc);
    const s = doc.pages[0].strokes[0];
    expect(s.id).toBe("s1");
    expect(s.color).toBe("#1a1a1a");
    expect(s.size).toBe(3);
    expect(s.tool).toBe("pen");
  });

  it("is a no-op for an unknown page or stroke id", () => {
    assertNoOp(sampleDoc(), new SnapStrokeToShape("nope", "s1", snapped, "line"));
    assertNoOp(sampleDoc(), new SnapStrokeToShape("p1", "nope", snapped, "line"));
  });

  it("finds the stroke only on the page it was told about", () => {
    // A stroke id is unique per page, so looking on the wrong page must miss.
    assertNoOp(sampleDoc(), new SnapStrokeToShape("p2", "s1", snapped, "line"));
  });
});

describe("every command carries a human-readable label", () => {
  const commands: Command[] = [
    new AddPage(0, page("pX")),
    new RemovePage(0),
    new SetBackdrop("p1", { kind: "blank" }),
    new InsertImage("p1", image("iX")),
    new TransformImage("p1", "i1", { x: 0, y: 0, w: 1, h: 1 }),
    new RemoveImage("p1", "i1"),
    new SnapStrokeToShape("p1", "s1", [0, 0, 0.5, 1, 1, 0.5], "line"),
  ];

  it.each(commands.map((c) => [c.label, c] as const))("%s", (label) => {
    expect(label).toMatch(/^[A-Z][\w ]+$/);
  });
});

describe("document.ts page helpers", () => {
  it("insertPage clamps and reports where the page actually landed", () => {
    const doc = sampleDoc();
    expect(insertPage(doc, -10, page("a"))).toBe(0);
    expect(insertPage(doc, 999, page("b"))).toBe(doc.pages.length - 1);
    expect(insertPage(doc, 2.9, page("c"))).toBe(2);
    expect(doc.pages.map((p) => p.id)).toEqual(["a", "p1", "c", "p2", "p3", "b"]);
  });

  it("removePageAt refuses the last page and any bad index", () => {
    const single = emptyDocument();
    expect(removePageAt(single, 0)).toBeNull();
    const doc = sampleDoc();
    expect(removePageAt(doc, -1)).toBeNull();
    expect(removePageAt(doc, 3)).toBeNull();
    expect(removePageAt(doc, 1.5)).toBeNull();
    expect(removePageAt(doc, NaN)).toBeNull();
    expect(doc.pages).toHaveLength(3);
    expect(removePageAt(doc, 1)?.id).toBe("p2");
    expect(doc.pages).toHaveLength(2);
  });

  it("pageById / pageIndexById report a miss rather than throwing", () => {
    const doc = sampleDoc();
    expect(pageById(doc, "p2")?.id).toBe("p2");
    expect(pageById(doc, "nope")).toBeNull();
    expect(pageIndexById(doc, "p3")).toBe(2);
    expect(pageIndexById(doc, "nope")).toBe(-1);
  });

  it("strokeById and imageById are page-scoped", () => {
    const doc = sampleDoc();
    expect(strokeById(doc, "p1", "s1")?.id).toBe("s1");
    expect(strokeById(doc, "p2", "s1")).toBeNull();
    expect(strokeById(doc, "nope", "s1")).toBeNull();
    expect(imageById(doc, "p1", "i2")?.id).toBe("i2");
    expect(imageById(doc, "p2", "i2")).toBeNull();
    expect(imageById(doc, "nope", "i2")).toBeNull();
  });
});
