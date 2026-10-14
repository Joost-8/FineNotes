/**
 * Flipping a picture (`FlipImage`) and turning or mirroring a lasso
 * selection (`ReorientElements`): one undo step each, restoring the
 * document `JSON.stringify`-identical, and the flags surviving a save.
 */

import { describe, expect, it } from "vitest";
import { FlipImage, toggleFlip } from "../../src/model/image-commands";
import {
  ReorientElements,
  type Reorientation,
  reorientPoint,
  reorientPoints,
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
import { duplicateImage } from "../../src/model/images";
import { pageSignature } from "../../src/model/page-signature";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function stroke(id: string, pts: number[], extra: Partial<Stroke> = {}): Stroke {
  return { id, color: "#000000", size: 2, tool: "pen", pts, ...extra };
}

function image(id: string, extra: Partial<ImageElement> = {}): ImageElement {
  return { id, path: "pic.png", x: 10.1, y: 20.2, w: 100, h: 50, ...extra };
}

function textBox(id: string, extra: Partial<TextBoxElement> = {}): TextBoxElement {
  return { id, x: 30.3, y: 40.4, w: 200, text: "hello", color: "#111111", fontSize: 18, ...extra };
}

/** Apply, undo, redo, undo through a History, checking the JSON at each step. */
function roundTrip(doc: InkDocument, command: Parameters<History["push"]>[1]): string {
  const before = JSON.stringify(doc);
  const history = new History();
  history.push(doc, command);
  const after = JSON.stringify(doc);
  history.undo(doc);
  expect(JSON.stringify(doc)).toBe(before);
  history.redo(doc);
  expect(JSON.stringify(doc)).toBe(after);
  history.undo(doc);
  expect(JSON.stringify(doc)).toBe(before);
  history.redo(doc);
  return after;
}

const close = (a: number, b: number): void => void expect(a).toBeCloseTo(b, 9);

describe("FlipImage", () => {
  it("toggles one flag, keeps the box, rotation and crop, and undoes exactly", () => {
    const doc = emptyDocument();
    const a = image("i1", { rotation: 0.4, crop: { x: 0.1, y: 0, w: 0.5, h: 1 }, locked: true });
    doc.pages[0].images.push(a);
    roundTrip(doc, new FlipImage(doc.pages[0].id, a, "x"));
    expect(a.flipX).toBe(true);
    expect(a.flipY).toBeUndefined();
    expect([a.x, a.y, a.w, a.h, a.rotation]).toEqual([10.1, 20.2, 100, 50, 0.4]);
    expect(a.crop).toEqual({ x: 0.1, y: 0, w: 0.5, h: 1 });
  });

  it("flipping twice deletes the key instead of storing false", () => {
    const doc = emptyDocument();
    const a = image("i1");
    doc.pages[0].images.push(a);
    const before = JSON.stringify(doc);
    const history = new History();
    history.push(doc, new FlipImage(doc.pages[0].id, a, "y"));
    expect(a.flipY).toBe(true);
    history.push(doc, new FlipImage(doc.pages[0].id, a, "y"));
    expect("flipY" in a).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
    history.undo(doc);
    expect(a.flipY).toBe(true);
  });

  it("finds a replaced picture by id, and does nothing for a missing page or picture", () => {
    const doc = emptyDocument();
    const a = image("i1");
    doc.pages[0].images.push({ ...a });
    new FlipImage(doc.pages[0].id, a, "x").apply(doc);
    expect(doc.pages[0].images[0].flipX).toBe(true);
    const before = JSON.stringify(doc);
    const lost = new FlipImage("nope", a, "x");
    lost.apply(doc);
    lost.invert(doc);
    new FlipImage(doc.pages[0].id, image("i9"), "x").apply(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("labels each way", () => {
    expect(new FlipImage("p", image("i1"), "x").label).toBe("Flip horizontal");
    expect(new FlipImage("p", image("i1"), "y").label).toBe("Flip vertical");
  });

  it("toggleFlip toggles in place", () => {
    const a = image("i1");
    toggleFlip(a, "x");
    toggleFlip(a, "y");
    expect([a.flipX, a.flipY]).toEqual([true, true]);
    toggleFlip(a, "x");
    expect("flipX" in a).toBe(false);
  });
});

describe("the flags on disk and in copies", () => {
  it("survive a save and load; anything but true is dropped", () => {
    const doc = emptyDocument();
    doc.pages[0].images.push(image("i1", { flipX: true }), image("i2", { flipY: true }));
    const raw = image("i3") as unknown as Record<string, unknown>;
    raw.flipX = false;
    raw.flipY = "yes";
    doc.pages[0].images.push(raw as unknown as ImageElement);
    const back = decodeDocument(encodeDocument(doc));
    const [a, b, c] = back.pages[0].images;
    expect([a.flipX, a.flipY]).toEqual([true, undefined]);
    expect([b.flipX, b.flipY]).toEqual([undefined, true]);
    expect("flipX" in c || "flipY" in c).toBe(false);
  });

  it("a duplicate is mirrored the same way", () => {
    const doc = emptyDocument();
    const a = image("i1", { flipX: true, flipY: true, crop: { x: 0, y: 0.2, w: 1, h: 0.5 } });
    doc.pages[0].images.push(a);
    const copy = duplicateImage(doc, doc.pages[0].geometry, a);
    expect([copy.flipX, copy.flipY]).toEqual([true, true]);
    expect(copy.crop).toEqual(a.crop);
    expect(copy.crop).not.toBe(a.crop);
  });

  it("the page signature moves when a picture is flipped or cropped", () => {
    const page = blankPage("p1");
    const a = image("i1");
    page.images.push(a);
    const plain = pageSignature(page);
    a.flipX = true;
    const flipped = pageSignature(page);
    expect(flipped).not.toBe(plain);
    a.crop = { x: 0, y: 0, w: 0.5, h: 1 };
    expect(pageSignature(page)).not.toBe(flipped);
  });
});

describe("reorientPoint and reorientPoints", () => {
  it("turns clockwise with y down, and mirrors across the centre's lines", () => {
    const quarter: Reorientation = { kind: "rotate", angle: Math.PI / 2 };
    const p = reorientPoint(quarter, 10, 10, 20, 10);
    close(p.x, 10);
    close(p.y, 20);
    expect(reorientPoint({ kind: "flip", axis: "x" }, 10, 10, 13, 4)).toEqual({ x: 7, y: 4 });
    expect(reorientPoint({ kind: "flip", axis: "y" }, 10, 10, 13, 4)).toEqual({ x: 13, y: 16 });
  });

  it("moves whole points only, keeps pressure and a ragged tail, and copies", () => {
    const pts = [20, 10, 0.5, 10, 0, 0.7, 99];
    const out = reorientPoints(pts, { kind: "flip", axis: "x" }, 10, 10);
    expect(out).toEqual([0, 10, 0.5, 10, 0, 0.7, 99]);
    expect(pts).toEqual([20, 10, 0.5, 10, 0, 0.7, 99]);
  });
});

function fixture(): {
  doc: InkDocument;
  s: Stroke;
  shape: Stroke;
  i: ImageElement;
  t: TextBoxElement;
} {
  const s = stroke("s1", [0, 0, 0.5, 40, 0, 0.6], { samples: [0, 0, 0.5, 0] });
  const shape = stroke("s2", [0, 0, 0.5, 20, 0, 0.5, 20, 10, 0.5, 0, 10, 0.5, 0, 0, 0.5], {
    shape: "rect",
  });
  const i = image("i1", {
    x: 50,
    y: 50,
    w: 20,
    h: 10,
    rotation: 0.3,
    crop: { x: 0, y: 0, w: 0.5, h: 1 },
  });
  const t = textBox("t1", { x: 0, y: 100, w: 40, h: 20 });
  const doc = emptyDocument();
  doc.pages = [{ ...blankPage("p1"), strokes: [s, shape], images: [i], textBoxes: [t] }];
  return { doc, s, shape, i, t };
}

describe("ReorientElements: turning", () => {
  it("turns ink about the centre, keeping width, pressure, shape and samples", () => {
    const { doc, s, shape, i, t } = fixture();
    const sel = { strokes: [s, shape], images: [i], textBoxes: [t] };
    roundTrip(doc, new ReorientElements("p1", sel, { kind: "rotate", angle: Math.PI / 2 }, 0, 0));
    close(s.pts[0], 0);
    close(s.pts[1], 0);
    close(s.pts[3], 0);
    close(s.pts[4], 40);
    expect([s.pts[2], s.pts[5], s.size]).toEqual([0.5, 0.6, 2]);
    expect(s.samples).toEqual([0, 0, 0.5, 0]);
    expect(shape.shape).toBe("rect");
    close(shape.pts[6], -10);
    close(shape.pts[7], 20);
  });

  it("moves a picture's centre round and adds to its rotation; crop untouched", () => {
    const { doc, i } = fixture();
    const sel = { strokes: [], images: [i], textBoxes: [] };
    roundTrip(doc, new ReorientElements("p1", sel, { kind: "rotate", angle: Math.PI / 2 }, 0, 0));
    // Centre (60, 55) goes to (-55, 60); the box keeps its size.
    close(i.x + i.w / 2, -55);
    close(i.y + i.h / 2, 60);
    expect([i.w, i.h]).toEqual([20, 10]);
    close(i.rotation ?? 0, 0.3 + Math.PI / 2);
    expect(i.crop).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
  });

  it("leaves no rotation key when the turn cancels a picture's own, and wraps past a half turn", () => {
    const doc = emptyDocument();
    const a = image("i1", { rotation: -0.5 });
    const b = image("i2", { rotation: 3 });
    doc.pages[0].images.push(a, b);
    const sel = { strokes: [], images: [a, b], textBoxes: [] };
    roundTrip(
      doc,
      new ReorientElements(doc.pages[0].id, sel, { kind: "rotate", angle: 0.5 }, 0, 0),
    );
    expect("rotation" in a).toBe(false);
    close(b.rotation ?? 0, 3.5 - 2 * Math.PI);
  });

  it("keeps a text box upright and moves its middle, measuring an auto-height box", () => {
    const { doc, t } = fixture();
    const auto = textBox("t2", { x: 0, y: 200, w: 40 });
    doc.pages[0].textBoxes.push(auto);
    const sel = { strokes: [], images: [], textBoxes: [t, auto] };
    const heights = new Map([[auto, 30]]);
    roundTrip(
      doc,
      new ReorientElements("p1", sel, { kind: "rotate", angle: Math.PI }, 0, 0, heights),
    );
    // t's middle (20, 110) goes to (-20, -110); its size and style stay.
    close(t.x, -40);
    close(t.y, -120);
    expect([t.w, t.h, t.fontSize]).toEqual([40, 20, 18]);
    // auto's middle (20, 215) goes to (-20, -215), with the measured height.
    close(auto.x, -40);
    close(auto.y, -230);
    expect("h" in auto).toBe(false);
  });

  it("is labelled, and does nothing with a non-finite angle or centre", () => {
    const { doc, s, i, t } = fixture();
    const sel = { strokes: [s], images: [i], textBoxes: [t] };
    expect(new ReorientElements("p1", sel, { kind: "rotate", angle: 1 }, 0, 0).label).toBe(
      "Rotate selection",
    );
    const before = JSON.stringify(doc);
    for (const command of [
      new ReorientElements("p1", sel, { kind: "rotate", angle: Number.NaN }, 0, 0),
      new ReorientElements("p1", sel, { kind: "rotate", angle: 1 }, Number.POSITIVE_INFINITY, 0),
      new ReorientElements("p1", sel, { kind: "flip", axis: "x" }, 0, Number.NaN),
      new ReorientElements("nope", sel, { kind: "rotate", angle: 1 }, 0, 0),
    ]) {
      command.apply(doc);
      command.invert(doc);
    }
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("gives each stroke a new points array, so the path cache cannot reuse a turned stroke", () => {
    const { doc, s } = fixture();
    const old = s.pts;
    new ReorientElements(
      "p1",
      { strokes: [s], images: [], textBoxes: [] },
      {
        kind: "rotate",
        angle: Math.PI,
      },
      20,
      0,
    ).apply(doc);
    expect(s.pts).not.toBe(old);
    // Turned half way round its own middle, the stroke has the same two ends, swapped.
    expect(s.pts.length).toBe(old.length);
  });
});

describe("ReorientElements: mirroring", () => {
  it("mirrors ink and text boxes across the centre", () => {
    const { doc, s, t } = fixture();
    const sel = { strokes: [s], images: [], textBoxes: [t] };
    roundTrip(doc, new ReorientElements("p1", sel, { kind: "flip", axis: "x" }, 50, 0));
    expect(s.pts).toEqual([100, 0, 0.5, 60, 0, 0.6]);
    expect([t.x, t.y]).toEqual([60, 100]);
  });

  it("flips a picture in its own frame and negates its rotation", () => {
    const { doc, i } = fixture();
    const sel = { strokes: [], images: [i], textBoxes: [] };
    const command = new ReorientElements("p1", sel, { kind: "flip", axis: "y" }, 0, 100);
    expect(command.label).toBe("Flip vertical");
    roundTrip(doc, command);
    // Centre (60, 55) goes to (60, 145).
    close(i.x, 50);
    close(i.y, 140);
    expect(i.flipY).toBe(true);
    expect("flipX" in i).toBe(false);
    close(i.rotation ?? 0, -0.3);
    expect(i.crop).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
  });

  it("a second mirror the same way puts a picture back as it was", () => {
    const { doc, i } = fixture();
    const before = JSON.stringify(i);
    const sel = { strokes: [], images: [i], textBoxes: [] };
    const history = new History();
    history.push(doc, new ReorientElements("p1", sel, { kind: "flip", axis: "x" }, 7, 0));
    expect(i.flipX).toBe(true);
    history.push(doc, new ReorientElements("p1", sel, { kind: "flip", axis: "x" }, 7, 0));
    const after = JSON.parse(JSON.stringify(i)) as ImageElement;
    const was = JSON.parse(before) as ImageElement;
    expect("flipX" in after).toBe(false);
    close(after.x, was.x);
    close(after.rotation ?? 0, was.rotation ?? 0);
  });
});
