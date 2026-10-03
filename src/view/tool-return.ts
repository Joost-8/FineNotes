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

/**
 * The pen or highlighter a secondary tool hands back to: `tool` if it is
 * one of them, else the one remembered. The pen type and colour live in the
 * shared tool state and secondary tools leave them alone, so the tool is all
 * there is to remember; going back to "pen" while the pen type is still the
 * highlighter would draw opaque ink four times too wide.
 */
export function drawingToolOf(remembered: ActiveTool, tool: ActiveTool): ActiveTool {
  if (tool === "pen" || tool === "highlighter") return tool;
  return remembered === "highlighter" ? "highlighter" : "pen";
}

/** Selecting the active secondary tool again optionally hands back to `back` (the pen). */
export function selectedTool(
  current: ActiveTool,
  requested: ActiveTool,
  enabled: boolean,
  back: ActiveTool = "pen",
): ActiveTool {
  if (!enabled || current !== requested || !SECONDARY_TOOLS.has(requested)) return requested;
  return drawingToolOf(back, back);
}

/**
 * The tool once a use is finished: `back` (the pen or highlighter used
 * before, else the pen). Text and lasso finish only after editing or
 * manipulation, not their initial pointer lift.
 */
export function toolAfterUse(
  tool: ActiveTool,
  use: ToolUse,
  enabled: boolean,
  back: ActiveTool = "pen",
): ActiveTool {
  if (!enabled) return tool;
  const done =
    (use === "gesture" && (tool === "eraser" || tool === "shape")) ||
    (use === "text" && tool === "text") ||
    (use === "selection" && tool === "select");
  return done ? drawingToolOf(back, back) : tool;
}
