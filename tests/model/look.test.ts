import { describe, expect, it } from "vitest";
import {
  LOOK_PALETTES,
  LOOK_STYLES,
  lookClasses,
  lookPaletteNames,
  lookPaletteOf,
  lookStyleNames,
  lookStyleOf,
  nextLook,
} from "../../src/model/look";

describe("lookClasses", () => {
  it("wears nothing for today's look", () => {
    expect(lookClasses("default", "obsidian")).toEqual([]);
  });

  it("wears one class each for a style and a palette", () => {
    expect(lookClasses("glass", "rose-pine")).toEqual([
      "finenotes-style-glass",
      "finenotes-palette-rose-pine",
    ]);
  });

  it("reads anything it does not know as the default, inherited names too", () => {
    expect(lookClasses("toString", 3)).toEqual([]);
    expect(lookClasses(undefined, "constructor")).toEqual([]);
    expect([lookStyleOf("nope"), lookPaletteOf(null)]).toEqual(["default", "obsidian"]);
  });
});

describe("nextLook", () => {
  it("steps through every id and wraps round", () => {
    const seen: string[] = [LOOK_STYLES[0]];
    for (let i = 1; i < LOOK_STYLES.length; i++) seen.push(nextLook(LOOK_STYLES, seen[i - 1]));
    expect(seen).toEqual([...LOOK_STYLES]);
    expect(nextLook(LOOK_STYLES, LOOK_STYLES[LOOK_STYLES.length - 1])).toBe(LOOK_STYLES[0]);
  });

  it("starts at the first for an unknown id", () => {
    expect(nextLook(LOOK_PALETTES, "nope")).toBe(LOOK_PALETTES[0]);
  });
});

describe("names", () => {
  it("names every style and palette, in their order", () => {
    expect(Object.keys(lookStyleNames())).toEqual([...LOOK_STYLES]);
    expect(Object.keys(lookPaletteNames())).toEqual([...LOOK_PALETTES]);
    expect(lookPaletteNames().obsidian).toBe("Match Obsidian");
    expect(new Set(Object.values(lookStyleNames())).size).toBe(LOOK_STYLES.length);
  });
});
