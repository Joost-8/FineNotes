import { describe, expect, it } from "vitest";
import type { ActiveTool } from "../../src/view/toolbar";
import { REJOIN_MS, REJOIN_PX } from "../../src/input/pen-rejoin";
import {
  continuesUse,
  drawingToolOf,
  optionsAfterSwitch,
  selectedTool,
  toolAfterUse,
  tucksOnWrite,
  type ToolUse,
} from "../../src/view/tool-return";

const tools: ActiveTool[] = ["pen", "highlighter", "eraser", "select", "text", "shape"];
describe("optional tool return", () => {
  it.each(tools)("preserves %s by default and never toggles pen types", (tool) => {
    expect(selectedTool(tool, tool, false)).toBe(tool);
    expect(selectedTool("pen", tool, true)).toBe(tool);
    expect(selectedTool(tool, tool, true)).toBe(
      ["pen", "highlighter"].includes(tool) ? tool : "pen",
    );
  });
  it.each(tools)("returns %s only when its full use finishes", (tool) => {
    for (const use of ["gesture", "text", "selection"] as ToolUse[]) {
      expect(toolAfterUse(tool, use, false)).toBe(tool);
      const done =
        (use === "gesture" && ["eraser", "shape"].includes(tool)) ||
        (use === "text" && tool === "text") ||
        (use === "selection" && tool === "select");
      expect(toolAfterUse(tool, use, true)).toBe(done ? "pen" : tool);
    }
  });
  it("waits for a pen-down that lands soon and close to the lift, and only that", () => {
    const lift = { t: 1000, x: 200, y: 300 };
    expect(continuesUse(lift, 1020, 202, 301, REJOIN_PX)).toBe(true);
    expect(continuesUse(lift, 1000 + REJOIN_MS, 200 + REJOIN_PX, 300, REJOIN_PX)).toBe(true);
    expect(continuesUse(lift, 1001 + REJOIN_MS, 200, 300, REJOIN_PX)).toBe(false);
    expect(continuesUse(lift, 1020, 200 + REJOIN_PX + 1, 300, REJOIN_PX)).toBe(false);
    // A clock that ran backwards, or a cancel with no position, never continues.
    expect(continuesUse(lift, 990, 200, 300, REJOIN_PX)).toBe(false);
    expect(continuesUse({ t: 1000, x: NaN, y: NaN }, 1010, 200, 300, REJOIN_PX)).toBe(false);
  });
  it("goes back to the highlighter when that was the drawing tool before", () => {
    expect(drawingToolOf("pen", "highlighter")).toBe("highlighter");
    expect(drawingToolOf("highlighter", "eraser")).toBe("highlighter");
    expect(drawingToolOf("highlighter", "pen")).toBe("pen");
    // Only a pen or the highlighter is ever gone back to.
    expect(drawingToolOf("eraser", "text")).toBe("pen");
    expect(selectedTool("eraser", "eraser", true, "highlighter")).toBe("highlighter");
    expect(selectedTool("eraser", "eraser", false, "highlighter")).toBe("eraser");
    expect(selectedTool("eraser", "shape", true, "highlighter")).toBe("shape");
    expect(toolAfterUse("shape", "gesture", true, "highlighter")).toBe("highlighter");
    expect(toolAfterUse("text", "text", true, "highlighter")).toBe("highlighter");
    expect(toolAfterUse("select", "selection", true, "select")).toBe("pen");
    expect(toolAfterUse("pen", "gesture", true, "highlighter")).toBe("pen");
  });
});

describe("first tap selects, second tap opens options", () => {
  it("never opens a pill on a tool switch", () => {
    expect(optionsAfterSwitch(false, true, false)).toBe(false);
    expect(optionsAfterSwitch(false, false, false)).toBe(false);
  });
  it("keeps a showing pill showing, unless the next tool was left tucked", () => {
    expect(optionsAfterSwitch(true, true, false)).toBe(true);
    expect(optionsAfterSwitch(true, false, false)).toBe(false);
  });
  it("shows the remembered pill when the second tap returns to the pen", () => {
    expect(optionsAfterSwitch(false, true, true)).toBe(true);
    expect(optionsAfterSwitch(false, false, true)).toBe(false);
  });
});

describe("hide pen options while writing", () => {
  it("tucks the pill when the pen or the highlighter starts writing", () => {
    expect(tucksOnWrite(true, "pen", false)).toBe(true);
    expect(tucksOnWrite(true, "highlighter", false)).toBe(true);
  });
  it("leaves every other tool's pill alone", () => {
    for (const tool of ["eraser", "select", "text", "shape", "laser"] as ActiveTool[]) {
      expect(tucksOnWrite(true, tool, false)).toBe(false);
    }
  });
  it("leaves it alone for a tool the stylus button or a key lent", () => {
    expect(tucksOnWrite(true, "eraser", true)).toBe(false);
    expect(tucksOnWrite(true, "select", true)).toBe(false);
    expect(tucksOnWrite(true, "pen", true)).toBe(false);
  });
  it("does nothing while the setting is off or not a stored true", () => {
    for (const off of [false, undefined, null, "true", 1]) {
      expect(tucksOnWrite(off, "pen", false)).toBe(false);
    }
  });
});
