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
const SECONDARY_TOOLS: ReadonlySet<ActiveTool> = new Set([
  "eraser",
  "select",
  "text",
  "shape",
  "laser",
]);

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

/**
 * Whether a tool's options pill shows once the tool is switched to:
 * Notability's "first tap selects, second tap opens options", so a switch
 * never opens a pill, though it may tuck one away. `shown`: the pill
 * showing before the switch. `remembered`: the next tool's own memory (it
 * was not left tucked, and it does not start tucked). While a second tap
 * on a tool hands back to the pen (`selectedTool`, enabled) that tap cannot
 * open anything, so the switch shows the remembered pill as before.
 */
export function optionsAfterSwitch(
  shown: boolean,
  remembered: boolean,
  secondTapReturns: boolean,
): boolean {
  if (!remembered) return false;
  return shown || secondTapReturns;
}

/**
 * "Hide pen options while writing": never, until the pen is tapped again
 * (as a second tap tucks them), or until the pen lifts and rests
 * ({@link PEN_OPTIONS_RETURN_MS}), when they come back by themselves.
 */
export type PenOptionsOnWrite = "off" | "until-tap" | "until-lift";

export const PEN_OPTIONS_ON_WRITE: readonly PenOptionsOnWrite[] = [
  "off",
  "until-tap",
  "until-lift",
];

/** The choices as the settings tab and the pen menu name them. */
export const PEN_OPTIONS_ON_WRITE_NAMES: Record<PenOptionsOnWrite, string> = {
  off: "Never",
  "until-tap": "Until you tap the pen",
  "until-lift": "Until the pen lifts",
};

/**
 * How long the pen rests after a lift before "until the pen lifts" brings
 * the options back: longer than the gap between strokes, or between words,
 * so the pill does not slide in and out while writing on.
 */
export const PEN_OPTIONS_RETURN_MS = 1000;

/** The stored choice; `true` is "until tapped", the switch it was before. */
export function penOptionsOnWriteOf(value: unknown): PenOptionsOnWrite {
  if (value === true) return "until-tap";
  return (PEN_OPTIONS_ON_WRITE as readonly unknown[]).includes(value)
    ? (value as PenOptionsOnWrite)
    : "off";
}

/**
 * Whether a gesture's start on the page tucks the options pill away: only
 * with "Hide pen options while writing" on (`mode`, as stored), only for
 * the pen or highlighter, and never for a tool a stylus button or a key
 * lent for this press (`lent`): that is not writing with the pen.
 */
export function tucksOnWrite(mode: unknown, tool: ActiveTool, lent: boolean): boolean {
  return penOptionsOnWriteOf(mode) !== "off" && !lent && (tool === "pen" || tool === "highlighter");
}

/** Whether the options a stroke tucked away come back once the pen has rested. */
export function returnsAfterLift(mode: unknown): boolean {
  return penOptionsOnWriteOf(mode) === "until-lift";
}
