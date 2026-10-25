import { describe, expect, it } from "vitest";
import {
  COMMON_COLORS,
  MAX_RECENT_COLORS,
  PEN_ROW_MAX,
  PEN_ROW_SIZE,
  colorAfterRemoving,
  penColorRow,
  pickPenColor,
  removablePenColor,
  removePenColor,
  reservedPenColors,
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

describe("the pen's colour row", () => {
  const fill = ["#1a1a1a", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5"];

  it("has five swatches: the settings' colours first, then the palette", () => {
    expect(PEN_ROW_SIZE).toBe(5);
    expect(penColorRow(["#1a1a1a"], undefined, fill)).toEqual([
      "#1a1a1a",
      "#e03131",
      "#1971c2",
      "#2f9e44",
      "#f08c00",
    ]);
    const reserved = reservedPenColors(["#1A1A1A", "#ff8800", "nope", "#ff8800"]);
    expect(reserved).toEqual(["#1a1a1a", "#ff8800"]);
    expect(penColorRow(reserved, undefined, fill)).toEqual([
      "#1a1a1a",
      "#ff8800",
      "#e03131",
      "#1971c2",
      "#2f9e44",
    ]);
  });

  it("reserves at most four, so a pick always has a slot", () => {
    const reserved = reservedPenColors(["#111111", "#222222", "#333333", "#444444", "#555555"]);
    expect(reserved).toHaveLength(4);
    const row = penColorRow(reserved, undefined, fill);
    expect(row).toEqual([...reserved, "#1a1a1a"]);
    expect(pickPenColor(row, 4, "#abcdef")).toEqual(["#1a1a1a", "#abcdef"]);
  });

  it("keeps a picked colour, and moves nothing for one already there", () => {
    const reserved = ["#1a1a1a"];
    let row = penColorRow(reserved, undefined, fill);
    const picked = pickPenColor(row, 1, "#ABCDEF");
    // A new colour joins the end of the row; nothing makes way for it.
    expect(picked).toEqual(["#e03131", "#1971c2", "#2f9e44", "#f08c00", "#abcdef"]);
    row = penColorRow(reserved, picked, fill);
    // Going back to black, then to the pick: both stay where they are.
    expect(pickPenColor(row, 1, "#1a1a1a")).toEqual(picked);
    expect(pickPenColor(row, 1, "#abcdef")).toEqual(picked);
    expect(pickPenColor(row, 1, "#e03131")).toEqual(picked);
    expect(pickPenColor(row, 1, "not a colour")).toEqual(picked);
  });

  it("puts a colour picked from a swatch in that swatch's place, but never a reserved one's", () => {
    const row = penColorRow(["#1a1a1a"], undefined, fill);
    expect(pickPenColor(row, 1, "#abcdef", "#1971c2")).toEqual([
      "#e03131",
      "#abcdef",
      "#2f9e44",
      "#f08c00",
    ]);
    // From a reserved swatch's picker the colour joins the end instead.
    expect(pickPenColor(row, 1, "#abcdef", "#1a1a1a")).toEqual([
      "#e03131",
      "#1971c2",
      "#2f9e44",
      "#f08c00",
      "#abcdef",
    ]);
  });

  it("grows to twenty-four colours and then keeps what it has", () => {
    expect(PEN_ROW_MAX).toBe(24);
    let row = penColorRow(["#1a1a1a"], undefined, fill);
    for (let i = 0; i < 30; i++) {
      const color = `#00${(16 + i).toString(16)}00`;
      row = ["#1a1a1a", ...pickPenColor(row, 1, color)];
    }
    expect(row).toHaveLength(24);
    // Five to start with, so the nineteenth new colour (0x10 + 18) filled it.
    expect(row[23]).toBe("#002200");
    // Full: a new colour is written with but not kept; a swatch still changes in place.
    expect(pickPenColor(row, 1, "#abcdef")).toEqual(row.slice(1));
    expect(pickPenColor(row, 1, "#abcdef", "#002200").at(-1)).toBe("#abcdef");
  });

  it("reads back a stored row however it was damaged, and does not top it up", () => {
    expect(penColorRow([], ["#abcdef", 7, "#ABCDEF", "x"], fill)).toEqual(["#abcdef"]);
    expect(penColorRow(["#1a1a1a"], [], fill)).toEqual(["#1a1a1a"]);
    expect(penColorRow([], "nope" as never, fill)).toHaveLength(5);
    const many = Array.from({ length: 30 }, (_, i) => `#0000${(i + 16).toString(16)}`);
    expect(penColorRow(["#1a1a1a"], many, fill)).toHaveLength(24);
  });

  it("reads a row stored before it grew exactly as it was shown", () => {
    // What the five-swatch row stored: its picked slots, always full.
    const old = ["#abcdef", "#e03131", "#1971c2", "#2f9e44"];
    expect(penColorRow(["#1a1a1a"], old, fill)).toEqual(["#1a1a1a", ...old]);
  });

  it("removes a picked colour, but never a reserved one", () => {
    const row = ["#1a1a1a", "#e03131", "#1971c2", "#2f9e44"];
    expect(removePenColor(row, 1, "#1971C2")).toEqual(["#e03131", "#2f9e44"]);
    expect(removePenColor(row, 1, "#1a1a1a")).toEqual(["#e03131", "#1971c2", "#2f9e44"]);
    expect(removePenColor(row, 1, "#abcdef")).toEqual(["#e03131", "#1971c2", "#2f9e44"]);
    expect(removablePenColor(row, 1, "#1971c2")).toBe(true);
    expect(removablePenColor(row, 1, "#1a1a1a")).toBe(false);
    expect(removablePenColor(row, 1, "#abcdef")).toBe(false);
  });

  it("writes with the swatch before a removed one, or after it when it was first", () => {
    const row = ["#1a1a1a", "#e03131", "#1971c2"];
    expect(colorAfterRemoving(row, "#1971c2")).toBe("#e03131");
    expect(colorAfterRemoving(row, "#1A1A1A")).toBe("#e03131");
    expect(colorAfterRemoving(["#e03131"], "#e03131")).toBeNull();
    expect(colorAfterRemoving(row, "#abcdef")).toBeNull();
  });
});
