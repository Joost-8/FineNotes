import { describe, expect, it } from "vitest";
import {
  essentialsLayout,
  isFixedInPreset,
  isFoldedInPreset,
  parseBarPreset,
  swapItems,
} from "../../src/view/toolbar-layout";

describe("the Essentials preset", () => {
  it("is read back only when saved so", () => {
    expect(parseBarPreset("essentials")).toBe("essentials");
    expect(parseBarPreset("own")).toBe("own");
    expect(parseBarPreset(undefined)).toBe("own");
  });

  it("keeps the end's buttons, but ⋯, in ⋯", () => {
    const layout = essentialsLayout();
    expect(isFoldedInPreset(layout, "settings")).toBe(true);
    expect(isFoldedInPreset(layout, "more")).toBe(false);
    expect(isFoldedInPreset(layout, "pen")).toBe(false);
  });

  it("never moves undo, redo, the toolbox or the end", () => {
    const layout = essentialsLayout();
    for (const id of ["undo", "redo", "accessories", "more", "share"] as const) {
      expect(isFixedInPreset(layout, id)).toBe(true);
    }
    expect(isFixedInPreset(layout, "shape")).toBe(false);
  });

  it("replaces a tool with one from More tools, which takes the other's place there", () => {
    const next = swapItems(essentialsLayout(), "image", "shape");
    expect(next.middle).toEqual(["select", "pen", "eraser", "text", "image", "accessories"]);
    expect([...next.start, ...next.middle, ...next.end]).not.toContain("shape");
  });

  it("swaps two tools on the bar, keeping how many there are", () => {
    const next = swapItems(essentialsLayout(), "text", "thumbnails");
    expect(next.start).toEqual(["text", "undo", "redo"]);
    expect(next.middle).toEqual(["select", "pen", "eraser", "thumbnails", "shape", "accessories"]);
  });

  it("brings a hidden tool back in a tool's place", () => {
    const layout = { ...essentialsLayout(), off: ["fill" as const] };
    const next = swapItems(layout, "fill", "select");
    expect(next.middle[0]).toBe("fill");
    expect(next.off).toEqual([]);
  });

  it("does nothing with a fixed button", () => {
    const layout = essentialsLayout();
    expect(swapItems(layout, "image", "undo")).toEqual(layout);
    expect(swapItems(layout, "undo", "shape")).toEqual(layout);
  });
});
