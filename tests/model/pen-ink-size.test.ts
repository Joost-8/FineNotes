/** `src/model/pen-inks.ts`: each pen type keeps its own width, as it keeps its colours. */

import { describe, expect, it } from "vitest";
import { penInkFor, penInksOf, switchPenInk, withPenInk } from "../../src/model/pen-inks";

describe("a pen type's width", () => {
  it("is kept by the pen being left and brought back by the pen picked", () => {
    const fine = { color: "#1a1a1a", size: 1.5 };
    // Fountain (1.5) to highlighter, never used: it starts with the width in hand.
    let step = switchPenInk({}, "fountain", "highlighter", fine);
    expect(step.ink.size).toBe(1.5);
    // The highlighter is made wide, then the fountain pen picked again.
    step = switchPenInk(step.inks, "highlighter", "fountain", { color: "#fab005", size: 6 });
    expect(step.ink).toEqual(fine);
    // And the highlighter is wide again.
    step = switchPenInk(step.inks, "fountain", "highlighter", fine);
    expect(step.ink).toEqual({ color: "#fab005", size: 6 });
  });

  it("an ink saved before widths were kept takes the width in hand", () => {
    const inks = { ball: { color: "#e03131" } };
    expect(penInkFor(inks, "ball", { color: "#000000", size: 2.5 })).toEqual({
      color: "#e03131",
      size: 2.5,
    });
    expect(penInkFor(inks, "ball", { color: "#000000" })).toEqual({ color: "#e03131" });
  });

  it("is stored with the ink and read back only when it is a positive number", () => {
    const inks = withPenInk({}, "brush", { color: "#1971c2", size: 4 });
    expect(inks.brush).toEqual({ color: "#1971c2", size: 4 });
    expect(penInksOf(JSON.parse(JSON.stringify(inks)))).toEqual(inks);
    expect(
      penInksOf({
        ball: { color: "#e03131", size: 0 },
        brush: { color: "#1971c2", size: -2 },
        fountain: { color: "#1a1a1a", size: "3" },
        highlighter: { color: "#fab005", size: Number.POSITIVE_INFINITY },
      }),
    ).toEqual({
      ball: { color: "#e03131" },
      brush: { color: "#1971c2" },
      fountain: { color: "#1a1a1a" },
      highlighter: { color: "#fab005" },
    });
  });
});
