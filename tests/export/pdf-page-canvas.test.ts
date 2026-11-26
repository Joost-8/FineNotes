import { describe, expect, it } from "vitest";
import {
  type PdfFontBook,
  PdfPageRecorder,
  faceOf,
  pdfText,
} from "../../src/export/pdf-page-canvas";
import type { VectorInk } from "../../src/export/vector-ink";

/** Every character half the size wide; only printable ASCII encodes. */
const book: PdfFontBook = {
  measure: (_face, text, size) => Array.from(text).length * size * 0.5,
  encode: (_face, text) =>
    /^[\x20-\x7e]*$/.test(text)
      ? `<${Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}>`
      : null,
};

function recorder(): { rec: PdfPageRecorder; ctx: CanvasRenderingContext2D } {
  const rec = new PdfPageRecorder(200, 100, book);
  return { rec, ctx: rec.asContext() };
}

const lines = (rec: PdfPageRecorder): string[] => rec.page().ops.split("\n");

describe("faceOf", () => {
  it("reads the face and size from a canvas font shorthand", () => {
    expect(faceOf("400 17px Helvetica, Arial, sans-serif")).toEqual({ face: "sans", size: 17 });
    expect(faceOf("italic 700 22px Helvetica")).toEqual({ face: "sans-bold-italic", size: 22 });
    expect(faceOf("650 17px Helvetica")).toEqual({ face: "sans-bold", size: 17 });
    expect(faceOf('400 14.5px "Courier New", monospace')).toEqual({ face: "mono", size: 14.5 });
    expect(faceOf("italic 14px ui-monospace")).toEqual({ face: "mono-italic", size: 14 });
    expect(faceOf("bold 12px sans-serif")).toEqual({ face: "sans-bold", size: 12 });
  });

  it("falls back to 10 px for a font without a size", () => {
    expect(faceOf("serif").size).toBe(10);
  });
});

describe("pdfText", () => {
  it("swaps the characters the standard fonts lack", () => {
    expect(pdfText(`${String.fromCharCode(0x2212)}4`)).toBe("-4");
    expect(pdfText(`a${String.fromCharCode(0x2009)}b`)).toBe("a b");
    expect(pdfText("plain")).toBe("plain");
  });
});

describe("PDF page recorder", () => {
  it("measures text with the font book", () => {
    const { ctx } = recorder();
    ctx.font = "400 20px Helvetica";
    expect(ctx.measureText("abcd").width).toBe(40);
  });

  it("writes text as real PDF text, the glyphs turned back upright", () => {
    const { rec, ctx } = recorder();
    ctx.setTransform(2, 0, 0, 2, 10, 0);
    ctx.font = "700 10px Helvetica";
    ctx.fillStyle = "#ff0000";
    ctx.fillText("Hi", 5, 20);
    expect(lines(rec)).toEqual([
      "q",
      "BT",
      "1 0 0 rg",
      "0 Tr",
      "/Fnt0 1 Tf",
      "20 0 0 -20 20 40 Tm",
      "<4869> Tj",
      "ET",
      "Q",
    ]);
    expect(rec.page().fonts).toEqual(new Map([["Fnt0", "sans-bold"]]));
    expect(rec.unsupported).toBeNull();
  });

  it("places text as the canvas aligns it", () => {
    const { rec, ctx } = recorder();
    ctx.font = "10px Helvetica";
    ctx.fillStyle = "#000000";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("ab", 30, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ab", 30, 0);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("ab", 30, 0);
    const tms = lines(rec).filter((l) => l.endsWith("Tm"));
    expect(tms).toEqual(["10 0 0 -10 20 7.7 Tm", "10 0 0 -10 25 2.7 Tm", "10 0 0 -10 30 -2.3 Tm"]);
    // One face, one resource.
    expect(rec.page().fonts.size).toBe(1);
  });

  it("outlines text for strokeText, at the stroke's width in the page's space", () => {
    const { rec, ctx } = recorder();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.font = "10px Helvetica";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.strokeText("x", 0, 10);
    expect(lines(rec)).toContain("1 1 1 RG");
    expect(lines(rec)).toContain("6 w");
    expect(lines(rec)).toContain("1 Tr");
  });

  it("lays translucent text down with a graphics state", () => {
    const { rec, ctx } = recorder();
    ctx.font = "10px Helvetica";
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillText("x", 0, 10);
    expect(lines(rec)).toContain("/Gs0 gs");
    expect(rec.page().states.get("Gs0")).toEqual({ alpha: 0.5, blend: "Normal" });
  });

  it("marks a page unsupported for text its fonts cannot show", () => {
    const { rec, ctx } = recorder();
    ctx.font = "10px Helvetica";
    ctx.fillText("日本", 0, 10);
    expect(rec.unsupported).toMatch(/fonts cannot show/);
    expect(rec.page().ops).toBe("");
  });

  it("marks a page unsupported for a text colour it cannot read", () => {
    const { rec, ctx } = recorder();
    ctx.font = "10px Helvetica";
    ctx.fillStyle = "var(--text-normal)";
    ctx.fillText("x", 0, 10);
    expect(rec.unsupported).toBe("a text colour");
  });

  it("ignores empty or misplaced text", () => {
    const { rec, ctx } = recorder();
    ctx.fillText("", 0, 0);
    ctx.fillText("x", Number.NaN, 0);
    expect(rec.page().ops).toBe("");
    expect(rec.unsupported).toBeNull();
  });

  it("draws a rounded rectangle as lines and arcs", () => {
    const { rec, ctx } = recorder();
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.roundRect(0, 0, 40, 20, [4, 4, 4, 4]);
    ctx.fill();
    const ops = lines(rec);
    expect(ops[0]).toBe("q");
    expect(ops).toContain("4 0 m");
    expect(ops.filter((l) => l.endsWith(" c"))).toHaveLength(4);
    expect(ops).toContain("f");
    expect(rec.unsupported).toBeNull();
  });

  it("takes a single radius, two radii and radii larger than the box", () => {
    const { rec, ctx } = recorder();
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.roundRect(0, 0, 10, 10, 50);
    ctx.roundRect(20, 0, 10, 10, [2, 3]);
    ctx.roundRect(40, 0, 10, 10, [1, 2, 3]);
    ctx.roundRect(60, 0, 10, 10);
    ctx.roundRect(0, 0, Number.NaN, 10);
    ctx.fill();
    expect(lines(rec)).toContain("5 0 m");
    expect(rec.unsupported).toBeNull();
  });

  it("places a picture once per source, its unit square on the box", () => {
    const { rec, ctx } = recorder();
    const photo = {};
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.drawImage(photo as CanvasImageSource, 10, 20, 30, 40);
    ctx.drawImage(photo as CanvasImageSource, 0, 0, 5, 5);
    const ops = lines(rec);
    expect(ops).toContain("60 0 0 -80 20 120 cm");
    expect(ops.filter((l) => l === "/FnPic0 Do")).toHaveLength(2);
    expect(rec.page().pictures).toEqual([{ name: "FnPic0", source: photo }]);
  });

  it("refuses a cropped picture", () => {
    const { rec, ctx } = recorder();
    ctx.drawImage({} as CanvasImageSource, 0, 0, 1, 1, 0, 0, 1, 1);
    expect(rec.unsupported).toBe("a cropped picture");
  });

  it("writes vector ink in the current space, its states and groups renamed", () => {
    const { rec, ctx } = recorder();
    ctx.setTransform(1, 0, 0, 1, 64, 100);
    const ink: VectorInk = {
      ops: "/Gs0 gs\n/Ink0 Do\n1 2 m\n3 4 l\nS",
      states: new Map([["Gs0", { alpha: 0.4, blend: "Multiply" }]]),
      groups: new Map([["Ink0", { ops: "x", bbox: [0, 0, 1, 1] }]]),
    };
    rec.drawVectorInk(ink);
    rec.drawVectorInk(ink);
    rec.drawVectorInk({ ops: "", states: new Map(), groups: new Map() });
    const page = rec.page();
    expect(page.ops).toContain("1 0 0 1 64 100 cm");
    expect(page.ops).toContain("/Nk0Gs0 gs\n/Nk0Ink0 Do");
    expect(page.ops).toContain("/Nk1Gs0 gs\n/Nk1Ink0 Do");
    expect([...page.states.keys()]).toEqual(["Nk0Gs0", "Nk1Gs0"]);
    expect([...page.groups.keys()]).toEqual(["Nk0Ink0", "Nk1Ink0"]);
  });
});
