import { describe, expect, it } from "vitest";
import {
  GOODNOTES_UNITS_PER_MM,
  GoodnotesError,
  isGoodnotes,
  layerId,
  penSamples,
  readGoodnotes,
  readTpl,
} from "../../src/import/goodnotes";
import { PAGE_PX_PER_MM } from "../../src/model/units";
import { parseInkFile, buildInkFile } from "../../src/model/serialize";
import { goodnotesFiles, JPEG, PDF, PNG, tplStroke, type GnPage } from "./builders";

const LETTER: [number, number] = [834.24, 1078.825];
const K = PAGE_PX_PER_MM / GOODNOTES_UNITS_PER_MM;
const map = (files: Record<string, Uint8Array>): Map<string, Uint8Array> =>
  new Map(Object.entries(files));

const PAGE_A = "11111111-0000-0000-0000-00000000000A";
const PAGE_B = "22222222-0000-0000-0000-00000000000A";
const PAGE_C = "33333333-0000-0000-0000-00000000000A";
const PAGE_D = "44444444-0000-0000-0000-00000000000A";

function notebook(pages: GnPage[], extra: Partial<Parameters<typeof goodnotesFiles>[0]> = {}) {
  return map(
    goodnotesFiles({
      title: "Biology",
      templates: [
        { id: "T-COVER", size: LETTER, attachment: "A-COVER" },
        { id: "T-RULED", size: LETTER, attachment: "A-RULED" },
      ],
      pages,
      attachments: { "A-COVER": PDF, "A-RULED": PDF, "A-PHOTO": JPEG, "A-PNG": PNG },
      ...extra,
    }),
  );
}

describe("readGoodnotes", () => {
  it("keeps live pages in their order, with their paper", () => {
    const result = readGoodnotes(
      notebook([
        { id: PAGE_B, template: "T-RULED", order: "B" },
        { id: PAGE_A, template: "T-COVER", order: "-A" },
        { id: PAGE_C, template: "T-RULED", order: "C", deleted: true },
        { id: PAGE_D, template: "T-RULED", order: "D" },
      ]),
      "fallback",
    );
    expect(result.source).toBe("goodnotes");
    expect(result.title).toBe("Biology");
    expect(result.doc.pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    const paths = result.doc.pages.map((p) =>
      p.backdrop.kind === "pdf" ? p.backdrop.path : p.backdrop.kind,
    );
    expect(paths).toEqual([
      "Biology - paper 1.pdf",
      "Biology - paper 2.pdf",
      "Biology - paper 2.pdf",
    ]);
    expect(result.attachments.map((a) => [a.name, a.mime])).toEqual([
      ["Biology - paper 1.pdf", "application/pdf"],
      ["Biology - paper 2.pdf", "application/pdf"],
    ]);
    // Letter in FineNotes' scale (A4 is 1024 px across).
    expect(result.doc.pages[0].geometry).toEqual({
      width: Math.round(LETTER[0] * K),
      height: Math.round(LETTER[1] * K),
    });
    expect(result.doc.view.width).toBe(result.doc.pages[0].geometry.width);
    expect(result.warnings).toEqual([]);
  });

  it("converts strokes: points, width, pressure, colour and highlighter", () => {
    const samples: Array<[number, number, number]> = [
      [100, 200, 1],
      [110, 205, 1],
      [115, 207, 1],
      [120, 210, 1.5],
      [130, 215, 3],
    ];
    const result = readGoodnotes(
      notebook([
        {
          id: PAGE_A,
          template: "T-RULED",
          order: "a",
          strokes: [
            { id: "S1", samples, rgba: [1, 0, 0, 1] },
            { id: "S2", samples, rgba: [1, 1, 0, 0.3] },
          ],
        },
      ]),
      "x",
    );
    const [pen, marker] = result.doc.pages[0].strokes;
    expect(pen.id).toBe("s1");
    expect(marker.id).toBe("s2");
    expect(pen.color).toBe("#ff0000");
    expect(pen.tool).toBe("pen");
    expect(marker.tool).toBe("highlighter");
    expect(marker.color).toBe("#ffff00");
    // The nib is the median full width; each point's pressure reproduces its width.
    expect(pen.size).toBeCloseTo(2 * K, 2);
    expect(pen.pts.length).toBe(15);
    expect(pen.pts[0]).toBeCloseTo(100 * K, 3);
    expect(pen.pts[1]).toBeCloseTo(200 * K, 3);
    const widthAt = (p: number): number => pen.size * (0.4 + 1.2 * p);
    expect(widthAt(pen.pts[2])).toBeCloseTo(2 * K, 1);
    expect(widthAt(pen.pts[11])).toBeCloseTo(3 * K, 1);
    // Wider than FineNotes can draw at full pressure: the widest it can.
    expect(pen.pts[14]).toBe(1);
  });

  it("places pictures, and shares one attachment between uses", () => {
    const result = readGoodnotes(
      notebook([
        {
          id: PAGE_A,
          template: "T-RULED",
          order: "a",
          images: [
            { id: "I1", attachment: "A-PHOTO", frame: [10, 20, 300, 400] },
            { id: "I2", attachment: "A-PHOTO", frame: [0, 0, 50, 50] },
            { id: "I3", attachment: "A-PNG", frame: [0, 0, 50, 50] },
          ],
        },
      ]),
      "x",
    );
    const [a, b, c] = result.doc.pages[0].images;
    expect(a).toMatchObject({ id: "i1", path: "Biology - picture 2.jpg" });
    expect(a.x).toBeCloseTo(10 * K, 1);
    expect(a.w).toBeCloseTo(300 * K, 1);
    expect(a.h).toBeCloseTo(400 * K, 1);
    expect(b.path).toBe(a.path);
    expect(c.path).toBe("Biology - picture 3.png");
    expect(result.attachments.map((x) => x.name)).toEqual([
      "Biology - paper 1.pdf",
      "Biology - picture 2.jpg",
      "Biology - picture 3.png",
    ]);
  });

  it("leaves out a picture deleted in Goodnotes, and its file", () => {
    const result = readGoodnotes(
      notebook([
        {
          id: PAGE_A,
          template: "T-RULED",
          order: "a",
          images: [
            { id: "I1", attachment: "A-PNG", frame: [0, 0, 50, 50], removed: true },
            { id: "I2", attachment: "A-PHOTO", frame: [10, 20, 300, 400] },
          ],
        },
      ]),
      "x",
    );
    expect(result.doc.pages[0].images.map((i) => i.path)).toEqual(["Biology - picture 2.jpg"]);
    expect(result.attachments.map((x) => x.name)).toEqual([
      "Biology - paper 1.pdf",
      "Biology - picture 2.jpg",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps bookmarks, by the latest flag, and pages put back", () => {
    const result = readGoodnotes(
      notebook([
        { id: PAGE_A, template: "T-RULED", order: "a", bookmarked: true },
        { id: PAGE_B, template: "T-RULED", order: "b", unbookmarked: true },
        { id: PAGE_C, template: "T-RULED", order: "c", restored: true, bookmarked: true },
      ]),
      "x",
    );
    expect(result.doc.pages.map((p) => p.bookmarked)).toEqual([true, undefined, true]);
  });

  it("reports what it could not bring over", () => {
    const files = notebook([
      { id: PAGE_A, template: "T-BUILTIN", order: "a", unknown: 2 },
      {
        id: PAGE_B,
        template: "T-RULED",
        order: "b",
        images: [{ id: "I1", attachment: "A-MISSING", frame: [0, 0, 10, 10] }],
        strokes: [{ id: "S1", samples: [] }],
      },
    ]);
    const result = readGoodnotes(files, "x");
    expect(result.doc.pages[0].backdrop).toEqual({
      kind: "pdf",
      path: "Biology - paper 1.pdf",
      page: 0,
    });
    expect(result.warnings).toEqual([
      "1 page uses a Goodnotes paper that is not in the file; the notebook's usual paper was used instead.",
      "1 stroke could not be read.",
      "3 items (text boxes, shapes or other elements) could not be brought over yet.",
    ]);
  });

  it("falls back to the file name and to blank paper", () => {
    const files = map(
      goodnotesFiles({
        templates: [{ id: "T", size: [400, 600] }],
        pages: [{ id: PAGE_A, template: "T", order: "a" }],
        prefix: "Folder",
      }),
    );
    expect(isGoodnotes(files)).toBe(true);
    const result = readGoodnotes(files, "Chemistry");
    expect(result.title).toBe("Chemistry");
    expect(result.doc.pages[0].backdrop).toEqual({ kind: "blank" });
    expect(result.doc.pages[0].geometry.width).toBe(Math.round(400 * K));
  });

  it("refuses what is not a notebook, or has no pages", () => {
    expect(isGoodnotes(new Map([["Session.plist", new Uint8Array()]]))).toBe(false);
    expect(() => readGoodnotes(new Map(), "x")).toThrow(GoodnotesError);
    const empty = map(
      goodnotesFiles({
        templates: [],
        pages: [{ id: PAGE_A, template: "T", order: "a", deleted: true }],
      }),
    );
    expect(() => readGoodnotes(empty, "x")).toThrow(GoodnotesError);
  });

  it("writes a file FineNotes reads back unchanged", () => {
    const result = readGoodnotes(
      notebook([
        {
          id: PAGE_A,
          template: "T-RULED",
          order: "a",
          strokes: [
            {
              id: "S1",
              samples: [
                [1, 2, 1],
                [3, 4, 1],
              ],
            },
          ],
          images: [{ id: "I1", attachment: "A-PHOTO", frame: [1, 2, 3, 4] }],
        },
      ]),
      "x",
    );
    const back = parseInkFile(buildInkFile("# Biology\n", result.doc)).doc;
    expect(back?.pages.length).toBe(1);
    expect(back?.pages[0].strokes[0].color).toBe("#000000");
    expect(back?.pages[0].images[0].path).toBe("Biology - picture 2.jpg");
  });
});

describe("Goodnotes internals", () => {
  it("finds a page's content file", () => {
    expect(layerId("51EF31D0-7276-4C93-917C-15202E63A2A9")).toBe(
      "51EF31D0-7276-4C93-917C-15202E63A2AA",
    );
    expect(layerId("2F44EABE-E009-4A7C-94DF-48C94E41347F")).toBe(
      "2F44EABE-E009-4A7C-94DF-48C94E413480",
    );
    expect(layerId("no-dashes-here!")).toBe("no-dashes-here!");
  });

  it("reads the stroke layout", () => {
    const raw = tplStroke([[5, 6, 0.5]]);
    expect(Array.from(penSamples(raw))).toEqual([5, 6, 0.5, 0.5, -0.5]);
    const arrays = readTpl(raw);
    expect(arrays.length).toBe(10);
    expect(arrays[8]).toMatchObject({ kind: "u", count: 5 });
  });

  it("refuses broken stroke layouts", () => {
    expect(() => readTpl(new Uint8Array(4))).toThrow(GoodnotesError);
    const raw = tplStroke([[5, 6, 0.5]]);
    const noEnd = raw.slice(0, 20);
    expect(() => readTpl(noEnd.map((b, i) => (i >= 8 ? 65 : b)))).toThrow(GoodnotesError);
    expect(() => readTpl(raw.slice(0, raw.length - 3))).toThrow(GoodnotesError);
    const badType = raw.slice();
    badType[8] = "x".charCodeAt(0);
    expect(() => readTpl(badType)).toThrow(GoodnotesError);
    const badArray = raw.slice();
    badArray[10] = "[".charCodeAt(0);
    expect(() => readTpl(badArray)).toThrow(GoodnotesError);
    const truncated = raw.slice(0, raw.indexOf(0, 8) + 4);
    expect(() => readTpl(truncated)).toThrow(GoodnotesError);
  });
});
