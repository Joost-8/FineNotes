/**
 * Present mode's keys (⋯ › Present): what a press does while a notebook is
 * shown as slides. The keys a presentation clicker sends (PageDown, PageUp,
 * the arrows) and the ones slide shows use (Space, Enter, Backspace, Home,
 * End, Escape). PURE: the presenter (`presenter.ts`) acts on the answer.
 */

/** What a key does in Present mode. */
export type PresentStep = "next" | "previous" | "first" | "last" | "leave";

/** The parts of a key press the answer depends on. */
export interface PresentKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

/**
 * The step `press` makes, or null for a key Present mode leaves alone (a
 * tool's key, a shortcut with Ctrl or Cmd), so the notebook still answers it.
 */
export function presentStep(press: PresentKey): PresentStep | null {
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  const { key } = press;
  if (key === "Escape") return "leave";
  // Shift+Space goes back, as in every slide show.
  if (key === " " && press.shiftKey) return "previous";
  if (NEXT.has(key)) return "next";
  if (PREVIOUS.has(key)) return "previous";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  return null;
}

/** "3 / 12": the page shown and how many there are, as the page counter reads. */
export function presentCount(index: number, total: number): string {
  const shown = Math.max(1, Math.min(total, index + 1));
  return `${shown} / ${Math.max(1, total)}`;
}

/** Where and when a press began, and where and when it let go (client px, ms). */
export interface PressPoint {
  id: number;
  x: number;
  y: number;
  t: number;
}

/** A press that let go this soon and this close to where it began is a tap, not a laser stroke. */
const TAP_MS = 300;
const TAP_SLOP_PX = 8;

/**
 * Whether a press was a tap or a click (the bar shows) rather than pointing
 * with the laser: the same pointer, let go within `TAP_MS`, near where it
 * went down.
 */
export function isTap(
  from: PressPoint,
  up: { pointerId: number; clientX: number; clientY: number; timeStamp: number },
): boolean {
  return (
    up.pointerId === from.id &&
    up.timeStamp - from.t <= TAP_MS &&
    Math.hypot(up.clientX - from.x, up.clientY - from.y) <= TAP_SLOP_PX
  );
}
