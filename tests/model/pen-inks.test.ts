/** `src/model/pen-inks.ts`: each pen type's own colour and colour row. */

import { describe, expect, it } from "vitest";
import {
  FIRST_HIGHLIGHTER_COLOR,
  penInkFor,
  penInksOf,
  switchPenInk,
  withPenInk,
} from "../../src/model/pen-inks";

describe("switchPenInk", () => {
  it("keeps each pen's colour and row, and brings them back", () => {
    const blue = { color: "#1971c2", colors: ["#1971c2", "#e03131"] };
    // Fountain (blue) to brush: the brush, never used, starts with the fountain's ink.
    let step = switchPenInk({}, "fountain", "brush", blue);
    expect(step.ink).toEqual(blue);
    // The brush is made red, then the fountain pen picked again: blue comes back.
    const red = { color: "#e03131", colors: ["#e03131", "#2f9e44"] };
    step = switchPenInk(step.inks, "brush", "fountain", red);
    expect(step.ink).toEqual(blue);
    // And the brush is red again.
    step = switchPenInk(step.inks, "fountain", "brush", blue);
    expect(step.ink).toEqual(red);
  });

  it("starts a highlighter that was never used yellow, with the pen's row", () => {
    const step = switchPenInk({}, "ball", "highlighter", { color: "#1a1a1a", colors: ["#1a1a1a"] });
    expect(step.ink).toEqual({ color: FIRST_HIGHLIGHTER_COLOR, colors: ["#1a1a1a"] });
  });

  it("changes nothing for the same type", () => {
    const inks = { ball: { color: "#e03131" } };
    const current = { color: "#2f9e44" };
    expect(switchPenInk(inks, "ball", "ball", current)).toEqual({ inks, ink: current });
  });

  it("hands out copies, so changing one pen's row leaves the stored one alone", () => {
    const row = ["#1971c2"];
    const inks = withPenInk({}, "ball", { color: "#1971c2", colors: row });
    row.push("#e03131");
    expect(inks.ball?.colors).toEqual(["#1971c2"]);
    const ink = penInkFor(inks, "ball", { color: "#000000" });
    ink.colors?.push("#2f9e44");
    expect(inks.ball?.colors).toEqual(["#1971c2"]);
    expect(penInkFor({}, "brush", { color: "#9c36b5" })).toEqual({ color: "#9c36b5" });
  });
});

describe("penInksOf", () => {
  it("reads a stored value without trusting it", () => {
    expect(penInksOf(undefined)).toEqual({});
    expect(penInksOf("ball")).toEqual({});
    expect(penInksOf([{ color: "#fff" }])).toEqual({});
    expect(
      penInksOf({
        ball: { color: "#ABC", colors: ["#e03131", "nope", "#E03131", 7] },
        brush: { color: "not a colour" },
        fountain: null,
        highlighter: { color: "#fab005", colors: "#fab005" },
        toString: { color: "#000000" },
        laser: { color: "#ff0000" },
      }),
    ).toEqual({
      ball: { color: "#aabbcc", colors: ["#e03131"] },
      highlighter: { color: "#fab005" },
    });
  });

  it("keeps at most twenty-four colours in a row", () => {
    const many = Array.from({ length: 30 }, (_, i) => `#0000${(i + 16).toString(16)}`);
    expect(penInksOf({ ball: { color: "#000000", colors: many } }).ball?.colors).toHaveLength(24);
  });
});
