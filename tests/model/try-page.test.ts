import { describe, expect, it } from "vitest";
import { DEFAULT_NOTEBOOK_CHOICES } from "../../src/model/new-notebook";
import {
  TRY_PAGE_PATH,
  pointCount,
  sampleWriting,
  scribbledWord,
  tryPageDocument,
} from "../../src/model/try-page";

describe("scribbledWord", () => {
  it("runs across its width, above its baseline, whole points only", () => {
    const pts = scribbledWord(100, 200, 120, 14);
    expect(pts.length % 3).toBe(0);
    const xs = pts.filter((_, i) => i % 3 === 0);
    const ys = pts.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeGreaterThan(90);
    expect(Math.max(...xs)).toBeLessThan(230);
    expect(Math.max(...ys)).toBeLessThanOrEqual(200);
    expect(Math.min(...ys)).toBeGreaterThan(200 - 14 * 1.3);
    for (const v of pts) expect(Number.isFinite(v)).toBe(true);
  });

  it("is the same every time", () => {
    expect(scribbledWord(0, 50, 80, 12)).toEqual(scribbledWord(0, 50, 80, 12));
  });
});

describe("sampleWriting", () => {
  it("writes a few words in three lines, inside the page, with unique ids", () => {
    const strokes = sampleWriting(1024, 1448);
    expect(strokes.length).toBe(14);
    expect(new Set(strokes.map((s) => s.id)).size).toBe(strokes.length);
    for (const stroke of strokes) {
      expect(pointCount(stroke)).toBeGreaterThan(10);
      for (let i = 0; i < stroke.pts.length; i += 3) {
        expect(stroke.pts[i]).toBeGreaterThan(0);
        expect(stroke.pts[i]).toBeLessThan(1024);
        expect(stroke.pts[i + 1]).toBeGreaterThan(0);
        expect(stroke.pts[i + 1]).toBeLessThan(1448 / 2);
      }
    }
  });
});

describe("tryPageDocument", () => {
  it("is one page of the chosen paper, never a cover, with the writing on it", () => {
    const doc = tryPageDocument({ ...DEFAULT_NOTEBOOK_CHOICES, cover: "cover-glass" }, "Try");
    expect(doc.pages.length).toBe(1);
    expect(doc.pages[0]!.strokes.length).toBeGreaterThan(0);
    expect(doc.single).toBeUndefined();
    expect(doc.endless).toBeUndefined();
  });

  it("is a notebook even when the last choice was a board", () => {
    const doc = tryPageDocument({ ...DEFAULT_NOTEBOOK_CHOICES, type: "endless" }, "Try");
    expect(doc.endless).toBeUndefined();
    expect(doc.pages.length).toBe(1);
  });

  it("lives beside FineNotes' own files, as a notebook", () => {
    expect(TRY_PAGE_PATH.endsWith(".notebook.md")).toBe(true);
  });
});
