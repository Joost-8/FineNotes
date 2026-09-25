/**
 * `src/view/scroll-hold.ts` — putting back the scrolling iPadOS does to
 * reveal a focused field. There is no DOM in this suite, so the elements, the
 * window and the frame clock are stand-ins with just what the module reads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureScroll, holdScroll, keyboardGone, restoreScroll } from "../../src/view/scroll-hold";

interface FakeEl {
  parentElement: FakeEl | null;
  scrollTop: number;
  scrollLeft: number;
  isConnected: boolean;
}

const el = (parent: FakeEl | null, top = 0): FakeEl => ({
  parentElement: parent,
  scrollTop: top,
  scrollLeft: 0,
  isConnected: true,
});

let clock = 0;
let frames: Array<() => void> = [];
let keyboard = "0px";
const win = { scrollX: 0, scrollY: 0 } as { scrollX: number; scrollY: number };

/** Advance the clock by `ms` and run the frame queued, if any. */
const frame = (ms: number): boolean => {
  clock += ms;
  const next = frames.shift();
  next?.();
  return next !== undefined;
};

beforeEach(() => {
  clock = 0;
  frames = [];
  keyboard = "0px";
  win.scrollX = 0;
  win.scrollY = 0;
  vi.stubGlobal("performance", { now: () => clock });
  vi.stubGlobal("window", {
    get scrollX() {
      return win.scrollX;
    },
    get scrollY() {
      return win.scrollY;
    },
    scrollTo: (x: number, y: number) => {
      win.scrollX = x;
      win.scrollY = y;
    },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    cancelAnimationFrame: () => {
      frames = [];
    },
  });
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: () => keyboard,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("captureScroll / restoreScroll", () => {
  it("puts back every ancestor and the window, not the element itself", () => {
    const html = el(null);
    const body = el(html);
    const modal = el(body, 40);
    const input = el(modal, 7);
    const snapshot = captureScroll(input as unknown as Element);
    expect(snapshot.offsets).toHaveLength(3);

    html.scrollTop = 500;
    modal.scrollTop = 900;
    input.scrollTop = 3;
    win.scrollY = 812;
    restoreScroll(snapshot);
    expect(html.scrollTop).toBe(0);
    expect(modal.scrollTop).toBe(40);
    expect(input.scrollTop).toBe(3);
    expect(win.scrollY).toBe(0);
  });

  it("leaves an element that has since been removed alone", () => {
    const body = el(null);
    const modal = el(body);
    const snapshot = captureScroll(el(modal) as unknown as Element);
    modal.isConnected = false;
    modal.scrollTop = 120;
    restoreScroll(snapshot);
    expect(modal.scrollTop).toBe(120);
  });
});

describe("holdScroll", () => {
  it("undoes scrolling every frame until the time is up", () => {
    const body = el(null);
    const snapshot = captureScroll(el(body) as unknown as Element);
    holdScroll(snapshot, { minMs: 100, maxMs: 100 });
    win.scrollY = 300;
    body.scrollTop = 50;
    expect(frame(16)).toBe(true);
    expect(win.scrollY).toBe(0);
    expect(body.scrollTop).toBe(0);
    // Past the end: the last frame restores once more and queues nothing.
    frame(200);
    expect(frames).toHaveLength(0);
    win.scrollY = 300;
    expect(frame(16)).toBe(false);
    expect(win.scrollY).toBe(300);
  });

  it("waits for the keyboard to go down, but not before the minimum", () => {
    const snapshot = captureScroll(el(el(null)) as unknown as Element);
    keyboard = "310px";
    expect(keyboardGone()).toBe(false);
    holdScroll(snapshot, { minMs: 300, maxMs: 2000, done: keyboardGone });
    frame(500);
    expect(frames).toHaveLength(1);
    keyboard = "0px";
    frame(16);
    expect(frames).toHaveLength(0);
  });

  it("with the keyboard already down still holds for the minimum", () => {
    const snapshot = captureScroll(el(el(null)) as unknown as Element);
    holdScroll(snapshot, { minMs: 300, maxMs: 2000, done: keyboardGone });
    frame(100);
    expect(frames).toHaveLength(1);
    frame(250);
    expect(frames).toHaveLength(0);
  });

  it("gives up at the maximum if the keyboard never reports down", () => {
    const snapshot = captureScroll(el(el(null)) as unknown as Element);
    keyboard = "310px";
    holdScroll(snapshot, { minMs: 300, maxMs: 2000, done: keyboardGone });
    let ran = 0;
    while (frame(100)) ran++;
    expect(ran).toBeLessThanOrEqual(21);
  });

  it("stops at once when cancelled", () => {
    const snapshot = captureScroll(el(el(null)) as unknown as Element);
    const stop = holdScroll(snapshot, { minMs: 1000, maxMs: 1000 });
    stop();
    win.scrollY = 90;
    expect(frame(16)).toBe(false);
    expect(win.scrollY).toBe(90);
  });
});
