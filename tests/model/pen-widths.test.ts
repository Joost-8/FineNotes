/** `src/model/pen-widths.ts` — the stroke-width slider's stops (FineNotes#7). */

import { describe, expect, it } from "vitest";
import { SIZES } from "../../src/constants";
import {
  FINE_PEN_MIN,
  FINE_PEN_MIN_MM,
  chosenWidth,
  nearestStop,
  widthStops,
} from "../../src/model/pen-widths";
import { formatMm, pageToMm } from "../../src/model/units";

describe("widthStops", () => {
  it("reaches 0.2 mm for the pens, in 0.05 mm steps, then half px up to the widest preset", () => {
    const stops = widthStops(SIZES, true);
    expect(stops.slice(0, 4).map(formatMm)).toEqual(["0.20 mm", "0.25 mm", "0.30 mm", "0.35 mm"]);
    expect(stops[0]).toBe(FINE_PEN_MIN);
    expect(pageToMm(FINE_PEN_MIN)).toBeCloseTo(FINE_PEN_MIN_MM, 2);
    expect(stops.slice(4, 7)).toEqual([2, 2.5, 3]);
    expect(stops[stops.length - 1]).toBe(12);
  });

  it("starts at the thinnest preset for the highlighter", () => {
    const stops = widthStops(SIZES, false);
    expect(stops[0]).toBe(2);
    expect(stops).toHaveLength(21);
  });

  it("goes up, every stop thicker than the one before, and every preset is a stop", () => {
    const stops = widthStops(SIZES, true);
    for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    for (const preset of SIZES) expect(stops).toContain(preset);
  });

  it("keeps fine stops only below the thinnest preset", () => {
    expect(widthStops([1, 4], true)).toEqual([0.98, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  });
});

describe("nearestStop", () => {
  const stops = widthStops(SIZES, true);
  it("finds a stop, or the closest one to a width set elsewhere", () => {
    expect(stops[nearestStop(stops, 5)]).toBe(5);
    expect(stops[nearestStop(stops, 0.5)]).toBe(FINE_PEN_MIN);
    expect(stops[nearestStop(stops, 40)]).toBe(12);
    expect(stops[nearestStop(stops, 2.6)]).toBe(2.5);
  });
});

describe("chosenWidth", () => {
  it("keeps the highlighter at its thinnest preset when the pen went thinner", () => {
    expect(chosenWidth(FINE_PEN_MIN, 2)).toBe(2);
    expect(chosenWidth(5, 2)).toBe(5);
    expect(chosenWidth(FINE_PEN_MIN, 0)).toBe(FINE_PEN_MIN);
  });
});
