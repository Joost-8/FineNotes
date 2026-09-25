/**
 * Undoing iPadOS's "reveal the focused field" scrolling.
 *
 * When a field takes focus, WebKit on iPadOS scrolls every scrollable
 * ancestor — the window included — to show it, and again as the keyboard
 * slides in and out. Obsidian's app is a fixed, full-screen layout that never
 * scrolls, so any offset WebKit leaves behind shifts the whole app, and it
 * outlives the field: close the dialog and the notebook opened next is drawn
 * scrolled off the screen. The surface already guards its page text boxes
 * (`InkSurface.holdScroll`); this is the same guard for fields in dialogs.
 */

import { keyboardHeight } from "./keyboard";

interface Offset {
  el: Element;
  top: number;
  left: number;
}

/** Scroll offsets of an element's ancestors and of the window, as they were. */
export interface ScrollSnapshot {
  offsets: Offset[];
  windowX: number;
  windowY: number;
}

/** Record every scroll offset from `el`'s parent up to `<html>`, and the window's. */
export function captureScroll(el: Element): ScrollSnapshot {
  const offsets: Offset[] = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
    offsets.push({ el: node, top: node.scrollTop, left: node.scrollLeft });
  }
  return { offsets, windowX: window.scrollX, windowY: window.scrollY };
}

/** Put every recorded offset back. Elements since removed are skipped. */
export function restoreScroll(snapshot: ScrollSnapshot): void {
  for (const { el, top, left } of snapshot.offsets) {
    if (!el.isConnected) continue;
    if (el.scrollTop !== top) el.scrollTop = top;
    if (el.scrollLeft !== left) el.scrollLeft = left;
  }
  if (window.scrollX !== snapshot.windowX || window.scrollY !== snapshot.windowY) {
    window.scrollTo(snapshot.windowX, snapshot.windowY);
  }
}

export interface HoldOptions {
  /** Always hold at least this long, ms (the keyboard is still animating). */
  minMs: number;
  /** Never hold longer than this, ms. */
  maxMs: number;
  /** Stop early (after `minMs`) once this is true; default: never. */
  done?: () => boolean;
}

/**
 * Keep `snapshot` in place every frame for a while. Returns a function that
 * stops the hold early.
 */
export function holdScroll(snapshot: ScrollSnapshot, options: HoldOptions): () => void {
  const start = performance.now();
  let frame = 0;
  const step = (): void => {
    frame = 0;
    restoreScroll(snapshot);
    const elapsed = performance.now() - start;
    if (elapsed >= options.maxMs) return;
    if (elapsed >= options.minMs && (options.done?.() ?? false)) return;
    frame = window.requestAnimationFrame(step);
  };
  step();
  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  };
}

/** Done once Obsidian reports the on-screen keyboard fully down. */
export const keyboardGone = (): boolean => keyboardHeight() === 0;
