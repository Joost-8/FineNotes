import { describe, expect, it } from "vitest";
import { isNoteful, NOTEFUL_SCALE, NotefulError, readNoteful } from "../../src/import/noteful";
import { NotefulMessage, readFields } from "../../src/import/noteful-fields";
import { importNotebooks } from "../../src/import/import-notebook";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { JPEG, PDF, zip } from "./builders";
import {
  inkRecord,
  message,
  notefulFile,
  pathObject,
  pictureObject,
  shapeObject,
  strokeBlock,
  textObject,
} from "./noteful-builders";

const K = NOTEFUL_SCALE;
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

describe("noteful fields", () => {
  it("reads every kind of value, arrays and version stamps", () => {
    const bytes = message([
      { id: 1, value: { u8: 7 } },
      { id: 2, value: { i64: 2 ** 40 }, versioned: true },
      { id: 3, value: { f32: 1.5 } },
      { id: 4, value: { f64: 2.25 } },
      { id: 5, value: [{ str: "a" }, { str: "bé" }] },
      { id: 6, value: { bytes: new Uint8Array([9, 9]) } },
      { id: 7, value: { msg: [{ id: 1, value: { u16: 3 } }] } },
      { id: 8, value: { u32: 70000 } },
      { id: 9, value: { d: -1 } },
      { id: 10, value: { pair: [3, 4] } },
    ]);
    const m = new NotefulMessage(bytes, readFields(bytes, 0, bytes.length));
    expect(m.number(1)).toBe(7);
    expect(m.number(2)).toBe(2 ** 40);
    expect(m.number(3)).toBe(1.5);
    expect(m.number(4)).toBe(2.25);
    expect(m.strings(5)).toEqual(["a", "bé"]);
    expect(m.string(1)).toBeUndefined();
    expect(m.span(6)).toBeDefined();
    expect(m.message(7)?.number(1)).toBe(3);
    expect(m.number(8)).toBe(70000);
    expect(m.number(9)).toBe(-1);
    expect(m.pair(10)).toEqual([3, 4]);
    expect(m.pair(1)).toBeUndefined();
    expect(m.number(5)).toBeUndefined();
    expect(m.numbers(99)).toEqual([]);
  });

  it("refuses bytes that do not fit", () => {
    const ok = message([{ id: 1, value: { str: "hello" } }]);
    expect(() => readFields(ok, 0, ok.length - 1)).toThrow(NotefulError);
    expect(() => readFields(new Uint8Array([0, 1, 0, 0x30]), 0, 4)).toThrow(/unknown field type/);
    expect(() => readFields(new Uint8Array([0, 1, 0x10, 1, 0]), 0, 5)).toThrow(/flags/);
    expect(() => readFields(new Uint8Array([0, 1, 4, 1, 0, 0, 9, 0]), 0, 8)).toThrow(/array/);
    expect(() => readFields(new Uint8Array([0, 1]), 0, 2)).toThrow(NotefulError);
  });
});

describe("readNoteful", () => {
  const paper = { kind: "paper" as const, pdf: "PAPER" };

  it("recognises a Noteful file by its magic at both ends", () => {
    const file = notefulFile({ pages: [{ id: "P1", key: "a" }] });
    expect(isNoteful(file)).toBe(true);
    expect(isNoteful(file.subarray(0, file.length - 1))).toBe(false);
    expect(isNoteful(new Uint8Array(10))).toBe(false);
    expect(() => readNoteful(new Uint8Array(30), "x")).toThrow(NotefulError);
  });

  it("keeps live pages in key order, with their paper and size", () => {
    const result = readNoteful(
      notefulFile({
        title: " Biology ",
        pages: [
          { id: "P2", key: "+b", paper, size: [1122.5, 1449.92] },
          {
            id: "P1",
            key: "+a",
            paper: { kind: "pdf", pdf: "SLIDES", page: 3 },
            size: [1543.46, 1091.34],
          },
          { id: "P3", key: "+c", alive: false },
          { id: "P4", key: "+d" },
          { id: "P5", key: "+e", paper: { kind: "paper", pdf: "GONE" } },
        ],
        records: { PAPER: PDF, SLIDES: PDF },
      }),
      "fallback",
    );
    expect(result.source).toBe("noteful");
    expect(result.title).toBe("Biology");
    expect(result.doc.pages).toHaveLength(4);
    const [slides, lined, plain, gone] = result.doc.pages;
    expect(slides.backdrop).toEqual({ kind: "pdf", path: "Biology - document 1.pdf", page: 3 });
    expect(slides.geometry).toEqual({
      width: Math.round(1543.46 * K),
      height: Math.round(1091.34 * K),
    });
    expect(lined.backdrop).toEqual({ kind: "pdf", path: "Biology - paper 2.pdf", page: 0 });
    expect(plain.backdrop).toEqual({ kind: "blank" });
    expect(gone.backdrop).toEqual({ kind: "blank" });
    expect(result.attachments.map((a) => a.name)).toEqual([
      "Biology - document 1.pdf",
      "Biology - paper 2.pdf",
    ]);
    expect(result.warnings).toEqual(["1 picture or paper were not in the file."]);
  });

  it("reads strokes: colours, float and quantized points, and every flag", () => {
    const block = strokeBlock([
      {
        points: [
          [10, 20],
          [30, 40],
        ],
      },
      { color: [1, 0, 0] },
      {
        points: [
          [0, 0],
          [100, 50],
          [200, 100],
          [300, 0],
        ],
        width: 4,
      },
      { color: [0, 0.5, 1], highlighter: true },
      {
        points: [
          [5, 5],
          [6, 6],
        ],
        values: true,
      },
      { color: [0, 0, 0] },
      {
        points: [
          [0, 0],
          [10, 10],
          [20, 0],
          [30, 10],
          [40, 0],
        ],
        values: true,
        segments: 4,
        wide: true,
      },
    ]);
    const result = readNoteful(
      notefulFile({
        pages: [{ id: "P1", key: "a", ink: "INK" }],
        records: { INK: inkRecord(block) },
      }),
      "Notes",
    );
    const [first, red, light, last] = result.doc.pages[0].strokes;
    expect(first.color).toBe("#000000");
    expect(first.tool).toBe("pen");
    expect(first.pts).toEqual([
      +(10 * K).toFixed(2),
      +(20 * K).toFixed(2),
      0.5,
      +(30 * K).toFixed(2),
      +(40 * K).toFixed(2),
      0.5,
    ]);
    expect(red.color).toBe("#ff0000");
    expect(red.size).toBeCloseTo(4 * K, 1);
    expect(near(red.pts[3], 100 * K)).toBe(true);
    expect(near(red.pts[4], 50 * K)).toBe(true);
    expect(near(red.pts[9], 300 * K)).toBe(true);
    // The highlighter flag, and float points with a third value interleaved.
    expect(light.tool).toBe("highlighter");
    expect(light.color).toBe("#0080ff");
    expect(light.pts.filter((_, i) => i % 3 !== 2)).toEqual(
      [5, 5, 6, 6].map((v) => +(v * K).toFixed(2)),
    );
    // Quantized points with the third value, segment arrays and the wide header.
    expect(last.pts.length).toBe(15);
    expect(near(last.pts[3], 10 * K)).toBe(true);
    expect(near(last.pts[13], 0)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("stops at an element it does not know, and says so", () => {
    const block = strokeBlock([
      {
        points: [
          [1, 1],
          [2, 2],
        ],
      },
      { tag: 0xf1aa },
    ]);
    const odd = strokeBlock([
      {
        points: [
          [1, 1],
          [2, 2],
        ],
        flags: 4,
      },
    ]);
    const result = readNoteful(
      notefulFile({
        pages: [
          { id: "P1", key: "a", ink: "INK" },
          { id: "P2", key: "b", ink: "ODD" },
          { id: "P3", key: "c", ink: "BROKEN" },
        ],
        records: { INK: inkRecord(block), ODD: inkRecord(odd), BROKEN: new Uint8Array([1, 2, 3]) },
      }),
      "x",
    );
    expect(result.doc.pages[0].strokes).toHaveLength(1);
    expect(result.doc.pages[1].strokes).toHaveLength(0);
    expect(result.warnings).toEqual(["2 pages had ink that could not all be read."]);
  });

  it("brings pictures, text boxes and drawn lines over, and counts other shapes", () => {
    const objects = [
      pictureObject("O1", "PIC", [200, 100, 100, 50], 0.5),
      textObject("O2", "Hello", [300, 400, 200, 40]),
      textObject("O3", "   ", [300, 400, 200, 40]),
      pathObject("O4", [50, 100, 0, 200], [0, 200, 0, 0], [0, 1]),
      pathObject("O5", [100, 100, 100, 100], [0, 0, 0, 100, 100, 100, 100, 0], [0, 3], 21),
      pathObject("O6", [100, 100, 100, 100], [0, 0, 50, 0, 100, 50, 100, 100], [0, 2, 4, 9], 12),
      shapeObject("O7", 4),
      pictureObject("O8", "MISSING", [10, 10, 10, 10]),
      { id: "O9", alive: false, fields: shapeObject("O9", 3).fields },
      { id: "O10", fields: [{ id: 1, value: { str: "O10" } }] },
    ];
    const result = readNoteful(
      notefulFile({
        title: "Lab",
        pages: [{ id: "P1", key: "a", ink: "INK" }],
        records: { INK: inkRecord(strokeBlock([]), objects), PIC: JPEG },
      }),
      "x",
    );
    const page = result.doc.pages[0];
    expect(page.images).toEqual([
      {
        id: "i1",
        path: "Lab - picture 1.jpg",
        x: +(150 * K).toFixed(2),
        y: +(75 * K).toFixed(2),
        w: +(100 * K).toFixed(2),
        h: +(50 * K).toFixed(2),
        rotation: 0.5,
      },
    ]);
    expect(page.textBoxes).toHaveLength(1);
    expect(page.textBoxes[0]).toMatchObject({
      text: "Hello",
      color: "#ff0000",
      x: +(200 * K).toFixed(2),
    });
    expect(page.textBoxes[0].fontSize).toBeCloseTo(20 * K, 1);
    const [line, curve, shape] = page.strokes;
    expect(line.color).toBe("#0000ff");
    expect(line.size).toBeCloseTo(3 * K, 1);
    expect(line.pts).toEqual([
      +(50 * K).toFixed(2),
      +(200 * K).toFixed(2),
      0.5,
      +(50 * K).toFixed(2),
      0,
      0.5,
    ]);
    // A cubic curve, sampled: it ends where its last control point says.
    expect(curve.pts.length).toBe(3 * 17);
    expect(near(curve.pts[curve.pts.length - 3], 150 * K)).toBe(true);
    // A quadratic, a close back to the start, and an unknown command's point.
    expect(shape.pts.length).toBe(3 * (1 + 16 + 1 + 1));
    expect(result.warnings).toEqual([
      "2 items (shapes or other elements) could not be brought over yet.",
      "1 picture or paper were not in the file.",
    ]);
  });

  it("names the notebook after the file when it has no title, and refuses an empty one", () => {
    expect(readNoteful(notefulFile({ pages: [{ id: "P1", key: "a" }] }), "Physics").title).toBe(
      "Physics",
    );
    expect(() => readNoteful(notefulFile({ pages: [] }), "x")).toThrow(/no pages/);
    expect(() =>
      readNoteful(notefulFile({ pages: [{ id: "P1", key: "a", alive: false }] }), "x"),
    ).toThrow(/no pages/);
  });

  it("is chosen from the bytes, alone or in a backup, and reads back unchanged", () => {
    const file = notefulFile({
      title: "Chem",
      pages: [{ id: "P1", key: "a", ink: "INK" }],
      records: {
        INK: inkRecord(
          strokeBlock([
            {
              points: [
                [1, 2],
                [3, 4],
              ],
            },
          ]),
        ),
      },
    });
    expect(importNotebooks(file, "Chem.noteful").results[0].source).toBe("noteful");
    const backup = importNotebooks(zip({ "Archive/Year 1/Chem.noteful": file }), "Archive.zip");
    expect(backup.results.map((r) => r.title)).toEqual(["Chem"]);
    const result = readNoteful(file, "x");
    const back = parseInkFile(buildInkFile("# Chem\n", result.doc)).doc;
    const xy = (pts: number[] = []) => pts.filter((_, i) => i % 3 !== 2);
    expect(xy(back?.pages[0].strokes[0].pts)).toEqual(xy(result.doc.pages[0].strokes[0].pts));
  });
});
