/**
 * Dragging a saved pen to a new place in its list (`src/view/row-drag-model.ts`,
 * FineNotes#211): the place it lands, how the rows it passes step aside, and
 * the order that results.
 */

import { describe, expect, it } from "vitest";
import { moveTo, rowShift, rowSlotAt } from "../../src/view/row-drag-model";

const centres = [20, 60, 100, 140];

describe("rowSlotAt", () => {
  it("stays put until the row passes a neighbour's centre", () => {
    expect(rowSlotAt(centres, 1, 50)).toBe(1);
    expect(rowSlotAt(centres, 1, 99)).toBe(1);
    expect(rowSlotAt(centres, 1, 101)).toBe(2);
    expect(rowSlotAt(centres, 1, 19)).toBe(0);
  });

  it("reaches either end and no further", () => {
    expect(rowSlotAt(centres, 0, 999)).toBe(3);
    expect(rowSlotAt(centres, 3, -999)).toBe(0);
  });
});

describe("rowShift", () => {
  it("moves the passed rows up when dragging down, down when dragging up", () => {
    expect([0, 1, 2, 3].map((i) => rowShift(i, 0, 2, 40))).toEqual([0, -40, -40, 0]);
    expect([0, 1, 2, 3].map((i) => rowShift(i, 3, 1, 40))).toEqual([0, 40, 40, 0]);
    expect([0, 1, 2, 3].map((i) => rowShift(i, 2, 2, 40))).toEqual([0, 0, 0, 0]);
  });
});

describe("moveTo", () => {
  it("takes the row out and puts it in at its new place", () => {
    expect(moveTo(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("leaves the list as it was for no move or a place out of range", () => {
    const list = ["a", "b"];
    expect(moveTo(list, 1, 1)).toEqual(list);
    expect(moveTo(list, 0, 5)).toEqual(list);
    expect(moveTo(list, -1, 0)).toEqual(list);
    expect(moveTo(list, 0, 1)).not.toBe(list);
  });

  it("agrees with where the rows stepped aside to", () => {
    // Every row ends where its resting place plus its shift puts it.
    const from = 0;
    const to = rowSlotAt(centres, from, 130);
    const after = moveTo([0, 1, 2, 3], from, to);
    for (const i of [1, 2, 3]) {
      const landed = centres[i] + rowShift(i, from, to, 40);
      expect(centres[after.indexOf(i)]).toBe(landed);
    }
  });
});
