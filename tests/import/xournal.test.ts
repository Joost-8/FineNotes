import { describe, expect, it } from "vitest";
import { gzipSync, strToU8, zipSync } from "fflate";
import {
  decodeBase64,
  decodeEntities,
  isXournal,
  parseColor,
  parseXml,
  readXournal,
  XOURNAL_PX_PER_PT,
  XournalError,
} from "../../src/import/xournal";
import { PAGE_PX_PER_MM } from "../../src/model/units";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import type { SyntheticBackdrop } from "../../src/model/document";
import { PDF, PNG } from "./builders";
import { base64, stroke, xoXml, xopp, xoZip, type XoPage } from "./xournal-builders";

const K = XOURNAL_PX_PER_PT;

function read(pages: XoPage[], title?: string) {
  return readXournal(xopp(pages, title), "Fallback");
}

describe("isXournal", () => {
  it("accepts gzipped, plain and zipped notebooks", () => {
    expect(isXournal(xopp([{}]))).toBe(true);
    expect(isXournal(strToU8(xoXml([{}])))).toBe(true);
    expect(isXournal(strToU8(xoXml([{}], undefined, "")))).toBe(true);
    expect(isXournal(xoZip([{}]))).toBe(true);
  });

  it("refuses other files", () => {
    expect(isXournal(PDF)).toBe(false);
    expect(isXournal(strToU8("<?xml version='1.0'?><svg></svg>"))).toBe(false);
    expect(isXournal(strToU8("hello"))).toBe(false);
    expect(isXournal(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).toBe(false);
    expect(isXournal(gzipSync(strToU8("not xml")))).toBe(false);
    expect(isXournal(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(false);
  });
});

describe("readXournal", () => {
  it("throws XournalError on garbage", () => {
    expect(() => readXournal(strToU8("garbage"), "x")).toThrow(XournalError);
    expect(() => readXournal(new Uint8Array([0x1f, 0x8b, 0, 0]), "x")).toThrow(XournalError);
    expect(() => readXournal(strToU8("<xournal><page>"), "x")).toThrow(XournalError);
    expect(() => readXournal(strToU8("<xournal></xournal>"), "x")).toThrow(/no pages/);
  });

  it("refuses a zip without content.xml", () => {
    expect(() => readXournal(xoZipWithout(), "x")).toThrow(XournalError);
  });

  it("scales PDF points to page px", () => {
    const result = read([{ width: 595.28, height: 841.89 }, {}]);
    expect(K).toBeCloseTo((PAGE_PX_PER_MM * 25.4) / 72, 6);
    expect(result.source).toBe("xournal");
    expect(result.doc.pages.map((p) => p.geometry)).toEqual([
      { width: 1024, height: 1448 },
      { width: Math.round(612 * K), height: Math.round(792 * K) },
    ]);
    expect(result.doc.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.doc.view.width).toBe(1024);
    expect(result.warnings).toEqual([]);
  });

  it("falls back to US Letter for a page without a size", () => {
    const xml = '<xournal><page width="-1"><layer/></page></xournal>';
    const page = readXournal(strToU8(xml), "x").doc.pages[0];
    expect(page.geometry).toEqual({ width: Math.round(612 * K), height: Math.round(792 * K) });
    expect(page.backdrop).toEqual({ kind: "blank" });
  });

  it("takes a meaningful title and ignores Xournal's boilerplate", () => {
    expect(read([{}], "Lecture 3").title).toBe("Lecture 3");
    expect(read([{}], "Xournal++ document - see https://xournalpp.github.io").title).toBe(
      "Fallback",
    );
    expect(read([{}], "Xournal document - see http://xournal.sourceforge.net/").title).toBe(
      "Fallback",
    );
    expect(read([{}], "  ").title).toBe("Fallback");
    expect(read([{}]).title).toBe("Fallback");
  });

  it("maps every paper style, with its spacing and colour", () => {
    const styles = [
      "plain",
      "lined",
      "ruled",
      "graph",
      "dotted",
      "staves",
      "isodotted",
      "isograph",
      "unknown",
    ];
    const result = read(
      styles.map((style, i) => ({
        background: `<background type="solid" color="${i === 1 ? "yellow" : "#a0e8ffff"}" style="${style}"/>`,
      })),
    );
    const backdrops = result.doc.pages.map((p) => p.backdrop as SyntheticBackdrop);
    expect(backdrops.map((b) => b.kind)).toEqual([
      "blank",
      "margin-left",
      "ruled-wide",
      "squared",
      "dotted",
      "music",
      "isometric-dots",
      "isometric",
      "blank",
    ]);
    expect(backdrops[0].spacing).toBeUndefined();
    expect(backdrops[2].spacing).toBeCloseTo(24 * K, 1);
    expect(backdrops[3].spacing).toBeCloseTo(14.17 * K, 1);
    expect(backdrops[1].paperColor).toBe("#ffff80");
    expect(backdrops[0].paperColor).toBe("#a0e8ff");
  });

  it("keeps white paper without a paper colour", () => {
    const result = read([
      { background: '<background type="solid" color="white" style="ruled"/>' },
      { background: '<background type="solid" color="#ffffffff"/>' },
      { background: '<background type="solid" color="nonsense"/>' },
    ]);
    for (const page of result.doc.pages) {
      expect((page.backdrop as SyntheticBackdrop).paperColor).toBeUndefined();
    }
  });

  it("reads a stroke's points and per-segment widths as pressure", () => {
    const result = read([
      {
        layers: [[stroke([10, 20, 30, 40, 50, 60, 70, 80], "2 1 2 3", { color: "#ff000080" })]],
      },
    ]);
    const s = result.doc.pages[0].strokes[0];
    expect(s.id).toBe("s1");
    expect(s.tool).toBe("pen");
    expect(s.color).toBe("#ff0000");
    expect(s.pts.length).toBe(12);
    expect(s.pts[0]).toBeCloseTo(10 * K, 1);
    expect(s.pts[1]).toBeCloseTo(20 * K, 1);
    // Widths per point: 1, 2, 3, 3 — the median is the nib.
    expect(s.size).toBeCloseTo(3 * K, 1);
    const pressures = [s.pts[2], s.pts[5], s.pts[8], s.pts[11]];
    expect(pressures[0]).toBeLessThan(pressures[1]);
    expect(pressures[1]).toBeLessThan(pressures[2]);
    expect(pressures[2]).toBeCloseTo(0.5, 2);
    expect(pressures[3]).toBeCloseTo(0.5, 2);
  });

  it("draws a stroke without pressure at its nominal width", () => {
    const s = read([{ layers: [[stroke([1, 2, 3, 4], "1.41")]] }]).doc.pages[0].strokes[0];
    expect(s.size).toBeCloseTo(1.41 * K, 1);
    expect(s.pts[2]).toBeCloseTo(0.5, 2);
    expect(s.pts[5]).toBeCloseTo(0.5, 2);
  });

  it("gives a stroke without a width the medium pen, and a lone point a dot", () => {
    const xml =
      '<xournal><page width="612" height="792"><layer>' +
      "<stroke>5 5</stroke></layer></page></xournal>";
    const s = readXournal(strToU8(xml), "x").doc.pages[0].strokes[0];
    expect(s.color).toBe("#000000");
    expect(s.pts.length).toBe(3);
    expect(s.size).toBeCloseTo(1.41 * K, 1);
  });

  it("maps the highlighter, skips the eraser and reports empty strokes", () => {
    const result = read([
      {
        layers: [
          [
            stroke([0, 0, 10, 10], "8.5", { tool: "highlighter", color: "yellow" }),
            stroke([0, 0, 10, 10], "5", { tool: "eraser" }),
          ],
          [stroke([], "1")],
        ],
      },
    ]);
    const strokes = result.doc.pages[0].strokes;
    expect(strokes.length).toBe(1);
    expect(strokes[0].tool).toBe("highlighter");
    expect(strokes[0].color).toBe("#ffff00");
    expect(result.warnings).toEqual(["1 stroke could not be read."]);
  });

  it("reads every palette name, and black for an unknown colour", () => {
    const names: [string, string][] = [
      ["black", "#000000"],
      ["blue", "#3333cc"],
      ["red", "#ff0000"],
      ["green", "#008000"],
      ["gray", "#808080"],
      ["lightblue", "#00c0ff"],
      ["lightgreen", "#00ff00"],
      ["magenta", "#ff00ff"],
      ["orange", "#ff8000"],
      ["yellow", "#ffff00"],
      ["white", "#ffffff"],
      ["#12AB34FF", "#12ab34"],
      ["#12ab34", "#12ab34"],
      ["toString", "#000000"],
    ];
    const result = read([
      { layers: [names.map(([c]) => stroke([0, 0, 1, 1], "1", { color: c }))] },
    ]);
    expect(result.doc.pages[0].strokes.map((s) => s.color)).toEqual(names.map(([, hex]) => hex));
  });

  it("flattens layers in order", () => {
    const result = read([
      { layers: [[stroke([1, 1, 2, 2], "1", { color: "red" })], [stroke([3, 3, 4, 4], "1")]] },
    ]);
    expect(result.doc.pages[0].strokes.map((s) => [s.id, s.color])).toEqual([
      ["s1", "#ff0000"],
      ["s2", "#000000"],
    ]);
  });

  it("reads text boxes with their font, size and colour", () => {
    const result = read([
      {
        layers: [
          [
            '<text font="Sans Bold Italic" size="12" x="72" y="100" color="blue">Hello &amp; &lt;world&gt;\nline two</text>',
            '<text font="Serif" size="20" matrix="1 0 0 1 10 20" color="#00ff0080" width="200">wrapped</text>',
            '<text font="Monospace" size="4" x="1" y="1">x</text>',
            '<text font="Times New Roman" x="1" y="1"><![CDATA[a < b]]></text>',
            '<text x="nope" y="1">lost</text>',
            '<text x="1" y="1">   </text>',
          ],
        ],
      },
    ]);
    const boxes = result.doc.pages[0].textBoxes;
    expect(boxes.length).toBe(4);
    expect(boxes[0]).toMatchObject({
      id: "t1",
      text: "Hello & <world>\nline two",
      color: "#3333cc",
      bold: true,
      italic: true,
      fit: true,
    });
    expect(boxes[0].font).toBeUndefined();
    expect(boxes[0].x).toBeCloseTo(72 * K, 1);
    expect(boxes[0].fontSize).toBeCloseTo(12 * K, 1);
    expect(boxes[1]).toMatchObject({ font: "serif", color: "#00ff00", text: "wrapped" });
    expect(boxes[1].fit).toBeUndefined();
    expect(boxes[1].w).toBeCloseTo(200 * K, 1);
    expect(boxes[1].x).toBeCloseTo(10 * K, 1);
    expect(boxes[1].y).toBeCloseTo(20 * K, 1);
    expect(boxes[2]).toMatchObject({ font: "mono", fontSize: 12 });
    expect(boxes[3]).toMatchObject({ font: "times", text: "a < b" });
    expect(result.warnings).toEqual([
      "2 items (LaTeX, links or other elements) could not be brought over yet.",
    ]);
  });

  it("brings embedded pictures over as attachments", () => {
    const result = read(
      [
        {
          layers: [
            [
              `<image left="10" top="20" right="110" bottom="70">${base64(PNG)}</image>`,
              `<image left="0" top="0" right="10" bottom="10">${base64(PDF)}</image>`,
              '<image left="0" top="0" right="10" bottom="10">!!!</image>',
              `<image left="10" top="10" right="5" bottom="20">${base64(PNG)}</image>`,
            ],
          ],
        },
      ],
      "Bio",
    );
    const images = result.doc.pages[0].images;
    expect(images.length).toBe(1);
    expect(images[0].path).toBe("Bio - picture 1.png");
    expect(images[0].x).toBeCloseTo(10 * K, 1);
    expect(images[0].w).toBeCloseTo(100 * K, 1);
    expect(images[0].h).toBeCloseTo(50 * K, 1);
    expect(result.attachments).toEqual([
      { name: "Bio - picture 1.png", bytes: PNG, mime: "image/png" },
    ]);
    expect(result.warnings).toEqual(["3 pictures could not be read."]);
  });

  it("reads a picture placed by a matrix, and a LaTeX picture", () => {
    const result = read([
      {
        layers: [
          [
            `<image matrix="40 0 0 30 5 6">${base64(PNG)}</image>`,
            `<teximage left="0" top="0" right="10" bottom="10" text="x^2">${base64(PNG)}</teximage>`,
            `<teximage left="0" top="0" right="10" bottom="10" text="y">${base64(PDF)}</teximage>`,
            '<link url="https://example.com" x="1" y="1">here</link>',
            '<timestamp fn="a.mp3" ts="10"/>',
          ],
        ],
      },
    ]);
    const images = result.doc.pages[0].images;
    expect(images.length).toBe(2);
    expect(images[0].x).toBeCloseTo(5 * K, 1);
    expect(images[0].w).toBeCloseTo(40 * K, 1);
    expect(images[0].h).toBeCloseTo(30 * K, 1);
    expect(result.warnings).toEqual([
      "2 items (LaTeX, links or other elements) could not be brought over yet.",
    ]);
  });

  it("gives a page whose PDF is not in the file blank paper, and says so", () => {
    const result = read([
      { background: '<background type="pdf" domain="absolute" filename="/x/lec.pdf" pageno="1"/>' },
      { background: '<background type="pdf" pageno="2"/>' },
      {},
    ]);
    expect(result.doc.pages.map((p) => p.backdrop.kind)).toEqual(["blank", "blank", "blank"]);
    expect(result.warnings).toEqual([
      "2 pages used a PDF that is not in the file; they have blank paper.",
    ]);
    const one = read([{ background: '<background type="pdf" domain="attach" filename="a.pdf"/>' }]);
    expect(one.warnings).toEqual([
      "1 page used a PDF that is not in the file; it has blank paper.",
    ]);
  });

  it("brings a PDF over from a zip container", () => {
    const result = readXournal(
      xoZip(
        [
          { background: '<background type="pdf" domain="attach" filename="bg.pdf" pageno="1"/>' },
          { background: '<background type="pdf" domain="attach" pageno="3"/>' },
        ],
        { "bg.pdf": PDF },
      ),
      "Lec",
    );
    expect(result.doc.pages.map((p) => p.backdrop)).toEqual([
      { kind: "pdf", path: "Lec - paper 1.pdf", page: 0 },
      { kind: "pdf", path: "Lec - paper 1.pdf", page: 2 },
    ]);
    expect(result.attachments.length).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("reads zip pictures and background pictures, and clones them", () => {
    const result = readXournal(
      xoZip(
        [
          {
            background: '<background type="pixmap" domain="attach" filename="bg.png"/>',
            layers: [
              [
                '<image left="0" top="0" right="10" bottom="10"><attachment path="img.png"/></image>',
              ],
            ],
          },
          { background: '<background type="pixmap" domain="clone" filename="0"/>' },
          { background: '<background type="pixmap" domain="clone" filename="9"/>' },
          { background: '<background type="pixmap" domain="absolute" filename="/x/y.png"/>' },
        ],
        { "bg.png": PNG, "img.png": PNG },
      ),
      "N",
    );
    const [p1, p2, p3, p4] = result.doc.pages;
    expect(p1.images.map((i) => i.path)).toEqual(["N - picture 1.png", "N - picture 2.png"]);
    expect(p1.images[0]).toMatchObject({ x: 0, y: 0, w: p1.geometry.width, locked: true });
    expect(p2.images[0].path).toBe("N - picture 1.png");
    expect(p3.images).toEqual([]);
    expect(p4.images).toEqual([]);
    expect(result.warnings).toEqual([
      "2 pages used a background picture that is not in the file; they have blank paper.",
    ]);
  });

  it("reads a background picture embedded in the file", () => {
    const result = read([
      { background: `<background type="pixmap" domain="attach">${base64(PNG)}</background>` },
      { background: '<background type="pixmap" domain="clone" filename="x"/>' },
      { background: '<background type="weird"/>' },
    ]);
    expect(result.doc.pages[0].images[0].path).toBe("Fallback - picture 1.png");
    expect(result.warnings).toEqual([
      "1 page used a background picture that is not in the file; it has blank paper.",
      "1 item (LaTeX, links or other elements) could not be brought over yet.",
    ]);
  });

  it("reads a plain .xoj without gzip, with comments and a doctype", () => {
    const xml =
      "<?xml version=\"1.0\" standalone='no'?>\n<!DOCTYPE xournal>\n<!-- saved -->\n" +
      "<xournal version='0.4.8'><title>Old</title><page width='612' height='792'>" +
      "<background type='solid' color='pink' style='graph'/>" +
      `<layer>${stroke([1, 2, 3, 4], "0.85")}</layer></page></xournal>`;
    const result = readXournal(strToU8(xml), "x");
    expect(result.title).toBe("Old");
    expect(result.doc.pages[0].backdrop).toMatchObject({ kind: "squared", paperColor: "#ffc0d4" });
    expect(result.doc.pages[0].strokes.length).toBe(1);
  });

  it("writes a file FineNotes reads back unchanged", () => {
    const result = read(
      [
        {
          background: '<background type="solid" color="yellow" style="ruled"/>',
          layers: [
            [
              stroke([10, 20, 30, 40], "2 1.5", { color: "red" }),
              '<text font="Sans" size="12" x="1" y="2" color="black">Hi</text>',
              `<image left="1" top="2" right="3" bottom="4">${base64(PNG)}</image>`,
            ],
          ],
        },
      ],
      "Biology",
    );
    const back = parseInkFile(buildInkFile("# Biology\n", result.doc)).doc;
    expect(back?.pages.length).toBe(1);
    const page = back?.pages[0];
    expect(page?.backdrop).toMatchObject({ kind: "ruled-wide", paperColor: "#ffff80" });
    expect(page?.strokes[0].color).toBe("#ff0000");
    expect(page?.strokes[0].pts.length).toBe(6);
    expect(page?.textBoxes[0].text).toBe("Hi");
    expect(page?.images[0].path).toBe("Biology - picture 1.png");
  });
});

describe("XML helpers", () => {
  it("decodes entities, keeping unknown ones", () => {
    expect(decodeEntities("&#65;&#x42;&quot;&apos;&nope;&#0;")).toBe("AB\"'&nope;&#0;");
  });

  it("refuses malformed XML", () => {
    for (const bad of [
      "<a></b>",
      "<a",
      "<!-- open",
      "<![CDATA[ open",
      "<a x></a>",
      "<a x=1></a>",
      '<a x="1></a>',
      "<a></a",
      "< a/>",
      '<a ="1"/>',
    ]) {
      expect(() => parseXml(bad), bad).toThrow(XournalError);
    }
    expect(parseXml("text only")).toEqual(["text only"]);
  });

  it("parses colours", () => {
    expect(parseColor(" #AbCdEf ", {})).toBe("#abcdef");
    expect(parseColor("#abc", {})).toBeNull();
  });

  it("decodes base64", () => {
    expect(decodeBase64("SGk=")).toEqual(strToU8("Hi"));
    expect(decodeBase64(" SG\nk ")).toEqual(strToU8("Hi"));
    expect(decodeBase64("")).toBeNull();
    expect(decodeBase64("A")).toBeNull();
  });
});

/** A zip that is not a Xournal++ container. */
function xoZipWithout(): Uint8Array {
  return zipSync({ "other.txt": strToU8("x") });
}
