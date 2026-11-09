/** The pure parts of dragging a contents entry: which gap, and which level. */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { CONTENTS_INDENT_PX, draggedLevel, nearestContentsGap } =
  await import("../../src/view/contents-drag");

describe("nearestContentsGap", () => {
  const gaps = [
    { gap: 0, y: 100 },
    { gap: 2, y: 140 },
    { gap: 5, y: 300 },
  ];

  it("takes the closest", () => {
    expect(nearestContentsGap(gaps, 118)?.gap).toBe(0);
    expect(nearestContentsGap(gaps, 125)?.gap).toBe(2);
    expect(nearestContentsGap(gaps, 900)?.gap).toBe(5);
  });

  it("has nothing to pick from none", () => {
    expect(nearestContentsGap([], 10)).toBeNull();
  });
});

describe("draggedLevel", () => {
  it("stays put on a straight drag", () => {
    expect(draggedLevel(2, 3, { min: 1, max: 3 })).toBe(2);
  });

  it("changes a level per indent moved sideways", () => {
    expect(draggedLevel(1, CONTENTS_INDENT_PX, { min: 1, max: 3 })).toBe(2);
    expect(draggedLevel(3, -2 * CONTENTS_INDENT_PX, { min: 1, max: 3 })).toBe(1);
  });

  it("stays inside what the gap allows", () => {
    expect(draggedLevel(1, 500, { min: 1, max: 2 })).toBe(2);
    expect(draggedLevel(3, -500, { min: 2, max: 3 })).toBe(2);
  });
});
