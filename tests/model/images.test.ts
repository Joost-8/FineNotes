import { describe, expect, it } from "vitest";
import { InsertImage, RemoveImage, TransformImage } from "../../src/model/commands";
import {
  type ImageElement,
  type InkDocument,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import {
  DUPLICATE_OFFSET,
  IMAGE_MIN_PLACE_SIDE,
  duplicateImage,
  newImageElement,
  nextImageId,
  placeImageBox,
} from "../../src/model/images";
import { withRotation } from "../../src/canvas/image-geometry";

const PAGE = { width: 1024, height: 1448 };

function docWith(...pages: ImageElement[][]): InkDocument {
  const doc = emptyDocument();
  doc.pages = pages.map((images, i) => ({ ...blankPage(`p${i + 1}`), images }));
  return doc;
}

function image(id: string, extra: Partial<ImageElement> = {}): ImageElement {
  return { id, path: "a.png", x: 0, y: 0, w: 100, h: 100, ...extra };
}

describe("nextImageId", () => {
  it("starts at i1", () => {
    expect(nextImageId(emptyDocument())).toBe("i1");
  });

  it("counts from the highest id across every page, not the number of images", () => {
    const doc = docWith([image("i3"), image("custom")], [image("i10")]);
    expect(nextImageId(doc)).toBe("i11");
  });
});

describe("placeImageBox", () => {
  it("fits a camera photo inside 60 % of the page, centred", () => {
    const box = placeImageBox({ width: 4032, height: 3024 }, PAGE, null);
    expect(box.w).toBeCloseTo(614.4);
    expect(box.h).toBeCloseTo(460.8);
    expect(box.x).toBeCloseTo((1024 - 614.4) / 2);
    expect(box.y).toBeCloseTo((1448 - 460.8) / 2);
  });

  it("lets the height bind for a tall picture", () => {
    const box = placeImageBox({ width: 1000, height: 4000 }, PAGE, null);
    expect(box.h).toBeCloseTo(1448 * 0.6);
    expect(box.w / box.h).toBeCloseTo(0.25);
  });

  it("keeps a small picture at its own size, and grows a tiny one", () => {
    expect(placeImageBox({ width: 200, height: 100 }, PAGE, null)).toMatchObject({
      w: 200,
      h: 100,
    });
    const icon = placeImageBox({ width: 10, height: 5 }, PAGE, null);
    expect(icon.w).toBeCloseTo(IMAGE_MIN_PLACE_SIDE);
    expect(icon.h).toBeCloseTo(IMAGE_MIN_PLACE_SIDE / 2);
  });

  it("places a picture with no size of its own as a square", () => {
    const box = placeImageBox({ width: 0, height: 0 }, PAGE, null);
    expect(box.w).toBeCloseTo(614.4);
    expect(box.h).toBeCloseTo(614.4);
  });

  it("centres in the part of the page on screen", () => {
    const visible = { minX: 0, minY: 1000, maxX: 1024, maxY: 1600 };
    const box = placeImageBox({ width: 200, height: 100 }, PAGE, visible);
    expect(box.x + box.w / 2).toBeCloseTo(512);
    expect(box.y + box.h / 2).toBeCloseTo((1000 + 1448) / 2);
  });

  it("keeps the picture on the page near an edge", () => {
    const visible = { minX: 0, minY: 1400, maxX: 1024, maxY: 1448 };
    const box = placeImageBox({ width: 400, height: 400 }, PAGE, visible);
    expect(box.y + box.h).toBeCloseTo(1448);
  });

  it("uses the whole page when the visible band misses it", () => {
    const off = { minX: 0, minY: 2000, maxX: 1024, maxY: 2500 };
    const box = placeImageBox({ width: 200, height: 100 }, PAGE, off);
    expect(box.y + box.h / 2).toBeCloseTo(724);
  });
});

describe("newImageElement", () => {
  it("mints a fresh id and stores rotation only when there is one", () => {
    const doc = docWith([image("i4")]);
    const flat = newImageElement(doc, "b.png", { x: 1, y: 2, w: 3, h: 4, rotation: 0 });
    expect(flat).toEqual({ id: "i5", path: "b.png", x: 1, y: 2, w: 3, h: 4 });
    const turned = newImageElement(doc, "b.png", { x: 1, y: 2, w: 3, h: 4, rotation: 0.5 });
    expect(turned.rotation).toBe(0.5);
  });
});

describe("duplicateImage", () => {
  it("keeps the crop, as its own object, and never the lock", () => {
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    const doc = docWith([image("i1", { crop, locked: true })]);
    const copy = duplicateImage(doc, PAGE, doc.pages[0].images[0]);
    expect(copy.crop).toEqual(crop);
    expect(copy.crop).not.toBe(crop);
    expect("locked" in copy).toBe(false);
  });

  it("nudges the copy down and right, sharing the file", () => {
    const doc = docWith([image("i1", { x: 100, y: 200, rotation: 0.3 })]);
    const copy = duplicateImage(doc, PAGE, doc.pages[0].images[0]);
    expect(copy).toEqual({
      id: "i2",
      path: "a.png",
      x: 100 + DUPLICATE_OFFSET,
      y: 200 + DUPLICATE_OFFSET,
      w: 100,
      h: 100,
      rotation: 0.3,
    });
  });

  it("does not push a copy off the page", () => {
    const doc = docWith([image("i1", { x: 924, y: 1348 })]);
    const copy = duplicateImage(doc, PAGE, doc.pages[0].images[0]);
    expect(copy.x).toBe(924);
    expect(copy.y).toBe(1348);
  });

  it("does not drag a copy back from where the original already hangs off", () => {
    const doc = docWith([image("i1", { x: 1000, y: -40 })]);
    const copy = duplicateImage(doc, PAGE, doc.pages[0].images[0]);
    expect(copy.x).toBe(1000);
    expect(copy.y).toBe(-40 + DUPLICATE_OFFSET);
  });
});

describe("placing through the commands", () => {
  it("inserts, transforms and removes a placed image, and undoes back to identical JSON", () => {
    const doc = docWith([image("i1")]);
    const before = JSON.stringify(doc);
    const placed = newImageElement(
      doc,
      "photo.jpg",
      placeImageBox({ width: 800, height: 600 }, PAGE),
    );
    const insert = new InsertImage("p1", placed);
    insert.apply(doc);
    const afterInsert = JSON.stringify(doc);
    const move = new TransformImage("p1", placed.id, withRotation({ ...placed, x: 10 }, 0.4));
    move.apply(doc);
    expect(doc.pages[0].images[1]).toMatchObject({ x: 10, rotation: 0.4 });
    move.invert(doc);
    expect(JSON.stringify(doc)).toBe(afterInsert);
    const remove = new RemoveImage("p1", placed.id);
    remove.apply(doc);
    remove.invert(doc);
    expect(JSON.stringify(doc)).toBe(afterInsert);
    insert.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("two placements of one file are two images", () => {
    const doc = docWith([]);
    const first = newImageElement(doc, "same.png", { x: 0, y: 0, w: 10, h: 10 });
    new InsertImage("p1", first).apply(doc);
    const second = duplicateImage(doc, PAGE, first);
    new InsertImage("p1", second).apply(doc);
    expect(doc.pages[0].images.map((i) => i.id)).toEqual(["i1", "i2"]);
    new RemoveImage("p1", "i1").apply(doc);
    expect(doc.pages[0].images).toEqual([second]);
  });
});
