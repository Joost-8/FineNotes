/** `src/model/saved-pens.ts` — saved pens and the pen last written with (FineNotes#24, #25). */

import { describe, expect, it, vi } from "vitest";
import { FINE_PEN_MIN, widthStops } from "../../src/model/pen-widths";
import { SIZES } from "../../src/constants";
import {
  DEFAULT_SAVED_PENS,
  HIGHLIGHTER_MIN_WIDTH,
  MAX_PEN_WIDTH,
  MAX_SAVED_PENS,
  SAMPLE_MAX_THICKNESS,
  SAVED_PEN_NAMES,
  SAVED_PEN_SCALE,
  defaultWidthText,
  SAVED_PEN_TYPES,
  type SavedPen,
  addSavedPen,
  defaultSavedPens,
  duplicateIndex,
  editSavedPen,
  isPenWidth,
  laidWidth,
  mmText,
  moveSavedPen,
  newPenDraft,
  openingTool,
  putSavedPen,
  removeSavedPen,
  samePen,
  sampleThickness,
  savedPenIndex,
  savedPenLabel,
  savedPenOf,
  savedPensOf,
  widthFromMm,
  withPenType,
} from "../../src/model/saved-pens";

// Only to read the toolbar's pen types, which the multipliers here must match.
vi.mock("obsidian", () => import("../view/fake-obsidian"));

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

  it("shows a width as mm with two decimals, and names a pen by its ink's width", () => {
    expect(mmText(2)).toBe("0.41");
    expect(savedPenLabel(blue)).toBe("Ball pen, 0.41 mm");
    // A highlighter set to 5 draws a 20 page px band.
    expect(savedPenLabel(marker)).toBe("Highlighter, 4.10 mm");
    expect(savedPenLabel({ ...red, type: "brush" })).toBe("Brush pen, 1.11 mm");
    expect(savedPenLabel(red)).toBe("Fountain pen, 0.62 mm");
  });

  it("reads and shows the ink's width through a pen type's multiplier, storing the width before it", () => {
    expect(mmText(5, SAVED_PEN_SCALE.highlighter)).toBe("4.10");
    // Typing 4 mm for a highlighter sets the width whose band is 4 mm.
    const width = widthFromMm("4", SAVED_PEN_SCALE.highlighter);
    expect(width).toBe(4.88);
    expect(mmText(width ?? 0, SAVED_PEN_SCALE.highlighter)).toBe("4.00");
    expect(widthFromMm("1.11", SAVED_PEN_SCALE.brush)).toBe(3);
    expect(widthFromMm("1", SAVED_PEN_SCALE.calligraphy)).toBe(1.88);
    // The range is the stored width's: a 20 mm highlighter is a 5 mm width.
    expect(widthFromMm("20", SAVED_PEN_SCALE.highlighter)).toBe(MAX_PEN_WIDTH);
    expect(widthFromMm("21", SAVED_PEN_SCALE.highlighter)).toBeNull();
    expect(widthFromMm("1", 0)).toBeNull();
    // Every stop the slider has reads back as itself, at every multiplier.
    for (const scale of Object.values(SAVED_PEN_SCALE)) {
      for (const stop of widthStops(SIZES, true)) {
        expect(widthFromMm(mmText(stop, scale), scale)).toBe(stop);
      }
    }
  });
});

describe("defaultWidthText", () => {
  it("names the opening width by the ink it lays down with the opening tool", () => {
    expect(defaultWidthText("pen", 3)).toBe("0.62 mm");
    expect(defaultWidthText("highlighter", 3)).toBe("2.5 mm");
    // A highlighter is never thinner than its thinnest preset.
    expect(defaultWidthText("highlighter", 1)).toBe("1.6 mm");
    expect(defaultWidthText("eraser", 3)).toBe("0.62 mm");
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

describe("a pen's width on the page and in its sample (the settings' pen rows)", () => {
  it("names and scales each type as the toolbar's pen menu does", async () => {
    const { PEN_TYPES, strokeWidthFor } = await import("../../src/view/toolbar");
    expect(PEN_TYPES.map((spec) => spec.id)).toEqual([...SAVED_PEN_TYPES]);
    for (const spec of PEN_TYPES) {
      expect(SAVED_PEN_NAMES[spec.id]).toBe(spec.label);
      expect(SAVED_PEN_SCALE[spec.id]).toBe(spec.sizeScale);
      for (const size of [FINE_PEN_MIN, 1.22, 2, 5, 12, MAX_PEN_WIDTH]) {
        const tool = spec.id === "highlighter" ? "highlighter" : "pen";
        const state = { tool, penType: spec.id, size, color: "#000000" } as never;
        expect(laidWidth({ type: spec.id, color: "#000000", size })).toBeCloseTo(
          strokeWidthFor(state),
          9,
        );
      }
    }
  });

  it("lays a highlighter down at least at its thinnest preset, times four", () => {
    expect(laidWidth({ ...marker, size: 1 })).toBe(HIGHLIGHTER_MIN_WIDTH * 4);
    expect(laidWidth(marker)).toBe(20);
    expect(laidWidth(blue)).toBe(2);
    expect(laidWidth({ ...blue, type: "calligraphy" })).toBeCloseTo(5.2, 9);
  });

  it("draws every sample at one scale, the widest pen filling the strip", () => {
    const widest: SavedPen = { type: "ball", color: "#000000", size: MAX_PEN_WIDTH };
    expect(sampleThickness(widest)).toBe(SAMPLE_MAX_THICKNESS);
    // A pen twice as wide draws twice as thick.
    expect(sampleThickness({ ...blue, size: 4 })).toBeCloseTo(2 * sampleThickness(blue), 1);
    expect(sampleThickness(red)).toBeGreaterThan(sampleThickness(blue));
    expect(sampleThickness(marker)).toBeGreaterThan(sampleThickness({ ...marker, type: "ball" }));
  });

  it("never draws a sample under 1 px, nor past the strip", () => {
    expect(sampleThickness({ ...blue, size: FINE_PEN_MIN })).toBe(1);
    expect(sampleThickness({ ...marker, size: MAX_PEN_WIDTH })).toBe(SAMPLE_MAX_THICKNESS);
  });
});

describe("making and changing a saved pen (the pen dialog)", () => {
  it("raises a pen turned into a highlighter to the highlighter's thinnest width", () => {
    expect(withPenType({ ...blue, size: 1 }, "highlighter")).toEqual({
      type: "highlighter",
      color: blue.color,
      size: HIGHLIGHTER_MIN_WIDTH,
    });
    expect(withPenType({ ...marker, size: 8 }, "highlighter").size).toBe(8);
    expect(withPenType({ ...blue, size: 1 }, "fountain")).toEqual({
      ...blue,
      size: 1,
      type: "fountain",
    });
  });

  it("finds another saved pen that draws the same, but not the one being changed", () => {
    const pens = [blue, red, marker];
    expect(duplicateIndex(pens, { ...red, color: "#E03131" }, -1)).toBe(1);
    expect(duplicateIndex(pens, red, 1)).toBe(-1);
    expect(duplicateIndex(pens, { ...red, size: 4 }, -1)).toBe(-1);
  });

  it("adds a new pen at the end, unless the list is full or it is saved already", () => {
    expect(putSavedPen([blue], red, null)).toEqual([blue, red]);
    expect(putSavedPen([blue, red], { ...red }, null)).toBeNull();
    expect(putSavedPen(defaultSavedPens(), { ...red, size: 4 }, null)).toBeNull();
  });

  it("puts a changed pen in its own place", () => {
    const pens = [blue, red, marker];
    const changed = putSavedPen(pens, { ...red, color: "#2F9E44" }, 1);
    expect(changed).toEqual([blue, { ...red, color: "#2f9e44" }, marker]);
    // Unchanged is fine; turning it into another saved pen is not.
    expect(putSavedPen(pens, red, 1)).toEqual(pens);
    expect(putSavedPen(pens, blue, 1)).toBeNull();
  });

  it("refuses a place that holds no pen, and what is not a pen", () => {
    expect(putSavedPen([blue], red, 1)).toBeNull();
    expect(putSavedPen([blue], red, -1)).toBeNull();
    expect(putSavedPen([blue], { ...red, size: 999 }, null)).toBeNull();
    expect(putSavedPen([blue], { ...red, color: "red" }, 0)).toBeNull();
  });

  it("starts a new pen as the pen last written with, or a black ball pen", () => {
    expect(newPenDraft(red)).toEqual(red);
    expect(newPenDraft(undefined)).toEqual({ type: "ball", color: "#1a1a1a", size: 2 });
    expect(newPenDraft({ type: "quill" })).toEqual({ type: "ball", color: "#1a1a1a", size: 2 });
  });
});
