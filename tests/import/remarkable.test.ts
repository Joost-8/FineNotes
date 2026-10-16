import { describe, expect, it } from "vitest";
import {
  REMARKABLE_SCALE,
  RemarkableError,
  isRemarkableDocument,
  isRemarkableLines,
  pageOrder,
  readRemarkableDocument,
  readRemarkableLines,
  readStrokes,
  remarkableVersion,
  toStroke,
} from "../../src/import/remarkable";
import { PAGE_PX_PER_MM } from "../../src/model/units";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { PDF } from "./builders";
import {
  block,
  encodeJson,
  fId,
  fInt,
  fSub,
  header,
  LAYER,
  rmOld,
  rmV6,
  v6Item,
  v6Tombstone,
  type Point,
} from "./remarkable-builders";

const K = REMARKABLE_SCALE;
const DOC = "aaaaaaaa-0000-0000-0000-000000000001";
const line = (from: [number, number], to: [number, number], w = 2, n = 5): Point[] =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, w];
  });
const head = (item: number): number[] => [...fId(1, LAYER), ...fId(2, [1, item]), ...fInt(5, 0)];
const files = (entries: Record<string, Uint8Array | object>): Map<string, Uint8Array> =>
  new Map(
    Object.entries(entries).map(([k, v]) => [k, v instanceof Uint8Array ? v : encodeJson(v)]),
  );

describe("reMarkable page sniffing", () => {
  it("reads the version from the header", () => {
    expect(remarkableVersion(new Uint8Array(header(6)))).toBe(6);
    expect(remarkableVersion(new Uint8Array(header(3)))).toBe(3);
    expect(isRemarkableLines(rmOld(5, []))).toBe(true);
    expect(isRemarkableLines(new TextEncoder().encode("reMarkable .lines file, version=x"))).toBe(
      false,
    );
    expect(isRemarkableLines(new TextEncoder().encode("%PDF-1.7 and more bytes here"))).toBe(false);
    expect(isRemarkableLines(new Uint8Array(3))).toBe(false);
  });

  it("refuses garbage and versions it does not know", () => {
    expect(() => readRemarkableLines(new Uint8Array([1, 2, 3]), "x")).toThrow(RemarkableError);
    expect(() => readRemarkableLines(new Uint8Array(header(2)), "x")).toThrow(/version 2/);
    const truncated = rmOld(3, [[{ pen: 2, color: 0, points: line([0, 0], [10, 10]) }]]);
    expect(() => readRemarkableLines(truncated.subarray(0, truncated.length - 10), "x")).toThrow(
      RemarkableError,
    );
    const absurd = new Uint8Array([...header(3), 255, 255, 0, 0]);
    expect(() => readRemarkableLines(absurd, "x")).toThrow(/layer count/);
    const manyStrokes = new Uint8Array([...header(5), 1, 0, 0, 0, 255, 255, 0, 0]);
    expect(() => readRemarkableLines(manyStrokes, "x")).toThrow(/stroke count/);
  });
});

describe("versions 3 and 5", () => {
  for (const version of [3, 5] as const) {
    it(`reads strokes of version ${version}`, () => {
      const bytes = rmOld(version, [
        [{ pen: 2, color: 7, points: line([100, 200], [300, 200], 2) }],
        [
          { pen: 5, color: 0, points: line([100, 400], [500, 400], 30) },
          { pen: 6, color: 0, points: line([0, 0], [50, 50]) },
        ],
      ]);
      const result = readRemarkableLines(bytes, "Page");
      expect(result.source).toBe("remarkable");
      expect(result.title).toBe("Page");
      const page = result.doc.pages[0];
      expect(page.geometry).toEqual({
        width: Math.round(1404 * K),
        height: Math.round(1872 * K),
      });
      expect(page.strokes).toHaveLength(2);
      const [pen, marker] = page.strokes;
      expect(pen.tool).toBe("pen");
      expect(pen.color).toBe("#b33e39");
      expect(pen.size).toBeCloseTo(2 * K, 2);
      expect(pen.pts.slice(0, 2)).toEqual([
        Math.round(100 * K * 100) / 100,
        Math.round(200 * K * 100) / 100,
      ]);
      expect(marker.tool).toBe("highlighter");
      expect(marker.color).toBe("#ffed75");
      expect(result.warnings.join(" ")).toMatch(/1 eraser stroke was left out/);
    });
  }

  it("keeps geometry proportional to the paper", () => {
    // 226 px is one inch on the reMarkable.
    expect(226 * K).toBeCloseTo(25.4 * PAGE_PX_PER_MM, 6);
  });

  it("turns per-point width into pressure", () => {
    const bytes = rmOld(3, [
      [
        {
          pen: 2,
          color: 0,
          points: [
            [0, 0, 1],
            [10, 0, 3],
          ],
        },
      ],
    ]);
    const stroke = readRemarkableLines(bytes, "x").doc.pages[0].strokes[0];
    expect(stroke.size).toBeCloseTo(2 * K, 2);
    expect(stroke.pts[2]).toBeLessThan(stroke.pts[5]);
  });

  it("grows a page for ink below the screen", () => {
    const bytes = rmOld(3, [[{ pen: 2, color: 0, points: line([10, 2000], [10, 2400]) }]]);
    const page = readRemarkableLines(bytes, "x").doc.pages[0];
    expect(page.geometry.height).toBe(Math.round(2440 * K));
  });
});

describe("version 6", () => {
  it("reads lines centred on the page, in both point layouts", () => {
    const bytes = rmV6({
      lines: [
        { item: 1, pen: 15, color: 6, points: line([-100, 300], [100, 300], 2.5) },
        { item: 2, pen: 17, color: 0, points: line([0, 600], [0, 700], 1.75), version: 1 },
      ],
    });
    const strokes = readRemarkableLines(bytes, "p").doc.pages[0].strokes;
    expect(strokes).toHaveLength(2);
    expect(strokes[0].color).toBe("#4e69c9");
    expect(strokes[0].pts[0]).toBeCloseTo(602 * K, 1);
    expect(strokes[0].pts[1]).toBeCloseTo(300 * K, 1);
    expect(strokes[0].size).toBeCloseTo(2.5 * K, 2);
    expect(strokes[1].pts[0]).toBeCloseTo(702 * K, 1);
    expect(strokes[1].size).toBeCloseTo(1.75 * K, 2);
  });

  it("skips deleted and tombstoned lines, erasers and hidden layers", () => {
    const bytes = rmV6({
      layers: [{ node: LAYER }, { node: [0, 12], visible: false }],
      lines: [
        { item: 1, pen: 2, color: 0, points: line([0, 0], [10, 10]) },
        { item: 2, pen: 2, color: 0, points: line([0, 0], [10, 10]), deleted: true },
        { item: 3, pen: 2, color: 0, points: line([0, 0], [10, 10]) },
        { item: 4, pen: 8, color: 0, points: line([0, 0], [10, 10]) },
        { item: 5, pen: 2, color: 0, points: line([0, 0], [10, 10]), parent: [0, 12] },
      ],
      extra: [v6Tombstone(3)],
    });
    const result = readRemarkableLines(bytes, "p");
    expect(result.doc.pages[0].strokes).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/1 hidden layer/);
    expect(result.warnings.join(" ")).toMatch(/eraser/);
  });

  it("places groups by their anchor", () => {
    const bytes = rmV6({
      layers: [
        { node: LAYER },
        { node: [0, 20], parent: LAYER, originX: 50, anchor: [0, 281474976710655] },
        { node: [0, 21], parent: LAYER, anchor: [0, 281474976710654] },
        { node: [0, 22], parent: LAYER, anchor: [2, 33] },
      ],
      lines: [
        { item: 1, pen: 2, color: 0, points: line([0, 10], [10, 10]), parent: [0, 20] },
        { item: 2, pen: 2, color: 0, points: line([0, 10], [10, 10]), parent: [0, 21] },
        { item: 3, pen: 2, color: 0, points: line([0, 10], [10, 10]), parent: [0, 22] },
      ],
    });
    const result = readRemarkableLines(bytes, "p");
    const [a, b, c] = result.doc.pages[0].strokes;
    expect(a.pts[0]).toBeCloseTo(752 * K, 1);
    expect(a.pts[1]).toBeCloseTo(1882 * K, 1);
    expect(b.pts[1]).toBeCloseTo(10 * K, 1);
    expect(c.pts[1]).toBeCloseTo(10 * K, 1);
    expect(result.warnings.join(" ")).toMatch(/next to typed text/);
  });

  it("uses the highlighter, the highlight colours and a line's own colour", () => {
    const bytes = rmV6({
      lines: [
        { item: 1, pen: 18, color: 9, points: line([0, 0], [100, 0], 15) },
        { item: 2, pen: 18, color: 4, points: line([0, 0], [100, 0], 15) },
        { item: 3, pen: 15, color: 9, argb: 0xff12345a, points: line([0, 0], [100, 0]) },
        { item: 4, pen: 15, color: 99, points: line([0, 0], [100, 0]) },
        { item: 5, pen: 15, color: 11, points: line([0, 0], [100, 0]) },
      ],
    });
    const strokes = readRemarkableLines(bytes, "p").doc.pages[0].strokes;
    expect(strokes.map((s) => [s.tool, s.color])).toEqual([
      ["highlighter", "#ffed75"],
      ["highlighter", "#00ff00"],
      ["pen", "#12345a"],
      ["pen", "#000000"],
      ["pen", "#8bd0e5"],
    ]);
  });

  it("reports text highlights and typed text", () => {
    const bytes = rmV6({
      lines: [],
      extra: [v6Item(3, 50), v6Item(3, 51), v6Item(3, 52, false), v6Item(6, 60), block(7, [])],
    });
    const result = readRemarkableLines(bytes, "p");
    expect(result.doc.pages[0].strokes).toEqual([]);
    expect(result.warnings).toContain("2 text highlights could not be brought over yet.");
    expect(result.warnings).toContain("Typed text could not be brought over yet.");
  });

  it("survives damaged blocks", () => {
    const good = rmV6({ lines: [{ item: 1, pen: 2, color: 0, points: line([0, 0], [9, 9]) }] });
    // A block with an unknown tag type, one with ragged points, then one running past the end.
    const badTag = block(5, [0x13, 0]);
    const ragged = block(5, [
      ...head(9),
      ...fSub(6, [3, ...fInt(1, 2), ...fInt(2, 0), ...fSub(5, [1, 2, 3])]),
    ]);
    const past = [200, 0, 0, 0, 0, 2, 2, 5, 1];
    const bytes = new Uint8Array([...good, ...badTag, ...ragged, ...past]);
    const result = readRemarkableLines(bytes, "p");
    expect(result.doc.pages[0].strokes).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/3 damaged blocks/);
  });

  it("ignores lines whose value is not a line, and items without ids", () => {
    const notLine = block(5, [...head(9), ...fSub(6, [1])]);
    const noPoints = block(5, [...head(10), ...fSub(6, [3, ...fInt(1, 2), ...fInt(2, 0)])]);
    const bytes = new Uint8Array([
      ...header(6),
      ...notLine,
      ...noPoints,
      ...block(5, fInt(5, 0)),
      ...block(2, fInt(5, 0)),
      ...block(8, fInt(5, 0)),
      ...block(1, fId(1, [0, 30])),
    ]);
    expect(readStrokes(bytes)).toEqual([]);
  });
});

describe("toStroke", () => {
  it("drops non-finite points and strokes with none", () => {
    expect(toStroke({ pen: 2, color: 0, points: [NaN, 1, 1] }, "s")).toBeNull();
    expect(toStroke({ pen: 6, color: 0, points: [1, 1, 1] }, "s")).toBeNull();
    const s = toStroke({ pen: 2, color: 0, points: [1, 1, NaN, 2, 2, 0, 3, Infinity, 1] }, "s");
    expect(s?.pts).toHaveLength(6);
    expect(s?.size).toBe(0.1);
  });
});

describe("reMarkable documents", () => {
  const page = (y: number): Uint8Array =>
    rmV6({ lines: [{ item: 1, pen: 2, color: 0, points: line([0, y], [50, y]) }] });

  it("follows the page order in cPages, with PDF pages from redir", () => {
    const result = readRemarkableDocument(
      files({
        [`${DOC}.content`]: {
          fileType: "pdf",
          cPages: {
            pages: [
              { id: "b", idx: { value: "bb" }, redir: { value: 1 } },
              { id: "a", idx: { value: "ba" }, redir: { value: 0 } },
              { id: "gone", idx: { value: "bc" }, deleted: { value: 1 } },
              { id: "inserted", idx: { value: "bd" } },
              { id: "c", idx: { value: "be" }, redir: { value: 2 } },
            ],
          },
        },
        [`${DOC}.metadata`]: { visibleName: "Lecture 4", type: "DocumentType" },
        [`${DOC}.pdf`]: PDF,
        [`${DOC}/a.rm`]: page(100),
        [`${DOC}/b.rm`]: page(200),
        [`${DOC}/inserted.rm`]: page(300),
      }),
      "fallback",
    );
    expect(result.title).toBe("Lecture 4");
    expect(result.attachments).toEqual([
      { name: "Lecture 4.pdf", bytes: PDF, mime: "application/pdf" },
    ]);
    const pages = result.doc.pages;
    expect(pages.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(pages.map((p) => p.backdrop)).toEqual([
      { kind: "pdf", path: "Lecture 4.pdf", page: 0 },
      { kind: "pdf", path: "Lecture 4.pdf", page: 1 },
      { kind: "blank" },
      { kind: "pdf", path: "Lecture 4.pdf", page: 2 },
    ]);
    expect(pages.map((p) => p.strokes.map((s) => s.pts[1]))).toEqual([
      [round(100 * K)],
      [round(200 * K)],
      [round(300 * K)],
      [],
    ]);
    expect(pages.flatMap((p) => p.strokes.map((s) => s.id))).toEqual(["s1", "s2", "s3"]);
    expect(result.warnings).toEqual([]);
  });

  it("reads the older page list, files named by index, and a folder", () => {
    const result = readRemarkableDocument(
      files({
        [`Notes/${DOC}.content`]: {
          fileType: "pdf",
          pages: ["x", "y", "z"],
          redirectionPageMap: [0, -1, 1],
        },
        [`Notes/${DOC}.pdf`]: PDF,
        [`Notes/${DOC}/0.rm`]: rmOld(5, [[{ pen: 2, color: 0, points: line([0, 0], [9, 9]) }]]),
        [`Notes/${DOC}/z.rm`]: new Uint8Array([9, 9, 9]),
      }),
      "Fallback",
    );
    expect(result.title).toBe("Fallback");
    expect(result.doc.pages.map((p) => p.backdrop.kind)).toEqual(["pdf", "blank", "pdf"]);
    expect(result.doc.pages[0].strokes).toHaveLength(1);
    expect(result.warnings).toEqual(["1 page could not be read and was left blank."]);
  });

  it("shows the PDF in page order when no page has a redir, and pages from files when none are listed", () => {
    const ordered = pageOrder({ cPages: { pages: [{ id: "a" }, { id: "b" }, 7, { id: 3 }] } });
    expect(ordered).toEqual([
      { id: "a", pdfPage: 0 },
      { id: "b", pdfPage: 1 },
    ]);
    expect(pageOrder({ pages: ["a", 2, "b"] })).toEqual([
      { id: "a", pdfPage: 0 },
      { id: "b", pdfPage: 1 },
    ]);
    const result = readRemarkableDocument(
      files({
        [`${DOC}.content`]: { fileType: "notebook" },
        [`${DOC}.metadata`]: { visibleName: "  " },
        [`${DOC}/q.rm`]: page(10),
        [`${DOC}/p.rm`]: page(20),
        [`${DOC}/thumbnails/p.rm`]: page(30),
      }),
      "Untitled",
    );
    expect(result.title).toBe("Untitled");
    expect(result.doc.pages.map((p) => p.strokes[0].pts[1])).toEqual([
      round(20 * K),
      round(10 * K),
    ]);
  });

  it("keeps a page without a .rm file blank, and warns about an epub", () => {
    const result = readRemarkableDocument(
      files({
        [`${DOC}.content`]: { fileType: "epub", cPages: { pages: [{ id: "a" }] } },
        [`${DOC}.epub`]: new Uint8Array([1]),
      }),
      "Book",
    );
    expect(result.doc.pages).toHaveLength(1);
    expect(result.doc.pages[0].strokes).toEqual([]);
    expect(result.doc.pages[0].backdrop).toEqual({ kind: "blank" });
    expect(result.warnings[0]).toMatch(/book's own pages/);
  });

  it("recognises documents and refuses what is not one", () => {
    const content = { [`${DOC}.content`]: { cPages: { pages: [] } } };
    expect(isRemarkableDocument(files(content))).toBe(true);
    expect(isRemarkableDocument(files({ "a/b/c.content": { pages: [] } }))).toBe(false);
    expect(isRemarkableDocument(files({ "x.content": new Uint8Array([1, 2]) }))).toBe(false);
    expect(isRemarkableDocument(files({ "x.content": { other: 1 } }))).toBe(false);
    expect(isRemarkableDocument(files({ "index.events.pb": new Uint8Array(1) }))).toBe(false);
    expect(() => readRemarkableDocument(files({}), "x")).toThrow(RemarkableError);
    expect(() => readRemarkableDocument(files(content), "x")).toThrow(/no pages/);
  });

  it("survives a round trip through the file format", () => {
    const result = readRemarkableDocument(
      files({
        [`${DOC}.content`]: { cPages: { pages: [{ id: "a", idx: { value: "ba" } }] } },
        [`${DOC}.metadata`]: { visibleName: "Sketches" },
        [`${DOC}/a.rm`]: rmV6({
          lines: [
            { item: 1, pen: 15, color: 7, points: line([-200, 100], [200, 500], 3) },
            { item: 2, pen: 18, color: 9, points: line([-200, 800], [200, 800], 20) },
          ],
        }),
      }),
      "x",
    );
    const back = parseInkFile(buildInkFile("# Sketches\n", result.doc)).doc;
    expect(back?.pages).toHaveLength(1);
    const strokes = back?.pages[0].strokes ?? [];
    expect(strokes.map((s) => [s.tool, s.color])).toEqual([
      ["pen", "#b33e39"],
      ["highlighter", "#ffed75"],
    ]);
    expect(strokes[0].pts[0]).toBeCloseTo(502 * K, 1);
    expect(back?.pages[0].geometry).toEqual(result.doc.pages[0].geometry);
  });
});

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
