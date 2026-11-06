import { describe, expect, it } from "vitest";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import {
  AddEquation,
  EQUATION_MAX_SIZE,
  EQUATION_MIN_SIZE,
  EditEquation,
  equationBounds,
  equationContentKey,
  makeEquation,
  nextEquationId,
  normalizeEquation,
  scaleEquation,
} from "../../src/model/equation";
import { decodeDocument as decode, encodeDocument as encode } from "../../src/model/serialize";
import {
  AddElements,
  MoveElementsToPage,
  ReorientElements,
  RemoveElements,
  ScaleElements,
  TranslateElements,
  copyElements,
  isEmptySelection,
} from "../../src/model/selection-commands";
import { InkClipboard, pasteCopies } from "../../src/model/clipboard";
import { duplicatePageAfter as duplicatePage } from "../../src/model/page-commands";
import { pageSignature } from "../../src/model/page-signature";

const quadratic = (): ReturnType<typeof makeEquation> =>
  makeEquation({
    id: "q1",
    x: 40,
    y: 60,
    w: 200,
    h: 60,
    tex: "x = \\frac{-b}{2a}",
    color: "#1b2a6b",
    size: 24,
  });

function doc(): InkDocument {
  const d = emptyDocument(600);
  d.pages = [
    { ...blankPage("a", { width: 600, height: 800 }), equations: [quadratic()] },
    blankPage("b", { width: 600, height: 800 }),
  ];
  return d;
}

const ids = {
  stroke: () => "s9",
  image: () => "i9",
  textBox: () => "t9",
  table: () => "g9",
  graph: () => "f9",
  equation: () => "q9",
};

describe("an equation element", () => {
  it("is made with its fields as the loader keeps them", () => {
    const e = makeEquation({
      id: "q2",
      x: Number.NaN,
      y: 3,
      w: 1,
      h: 1e9,
      tex: "x",
      color: "red",
      size: 9999,
    });
    expect(e).toEqual({
      id: "q2",
      x: 0,
      y: 3,
      w: 4,
      h: 100000,
      tex: "x",
      color: "#000000",
      size: EQUATION_MAX_SIZE,
    });
    expect(makeEquation({ ...e, size: 1 }).size).toBe(EQUATION_MIN_SIZE);
  });

  it("is saved and read back, an old build's page without one unchanged", () => {
    const d = doc();
    const back = decode(encode(d));
    expect(back.pages[0].equations).toEqual(d.pages[0].equations);
    expect(back.pages[1].equations).toBeUndefined();
  });

  it("is dropped on load without a source, and minted an id without one", () => {
    let n = 4;
    const mint = (): string => `q${++n}`;
    expect(normalizeEquation(null, mint)).toBeNull();
    expect(normalizeEquation({ tex: "  " }, mint)).toBeNull();
    expect(normalizeEquation({ tex: 3 }, mint)).toBeNull();
    expect(
      normalizeEquation({ tex: "x", x: 1, y: 2, w: 30, h: 20, color: "#ff0000", size: 20 }, mint)
        ?.id,
    ).toBe("q5");
  });

  it("finds the next free id, bounds and content key", () => {
    expect(nextEquationId(doc())).toBe("q2");
    expect(nextEquationId(emptyDocument(100))).toBe("q1");
    const e = quadratic();
    expect(equationBounds(e)).toEqual({ minX: 40, minY: 60, maxX: 240, maxY: 120 });
    const key = equationContentKey(e);
    e.x += 10;
    expect(equationContentKey(e)).toBe(key);
    e.tex = "y";
    expect(equationContentKey(e)).not.toBe(key);
  });

  it("scales its place, frame and size together", () => {
    const e = quadratic();
    scaleEquation(e, 0, 0, 2);
    expect([e.x, e.y, e.w, e.h, e.size]).toEqual([80, 120, 400, 120, 48]);
    scaleEquation(e, 0, 0, Number.NaN);
    expect(e.size).toBe(48);
  });
});

describe("equation commands", () => {
  it("adds one and takes it away again, leaving the page as it was", () => {
    const d = doc();
    const page = d.pages[1];
    const before = JSON.stringify(page);
    const add = new AddEquation("b", makeEquation({ ...quadratic(), id: "q2" }));
    add.apply(d);
    expect(page.equations).toHaveLength(1);
    add.invert(d);
    expect(JSON.stringify(page)).toBe(before);
    new AddEquation("missing", quadratic()).apply(d);
  });

  it("edits the source and frame, and undoes to the same JSON", () => {
    const d = doc();
    const e = d.pages[0].equations![0];
    const before = JSON.stringify(e);
    const edit = new EditEquation("a", e, { tex: "y^2", w: 80, h: 40, color: "#ff0000", size: 30 });
    edit.apply(d);
    expect([e.tex, e.w, e.h, e.color, e.size]).toEqual(["y^2", 80, 40, "#ff0000", 30]);
    edit.invert(d);
    expect(JSON.stringify(e)).toBe(before);
    // Not on the page: nothing changes.
    const stray = quadratic();
    new EditEquation("a", stray, { tex: "z" }).apply(d);
    expect(stray.tex).not.toBe("z");
  });
});

describe("equations under the lasso", () => {
  it("move, scale, turn and are deleted with the selection, and undo exactly", () => {
    const d = doc();
    const e = d.pages[0].equations![0];
    const before = JSON.stringify(d);
    const sel = { strokes: [], images: [], textBoxes: [], equations: [e] };
    expect(isEmptySelection(sel)).toBe(false);
    for (const command of [
      new TranslateElements("a", sel, 10, 20),
      new ScaleElements("a", sel, 0, 0, 2),
      new ReorientElements("a", sel, { kind: "rotate", angle: Math.PI / 2 }, 300, 300),
      new RemoveElements("a", sel),
    ]) {
      command.apply(d);
      expect(JSON.stringify(d)).not.toBe(before);
      command.invert(d);
      expect(JSON.stringify(d)).toBe(before);
    }
  });

  it("goes to another page, is copied, pasted and duplicated with fresh ids", () => {
    const d = doc();
    const e = d.pages[0].equations![0];
    const sel = { strokes: [], images: [], textBoxes: [], equations: [e] };
    const move = new MoveElementsToPage("a", "b", sel, 5, 5);
    move.apply(d);
    expect(d.pages[1].equations).toEqual([e]);
    expect(d.pages[0].equations).toEqual([]);
    move.invert(d);
    expect(d.pages[0].equations).toEqual([e]);

    const copies = copyElements(sel, ids, 24, 24);
    expect(copies.equations?.[0]).toMatchObject({ id: "q9", x: 64, tex: e.tex });
    const add = new AddElements("b", copies);
    add.apply(d);
    expect(d.pages[1].equations).toHaveLength(1);
    add.invert(d);
    expect(d.pages[1].equations).toBeUndefined();

    const clipboard = new InkClipboard();
    clipboard.put(sel, equationBounds(e));
    expect(clipboard.canPaste()).toBe(true);
    const pasted = pasteCopies(clipboard.content!, ids, 0, 0);
    expect(pasted.equations?.[0].id).toBe("q9");
    expect(pasted.equations?.[0]).not.toBe(e);
  });

  it("is copied with its page, renumbered, and part of the page's signature", () => {
    const d = doc();
    const copy = duplicatePage(d, 0);
    expect(copy?.page.equations?.[0].id).toBe("q2");
    const signature = pageSignature(d.pages[0]);
    d.pages[0].equations![0].tex = "y";
    expect(pageSignature(d.pages[0])).not.toBe(signature);
  });
});
