import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_COLOR,
  FOLDER_PALETTE,
  MAX_RECENT_COLORS,
  isHexColor,
  isPaletteColor,
  normalizeHex,
  pushFront,
  randomPaletteColor,
  typedHex,
} from "../../src/model/folder-colors";

describe("the palette", () => {
  it("has the five colours, in order", () => {
    expect(FOLDER_PALETTE.map((entry) => [entry.id, entry.color])).toEqual([
      ["rose", "#c4566f"],
      ["amber", "#c28a2c"],
      ["moss", "#6a8f57"],
      ["tide", "#3d8c99"],
      ["plum", "#8660a8"],
    ]);
    expect(DEFAULT_CUSTOM_COLOR).toBe("#3d8c99");
  });

  it("picks one of them at random", () => {
    expect(randomPaletteColor(() => 0)).toBe("#c4566f");
    expect(randomPaletteColor(() => 0.5)).toBe("#6a8f57");
    expect(randomPaletteColor(() => 0.999)).toBe("#8660a8");
    expect(isPaletteColor(randomPaletteColor())).toBe(true);
    expect(isPaletteColor("#123456")).toBe(false);
  });
});

describe("hex colours", () => {
  it("accepts #rgb and #rrggbb in either case, and nothing else", () => {
    for (const ok of ["#abc", "#ABC", "#a1B2c3", "#000000"]) expect(isHexColor(ok), ok).toBe(true);
    for (const bad of ["abc", "#abcd", "#abcde", "#ggg", "", "#", "rgb(1,2,3)", "#12345g"]) {
      expect(isHexColor(bad), bad).toBe(false);
    }
  });

  it("writes #rgb out in full, lower case, trimmed", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("  #3D8C99 ")).toBe("#3d8c99");
    expect(normalizeHex("#a1b2c3")).toBe("#a1b2c3");
    expect(normalizeHex("Red")).toBe("red");
  });

  it("gives back the # a person left out", () => {
    expect(typedHex("3d8c99")).toBe("#3d8c99");
    expect(typedHex(" #3d8c99 ")).toBe("#3d8c99");
    expect(isHexColor(typedHex("3d8"))).toBe(true);
  });
});

describe("pushFront", () => {
  it("puts a value first, once, within the limit", () => {
    expect(pushFront(["a", "b", "c"], "b", 6)).toEqual(["b", "a", "c"]);
    expect(pushFront(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
    expect(pushFront([], "a", MAX_RECENT_COLORS)).toEqual(["a"]);
  });

  it("does not change the list it was given", () => {
    const list = ["a"];
    pushFront(list, "b", 5);
    expect(list).toEqual(["a"]);
  });
});
