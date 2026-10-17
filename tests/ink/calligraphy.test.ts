/**
 * The calligraphy pen's flat nib (`src/ink/freehand.ts`): full width across
 * the nib, a hairline along it, every width known when its point arrives so
 * the ink only ever grows, and drawn the same once saved.
 */

import { describe, expect, it } from "vitest";
import { InkTracer, NIB_HAIRLINE, inkRuns, nibFactor, penOptions } from "../../src/ink/freehand";
import { blankPage, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const NIB = (40 * Math.PI) / 180;

describe("nibFactor", () => {
  it("is full width across the nib and a hairline along it", () => {
    expect(nibFactor(NIB, Math.cos(NIB + Math.PI / 2), Math.sin(NIB + Math.PI / 2))).toBeCloseTo(1);
    expect(nibFactor(NIB, Math.cos(NIB), Math.sin(NIB))).toBeCloseTo(NIB_HAIRLINE);
    expect(nibFactor(NIB, -Math.cos(NIB), -Math.sin(NIB))).toBeCloseTo(NIB_HAIRLINE);
  });

  it("is the full width with no direction to go on", () => {
    expect(nibFactor(NIB, 0, 0)).toBe(1);
    expect(nibFactor(Number.NaN, 1, 0)).toBe(1);
  });
});

describe("a stroke with a flat nib", () => {
  /** A loop: every direction once. */
  function loop(): number[] {
    const pts: number[] = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      pts.push(100 + 40 * Math.cos(a), 100 + 40 * Math.sin(a), 0.5);
    }
    return pts;
  }

  it("swells and thins with the direction", () => {
    const widths = inkRuns(loop(), penOptions(8, false, 40)).map((run) => run.width);
    expect(Math.max(...widths)).toBeGreaterThan(7);
    expect(Math.min(...widths)).toBeLessThan(8 * NIB_HAIRLINE + 1);
  });

  it("only ever grows: what is settled is never redrawn", () => {
    const pts = loop();
    const tracer = new InkTracer(penOptions(8, false, 40));
    let before = tracer.settled();
    for (let i = 0; i < pts.length; i += 3) {
      tracer.push(pts[i], pts[i + 1], pts[i + 2]);
      const now = tracer.settled();
      // Every run settled before is still there, unchanged (the last may have grown).
      for (let r = 0; r < before.length - 1; r++) expect(now[r]).toEqual(before[r]);
      if (before.length > 0) {
        const last = before[before.length - 1];
        expect(now[before.length - 1].width).toBe(last.width);
        expect(now[before.length - 1].pts.slice(0, last.pts.length)).toEqual(last.pts);
      }
      before = now;
    }
  });

  it("is one width with a round nib, as before", () => {
    const widths = new Set(inkRuns(loop(), penOptions(8, false)).map((run) => run.width));
    expect(widths.size).toBe(1);
  });

  it("keeps its nib through a save", () => {
    const doc = emptyDocument();
    doc.pages = [
      {
        ...blankPage("p1", { width: 400, height: 400 }),
        strokes: [{ id: "s", color: "#1a1a1a", size: 8, tool: "pen", nib: 40, pts: loop() }],
      },
    ];
    expect(decodeDocument(encodeDocument(doc)).pages[0].strokes[0].nib).toBe(40);
  });
});
