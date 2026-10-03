import { describe, expect, it } from "vitest";
import { REST_MS, ViewRest } from "../../src/view/view-rest";

const at = (x: number, y: number, zoom = 1) => ({ x, y, zoom });

describe("ViewRest", () => {
  it("counts the first frame as a move, then rests after REST_MS", () => {
    const rest = new ViewRest();
    expect(rest.moving(0)).toBe(false); // nothing seen yet
    expect(rest.note(at(0, 0), false, 1000)).toBe(true);
    expect(rest.moving(1000 + REST_MS - 1)).toBe(true);
    expect(rest.moving(1000 + REST_MS)).toBe(false);
  });

  it("sees a scroll, a zoom and a busy frame as moves, and a still frame as none", () => {
    const rest = new ViewRest();
    rest.note(at(0, 0), false, 0);
    expect(rest.note(at(0, 0), false, 500)).toBe(false);
    expect(rest.moving(500)).toBe(false);
    expect(rest.note(at(0, 12), false, 600)).toBe(true); // a wheel scroll
    expect(rest.note(at(0, 12, 2), false, 700)).toBe(true); // a zoom
    expect(rest.note(at(0, 12, 2), true, 800)).toBe(true); // a finger holding still
    expect(rest.moving(800 + REST_MS - 1)).toBe(true);
    expect(rest.note(at(0, 12, 2), false, 900)).toBe(false);
    expect(rest.moving(800 + REST_MS)).toBe(false);
  });

  it("keeps moving through a long fling, resting only after its last frame", () => {
    const rest = new ViewRest();
    let y = 0;
    for (let t = 0; t <= 3000; t += 16) rest.note(at(0, (y += 5)), false, t);
    expect(rest.moving(3000 + 100)).toBe(true);
    expect(rest.moving(2992 + REST_MS)).toBe(false);
  });

  it("does not keep a reference to the place it was given", () => {
    const rest = new ViewRest();
    const place = at(0, 0);
    rest.note(place, false, 0);
    place.y = 50;
    expect(rest.note(at(0, 0), false, 1000)).toBe(false);
  });
});
