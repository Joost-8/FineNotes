/** Optional secondary-tool transitions. Pure: no DOM or Obsidian. */
import { rejoinsStroke } from "../input/pen-rejoin";
import type { ActiveTool } from "./toolbar";

/** Where and when (ms) a use's pen lifted. */
export interface ToolLift {
  t: number;
  x: number;
  y: number;
}

/**
 * Whether a pen-down at `t`, (`x`, `y`) carries on the use that lifted at
 * `lift`: the Pencil's contact flickered (`input/pen-rejoin.ts`), so the
 * eraser stroke or shape is not finished and the tool must not switch yet.
 * `maxDistance` is `REJOIN_PX` in the caller's units.
 */
export function continuesUse(
  lift: ToolLift,
  t: number,
  x: number,
  y: number,
  maxDistance: number,
): boolean {
  return rejoinsStroke(t - lift.t, Math.hypot(x - lift.x, y - lift.y), maxDistance);
}

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
