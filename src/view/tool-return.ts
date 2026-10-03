/** Optional secondary-tool transitions. Pure: no DOM or Obsidian. */
import type { ActiveTool } from "./toolbar";

export type ToolUse = "gesture" | "text" | "selection";
const SECONDARY_TOOLS: ReadonlySet<ActiveTool> = new Set(["eraser", "select", "text", "shape"]);

/** Selecting the active secondary tool again optionally hands back to the pen. */
export function selectedTool(
  current: ActiveTool,
  requested: ActiveTool,
  enabled: boolean,
): ActiveTool {
  return enabled && current === requested && SECONDARY_TOOLS.has(requested) ? "pen" : requested;
}

/** Text and lasso finish only after editing/manipulation, not their initial pointer lift. */
export function toolAfterUse(tool: ActiveTool, use: ToolUse, enabled: boolean): ActiveTool {
  if (!enabled) return tool;
  if (use === "gesture" && (tool === "eraser" || tool === "shape")) return "pen";
  if (use === "text" && tool === "text") return "pen";
  if (use === "selection" && tool === "select") return "pen";
  return tool;
}
