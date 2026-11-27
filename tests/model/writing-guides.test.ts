import { describe, expect, it, vi } from "vitest";
import { blankPage } from "../../src/model/document";
import {
  DEFAULT_WRITING_GUIDES,
  guideColor,
  writingGuidesOf,
} from "../../src/model/writing-guides";
import { paintWritingGuides } from "../../src/canvas/writing-guides";

describe("writing-guides pure model", () => {
  it("normalizes and clamps writing guide settings safely", () => {
    expect(writingGuidesOf(undefined)).toEqual(DEFAULT_WRITING_GUIDES);
    expect(
      writingGuidesOf({
        style: "grid",
        spacing: 2,
        thickness: 99,
        opacity: 2,
        colorMode: "custom",
        customColor: "#336699",
      }),
    ).toEqual({
      style: "grid",
      spacing: 8,
      thickness: 3,
      opacity: 0.6,
      colorMode: "custom",
      customColor: "#336699",
    });

    expect(
      writingGuidesOf({
        style: "unknown",
        spacing: 999,
        thickness: 0.01,
        opacity: 0,
        colorMode: "custom",
        customColor: "not-a-color",
      }),
    ).toEqual({
      style: DEFAULT_WRITING_GUIDES.style,
      spacing: 128,
      thickness: 0.5,
      opacity: 0.05,
      colorMode: "custom",
      customColor: DEFAULT_WRITING_GUIDES.customColor,
    });
  });

  it("picks auto contrast color based on paper brightness and honors custom colors", () => {
    expect(guideColor(DEFAULT_WRITING_GUIDES, "#ffffff")).toBe("#64748b");
    expect(guideColor(DEFAULT_WRITING_GUIDES, "#1e1f22")).toBe("#cbd5e1");
    expect(
      guideColor(
        { ...DEFAULT_WRITING_GUIDES, colorMode: "custom", customColor: "#ff0000" },
        "#ffffff",
      ),
    ).toBe("#ff0000");
  });

  it("paints lines, grid, and dots onto a canvas context without throwing", () => {
    const page = blankPage("p1", { width: 200, height: 200 });
    const region = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    for (const style of ["lines", "grid", "dots"] as const) {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        globalAlpha: 1,
        strokeStyle: "",
        fillStyle: "",
        lineWidth: 1,
      } as unknown as CanvasRenderingContext2D;

      paintWritingGuides(
        ctx,
        page,
        region,
        { ...DEFAULT_WRITING_GUIDES, style, spacing: 40 },
        "#ffffff",
        1,
        1,
      );
      expect(ctx.save).toHaveBeenCalledTimes(1);
      expect(ctx.restore).toHaveBeenCalledTimes(1);
      if (style === "dots") {
        expect(ctx.fill).toHaveBeenCalled();
      } else {
        expect(ctx.stroke).toHaveBeenCalled();
      }
    }
  });
});
