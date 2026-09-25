/**
 * `src/model/selection-commands.ts` — one undo step per lasso action, each
 * restoring the document exactly.
 */

import { describe, expect, it } from "vitest";
import {
  AddElements,
  RecolorStrokes,
  RemoveElements,
  TranslateElements,
  copyElements,
  elementsOnPage,
  isEmptySelection,
  translatePoints,
} from "../../src/model/selection-commands";
import {
  type ImageElement,
  type InkDocument,
  type Stroke,
  type TextBoxElement,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { History } from "../../src/model/history";

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
      { stroke: () => "s1", image: () => "i1", textBox: () => "t1" },
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
