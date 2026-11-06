import { describe, expect, it } from "vitest";
import {
  anchorOf,
  dragCorner,
  dragSide,
  dragTurnedSide,
  isDrag,
  onTurnedBox,
  turnAboutMiddle,
  turnVec,
  turnedBounds,
  turnedPoint,
  unturnedPoint,
} from "../../src/canvas/text-box-handles";

const box = { x: 100, y: 200, w: 300, h: 60 };

describe("dragSide", () => {
  it("the right pill moves the right edge only", () => {
    expect(dragSide(box, "e", 50, 1024, 80)).toEqual({ x: 100, w: 350 });
  });

  it("the left pill moves the left edge and keeps the right one", () => {
    expect(dragSide(box, "w", -40, 1024, 80)).toEqual({ x: 60, w: 340 });
    expect(dragSide(box, "w", 40, 1024, 80)).toEqual({ x: 140, w: 260 });
  });

  it("never narrower than the minimum, from either side", () => {
    expect(dragSide(box, "e", -1000, 1024, 80).w).toBe(80);
    const left = dragSide(box, "w", 1000, 1024, 80);
    expect(left.w).toBe(80);
    expect(left.x + left.w).toBe(400);
  });

  it("never past the page's edges", () => {
    expect(dragSide(box, "e", 5000, 1024, 80).w).toBe(924);
    expect(dragSide(box, "w", -5000, 1024, 80)).toEqual({ x: 0, w: 400 });
  });

  it("a box already under the minimum keeps its width instead of jumping", () => {
    const small = { x: 10, w: 40 };
    expect(dragSide(small, "e", 0, 1024, 80).w).toBe(40);
    expect(dragSide(small, "w", 0, 1024, 80)).toEqual({ x: 10, w: 40 });
  });
});

describe("dragCorner", () => {
  const scale = (corner: "nw" | "ne" | "sw" | "se", dx: number, dy: number, font = 20) =>
    dragCorner(box, corner, dx, dy, font, 12, 400, 1024, 1448);

  it("scales about the opposite corner", () => {
    expect(anchorOf(box, "se")).toEqual({ x: 100, y: 200 });
    expect(anchorOf(box, "nw")).toEqual({ x: 400, y: 260 });
    expect(anchorOf(box, "ne")).toEqual({ x: 100, y: 260 });
    expect(anchorOf(box, "sw")).toEqual({ x: 400, y: 200 });
  });

  it("dragging the corner along its diagonal doubles the box", () => {
    expect(scale("se", 300, 60).k).toBeCloseTo(2);
    // Up and left it meets the page's left edge first: 400 / 300.
    expect(scale("nw", -60, -12).k).toBeCloseTo(1.2);
    expect(scale("nw", -300, -60).k).toBeCloseTo(400 / 300);
  });

  it("dragging inward shrinks it", () => {
    expect(scale("se", -150, -30).k).toBeCloseTo(0.6);
  });

  it("no travel is no change", () => {
    expect(scale("ne", 0, 0).k).toBe(1);
  });

  it("travel across the diagonal does nothing", () => {
    // Perpendicular to (300, 60) is (-60, 300).
    expect(scale("se", -60, 300).k).toBeCloseTo(1);
  });

  it("the font stays within the text sizes", () => {
    expect(scale("se", -10_000, -10_000).k).toBeCloseTo(12 / 20);
    const big = dragCorner(box, "se", 1e6, 1e6, 300, 12, 400, 1e7, 1e7);
    expect(big.k).toBeCloseTo(400 / 300);
  });

  it("the box stays on the page", () => {
    const { k, ax } = scale("se", 5000, 1000);
    expect(ax + box.w * k).toBeLessThanOrEqual(1024 + 1e-9);
    const nw = scale("nw", -5000, -1000);
    expect(anchorOf(box, "nw").x - box.w * nw.k).toBeGreaterThanOrEqual(-1e-9);
  });

  it("a box already past the page can still shrink, never grow", () => {
    const off = { x: 900, y: 10, w: 300, h: 60 };
    const r = dragCorner(off, "se", 100, 20, 20, 12, 400, 1024, 1448);
    expect(r.k).toBe(1);
    expect(dragCorner(off, "se", -100, -20, 20, 12, 400, 1024, 1448).k).toBeLessThan(1);
  });

  it("a degenerate box does not produce NaN", () => {
    const flat = { x: 0, y: 0, w: 0, h: 0 };
    expect(dragCorner(flat, "se", 10, 10, 20, 12, 400, 1024, 1448).k).toBe(1);
  });
});

describe("isDrag", () => {
  it("is a tap inside the slop and a drag past it", () => {
    expect(isDrag(3, 4, 8)).toBe(false);
    expect(isDrag(6, 6, 8)).toBe(true);
  });
});

describe("a turned box", () => {
  const f = { x: 100, y: 100, w: 200, h: 40 };
  const quarter = Math.PI / 2;

  it("turns about its top-left corner", () => {
    const p = turnedPoint(f, quarter, 300, 100);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(300);
    const back = unturnedPoint(f, quarter, p);
    expect(back.x).toBeCloseTo(300);
    expect(back.y).toBeCloseTo(100);
  });

  it("is hit on the turned box only", () => {
    expect(onTurnedBox(f, quarter, { x: 90, y: 200 })).toBe(true);
    expect(onTurnedBox(f, quarter, { x: 200, y: 110 })).toBe(false);
    expect(onTurnedBox(f, 0, { x: 200, y: 110 })).toBe(true);
  });

  it("covers the upright box around it", () => {
    const b = turnedBounds(f, quarter);
    expect(b.x).toBeCloseTo(60);
    expect(b.y).toBeCloseTo(100);
    expect(b.w).toBeCloseTo(40);
    expect(b.h).toBeCloseTo(200);
    expect(turnedBounds(f, 0)).toEqual(f);
  });

  it("turned about its middle by the knob, the middle stays put", () => {
    const corner = turnAboutMiddle(f, 0.8);
    const mid = turnedPoint({ ...f, ...corner }, 0.8, corner.x + f.w / 2, corner.y + f.h / 2);
    expect(mid.x).toBeCloseTo(200);
    expect(mid.y).toBeCloseTo(120);
  });

  it("widened from either side, the other edge stays where it was on the page", () => {
    const r = 0.6;
    const rightEdge = turnedPoint(f, r, f.x + f.w, f.y);
    const left = dragTurnedSide(f, r, "w", -30 * Math.cos(r), -30 * Math.sin(r), 1024, 80);
    expect(left.w).toBeCloseTo(230);
    const after = turnedPoint({ ...f, ...left }, r, left.x + left.w, left.y);
    expect(after.x).toBeCloseTo(rightEdge.x);
    expect(after.y).toBeCloseTo(rightEdge.y);
    const right = dragTurnedSide(f, r, "e", 50 * Math.cos(r), 50 * Math.sin(r), 1024, 80);
    expect(right).toMatchObject({ x: 100, y: 100 });
    expect(right.w).toBeCloseTo(250);
  });

  it("only travel along the box's own axis widens it", () => {
    const r = Math.PI / 2;
    // Down the page is along the box's width once it is a quarter turned.
    expect(dragTurnedSide(f, r, "e", 0, 40, 1024, 80).w).toBeCloseTo(240);
    expect(dragTurnedSide(f, r, "e", 40, 0, 1024, 80).w).toBeCloseTo(200);
  });

  it("a vector turns clockwise on the page", () => {
    const v = turnVec(1, 0, Math.PI / 2);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });
});
