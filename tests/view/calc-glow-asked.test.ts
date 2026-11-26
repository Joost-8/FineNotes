/**
 * The highlighter band over the character the maths card asks about
 * ("Which did you write?"): it covers that doubt's ink and no other, and
 * while it is asked about nothing else on the page glows.
 */

import { describe, expect, it, vi } from "vitest";
import type { Stroke } from "../../src/model/document";
import { askedBand, litFor } from "../../src/view/calc-glow";

vi.mock("obsidian", () => import("../fakes/obsidian"));

/** A pen stroke through the given points (x, y; pressure 0.5). */
function stroke(id: string, ...xy: number[]): Stroke {
  const pts: number[] = [];
  for (let i = 0; i + 1 < xy.length; i += 2) pts.push(xy[i], xy[i + 1], 0.5);
  return { id, tool: "pen", color: "#000", size: 2, pts } as Stroke;
}

// "13" over "+ 8": the 3 (two strokes) and the 8 are doubts.
const one = stroke("one", 10, 0, 10, 28);
const threeTop = stroke("threeTop", 20, 0, 34, 4, 22, 14);
const threeFoot = stroke("threeFoot", 22, 14, 36, 22, 20, 28);
const eight = stroke("eight", 24, 40, 34, 52, 24, 68);
const spec = {
  pageId: "p1",
  strokes: [one, threeTop, threeFoot, eight],
  doubts: [["threeTop", "threeFoot"], ["eight"]],
};

describe("askedBand", () => {
  it("covers the asked character's strokes, with a little room", () => {
    expect(askedBand(spec, 0)).toEqual({ minX: 16, minY: -4, maxX: 40, maxY: 32 });
    expect(askedBand(spec, 1)).toEqual({ minX: 20, minY: 36, maxX: 38, maxY: 72 });
  });

  it("leaves the other ink out", () => {
    const band = askedBand(spec, 0)!;
    // The 1 to its left and the 8 under it stay outside the band.
    expect(band.minX).toBeGreaterThan(10);
    expect(band.maxY).toBeLessThan(40);
  });

  it("is nothing when no doubt is asked about, or the doubt is gone", () => {
    expect(askedBand(spec, -1)).toBeNull();
    expect(askedBand(spec, 2)).toBeNull();
    expect(askedBand({ ...spec, doubts: [["gone"]] }, 0)).toBeNull();
  });
});

describe("litFor", () => {
  it("lights every stroke and every doubt while nothing is asked", () => {
    const lit = litFor(spec, -1);
    expect(lit.strokes.map((s) => s.id)).toEqual(["one", "threeTop", "threeFoot", "eight"]);
    expect(lit.doubts).toEqual(spec.doubts);
  });

  it("lights only the asked character while the card asks about it", () => {
    const lit = litFor(spec, 1);
    expect(lit.strokes.map((s) => s.id)).toEqual(["eight"]);
    expect(lit.doubts).toEqual([["eight"]]);
  });

  it("lights everything again when the asked doubt is gone", () => {
    expect(litFor(spec, 5).strokes).toHaveLength(4);
  });
});
