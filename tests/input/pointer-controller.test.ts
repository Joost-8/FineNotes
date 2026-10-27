/**
 * `src/input/pointer-controller.ts`, driven with stand-in events.
 *
 * The controller only runs for real on an iPad, where nothing can be
 * attached to it. These tests record, as one ordered log, every callback it
 * makes for a scenario, so a rewrite has to reproduce the same sequence. The
 * element is a stand-in with the five methods the controller uses; pointer
 * capture is only recorded (a real `setPointerCapture` throws for a
 * synthetic pointer id), and releasing a pointer that is not captured
 * throws, as it can on the device once WebKit has forgotten the pointer.
 */

import { describe, expect, it } from "vitest";
import {
  isWholePixel,
  PointerController,
  type PointerControllerCallbacks,
  type PointerDebugRecord,
  type PointerSample,
  type PressRoute,
} from "../../src/input/pointer-controller";
import { MENU_AFTER_LIFT_MS } from "../../src/input/stylus-click";

type Listener = (event: unknown) => void;

class StandInElement {
  readonly listeners = new Map<string, Listener>();
  readonly captured = new Set<number>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  setPointerCapture(id: number): void {
    this.captured.add(id);
  }

  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }

  releasePointerCapture(id: number): void {
    if (!this.captured.delete(id)) throw new Error(`released pointer ${id}, never captured`);
  }
}

interface Contact {
  x: number;
  y: number;
  t?: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  /** The contact's size, CSS px; left out, the event has none (as WebKit reports 1). */
  width?: number;
  height?: number;
  /** The mouse button pressed (2 is the right one); left out, the main one. */
  button?: number;
  /** Every button held, as a bit set (1 contact, 2 a pen's barrel); left out, none. */
  buttons?: number;
  /** Samples `getCoalescedEvents()` returns; `undefined` leaves the method out. */
  coalesced?: Contact[];
  /** Samples `getPredictedEvents()` returns; `undefined` leaves the method out. */
  predicted?: Contact[];
}

interface StandInEvent {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  timeStamp: number;
  width: number;
  height: number;
  button: number;
  buttons: number;
  prevented: boolean;
  preventDefault(): void;
  getCoalescedEvents?: () => StandInEvent[];
  getPredictedEvents?: () => StandInEvent[];
}

function eventFor(id: number, pointerType: string, c: Contact): StandInEvent {
  const event: StandInEvent = {
    pointerId: id,
    pointerType,
    clientX: c.x,
    clientY: c.y,
    pressure: c.pressure ?? 0.5,
    tiltX: c.tiltX ?? 0,
    tiltY: c.tiltY ?? 0,
    timeStamp: c.t ?? 0,
    width: c.width ?? 1,
    height: c.height ?? 1,
    button: c.button ?? 0,
    buttons: c.buttons ?? 0,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  const { coalesced, predicted } = c;
  if (coalesced)
    event.getCoalescedEvents = () => coalesced.map((s) => eventFor(id, pointerType, s));
  if (predicted)
    event.getPredictedEvents = () => predicted.map((s) => eventFor(id, pointerType, s));
  return event;
}

/** Client px to the surface's own space: an offset, so a mapped value is recognisable. */
const toSurface = (x: number, y: number): { x: number; y: number } => ({
  x: x + 1000,
  y: y + 2000,
});

const show = (s: PointerSample): string =>
  `${s.x},${s.y} p=${s.pressure} tilt=${s.tiltX},${s.tiltY}`;

type Phase = "pointerdown" | "pointermove" | "pointerup" | "pointercancel";

class Rig {
  readonly el = new StandInElement();
  readonly log: string[] = [];
  readonly records: PointerDebugRecord[] = [];
  readonly samples: PointerSample[] = [];
  readonly controller: PointerController;
  /** Space held down (FineNotes#7). */
  readonly hand = { held: false };
  /** Stylus-only mode on (the toolbar's switch). */
  readonly onlyStylus = { on: false };

  constructor(only?: "required") {
    const log = this.log;
    const required: PointerControllerCallbacks = {
      onStart: (s) => {
        this.samples.push(s);
        log.push(`start ${show(s)}`);
      },
      onMove: (c) => log.push(`move [${c.map(show).join(" | ")}]`),
      onEnd: (s) => {
        this.samples.push(s);
        log.push(`end ${show(s)}`);
      },
      onCancel: () => log.push("cancel"),
    };
    const callbacks: PointerControllerCallbacks =
      only === "required"
        ? required
        : {
            ...required,
            onPanStart: (x, y, t) => log.push(`panStart ${x},${y} t=${t}`),
            onPanMove: (x, y, t) => log.push(`panMove ${x},${y} t=${t}`),
            onPanEnd: (t) => log.push(`panEnd t=${t}`),
            onPanCancel: () => log.push("panCancel"),
            onPinchStart: (x, y) => log.push(`pinchStart ${x},${y}`),
            onPinch: (i) => log.push(`pinch x${i.scaleFactor} at ${i.centerX},${i.centerY}`),
            onPinchEnd: () => log.push("pinchEnd"),
            onFingerDoubleTap: (fingers) => log.push(`doubleTap ${fingers}`),
            onDebug: (r) => {
              this.records.push(r);
              log.push(
                `debug ${r.type} ${r.pointerType}#${r.pointerId} p=${r.pressure} c=${r.coalesced} t=${r.timeStamp}`,
              );
            },
          };
    this.controller = new PointerController(
      this.el as unknown as HTMLElement,
      toSurface,
      callbacks,
      {
        handHeld: () => this.hand.held,
        route: () => "draw",
        onlyStylus: () => this.onlyStylus.on,
      },
    );
    this.controller.attach();
  }

  fire(phase: Phase, id: number, pointerType: string, c: Contact): StandInEvent {
    const event = eventFor(id, pointerType, c);
    this.el.listeners.get(phase)?.(event);
    return event;
  }

  pen(phase: Phase, id: number, c: Contact): StandInEvent {
    return this.fire(phase, id, "pen", c);
  }

  finger(phase: Phase, id: number, x: number, y: number, t: number): StandInEvent {
    return this.fire(phase, id, "touch", { x, y, t });
  }

  /** The callbacks made since the last call. */
  take(): string[] {
    return this.log.splice(0);
  }

  get captured(): number[] {
    return [...this.el.captured].sort((a, b) => a - b);
  }
}

describe("attaching", () => {
  it("listens for the four pointer events, and detach stops listening", () => {
    const rig = new Rig();
    expect([...rig.el.listeners.keys()].sort()).toEqual([
      "pointercancel",
      "pointerdown",
      "pointermove",
      "pointerup",
    ]);
    rig.controller.detach();
    expect(rig.el.listeners.size).toBe(0);
    rig.pen("pointerdown", 1, { x: 1, y: 1 });
    expect(rig.take()).toEqual([]);
  });
});

describe("a drawing pointer", () => {
  it("reports a stroke in surface space, with the HUD record before each callback", () => {
    const rig = new Rig();
    const down = rig.pen("pointerdown", 1, { x: 10, y: 20, t: 5, tiltX: 3, tiltY: 4 });
    expect(rig.take()).toEqual([
      "debug down pen#1 p=0.5 c=0 t=5",
      "start 1010,2020 p=0.5 tilt=3,4",
    ]);
    expect(down.prevented).toBe(true);
    expect(rig.captured).toEqual([1]);

    const move = rig.pen("pointermove", 1, {
      x: 30,
      y: 40,
      t: 6,
      pressure: 0.6,
      coalesced: [
        { x: 12, y: 22, pressure: 0.51 },
        { x: 20, y: 30, pressure: 0.55 },
        { x: 30, y: 40, pressure: 0.6 },
      ],
      predicted: [
        { x: 40, y: 50, pressure: 0.6 },
        { x: 50, y: 60, pressure: 0.6 },
      ],
    });
    expect(rig.take()).toEqual([
      "debug move pen#1 p=0.6 c=3 t=6",
      // The predicted samples are left out: drawn, they made the ink swing.
      "move [1012,2022 p=0.51 tilt=0,0 | 1020,2030 p=0.55 tilt=0,0 | 1030,2040 p=0.6 tilt=0,0]",
    ]);
    expect(move.prevented).toBe(true);

    // The pen-up's own sample ends the stroke.
    const up = rig.pen("pointerup", 1, { x: 31, y: 41, t: 7, pressure: 0 });
    expect(rig.take()).toEqual(["debug up pen#1 p=0 c=0 t=7", "end 1031,2041 p=0 tilt=0,0"]);
    expect(up.prevented).toBe(true);
    expect(rig.captured).toEqual([]);
  });

  it("hands over samples and HUD records with exactly these fields", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 7, { x: 1, y: 2, t: 3, pressure: 0.25, tiltX: -5, tiltY: 6 });
    rig.pen("pointermove", 7, { x: 2, y: 3, t: 4, coalesced: [{ x: 2, y: 3 }] });
    expect(rig.samples[0]).toEqual({
      x: 1001,
      y: 2002,
      pressure: 0.25,
      tiltX: -5,
      tiltY: 6,
      // The event's time and pointer kind: a practice file records both.
      t: 3,
      pointerType: "pen",
    });
    expect(rig.records).toEqual([
      {
        type: "down",
        pointerType: "pen",
        pointerId: 7,
        pressure: 0.25,
        coalesced: 0,
        timeStamp: 3,
        wholePixel: true,
      },
      {
        type: "move",
        pointerType: "pen",
        pointerId: 7,
        pressure: 0.5,
        coalesced: 1,
        timeStamp: 4,
        wholePixel: true,
      },
    ]);
  });

  describe("a pen whose positions arrive rounded (WebKit before iPadOS 26.2)", () => {
    it("is rounded from its first pen-down while every position is whole px", () => {
      const rig = new Rig();
      rig.pen("pointerdown", 1, { x: 10, y: 20 });
      expect(rig.controller.strokeRounded).toBe(true);
      rig.pen("pointermove", 1, {
        x: 12,
        y: 21,
        coalesced: [
          { x: 11, y: 20 },
          { x: 12, y: 21 },
        ],
      });
      rig.pen("pointerup", 1, { x: 12, y: 21 });
      rig.pen("pointerdown", 2, { x: 40, y: 50 });
      expect(rig.controller.strokeRounded).toBe(true);
    });

    it("is precise from the pen-down that first has a fraction, and stays so", () => {
      const rig = new Rig();
      rig.pen("pointerdown", 1, { x: 10.37, y: 20 });
      expect(rig.controller.strokeRounded).toBe(false);
      rig.pen("pointerup", 1, { x: 11, y: 21 });
      rig.pen("pointerdown", 2, { x: 40, y: 50 });
      expect(rig.controller.strokeRounded).toBe(false);
    });

    it("keeps a stroke's decision when a fraction turns up mid-stroke; the next stroke is precise", () => {
      const rig = new Rig();
      rig.pen("pointerdown", 1, { x: 10, y: 20 });
      rig.pen("pointermove", 1, { x: 12, y: 21, coalesced: [{ x: 11.5, y: 20.25 }] });
      expect(rig.controller.strokeRounded).toBe(true);
      rig.pen("pointerup", 1, { x: 12, y: 21 });
      rig.pen("pointerdown", 2, { x: 40, y: 50 });
      expect(rig.controller.strokeRounded).toBe(false);
    });

    it("never counts a mouse, which reports whole px on the desktop", () => {
      const rig = new Rig();
      rig.fire("pointerdown", 1, "mouse", { x: 10, y: 20 });
      expect(rig.controller.strokeRounded).toBe(false);
    });

    it("marks each HUD record whole px or not", () => {
      const rig = new Rig();
      rig.pen("pointerdown", 1, { x: 10, y: 20.5 });
      expect(rig.records.map((r) => r.wholePixel)).toEqual([false]);
      expect(isWholePixel({ clientX: 3, clientY: -4 })).toBe(true);
      expect(isWholePixel({ clientX: 3, clientY: 4.01 })).toBe(false);
    });
  });

  it("is any pointer that is not a finger: a mouse, or an unknown type", () => {
    for (const type of ["mouse", "", "stylus"]) {
      const rig = new Rig();
      rig.fire("pointerdown", 1, type, { x: 0, y: 0 });
      rig.fire("pointerup", 1, type, { x: 0, y: 0 });
      expect(rig.take()).toEqual([
        `debug down ${type}#1 p=0.5 c=0 t=0`,
        "start 1000,2000 p=0.5 tilt=0,0",
        `debug up ${type}#1 p=0.5 c=0 t=0`,
        "end 1000,2000 p=0.5 tilt=0,0",
      ]);
    }
  });

  it("falls back to the event itself when there are no coalesced samples", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0 });
    rig.take();
    // No getCoalescedEvents / getPredictedEvents at all (older WebKit).
    rig.pen("pointermove", 1, { x: 5, y: 6, t: 1 });
    // Both present but empty.
    rig.pen("pointermove", 1, { x: 7, y: 8, t: 2, coalesced: [], predicted: [] });
    expect(rig.take()).toEqual([
      "debug move pen#1 p=0.5 c=1 t=1",
      "move [1005,2006 p=0.5 tilt=0,0]",
      "debug move pen#1 p=0.5 c=1 t=2",
      "move [1007,2008 p=0.5 tilt=0,0]",
    ]);
  });

  it("does not add the event's own position to coalesced samples that exist", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0 });
    rig.take();
    rig.pen("pointermove", 1, { x: 99, y: 99, coalesced: [{ x: 1, y: 1 }] });
    expect(rig.take()).toEqual([
      "debug move pen#1 p=0.5 c=1 t=0",
      "move [1001,2001 p=0.5 tilt=0,0]",
    ]);
  });

  it("reports a cancel, not an end, when WebKit cancels it", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0, t: 1 });
    rig.pen("pointermove", 1, { x: 5, y: 5, t: 2 });
    rig.take();
    const cancel = rig.pen("pointercancel", 1, { x: 5, y: 5, t: 3, pressure: 0 });
    expect(rig.take()).toEqual(["debug cancel pen#1 p=0 c=0 t=3", "cancel"]);
    expect(cancel.prevented).toBe(false);
    expect(rig.captured).toEqual([]);
    // A late pointerup for it is nothing, and fingers work again.
    rig.pen("pointerup", 1, { x: 5, y: 5, t: 4 });
    rig.finger("pointerdown", 10, 100, 100, 5);
    expect(rig.take()).toEqual(["panStart 100,100 t=5"]);
  });

  it("ignores a hovering pen, and a pen that is not the one drawing", () => {
    const rig = new Rig();
    const hover = rig.pen("pointermove", 1, { x: 1, y: 1 });
    rig.pen("pointerup", 1, { x: 1, y: 1 });
    rig.pen("pointercancel", 1, { x: 1, y: 1 });
    expect(rig.take()).toEqual([]);
    expect(hover.prevented).toBe(false);
  });
});

describe("a new pen-down while a stroke is still open", () => {
  it("cancels the open stroke first (iOS can drop the pointerup of a quick T)", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0, t: 1 });
    rig.pen("pointermove", 1, { x: 0, y: 50, t: 2 });
    rig.take();
    rig.pen("pointerdown", 2, { x: -20, y: 0, t: 3 });
    expect(rig.take()).toEqual([
      "cancel",
      "debug down pen#2 p=0.5 c=0 t=3",
      "start 980,2000 p=0.5 tilt=0,0",
    ]);
    expect(rig.captured).toEqual([2]);

    // The first pen's late events belong to no stroke.
    rig.pen("pointermove", 1, { x: 0, y: 60, t: 4 });
    rig.pen("pointerup", 1, { x: 0, y: 60, t: 5 });
    expect(rig.take()).toEqual([]);

    rig.pen("pointermove", 2, { x: 20, y: 0, t: 6 });
    rig.pen("pointerup", 2, { x: 20, y: 0, t: 7 });
    expect(rig.take()).toEqual([
      "debug move pen#2 p=0.5 c=1 t=6",
      "move [1020,2000 p=0.5 tilt=0,0]",
      "debug up pen#2 p=0.5 c=0 t=7",
      "end 1020,2000 p=0.5 tilt=0,0",
    ]);
  });

  it("does the same when the new pen-down reuses the old pointer id", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0, t: 1 });
    rig.take();
    rig.pen("pointerdown", 1, { x: 9, y: 9, t: 2 });
    expect(rig.take()).toEqual([
      "cancel",
      "debug down pen#1 p=0.5 c=0 t=2",
      "start 1009,2009 p=0.5 tilt=0,0",
    ]);
    expect(rig.captured).toEqual([1]);
  });

  it("does not release a capture WebKit has already dropped", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0 });
    rig.el.captured.delete(1);
    rig.take();
    rig.pen("pointerdown", 2, { x: 0, y: 0 });
    expect(rig.take()).toEqual([
      "cancel",
      "debug down pen#2 p=0.5 c=0 t=0",
      "start 1000,2000 p=0.5 tilt=0,0",
    ]);
  });

  it("keeps fingers ignored until then, since the open stroke still owns the page", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0 });
    rig.take();
    rig.finger("pointerdown", 10, 100, 100, 1);
    rig.finger("pointermove", 10, 120, 100, 2);
    expect(rig.take()).toEqual([]);
  });
});

describe("fingers", () => {
  it("one finger pans, in client px, with timestamps", () => {
    const rig = new Rig();
    const down = rig.finger("pointerdown", 10, 100, 200, 1);
    expect(rig.take()).toEqual(["panStart 100,200 t=1"]);
    expect(rig.captured).toEqual([10]);
    const move = rig.finger("pointermove", 10, 90, 150, 2);
    expect(rig.take()).toEqual(["panMove 90,150 t=2"]);
    const up = rig.finger("pointerup", 10, 90, 150, 3);
    expect(rig.take()).toEqual(["panEnd t=3"]);
    expect(rig.captured).toEqual([]);
    // Fingers are left to the browser's defaults and never reach the HUD.
    expect([down.prevented, move.prevented, up.prevented]).toEqual([false, false, false]);
    expect(rig.records).toEqual([]);
  });

  it("two pinch about their midpoint, and one left carries on as a pan", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 0, 0, 1);
    expect(rig.take()).toEqual(["panStart 0,0 t=1"]);
    rig.finger("pointerdown", 11, 100, 0, 2);
    expect(rig.take()).toEqual(["pinchStart 50,0", "panStart 50,0 t=2"]);
    expect(rig.captured).toEqual([10, 11]);
    rig.finger("pointermove", 11, 200, 0, 3);
    expect(rig.take()).toEqual(["pinch x2 at 100,0", "panMove 100,0 t=3"]);
    rig.finger("pointermove", 10, -100, 0, 4);
    expect(rig.take()).toEqual(["pinch x1.5 at 50,0", "panMove 50,0 t=4"]);
    rig.finger("pointerup", 11, 200, 0, 5);
    expect(rig.take()).toEqual(["pinchEnd", "panStart -100,0 t=5"]);
    expect(rig.captured).toEqual([10]);
    rig.finger("pointermove", 10, -90, 0, 6);
    expect(rig.take()).toEqual(["panMove -90,0 t=6"]);
    rig.finger("pointerup", 10, -90, 0, 7);
    expect(rig.take()).toEqual(["panEnd t=7"]);
  });

  it("measures each pinch step against the previous one", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 0, 0, 1);
    rig.finger("pointerdown", 11, 10, 0, 2);
    rig.take();
    rig.finger("pointermove", 11, 20, 0, 3);
    rig.finger("pointermove", 11, 40, 0, 4);
    rig.finger("pointermove", 10, 20, 0, 5);
    expect(rig.take()).toEqual([
      "pinch x2 at 10,0",
      "panMove 10,0 t=3",
      "pinch x2 at 20,0",
      "panMove 20,0 t=4",
      "pinch x0.5 at 30,0",
      "panMove 30,0 t=5",
    ]);
  });

  it("keeps large touch pinch steps proportional, independent of the wheel zoom cap", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 0, 0, 1);
    rig.finger("pointerdown", 11, 120, 0, 2);
    rig.take();
    // The same 120 px distance as a coarse wheel delta is a finger spread,
    // not a wheel event: doubling it must still produce a full 2x pinch.
    rig.finger("pointermove", 11, 240, 0, 3);
    rig.finger("pointermove", 11, 120, 0, 4);
    rig.finger("pointerup", 11, 120, 0, 5);
    expect(rig.take()).toEqual([
      "pinch x2 at 120,0",
      "panMove 120,0 t=3",
      "pinch x0.5 at 60,0",
      "panMove 60,0 t=4",
      "pinchEnd",
      "panStart 0,0 t=5",
    ]);
    expect(rig.captured).toEqual([10]);
  });

  it("the pair lifting in the other order pans from the finger that stays", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 0, 0, 1);
    rig.finger("pointerdown", 11, 100, 40, 2);
    rig.take();
    rig.finger("pointerup", 10, 0, 0, 3);
    expect(rig.take()).toEqual(["pinchEnd", "panStart 100,40 t=3"]);
    rig.finger("pointerdown", 12, 0, 40, 4);
    expect(rig.take()).toEqual(["pinchStart 50,40", "panStart 50,40 t=4"]);
  });

  it("ignores a third finger, for as long as it stays down", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 0, 0, 1);
    rig.finger("pointerdown", 11, 100, 0, 2);
    rig.take();
    rig.finger("pointerdown", 12, 50, 50, 3);
    rig.finger("pointermove", 12, 60, 60, 4);
    expect(rig.take()).toEqual([]);
    expect(rig.captured).toEqual([10, 11]);
    rig.finger("pointerup", 10, 0, 0, 5);
    expect(rig.take()).toEqual(["pinchEnd", "panStart 100,0 t=5"]);
    // Still not part of the gesture, although a place is free now.
    rig.finger("pointermove", 12, 70, 70, 6);
    expect(rig.take()).toEqual([]);
    rig.finger("pointerdown", 13, 100, 100, 7);
    expect(rig.take()).toEqual(["pinchStart 100,50", "panStart 100,50 t=7"]);
    rig.finger("pointerup", 12, 70, 70, 8);
    expect(rig.take()).toEqual([]);
  });

  it("a finger reported down twice is re-anchored where it is now", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 0, 0, 1);
    rig.finger("pointerdown", 10, 10, 10, 2);
    expect(rig.take()).toEqual(["panStart 0,0 t=1", "panStart 10,10 t=2"]);

    rig.finger("pointerdown", 11, 100, 0, 3);
    rig.take();
    // Down again at 210,10: the spread is measured afresh, and the pinch
    // that is already running does not start a second time.
    rig.finger("pointerdown", 11, 210, 10, 4);
    expect(rig.take()).toEqual(["panStart 110,10 t=4"]);
    rig.finger("pointermove", 10, -190, 10, 5);
    expect(rig.take()).toEqual(["pinch x2 at 10,10", "panMove 10,10 t=5"]);
  });

  it("a cancelled finger ends the pan the same way a lift does", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 0, 0, 1);
    rig.finger("pointerdown", 11, 100, 0, 2);
    rig.take();
    rig.finger("pointercancel", 11, 100, 0, 3);
    expect(rig.take()).toEqual(["pinchEnd", "panStart 0,0 t=3"]);
    rig.finger("pointercancel", 10, 0, 0, 4);
    expect(rig.take()).toEqual(["panEnd t=4"]);
    expect(rig.captured).toEqual([]);
  });

  it("two fingers on one spot wait for a spread before reporting a pinch", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 50, 50, 1);
    rig.finger("pointerdown", 11, 50, 50, 2);
    expect(rig.take()).toEqual(["panStart 50,50 t=1", "pinchStart 50,50", "panStart 50,50 t=2"]);
    rig.finger("pointermove", 11, 60, 50, 3);
    expect(rig.take()).toEqual(["panMove 55,50 t=3"]);
    rig.finger("pointermove", 11, 70, 50, 4);
    expect(rig.take()).toEqual(["pinch x2 at 60,50", "panMove 60,50 t=4"]);
  });

  it("are tracked while a gesture is in progress", () => {
    const rig = new Rig();
    expect(rig.controller.isTouching).toBe(false);
    rig.finger("pointerdown", 10, 0, 0, 1);
    expect(rig.controller.isTouching).toBe(true);
    rig.finger("pointerup", 10, 0, 0, 2);
    expect(rig.controller.isTouching).toBe(false);
    rig.finger("pointerdown", 10, 0, 0, 3);
    rig.pen("pointerdown", 1, { x: 0, y: 0 });
    expect(rig.controller.isTouching).toBe(false);
  });
});

describe("pen and fingers together", () => {
  it("a pen landing voids a finger pan, and the finger stays out of it", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 100, 200, 1);
    rig.finger("pointermove", 10, 110, 190, 2);
    rig.take();
    rig.pen("pointerdown", 1, { x: 5, y: 5, t: 3 });
    expect(rig.take()).toEqual([
      "panCancel",
      "debug down pen#1 p=0.5 c=0 t=3",
      "start 1005,2005 p=0.5 tilt=0,0",
    ]);
    expect(rig.captured).toEqual([1]);
    rig.finger("pointermove", 10, 120, 180, 4);
    rig.finger("pointerup", 10, 120, 180, 5);
    expect(rig.take()).toEqual([]);
    rig.pen("pointerup", 1, { x: 5, y: 5, t: 6 });
    expect(rig.take()).toEqual(["debug up pen#1 p=0.5 c=0 t=6", "end 1005,2005 p=0.5 tilt=0,0"]);
  });

  it("a pen landing mid-pinch voids it with a pan cancel and no pinch end", () => {
    const rig = new Rig();
    rig.finger("pointerdown", 10, 0, 0, 1);
    rig.finger("pointerdown", 11, 100, 0, 2);
    rig.take();
    rig.pen("pointerdown", 1, { x: 0, y: 0, t: 3 });
    expect(rig.take()).toEqual([
      "panCancel",
      "debug down pen#1 p=0.5 c=0 t=3",
      "start 1000,2000 p=0.5 tilt=0,0",
    ]);
    expect(rig.captured).toEqual([1]);
  });

  it("a palm on the glass while the pen writes does nothing, before or after the lift", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0, t: 1 });
    rig.take();
    const palm = rig.finger("pointerdown", 20, 300, 300, 2);
    rig.finger("pointermove", 20, 310, 305, 3);
    rig.finger("pointerdown", 21, 320, 320, 4);
    rig.finger("pointercancel", 21, 320, 320, 5);
    expect(rig.take()).toEqual([]);
    expect(palm.prevented).toBe(false);
    expect(rig.captured).toEqual([1]);
    rig.pen("pointerup", 1, { x: 9, y: 9, t: 6 });
    rig.take();
    // The palm is still resting: its moves and lift stay ignored.
    rig.finger("pointermove", 20, 315, 310, 7);
    rig.finger("pointerup", 20, 315, 310, 8);
    expect(rig.take()).toEqual([]);
    // A new finger after the lift scrolls again, at once: a touch left out
    // stays out until it lifts, and that made pinches die (2026-09-30).
    rig.finger("pointerdown", 22, 0, 0, 9);
    expect(rig.take()).toEqual(["panStart 0,0 t=9"]);
  });

  it("fingers scroll again once the pen lifts", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0 });
    rig.pen("pointerup", 1, { x: 0, y: 0 });
    rig.take();
    rig.finger("pointerdown", 10, 1, 2, 3);
    expect(rig.take()).toEqual(["panStart 1,2 t=3"]);
  });

  it("Stylus-only mode lets the pen draw and ignores every other pointer, live", () => {
    const rig = new Rig();
    rig.onlyStylus.on = true;
    const finger = rig.finger("pointerdown", 10, 1, 2, 3);
    const mouse = rig.fire("pointerdown", 11, "mouse", { x: 5, y: 6, t: 4 });
    rig.finger("pointermove", 10, 20, 30, 5);
    rig.fire("pointermove", 11, "mouse", { x: 25, y: 35, t: 6 });
    rig.finger("pointerup", 10, 20, 30, 7);
    rig.fire("pointerup", 11, "mouse", { x: 25, y: 35, t: 8 });
    expect(rig.take()).toEqual([]);
    expect(finger.prevented).toBe(true);
    expect(mouse.prevented).toBe(true);
    expect(rig.captured).toEqual([]);

    const pen = rig.pen("pointerdown", 1, { x: 0, y: 0, t: 9 });
    expect(rig.take()).toEqual([
      "debug down pen#1 p=0.5 c=0 t=9",
      "start 1000,2000 p=0.5 tilt=0,0",
    ]);
    expect(pen.prevented).toBe(true);
    // A hand on the glass while the pen writes stays ignored too.
    rig.finger("pointerdown", 12, 300, 300, 10);
    rig.finger("pointermove", 12, 310, 305, 11);
    expect(rig.take()).toEqual([]);
    rig.pen("pointerup", 1, { x: 9, y: 9, t: 12 });
    rig.take();
    rig.finger("pointerup", 12, 310, 305, 13);
    expect(rig.take()).toEqual([]);

    // The switch is read for every press: off again, the same finger pans.
    rig.onlyStylus.on = false;
    rig.finger("pointerdown", 13, 1, 2, 14);
    expect(rig.take()).toEqual(["panStart 1,2 t=14"]);
  });

  it("a hovering pen and a wide contact do not keep a finger out", () => {
    const rig = new Rig();
    rig.pen("pointermove", 1, { x: 0, y: 0, t: 1000 });
    rig.fire("pointerdown", 10, "touch", { x: 1, y: 2, t: 1001, width: 30, height: 120 });
    expect(rig.take()).toEqual(["panStart 1,2 t=1001"]);
  });
});

describe("a listener without the optional callbacks", () => {
  it("still gets strokes, and fingers do nothing", () => {
    const rig = new Rig("required");
    rig.finger("pointerdown", 10, 0, 0, 1);
    rig.finger("pointerdown", 11, 100, 0, 2);
    rig.finger("pointermove", 11, 200, 0, 3);
    rig.finger("pointerup", 11, 200, 0, 4);
    rig.finger("pointerup", 10, 0, 0, 5);
    expect(rig.take()).toEqual([]);
    rig.finger("pointerdown", 10, 0, 0, 6);
    rig.pen("pointerdown", 1, { x: 0, y: 0 });
    rig.pen("pointerdown", 2, { x: 0, y: 0 });
    rig.pen("pointermove", 2, { x: 1, y: 1 });
    rig.pen("pointercancel", 2, { x: 1, y: 1 });
    expect(rig.take()).toEqual([
      "start 1000,2000 p=0.5 tilt=0,0",
      "cancel",
      "start 1000,2000 p=0.5 tilt=0,0",
      "move [1001,2001 p=0.5 tilt=0,0]",
      "cancel",
    ]);
  });
});

describe("space held: the hand (FineNotes#7)", () => {
  it("a pen coming down pans like a finger, and draws nothing", () => {
    const rig = new Rig();
    rig.hand.held = true;
    const down = rig.pen("pointerdown", 1, { x: 10, y: 20, t: 1 });
    rig.pen("pointermove", 1, { x: 15, y: 60, t: 2 });
    rig.pen("pointerup", 1, { x: 15, y: 60, t: 3 });
    expect(rig.take()).toEqual(["panStart 10,20 t=1", "panMove 15,60 t=2", "panEnd t=3"]);
    expect(down.prevented).toBe(true);
    expect(rig.captured).toEqual([]);
  });

  it("so does a mouse", () => {
    const rig = new Rig();
    rig.hand.held = true;
    rig.fire("pointerdown", 1, "mouse", { x: 0, y: 0, t: 1 });
    expect(rig.captured).toEqual([1]);
    rig.fire("pointerup", 1, "mouse", { x: 0, y: 30, t: 2 });
    expect(rig.take()).toEqual(["panStart 0,0 t=1", "panEnd t=2"]);
  });

  it("leaves a stroke already under way to finish", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 10, y: 20 });
    rig.hand.held = true;
    rig.pen("pointermove", 1, { x: 12, y: 22 });
    rig.pen("pointerup", 1, { x: 12, y: 22 });
    expect(rig.take().filter((line) => !line.startsWith("debug"))).toEqual([
      "start 1010,2020 p=0.5 tilt=0,0",
      "move [1012,2022 p=0.5 tilt=0,0]",
      "end 1012,2022 p=0.5 tilt=0,0",
    ]);
  });

  it("draws again once space is let go", () => {
    const rig = new Rig();
    rig.hand.held = true;
    rig.pen("pointerdown", 1, { x: 1, y: 1, t: 1 });
    rig.pen("pointerup", 1, { x: 1, y: 1, t: 2 });
    rig.hand.held = false;
    rig.take();
    rig.pen("pointerdown", 2, { x: 5, y: 5 });
    expect(rig.take()).toContain("start 1005,2005 p=0.5 tilt=0,0");
  });
});

describe("finger double taps", () => {
  /** Fingers `ids` land together about (200, 300) at `t`, and lift 100 ms later. */
  function tap(rig: Rig, ids: number[], t: number): void {
    ids.forEach((id, i) => rig.finger("pointerdown", id, 200 + i * 60, 300, t + i * 5));
    ids.forEach((id, i) => rig.finger("pointerup", id, 200 + i * 60, 300, t + 100 + i * 5));
  }
  const taps = (rig: Rig): string[] => rig.take().filter((line) => line.startsWith("doubleTap"));

  it("reports a two-finger double tap", () => {
    const rig = new Rig();
    tap(rig, [1, 2], 1000);
    tap(rig, [3, 4], 1250);
    expect(taps(rig)).toEqual(["doubleTap 2"]);
  });

  it("reports a three-finger double tap, though the scroll gesture takes only two", () => {
    const rig = new Rig();
    tap(rig, [1, 2, 3], 1000);
    tap(rig, [4, 5, 6], 1250);
    expect(taps(rig)).toEqual(["doubleTap 3"]);
    // The third finger was never captured, so releasing it threw nothing.
    expect(rig.captured).toEqual([]);
  });

  it("is voided by a pen landing in between", () => {
    const rig = new Rig();
    tap(rig, [1, 2], 1000);
    rig.pen("pointerdown", 9, { x: 50, y: 50, t: 1150 });
    rig.pen("pointerup", 9, { x: 50, y: 50, t: 1160 });
    tap(rig, [3, 4], 1250);
    expect(taps(rig)).toEqual([]);
  });

  it("counts a finger the browser cancels at once as lifted (Android system gestures)", () => {
    const rig = new Rig();
    tap(rig, [1, 2], 1000);
    rig.finger("pointerdown", 3, 200, 300, 1250);
    rig.finger("pointerdown", 4, 260, 300, 1255);
    rig.finger("pointercancel", 3, 200, 300, 1300);
    rig.finger("pointerup", 4, 260, 300, 1305);
    expect(taps(rig)).toEqual(["doubleTap 2"]);
  });

  it("ignores a touch while a stroke is open (the writing hand)", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 9, { x: 50, y: 50, t: 990 });
    tap(rig, [1, 2], 1000);
    tap(rig, [3, 4], 1250);
    expect(taps(rig)).toEqual([]);
  });
});

describe("what the press menu's hold reads (finger-hold.ts)", () => {
  function holdRig(): { el: StandInElement; controller: PointerController; log: string[] } {
    const el = new StandInElement();
    const log: string[] = [];
    const controller = new PointerController(el as unknown as HTMLElement, toSurface, {
      onStart: (s) => log.push(`start ${show(s)}`),
      onMove: () => log.push("move"),
      onEnd: () => log.push("end"),
      onCancel: () => log.push("cancel"),
      onPanStart: () => log.push("panStart"),
      onPanEnd: (t) => log.push(`panEnd t=${t}`),
      onFingerContact: (w, h) => log.push(`contact ${w}x${h}`),
      onFingerCancel: (t) => log.push(`fingerCancel t=${t}`),
    });
    controller.attach();
    return { el, controller, log };
  }
  const fire = (el: StandInElement, phase: Phase, id: number, type: string, c: Contact): void =>
    el.listeners.get(phase)?.(eventFor(id, type, c));

  it("remembers when a pen last did anything, hovering included", () => {
    const { el, controller } = holdRig();
    expect(controller.lastPenAt).toBeNull();
    fire(el, "pointermove", 1, "pen", { x: 1, y: 1, t: 40 });
    expect(controller.lastPenAt).toBe(40);
    fire(el, "pointerdown", 1, "pen", { x: 1, y: 1, t: 50 });
    fire(el, "pointerup", 1, "pen", { x: 1, y: 1, t: 90 });
    expect(controller.lastPenAt).toBe(90);
    // Fingers and the mouse are no pen.
    fire(el, "pointerdown", 2, "touch", { x: 1, y: 1, t: 200 });
    fire(el, "pointerdown", 3, "mouse", { x: 1, y: 1, t: 300 });
    expect(controller.lastPenAt).toBe(90);
  });

  it("reports a finger's contact size once the pan has started, and as it moves", () => {
    const { el, log } = holdRig();
    fire(el, "pointerdown", 2, "touch", { x: 5, y: 5, t: 1, width: 30, height: 40 });
    fire(el, "pointermove", 2, "touch", { x: 6, y: 5, t: 2, width: 90, height: 80 });
    expect(log).toEqual(["panStart", "contact 30x40", "contact 90x80"]);
  });

  it("tells a cancelled finger from a lifted one, just before the pan ends", () => {
    const { el, log } = holdRig();
    fire(el, "pointerdown", 2, "touch", { x: 5, y: 5, t: 1 });
    fire(el, "pointercancel", 2, "touch", { x: 5, y: 5, t: 600 });
    fire(el, "pointerdown", 3, "touch", { x: 5, y: 5, t: 700 });
    fire(el, "pointerup", 3, "touch", { x: 5, y: 5, t: 800 });
    expect(log.filter((line) => !line.startsWith("contact"))).toEqual([
      "panStart",
      "fingerCancel t=600",
      "panEnd t=600",
      "panStart",
      "panEnd t=800",
    ]);
  });

  it("never draws with the right mouse button: it opens the page's menu", () => {
    const { el, log } = holdRig();
    fire(el, "pointerdown", 1, "mouse", { x: 5, y: 5, button: 2 });
    fire(el, "pointermove", 1, "mouse", { x: 9, y: 9 });
    fire(el, "pointerup", 1, "mouse", { x: 9, y: 9, button: 2 });
    expect(log).toEqual([]);
    expect(el.captured.size).toBe(0);
    fire(el, "pointerdown", 1, "mouse", { x: 5, y: 5, button: 0 });
    expect(log).toEqual(["start 1005,2005 p=0.5 tilt=0,0"]);
  });

  it("lets a pen draw whatever button it reports (a barrel button is no right-click)", () => {
    const { el, log } = holdRig();
    fire(el, "pointerdown", 1, "pen", { x: 5, y: 5, button: 2 });
    expect(log).toEqual(["start 1005,2005 p=0.5 tilt=0,0"]);
  });
});

describe("the pen's side button clicked in the air (stylus-click.ts)", () => {
  /** A controller whose presses route as `route` says, with clicks wanted while `wanted.on`. */
  function clickRig(route: PressRoute = "draw") {
    const el = new StandInElement();
    const log: string[] = [];
    const wanted = { on: true };
    const controller = new PointerController(
      el as unknown as HTMLElement,
      toSurface,
      {
        onStart: (s) => log.push(`start ${show(s)}`),
        onMove: (c) => log.push(`move ${c.length}`),
        onEnd: () => log.push("end"),
        onCancel: () => log.push("cancel"),
        onPanStart: (x, y) => log.push(`panStart ${x},${y}`),
        onPanMove: (x, y) => log.push(`panMove ${x},${y}`),
        onPanEnd: () => log.push("panEnd"),
        onStylusClick: (x, y) => log.push(`click ${x},${y}`),
      },
      { route: () => route, stylusClicks: () => wanted.on },
    );
    controller.attach();
    const fire = (phase: Phase, c: Contact, type = "pen"): StandInEvent => {
      const event = eventFor(1, type, c);
      el.listeners.get(phase)?.(event);
      return event;
    };
    return { el, controller, log, wanted, fire };
  }

  it("holds the press back, and a quick let-go near where it began is the click", () => {
    const { el, log, fire } = clickRig();
    const down = fire("pointerdown", { x: 10, y: 10, t: 0, button: 2, buttons: 2, pressure: 0 });
    expect(down.prevented).toBe(true);
    expect([...el.captured]).toEqual([1]);
    fire("pointermove", { x: 12, y: 11, t: 40, buttons: 2, pressure: 0 });
    fire("pointerup", { x: 12, y: 11, t: 200, button: 2, buttons: 0, pressure: 0 });
    expect(log).toEqual(["click 12,11"]);
    expect(el.captured.size).toBe(0);
  });

  it("writes as the barrel says once the held press touches down: the press, then the move", () => {
    const { log, fire } = clickRig();
    fire("pointerdown", { x: 10, y: 10, t: 0, button: 2, buttons: 2, pressure: 0 });
    fire("pointermove", { x: 11, y: 10, t: 900, buttons: 3, pressure: 0.4 });
    fire("pointermove", { x: 30, y: 10, t: 920, buttons: 3, pressure: 0.5 });
    fire("pointerup", { x: 30, y: 10, t: 950, buttons: 0, pressure: 0 });
    expect(log).toEqual(["start 1010,2010 p=0 tilt=0,0", "move 1", "move 1", "end"]);
  });

  it("is a hovering stroke once it travels, and a pan when the barrel moves the page", () => {
    const drawn = clickRig();
    drawn.fire("pointerdown", { x: 10, y: 10, t: 0, button: 2, buttons: 2, pressure: 0 });
    drawn.fire("pointermove", { x: 40, y: 10, t: 50, buttons: 2, pressure: 0 });
    drawn.fire("pointerup", { x: 40, y: 10, t: 80, button: 2, buttons: 0, pressure: 0 });
    expect(drawn.log).toEqual(["start 1010,2010 p=0 tilt=0,0", "move 1", "end"]);

    const panned = clickRig("pan");
    panned.fire("pointerdown", { x: 10, y: 10, t: 0, button: 2, buttons: 2, pressure: 0 });
    panned.fire("pointermove", { x: 40, y: 10, t: 50, buttons: 2, pressure: 0 });
    panned.fire("pointerup", { x: 40, y: 10, t: 80, button: 2, buttons: 0, pressure: 0 });
    expect(panned.log).toEqual(["panStart 10,10", "panMove 40,10", "panEnd"]);
  });

  it("lets a second press of the held pointer, touching down, write in its place", () => {
    const { el, log, fire } = clickRig();
    fire("pointerdown", { x: 10, y: 10, t: 0, button: 2, buttons: 2, pressure: 0 });
    fire("pointerdown", { x: 11, y: 10, t: 300, button: 0, buttons: 3, pressure: 0.4 });
    fire("pointermove", { x: 20, y: 10, t: 320, buttons: 3, pressure: 0.5 });
    fire("pointerup", { x: 20, y: 10, t: 350, buttons: 0, pressure: 0 });
    expect(log).toEqual(["start 1011,2010 p=0.4 tilt=0,0", "move 1", "end"]);
    expect(el.captured.size).toBe(0);
  });

  it("is nothing held too long without moving", () => {
    const { log, fire } = clickRig();
    fire("pointerdown", { x: 10, y: 10, t: 0, button: 2, buttons: 2, pressure: 0 });
    fire("pointerup", { x: 10, y: 10, t: 4000, button: 2, buttons: 0, pressure: 0 });
    expect(log).toEqual([]);
  });

  it("draws as before when no click is wanted, or the pen comes down to write", () => {
    const { log, wanted, fire } = clickRig();
    wanted.on = false;
    fire("pointerdown", { x: 10, y: 10, t: 0, button: 2, buttons: 2, pressure: 0 });
    expect(log).toEqual(["start 1010,2010 p=0 tilt=0,0"]);
    fire("pointerup", { x: 10, y: 10, t: 50, button: 2, buttons: 0 });
    log.length = 0;
    wanted.on = true;
    fire("pointerdown", { x: 10, y: 10, t: 100, button: 0, buttons: 3 });
    expect(log).toEqual(["start 1010,2010 p=0.5 tilt=0,0"]);
  });

  it("hears the click in hovering moves when no press comes, once", () => {
    const { log, fire } = clickRig();
    fire("pointermove", { x: 10, y: 10, t: 0, buttons: 0, pressure: 0 });
    fire("pointermove", { x: 10, y: 10, t: 20, buttons: 2, pressure: 0 });
    fire("pointermove", { x: 11, y: 10, t: 120, buttons: 0, pressure: 0 });
    fire("pointermove", { x: 12, y: 10, t: 140, buttons: 0, pressure: 0 });
    expect(log).toEqual(["click 11,10"]);
  });

  it("hears the click as Android's WebView reports it: the contact bit, no pressure, no press", () => {
    const { log, fire } = clickRig();
    fire("pointermove", { x: 10, y: 10, t: 0, buttons: 0, pressure: 0 });
    fire("pointermove", { x: 10, y: 10, t: 20, buttons: 1, pressure: 0 });
    fire("pointermove", { x: 11, y: 10, t: 120, buttons: 1, pressure: 0 });
    fire("pointermove", { x: 11, y: 10, t: 160, buttons: 0, pressure: 0 });
    expect(log).toEqual(["click 11,10"]);
  });

  /** A pen event over the rest of the view, off the controller's element. */
  function elsewhere(controller: PointerController, type: Phase, c: Contact): void {
    controller.penElsewhere({ ...eventFor(1, "pen", c), type } as unknown as PointerEvent);
  }

  it("hears the click over the rest of the view, off its element (the popover the click opened)", () => {
    const { controller, log, wanted } = clickRig();
    const over = (c: Contact) => elsewhere(controller, "pointermove", c);
    over({ x: 10, y: 10, t: 0, buttons: 1, pressure: 0 });
    over({ x: 10, y: 10, t: 150, buttons: 0, pressure: 0 });
    expect(log).toEqual(["click 10,10"]);
    // Not when no click is wanted.
    wanted.on = false;
    over({ x: 10, y: 10, t: 900, buttons: 1, pressure: 0 });
    over({ x: 10, y: 10, t: 1000, buttons: 0, pressure: 0 });
    expect(log).toEqual(["click 10,10"]);
  });

  it("hears no click from a pen down on the tool bar, though its moves have no pressure", () => {
    const { controller, log } = clickRig();
    elsewhere(controller, "pointerdown", { x: 10, y: 10, t: 0, buttons: 1, pressure: 0 });
    elsewhere(controller, "pointermove", { x: 10, y: 10, t: 20, buttons: 1, pressure: 0 });
    elsewhere(controller, "pointerup", { x: 10, y: 10, t: 80, buttons: 0, pressure: 0 });
    elsewhere(controller, "pointermove", { x: 10, y: 10, t: 120, buttons: 0, pressure: 0 });
    // Its pointerup never came: the first move with no button is the pen in the air.
    elsewhere(controller, "pointerdown", { x: 10, y: 10, t: 500, buttons: 1, pressure: 0 });
    elsewhere(controller, "pointermove", { x: 10, y: 10, t: 520, buttons: 1, pressure: 0 });
    elsewhere(controller, "pointermove", { x: 10, y: 10, t: 600, buttons: 0, pressure: 0 });
    expect(log).toEqual([]);
  });

  it("hears no click from a pen down on the page that writes nothing (the margin)", () => {
    const { log, fire } = clickRig("ignore");
    fire("pointerdown", { x: 10, y: 10, t: 0, buttons: 1, pressure: 0.3 });
    fire("pointermove", { x: 10, y: 10, t: 20, buttons: 1, pressure: 0 });
    fire("pointermove", { x: 10, y: 10, t: 60, buttons: 0, pressure: 0 });
    expect(log).toEqual([]);
  });

  it("hears no click after a press it never had: its pointerup ends the watch", () => {
    const { log, fire } = clickRig();
    // A popover took the pointerdown (popover-dismiss.ts); its moves still come.
    fire("pointermove", { x: 10, y: 10, t: 20, buttons: 2, pressure: 0 });
    fire("pointerup", { x: 10, y: 10, t: 100, button: 2, buttons: 0, pressure: 0 });
    fire("pointermove", { x: 10, y: 10, t: 120, buttons: 0, pressure: 0 });
    expect(log).toEqual([]);
  });

  it("takes a pen's contextmenu for the click only when the pointer events had none", () => {
    const { controller, log, wanted, fire } = clickRig();
    expect(controller.stylusMenu(10)).toBe(true);
    // The same click again through the press: one click.
    fire("pointerdown", { x: 10, y: 10, t: 30, button: 2, buttons: 2, pressure: 0 });
    fire("pointerup", { x: 10, y: 10, t: 90, button: 2, buttons: 0, pressure: 0 });
    expect(log).toEqual([]);
    // Never while the pen writes (Chromium's long press), nor when no click is wanted.
    fire("pointerdown", { x: 10, y: 10, t: 5000, buttons: 1 });
    expect(controller.stylusMenu(5600)).toBe(false);
    fire("pointerup", { x: 10, y: 10, t: 5700 });
    wanted.on = false;
    expect(controller.stylusMenu(9000)).toBe(false);
  });

  it("takes no contextmenu for the click just after a stroke (Windows' press-and-hold)", () => {
    const { controller, fire } = clickRig();
    fire("pointerdown", { x: 10, y: 10, t: 0, buttons: 1 });
    fire("pointerup", { x: 40, y: 10, t: 2000 });
    expect(controller.stylusMenu(2050)).toBe(false);
    expect(controller.stylusMenu(2000 + MENU_AFTER_LIFT_MS + 1)).toBe(true);
  });
});
