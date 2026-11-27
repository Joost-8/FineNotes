/**
 * Bridge for Android WebView S-Pen hold-to-erase (FineNotes#149).
 *
 * When the S-Pen side button is held before touching the screen, Chromium's
 * `StylusTextSelector` intercepts touch/pointer events before they reach JS
 * and converts the drag into `SelectBetweenCoordinates` /
 * `MoveRangeSelectionExtent` calls. When armed (`barrelHeld === true`), this
 * overlay temporarily exposes invisible `user-select: text` rows over the
 * scroll surface so Chromium's selection updates drive `selectionchange`
 * events with the pen's viewport coordinates.
 */

export interface BridgePoint {
  clientX: number;
  clientY: number;
  timeStamp: number;
}

/** What the bridge did with the selection it read, for the diagnostics (#209). */
export interface BridgeStats {
  /** Selections (ranges) the WebView moved while a stroke was under way. */
  reads: number;
  /** Ends read at a row's edge far from the pen, dropped as a wrap. */
  wraps: number;
  /** Moves dropped as a jump of the far end. */
  jumps: number;
  /** Strokes ended because the selection stopped changing (a stall). */
  idleEnds: number;
  /** Selections collapsed after reading, so no range is left for handles. */
  collapses: number;
}

export interface StylusSelectBridgeCallbacks {
  onStart(point: BridgePoint): void;
  onMove(point: BridgePoint): void;
  onEnd(point: BridgePoint): void;
}

const GRID_CHAR = "\u5341";
const TEXT_NODE = 3;
const CHAR_WIDTH_ESTIMATE = 6;
const ROW_HEIGHT_PX = 6;
const MIN_MOVE_PX = 0.5;
const IDLE_END_MS = 1500;
const ARMED_IDLE_MS = 15000;
const RECENT_ACTIVE_MS = 300;
const EDGE_WRAP_MAX_DX_PX = 80;
const START_HOVER_MAX_DIST_PX = 100;
const SINGLE_FRAME_JUMP_PX = 250;
const OTHER_END_NEAR_PX = 60;

function distanceBetween(a: BridgePoint, b: BridgePoint): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

export class StylusSelectBridge {
  private bridgeEl: HTMLDivElement | null = null;
  private armed = false;
  private active = false;
  private lastHover: BridgePoint | null = null;
  private lastPt: BridgePoint | null = null;
  private basePt: BridgePoint | null = null;
  private prevAnchorNode: Node | null = null;
  private prevAnchorOffset = 0;
  private prevFocusNode: Node | null = null;
  private prevFocusOffset = 0;
  private lastEndedAt = Number.NEGATIVE_INFINITY;
  private idleTimer: number | null = null;
  private armedTimer: number | null = null;
  private gridWidth = 0;
  private gridHeight = 0;
  private charsPerRow = 0;
  private rowCount = 0;
  private readonly counts: BridgeStats = {
    reads: 0,
    wraps: 0,
    jumps: 0,
    idleEnds: 0,
    collapses: 0,
  };

  private readonly onSelectionChange = (): void => this.handleSelectionChange();
  private readonly onTouchStart = (event: TouchEvent): void => {
    if (!this.armed || this.active) return;
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i] as Touch & { touchType?: string };
      if (touch && touch.touchType !== "stylus") {
        this.setArmed(false);
        return;
      }
    }
  };
  private readonly onContextMenu = (event: MouseEvent): void => {
    if (!this.armed && !this.active) return;
    event.preventDefault();
  };

  constructor(
    private readonly element: HTMLElement,
    private readonly callbacks: StylusSelectBridgeCallbacks,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** What the bridge did with the selections it read since the note opened. */
  stats(): BridgeStats {
    return { ...this.counts };
  }

  get wasRecentlyActive(): boolean {
    return (
      this.active ||
      (this.lastEndedAt >= 0 && performance.now() - this.lastEndedAt < RECENT_ACTIVE_MS)
    );
  }

  attach(): void {
    if (!this.canMount()) return;
    const doc = this.element.ownerDocument;
    if (!this.bridgeEl) {
      const el = this.element.createDiv({
        cls: "goodobsidian-stylus-select-bridge",
        attr: { "aria-hidden": "true", "data-ignore-swipe": "true" },
      });
      this.bridgeEl = el;
    }
    this.bridgeEl.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.bridgeEl.addEventListener("contextmenu", this.onContextMenu);
    doc.addEventListener("selectionchange", this.onSelectionChange);
  }

  detach(): void {
    this.clearIdleTimer();
    this.clearArmedTimer();
    const doc = this.element.ownerDocument;
    if (doc && typeof doc.removeEventListener === "function") {
      doc.removeEventListener("selectionchange", this.onSelectionChange);
    }
    if (this.bridgeEl) {
      this.bridgeEl.removeEventListener("touchstart", this.onTouchStart);
      this.bridgeEl.removeEventListener("contextmenu", this.onContextMenu);
      this.bridgeEl.remove();
      this.bridgeEl = null;
    }
    this.armed = false;
    this.active = false;
    this.lastHover = null;
    this.lastEndedAt = Number.NEGATIVE_INFINITY;
    this.resetStrokeTracking();
    this.gridWidth = 0;
    this.gridHeight = 0;
  }

  warmUp(): void {
    if (!this.bridgeEl || this.gridWidth > 0) return;
    this.populateIfNeeded();
  }

  setArmed(
    armed: boolean,
    clientX?: number,
    clientY?: number,
    timeStamp?: number,
    barrelHeld = false,
  ): void {
    if (typeof clientX === "number" && typeof clientY === "number") {
      this.lastHover = {
        clientX,
        clientY,
        timeStamp: typeof timeStamp === "number" ? timeStamp : performance.now(),
      };
    }
    if (!this.bridgeEl) {
      this.armed = armed;
      return;
    }
    if (armed) {
      this.populateIfNeeded();
      this.scheduleArmedIdle();
      if (!this.armed) {
        this.armed = true;
        this.bridgeEl.classList.add("is-active");
      }
      if (barrelHeld) this.bridgeEl.classList.add("is-barrel-held");
      else this.bridgeEl.classList.remove("is-barrel-held");
      return;
    }
    this.clearArmedTimer();
    this.bridgeEl.classList.remove("is-barrel-held");
    if (this.armed) {
      this.armed = false;
      if (!this.active) {
        this.bridgeEl.classList.remove("is-active");
      }
    }
  }

  endStroke(timeStamp?: number): void {
    if (!this.active) return;
    this.clearIdleTimer();
    this.active = false;
    this.lastEndedAt = performance.now();
    const last = this.lastPt ?? this.lastHover ?? { clientX: 0, clientY: 0, timeStamp: 0 };
    const endPt: BridgePoint = {
      clientX: last.clientX,
      clientY: last.clientY,
      timeStamp: typeof timeStamp === "number" ? timeStamp : performance.now(),
    };
    this.resetStrokeTracking();
    const doc = this.element.ownerDocument;
    try {
      doc?.getSelection?.()?.removeAllRanges();
    } catch {
      // Ignore selection cleanup errors if view is detaching.
    }
    if (!this.armed) {
      this.bridgeEl?.classList.remove("is-active");
      this.bridgeEl?.classList.remove("is-barrel-held");
    }
    this.callbacks.onEnd(endPt);
  }

  private resetStrokeTracking(): void {
    this.lastPt = null;
    this.basePt = null;
    this.prevAnchorNode = null;
    this.prevAnchorOffset = 0;
    this.prevFocusNode = null;
    this.prevFocusOffset = 0;
  }

  private canMount(): boolean {
    const el = this.element as Partial<HTMLElement>;
    if (!el || !el.ownerDocument || typeof el.createDiv !== "function") {
      return false;
    }
    if (typeof el.getBoundingClientRect !== "function") {
      return false;
    }
    if (typeof el.tagName === "string" && el.tagName.toUpperCase() === "CANVAS") {
      return false;
    }
    return true;
  }

  private timers(): Pick<Window, "setTimeout" | "clearTimeout"> | null {
    return (
      this.element.ownerDocument?.defaultView ?? (typeof window !== "undefined" ? window : null)
    );
  }

  private populateIfNeeded(): void {
    const bridge = this.bridgeEl;
    if (!bridge) return;
    const rect = this.element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (width < 10 || height < 10) return;
    if (
      this.gridWidth > 0 &&
      Math.abs(width - this.gridWidth) <= 16 &&
      Math.abs(height - this.gridHeight) <= 16
    ) {
      return;
    }
    this.gridWidth = width;
    this.gridHeight = height;
    const chars = Math.max(40, Math.ceil(width / CHAR_WIDTH_ESTIMATE) + 8);
    const rows = Math.max(20, Math.ceil(height / ROW_HEIGHT_PX) + 2);
    this.charsPerRow = chars;
    this.rowCount = rows;

    const lineText = GRID_CHAR.repeat(chars);
    bridge.empty();
    for (let i = 0; i < rows; i++) {
      bridge.createDiv({
        cls: "goodobsidian-stylus-select-row",
        text: lineText,
        attr: { "data-row": String(i) },
      });
    }
  }

  private handleSelectionChange(): void {
    if (!this.armed && !this.active) return;
    const bridge = this.bridgeEl;
    const doc = this.element.ownerDocument;
    if (!bridge || !doc) return;
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return;
    // Our own `collapse` coming back: nothing moved, and the pen has not stalled.
    if (this.active && sel.isCollapsed && this.sameAsRecorded(sel)) return;

    const anchorInside = bridge.contains(sel.anchorNode);
    const focusInside = bridge.contains(sel.focusNode);
    if (!anchorInside && !focusInside) return;

    const now = performance.now();
    const anchor = anchorInside
      ? this.pointFromSelectionEnd(doc, sel.anchorNode, sel.anchorOffset, now)
      : null;
    const focus = focusInside
      ? this.pointFromSelectionEnd(doc, sel.focusNode, sel.focusOffset, now)
      : null;

    if (!focus && !anchor) return;
    this.clearArmedTimer();
    this.scheduleIdleEnd();

    let kept = true;
    if (!this.active) {
      this.startFromSelection(sel, anchor, focus);
    } else {
      if (!sel.isCollapsed) this.counts.reads++;
      kept = this.moveFromSelection(sel, anchor, focus);
    }
    // A dropped read is not collapsed onto: that would hand its far point back as the pen.
    if (this.active && kept) this.collapse(sel);
  }

  private sameAsRecorded(sel: Selection): boolean {
    return (
      sel.anchorNode === this.prevAnchorNode &&
      sel.anchorOffset === this.prevAnchorOffset &&
      sel.focusNode === this.prevFocusNode &&
      sel.focusOffset === this.prevFocusOffset
    );
  }

  /**
   * The point is read: the range has done its work. Left standing, Android
   * draws its selection handles on it while the pen erases (#209), and a pen
   * that lands on a handle drags the handle, not the selection the bridge
   * reads. Collapsed onto its moving end (a caret in text nobody can edit,
   * which has no handles), the next drag extends from where the pen is.
   * Unproven on a device: that the WebView's stylus selection carries on
   * from a collapsed selection, and that the handles go with the range.
   */
  private collapse(sel: Selection): void {
    if (sel.isCollapsed || !sel.focusNode) return;
    try {
      sel.collapse(sel.focusNode, sel.focusOffset);
      this.counts.collapses++;
      // Both ends are at the pen now: an extent move from here changes only the focus.
      this.recordEndpoints(sel);
    } catch {
      // A selection the document no longer holds: nothing to collapse.
    }
  }

  private startFromSelection(
    sel: Selection,
    anchor: BridgePoint | null,
    focus: BridgePoint | null,
  ): void {
    this.active = true;
    const hover = this.lastHover;
    let startPt: BridgePoint | null = null;
    let otherPt: BridgePoint | null = null;

    if (hover) {
      const anchorDist = anchor ? distanceBetween(hover, anchor) : Number.POSITIVE_INFINITY;
      const focusDist = focus ? distanceBetween(hover, focus) : Number.POSITIVE_INFINITY;
      if (anchorDist > START_HOVER_MAX_DIST_PX && focusDist > START_HOVER_MAX_DIST_PX) {
        startPt = hover;
      } else if (focus && focusDist < anchorDist) {
        startPt = focus;
        otherPt = anchor;
      } else {
        startPt = anchor ?? focus ?? hover;
        otherPt = startPt === anchor ? focus : anchor;
      }
    } else {
      startPt = anchor ?? focus;
      otherPt = startPt === anchor ? focus : anchor;
    }

    if (!startPt) {
      this.active = false;
      return;
    }

    this.basePt = startPt;
    this.lastPt = startPt;
    this.recordEndpoints(sel);
    this.callbacks.onStart(startPt);

    if (
      otherPt &&
      distanceBetween(startPt, otherPt) <= START_HOVER_MAX_DIST_PX &&
      this.movedEnough(startPt, otherPt)
    ) {
      this.lastPt = otherPt;
      this.callbacks.onMove(otherPt);
    }
  }

  private moveFromSelection(
    sel: Selection,
    anchor: BridgePoint | null,
    focus: BridgePoint | null,
  ): boolean {
    if (sel.isCollapsed && anchor) {
      this.basePt = anchor;
    }
    const anchorChanged =
      sel.anchorNode !== this.prevAnchorNode || sel.anchorOffset !== this.prevAnchorOffset;
    const focusChanged =
      sel.focusNode !== this.prevFocusNode || sel.focusOffset !== this.prevFocusOffset;
    this.recordEndpoints(sel);

    if (!anchorChanged && !focusChanged) return true;

    let candidate: BridgePoint | null = null;
    let other: BridgePoint | null = null;
    if (focusChanged && !anchorChanged) {
      candidate = focus;
      other = anchor;
    } else if (anchorChanged && !focusChanged) {
      candidate = anchor;
      other = focus;
    } else if (anchor && focus && this.basePt) {
      const anchorFromBase = distanceBetween(this.basePt, anchor);
      const focusFromBase = distanceBetween(this.basePt, focus);
      if (anchorFromBase > focusFromBase) {
        candidate = anchor;
        other = focus;
      } else {
        candidate = focus;
        other = anchor;
      }
    } else {
      candidate = focus ?? anchor;
      other = candidate === focus ? anchor : focus;
    }

    if (!candidate) return false;
    if (
      this.lastPt &&
      distanceBetween(this.lastPt, candidate) > SINGLE_FRAME_JUMP_PX &&
      other &&
      distanceBetween(this.lastPt, other) <= OTHER_END_NEAR_PX
    ) {
      this.counts.jumps++;
      return false;
    }

    if (!this.lastPt || this.movedEnough(this.lastPt, candidate)) {
      this.lastPt = candidate;
      this.callbacks.onMove(candidate);
    }
    return true;
  }

  private recordEndpoints(sel: Selection): void {
    this.prevAnchorNode = sel.anchorNode;
    this.prevAnchorOffset = sel.anchorOffset;
    this.prevFocusNode = sel.focusNode;
    this.prevFocusOffset = sel.focusOffset;
  }

  private movedEnough(a: BridgePoint, b: BridgePoint): boolean {
    return distanceBetween(a, b) >= MIN_MOVE_PX;
  }

  private scheduleArmedIdle(): void {
    this.clearArmedTimer();
    const timers = this.timers();
    if (!timers) return;
    this.armedTimer = timers.setTimeout(() => {
      this.armedTimer = null;
      if (this.armed && !this.active) this.setArmed(false);
    }, ARMED_IDLE_MS);
  }

  private clearArmedTimer(): void {
    if (this.armedTimer !== null) {
      this.timers()?.clearTimeout(this.armedTimer);
      this.armedTimer = null;
    }
  }

  private scheduleIdleEnd(): void {
    this.clearIdleTimer();
    const timers = this.timers();
    if (!timers) return;
    this.idleTimer = timers.setTimeout(() => {
      this.idleTimer = null;
      if (!this.active) return;
      this.counts.idleEnds++;
      this.endStroke(performance.now());
    }, IDLE_END_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.timers()?.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private pointFromSelectionEnd(
    doc: Document,
    node: Node,
    offset: number,
    timeStamp: number,
  ): BridgePoint | null {
    const resolved = this.resolveTextNode(node);
    if (!resolved) return null;
    const { textNode, rowIndex } = resolved;
    const len = textNode.length;
    if (len === 0) return null;

    const clamped = Math.max(0, Math.min(offset, len));
    let pt: BridgePoint | null = null;
    const range = doc.createRange();
    if (clamped < len) {
      range.setStart(textNode, clamped);
      range.setEnd(textNode, clamped + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        pt = {
          clientX: rect.left,
          clientY: rect.top + rect.height / 2,
          timeStamp,
        };
      }
    } else {
      range.setStart(textNode, len - 1);
      range.setEnd(textNode, len);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        pt = {
          clientX: rect.right,
          clientY: rect.top + rect.height / 2,
          timeStamp,
        };
      }
    }

    if (!pt) {
      const bridgeRect = this.bridgeEl?.getBoundingClientRect();
      if (!bridgeRect) return null;
      const col = Math.max(0, Math.min(clamped, this.charsPerRow));
      const row = Math.max(0, Math.min(rowIndex, Math.max(0, this.rowCount - 1)));
      pt = {
        clientX: bridgeRect.left + col * CHAR_WIDTH_ESTIMATE,
        clientY: bridgeRect.top + (row + 0.5) * ROW_HEIGHT_PX,
        timeStamp,
      };
    }

    const prev = this.lastPt ?? this.lastHover;
    if (
      prev &&
      (clamped === 0 || clamped >= len) &&
      Math.abs(pt.clientX - prev.clientX) > EDGE_WRAP_MAX_DX_PX
    ) {
      this.counts.wraps++;
      return null;
    }
    return pt;
  }

  private resolveTextNode(node: Node): { textNode: Text; rowIndex: number } | null {
    if (node.nodeType !== TEXT_NODE) return null;
    const textNode = node as Text;
    const parentEl = textNode.parentElement;
    const rowIndex = Number(parentEl?.dataset.row ?? 0);
    return {
      textNode,
      rowIndex: Number.isFinite(rowIndex) ? rowIndex : 0,
    };
  }
}
