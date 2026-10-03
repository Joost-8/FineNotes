import { describe, expect, it } from "vitest";
import type { ActiveTool } from "../../src/view/toolbar";
import { selectedTool, toolAfterUse, type ToolUse } from "../../src/view/tool-return";

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
});
