import { describe, expect, it } from "vitest";
import type { Matrix } from "../../../src/canvas/pdf-text";
import {
  type GfxOp,
  type OpCodes,
  type PageImage,
  classifyPage,
  collectImages,
  gfxOpsFrom,
  isFigureSized,
  mergeImages,
  multiplyMatrix,
  padRegions,
  regionRaster,
  scanFigures,
  settledCondition,
} from "../../../src/recognition/ocr/figures";
import { OCR_TUNING } from "../../../src/recognition/ocr/ocr-words";

// A page as pdf.js shows it: 612 x 866 pt, user space y up, view space y down.
const PAGE = { width: 612, height: 866 };
const VIEW: Matrix = [1, 0, 0, -1, 0, 866];

/** An image of `w` x `h` pt with its lower-left corner at (x, y) in user space (y up). */
const image = (x: number, y: number, w: number, h: number): GfxOp[] => [
  { op: "save" },
  { op: "transform", m: [w, 0, 0, h, x, y] },
  { op: "image" },
  { op: "restore" },
];

const box = (i: PageImage): number[] =>
  [i.x0, i.y0, i.x1, i.y1].map((v) => Math.round(v * 100) / 100);

describe("collecting images from the drawing operators", () => {
  it("maps the unit square under the matrix to the page, y down", () => {
    const got = collectImages(image(100, 500, 200, 100), VIEW, PAGE);
    expect(got.map(box)).toEqual([[100, 266, 300, 366]]);
  });

  it("follows save, restore and nested transforms", () => {
    const ops: GfxOp[] = [
      { op: "save" },
      { op: "transform", m: [2, 0, 0, 2, 10, 20] }, // scale 2 at (10, 20)
      { op: "save" },
      { op: "transform", m: [1, 0, 0, 1, 5, 5] }, // then +5,+5 in the scaled space
      { op: "save" },
      { op: "transform", m: [30, 0, 0, 20, 0, 0] },
      { op: "image" }, // 60 x 40 at (20, 30)
      { op: "restore" },
      { op: "image" }, // unit square: 2 x 2 at (20, 30)
      { op: "restore" },
      { op: "image" }, // 2 x 2 at (10, 20)
      { op: "restore" },
      { op: "image" }, // 1 x 1 at the origin
    ];
    const got = collectImages(ops, VIEW, PAGE).map(box);
    expect(got).toEqual([
      [20, 866 - 70, 80, 866 - 30],
      [20, 866 - 32, 22, 866 - 30],
      [10, 866 - 22, 12, 866 - 20],
      [0, 865, 1, 866],
    ]);
  });

  it("ignores a restore with nothing saved, and keeps going", () => {
    const ops: GfxOp[] = [{ op: "restore" }, ...image(0, 0, 50, 50)];
    expect(collectImages(ops, VIEW, PAGE).map(box)).toEqual([[0, 816, 50, 866]]);
  });

  it("boxes a rotated image and a flipped one", () => {
    // Rotated 90 degrees: the unit square's x axis points up the page.
    const rotated: GfxOp[] = [{ op: "transform", m: [0, 100, -50, 0, 200, 300] }, { op: "image" }];
    expect(collectImages(rotated, VIEW, PAGE).map(box)).toEqual([[150, 466, 200, 566]]);
    // Flipped on y (as pdf.js draws every image: a negative d).
    const flipped: GfxOp[] = [{ op: "transform", m: [80, 0, 0, -60, 40, 400] }, { op: "image" }];
    expect(collectImages(flipped, VIEW, PAGE).map(box)).toEqual([[40, 466, 120, 526]]);
    // Rotated 45 degrees: the box of the diamond.
    const s = Math.SQRT1_2 * 100;
    const diamond: GfxOp[] = [{ op: "transform", m: [s, s, -s, s, 300, 300] }, { op: "image" }];
    const [d] = collectImages(diamond, VIEW, PAGE);
    expect(d.x1 - d.x0).toBeCloseTo(100 * Math.SQRT2, 3);
    expect(d.y1 - d.y0).toBeCloseTo(100 * Math.SQRT2, 3);
  });

  it("applies the page's own viewport: rotation and an origin that is not zero", () => {
    // A page rotated 90 degrees clockwise, 866 wide and 612 high in view.
    const rotated: Matrix = [0, 1, 1, 0, 0, 0];
    const got = collectImages(image(100, 500, 200, 100), rotated, { width: 866, height: 612 });
    expect(got.map(box)).toEqual([[500, 100, 600, 300]]);
  });

  it("clips to the page and drops images outside it or with no area", () => {
    const got = collectImages(
      [
        ...image(-100, 700, 300, 400), // sticks out left and top
        ...image(900, 900, 50, 50), // wholly outside
        ...image(10, 10, 0, 40), // no width
        ...image(600, 0, 100, 100), // right edge
      ],
      VIEW,
      PAGE,
    );
    expect(got.map(box)).toEqual([
      [0, 0, 200, 166],
      [600, 766, 612, 866],
    ]);
  });

  it("derives the stored resolution from pixels over inches, not from the clipped part", () => {
    // 1000 px over 2.5 in (180 pt) = 400 dpi, even half off the page.
    const ops: GfxOp[] = [
      { op: "transform", m: [180, 0, 0, 90, -90, 100] },
      { op: "image", width: 1000, height: 500 },
    ];
    const [img] = collectImages(ops, VIEW, PAGE);
    expect(img.dpi).toBeCloseTo(400, 3);
    expect(collectImages(image(0, 0, 100, 100), VIEW, PAGE)[0].dpi).toBeNull();
  });

  it("places each copy of a repeated image with its own offset", () => {
    const ops: GfxOp[] = [
      { op: "image", extra: [40, 0, 0, 40, 10, 10] },
      { op: "image", extra: [40, 0, 0, 40, 100, 10] },
    ];
    expect(collectImages(ops, VIEW, PAGE).map(box)).toEqual([
      [10, 816, 50, 856],
      [100, 816, 140, 856],
    ]);
  });

  it("composes matrices with the second applied first", () => {
    const m = multiplyMatrix([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 3, 4]);
    expect(m).toEqual([2, 0, 0, 2, 6, 8]);
  });
});

describe("merging and filtering", () => {
  const img = (x0: number, y0: number, x1: number, y1: number, dpi: number | null = null) => ({
    x0,
    y0,
    x1,
    y1,
    dpi,
  });

  it("joins images that overlap or touch, over a chain, keeping the best resolution", () => {
    const merged = mergeImages(
      [
        img(0, 0, 100, 100, 200),
        img(100, 0, 200, 100, 350), // adjacent strip
        img(150, 90, 260, 200, null), // overlaps the second
        img(400, 400, 500, 500),
      ],
      3,
    );
    expect(merged).toHaveLength(2);
    expect(box(merged[0])).toEqual([0, 0, 260, 200]);
    expect(merged[0].dpi).toBe(350);
    expect(box(merged[1])).toEqual([400, 400, 500, 500]);
  });

  it("joins images within the gap, not beyond it", () => {
    expect(mergeImages([img(0, 0, 50, 50), img(52, 0, 100, 50)], 3)).toHaveLength(1);
    expect(mergeImages([img(0, 0, 50, 50), img(54, 0, 100, 50)], 3)).toHaveLength(2);
  });

  it("joins a pair that only a third image links", () => {
    const merged = mergeImages([img(0, 0, 40, 40), img(200, 0, 240, 40), img(30, 0, 210, 40)], 0);
    expect(merged).toHaveLength(1);
  });

  it("drops what is under half an inch on either side, or under 1.5% of the page", () => {
    // 36 pt = 0.5 in.
    expect(isFigureSized(img(0, 0, 36, 300), PAGE)).toBe(true);
    expect(isFigureSized(img(0, 0, 35.9, 300), PAGE)).toBe(false);
    expect(isFigureSized(img(0, 0, 300, 35.9), PAGE)).toBe(false);
    // 1.5% of 612 x 866 = 7950 pt2: 40 x 190 = 7600 is under, 40 x 200 = 8000 over.
    expect(isFigureSized(img(0, 0, 40, 190), PAGE)).toBe(false);
    expect(isFigureSized(img(0, 0, 40, 200), PAGE)).toBe(true);
    // Badges and bullets.
    expect(isFigureSized(img(0, 0, 14, 14), PAGE)).toBe(false);
  });

  it("scans a page: strips merge into one figure before the size filter, icons are skipped", () => {
    const strips = Array.from({ length: 5 }, (_, i) => image(100 + i * 60, 400, 60, 30)).flat();
    const ops: GfxOp[] = [...strips, ...image(20, 800, 16, 16), ...image(560, 800, 20, 20)];
    const scan = scanFigures(ops, VIEW, PAGE);
    expect(scan.drawn).toBe(7);
    // Each strip is 60 x 30 (under half an inch tall? no: 30 < 36), together 300 x 30 still too thin.
    expect(scan.figures).toHaveLength(0);
    expect(scan.skipped).toHaveLength(3);
    const tall = Array.from({ length: 3 }, (_, i) => image(100 + i * 100, 400, 100, 60)).flat();
    const joined = scanFigures(tall, VIEW, PAGE);
    expect(joined.figures.map(box)).toEqual([[100, 406, 400, 466]]);
  });
});

describe("pdf.js operator lists", () => {
  const codes: OpCodes = {
    save: 10,
    restore: 11,
    transform: 12,
    paintFormXObjectBegin: 20,
    paintFormXObjectEnd: 21,
    paintImageXObject: 30,
    paintInlineImageXObject: 31,
    paintImageXObjectRepeat: 32,
    paintImageMaskXObject: 33,
    paintImageMaskXObjectGroup: 34,
  };

  it("turns a form XObject into a saved state with its matrix, and reads images' pixel sizes", () => {
    const fn = [20, 12, 30, 21, 31, 33, 99];
    const args = [
      [
        [1, 0, 0, 1, 7, 8],
        [0, 0, 5, 5],
      ],
      [2, 0, 0, 2, 0, 0],
      ["img_1", 640, 480],
      [],
      [{ width: 100, height: 50 }],
      [{ width: 20, height: 10 }],
      [],
    ];
    const ops = gfxOpsFrom(fn, args, codes);
    expect(ops).toEqual([
      { op: "save" },
      { op: "transform", m: [1, 0, 0, 1, 7, 8] },
      { op: "transform", m: [2, 0, 0, 2, 0, 0] },
      { op: "image", width: 640, height: 480 },
      { op: "restore" },
      { op: "image", width: 100, height: 50 },
      { op: "image", width: 20, height: 10 },
    ]);
  });

  it("handles a form with no matrix, repeats and groups, and bad arguments", () => {
    const fn = [20, 32, 34, 30, 12];
    const args = [
      [null, null],
      ["img", 10, 20, [1, 2, 3, 4, 5]],
      [[{ transform: [3, 0, 0, 3, 0, 0], width: 9, height: 9 }, { transform: "x" }]],
      ["img", "wide", -1],
      [1, 2, "three"],
    ];
    const ops = gfxOpsFrom(fn, args, codes);
    expect(ops).toEqual([
      { op: "save" },
      { op: "image", extra: [10, 0, 0, 20, 1, 2] },
      { op: "image", extra: [10, 0, 0, 20, 3, 4] },
      { op: "image", extra: [3, 0, 0, 3, 0, 0], width: 9, height: 9 },
      { op: "image", width: undefined, height: undefined },
    ]);
  });
});

describe("classifying a page", () => {
  const FIG = (x0: number, y0: number, x1: number, y1: number, dpi: number | null = null) => ({
    x0,
    y0,
    x1,
    y1,
    dpi,
  });
  const scan = (figures: PageImage[], skipped: PageImage[] = []) => ({
    figures,
    skipped,
    drawn: figures.length + skipped.length,
  });

  it("TEXT_ONLY: text of its own and no picture worth reading, with nothing to read", () => {
    const plan = classifyPage(false, scan([], [FIG(10, 10, 24, 24)]), PAGE);
    expect(plan).toMatchObject({ condition: "TEXT_ONLY", regions: [], known: true });
  });

  it("TEXT_WITH_FIGURES: text and a picture: only the picture's area, padded and kept on the page", () => {
    const plan = classifyPage(false, scan([FIG(0, 100, 300, 400, 350)]), PAGE);
    expect(plan.condition).toBe("TEXT_WITH_FIGURES");
    expect(plan.checkRest).toBe(false);
    expect(plan.regions).toEqual([{ x0: 0, y0: 94, x1: 306, y1: 406, dpi: 350 }]);
  });

  it("a page shaped like 53 p10: six pictures, two of them tiny: four regions", () => {
    // Four figures in a 2 x 2 grid and two small ones (badges) beside the text.
    const images = [
      FIG(30, 40, 270, 300),
      FIG(310, 40, 560, 300),
      FIG(30, 340, 270, 600),
      FIG(310, 340, 560, 600),
      FIG(570, 10, 590, 30),
      FIG(20, 10, 42, 30),
    ];
    const ops: GfxOp[] = images.flatMap((i) => image(i.x0, 866 - i.y1, i.x1 - i.x0, i.y1 - i.y0));
    const found = scanFigures(ops, VIEW, PAGE);
    expect(found.drawn).toBe(6);
    expect(found.figures).toHaveLength(4);
    expect(found.skipped).toHaveLength(2);
    const plan = classifyPage(false, found, PAGE);
    expect(plan.condition).toBe("TEXT_WITH_FIGURES");
    expect(plan.regions).toHaveLength(4);
    for (const r of plan.regions) expect(r.x1 - r.x0).toBeGreaterThan(240);
  });

  it("padded regions that now touch are one, so nothing is read twice", () => {
    const plan = classifyPage(false, scan([FIG(0, 0, 100, 100), FIG(108, 0, 200, 100)]), PAGE);
    expect(plan.regions).toHaveLength(1);
    expect(padRegions([FIG(0, 0, 10, 10)], 6, PAGE)).toEqual([
      { x0: 0, y0: 0, x1: 16, y1: 16, dpi: null },
    ]);
  });

  it("SCANNED: hardly any text and a picture over most of the page: the whole page", () => {
    // A scan with a page number: one picture, 98% of the page.
    const plan = classifyPage(true, scan([FIG(5, 5, 607, 861)]), PAGE);
    expect(plan.condition).toBe("SCANNED");
    expect(plan.regions).toEqual([{ x0: 0, y0: 0, x1: 612, y1: 866, dpi: null }]);
    expect(plan.checkRest).toBe(false);
    // Just under the share is not a scan by itself.
    const w = Math.sqrt(0.59 * PAGE.width * PAGE.height);
    expect(classifyPage(true, scan([FIG(0, 0, w, w)]), PAGE).condition).toBe("TEXT_WITH_FIGURES");
    expect(classifyPage(true, scan([FIG(0, 0, 612, 0.6 * 866)]), PAGE).condition).toBe("SCANNED");
  });

  it("a sparse page whose pictures are not most of it reads the pictures, after checking the rest for ink", () => {
    const plan = classifyPage(true, scan([FIG(50, 50, 300, 300)]), PAGE);
    expect(plan.condition).toBe("TEXT_WITH_FIGURES");
    expect(plan.checkRest).toBe(true);
    expect(plan.regions).toHaveLength(1);
  });

  it("NO_TEXT_NO_IMAGE_NOT_BLANK: no text and no picture worth reading: the whole page", () => {
    const plan = classifyPage(true, scan([], [FIG(0, 0, 20, 20)]), PAGE);
    expect(plan.condition).toBe("NO_TEXT_NO_IMAGE_NOT_BLANK");
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]).toMatchObject({ x0: 0, y0: 0, x1: 612, y1: 866 });
  });

  it("BLANK: a raster with no ink settles a page with no text; a page with some text is TEXT_ONLY", () => {
    const plan = classifyPage(true, scan([]), PAGE);
    expect(settledCondition(plan, false, false)).toBe("BLANK");
    expect(settledCondition(plan, true, false)).toBe("TEXT_ONLY");
    expect(settledCondition(plan, false, true)).toBe("NO_TEXT_NO_IMAGE_NOT_BLANK");
  });

  it("without the pictures (setting off, operators unreadable): sparse pages are read whole, as before", () => {
    expect(classifyPage(true, null, PAGE)).toMatchObject({ condition: "SCANNED", known: false });
    expect(classifyPage(false, null, PAGE)).toMatchObject({ condition: "TEXT_ONLY", known: false });
  });
});

describe("the raster of a region", () => {
  const region = (w: number, h: number, dpi: number | null) => ({
    x0: 0,
    y0: 0,
    x1: w,
    y1: h,
    dpi,
  });

  it("follows the picture's own resolution between 170 and 300 dpi", () => {
    expect(regionRaster(region(200, 150, 240)).scale).toBeCloseTo(240 / 72, 6);
    expect(regionRaster(region(200, 150, 90)).scale).toBeCloseTo(170 / 72, 6);
    expect(regionRaster(region(200, 150, 900)).scale).toBeCloseTo(300 / 72, 6);
    expect(regionRaster(region(200, 150, null)).scale).toBeCloseTo(170 / 72, 6);
  });

  it("is capped at 2200 px on the long side", () => {
    const r = regionRaster(region(600, 300, 600));
    expect(r.width).toBeLessThanOrEqual(2200);
    expect(r.width).toBeGreaterThanOrEqual(2199);
    expect(r.scale).toBeCloseTo(2200 / 600, 6);
    const tall = regionRaster(region(100, 800, 300));
    expect(tall.height).toBeLessThanOrEqual(2200);
  });

  it("rounds the size up so the region's edge is inside the image", () => {
    const r = regionRaster(region(100.2, 50.1, 200));
    expect(r.width).toBe(Math.ceil(100.2 * r.scale));
    expect(OCR_TUNING.figureMinDpi).toBe(170);
  });
});
