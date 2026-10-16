import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { POINT_STRIDE } from "../../src/model/document";
import { FREENOTES_SCALE, isFreenotes, readFreenotes } from "../../src/import/freenotes";
import { PDF, zip } from "./builders";
import { freenotes, type FnPage } from "./freenotes-builders";

const k = FREENOTES_SCALE;

function files(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(bytes)));
}

function read(pages: FnPage[], title?: string) {
  return readFreenotes(files(freenotes({ pages, title })), "Fallback");
}

/** A horizontal line of points from x0 to x1 at y, one every `step` points. */
function line(x0: number, x1: number, y: number, step = 2, w = 2.5) {
  const out = [];
  for (let x = x0; x <= x1; x += step) out.push({ x, y, w });
  return out;
}

describe("FreeNotes import", () => {
  it("recognises a FreeNotes zip and nothing else", () => {
    expect(isFreenotes(files(freenotes({ pages: [{}] })))).toBe(true);
    expect(isFreenotes(files(zip({ "a.frnote/document.dat": new Uint8Array([1, 2, 3]) })))).toBe(
      false,
    );
    const noLayout = files(freenotes({ pages: [{}] }));
    for (const name of [...noLayout.keys()]) if (name.endsWith("layout.dat")) noLayout.delete(name);
    expect(isFreenotes(noLayout)).toBe(false);
    expect(() => readFreenotes(new Map(), "x")).toThrow(/not a FreeNotes notebook/);
    const unnamed = readFreenotes(files(freenotes({ pages: [{}] })), "Maths.frnote");
    expect(unnamed.title).toBe("Maths");
  });

  it("brings over the title, the pages in order, their size and their lined paper", () => {
    const result = read(
      [
        { pattern: 5, position: 1, items: [{ points: line(10, 20, 30) }] },
        { pattern: 5, position: 0, width: 842, height: 595 },
        { pattern: 5, position: 2, paperColor: 0xfff3d6ff, lineColor: 0x8080ffff },
      ],
      "prob and stats",
    );
    expect(result.source).toBe("freenotes");
    expect(result.title).toBe("prob and stats");
    expect(result.warnings).toEqual([]);
    const pages = result.doc.pages;
    expect(pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    // Sorted by position: the landscape page came first.
    expect(pages[0].geometry).toEqual({ width: Math.round(842 * k), height: Math.round(595 * k) });
    expect(pages[1].geometry).toEqual({ width: 1024, height: Math.round(842 * k) });
    expect(pages[1].strokes).toHaveLength(1);
    expect(pages[1].backdrop).toEqual({
      kind: "ruled-wide",
      spacing: Math.round(42.1 * k * 100) / 100,
      color: "#c9c9c9",
    });
    expect(pages[2].backdrop).toMatchObject({ paperColor: "#fff3d6", color: "#8080ff" });
    expect(result.doc.view.width).toBe(pages[0].geometry.width);
  });

  it("falls back to the file's name, A4 and blank paper", () => {
    const bytes = freenotes({ pages: [{ noInk: true }] });
    const entries = files(bytes);
    for (const name of [...entries.keys()]) {
      if (name.endsWith("layout.dat")) entries.set(name, new Uint8Array([0xff]));
    }
    const result = readFreenotes(entries, "Fallback");
    expect(result.title).toBe("Fallback");
    expect(result.doc.pages[0].geometry).toEqual({ width: 1024, height: Math.round(842 * k) });
    expect(result.doc.pages[0].backdrop).toEqual({ kind: "blank" });
    expect(result.doc.pages[0].strokes).toEqual([]);
  });

  it("converts pen strokes: position, colour, nib and pressure from the drawn width", () => {
    const result = read([
      {
        items: [
          {
            color: 0x1e50c8ff,
            points: [
              { x: 100, y: 200, w: 2 },
              { x: 110, y: 200, w: 3 },
              { x: 120, y: 205, w: 4 },
            ],
          },
        ],
      },
    ]);
    const [stroke] = result.doc.pages[0].strokes;
    expect(stroke.tool).toBe("pen");
    expect(stroke.color).toBe("#1e50c8");
    expect(stroke.size).toBeCloseTo(3 * k, 2);
    const xs = [stroke.pts[0], stroke.pts[3], stroke.pts[6]];
    expect(xs).toEqual([100, 110, 120].map((x) => Math.round(x * k * 100) / 100));
    expect(stroke.pts[7]).toBeCloseTo(205 * k, 2);
    // Thinner than the nib reads as less pressure, thicker as more.
    expect(stroke.pts[2]).toBeLessThan(stroke.pts[5]);
    expect(stroke.pts[5]).toBeLessThan(stroke.pts[8]);
  });

  it("reads the highlighter as a highlighter, in its colour", () => {
    const result = read([
      { items: [{ tool: 2, color: 0xffcf2f7f, points: line(50, 90, 100, 5, 8.7) }] },
    ]);
    const [stroke] = result.doc.pages[0].strokes;
    expect(stroke.tool).toBe("highlighter");
    expect(stroke.color).toBe("#ffcf2f");
    expect(stroke.size).toBeCloseTo(8.7 * k, 1);
  });

  it("moves an item by its transform, and keeps one without a transform where it is", () => {
    const result = read([
      {
        items: [
          {
            transform: [2, 0, 0, 2, 10, 20],
            points: [
              { x: 5, y: 5, w: 1 },
              { x: 15, y: 5, w: 1 },
            ],
          },
          {
            transform: null,
            points: [
              { x: 5, y: 5 },
              { x: 15, y: 5 },
            ],
          },
        ],
      },
    ]);
    const [moved, plain] = result.doc.pages[0].strokes;
    expect(moved.pts[0]).toBeCloseTo(20 * k, 2);
    expect(moved.pts[1]).toBeCloseTo(30 * k, 2);
    expect(moved.pts[3]).toBeCloseTo(40 * k, 2);
    // Scaled twice over, the drawn width doubles.
    expect(moved.size).toBeCloseTo(2 * k, 2);
    expect(plain.pts[0]).toBeCloseTo(5 * k, 2);
  });

  it("cuts out what the pixel eraser went over", () => {
    const through = [
      { x: 50, y: 80, w: 6 },
      { x: 50, y: 120, w: 6 },
    ];
    const result = read([
      {
        items: [
          // Erased down the middle: two pieces either side of x = 50.
          { points: line(0, 100, 100), erasers: [through] },
          // Erased over its whole length: gone.
          { points: line(48, 52, 110, 1), erasers: [through] },
          // An eraser that missed it: untouched.
          { points: line(0, 100, 300), erasers: [through] },
          // An eraser stroke on its own draws nothing.
          { tool: 101, points: line(0, 100, 400) },
        ],
      },
    ]);
    const strokes = result.doc.pages[0].strokes;
    expect(strokes).toHaveLength(3);
    const [left, right, whole] = strokes;
    const xsOf = (pts: number[]) => pts.filter((_, i) => i % POINT_STRIDE === 0);
    expect(Math.max(...xsOf(left.pts))).toBeLessThan(50 * k - 3 * k);
    expect(Math.min(...xsOf(right.pts))).toBeGreaterThan(50 * k + 3 * k);
    expect(left.pts[0]).toBe(0);
    expect(Math.max(...xsOf(right.pts))).toBeCloseTo(100 * k, 1);
    expect(whole.pts).toHaveLength(51 * POINT_STRIDE);
    expect(new Set(strokes.map((s) => s.id)).size).toBe(3);
  });

  it("erases between the eraser's samples, not only at them", () => {
    // Two samples 60 points apart with a 6 point eraser: the stroke crossing
    // halfway between them must still be cut.
    const result = read([
      {
        items: [
          {
            points: [
              { x: 30, y: 0, w: 2 },
              { x: 30, y: 100, w: 2 },
            ],
            erasers: [
              [
                { x: 0, y: 50, w: 6 },
                { x: 60, y: 50, w: 6 },
              ],
            ],
          },
        ],
      },
    ]);
    expect(result.doc.pages[0].strokes).toHaveLength(2);
  });

  it("keeps a PDF template as the paper, saving each PDF once", () => {
    const result = read([
      { pdf: { bytes: PDF, id: "cover" } },
      { pdf: { bytes: PDF, id: "cover", page: 2 } },
      { pattern: 5 },
    ]);
    const [a, b] = result.doc.pages;
    expect(a.backdrop).toEqual({ kind: "pdf", path: "Fallback - paper 1.pdf", page: 0 });
    expect(b.backdrop).toEqual({ kind: "pdf", path: "Fallback - paper 1.pdf", page: 1 });
    expect(result.attachments).toEqual([
      { name: "Fallback - paper 1.pdf", bytes: PDF, mime: "application/pdf" },
    ]);
  });

  it("says what it could not bring over", () => {
    const bytes = freenotes({
      pages: [
        { pdf: { bytes: PDF, id: "gone" } },
        { pattern: 9, items: ["other", "other", { points: line(0, 10, 10) }] },
        { missingInk: true },
      ],
    });
    const entries = files(bytes);
    for (const name of [...entries.keys()]) if (name.endsWith("gone.pdf")) entries.delete(name);
    const result = readFreenotes(entries, "Fallback");
    expect(result.doc.pages[0].backdrop).toEqual({ kind: "blank" });
    expect(result.doc.pages[1].backdrop).toEqual({ kind: "blank" });
    expect(result.doc.pages[1].strokes).toHaveLength(1);
    expect(result.warnings).toEqual([
      "2 items (pictures, text or other objects) could not be brought over yet.",
      "The ink of 1 page was not found in the file; it was left blank.",
      "1 page is drawn on a PDF that was not found in the file; it was left blank.",
      "The paper of 1 page is not one FineNotes knows; it came over as blank paper.",
    ]);
  });
});
