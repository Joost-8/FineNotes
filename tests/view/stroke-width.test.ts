/**
 * `strokeWidthFor`: the width a stroke is laid down at. The page draws with
 * it and the width popover's preview shows it, so the two cannot disagree.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { strokeWidthFor } = await import("../../src/view/toolbar");

const state = (over: Record<string, unknown>) =>
  ({ tool: "pen", color: "#1a1a1a", size: 3, pressureEnabled: false, ...over }) as Parameters<
    typeof strokeWidthFor
  >[0];

describe("strokeWidthFor", () => {
  it("lays a pen down at the chosen width", () => {
    expect(strokeWidthFor(state({ penType: "fountain", size: 3 }))).toBe(3);
    expect(strokeWidthFor(state({ penType: "ball", size: 5 }))).toBe(5);
  });

  it("multiplies by the pen type's nib", () => {
    expect(strokeWidthFor(state({ penType: "brush", size: 5 }))).toBeCloseTo(9);
    expect(strokeWidthFor(state({ tool: "highlighter", penType: "highlighter", size: 3 }))).toBe(
      12,
    );
  });

  it("keeps the highlighter at least at the thinnest preset", () => {
    // A pen width below the presets (FineNotes#7) is shared, but a hairline
    // highlight is no highlight.
    expect(strokeWidthFor(state({ tool: "highlighter", penType: "highlighter", size: 1 }))).toBe(8);
  });

  it("draws a shape at the chosen width, whatever the pen type", () => {
    expect(strokeWidthFor(state({ tool: "shape", penType: "highlighter", size: 3 }))).toBe(3);
  });

  it("never goes below half a page px", () => {
    expect(strokeWidthFor(state({ penType: "fountain", size: 0.1 }))).toBe(0.5);
    expect(strokeWidthFor(state({ tool: "shape", size: 0 }))).toBe(0.5);
  });
});
