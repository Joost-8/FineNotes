/**
 * `src/model/selection-commands.ts` — one undo step per lasso action, each
 * restoring the document exactly.
 */

import { describe, expect, it } from "vitest";
import {
  AddElements,
  MoveElementsToPage,
  RecolorStrokes,
  RemoveElements,
  ReshapeStroke,
  ScaleElements,
  TranslateElements,
  copyElements,
  elementsOnPage,
  isEmptySelection,
  scalePoints,
  textScaleRange,
  translatePoints,
} from "../../src/model/selection-commands";
import {
  type GraphElement,
  type ImageElement,
  type InkDocument,
  type Stroke,
  type TableElement,
  type TextBoxElement,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { History } from "../../src/model/history";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function stroke(id: string, x = 0.1, extra: Partial<Stroke> = {}): Stroke {
  return {
    id,
    color: "#000000",
    size: 2,
    tool: "pen",
    pts: [x, 0.2, 0.5, x + 10.3, 20.7, 0.6],
    ...extra,
  };
}

function image(id: string, extra: Partial<ImageElement> = {}): ImageElement {
  return { id, path: "pic.png", x: 10.1, y: 20.2, w: 100, h: 50, ...extra };
}

function textBox(id: string, extra: Partial<TextBoxElement> = {}): TextBoxElement {
  return { id, x: 30.3, y: 40.4, w: 200, text: "hello", color: "#111111", fontSize: 18, ...extra };
}

function fixture(): {
  doc: InkDocument;
  s: Stroke[];
  i: ImageElement[];
  t: TextBoxElement[];
} {
  const s = [
    stroke("s1"),
    stroke("s2", 0.3, { shape: "rect", t0: 12 }),
    stroke("s3", 0.7, { tool: "highlighter" }),
  ];
  const i = [image("i1"), image("i2", { rotation: 0.3 })];
  const t = [textBox("t1"), textBox("t2", { h: 60, bold: true })];
  const doc = emptyDocument();
  doc.pages = [
    { ...blankPage("p1"), strokes: [...s], images: [...i], textBoxes: [...t] },
    { ...blankPage("p2"), strokes: [stroke("s9")] },
  ];
  return { doc, s, i, t };
}

const snap = (doc: InkDocument): string => JSON.stringify(doc);

describe("helpers", () => {
  it("translates whole points only and leaves the input alone", () => {
    const pts = [1, 2, 0.5, 3, 4, 0.5, 99];
    const out = translatePoints(pts, 10, 20);
    expect(out).toEqual([11, 22, 0.5, 13, 24, 0.5, 99]);
    expect(pts).toEqual([1, 2, 0.5, 3, 4, 0.5, 99]);
  });

  it("finds a selection's elements on a page in page order, by identity", () => {
    const { doc, s, i, t } = fixture();
    const lookalike = stroke("s1");
    const on = elementsOnPage(doc.pages[0], {
      strokes: [s[2], lookalike, s[0]],
      images: [i[1]],
      textBoxes: [],
    });
    expect(on.strokes).toEqual([s[0], s[2]]);
    expect(on.strokes[0]).toBe(s[0]);
    expect(on.images).toEqual([i[1]]);
    expect(on.textBoxes).toEqual([]);
    expect(t.length).toBe(2);
  });

  it("knows an empty selection", () => {
    expect(isEmptySelection({ strokes: [], images: [], textBoxes: [] })).toBe(true);
    expect(isEmptySelection({ strokes: [], images: [], textBoxes: [textBox("t")] })).toBe(false);
  });
});

describe("TranslateElements", () => {
  it("moves strokes, images and text boxes together as one step", () => {
    const { doc, s, i, t } = fixture();
    const cmd = new TranslateElements(
      "p1",
      { strokes: [s[0], s[1]], images: [i[1]], textBoxes: [t[1]] },
      5,
      -7,
    );
    cmd.apply(doc);
    expect(s[0].pts).toEqual([5.1, 0.2 - 7, 0.5, 0.1 + 10.3 + 5, 20.7 - 7, 0.6]);
    expect(s[2].pts[0]).toBe(0.7);
    expect(i[1]).toMatchObject({ x: 15.1, y: 13.2, w: 100, h: 50, rotation: 0.3 });
    expect(i[0].x).toBe(10.1);
    expect(t[1]).toMatchObject({ x: 35.3, y: 40.4 - 7, w: 200, h: 60 });
    expect(t[0].x).toBe(30.3);
  });

  it("undoes JSON-identically, where subtracting the move would drift", () => {
    const { doc, s, i, t } = fixture();
    const before = snap(doc);
    // 0.1 + 0.2 - 0.2 !== 0.1: an inverse that moved back by -dx would drift.
    const cmd = new TranslateElements("p1", { strokes: s, images: i, textBoxes: t }, 0.2, 0.7);
    cmd.apply(doc);
    expect(snap(doc)).not.toBe(before);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
  });

  it("redoes to exactly the same place", () => {
    const { doc, s, i, t } = fixture();
    const history = new History();
    history.push(
      doc,
      new TranslateElements("p1", { strokes: s, images: i, textBoxes: t }, 3.3, 4.4),
    );
    const moved = snap(doc);
    history.undo(doc);
    history.redo(doc);
    expect(snap(doc)).toBe(moved);
    history.undo(doc);
    history.undo(doc);
    expect(snap(doc)).toBe(snap(fixture().doc));
  });

  it("leaves alone elements no longer on the page, and a missing page", () => {
    const { doc, s } = fixture();
    const gone = stroke("gone");
    const cmd = new TranslateElements("p1", { strokes: [gone], images: [], textBoxes: [] }, 1, 1);
    cmd.apply(doc);
    expect(gone.pts[0]).toBe(0.1);
    const before = snap(doc);
    const lost = new TranslateElements("nope", { strokes: s, images: [], textBoxes: [] }, 1, 1);
    lost.apply(doc);
    lost.invert(doc);
    expect(snap(doc)).toBe(before);
  });

  it("moves the object, not a lookalike with the same id", () => {
    const { doc, s } = fixture();
    const twin = stroke("s1", 500);
    doc.pages[0].strokes.push(twin);
    new TranslateElements("p1", { strokes: [twin], images: [], textBoxes: [] }, 1, 0).apply(doc);
    expect(twin.pts[0]).toBe(501);
    expect(s[0].pts[0]).toBe(0.1);
  });
});

describe("MoveElementsToPage", () => {
  it("moves the same objects to the other page, shifted, above what is there", () => {
    const { doc, s, i, t } = fixture();
    const cmd = new MoveElementsToPage(
      "p1",
      "p2",
      { strokes: [s[0]], images: [i[1]], textBoxes: [t[0]] },
      5,
      -7,
    );
    cmd.apply(doc);
    const [p1, p2] = doc.pages;
    expect(p1.strokes).toEqual([s[1], s[2]]);
    expect(p1.images).toEqual([i[0]]);
    expect(p1.textBoxes).toEqual([t[1]]);
    expect(p2.strokes.map((each) => each.id)).toEqual(["s9", "s1"]);
    expect(p2.strokes[1]).toBe(s[0]);
    expect(s[0].pts).toEqual([5.1, 0.2 - 7, 0.5, 0.1 + 10.3 + 5, 20.7 - 7, 0.6]);
    expect(p2.images).toEqual([i[1]]);
    expect(i[1]).toMatchObject({ x: 15.1, y: 13.2, rotation: 0.3 });
    expect(p2.textBoxes).toEqual([t[0]]);
    expect(t[0]).toMatchObject({ x: 35.3, y: 40.4 - 7 });
  });

  it("undoes JSON-identically on both pages, and redoes to the same place", () => {
    const { doc, s, i, t } = fixture();
    const before = snap(doc);
    const history = new History();
    history.push(
      doc,
      new MoveElementsToPage("p1", "p2", { strokes: s, images: i, textBoxes: t }, 0.2, 0.7),
    );
    const moved = snap(doc);
    expect(moved).not.toBe(before);
    history.undo(doc);
    expect(snap(doc)).toBe(before);
    history.redo(doc);
    expect(snap(doc)).toBe(moved);
    history.undo(doc);
    expect(snap(doc)).toBe(before);
  });

  it("gives the target its first tables and graphs, and takes them away on undo", () => {
    const { doc } = fixture();
    const table = {
      id: "g1",
      x: 1,
      y: 2,
      w: 100,
      rows: 1,
      cols: 1,
      cells: [[""]],
    } as unknown as TableElement;
    const graph = { id: "f1", x: 3, y: 4, w: 50, h: 50 } as unknown as GraphElement;
    doc.pages[0].tables = [table];
    doc.pages[0].graphs = [graph];
    const before = snap(doc);
    const cmd = new MoveElementsToPage(
      "p1",
      "p2",
      { strokes: [], images: [], textBoxes: [], tables: [table], graphs: [graph] },
      10,
      10,
    );
    cmd.apply(doc);
    expect(doc.pages[1].tables).toEqual([table]);
    expect(doc.pages[1].graphs).toEqual([graph]);
    expect(table).toMatchObject({ x: 11, y: 12 });
    expect(doc.pages[0].tables).toEqual([]);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
    expect("tables" in doc.pages[1]).toBe(false);
  });

  it("carries links and tasks whose strokes all move; a split one keeps those that stay", () => {
    const { doc, s } = fixture();
    const p1 = doc.pages[0];
    p1.links = [
      { id: "l1", strokes: ["s1"], target: "Signals" },
      { id: "l2", strokes: ["s2", "s3"], target: "https://example.org" },
      { id: "l3", strokes: ["s3"], target: "Other" },
    ];
    p1.tasks = [{ id: "ck1", strokes: ["s1", "s2"], text: "Do it" }];
    doc.pages[1].links = [{ id: "l9", strokes: ["s9"], target: "There" }];
    const before = snap(doc);
    const cmd = new MoveElementsToPage(
      "p1",
      "p2",
      { strokes: [s[0], s[1]], images: [], textBoxes: [] },
      0,
      0,
    );
    cmd.apply(doc);
    expect(p1.links).toEqual([
      { id: "l2", strokes: ["s3"], target: "https://example.org" },
      { id: "l3", strokes: ["s3"], target: "Other" },
    ]);
    expect(doc.pages[1].links?.map((link) => link.id)).toEqual(["l9", "l1"]);
    expect(p1.tasks).toBeUndefined();
    expect(doc.pages[1].tasks).toEqual([{ id: "ck1", strokes: ["s1", "s2"], text: "Do it" }]);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
  });

  it("re-bases a stroke's time on the target's epoch, and drops one that would fall before it", () => {
    const { doc } = fixture();
    const early = stroke("e1", 1, { t0: 500 });
    const late = stroke("e2", 2, { t0: 5000 });
    doc.pages[0].strokes.push(early, late);
    doc.pages[0].epoch = 1_000_000;
    doc.pages[1].epoch = 1_002_000;
    const before = snap(doc);
    const cmd = new MoveElementsToPage(
      "p1",
      "p2",
      { strokes: [early, late], images: [], textBoxes: [] },
      0,
      0,
    );
    cmd.apply(doc);
    expect(early.t0).toBeUndefined();
    expect(late.t0).toBe(3000);
    cmd.invert(doc);
    // Key order too: t0 comes back where it was, not at the end.
    expect(snap(doc)).toBe(before);
  });

  it("gives a target without an epoch the source's, so times keep their meaning", () => {
    const { doc, s } = fixture();
    doc.pages[0].epoch = 42;
    const before = snap(doc);
    const cmd = new MoveElementsToPage(
      "p1",
      "p2",
      { strokes: [s[1]], images: [], textBoxes: [] },
      0,
      0,
    );
    cmd.apply(doc);
    expect(doc.pages[1].epoch).toBe(42);
    expect(s[1].t0).toBe(12);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
    expect("epoch" in doc.pages[1]).toBe(false);
  });

  it("keeps ink on a note that moves with it; ink whose note stays is plain ink", () => {
    const { doc, i } = fixture();
    const onMoved = stroke("n1", 1, { onSticky: "i1" });
    const onStaying = stroke("n2", 2, { onSticky: "i2" });
    doc.pages[0].strokes.push(onMoved, onStaying);
    const before = snap(doc);
    const cmd = new MoveElementsToPage(
      "p1",
      "p2",
      { strokes: [onMoved, onStaying], images: [i[0]], textBoxes: [] },
      0,
      0,
    );
    cmd.apply(doc);
    expect(onMoved.onSticky).toBe("i1");
    expect(onStaying.onSticky).toBeUndefined();
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
  });

  it("does nothing for its own page, a missing page, or nothing left to move", () => {
    const { doc, s } = fixture();
    const before = snap(doc);
    for (const cmd of [
      new MoveElementsToPage("p1", "p1", { strokes: s, images: [], textBoxes: [] }, 1, 1),
      new MoveElementsToPage("p1", "nope", { strokes: s, images: [], textBoxes: [] }, 1, 1),
      new MoveElementsToPage("nope", "p2", { strokes: s, images: [], textBoxes: [] }, 1, 1),
      new MoveElementsToPage(
        "p1",
        "p2",
        { strokes: [stroke("gone")], images: [], textBoxes: [] },
        1,
        1,
      ),
    ]) {
      cmd.apply(doc);
      expect(snap(doc)).toBe(before);
      cmd.invert(doc);
      expect(snap(doc)).toBe(before);
    }
  });

  it("survives a save and load on its new page", () => {
    const { doc, s } = fixture();
    new MoveElementsToPage("p1", "p2", { strokes: [s[0]], images: [], textBoxes: [] }, 3, 4).apply(
      doc,
    );
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[1].strokes.map((each) => each.id)).toEqual(["s9", "s1"]);
    expect(back.pages[0].strokes.map((each) => each.id)).toEqual(["s2", "s3"]);
  });
});

describe("RemoveElements", () => {
  it("deletes a mixed selection as one step and restores every index", () => {
    const { doc, s, i, t } = fixture();
    const before = snap(doc);
    const cmd = new RemoveElements("p1", {
      strokes: [s[0], s[2]],
      images: [i[0]],
      textBoxes: [t[0], t[1]],
    });
    cmd.apply(doc);
    expect(doc.pages[0].strokes).toEqual([s[1]]);
    expect(doc.pages[0].images).toEqual([i[1]]);
    expect(doc.pages[0].textBoxes).toEqual([]);
    expect(doc.pages[1].strokes.length).toBe(1);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
    expect(doc.pages[0].strokes[0]).toBe(s[0]);
    // Redo, and undo once more.
    cmd.apply(doc);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
  });

  it("does nothing on a missing page", () => {
    const { doc, s } = fixture();
    const before = snap(doc);
    const cmd = new RemoveElements("nope", { strokes: s, images: [], textBoxes: [] });
    cmd.apply(doc);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
  });
});

describe("AddElements and copyElements", () => {
  it("copies with fresh ids, moved, sharing image files and losing t0", () => {
    const { s, i, t } = fixture();
    let n = 0;
    const ids = {
      stroke: () => `s${100 + ++n}`,
      image: () => `i${100 + ++n}`,
      textBox: () => `t${100 + ++n}`,
      table: () => `g${100 + ++n}`,
      graph: () => `f${100 + ++n}`,
    };
    const copies = copyElements(
      { strokes: [s[1]], images: [i[1]], textBoxes: [t[1]] },
      ids,
      24,
      24,
    );
    expect(copies.strokes[0]).toEqual({
      id: "s101",
      color: "#000000",
      size: 2,
      tool: "pen",
      shape: "rect",
      pts: [24.3, 24.2, 0.5, 0.3 + 10.3 + 24, 20.7 + 24, 0.6],
    });
    expect(copies.strokes[0].pts).not.toBe(s[1].pts);
    expect(s[1].t0).toBe(12);
    expect(copies.images[0]).toEqual({ ...i[1], id: "i102", x: 34.1, y: 44.2 });
    expect(copies.textBoxes[0]).toEqual({ ...t[1], id: "t103", x: 54.3, y: 64.4 });
    // Deep copies: the originals are untouched.
    expect(i[1].x).toBe(10.1);
    expect(t[1].x).toBe(30.3);
  });

  it("adds on top and undoes by identity", () => {
    const { doc, s, i, t } = fixture();
    const before = snap(doc);
    const copies = copyElements(
      { strokes: s, images: i, textBoxes: t },
      {
        stroke: () => "s1",
        image: () => "i1",
        textBox: () => "t1",
        table: () => "g1",
        graph: () => "f1",
      },
      0,
      0,
    );
    const cmd = new AddElements("p1", copies);
    expect(cmd.label).toBe("Duplicate selection");
    cmd.apply(doc);
    expect(doc.pages[0].strokes.length).toBe(6);
    expect(doc.pages[0].strokes[3]).toBe(copies.strokes[0]);
    // The copies reuse the originals' ids here on purpose: undo must still
    // take away the copies, not the first element with a matching id.
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
    expect(doc.pages[0].strokes[0]).toBe(s[0]);
    const missing = new AddElements("nope", copies, "Paste");
    missing.apply(doc);
    missing.invert(doc);
    expect(snap(doc)).toBe(before);
  });
});

describe("RecolorStrokes", () => {
  it("recolours the selected strokes and restores each one's own colour", () => {
    const { doc, s } = fixture();
    s[2].color = "#ffee00";
    const before = snap(doc);
    const cmd = new RecolorStrokes("p1", [s[0], s[2]], "#ff0000");
    cmd.apply(doc);
    expect(s.map((x) => x.color)).toEqual(["#ff0000", "#000000", "#ff0000"]);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
    cmd.apply(doc);
    cmd.invert(doc);
    expect(snap(doc)).toBe(before);
  });

  it("ignores strokes not on the page, and a missing page", () => {
    const { doc, s } = fixture();
    const loose = stroke("loose");
    new RecolorStrokes("p1", [loose], "#ff0000").apply(doc);
    expect(loose.color).toBe("#000000");
    new RecolorStrokes("nope", s, "#ff0000").apply(doc);
    expect(s[0].color).toBe("#000000");
  });
});

describe("ScaleElements", () => {
  it("scales points about the anchor, leaving pressure and a ragged tail alone", () => {
    const pts = [10, 20, 0.5, 30, 40, 0.7, 99, 98];
    const out = scalePoints(pts, 10, 20, 2);
    expect(out).toEqual([10, 20, 0.5, 50, 60, 0.7, 99, 98]);
    expect(pts).toEqual([10, 20, 0.5, 30, 40, 0.7, 99, 98]);
    expect(out.length).toBe(pts.length);
  });

  it("scales strokes, widths, pictures and text boxes about the anchor as one step", () => {
    const { doc, s, i, t } = fixture();
    const history = new History();
    history.push(doc, new ScaleElements("p1", { strokes: s, images: i, textBoxes: t }, 0, 0, 2));
    // Points and width double; pressure stays.
    expect(s[0].pts).toEqual([0.2, 0.4, 0.5, 20.8, 41.4, 0.6]);
    expect(s[0].size).toBe(4);
    expect(s[1].shape).toBe("rect");
    expect(s[1].t0).toBe(12);
    // A picture keeps its rotation; its box scales.
    expect(i[1]).toMatchObject({ x: 20.2, y: 40.4, w: 200, h: 100, rotation: 0.3 });
    // A text box's frame and font scale together; an auto height stays auto.
    expect(t[0]).toMatchObject({ x: 60.6, y: 80.8, w: 400, fontSize: 36 });
    expect("h" in t[0]).toBe(false);
    expect(t[1].h).toBe(120);
    // Elements on another page are untouched.
    expect(doc.pages[1].strokes[0].size).toBe(2);
    expect(history.undo(doc)).not.toBeNull();
    expect(s[0].size).toBe(2);
  });

  it("keeps a resized text box's size to one decimal", () => {
    const { doc, s, i, t } = fixture();
    new ScaleElements("p1", { strokes: s, images: i, textBoxes: t }, 7.3, 9.1, 1.2345678).apply(
      doc,
    );
    for (const box of t) {
      expect(box.fontSize).toBe(Math.round(box.fontSize * 10) / 10);
      expect(String(box.fontSize).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the anchor where it is and moves everything else away from it", () => {
    const { doc, s } = fixture();
    const before = s[0].pts.slice();
    new ScaleElements("p1", { strokes: [s[0]], images: [], textBoxes: [] }, 0.1, 0.2, 3).apply(doc);
    expect(s[0].pts[0]).toBeCloseTo(before[0]);
    expect(s[0].pts[1]).toBeCloseTo(before[1]);
    expect(s[0].pts[3]).toBeCloseTo(0.1 + (before[3] - 0.1) * 3);
  });

  it("undoes JSON-identically, key order included, and redoes to the same place", () => {
    const { doc, s, i, t } = fixture();
    const before = snap(doc);
    const keys = Object.keys(t[1]);
    const history = new History();
    history.push(
      doc,
      new ScaleElements("p1", { strokes: s, images: i, textBoxes: t }, 7.3, 9.1, 0.37),
    );
    const scaled = snap(doc);
    history.undo(doc);
    expect(snap(doc)).toBe(before);
    expect(Object.keys(t[1])).toEqual(keys);
    history.redo(doc);
    expect(snap(doc)).toBe(scaled);
    history.undo(doc);
    expect(snap(doc)).toBe(before);
  });

  it("changes nothing for a scale or anchor that is not a finite positive number", () => {
    for (const [ax, ay, k] of [
      [0, 0, 0],
      [0, 0, -1],
      [0, 0, Number.NaN],
      [0, 0, Infinity],
      [Number.NaN, 0, 2],
      [0, Infinity, 2],
    ]) {
      const { doc, s, i, t } = fixture();
      const before = snap(doc);
      const cmd = new ScaleElements("p1", { strokes: s, images: i, textBoxes: t }, ax, ay, k);
      cmd.apply(doc);
      expect(snap(doc)).toBe(before);
      cmd.invert(doc);
      expect(snap(doc)).toBe(before);
    }
  });

  it("never writes NaN, even on a ragged stroke", () => {
    const { doc } = fixture();
    const ragged = stroke("r", 1, { pts: [1, 2, 0.5, 3, 4] });
    doc.pages[0].strokes.push(ragged);
    new ScaleElements("p1", { strokes: [ragged], images: [], textBoxes: [] }, 0, 0, 1.5).apply(doc);
    expect(ragged.pts).toEqual([1.5, 3, 0.5, 3, 4]);
    expect(ragged.pts.some((v) => Number.isNaN(v))).toBe(false);
  });

  it("leaves alone elements no longer on the page, and a missing page", () => {
    const { doc, s } = fixture();
    const loose = stroke("loose");
    new ScaleElements("p1", { strokes: [loose], images: [], textBoxes: [] }, 0, 0, 2).apply(doc);
    expect(loose.size).toBe(2);
    const cmd = new ScaleElements("nope", { strokes: s, images: [], textBoxes: [] }, 0, 0, 2);
    cmd.apply(doc);
    expect(s[0].size).toBe(2);
    cmd.invert(doc);
    expect(s[0].size).toBe(2);
  });

  it("survives a save and a load as it was scaled", () => {
    const { doc, s, t } = fixture();
    new ScaleElements("p1", { strokes: s, images: [], textBoxes: t }, 0, 0, 0.7).apply(doc);
    const back = decodeDocument(encodeDocument(doc)).pages[0];
    expect(back.textBoxes[0].fontSize).toBeCloseTo(12.6);
    expect(back.strokes[0].size).toBeCloseTo(1.4);
  });

  it("keeps text inside the sizes the loader and the style menu allow", () => {
    expect(textScaleRange([])).toEqual({ min: 0, max: Infinity });
    const range = textScaleRange([textBox("a", { fontSize: 24 }), textBox("b", { fontSize: 100 })]);
    expect(range.min).toBe(0.5);
    expect(range.max).toBe(4);
    // A box already at the floor cannot shrink, but may grow.
    expect(textScaleRange([textBox("c", { fontSize: 12 })]).min).toBe(1);
    // One already outside the range may stay as it is.
    expect(textScaleRange([textBox("d", { fontSize: 8 })]).min).toBe(1);
    expect(textScaleRange([textBox("e", { fontSize: 500 })]).max).toBe(1);
  });
});

describe("ReshapeStroke", () => {
  it("gives one shape new points and kind, and undo puts back the very same array", () => {
    const { doc, s } = fixture();
    const before = snap(doc);
    const old = s[1].pts;
    const pts = [0.3, 0.2, 0.5, 50, 60, 0.6];
    const history = new History();
    history.push(doc, new ReshapeStroke("p1", s[1], pts, "polygon"));
    expect(s[1].pts).toBe(pts);
    expect(s[1].shape).toBe("polygon");
    history.undo(doc);
    expect(s[1].pts).toBe(old);
    expect(s[1].shape).toBe("rect");
    expect(snap(doc)).toBe(before);
    history.redo(doc);
    expect(s[1].pts).toBe(pts);
    // Saved and read back, as any shape.
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].strokes[1].shape).toBe("polygon");
  });

  it("does nothing for a stroke no longer on its page", () => {
    const { doc, s } = fixture();
    const loose = stroke("gone", 1, { shape: "line" });
    const command = new ReshapeStroke("p1", loose, [1, 1, 0.5, 9, 9, 0.5], "line");
    command.apply(doc);
    expect(loose.pts).not.toEqual([1, 1, 0.5, 9, 9, 0.5]);
    command.invert();
    expect(s[1].shape).toBe("rect");
  });
});
