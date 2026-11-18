import { describe, expect, it, vi } from "vitest";
import {
  PointerController,
  type PointerControllerCallbacks,
  type PointerControllerOptions,
  type PointerSample,
} from "../../src/input/pointer-controller";
import type { PressInput } from "../../src/input/pen-modifiers";
import { StylusSelectBridge } from "../../src/input/stylus-select-bridge";

type Listener = (event: unknown) => void;

interface FakeText {
  nodeType: 3;
  length: number;
  data: string;
  parentElement: FakeDiv;
}

class FakeClassList {
  readonly tokens = new Set<string>();
  add(name: string): void {
    this.tokens.add(name);
  }
  remove(name: string): void {
    this.tokens.delete(name);
  }
  contains(name: string): boolean {
    return this.tokens.has(name);
  }
}

class FakeDiv {
  readonly classList = new FakeClassList();
  readonly listeners = new Map<string, Listener>();
  readonly dataset: Record<string, string> = {};
  readonly children: FakeDiv[] = [];
  readonly textNodes: FakeText[] = [];
  tagName = "DIV";
  ownerDocument: FakeDocument;

  constructor(
    doc: FakeDocument,
    public width = 800,
    public height = 600,
  ) {
    this.ownerDocument = doc;
  }

  createDiv(opts?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeDiv {
    const child = new FakeDiv(this.ownerDocument, this.width, 6);
    if (opts?.cls) child.classList.add(opts.cls);
    if (opts?.attr?.["data-row"]) child.dataset.row = opts.attr["data-row"];
    if (opts?.text) {
      child.textNodes.push({
        nodeType: 3,
        length: opts.text.length,
        data: opts.text,
        parentElement: child,
      });
    }
    this.children.push(child);
    return child;
  }

  empty(): void {
    this.children.length = 0;
  }

  remove(): void {
    // Detached in test.
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    for (const child of this.children) {
      if (node === child) return true;
      for (const text of child.textNodes) {
        if (node === text) return true;
      }
    }
    return false;
  }

  textAt(row: number): FakeText {
    return this.children[row].textNodes[0];
  }
}

class FakeHost extends FakeDiv {
  readonly captured = new Set<number>();

  setPointerCapture(id: number): void {
    this.captured.add(id);
  }

  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }

  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
}

interface FakeSelection {
  rangeCount: number;
  anchorNode: FakeText | null;
  anchorOffset: number;
  focusNode: FakeText | null;
  focusOffset: number;
  isCollapsed: boolean;
  removeAllRanges: () => void;
}

class FakeDocument {
  readonly listeners = new Map<string, Listener>();
  readonly defaultView = {
    setTimeout: (fn: () => void, ms?: number): number =>
      globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id?: number): void =>
      globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  };
  selection: FakeSelection = {
    rangeCount: 0,
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    isCollapsed: true,
    removeAllRanges: () => {
      this.selection.rangeCount = 0;
      this.selection.anchorNode = null;
      this.selection.focusNode = null;
    },
  };

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  getSelection(): FakeSelection {
    return this.selection;
  }

  createRange(): {
    startNode: FakeText | null;
    startOffset: number;
    endOffset: number;
    setStart: (node: FakeText, offset: number) => void;
    setEnd: (node: FakeText, offset: number) => void;
    getBoundingClientRect: () => {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
    };
  } {
    const range = {
      startNode: null as FakeText | null,
      startOffset: 0,
      endOffset: 0,
      setStart(node: FakeText, offset: number): void {
        this.startNode = node;
        this.startOffset = offset;
      },
      setEnd(_node: FakeText, offset: number): void {
        this.endOffset = offset;
      },
      getBoundingClientRect(): {
        left: number;
        right: number;
        top: number;
        bottom: number;
        width: number;
        height: number;
      } {
        const row = Number(this.startNode?.parentElement.dataset.row ?? 0);
        const left = this.startOffset * 6;
        const right = this.endOffset * 6;
        const top = row * 6;
        const bottom = top + 6;
        return {
          left,
          right,
          top,
          bottom,
          width: Math.max(0, right - left),
          height: 6,
        };
      },
    };
    return range;
  }

  setSelection(
    anchorNode: FakeText,
    anchorOffset: number,
    focusNode: FakeText,
    focusOffset: number,
  ): void {
    this.selection.rangeCount = 1;
    this.selection.anchorNode = anchorNode;
    this.selection.anchorOffset = anchorOffset;
    this.selection.focusNode = focusNode;
    this.selection.focusOffset = focusOffset;
    this.selection.isCollapsed = anchorNode === focusNode && anchorOffset === focusOffset;
    this.listeners.get("selectionchange")?.({});
  }
}

function pointerEvent(overrides: Partial<PointerEvent>): PointerEvent {
  return {
    pointerId: 1,
    pointerType: "pen",
    clientX: 160,
    clientY: 160,
    pressure: 0,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 100,
    width: 1,
    height: 1,
    button: 0,
    buttons: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {},
    getCoalescedEvents: () => [],
    ...overrides,
  } as unknown as PointerEvent;
}

function setupController(
  options: PointerControllerOptions = {},
  rectMode: "normal" | "zero" = "normal",
) {
  const doc = new FakeDocument();
  if (rectMode === "zero") {
    doc.createRange = () => ({
      startNode: null as FakeText | null,
      startOffset: 0,
      endOffset: 0,
      setStart(node: FakeText, offset: number): void {
        this.startNode = node;
        this.startOffset = offset;
      },
      setEnd(_node: FakeText, offset: number): void {
        this.endOffset = offset;
      },
      getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
    });
  }
  const host = new FakeHost(doc);
  const events: string[] = [];
  const callbacks: PointerControllerCallbacks = {
    onStart: (sample: PointerSample, press: PressInput) => {
      events.push(`start(${sample.x},${sample.y},buttons=${press.buttons})`);
    },
    onMove: (coalesced: PointerSample[]) => {
      for (const s of coalesced) events.push(`move(${s.x},${s.y})`);
    },
    onEnd: (sample: PointerSample) => {
      events.push(`end(${sample.x},${sample.y})`);
    },
    onCancel: () => events.push("cancel"),
    onPanStart: (x, y) => events.push(`panStart(${x},${y})`),
    onPanMove: (x, y) => events.push(`panMove(${x},${y})`),
    onPanEnd: () => events.push("panEnd"),
    onPanCancel: () => events.push("panCancel"),
    onStylusClick: (x, y) => events.push(`click(${x},${y})`),
  };
  const controller = new PointerController(
    host as unknown as HTMLElement,
    (x, y) => ({ x, y }),
    callbacks,
    { stylusClicks: () => true, ...options },
  );
  controller.attach();
  const bridgeEl = host.children[0];
  return { doc, host, bridgeEl, controller, events };
}

describe("StylusSelectBridge", () => {
  it("arms on any pen hover, tracks is-barrel-held, and supports simultaneous button+touch after lift", () => {
    const { doc, host, bridgeEl, events, controller } = setupController();
    const move = host.listeners.get("pointermove")!;
    const down = host.listeners.get("pointerdown")!;
    const up = host.listeners.get("pointerup")!;

    // Plain pen hover (buttons=0) pre-arms is-active so simultaneous BTN_STYLUS + BTN_TOUCH succeeds.
    move(pointerEvent({ clientX: 200, clientY: 120, buttons: 0, pressure: 0, timeStamp: 50 }));
    expect(bridgeEl.classList.contains("is-active")).toBe(true);
    expect(bridgeEl.classList.contains("is-barrel-held")).toBe(false);
    expect(bridgeEl.children.length).toBeGreaterThan(20);
    expect(bridgeEl.textAt(0).data.startsWith("\u5341")).toBe(true);

    // Android S-Pen hover with barrel button held: buttons=1, pressure=0 -> also sets is-barrel-held.
    move(pointerEvent({ clientX: 200, clientY: 120, buttons: 1, pressure: 0, timeStamp: 100 }));
    expect(bridgeEl.classList.contains("is-active")).toBe(true);
    expect(bridgeEl.classList.contains("is-barrel-held")).toBe(true);

    // Release button in the air -> click triggers, is-barrel-held clears, bridge stays armed.
    move(pointerEvent({ clientX: 200, clientY: 120, buttons: 0, pressure: 0, timeStamp: 180 }));
    expect(bridgeEl.classList.contains("is-barrel-held")).toBe(false);
    expect(bridgeEl.classList.contains("is-active")).toBe(true);
    expect(events).toEqual(["click(200,120)"]);

    // Normal pen writing stroke disarms on pointerdown and re-arms on clean pointerup.
    down(pointerEvent({ clientX: 120, clientY: 120, buttons: 1, pressure: 0.4, timeStamp: 200 }));
    expect(bridgeEl.classList.contains("is-active")).toBe(false);
    up(pointerEvent({ clientX: 120, clientY: 120, buttons: 0, pressure: 0, timeStamp: 250 }));
    expect(bridgeEl.classList.contains("is-active")).toBe(true);
    expect(bridgeEl.classList.contains("is-barrel-held")).toBe(false);

    // Simultaneous BTN_STYLUS + BTN_TOUCH immediately after pointerup works without hover move.
    doc.setSelection(bridgeEl.textAt(20), 20, bridgeEl.textAt(20), 22);
    expect(controller.stylusTouched()).toBe(true);
    move(pointerEvent({ clientX: 132, clientY: 123, buttons: 0, pressure: 0, timeStamp: 280 }));
    expect(controller.stylusTouched()).toBe(true);
    expect(events).toEqual([
      "click(200,120)",
      "start(120,120,buttons=1)",
      "end(120,120)",
      "start(120,123,buttons=3)",
      "move(132,123)",
      "end(132,123)",
    ]);

    controller.detach();
  });

  it("drives a full barrel stroke forward via focus, mid-stroke re-anchor, and backward/upward via anchor", () => {
    const { doc, host, bridgeEl, events, controller } = setupController();
    const move = host.listeners.get("pointermove")!;

    // Hover with side button pressed at (120, 120) -> col 20, row 20.
    move(pointerEvent({ clientX: 120, clientY: 120, buttons: 1, pressure: 0, timeStamp: 100 }));
    expect(bridgeEl.classList.contains("is-active")).toBe(true);
    expect(bridgeEl.classList.contains("is-barrel-held")).toBe(true);

    // Chromium StylusTextSelector starts selection forward (col 20->24, row 20->22).
    doc.setSelection(bridgeEl.textAt(20), 20, bridgeEl.textAt(22), 24);
    expect(events).toEqual(["start(120,123,buttons=3)", "move(144,135)"]);

    // Drag backward/upward past anchor: Blink swaps anchor to move while focus stays at (20, 20).
    doc.setSelection(bridgeEl.textAt(15), 12, bridgeEl.textAt(20), 20);
    expect(events).toEqual(["start(120,123,buttons=3)", "move(144,135)", "move(72,93)"]);

    // Mid-stroke button release/re-press re-anchors collapsed at (15, 12) = (72, 93).
    doc.setSelection(bridgeEl.textAt(15), 12, bridgeEl.textAt(15), 12);
    // Moving back toward old basePt (120, 123) picks focus (96, 111) over slightly shifted anchor.
    doc.setSelection(bridgeEl.textAt(15), 13, bridgeEl.textAt(18), 16);
    // Dragging backward across the new anchor tracks anchor (60, 87).
    doc.setSelection(bridgeEl.textAt(14), 10, bridgeEl.textAt(15), 13);
    expect(events).toEqual([
      "start(120,123,buttons=3)",
      "move(144,135)",
      "move(72,93)",
      "move(96,111)",
      "move(60,87)",
    ]);

    // Pen lifts off screen while button still held -> hover pointermove returns with pressure=0.
    move(pointerEvent({ clientX: 60, clientY: 87, buttons: 1, pressure: 0, timeStamp: 300 }));
    expect(events).toEqual([
      "start(120,123,buttons=3)",
      "move(144,135)",
      "move(72,93)",
      "move(96,111)",
      "move(60,87)",
      "end(60,87)",
    ]);
    // Releasing the button after erasing must NOT trigger an air-click menu, clears is-barrel-held,
    // and keeps is-active ready for the next simultaneous press.
    move(pointerEvent({ clientX: 60, clientY: 87, buttons: 0, pressure: 0, timeStamp: 350 }));
    expect(events.some((e) => e.startsWith("click("))).toBe(false);
    expect(bridgeEl.classList.contains("is-barrel-held")).toBe(false);
    expect(bridgeEl.classList.contains("is-active")).toBe(true);

    controller.detach();
  });

  it("ignores line-edge wrap glitches (offset 0 or row end far from previous X)", () => {
    const { doc, host, bridgeEl, events, controller } = setupController();
    const move = host.listeners.get("pointermove")!;

    // Hover around x=300, y=120 -> col 50, row 20.
    move(pointerEvent({ clientX: 300, clientY: 120, buttons: 1, pressure: 0, timeStamp: 100 }));
    doc.setSelection(bridgeEl.textAt(20), 50, bridgeEl.textAt(20), 52);

    // Line-edge glitch puts focus at offset 0 (x=0, >80px away from x=312).
    const rowLen = bridgeEl.textAt(20).length;
    doc.setSelection(bridgeEl.textAt(20), 50, bridgeEl.textAt(21), 0);
    // And another glitch puts focus at rowLen (far right).
    doc.setSelection(bridgeEl.textAt(20), 50, bridgeEl.textAt(21), rowLen);

    // Genuine small movement stays smooth.
    doc.setSelection(bridgeEl.textAt(20), 50, bridgeEl.textAt(21), 54);
    expect(events).toEqual(["start(300,123,buttons=3)", "move(312,123)", "move(324,129)"]);

    controller.detach();
  });

  it("disarms immediately on real pointerdown (e.g. mouse right-click or desktop pen) and on finger touch", () => {
    const { host, bridgeEl, controller } = setupController();
    const move = host.listeners.get("pointermove")!;
    const down = host.listeners.get("pointerdown")!;

    move(pointerEvent({ clientX: 200, clientY: 120, buttons: 1, pressure: 0, timeStamp: 100 }));
    expect(bridgeEl.classList.contains("is-active")).toBe(true);

    // Mouse right-click arrives -> bridge must disarm immediately.
    down(
      pointerEvent({ pointerType: "mouse", button: 2, buttons: 2, pointerId: 2, timeStamp: 120 }),
    );
    expect(bridgeEl.classList.contains("is-active")).toBe(false);

    // Arm again, then simulate non-stylus finger touchstart on bridge.
    move(pointerEvent({ clientX: 200, clientY: 120, buttons: 1, pressure: 0, timeStamp: 200 }));
    expect(bridgeEl.classList.contains("is-active")).toBe(true);
    bridgeEl.listeners.get("touchstart")?.({
      changedTouches: [{ touchType: "direct" }],
    });
    expect(bridgeEl.classList.contains("is-active")).toBe(false);

    controller.detach();
  });

  it("auto-disarms after idle timeout when hovering pen leaves range", () => {
    vi.useFakeTimers();
    const doc = new FakeDocument();
    const host = new FakeHost(doc);
    const bridge = new StylusSelectBridge(host as unknown as HTMLElement, {
      onStart: () => {},
      onMove: () => {},
      onEnd: () => {},
    });
    bridge.attach();
    const bridgeEl = host.children[0];

    bridge.setArmed(true, 100, 100, 10);
    expect(bridgeEl.classList.contains("is-active")).toBe(true);

    vi.advanceTimersByTime(14900);
    expect(bridgeEl.classList.contains("is-active")).toBe(true);

    vi.advanceTimersByTime(200);
    expect(bridgeEl.classList.contains("is-active")).toBe(false);

    bridge.detach();
    vi.useRealTimers();
  });

  it("routes barrel strokes through pan and ignore routes and cancels active palm fingers", () => {
    const panSetup = setupController({ route: () => "pan" });
    const panDown = panSetup.host.listeners.get("pointerdown")!;
    const panMove = panSetup.host.listeners.get("pointermove")!;

    // Resting palm finger starts panning before S-Pen barrel stroke begins.
    panDown(
      pointerEvent({ pointerId: 9, pointerType: "touch", clientX: 50, clientY: 50, timeStamp: 50 }),
    );
    expect(panSetup.host.captured.has(9)).toBe(true);

    panMove(pointerEvent({ clientX: 120, clientY: 120, buttons: 1, pressure: 0, timeStamp: 100 }));
    panSetup.doc.setSelection(panSetup.bridgeEl.textAt(20), 20, panSetup.bridgeEl.textAt(21), 22);
    panMove(pointerEvent({ clientX: 132, clientY: 129, buttons: 1, pressure: 0, timeStamp: 200 }));

    expect(panSetup.host.captured.has(9)).toBe(false);
    expect(panSetup.events).toEqual([
      "panStart(50,50)",
      "panCancel",
      "panStart(120,123)",
      "panMove(132,129)",
      "panEnd",
    ]);
    panSetup.controller.detach();

    const ignoreSetup = setupController({ route: () => "ignore" });
    const ignoreMove = ignoreSetup.host.listeners.get("pointermove")!;
    ignoreMove(
      pointerEvent({ clientX: 120, clientY: 120, buttons: 1, pressure: 0, timeStamp: 100 }),
    );
    ignoreSetup.doc.setSelection(
      ignoreSetup.bridgeEl.textAt(20),
      20,
      ignoreSetup.bridgeEl.textAt(21),
      22,
    );
    ignoreMove(
      pointerEvent({ clientX: 132, clientY: 129, buttons: 1, pressure: 0, timeStamp: 200 }),
    );
    expect(ignoreSetup.events).toEqual([]);
    ignoreSetup.controller.detach();
  });

  it("ends an active stroke after IDLE_END_MS when pen leaves hover range", () => {
    vi.useFakeTimers();
    const { doc, host, bridgeEl, events, controller } = setupController();
    const move = host.listeners.get("pointermove")!;

    move(pointerEvent({ clientX: 120, clientY: 120, buttons: 0, pressure: 0, timeStamp: 100 }));
    doc.setSelection(bridgeEl.textAt(20), 20, bridgeEl.textAt(20), 22);
    expect(events).toEqual(["start(120,123,buttons=3)", "move(132,123)"]);
    expect(controller.stylusTouched()).toBe(true);

    vi.advanceTimersByTime(1550);
    expect(events).toEqual(["start(120,123,buttons=3)", "move(132,123)", "end(132,123)"]);
    expect(controller.stylusTouched()).toBe(true);

    vi.advanceTimersByTime(350);
    expect(controller.stylusTouched()).toBe(false);

    controller.detach();
    vi.useRealTimers();
  });

  it("rejects single-frame jumps > 250px when the other endpoint stays within 60px of lastPt", () => {
    const { doc, host, bridgeEl, events, controller } = setupController();
    const move = host.listeners.get("pointermove")!;

    move(pointerEvent({ clientX: 120, clientY: 120, buttons: 1, pressure: 0, timeStamp: 100 }));
    doc.setSelection(bridgeEl.textAt(20), 20, bridgeEl.textAt(20), 21);

    // Jump focus across screen (>250px from x=126) while anchor remains at (120,123) (within 60px).
    doc.setSelection(bridgeEl.textAt(20), 20, bridgeEl.textAt(20), 90);
    expect(events).toEqual(["start(120,123,buttons=3)", "move(126,123)"]);

    // Subsequent valid move continues smoothly.
    doc.setSelection(bridgeEl.textAt(20), 20, bridgeEl.textAt(20), 23);
    expect(events).toEqual(["start(120,123,buttons=3)", "move(126,123)", "move(138,123)"]);

    controller.detach();
  });

  it("prevents bridge contextmenu when armed, supports end-of-row offset and zero-rect fallback, and skips iPad/iOS", () => {
    const { doc, host, bridgeEl, events, controller } = setupController({}, "zero");
    const move = host.listeners.get("pointermove")!;

    // Contextmenu while disarmed is not prevented.
    let prevented = false;
    bridgeEl.listeners.get("contextmenu")?.({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(false);

    // Arm near right side of row so end-of-row offset (clamped === len) is within 80px.
    move(pointerEvent({ clientX: 600, clientY: 123, buttons: 1, pressure: 0, timeStamp: 90 }));
    const rowLen = bridgeEl.textAt(20).length;
    const endX = rowLen * 6;
    move(
      pointerEvent({ clientX: endX - 18, clientY: 123, buttons: 1, pressure: 0, timeStamp: 100 }),
    );

    // Contextmenu while armed is prevented.
    bridgeEl.listeners.get("contextmenu")?.({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);

    // Zero-rect fallback resolves row/col geometry including clamped === rowLen.
    doc.setSelection(bridgeEl.textAt(20), rowLen - 3, bridgeEl.textAt(20), rowLen);
    expect(events).toEqual([`start(${endX - 18},123,buttons=3)`, `move(${endX},123)`]);
    controller.detach();

    // Non-Android platforms (e.g. iPadOS / desktop) skip mounting when stylusSelectBridge returns false.
    const disabled = setupController({ stylusSelectBridge: () => false });
    expect(disabled.host.children.length).toBe(0);
    disabled.controller.detach();
  });
});
