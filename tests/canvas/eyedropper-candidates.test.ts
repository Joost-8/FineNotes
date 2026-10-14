/**
 * `src/canvas/eyedropper.ts`: everything under the tap that stores a colour
 * (a text box's border, text and fill, ink of any pen), and which of them
 * the pixels there say the user is pointing at.
 */

import { describe, expect, it } from "vitest";
import {
  type EyedropTextBox,
  nearestStored,
  storedColor,
  textBoxCandidates,
} from "../../src/canvas/eyedropper";

const box = (extra: Partial<EyedropTextBox> = {}): EyedropTextBox => ({
  text: "Hello",
  color: "#1a1a1a",
  x: 100,
  y: 100,
  w: 200,
  h: 80,
  ...extra,
});

describe("storedColor", () => {
  it("reads #rgb, #rrggbb and a fill's #rrggbbaa with its opacity", () => {
    expect(storedColor("#ABC")).toEqual({ color: "#aabbcc", alpha: 1 });
    expect(storedColor("#e03131")).toEqual({ color: "#e03131", alpha: 1 });
    const fill = storedColor("#ff000066");
    expect(fill?.color).toBe("#ff0000");
    expect(fill?.alpha).toBeCloseTo(0.4, 2);
    expect(storedColor("nope")).toBeNull();
  });
});

describe("textBoxCandidates", () => {
  it("offers the text's colour, then the fill, inside the box", () => {
    const filled = box({ fill: "#fff3bf" });
    expect(textBoxCandidates(filled, { x: 200, y: 140 }, 2)).toEqual([
      { color: "#1a1a1a" },
      { color: "#fff3bf" },
    ]);
    expect(textBoxCandidates(box({ text: "  ", fill: "#fff3bf" }), { x: 200, y: 140 }, 2)).toEqual([
      { color: "#fff3bf" },
    ]);
  });

  it("offers the border alone on it, drawn inside the edge, with reach either side", () => {
    const framed = box({ fill: "#fff3bf", border: { width: 4, color: "#2f9e44" } });
    for (const p of [
      { x: 101, y: 140 },
      { x: 105, y: 140 },
      { x: 98.5, y: 140 },
      { x: 200, y: 179 },
    ]) {
      expect(textBoxCandidates(framed, p, 2)).toEqual([{ color: "#2f9e44" }]);
    }
    // Well inside the border, the text and fill again.
    expect(textBoxCandidates(framed, { x: 110, y: 140 }, 2)).toHaveLength(2);
  });

  it("offers nothing off the box, and treats a zero-width border as none", () => {
    expect(textBoxCandidates(box(), { x: 99, y: 140 }, 2)).toEqual([]);
    expect(
      textBoxCandidates(box({ border: { width: 0, color: "#2f9e44" } }), { x: 101, y: 140 }, 2),
    ).toEqual([{ color: "#1a1a1a" }]);
    expect(textBoxCandidates(box({ border: null }), { x: 101, y: 140 }, 2)).toEqual([
      { color: "#1a1a1a" },
    ]);
  });
});

describe("nearestStored", () => {
  it("picks the one candidate, or the topmost without pixels", () => {
    expect(nearestStored([], "#ffffff")).toBeNull();
    expect(nearestStored([{ color: "#e03131" }], "#ffffff")).toBe("#e03131");
    expect(nearestStored([{ color: "#e03131" }, { color: "#1971c2" }], null)).toBe("#e03131");
  });

  it("lets the pixels choose between text and fill", () => {
    const candidates = [{ color: "#1a1a1a" }, { color: "#fff3bf" }];
    expect(nearestStored(candidates, "#fdf1c0")).toBe("#fff3bf");
    expect(nearestStored(candidates, "#2a2a28")).toBe("#1a1a1a");
  });

  it("judges a highlighter and a translucent fill as drawn, and hands back the stored colour", () => {
    // Yellow highlighter at 35 % over white looks pale; text over it is dark.
    const candidates = [{ color: "#1a1a1a" }, { color: "#fab005", alpha: 0.35 }];
    expect(nearestStored(candidates, "#fde5b0")).toBe("#fab005");
    // A fill stored with its own opacity comes back as #rrggbb.
    expect(nearestStored([{ color: "#1a1a1a" }, { color: "#ff000066" }], "#ff9999")).toBe(
      "#ff0000",
    );
  });

  it("ink of any pen is a candidate like any other", () => {
    // Ink showing through a text box with no fill: the pixels are the ink's.
    const candidates = [{ color: "#1a1a1a" }, { color: "#2f9e44" }];
    expect(nearestStored(candidates, "#3a9a4c")).toBe("#2f9e44");
  });

  it("skips a candidate that is not a colour", () => {
    expect(nearestStored([{ color: "garbage" }, { color: "#1971c2" }], "#000000")).toBe("#1971c2");
    expect(nearestStored([{ color: "garbage" }], "#000000")).toBeNull();
  });
});
