import { describe, expect, it } from "vitest";
import { ERASER_SIZES, SIZES } from "../../src/constants";
import { ERASER_MAX_SIZE, ERASER_MIN_SIZE } from "../../src/model/eraser-sizes";
import { FINE_PEN_MIN } from "../../src/model/pen-widths";
import {
  DEFAULT_ERASER_PRESETS,
  DEFAULT_WIDTH_PRESETS,
  PRESET_COUNT,
  chosenSlot,
  eraserPresetsOf,
  presetsFor,
  widthPresetsOf,
  withEraserPreset,
  withWidthPreset,
  withoutWidthPresets,
} from "../../src/model/width-presets";

describe("defaults", () => {
  it("are the pill's old quick widths and the eraser's old sizes", () => {
    expect(DEFAULT_WIDTH_PRESETS).toEqual(SIZES.slice(0, 3));
    expect(DEFAULT_ERASER_PRESETS).toEqual([...ERASER_SIZES]);
    expect(DEFAULT_WIDTH_PRESETS).toHaveLength(PRESET_COUNT);
  });
});

describe("withWidthPreset", () => {
  it("changes only the chosen preset of the chosen pen type", () => {
    const after = withWidthPreset({}, "ball", 2, 9);
    expect(presetsFor(after, "ball")).toEqual([2, 3, 9]);
    expect(presetsFor(after, "fountain")).toEqual([...DEFAULT_WIDTH_PRESETS]);
    const again = withWidthPreset(after, "ball", 0, 1.5);
    expect(presetsFor(again, "ball")).toEqual([1.5, 3, 9]);
  });

  it("keeps the input unchanged", () => {
    const before = withWidthPreset({}, "brush", 1, 4);
    const snapshot = structuredClone(before);
    withWidthPreset(before, "brush", 1, 7);
    expect(before).toEqual(snapshot);
  });

  it("ignores a slot that is not one, or a width no pen has", () => {
    const base = withWidthPreset({}, "ball", 0, 4);
    for (const slot of [-1, 3, 1.5, Number.NaN]) {
      expect(withWidthPreset(base, "ball", slot, 6)).toEqual(base);
    }
    for (const width of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, 1000]) {
      expect(withWidthPreset(base, "ball", 1, width)).toEqual(base);
    }
  });

  it("keeps a preset made thinner than the slider's preset range (fine pens)", () => {
    expect(presetsFor(withWidthPreset({}, "ball", 0, FINE_PEN_MIN), "ball")[0]).toBe(FINE_PEN_MIN);
  });
});

describe("withoutWidthPresets", () => {
  it("puts one pen type back on the defaults and leaves the others", () => {
    const all = withWidthPreset(withWidthPreset({}, "ball", 0, 7), "highlighter", 2, 10);
    const reset = withoutWidthPresets(all, "ball");
    expect(presetsFor(reset, "ball")).toEqual([...DEFAULT_WIDTH_PRESETS]);
    expect(presetsFor(reset, "highlighter")).toEqual([2, 3, 10]);
    expect(presetsFor(all, "ball")).toEqual([7, 3, 5]);
  });
});

describe("widthPresetsOf", () => {
  it("round-trips what the toolbar stores", () => {
    const all = withWidthPreset(withWidthPreset({}, "fountain", 1, 4.5), "calligraphy", 0, 2.5);
    expect(widthPresetsOf(JSON.parse(JSON.stringify(all)))).toEqual(all);
  });

  it("reads settings from before presets as none (every type on the defaults)", () => {
    for (const raw of [undefined, null, 3, "x", [], [2, 3, 5]]) {
      expect(widthPresetsOf(raw)).toEqual({});
    }
  });

  it("drops unknown pen types and lists that are not three pen widths", () => {
    const read = widthPresetsOf({
      ball: [2, 3, 4],
      pencil: [1, 2, 3],
      brush: [2, 3],
      fountain: [2, "3", 4],
      highlighter: [2, 3, Number.NaN],
      calligraphy: [2, 3, 4, 5],
      toString: [2, 3, 4],
    });
    expect(read).toEqual({ ball: [2, 3, 4] });
  });
});

describe("eraserPresetsOf and withEraserPreset", () => {
  it("reads three sizes in the slider's range, else the defaults", () => {
    expect(eraserPresetsOf([8, 30, 90])).toEqual([8, 30, 90]);
    for (const raw of [
      undefined,
      [8, 30],
      [8, 30, 90, 100],
      [ERASER_MIN_SIZE - 1, 30, 90],
      [8, 30, ERASER_MAX_SIZE + 1],
      [8, "30", 90],
      {},
    ]) {
      expect(eraserPresetsOf(raw)).toEqual([...DEFAULT_ERASER_PRESETS]);
    }
  });

  it("changes only the chosen size, and refuses one the slider cannot reach", () => {
    const base = [...DEFAULT_ERASER_PRESETS];
    expect(withEraserPreset(base, 1, 40)).toEqual([10, 40, 48]);
    expect(base).toEqual([...DEFAULT_ERASER_PRESETS]);
    expect(withEraserPreset(base, 3, 40)).toEqual(base);
    expect(withEraserPreset(base, 0, ERASER_MAX_SIZE + 5)).toEqual(base);
  });
});

describe("chosenSlot", () => {
  it("is the preset holding the width", () => {
    expect(chosenSlot([2, 3, 5], 3)).toBe(1);
    expect(chosenSlot([2, 3, 5], 3.00001)).toBe(1);
  });

  it("is none when no preset holds the width (a saved pen's, say)", () => {
    expect(chosenSlot([2, 3, 5], 4)).toBeNull();
  });

  it("keeps the last pick when two presets hold the same width", () => {
    expect(chosenSlot([3, 3, 5], 3)).toBe(0);
    expect(chosenSlot([3, 3, 5], 3, 1)).toBe(1);
  });

  it("drops a hint that no longer holds the width, or is not a slot", () => {
    expect(chosenSlot([2, 3, 5], 5, 0)).toBe(2);
    expect(chosenSlot([2, 3, 5], 5, 7)).toBe(2);
  });
});
