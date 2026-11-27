/** Optional secondary-tool transitions. Pure: no DOM or Obsidian. */
import { t } from "../i18n/translate";
import { rejoinsStroke } from "../input/pen-rejoin";
import type { SavedPenType } from "../model/saved-pens";
import type { ActiveTool } from "./toolbar";
import type { PenSlotId } from "./toolbar-layout";

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
  "tape",
  "fill",
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
 * The pen type P or H puts in hand (FineNotes#226), as tapping it in the pen
 * row does, so it comes with that type's own colour and width. H is the
 * highlighter. P is the pen type in hand while it is a pen; with the
 * highlighter in hand, the pen used last (`recent`, newest first), else the
 * first pen in the row (`order`). Turning the tool alone into "pen" kept the
 * highlighter as the type, and the surface reads that as the highlighter:
 * P did nothing.
 */
export function shortcutPenType(
  tool: "pen" | "highlighter",
  inHand: SavedPenType,
  recent: readonly SavedPenType[],
  order: readonly SavedPenType[],
): SavedPenType {
  if (tool === "highlighter") return "highlighter";
  if (inHand !== "highlighter") return inHand;
  return (
    recent.find((type) => type !== "highlighter") ??
    order.find((type) => type !== "highlighter") ??
    "fountain"
  );
}

/** A key that puts a pen in hand: P, H, or a saved pen's 1-8 (by its id, if it has one). */
export type PenKey = "pen" | "highlighter" | { saved: string | null };

/**
 * The bar button a pen key presses, as a tap would (FineNotes#226, #211):
 * a pen with a button of its own on the bar (`onBar`) is put in hand on
 * that button, so its button is the one marked, not the pen's own ("main").
 * `null`: the key names the pen already in hand, and changes nothing (a key
 * never tucks the options away, as a second tap does).
 *
 * - A saved pen: its own button if pinned, else the pen's.
 * - H: a pinned highlighter's button, else the pen's (as the highlighter).
 * - P: the button of the pen last written with (`lastPen`), while it is
 *   still on the bar, else the pen's. A pen in hand already stays.
 *
 * `inHand` is the button holding the pen in hand, `null` for the pen's own
 * or for another tool; `tool` is the tool in hand.
 */
export function keyPenTarget(
  key: PenKey,
  tool: ActiveTool,
  onBar: readonly PenSlotId[],
  inHand: PenSlotId | null,
  lastPen: PenSlotId | "main" | null,
): PenSlotId | "main" | null {
  const penInHand = tool === "pen" || tool === "highlighter";
  if (key === "pen") {
    if (tool === "pen") return null;
    return lastPen !== null && lastPen !== "main" && onBar.includes(lastPen) ? lastPen : "main";
  }
  if (key === "highlighter") {
    if (tool === "highlighter") return null;
    return onBar.includes("pen:highlighter") ? "pen:highlighter" : "main";
  }
  const slot: PenSlotId | null = key.saved === null ? null : `saved:${key.saved}`;
  if (slot === null || !onBar.includes(slot)) return "main";
  return penInHand && inHand === slot ? null : slot;
}

/**
 * A click of the pen's side button set to switch to the eraser
 * (FineNotes#149): any other tool goes to the eraser and is remembered in
 * `back`; on the eraser, the click goes back to it, or to the pen or
 * highlighter in use when the eraser was picked by hand.
 */
export function eraserClickStep(
  current: ActiveTool,
  back: ActiveTool | null,
  drawing: ActiveTool,
): { tool: ActiveTool; back: ActiveTool | null } {
  if (current !== "eraser") return { tool: "eraser", back: current };
  return { tool: back ?? drawingToolOf(drawing, drawing), back: null };
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
    (use === "gesture" && (tool === "eraser" || tool === "shape" || tool === "fill")) ||
    (use === "text" && tool === "text") ||
    (use === "selection" && tool === "select");
  return done ? drawingToolOf(back, back) : tool;
}

/**
 * Whether a tool's options pill shows once the tool is switched to:
 * keeps the current open or closed state consistent across tool switches.
 * If the options pill is open, switching tools opens the new tool's pill;
 * if it is closed, switching tools keeps it closed (tap the active tool a
 * second time to open its pill). While a second tap returns to the pen
 * (`selectedTool`, enabled), that tap cannot open anything, so the switch
 * shows the pill as before.
 */
export function optionsAfterSwitch(shown: boolean, secondTapReturns: boolean): boolean {
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
  get off() {
    return t("view.penOptions.never");
  },
  get "until-tap"() {
    return t("view.penOptions.untilTap");
  },
  get "until-lift"() {
    return t("view.penOptions.untilLift");
  },
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
