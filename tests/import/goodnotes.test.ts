import { describe, expect, it } from "vitest";
import {
  GOODNOTES_UNITS_PER_MM,
  GoodnotesError,
  isGoodnotes,
  layerId,
  penSamples,
  goodnotesPageLink,
  readGoodnotes,
  searchText,
  penPath,
  readTpl,
  readTplLayout,
} from "../../src/import/goodnotes";
import { PAGE_PX_PER_MM } from "../../src/model/units";
import { parseInkFile, buildInkFile } from "../../src/model/serialize";
import {
  bv4Raw,
  delimited,
  goodnotesFiles,
  JPEG,
  pb,
  PDF,
  PNG,
  tplStroke,
  tplStroke25,
  type GnPage,
  type PbField,
} from "./builders";

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
      "",
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
      "",
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
      "",
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
      "",
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
      "",
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
    const result = readGoodnotes(files, "");
    expect(result.doc.pages[0].backdrop).toEqual({
      kind: "pdf",
      path: "Biology - paper 1.pdf",
      page: 0,
    });
    expect(result.warnings).toEqual([
      "1 page uses a Goodnotes paper that is not in the file; the notebook's usual paper was used instead.",
      "1 stroke could not be read (page 2).",
      "3 other items could not be brought over yet (pages 1, 2).",
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
      "",
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

describe("readGoodnotes: what real notebooks hold", () => {
  const SLIDE: [number, number] = [1760, 990];
  const KS = PAGE_PX_PER_MM / (SLIDE[0] / (SLIDE[0] / GOODNOTES_UNITS_PER_MM));

  it("follows a paper's attachment record to its PDF, at the page it names", () => {
    const files = map(
      goodnotesFiles({
        templates: [
          { id: "T1", size: SLIDE, attachment: "REC", pdfPage: 1 },
          { id: "T2", size: SLIDE, attachment: "REC", pdfPage: 2 },
          { id: "T3", size: SLIDE, attachment: "REC", pdfPage: 3 },
        ],
        records: { REC: "LECTURE" },
        pages: [
          { id: PAGE_A, template: "T1", order: "a" },
          { id: PAGE_B, template: "T2", order: "b", deleted: true },
          { id: PAGE_C, template: "T3", order: "c" },
        ],
        attachments: { LECTURE: PDF },
      }),
    );
    const result = readGoodnotes(files, "Networks");
    expect(result.doc.pages.map((p) => p.backdrop)).toEqual([
      { kind: "pdf", path: "Networks - paper 1.pdf", page: 0 },
      { kind: "pdf", path: "Networks - paper 1.pdf", page: 2 },
    ]);
    expect(result.attachments.map((a) => a.name)).toEqual(["Networks - paper 1.pdf"]);
    expect(result.warnings).toEqual([]);
  });

  it("sorts pages by their order keys as bytes: a page added in front comes first", () => {
    const result = readGoodnotes(
      notebook([
        { id: PAGE_A, template: "T-RULED", order: "4zLQe01" },
        { id: PAGE_B, template: "T-RULED", order: "4zLQe02" },
        { id: PAGE_C, template: "T-COVER", order: "-QKIL" },
      ]),
      "",
    );
    expect(result.doc.pages.map((p) => (p.backdrop.kind === "pdf" ? p.backdrop.path : ""))).toEqual(
      ["Biology - paper 1.pdf", "Biology - paper 2.pdf", "Biology - paper 2.pdf"],
    );
  });

  it("reads the marker's seven floats a sample", () => {
    const result = readGoodnotes(
      notebook([
        {
          id: PAGE_A,
          template: "T-RULED",
          order: "a",
          strokes: [
            {
              id: "M",
              stride: 7,
              rgba: [1, 0.37, 0.4, 1],
              samples: [
                [100, 200, 18],
                [120, 210, 18],
                [140, 230, 18],
              ],
            },
          ],
        },
      ]),
      "",
    );
    const [marker] = result.doc.pages[0].strokes;
    expect(result.warnings).toEqual([]);
    expect(marker.size).toBeCloseTo(36 * K, 2);
    expect(marker.pts.length).toBe(9);
    expect(marker.pts[3]).toBeCloseTo(120 * K, 3);
    expect(marker.pts[4]).toBeCloseTo(210 * K, 3);
  });

  it("reads strokes in the newer layout, at the stroke's width", () => {
    const result = readGoodnotes(
      notebook([
        {
          id: PAGE_A,
          template: "T-RULED",
          order: "a",
          strokes: [
            {
              id: "P",
              schema25: 1.56,
              samples: [
                [100, 100, 0],
                [101, 104, 0],
                [102, 108, 0],
                [103, 112, 0],
                [104, 116, 0],
              ],
            },
          ],
        },
      ]),
      "",
    );
    const [pencil] = result.doc.pages[0].strokes;
    expect(result.warnings).toEqual([]);
    expect(pencil.pts.length).toBe(15);
    expect(pencil.pts[12]).toBeCloseTo(104 * K, 3);
    expect(pencil.pts[13]).toBeCloseTo(116 * K, 3);
    expect(pencil.size).toBeCloseTo(1.56 * K, 2);
    for (const p of pencil.pts.filter((_, i) => i % 3 === 2)) expect(p).toBe(0.5);
  });

  it("moves a stroke by its lasso offset", () => {
    const result = readGoodnotes(
      notebook([
        {
          id: PAGE_A,
          template: "T-RULED",
          order: "a",
          strokes: [
            {
              id: "S",
              offset: [558.8, -172.5],
              samples: [
                [340, 374, 2],
                [350, 380, 2],
              ],
            },
          ],
        },
      ]),
      "",
    );
    const [moved] = result.doc.pages[0].strokes;
    expect(moved.pts[0]).toBeCloseTo((340 + 558.8) * K, 2);
    expect(moved.pts[1]).toBeCloseTo((374 - 172.5) * K, 2);
  });

  it("turns the outline into the contents: page titles and headings, live pages only", () => {
    const files = map(
      goodnotesFiles({
        templates: [{ id: "T", size: SLIDE, attachment: "A" }],
        pages: [
          { id: PAGE_A, template: "T", order: "a" },
          { id: PAGE_B, template: "T", order: "b", deleted: true },
          { id: PAGE_C, template: "T", order: "c" },
        ],
        attachments: { A: PDF },
        outline: [
          { id: "O1", page: PAGE_A, title: "Slide 1:\nNetworks", order: "1", y: 990 },
          { id: "O2", page: PAGE_B, title: "Slide 2", order: "2", y: 990 },
          { id: "O3", page: PAGE_C, title: "Slide 3", order: "3", y: 990 },
          { id: "O4", page: PAGE_C, title: "Further down", order: "4", x: 40, y: 490 },
          { id: "O5", page: PAGE_C, title: "   ", order: "5", y: 100 },
        ],
      }),
    );
    const result = readGoodnotes(files, "Networks");
    const [first, second] = result.doc.pages;
    expect(first.title).toBe("Slide 1: Networks");
    expect(first.sections).toBeUndefined();
    expect(second.title).toBe("Slide 3");
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    expect(second.sections).toEqual([
      { id: "c1", x: round2(40 * KS), y: round2(500 * KS), title: "Further down" },
    ]);
  });

  it("brings text boxes over, keeps PDF pictures for the import, and names the pages", () => {
    const result = readGoodnotes(
      notebook(
        [
          {
            id: PAGE_A,
            template: "T-RULED",
            order: "a",
            texts: [
              {
                id: "X1",
                origin: [100, 200],
                width: 220,
                runs: [
                  { text: "Testing ", rgba: [1, 0, 0, 1], size: 25, font: "Times New Roman" },
                  { text: "boxes" },
                ],
                fill: [1, 1, 0, 1],
              },
              { id: "X2", origin: [10, 20], textWidth: 51, runs: [{ text: "Test " }] },
              { id: "X3", origin: [0, 0], runs: [] },
              { id: "X4", origin: [0, 0], runs: [{ text: "  " }], width: 100 },
              { id: "X5", origin: [0, 0], runs: [{ text: "Note" }], comment: true },
            ],
            images: [{ id: "I1", attachment: "A-PDF", frame: [0, 0, 50, 50] }],
          },
        ],
        { attachments: { "A-RULED": PDF, "A-PDF": PDF } },
      ),
      "",
    );
    const [fixed, grown] = result.doc.pages[0].textBoxes;
    expect(fixed).toMatchObject({
      id: "t1",
      text: "Testing boxes",
      color: "#ff0000",
      font: "times",
      fill: "#ffff00",
    });
    expect(fixed.fit).toBeUndefined();
    expect(fixed.x).toBeCloseTo(110 * K, 1);
    expect(fixed.y).toBeCloseTo(210 * K, 1);
    expect(fixed.w).toBeCloseTo(200 * K, 1);
    expect(fixed.fontSize).toBeCloseTo(Math.max(12, 25 * K), 1);
    expect(grown).toMatchObject({ id: "t2", text: "Test ", fit: true, color: "#000000" });
    expect(grown.fill).toBeUndefined();
    expect(grown.font).toBeUndefined();
    expect(grown.w).toBeCloseTo(51 * K, 1);
    expect(grown.fontSize).toBeCloseTo(Math.max(12, 24 * K), 1);
    // The PDF picture is kept as a picture: `importNotebooks` makes an image of it.
    expect(result.doc.pages[0].images.map((i) => i.path)).toEqual(["Biology - picture 2.pdf"]);
    // The empty boxes have no outline (neither a border nor a drawn shape): nothing to keep.
    expect(result.warnings).toEqual([
      "1 comment came over as a text box with the author's name (page 1).",
    ]);
  });

  it("names the notebook after its file before the name inside it", () => {
    expect(
      readGoodnotes(notebook([{ id: PAGE_A, template: "T-RULED", order: "a" }]), "Test").title,
    ).toBe("Test");
    const untitled = map(
      goodnotesFiles({ templates: [], pages: [{ id: PAGE_A, template: "T", order: "a" }] }),
    );
    expect(readGoodnotes(untitled, "").title).toBe("Imported notebook");
  });
});

describe("Goodnotes stroke layouts", () => {
  it("reads both layouts' points", () => {
    expect(penPath(tplStroke([[5, 6, 0.5]])).points).toEqual([{ x: 5, y: 6, half: 0.5 }]);
    expect(penPath(tplStroke([[5, 6, 9]], 7)).points).toEqual([{ x: 5, y: 6, half: 9 }]);
    const newer = penPath(
      tplStroke25(
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        2,
      ),
    );
    expect(newer.points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
    expect(newer.half).toBe(1);
    const layout = readTplLayout(tplStroke25([[1, 2]], 2));
    expect(layout.scalars.map((s) => s.kind)).toEqual(["v", "u"]);
    expect(layout.arrays[1]).toMatchObject({ kind: "S", count: 1, size: 20, fields: "uuuuu" });
  });

  it("refuses layouts it cannot read", () => {
    // A sample count that does not divide the samples.
    const ragged = tplStroke([[5, 6, 0.5]]);
    const view = new DataView(ragged.buffer);
    view.setUint32(ragged.length - 6, 2, true);
    expect(() => penPath(ragged)).toThrow(GoodnotesError);
    // Structs without a start point.
    const noStart = tplStroke25([], 2);
    expect(() => penPath(noStart)).toThrow(GoodnotesError);
    // A struct array whose brackets do not close.
    const open = tplStroke25([[1, 2]], 2);
    open[open.indexOf(0, 8) - 1] = "u".charCodeAt(0);
    expect(() => readTplLayout(open)).toThrow(GoodnotesError);
  });
});

describe("readGoodnotes: what FineNotes cannot hold, approximated", () => {
  const rgba = (r: number, g: number, b: number, a: number): PbField[] =>
    [r, g, b, a].map((v, i): PbField => [i + 1, { f32: v }]);
  /** A text box body (kind 21) with a shape, a border and a fill, and no text. */
  const shapeBody = (spec: {
    origin: [number, number];
    size: [number, number];
    shape?: PbField[];
    border?: number;
    fill?: [number, number, number, number];
  }): Uint8Array =>
    pb([
      [
        21,
        {
          msg: [
            [1, { str: "SHAPE" }],
            [
              20,
              {
                msg: [
                  [
                    1,
                    {
                      msg: [
                        [1, { f32: spec.origin[0] }],
                        [2, { f32: spec.origin[1] }],
                      ],
                    },
                  ],
                ],
              },
            ],
            [
              21,
              {
                msg: [
                  [
                    2,
                    {
                      msg: [
                        [1, { f32: spec.size[0] }],
                        [2, { f32: spec.size[1] }],
                      ],
                    },
                  ],
                ],
              },
            ],
            ...(spec.shape ? [[22, { msg: spec.shape }] as PbField] : []),
            [30, { msg: [[1, { msg: [[1, { msg: rgba(...(spec.fill ?? [0, 0, 0, 0])) }]] }]] }],
            [
              31,
              {
                msg: [
                  ...(spec.border ? [[1, { f32: spec.border }] as PbField] : []),
                  [3, { msg: [[1, { msg: rgba(1, 0, 0, 1) }]] }],
                ],
              },
            ],
          ],
        },
      ],
    ]);
  const vertex = (x: number, y: number): PbField => [
    1,
    {
      msg: [
        [
          1,
          {
            msg: [
              [1, { f32: x }],
              [2, { f32: y }],
            ],
          },
        ],
        [2, { int: 1 }],
      ],
    },
  ];
  const diamond: PbField[] = [
    [
      3,
      {
        msg: [
          [
            1,
            {
              msg: [
                vertex(0.5, 0),
                vertex(1, 0.5),
                vertex(0.5, 1),
                vertex(0, 0.5),
                [2, { int: 1 }],
              ],
            },
          ],
        ],
      },
    ],
  ];
  function withNotes(records: Uint8Array[], extra: Record<string, Uint8Array> = {}) {
    const files = notebook([{ id: PAGE_A, template: "T-RULED", order: "a" }]);
    files.set(`notes/${layerId(PAGE_A)}`, delimited(records));
    for (const [k, v] of Object.entries(extra)) files.set(k, v);
    return readGoodnotes(files, "");
  }

  it("draws shapes as outlines, keeping a rectangle's fill as a filled box", () => {
    const result = withNotes([
      shapeBody({
        origin: [100, 100],
        size: [100, 120],
        shape: diamond,
        border: 6,
        fill: [1, 0, 0, 0.1],
      }),
      shapeBody({
        origin: [10, 10],
        size: [200, 100],
        shape: [[1, { msg: [[1, { f32: 80 }]] }]],
        border: 3,
      }),
      shapeBody({ origin: [300, 300], size: [50, 40], border: 2, fill: [0, 0, 1, 1] }),
      // A frame with neither a border nor a drawn shape: nothing to show.
      shapeBody({ origin: [0, 0], size: [10, 10], shape: [[1, { str: "" }]] }),
    ]);
    const page = result.doc.pages[0];
    expect(page.strokes.map((s) => [s.shape, s.color, s.pts.length / 3])).toEqual([
      ["diamond", "#ff0000", 5],
      ["roundrect", "#ff0000", 37],
      ["rect", "#ff0000", 5],
    ]);
    const [d] = page.strokes;
    expect(d.pts[0]).toBeCloseTo(150 * K, 1);
    expect(d.pts[1]).toBeCloseTo(100 * K, 1);
    expect(d.size).toBeCloseTo(6 * K, 1);
    // The round rectangle's radius is capped at half its height: its top edge starts 50 in.
    const r = page.strokes[1];
    expect(r.pts[0]).toBeCloseTo((10 + 200 - 50) * K, 1);
    expect(page.textBoxes).toEqual([
      {
        id: "t1",
        x: Math.round(300 * K * 100) / 100,
        y: Math.round(300 * K * 100) / 100,
        w: Math.round(50 * K * 100) / 100,
        h: Math.round(40 * K * 100) / 100,
        text: "",
        color: "#000000",
        fontSize: 22,
        fill: "#0000ff",
      },
    ]);
    expect(result.warnings).toEqual([
      "3 shapes came over as outlines (page 1).",
      "1 shape's fill could not be kept, only the outline (page 1).",
    ]);
  });

  it("writes links out after their words, naming the page of this notebook they lead to", () => {
    const anchor = (id: string): string =>
      `https://app.goodnotes.com/documents/?anchor=${encodeURIComponent(btoa(`page-${id}`))}#X`;
    const runs: PbField[] = [
      [1, { msg: [[1, { str: "See " }]] }],
      [
        1,
        {
          msg: [
            [1, { str: "this" }],
            [2, { msg: [[4, { str: anchor(PAGE_B) }]] }],
          ],
        },
      ],
      [
        1,
        {
          msg: [
            [1, { str: " page" }],
            [2, { msg: [[4, { str: anchor(PAGE_B) }]] }],
          ],
        },
      ],
      [1, { msg: [[1, { str: " and " }]] }],
      [
        1,
        {
          msg: [
            [1, { str: "that" }],
            [2, { msg: [[4, { str: "https://example.org" }]] }],
          ],
        },
      ],
      [
        1,
        {
          msg: [
            [1, { str: " elsewhere" }],
            [2, { msg: [[4, { str: anchor("NOT-HERE") }]] }],
          ],
        },
      ],
    ];
    const box = pb([
      [
        21,
        {
          msg: [
            [
              20,
              {
                msg: [
                  [
                    1,
                    {
                      msg: [
                        [1, { f32: 10 }],
                        [2, { f32: 10 }],
                      ],
                    },
                  ],
                ],
              },
            ],
            [32, { msg: [[1, { msg: [[2, { bytes: bv4Raw(pb(runs)) }]] }]] }],
          ],
        },
      ],
    ]);
    const files = notebook([
      { id: PAGE_A, template: "T-RULED", order: "a" },
      { id: PAGE_B, template: "T-RULED", order: "b" },
    ]);
    files.set(`notes/${layerId(PAGE_A)}`, delimited([box]));
    const result = readGoodnotes(files, "");
    expect(result.doc.pages[0].textBoxes[0].text).toBe(
      "See this page (→ page 2) and that (https://example.org) elsewhere (→ a page of another notebook)",
    );
    expect(result.warnings).toEqual([
      "1 text box links somewhere; the link is written after its words (page 1).",
    ]);
    expect(goodnotesPageLink("https://example.org/?anchor=cGFnZS1Y")).toBeNull();
    expect(goodnotesPageLink("https://app.goodnotes.com/documents/?anchor=%%%")).toBeNull();
    expect(goodnotesPageLink("https://app.goodnotes.com/documents/?anchor=!!")).toBeNull();
    expect(
      goodnotesPageLink(`https://app.goodnotes.com/documents/?anchor=${btoa("note-1")}`),
    ).toBeNull();
  });

  it("signs a comment with its author, in its colour and size", () => {
    const comment = (text: string | null, author?: string): Uint8Array =>
      pb([
        [
          20,
          {
            msg: [
              [
                20,
                {
                  msg: [
                    [
                      1,
                      {
                        msg: [
                          [1, { f32: 50 }],
                          [2, { f32: 60 }],
                        ],
                      },
                    ],
                  ],
                },
              ],
              [
                21,
                {
                  msg: [
                    [
                      2,
                      {
                        msg: [
                          [1, { f32: 256 }],
                          [2, { f32: 256 }],
                        ],
                      },
                    ],
                  ],
                },
              ],
              [30, { msg: rgba(0.92, 0.85, 1, 1) }],
              ...(text === null
                ? []
                : [
                    [
                      31,
                      {
                        msg: [
                          [
                            1,
                            {
                              msg: [
                                [2, { bytes: bv4Raw(pb([[1, { msg: [[1, { str: text }]] }]])) }],
                              ],
                            },
                          ],
                        ],
                      },
                    ] as PbField,
                  ]),
              ...(author ? [[33, { str: author }] as PbField] : []),
            ],
          },
        ],
      ]);
    const result = withNotes([
      comment("Check this", "Jj doe"),
      comment(null, "Jj doe"),
      comment(null),
    ]);
    const [signed, bare, nobody] = result.doc.pages[0].textBoxes;
    expect(signed).toMatchObject({ text: "Jj doe: Check this", fill: "#ebd9ff" });
    expect(signed.x).toBeCloseTo(50 * K, 1);
    expect(signed.h).toBeCloseTo(256 * K, 1);
    expect(bare.text).toBe("Comment by Jj doe");
    expect(nobody.text).toBe("Comment by someone");
  });

  it("keeps what Goodnotes' own recognition read, page by page", () => {
    const group = (text: string): PbField => [
      6,
      {
        msg: [
          [3, { str: text }],
          [3, { str: "alt" }],
        ],
      },
    ];
    const index = pb([
      [3, { str: "typed" }],
      group("What"),
      group("'s"),
      group(" "),
      group("up"),
      group("\n"),
      group("  "),
      group("\n"),
      group("next"),
    ]);
    expect(searchText(index)).toBe("What's up\nnext");
    expect(searchText(undefined)).toBe("");
    expect(searchText(new Uint8Array([0xff]))).toBe("");

    const files = notebook([
      { id: PAGE_A, template: "T-RULED", order: "a" },
      { id: PAGE_B, template: "T-RULED", order: "b" },
    ]);
    files.set(`search/${layerId(PAGE_B)}`, index);
    expect(readGoodnotes(files, "").pageText).toEqual(["", "What's up\nnext"]);
    expect(
      readGoodnotes(notebook([{ id: PAGE_A, template: "T-RULED", order: "a" }]), "").pageText,
    ).toBeUndefined();
  });
});
