/**
 * `bindSnippetGrip`: a lassoed area on a PDF's tab (and its Drag to Notes
 * chip) takes a press from any pointer. A finger on the page normally pans
 * it; on the grip it must start a snippet instead, and the page below must
 * not hear it.
 */

import { describe, expect, it, vi } from "vitest";
import { GRIP_DRAG_SLOP_PX, bindSnippetGrip } from "../../src/view/snippet-drag";

type Listener = (event: FakePointer) => void;

interface FakePointer {
  type: string;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  stopped: boolean;
  prevented: boolean;
  stopPropagation(): void;
  preventDefault(): void;
}

function pointer(type: string, pointerType: string, x: number, y: number, id = 3): FakePointer {
  return {
    type,
    pointerId: id,
    pointerType,
    clientX: x,
    clientY: y,
    stopped: false,
    prevented: false,
    stopPropagation() {
      this.stopped = true;
    },
    preventDefault() {
      this.prevented = true;
    },
  };
}

function grip() {
  const listeners = new Map<string, Listener[]>();
  const el = {
    addEventListener: (type: string, fn: Listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    setPointerCapture: vi.fn(),
  };
  const fire = (event: FakePointer): FakePointer => {
    for (const fn of listeners.get(event.type) ?? []) fn(event);
    return event;
  };
  return { el: el as unknown as HTMLElement, fire, capture: el.setPointerCapture };
}

describe("bindSnippetGrip", () => {
  for (const kind of ["touch", "pen", "mouse"]) {
    it(`a ${kind} dragged past the slop starts a snippet, and the page never hears it`, () => {
      const { el, fire, capture } = grip();
      const drag = vi.fn();
      const tap = vi.fn();
      bindSnippetGrip(el, { blocked: () => false, drag, tap });
      const down = fire(pointer("pointerdown", kind, 100, 100));
      expect(down.stopped).toBe(true);
      // No pan, no text selection, no callout under a finger.
      expect(down.prevented).toBe(true);
      expect(capture).toHaveBeenCalledWith(3);
      const small = fire(pointer("pointermove", kind, 101, 100));
      expect(small.stopped).toBe(true);
      expect(drag).not.toHaveBeenCalled();
      const far = pointer("pointermove", kind, 100 + GRIP_DRAG_SLOP_PX + 6, 104);
      fire(far);
      expect(drag).toHaveBeenCalledWith(far);
      expect(tap).not.toHaveBeenCalled();
    });
  }

  it("a finger that lifts without moving is a tap", () => {
    const { el, fire } = grip();
    const drag = vi.fn();
    const tap = vi.fn();
    bindSnippetGrip(el, { blocked: () => false, drag, tap });
    fire(pointer("pointerdown", "touch", 50, 50));
    fire(pointer("pointerup", "touch", 50, 50));
    expect(tap).toHaveBeenCalledTimes(1);
    expect(drag).not.toHaveBeenCalled();
  });

  it("another finger's moves are not this press's", () => {
    const { el, fire } = grip();
    const drag = vi.fn();
    bindSnippetGrip(el, { blocked: () => false, drag, tap: vi.fn() });
    fire(pointer("pointerdown", "touch", 50, 50, 1));
    fire(pointer("pointermove", "touch", 150, 50, 2));
    expect(drag).not.toHaveBeenCalled();
  });

  it("starts nothing while blocked (a drag under way, a locked notebook), still keeping the page out", () => {
    const { el, fire } = grip();
    const drag = vi.fn();
    bindSnippetGrip(el, { blocked: () => true, drag, tap: vi.fn() });
    expect(fire(pointer("pointerdown", "touch", 50, 50)).stopped).toBe(true);
    fire(pointer("pointermove", "touch", 150, 50));
    expect(drag).not.toHaveBeenCalled();
  });
});
