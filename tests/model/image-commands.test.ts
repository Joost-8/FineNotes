/**
 * `src/model/image-commands.ts` — front/back, lock and crop, each one undo
 * step that restores the document `JSON.stringify`-identical.
 */

import { describe, expect, it } from "vitest";
import {
  CropImage,
  ReorderImage,
  SetImageLocked,
  canReorderImage,
} from "../../src/model/image-commands";
import { type ImageElement, type InkDocument, emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function image(id: string, extra: Partial<ImageElement> = {}): ImageElement {
  return { id, path: `${id}.png`, x: 10.5, y: 20.25, w: 100, h: 50, ...extra };
}

function fixture(): { doc: InkDocument; a: ImageElement; b: ImageElement; c: ImageElement } {
  const doc = emptyDocument();
  const a = image("i1");
  const b = image("i2", { rotation: 0.4 });
  const c = image("i3", { crop: { x: 0.1, y: 0, w: 0.5, h: 1 } });
  doc.pages[0].images.push(a, b, c);
  return { doc, a, b, c };
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

describe("ReorderImage", () => {
  it("brings a picture to the front and sends one to the back", () => {
    const { doc, a, b, c } = fixture();
    const page = doc.pages[0];
    new ReorderImage("p1", a, "front").apply(doc);
    expect(page.images).toEqual([b, c, a]);
    new ReorderImage("p1", c, "back").apply(doc);
    expect(page.images).toEqual([c, b, a]);
  });

  it("restores the exact previous order on undo", () => {
    const { doc, b } = fixture();
    roundTrip(doc, new ReorderImage("p1", b, "front"));
    const again = fixture();
    roundTrip(again.doc, new ReorderImage("p1", again.b, "back"));
  });

  it("finds the picture by identity, even when ids repeat", () => {
    const { doc, a, c } = fixture();
    const twin = image("i1", { path: "twin.png" });
    doc.pages[0].images.push(twin);
    new ReorderImage("p1", twin, "back").apply(doc);
    expect(doc.pages[0].images[0]).toBe(twin);
    expect(doc.pages[0].images[1]).toBe(a);
    expect(doc.pages[0].images[3]).toBe(c);
  });

  it("does nothing, and undoes nothing, for a picture or page that is not there", () => {
    const { doc } = fixture();
    const before = JSON.stringify(doc);
    const stray = new ReorderImage("p1", image("i9"), "front");
    stray.apply(doc);
    stray.invert(doc);
    new ReorderImage("nope", image("i1"), "front").apply(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect(new ReorderImage("p1", image("i1"), "back").label).toBe("Send to back");
  });

  it("knows when a picture is already at the front or back", () => {
    const { doc, a, b, c } = fixture();
    const page = doc.pages[0];
    expect(canReorderImage(page, a, "back")).toBe(false);
    expect(canReorderImage(page, a, "front")).toBe(true);
    expect(canReorderImage(page, c, "front")).toBe(false);
    expect(canReorderImage(page, b, "back")).toBe(true);
    expect(canReorderImage(page, image("x"), "front")).toBe(false);
  });
});

describe("SetImageLocked", () => {
  it("locks with `true` and unlocks by deleting the key", () => {
    const { doc, a } = fixture();
    new SetImageLocked("p1", a, true).apply(doc);
    expect(a.locked).toBe(true);
    new SetImageLocked("p1", a, false).apply(doc);
    expect("locked" in a).toBe(false);
  });

  it("undoes to the exact previous JSON, key order included", () => {
    const { doc, a, c } = fixture();
    roundTrip(doc, new SetImageLocked("p1", a, true));
    // A locked, cropped picture unlocked and back: `locked` stays after `crop`.
    c.locked = true;
    roundTrip(doc, new SetImageLocked("p1", c, false));
    expect("locked" in c).toBe(false);
  });

  it("survives a save and reload as the loader writes it", () => {
    const { doc, b } = fixture();
    new SetImageLocked("p1", b, true).apply(doc);
    expect(decodeDocument(encodeDocument(doc)).pages[0].images[1].locked).toBe(true);
  });

  it("ignores a picture that is gone", () => {
    const { doc } = fixture();
    const before = JSON.stringify(doc);
    const command = new SetImageLocked("p1", image("i9"), true);
    command.apply(doc);
    command.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect(command.label).toBe("Lock image");
    expect(new SetImageLocked("p1", image("i9"), false).label).toBe("Unlock image");
  });
});

describe("CropImage", () => {
  it("sets the visible box and the crop, leaving the rotation alone", () => {
    const { doc, b } = fixture();
    new CropImage("p1", b, {
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
    }).apply(doc);
    expect(b).toEqual({
      id: "i2",
      path: "i2.png",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      rotation: 0.4,
      crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
    });
  });

  it("deletes the key for the whole picture (a reset)", () => {
    const { doc, c } = fixture();
    new CropImage("p1", c, { x: 0, y: 0, w: 200, h: 50 }).apply(doc);
    expect("crop" in c).toBe(false);
    expect(c.w).toBe(200);
  });

  it("undoes to the exact previous JSON: added, changed and removed crops", () => {
    const one = fixture();
    roundTrip(
      one.doc,
      new CropImage("p1", one.a, { x: 5, y: 6, w: 7, h: 8, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }),
    );
    const two = fixture();
    roundTrip(
      two.doc,
      new CropImage("p1", two.c, { x: 5, y: 6, w: 7, h: 8, crop: { x: 0.3, y: 0, w: 0.5, h: 1 } }),
    );
    const three = fixture();
    roundTrip(three.doc, new CropImage("p1", three.c, { x: 5, y: 6, w: 7, h: 8 }));
  });

  it("does not share its crop object with the document", () => {
    const { doc, a } = fixture();
    const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    new CropImage("p1", a, { x: 0, y: 0, w: 1, h: 1, crop }).apply(doc);
    crop.x = 0.9;
    expect(a.crop?.x).toBe(0.1);
  });

  it("ignores a picture that is gone", () => {
    const { doc } = fixture();
    const before = JSON.stringify(doc);
    const command = new CropImage("p1", image("i9"), { x: 0, y: 0, w: 1, h: 1 });
    command.apply(doc);
    command.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect(command.label).toBe("Crop image");
  });
});
