import { describe, expect, it } from "vitest";
import { PAGE_MARGIN_Y } from "../../src/canvas/page-layout";
import { MIN_SCALE, anchorScrollDelta, fitPageZoom, nextZoomFloor } from "../../src/canvas/zoom";

describe("anchorScrollDelta keeps the point under the fingers still", () => {
  it("scrolls by the anchor's drift in layout px, times the new scale", () => {
    // After a zoom to 3x the layout point under the fingers moved 12 px left
    // and 4 px up of where it was: scroll 36 px left and 12 px up to undo it.
    expect(anchorScrollDelta({ x: 200, y: 50 }, { x: 212, y: 54 }, 3)).toEqual({ x: -36, y: -12 });
    expect(anchorScrollDelta({ x: -7.5, y: 1e6 }, { x: -7.5, y: 1e6 }, 0.25)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("is exact to the bit on random anchors", () => {
    let s = 99;
    const next = (): number => {
      s = (s * 48271) % 2147483647;
      return (s / 2147483647) * 4000 - 2000;
    };
    for (let i = 0; i < 500; i++) {
      const before = { x: next(), y: next() };
      const after = { x: next(), y: next() };
      const scale = Math.abs(next()) / 250;
      const delta = anchorScrollDelta(before, after, scale);
      expect(delta.x).toBe((before.x - after.x) * scale);
      expect(delta.y).toBe((before.y - after.y) * scale);
    }
  });
});

describe("fitPageZoom", () => {
  it("shrinks a page taller than the pane until it and its margins fit", () => {
    // Page 1448 layout px plus 24 px margin above and below, at base 0.8.
    const zoom = fitPageZoom(1448, 0.8, 596);
    expect(zoom).toBeCloseTo(596 / ((1448 + 2 * PAGE_MARGIN_Y) * 0.8), 10);
    expect((1448 + 2 * PAGE_MARGIN_Y) * 0.8 * zoom).toBeCloseTo(596, 6);
  });

  it("never magnifies past fit-to-width", () => {
    expect(fitPageZoom(400, 1, 2000)).toBe(1);
  });

  it("stops at the hard floor for a pane too short to fit the page", () => {
    expect(fitPageZoom(1448, 1, 40)).toBe(MIN_SCALE);
  });

  it("is 1 for degenerate input", () => {
    expect(fitPageZoom(0, 1, 596, 0)).toBe(1);
    expect(fitPageZoom(1448, 1, 0)).toBe(1);
    expect(fitPageZoom(Number.NaN, 1, 596)).toBe(1);
  });
});

describe("nextZoomFloor", () => {
  const base = { zoom: 0.6, floor: 0.6, initialised: true, keyboard: false };

  it("opens at the floor on the first layout", () => {
    expect(nextZoomFloor({ ...base, zoom: 1, initialised: false, newFloor: 0.5 })).toEqual({
      floor: 0.5,
      zoom: 0.5,
    });
  });

  it("keeps a view on the floor when the pane changes shape", () => {
    expect(nextZoomFloor({ ...base, newFloor: 0.8 })).toEqual({ floor: 0.8, zoom: 0.8 });
    expect(nextZoomFloor({ ...base, newFloor: 0.4 })).toEqual({ floor: 0.4, zoom: 0.4 });
  });

  it("leaves a zoomed-in view alone, and lifts one left below a new floor", () => {
    expect(nextZoomFloor({ ...base, zoom: 1.5, newFloor: 0.4 })).toEqual({
      floor: 0.4,
      zoom: 1.5,
    });
    expect(nextZoomFloor({ ...base, zoom: 0.7, newFloor: 0.8 })).toEqual({
      floor: 0.8,
      zoom: 0.8,
    });
  });

  // Joost's recording: at fit-to-page zoom, tapping a text box shrank the
  // page into the strip above the keyboard.
  it("holds floor and zoom while the keyboard makes the pane short", () => {
    const up = nextZoomFloor({ ...base, keyboard: true, newFloor: 0.2 });
    expect(up).toEqual({ floor: 0.6, zoom: 0.6 });
    // Keyboard down, pane back to full height: still on the floor.
    expect(nextZoomFloor({ ...base, ...up, newFloor: 0.6 })).toEqual({ floor: 0.6, zoom: 0.6 });
  });
});
