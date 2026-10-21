import { describe, expect, it } from "vitest";
import {
  ROW_GAP_CLOSED_ZOOM,
  ROW_GAP_OPEN_ZOOM,
  ROW_PAGING_ZOOM,
  ROW_EDGE_TURN_PX,
  ROW_ZOOMED_GAP_PX,
  pullAddAllowed,
  rowEdgeTurn,
  rowGapAtZoom,
} from "../../src/canvas/page-layout";

// A landscape pane round a portrait page: a slot gap of 400 layout px.
const SLOT = 400;
const FLOOR = 1;
const BASE = 0.8;
const gap = (zoom: number): number => rowGapAtZoom(SLOT, zoom, FLOOR, BASE * zoom);

describe("rowGapAtZoom (FineNotes#34)", () => {
  it("keeps the slot gap, no neighbour in sight, up to the opening zoom", () => {
    expect(gap(1)).toBe(SLOT);
    expect(gap(ROW_PAGING_ZOOM)).toBe(SLOT);
    expect(gap(1.5)).toBe(SLOT);
    expect(gap(ROW_GAP_OPEN_ZOOM)).toBe(SLOT);
  });

  it("closes to a constant on-screen gap zoomed in", () => {
    for (const zoom of [ROW_GAP_CLOSED_ZOOM, 2, 3, 5]) {
      expect(gap(zoom) * BASE * zoom).toBeCloseTo(ROW_ZOOMED_GAP_PX, 6);
    }
  });

  it("narrows steadily in between, with no jump at either end", () => {
    let last = gap(ROW_GAP_OPEN_ZOOM);
    for (let zoom = ROW_GAP_OPEN_ZOOM; zoom <= ROW_GAP_CLOSED_ZOOM + 1e-9; zoom += 0.01) {
      const now = gap(zoom);
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      expect(last - now).toBeLessThan(SLOT * 0.1);
      last = now;
    }
    expect(gap(ROW_GAP_CLOSED_ZOOM + 1e-6)).toBeCloseTo(gap(ROW_GAP_CLOSED_ZOOM), 3);
  });

  it("never widens a slot narrower than the closed gap", () => {
    expect(rowGapAtZoom(10, 3, FLOOR, 0.5)).toBe(10);
  });

  it("falls back to the slot gap for nonsense input", () => {
    expect(rowGapAtZoom(SLOT, Number.NaN, FLOOR, 1)).toBe(SLOT);
    expect(rowGapAtZoom(SLOT, 2, 0, 1)).toBe(SLOT);
    expect(rowGapAtZoom(SLOT, 2, FLOOR, 0)).toBe(SLOT);
  });
});

describe("pullAddAllowed (pull a new page in, as Goodnotes)", () => {
  const pull = { pinched: false, along: -200, across: 20 };

  it("lets one finger pulled deliberately along the pages add a page", () => {
    expect(pullAddAllowed(pull)).toBe(true);
  });

  it("never reads a pinch as a pull, however it stretched the page", () => {
    expect(pullAddAllowed({ ...pull, pinched: true })).toBe(false);
  });

  it("refuses a drag that runs as much across the pages as along them", () => {
    expect(pullAddAllowed({ ...pull, along: -200, across: 120 })).toBe(false);
    expect(pullAddAllowed({ ...pull, along: -200, across: 100 })).toBe(true);
  });
});

describe("rowEdgeTurn (zoomed in, pull past the page's edge to turn it)", () => {
  it("turns on or back only past the threshold, and springs back short of it", () => {
    expect(rowEdgeTurn(1000 + ROW_EDGE_TURN_PX, 200, 1000)).toBe(1);
    expect(rowEdgeTurn(1000 + ROW_EDGE_TURN_PX - 1, 200, 1000)).toBe(0);
    expect(rowEdgeTurn(200 - ROW_EDGE_TURN_PX, 200, 1000)).toBe(-1);
    expect(rowEdgeTurn(200 - ROW_EDGE_TURN_PX + 1, 200, 1000)).toBe(0);
    expect(rowEdgeTurn(600, 200, 1000)).toBe(0);
  });
});
