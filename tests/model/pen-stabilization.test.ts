import { describe, expect, it } from "vitest";
import {
  penStabilizationOf,
  stabilizationOf,
  withStabilization,
} from "../../src/model/pen-stabilization";

describe("penStabilizationOf", () => {
  it("reads nothing from settings written before it existed, or broken ones", () => {
    for (const raw of [undefined, null, 5, "20", [], [20]]) {
      expect(penStabilizationOf(raw)).toEqual({});
    }
  });

  it("keeps the known pens, whole percent 1-100", () => {
    expect(penStabilizationOf({ ball: 10, fountain: 22.6, highlighter: 100 })).toEqual({
      ball: 10,
      fountain: 23,
      highlighter: 100,
    });
  });

  it("drops unknown pens and values that are not numbers; holds the rest to 0-100", () => {
    expect(
      penStabilizationOf({
        pencil: 30,
        ball: "10",
        brush: Number.NaN,
        calligraphy: 250,
        fountain: -4,
      }),
    ).toEqual({ calligraphy: 100 });
  });

  it("does not read inherited keys", () => {
    expect(penStabilizationOf(Object.create({ ball: 30 }))).toEqual({});
  });
});

describe("stabilizationOf", () => {
  it("is 0 for a pen never set, or without any settings", () => {
    expect(stabilizationOf(undefined, "ball")).toBe(0);
    expect(stabilizationOf({ fountain: 20 }, "ball")).toBe(0);
    expect(stabilizationOf({ fountain: 20 }, "fountain")).toBe(20);
  });
});

describe("withStabilization", () => {
  it("sets one pen and leaves the others, without changing what it was given", () => {
    const before = { ball: 10 };
    expect(withStabilization(before, "fountain", 20)).toEqual({ ball: 10, fountain: 20 });
    expect(before).toEqual({ ball: 10 });
  });

  it("leaves a pen out at 0%, the default", () => {
    expect(withStabilization({ ball: 10, brush: 5 }, "ball", 0)).toEqual({ brush: 5 });
    expect(withStabilization(undefined, "ball", -3)).toEqual({});
  });

  it("holds a value to 0-100, whole", () => {
    expect(withStabilization({}, "brush", 140)).toEqual({ brush: 100 });
    expect(withStabilization({}, "brush", 7.4)).toEqual({ brush: 7 });
    expect(withStabilization({ brush: 7 }, "brush", Number.NaN)).toEqual({});
  });
});
