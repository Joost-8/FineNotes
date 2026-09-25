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
  PointerController,
  type PointerControllerCallbacks,
  type PointerDebugRecord,
  type PointerSample,
} from "../../src/input/pointer-controller";

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

  constructor(only?: "required") {
    const log = this.log;
    const required: PointerControllerCallbacks = {
      onStart: (s) => {
        this.samples.push(s);
        log.push(`start ${show(s)}`);
      },
      onMove: (c, p) =>
        log.push(`move [${c.map(show).join(" | ")}] predicted [${p.map(show).join(" | ")}]`),
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
      "move [1012,2022 p=0.51 tilt=0,0 | 1020,2030 p=0.55 tilt=0,0 | 1030,2040 p=0.6 tilt=0,0]" +
        " predicted [1040,2050 p=0.6 tilt=0,0 | 1050,2060 p=0.6 tilt=0,0]",
    ]);
    expect(move.prevented).toBe(true);

    // The pen-up's own sample ends the stroke; nothing predicted comes back.
    const up = rig.pen("pointerup", 1, { x: 31, y: 41, t: 7, pressure: 0 });
    expect(rig.take()).toEqual(["debug up pen#1 p=0 c=0 t=7", "end 1031,2041 p=0 tilt=0,0"]);
    expect(up.prevented).toBe(true);
    expect(rig.captured).toEqual([]);
  });

  it("hands over samples and HUD records with exactly these fields", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 7, { x: 1, y: 2, t: 3, pressure: 0.25, tiltX: -5, tiltY: 6 });
    rig.pen("pointermove", 7, { x: 2, y: 3, t: 4, coalesced: [{ x: 2, y: 3 }] });
    expect(rig.samples[0]).toEqual({ x: 1001, y: 2002, pressure: 0.25, tiltX: -5, tiltY: 6 });
    expect(rig.records).toEqual([
      {
        type: "down",
        pointerType: "pen",
        pointerId: 7,
        pressure: 0.25,
        coalesced: 0,
        timeStamp: 3,
      },
      { type: "move", pointerType: "pen", pointerId: 7, pressure: 0.5, coalesced: 1, timeStamp: 4 },
    ]);
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
      "move [1005,2006 p=0.5 tilt=0,0] predicted []",
      "debug move pen#1 p=0.5 c=1 t=2",
      "move [1007,2008 p=0.5 tilt=0,0] predicted []",
    ]);
  });

  it("does not add the event's own position to coalesced samples that exist", () => {
    const rig = new Rig();
    rig.pen("pointerdown", 1, { x: 0, y: 0 });
    rig.take();
    rig.pen("pointermove", 1, { x: 99, y: 99, coalesced: [{ x: 1, y: 1 }] });
    expect(rig.take()).toEqual([
      "debug move pen#1 p=0.5 c=1 t=0",
      "move [1001,2001 p=0.5 tilt=0,0] predicted []",
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
      "move [1020,2000 p=0.5 tilt=0,0] predicted []",
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
    // A new finger after the lift scrolls again.
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
      "move [1001,2001 p=0.5 tilt=0,0] predicted []",
      "cancel",
    ]);
  });
});
