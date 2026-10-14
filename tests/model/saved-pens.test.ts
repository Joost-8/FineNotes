/** `src/model/saved-pens.ts` — saved pens and the pen last written with (FineNotes#24, #25). */

import { describe, expect, it } from "vitest";
import { FINE_PEN_MIN } from "../../src/model/pen-widths";
import {
  DEFAULT_SAVED_PENS,
  MAX_PEN_WIDTH,
  MAX_SAVED_PENS,
  type SavedPen,
  addSavedPen,
  defaultSavedPens,
  editSavedPen,
  isPenWidth,
  mmText,
  moveSavedPen,
  openingTool,
  removeSavedPen,
  samePen,
  savedPenIndex,
  savedPenLabel,
  savedPenOf,
  savedPensOf,
  widthFromMm,
} from "../../src/model/saved-pens";

const blue: SavedPen = { type: "ball", color: "#1971c2", size: 2 };
const red: SavedPen = { type: "fountain", color: "#e03131", size: 3 };
const marker: SavedPen = { type: "highlighter", color: "#fab005", size: 5 };

describe("the default saved pens", () => {
  it("are the issue's: 1 blue, 2 red, 3 green, 4 a broader blue, 8 a highlighter", () => {
    expect(DEFAULT_SAVED_PENS).toHaveLength(MAX_SAVED_PENS);
    expect(DEFAULT_SAVED_PENS[0].color).toBe("#1971c2");
    expect(DEFAULT_SAVED_PENS[1].color).toBe("#e03131");
    expect(DEFAULT_SAVED_PENS[2].color).toBe("#2f9e44");
    expect(DEFAULT_SAVED_PENS[3].color).toBe("#1971c2");
    expect(DEFAULT_SAVED_PENS[3].size).toBeGreaterThan(DEFAULT_SAVED_PENS[0].size);
    expect(DEFAULT_SAVED_PENS[7].type).toBe("highlighter");
  });

  it("are all valid pens, and every copy is a fresh one", () => {
    for (const pen of DEFAULT_SAVED_PENS) expect(savedPenOf(pen)).toEqual(pen);
    const copy = defaultSavedPens();
    expect(copy).toEqual(DEFAULT_SAVED_PENS);
    expect(copy[0]).not.toBe(DEFAULT_SAVED_PENS[0]);
  });
});

describe("savedPenOf", () => {
  it("reads a pen, its colour as #rrggbb", () => {
    expect(savedPenOf({ type: "brush", color: "#ABC", size: 4 })).toEqual({
      type: "brush",
      color: "#aabbcc",
      size: 4,
    });
  });

  it("refuses what is not a pen", () => {
    for (const value of [
      null,
      undefined,
      7,
      "pen",
      { type: "laser", color: "#000000", size: 2 },
      { type: "ball", color: "blue", size: 2 },
      { type: "ball", color: 3, size: 2 },
      { type: "ball", color: "#000000", size: "2" },
      { type: "ball", color: "#000000", size: Number.NaN },
      { type: "ball", color: "#000000", size: 0.5 },
      { type: "ball", color: "#000000", size: MAX_PEN_WIDTH + 1 },
    ]) {
      expect(savedPenOf(value)).toBeNull();
    }
  });
});

describe("savedPensOf", () => {
  it("gives the defaults for a vault from before saved pens", () => {
    expect(savedPensOf(undefined)).toEqual(DEFAULT_SAVED_PENS);
    expect(savedPensOf({})).toEqual(DEFAULT_SAVED_PENS);
  });

  it("keeps an empty list empty: the user deleted them", () => {
    expect(savedPensOf([])).toEqual([]);
  });

  it("leaves out what is not a pen, and stops at eight", () => {
    expect(savedPensOf([blue, "x", red])).toEqual([blue, red]);
    const many = Array.from({ length: 12 }, () => blue);
    expect(savedPensOf(many)).toHaveLength(MAX_SAVED_PENS);
  });
});

describe("editing the list", () => {
  it("adds a pen at the end, unless it is saved already or the list is full", () => {
    expect(addSavedPen([blue], red)).toEqual([blue, red]);
    expect(addSavedPen([blue], { ...blue, color: "#1971C2" })).toEqual([blue]);
    const full = Array.from({ length: MAX_SAVED_PENS }, (_, i) => ({ ...blue, size: 2 + i }));
    expect(addSavedPen(full, red)).toEqual(full);
  });

  it("removes, and moves up and down within the list", () => {
    expect(removeSavedPen([blue, red, marker], 1)).toEqual([blue, marker]);
    expect(moveSavedPen([blue, red, marker], 2, -1)).toEqual([blue, marker, red]);
    expect(moveSavedPen([blue, red, marker], 0, 1)).toEqual([red, blue, marker]);
    expect(moveSavedPen([blue, red], 0, -1)).toEqual([blue, red]);
    expect(moveSavedPen([blue, red], 1, 1)).toEqual([blue, red]);
    expect(moveSavedPen([blue, red], 5, -1)).toEqual([blue, red]);
  });

  it("edits one pen, as far as the edit makes a pen", () => {
    expect(editSavedPen([blue, red], 1, { color: "#000" })).toEqual([
      blue,
      { ...red, color: "#000000" },
    ]);
    expect(editSavedPen([blue], 0, { size: 0.01 })).toEqual([blue]);
  });

  it("finds a saved pen by what it draws", () => {
    expect(samePen(blue, { ...blue, size: 2.001 })).toBe(true);
    expect(samePen(blue, { ...blue, type: "fountain" })).toBe(false);
    expect(savedPenIndex([red, blue], { ...blue })).toBe(1);
    expect(savedPenIndex([red], blue)).toBe(-1);
  });
});

describe("widths in mm", () => {
  it("reads a typed width as page px, to a hundredth", () => {
    expect(widthFromMm("0.41")).toBe(2);
    expect(widthFromMm(" 0,41 mm ")).toBe(2);
    expect(widthFromMm("1MM")).toBe(4.88);
    expect(widthFromMm(".5")).toBe(2.44);
    expect(widthFromMm("2.")).toBe(9.75);
  });

  it("refuses what is not a width, or is out of range, rather than clamping it", () => {
    for (const text of ["", "abc", "-1", "0.1", "6", "1.2.3", "1 cm"]) {
      expect(widthFromMm(text)).toBeNull();
    }
    expect(isPenWidth(FINE_PEN_MIN)).toBe(true);
    expect(isPenWidth(MAX_PEN_WIDTH)).toBe(true);
  });

  it("shows a width as mm with two decimals, and names a pen by it", () => {
    expect(mmText(2)).toBe("0.41");
    expect(savedPenLabel(blue)).toBe("Ball pen, 0.41 mm");
    expect(savedPenLabel(marker)).toBe("Highlighter, 1.03 mm");
    expect(savedPenLabel({ ...red, type: "brush" })).toBe("Brush pen, 0.62 mm");
    expect(savedPenLabel(red)).toBe("Fountain pen, 0.62 mm");
  });
});

describe("openingTool", () => {
  it("opens with whichever of pen and highlighter was put down last", () => {
    expect(openingTool("pen", marker)).toBe("highlighter");
    expect(openingTool("highlighter", blue)).toBe("pen");
    expect(openingTool("pen", null)).toBe("pen");
  });

  it("keeps any other default tool", () => {
    expect(openingTool("eraser", marker)).toBe("eraser");
    expect(openingTool("select", blue)).toBe("select");
  });
});
