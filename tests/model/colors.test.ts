import { describe, expect, it } from "vitest";
import {
  COMMON_COLORS,
  MAX_RECENT_COLORS,
  hexToRgb,
  parseHexColor,
  pushRecentColor,
  recentColorsOf,
  rgbToHex,
  sameColor,
  contrastMark,
  hsvToRgb,
  rgbToHsv,
} from "../../src/model/colors";

describe("parseHexColor", () => {
  it("reads the ways a colour is typed", () => {
    expect(parseHexColor("#AABBCC")).toBe("#aabbcc");
    expect(parseHexColor("aabbcc")).toBe("#aabbcc");
    expect(parseHexColor("  #abc ")).toBe("#aabbcc");
    expect(parseHexColor("F80")).toBe("#ff8800");
  });

  it("refuses anything else", () => {
    for (const bad of ["", "#", "#abcd", "#ggg000", "red", "#aabbccdd", "12345"]) {
      expect(parseHexColor(bad), bad).toBeNull();
    }
  });
});

describe("hex and rgb", () => {
  it("round-trip", () => {
    expect(hexToRgb("#1971c2")).toEqual({ r: 25, g: 113, b: 194 });
    expect(rgbToHex({ r: 25, g: 113, b: 194 })).toBe("#1971c2");
    for (const color of COMMON_COLORS) expect(rgbToHex(hexToRgb(color)!)).toBe(color);
  });

  it("rounds and clamps channels, and reads nonsense as 0", () => {
    expect(rgbToHex({ r: 300, g: -5, b: 127.6 })).toBe("#ff0080");
    expect(rgbToHex({ r: Number.NaN, g: Infinity, b: 0 })).toBe("#000000");
    expect(hexToRgb("nope")).toBeNull();
  });
});

describe("recent colours", () => {
  it("puts a new custom colour first, without repeats", () => {
    expect(pushRecentColor(["#123456", "#abcdef"], "#ABCDEF")).toEqual(["#abcdef", "#123456"]);
  });

  it("keeps at most the maximum", () => {
    let recent: string[] = [];
    for (let i = 0; i < 12; i++) recent = pushRecentColor(recent, rgbToHex({ r: i, g: 1, b: 2 }));
    expect(recent).toHaveLength(MAX_RECENT_COLORS);
    expect(recent[0]).toBe(rgbToHex({ r: 11, g: 1, b: 2 }));
  });

  it("does not record a palette colour or an unreadable one", () => {
    expect(pushRecentColor(["#123456"], COMMON_COLORS[3])).toEqual(["#123456"]);
    expect(pushRecentColor(["#123456"], "bogus")).toEqual(["#123456"]);
  });

  it("cleans what was stored", () => {
    expect(recentColorsOf(["#ABC", "#aabbcc", 7, "x", "#123456"])).toEqual(["#aabbcc", "#123456"]);
    expect(recentColorsOf("nope")).toEqual([]);
    expect(
      recentColorsOf(Array.from({ length: 20 }, (_, i) => rgbToHex({ r: i, g: 0, b: 0 }))),
    ).toHaveLength(MAX_RECENT_COLORS);
  });
});

describe("sameColor", () => {
  it("compares however each is written", () => {
    expect(sameColor("#ABC", "#aabbcc")).toBe(true);
    expect(sameColor("#aabbcc", "#aabbcd")).toBe(false);
    expect(sameColor(null, null)).toBe(true);
    expect(sameColor(null, "#000000")).toBe(false);
    expect(sameColor("bogus", "bogus")).toBe(false);
  });
});

describe("COMMON_COLORS", () => {
  it("are all distinct, readable #rrggbb", () => {
    expect(new Set(COMMON_COLORS).size).toBe(COMMON_COLORS.length);
    for (const color of COMMON_COLORS) expect(parseHexColor(color)).toBe(color);
  });
});

describe("contrastMark", () => {
  it("puts a dark mark on light colours and a white one on dark colours", () => {
    for (const light of ["#ffffff", "#ffff00", "#f5d76e", "#a8e6a3", "#ffb3c6"]) {
      expect(contrastMark(light)).toBe("#1a1a1a");
    }
    for (const dark of ["#000000", "#1a1a1a", "#0a60ff", "#b00020", "#6a2c91"]) {
      expect(contrastMark(dark)).toBe("#ffffff");
    }
  });

  it("reads any spelling, and falls back to dark for nonsense", () => {
    expect(contrastMark("FFF")).toBe("#1a1a1a");
    expect(contrastMark("not a colour")).toBe("#1a1a1a");
  });
});

describe("hsv", () => {
  it("reads the primaries, black, white and grey", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 1 });
    const grey = rgbToHsv({ r: 128, g: 128, b: 128 });
    expect(grey.h).toBe(0);
    expect(grey.s).toBe(0);
    expect(grey.v).toBeCloseTo(128 / 255, 10);
  });

  it("gives a hue between 0 and 360 on every side of the wheel", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 128 }).h).toBeCloseTo(330, 0);
    expect(rgbToHsv({ r: 255, g: 128, b: 0 }).h).toBeCloseTo(30, 0);
  });

  it("round-trips every common colour", () => {
    for (const color of COMMON_COLORS) {
      const rgb = hexToRgb(color);
      expect(rgb, color).not.toBeNull();
      if (!rgb) continue;
      expect(rgbToHex(hsvToRgb(rgbToHsv(rgb))), color).toBe(color);
    }
  });

  it("wraps the hue and clamps the rest", () => {
    expect(rgbToHex(hsvToRgb({ h: 360, s: 1, v: 1 }))).toBe("#ff0000");
    expect(rgbToHex(hsvToRgb({ h: -120, s: 1, v: 1 }))).toBe("#0000ff");
    expect(rgbToHex(hsvToRgb({ h: 120, s: 2, v: 1.5 }))).toBe("#00ff00");
    expect(rgbToHex(hsvToRgb({ h: 60, s: -1, v: 1 }))).toBe("#ffffff");
  });

  it("counts anything not a number as 0", () => {
    expect(rgbToHex(hsvToRgb({ h: Number.NaN, s: 1, v: 1 }))).toBe("#ff0000");
    expect(rgbToHex(hsvToRgb({ h: 0, s: Number.NaN, v: 1 }))).toBe("#ffffff");
    expect(rgbToHex(hsvToRgb({ h: 0, s: 1, v: Number.POSITIVE_INFINITY }))).toBe("#000000");
    expect(rgbToHsv({ r: Number.NaN, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
  });
});
