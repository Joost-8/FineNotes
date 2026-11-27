import { describe, expect, it, vi } from "vitest";
import { blankPage } from "../../src/model/document";
import {
  DEFAULT_WRITING_GUIDES,
  guideColor,
  guideMapOf,
  guidesOf,
  moveGuidePaths,
  withGuides,
  writingGuidesOf,
} from "../../src/model/writing-guides";
import { guideStops, paintWritingGuides } from "../../src/canvas/writing-guides";

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

  it("keeps each notebook's guides by path, off in the last look until set", () => {
    const last = { ...DEFAULT_WRITING_GUIDES, style: "dots" };
    expect(guidesOf(undefined, last, "a.md")).toEqual({
      on: false,
      style: writingGuidesOf(last),
    });
    expect(guidesOf({ "a.md": { on: true } }, last, null).on).toBe(false);
    const map = withGuides({}, "a.md", {
      on: true,
      style: { ...DEFAULT_WRITING_GUIDES, spacing: 48 },
    });
    expect(guidesOf(map, last, "a.md")).toEqual({
      on: true,
      style: { ...DEFAULT_WRITING_GUIDES, spacing: 48 },
    });
    expect(guidesOf(map, last, "b.md").on).toBe(false);
    expect(guideMapOf({ bad: 3, "a.md": { on: true } })).toEqual({ "a.md": { on: true } });
  });

  it("follows a notebook or its folder when moved, and forgets it when deleted", () => {
    const map = { "N/a.md": { on: true }, "N/sub/b.md": { on: false }, "Nx/c.md": { on: true } };
    expect(Object.keys(moveGuidePaths(map, "N", "M"))).toEqual(["M/a.md", "M/sub/b.md", "Nx/c.md"]);
    expect(Object.keys(moveGuidePaths(map, "N/a.md"))).toEqual(["N/sub/b.md", "Nx/c.md"]);
    const same = guideMapOf(map);
    expect(moveGuidePaths(same, "Q")).toEqual(same);
  });

  it("runs guides on across a join, the spacing kept, and never on the first edge", () => {
    // Two joined A4 pages, 1123 px tall, spacing 32: page 1 ends on 1120,
    // page 2 must go on at 1152 - 1123 = 29, not start again at 0.
    expect(guideStops(0, 100, 32)).toEqual([32, 64, 96]);
    const page1 = guideStops(1080, 1123, 32, 0);
    const page2 = guideStops(0, 70, 32, 1123);
    expect(page1).toEqual([1088, 1120]);
    expect(page2).toEqual([29, 61]);
    expect(1123 - page1[page1.length - 1]! + page2[0]!).toBe(32);
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
