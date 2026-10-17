/**
 * `src/import/image-pdf.ts` — a picture wrapped in a one-page PDF: the
 * cross-reference table must point at every object, the page must have the
 * picture's shape, and a JPEG must go in untouched.
 */

import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { PICTURE_PAGE_WIDTH, picturePdf, rgbFromRgba } from "../../src/import/image-pdf";

const latin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join("");

function rgb(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < out.length; i++) out[i] = (i * 37) % 256;
  return out;
}

describe("picturePdf", () => {
  it("writes a PDF whose cross-reference table points at each object", () => {
    const pdf = picturePdf({ width: 4, height: 3, data: rgb(4, 3), format: "rgb" });
    const text = latin1(pdf);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = text.slice(startxref).split("\n").slice(3, 8);
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(text).toContain("/Size 6 /Root 1 0 R");
  });

  it("gives the page the picture's shape, A4 wide", () => {
    const text = latin1(
      picturePdf({ width: 400, height: 200, data: rgb(400, 200), format: "rgb" }),
    );
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    expect(Number(box?.[1])).toBeCloseTo(PICTURE_PAGE_WIDTH, 1);
    expect(Number(box?.[2])).toBeCloseTo(PICTURE_PAGE_WIDTH / 2, 1);
  });

  it("deflates raw RGB, and the stream inflates back to the pixels", () => {
    const pixels = rgb(5, 2);
    const pdf = picturePdf({ width: 5, height: 2, data: pixels, format: "rgb" });
    const text = latin1(pdf);
    expect(text).toContain("/Filter /FlateDecode");
    const length = Number(/\/FlateDecode \/Length (\d+)/.exec(text)?.[1]);
    const start = text.indexOf("stream\n", text.indexOf("/FlateDecode")) + "stream\n".length;
    expect(unzlibSync(pdf.slice(start, start + length))).toEqual(pixels);
  });

  it("puts a JPEG in as it is", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const pdf = picturePdf({ width: 10, height: 10, data: jpeg, format: "jpeg" });
    const text = latin1(pdf);
    expect(text).toContain(`/Filter /DCTDecode /Length ${jpeg.length}`);
    const start = text.indexOf("stream\n", text.indexOf("/DCTDecode")) + "stream\n".length;
    expect(pdf.slice(start, start + jpeg.length)).toEqual(jpeg);
  });

  it("refuses a picture with no size, or raw pixels of the wrong length", () => {
    expect(() =>
      picturePdf({ width: 0, height: 3, data: new Uint8Array(), format: "rgb" }),
    ).toThrow();
    expect(() => picturePdf({ width: 2.5, height: 3, data: rgb(2, 3), format: "rgb" })).toThrow();
    expect(() => picturePdf({ width: 2, height: 2, data: rgb(2, 1), format: "rgb" })).toThrow();
  });
});

describe("rgbFromRgba", () => {
  it("drops alpha, laying see-through pixels on white", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128]);
    expect(Array.from(rgbFromRgba(rgba))).toEqual([255, 0, 0, 255, 255, 255, 127, 127, 127]);
  });
});
