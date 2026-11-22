/**
 * Where the Ask AI window sits (`view/ask-window.ts`): a floating window
 * over a notebook or a text note, as the calculator's is, moved by its bar
 * and sized from its corner. Its place is kept on this device, the same for
 * every notebook and note, as the calculator keeps its own. PURE.
 */

import { type WindowPlace, clampPlace } from "./calculator-store";

/** The chat needs its top line, a few answers and the field: never smaller than this. */
export const ASK_WINDOW_MIN = { w: 300, h: 360 };

/** Where it first opens: along the right of the note, under the bar, as tall as fits. */
export function defaultAskWindowPlace(bounds: { w: number; h: number }): WindowPlace {
  const w = Math.min(440, Math.max(ASK_WINDOW_MIN.w, bounds.w - 32));
  const h = Math.min(640, Math.max(ASK_WINDOW_MIN.h, bounds.h - 88));
  return clampPlace({ x: bounds.w - w - 16, y: 72, w, h }, bounds, ASK_WINDOW_MIN);
}

/** A stored place, as `JSON.stringify` wrote it; `null` for anything else. */
export function parseAskWindowPlace(raw: unknown): WindowPlace | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { x, y, w, h } = value as Record<string, unknown>;
  const numbers = [x, y, w, h];
  if (!numbers.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  if ((w as number) <= 0 || (h as number) <= 0) return null;
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}
