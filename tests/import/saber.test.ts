import { describe, expect, it } from "vitest";
import {
  fromBase64,
  isSaber,
  isSaberArchive,
  readSaber,
  readSaberArchive,
  SaberError,
  SABER_SCALE,
} from "../../src/import/saber";
import { BsonError, looksLikeBson, readBson } from "../../src/import/bson";
import { parseInkFile, buildInkFile } from "../../src/model/serialize";
import { pressureForWidth } from "../../src/import/import-types";
import { JPEG, PDF, PNG } from "./builders";
import { ascii, bson, Int32, Int64, note, point, rawDoc, type BsonIn } from "./saber-builders";

const K = SABER_SCALE;
const BLACK = new Int64(0xff000000);
const json = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

describe("readSaber", () => {
  it("reads pages in Saber's default A4-like size", () => {
    const result = readSaber(
      note([
        { w: 1000.0, h: 1400.0 },
        { w: 1400.5, h: 1000.5, s: [{ p: [point(1, 1)], c: BLACK }] },
      ]),
      "Physics",
    );
    expect(result.source).toBe("saber");
    expect(result.title).toBe("Physics");
    expect(K).toBeCloseTo(1.024);
    expect(result.doc.pages.map((p) => p.geometry)).toEqual([
      { width: 1024, height: 1434 },
      { width: Math.round(1400.5 * K), height: Math.round(1000.5 * K) },
    ]);
    expect(result.doc.view.width).toBe(1024);
    expect(result.attachments).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("drops the empty page Saber keeps at the end, but never the only page", () => {
    const one = readSaber(
      note([
        { w: 1000.0, h: 1400.0 },
        { w: 1000.0, h: 1400.0 },
      ]),
      "x",
    );
    expect(one.doc.pages).toHaveLength(1);
    const withText = readSaber(
      note([
        { w: 1000.0, h: 1400.0 },
        { w: 1000.0, h: 1400.0, q: [{ insert: "\n" }] },
      ]),
      "x",
    );
    expect(withText.doc.pages).toHaveLength(1);
    const empty = readSaber(note([]), "x");
    expect(empty.doc.pages).toHaveLength(1);
    expect(empty.doc.pages[0].geometry).toEqual({ width: 1024, height: 1434 });
  });

  it("maps every background pattern, its line height and the paper colour", () => {
    const expected: Array<[string, string]> = [
      ["", "blank"],
      ["college", "legal"],
      ["college-rtl", "ruled-wide"],
      ["lined", "ruled-wide"],
      ["grid", "squared"],
      ["dots", "dotted"],
      ["staffs", "music"],
      ["tablature", "guitar-tab"],
      ["cornell", "cornell"],
      ["something-new", "blank"],
    ];
    for (const [pattern, ruling] of expected) {
      const page = readSaber(note([{ w: 1000.0, h: 1400.0 }], { p: pattern, l: 50 }), "x").doc
        .pages[0];
      expect(page.backdrop.kind).toBe(ruling);
      if (ruling !== "blank" && page.backdrop.kind !== "pdf")
        expect(page.backdrop.spacing).toBeCloseTo(50 * K, 2);
    }
    const cream = readSaber(
      note([{ w: 1000.0, h: 1400.0 }], { p: "lined", b: new Int64(0xfffff8e1) }),
      "x",
    ).doc.pages[0].backdrop;
    expect(cream).toEqual({ kind: "ruled-wide", spacing: 40.96, paperColor: "#fff8e1" });
    const white = readSaber(note([{ w: 1000.0, h: 1400.0 }], { b: new Int64(0xffffffff) }), "x").doc
      .pages[0].backdrop;
    expect(white).toEqual({ kind: "blank" });
  });

  it("converts strokes: points, offset, pressure, size and colour", () => {
    const result = readSaber(
      note([
        {
          w: 1000.0,
          h: 1400.0,
          s: [
            {
              shape: null,
              p: [point(100, 200, 0.5), point(110, 205, 0.25), point(120, 210, 1), point(NaN, 1)],
              i: 0,
              ty: "fountainPen",
              pe: true,
              c: new Int64(0xff1e88e5),
              s: 5.0,
              ox: 10.0,
              oy: -20.0,
            },
            { p: [point(1, 2, 0.9)], pe: false, c: BLACK },
            { p: [point(5, 5)], ty: "ballpointPen", c: new Int32(-16777216) },
          ],
        },
      ]),
      "x",
    );
    const [pen, flat, ball] = result.doc.pages[0].strokes;
    expect(pen.id).toBe("s1");
    expect(pen.color).toBe("#1e88e5");
    expect(pen.tool).toBe("pen");
    expect(pen.shape).toBeUndefined();
    // Widths 5, 3.75 and 7.5 Saber units; the median is the nib.
    expect(pen.size).toBeCloseTo(5 * K, 2);
    expect(pen.pts).toHaveLength(9);
    expect(pen.pts.slice(0, 2)).toEqual([110 * K, 180 * K].map((v) => Math.round(v * 100) / 100));
    expect(pen.pts[2]).toBeCloseTo(pressureForWidth(5 * K, pen.size), 5);
    expect(pen.pts[5]).toBeLessThan(pen.pts[2]);
    expect(pen.pts[8]).toBeGreaterThan(pen.pts[2]);
    // Pressure off: drawn at the nib, size defaults to Saber's 10.
    expect(flat.pts[2]).toBe(0.5);
    expect(flat.size).toBeCloseTo(10 * K, 2);
    expect(flat.id).toBe("s2");
    expect(ball.color).toBe("#000000");
    expect(ball.pts[2]).toBe(0.5);
    expect(result.warnings).toEqual([]);
  });

  it("makes the highlighter the highlighter, and a translucent pen too", () => {
    const strokes = readSaber(
      note([
        {
          w: 1000.0,
          h: 1400.0,
          s: [
            { p: [point(0, 0), point(50, 0)], ty: "Highlighter", c: new Int64(0x64ffeb3b), s: 30 },
            { p: [point(0, 0)], ty: "Pen", c: new Int64(0x80ff0000) },
          ],
        },
      ]),
      "x",
    ).doc.pages[0].strokes;
    expect(strokes.map((s) => [s.tool, s.color])).toEqual([
      ["highlighter", "#ffeb3b"],
      ["highlighter", "#ff0000"],
    ]);
    expect(strokes[0].size).toBeCloseTo(30 * K, 2);
  });

  it("turns Saber's circles and rectangles into FineNotes shapes", () => {
    const result = readSaber(
      note([
        {
          w: 1000.0,
          h: 1400.0,
          s: [
            { shape: "circle", cx: 500.0, cy: 400.0, r: 100.0, c: BLACK, ty: "ShapePen" },
            { shape: "rect", rl: 10.0, rt: 20.0, rw: 300.0, rh: 100.0, c: BLACK },
            { shape: "circle", cx: 1.0, cy: 1.0, r: 0.0, c: BLACK },
            { shape: "triangle", c: BLACK },
            { c: BLACK },
            { p: [point(NaN, 0), "junk"], c: BLACK },
          ],
        },
      ]),
      "x",
    );
    const [circle, rect] = result.doc.pages[0].strokes;
    expect(circle.shape).toBe("circle");
    expect(circle.pts).toHaveLength(33 * 3);
    expect(circle.pts.slice(0, 2)).toEqual([614.4, 409.6]);
    expect(circle.pts.slice(-3, -1)).toEqual([614.4, 409.6]);
    expect(rect.shape).toBe("rect");
    expect(rect.pts).toEqual([
      10.24, 20.48, 0.5, 317.44, 20.48, 0.5, 317.44, 122.88, 0.5, 10.24, 122.88, 0.5, 10.24, 20.48,
      0.5,
    ]);
    expect(result.doc.pages[0].strokes).toHaveLength(2);
    expect(result.warnings).toEqual(["4 strokes could not be read."]);
  });

  it("brings pictures over from the assets, with their crop, and saves each asset once", () => {
    const result = readSaber(
      note([
        {
          w: 1000.0,
          h: 1400.0,
          i: [
            { id: 0, e: ".jpg", i: 0, x: 100.0, y: 50.0, w: 200.0, h: 100.0, a: 0 },
            {
              id: 1,
              e: ".png",
              x: 0.0,
              y: 0.0,
              w: 400.0,
              h: 300.0,
              a: 1,
              sx: 100.0,
              sy: 0.0,
              sw: 800.0,
              sh: 600.0,
              nw: 1000.0,
              nh: 600.0,
            },
            { id: 2, e: ".jpg", x: 0.0, y: 0.0, w: 10.0, h: 10.0, a: 0 },
          ],
        },
      ]),
      "Trip",
      new Map([
        ["Trip.sbn2.0", JPEG],
        ["1", PNG],
      ]),
    );
    const images = result.doc.pages[0].images;
    expect(images).toHaveLength(3);
    expect(images[0]).toEqual({
      id: "i1",
      path: "Trip - picture 1.jpg",
      x: 102.4,
      y: 51.2,
      w: 204.8,
      h: 102.4,
    });
    expect(images[1].path).toBe("Trip - picture 2.png");
    expect(images[1].crop).toEqual({ x: 0.1, y: 0, w: 0.8, h: 1 });
    expect(images[2].path).toBe("Trip - picture 1.jpg");
    expect(result.attachments.map((a) => [a.name, a.mime])).toEqual([
      ["Trip - picture 1.jpg", "image/jpeg"],
      ["Trip - picture 2.png", "image/png"],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("reports missing pictures, SVGs and PDFs placed on a page", () => {
    const result = readSaber(
      note([
        {
          w: 1000.0,
          h: 1400.0,
          i: [
            { e: ".jpg", x: 0.0, y: 0.0, w: 10.0, h: 10.0, a: 4 },
            { e: ".svg", x: 0.0, y: 0.0, w: 10.0, h: 10.0, a: 0 },
            { e: ".pdf", x: 0.0, y: 0.0, w: 10.0, h: 10.0, a: 0, pdfi: 0 },
            { e: ".jpg", x: 0.0, y: 0.0, w: 0.0, h: 10.0, a: 0 },
            { e: ".jpg", x: 0.0, y: 0.0, w: 10.0, h: 10.0, a: 0, nw: 10.0, nh: 10.0, sw: 10.0 },
          ],
        },
      ]),
      "x",
      new Map([["0", JPEG]]),
    );
    expect(result.doc.pages[0].images).toHaveLength(1);
    expect(result.doc.pages[0].images[0].crop).toBeUndefined();
    expect(result.warnings).toEqual([
      "1 picture was not found in the file. Export the note from Saber as a .sba file to bring pictures over.",
      "3 items (SVG pictures or PDFs placed on a page) could not be brought over yet.",
    ]);
  });

  it("puts PDF-backed pages on their PDF page, and leaves them blank when it is missing", () => {
    const pdfBg = (page: number) => ({ id: 0, e: ".pdf", i: 0, a: 0, pdfi: page, f: 1 });
    const pages: Array<{ [key: string]: BsonIn }> = [
      { w: 595.0, h: 842.0, b: pdfBg(0) },
      { w: 595.0, h: 842.0, b: pdfBg(1), s: [{ p: [point(1, 1)], c: BLACK }] },
    ];
    const result = readSaber(note(pages), "Slides", new Map([["0", PDF]]));
    expect(result.doc.pages.map((p) => p.backdrop)).toEqual([
      { kind: "pdf", path: "Slides - pdf 1.pdf", page: 0 },
      { kind: "pdf", path: "Slides - pdf 1.pdf", page: 1 },
    ]);
    expect(result.attachments).toHaveLength(1);
    expect(result.warnings).toEqual([]);

    const missing = readSaber(note(pages), "Slides");
    expect(missing.doc.pages.map((p) => p.backdrop.kind)).toEqual(["blank", "blank"]);
    expect(missing.warnings).toEqual([
      "2 pages are drawn on a PDF that was not found in the file; they were left blank.",
    ]);
  });

  it("lays a picture background under the ink, keeping its shape when Saber does", () => {
    const result = readSaber(
      note([
        { w: 1000.0, h: 1400.0, b: { e: ".png", a: 0, f: 1, nw: 2000.0, nh: 1000.0 } },
        { w: 1000.0, h: 1400.0, b: { e: ".png", a: 0, f: 0, nw: 2000.0, nh: 1000.0 } },
        { w: 1000.0, h: 1400.0, b: { e: ".png", a: 9 } },
      ]),
      "x",
      new Map([["0", PNG]]),
    );
    const [contain, fill, gone] = result.doc.pages;
    expect(contain.images[0]).toEqual({
      id: "i1",
      path: "x - picture 1.png",
      x: 0,
      y: 461,
      w: 1024,
      h: 512,
      locked: true,
    });
    expect(fill.images[0]).toMatchObject({ x: 0, y: 0, w: 1024, h: 1434 });
    expect(gone.images).toEqual([]);
    expect(result.warnings[0]).toMatch(/^1 picture was not found/);
  });

  it("brings typed text over as a plain text box", () => {
    const result = readSaber(
      note(
        [
          {
            w: 1000.0,
            h: 1400.0,
            q: [
              { insert: "Heading" },
              { insert: "\n", attributes: { header: 1 } },
              { insert: { image: "x" } },
              { insert: "Body text\n\n" },
              "junk",
            ],
          },
        ],
        { l: 40 },
      ),
      "x",
    );
    const box = result.doc.pages[0].textBoxes[0];
    expect(box).toEqual({
      id: "t1",
      x: 20.48,
      y: 49.15,
      w: 983.04,
      text: "Heading\nBody text",
      color: "#000000",
      fontSize: 40.96,
      lineHeight: 1,
    });
    expect(result.warnings).toEqual([
      "Typed text came over as plain text; its formatting was not brought over.",
    ]);
  });

  it("warns about a note from a newer Saber", () => {
    const result = readSaber(note([{ w: 1000.0, h: 1400.0 }], { v: 25 }), "x");
    expect(result.warnings).toEqual([
      "This note was saved by a newer version of Saber; some of it may not have come over.",
    ]);
  });

  it("reads old notes: strokes and images at the top level with their page index", () => {
    const result = readSaber(
      bson({
        v: 7,
        w: 800.0,
        h: 1000.0,
        z: [[800.0, 1000.0]],
        s: [
          { p: [point(1, 2, 0.5)], i: 0, c: BLACK },
          { p: [point(3, 4, 0.5)], i: 2, c: BLACK },
          "junk",
        ],
        i: [{ e: ".jpg", i: 1, x: 0.0, y: 0.0, w: 10.0, h: 10.0, a: 0 }],
        a: [JPEG],
      }),
      "Old",
    );
    expect(result.doc.pages.map((p) => [p.strokes.length, p.images.length])).toEqual([
      [1, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(result.doc.pages[1].geometry).toEqual({ width: 819, height: 1024 });
    expect(result.attachments[0].bytes).toEqual(JPEG);
  });

  it("reads .sbn JSON, with points as maps and base64 assets", () => {
    const sbn = json({
      v: 10,
      b: 4294967295,
      p: "grid",
      l: 30,
      z: [
        {
          w: 1000,
          h: 1400,
          s: [
            {
              p: [
                { x: 1, y: 2, p: 0.5 },
                { x: 3, y: 4 },
              ],
              c: 4278190080,
            },
          ],
          i: [
            { e: ".png", x: 0, y: 0, w: 10, h: 10, a: 0 },
            { e: ".jpg", x: 0, y: 0, w: 10, h: 10, b: Array.from(JPEG) },
          ],
        },
      ],
      a: [btoa(String.fromCharCode(...PNG))],
    });
    expect(isSaber(sbn)).toBe(true);
    const result = readSaber(sbn, "Json");
    const page = result.doc.pages[0];
    expect(page.backdrop).toEqual({ kind: "squared", spacing: 30.72 });
    expect(page.strokes[0].pts).toEqual([1.02, 2.05, 0.5, 3.07, 4.1, 0.5]);
    expect(result.attachments.map((a) => a.mime)).toEqual(["image/png", "image/jpeg"]);
    expect(result.attachments[0].bytes).toEqual(PNG);
  });

  it("reads the oldest notes, a bare list of strokes", () => {
    const sbn = json([{ p: [{ x: 10, y: 10 }], i: 1, c: 4278190080 }]);
    expect(isSaber(sbn)).toBe(true);
    const result = readSaber(sbn, "Ancient");
    expect(result.doc.pages).toHaveLength(2);
    expect(result.doc.pages[1].strokes).toHaveLength(1);
  });

  it("survives a round trip through the FineNotes file", () => {
    const result = readSaber(
      note([
        {
          w: 1000.0,
          h: 1400.0,
          s: [{ p: [point(10, 10, 0.4), point(40, 50, 0.6)], c: new Int64(0xffe53935), s: 4 }],
          i: [{ e: ".jpg", x: 0.0, y: 0.0, w: 10.0, h: 10.0, a: 0 }],
          q: [{ insert: "Hello\n" }],
        },
      ]),
      "Round",
      new Map([["0", JPEG]]),
    );
    const back = parseInkFile(buildInkFile("# Round\n", result.doc)).doc;
    expect(back?.pages).toHaveLength(1);
    expect(back?.pages[0].strokes[0].color).toBe("#e53935");
    expect(back?.pages[0].images[0].path).toBe("Round - picture 1.jpg");
    expect(back?.pages[0].textBoxes[0].text).toBe("Hello");
  });

  it("refuses what is not a Saber note", () => {
    const garbage = [
      new Uint8Array(),
      new Uint8Array([1, 2, 3, 4, 5, 6]),
      new Uint8Array(ascii("not json at all")),
      new Uint8Array(ascii("{broken")),
      json({ hello: "world" }),
      json([]),
      json([1, 2]),
      json("string"),
      bson({ hello: "world" }),
      // Length matches and ends in 0, but the inside is broken.
      new Uint8Array([7, 0, 0, 0, 0x02, 0x61, 0]),
    ];
    for (const bytes of garbage) {
      expect(isSaber(bytes)).toBe(false);
      expect(() => readSaber(bytes, "x")).toThrow(SaberError);
    }
    expect(isSaber(note([]))).toBe(true);
    expect(isSaber(bson({ v: 3, s: [] }))).toBe(true);
  });
});

describe("readSaberArchive", () => {
  it("reads main.sbn2 and its numbered assets", () => {
    const files = new Map<string, Uint8Array>([
      [
        "main.sbn2",
        note([
          {
            w: 1000.0,
            h: 1400.0,
            b: { e: ".pdf", a: 1, pdfi: 2 },
            i: [{ e: ".jpg", x: 0.0, y: 0.0, w: 10.0, h: 10.0, a: 0 }],
          },
        ]),
      ],
      ["main.sbn2.0", JPEG],
      ["main.sbn2.1", PDF],
    ]);
    expect(isSaberArchive(files)).toBe(true);
    const result = readSaberArchive(files, "Lecture");
    expect(result.doc.pages[0].backdrop).toEqual({
      kind: "pdf",
      path: "Lecture - pdf 1.pdf",
      page: 2,
    });
    expect(result.doc.pages[0].images[0].path).toBe("Lecture - picture 2.jpg");
    expect(result.warnings).toEqual([]);
  });

  it("finds the note one folder down, and refuses a zip without one", () => {
    const nested = new Map([
      ["Lecture/main.sbn2", note([])],
      ["Lecture/main.sbn2.0", JPEG],
    ]);
    expect(isSaberArchive(nested)).toBe(true);
    expect(readSaberArchive(nested, "x").doc.pages).toHaveLength(1);
    const other = new Map([["index.events.pb", new Uint8Array()]]);
    expect(isSaberArchive(other)).toBe(false);
    expect(() => readSaberArchive(other, "x")).toThrow(SaberError);
    expect(() => readSaberArchive(new Map([["main.sbn2", JPEG]]), "x")).toThrow(SaberError);
  });
});

describe("BSON reader", () => {
  it("reads every type a note can hold", () => {
    const doc = readBson(
      rawDoc([
        [0x01, ...ascii("d"), 0, ...new Uint8Array(new Float64Array([1.5]).buffer)],
        [0x02, ...ascii("s"), 0, 3, 0, 0, 0, ...ascii("hi"), 0],
        [0x08, ...ascii("t"), 0, 1],
        [0x0a, ...ascii("n"), 0],
        [0x06, ...ascii("u"), 0],
        [0xff, ...ascii("min"), 0],
        [0x7f, ...ascii("max"), 0],
        [0x07, ...ascii("oid"), 0, ...new Array<number>(12).fill(1)],
        [0x09, ...ascii("date"), 0, 1, 0, 0, 0, 1, 0, 0, 0],
        [0x11, ...ascii("ts"), 0, ...new Array<number>(8).fill(0)],
        [0x13, ...ascii("dec"), 0, ...new Array<number>(16).fill(0)],
        [0x05, ...ascii("old"), 0, 6, 0, 0, 0, 2, 2, 0, 0, 0, 9, 8],
        [0x12, ...ascii("neg"), 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      ]),
    );
    expect({ ...doc, old: Array.from(doc.old as Uint8Array) }).toEqual({
      d: 1.5,
      s: "hi",
      t: true,
      n: null,
      u: null,
      min: null,
      max: null,
      oid: null,
      date: 2 ** 32 + 1,
      ts: null,
      dec: null,
      old: [9, 8],
      neg: -1,
    });
    expect(Object.getPrototypeOf(doc)).toBeNull();
    const nested = readBson(bson({ a: [1, { b: "c" }], big: new Int64(0xff000000) }));
    expect(nested.a).toEqual([1, Object.assign(Object.create(null) as object, { b: "c" })]);
    expect(nested.big).toBe(0xff000000);
  });

  it("rejects malformed documents", () => {
    const bad = [
      new Uint8Array([4, 0, 0, 0]),
      rawDoc([[0x42, ...ascii("x"), 0]]),
      rawDoc([[0x02, ...ascii("s"), 0, 0, 0, 0, 0]]),
      rawDoc([[0x02, ...ascii("s"), 0, 50, 0, 0, 0, 0]]),
      rawDoc([[0x05, ...ascii("b"), 0, 0xff, 0xff, 0xff, 0xff, 0]]),
      rawDoc([[0x03, ...ascii("d"), 0, 2, 0, 0, 0]]),
      rawDoc([[0x03, ...ascii("d"), 0, 5, 0, 0, 0, 1]]),
      rawDoc([[0x10, ...ascii("i"), 0, 1]]),
      new Uint8Array([6, 0, 0, 0, 0x0a, 0x61]),
      new Uint8Array([5, 0, 0, 0, 0, 0]),
    ];
    for (const bytes of bad) expect(() => readBson(bytes)).toThrow(BsonError);
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) deep = { d: deep };
    expect(() => readBson(bson(deep as never))).toThrow(BsonError);
  });

  it("tells BSON from other bytes without parsing", () => {
    expect(looksLikeBson(bson({ a: 1 }))).toBe(true);
    expect(looksLikeBson(new Uint8Array([5, 0, 0, 0]))).toBe(false);
    expect(looksLikeBson(new Uint8Array([9, 0, 0, 0, 0]))).toBe(false);
  });
});

describe("base64", () => {
  it("decodes padded and unpadded text, and refuses what is not base64", () => {
    expect(Array.from(fromBase64("AQID") ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(fromBase64("AQI=") ?? [])).toEqual([1, 2]);
    expect(Array.from(fromBase64("AQ==\n") ?? [])).toEqual([1]);
    expect(fromBase64("no way!")).toBeNull();
    expect(fromBase64("AQIDB")).toBeNull();
  });
});
