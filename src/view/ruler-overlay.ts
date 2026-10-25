/**
 * The ruler laid over the page: a straight ruler, a set square or a
 * protractor, in screen space over the surface, staying put while the page
 * scrolls under it. Its geometry is `canvas/ruler-geometry.ts`.
 *
 * Input, all heard on the surface in the capture phase, so the ruler sees a
 * press before the page's own `PointerController` does:
 *
 * - A finger on the ruler takes it: one finger slides it, a second finger
 *   (anywhere) turns it about the two fingers' midpoint, snapped. Those
 *   touches never reach the page, so they neither scroll it nor count as a
 *   two-finger tap. A finger that lands while the pen is writing is the
 *   writing hand (`palm-rejection.ts`) and is left to the page, which
 *   ignores it; so is one landing while the page is already being scrolled
 *   or pinched.
 * - The mouse on the ruler slides it; Shift + the wheel over it turns it a step.
 * - A pen (or a mouse off the ruler) that comes down within reach of an
 *   edge, with the pen or the highlighter, follows that edge for the whole
 *   stroke: the surface maps every sample of it through {@link guide}. The
 *   edge is copied at the pen-down, so a finger moving the ruler meanwhile
 *   cannot bend the line. The Pencil and a finger work at once.
 *
 * Touches on the ruler land on the scroll overlay underneath (the ruler takes
 * no pointer events of its own), so the surface's touch handling still
 * cancels WebKit's long press and keeps Obsidian's swipes away, and the
 * surface's `data-ignore-swipe` covers the ruler too.
 */

import {
  DEFAULT_RULER_SNAP,
  RULER_GRAB_SLOP_PX,
  RULER_REACH_PX,
  RULER_WIDTH,
  type RulerEdge,
  type RulerKind,
  type RulerPose,
  type RulerPt,
  type RulerSpec,
  dragPose,
  hitsRuler,
  keepInPane,
  nearestEdge,
  offsetEdge,
  openingPose,
  projectOntoEdge,
  protractorTicks,
  readoutAngle,
  rulerEdges,
  rulerMiddle,
  rulerSpecFor,
  rulerTicks,
  squareCorners,
  stepTurn,
  swapKind,
  twoFingerPose,
} from "../canvas/ruler-geometry";
import { PAGE_PX_PER_MM } from "../model/units";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The scale's zero sits this far in from the ruler's end (or the set square's corner), px. */
const SCALE_INSET = 14;
/** Mark lengths, finest to longest, px. */
const TICK_LENGTHS = [7, 11, 17] as const;
/** The numbers' baseline, in from the edge their marks hang from, px. */
const LABEL_DEPTH = 30;
/** The set square's window, in from its edges, px. */
const SQUARE_WINDOW_INSET = 46;
/** The protractor's window, as a share of its radius. */
const PROTRACTOR_WINDOW = 0.42;
/** Wheel travel that turns the ruler one step, px (a mouse notch is about 100). */
const WHEEL_STEP_PX = 100;
/** A pen silent this long is taken as lifted, though no pointerup came (iOS loses some), ms. */
const PEN_STALE_MS = 3000;

export interface RulerHooks {
  /**
   * Whether this pen or mouse press may follow an edge: the pen or the
   * highlighter is in hand, and no key or stylus button lends the press to
   * another tool.
   */
  guides(event: PointerEvent): boolean;
  /** Whether the page's own finger gesture is under way: a new finger is then its. */
  fingersBusy(): boolean;
  /** How wide the pen in hand writes, screen px: its line runs beside the edge, not under it. */
  inkWidth(): number;
}

/** The pen stroke following an edge, and where the surface was when it began. */
interface Lock {
  edge: RulerEdge;
  index: number;
  pointer: number;
  left: number;
  top: number;
}

export class RulerOverlay {
  private readonly el: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly bodyEl: SVGPathElement;
  private readonly ticksEl: SVGPathElement;
  private readonly labelsEl: SVGGElement;
  private readonly edgesEl: SVGGElement;
  private readonly angleEl: SVGTextElement;
  private edgeEls: SVGPathElement[] = [];

  private out = false;
  private snap = DEFAULT_RULER_SNAP;
  private spec: RulerSpec = rulerSpecFor("straight", 0);
  private current: RulerPose = { x: 0, y: 0, angle: 0 };
  /** Layout px → CSS px, as last told; the marks follow it. */
  private scale = 1;
  /** The page millimetre the marks were last drawn at, screen px. */
  private drawnPxPerMm = 0;

  /** Pointers holding the ruler, by id, at their latest place (surface px). */
  private readonly grips = new Map<number, RulerPt>();
  private gripType = "";
  /** Where the surface was when the grip began: client px → surface px. */
  private gripOrigin: RulerPt = { x: 0, y: 0 };
  /** The pose and the first two grips' places when the hold last changed shape. */
  private gripStart: { pose: RulerPose; ids: number[]; at: RulerPt[] } | null = null;
  private lock: Lock | null = null;
  /** The pen on the glass, if any, and when it last said anything. */
  private penPointer: number | null = null;
  private penSeenAt = 0;
  private wheelSum = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly hooks: RulerHooks,
  ) {
    this.el = host.createDiv({ cls: "goodobsidian-ruler is-hidden" });
    this.el.setAttribute("aria-hidden", "true");
    const svg = this.svgEl("svg");
    this.svg = svg as SVGSVGElement;
    this.el.append(svg);
    this.bodyEl = this.svgEl("path", "goodobsidian-ruler-body") as SVGPathElement;
    this.edgesEl = this.svgEl("g", "goodobsidian-ruler-edges") as SVGGElement;
    this.ticksEl = this.svgEl("path", "goodobsidian-ruler-ticks") as SVGPathElement;
    this.labelsEl = this.svgEl("g", "goodobsidian-ruler-labels") as SVGGElement;
    this.angleEl = this.svgEl("text", "goodobsidian-ruler-angle") as SVGTextElement;
    this.svg.append(this.bodyEl, this.edgesEl, this.ticksEl, this.labelsEl, this.angleEl);

    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options: AddEventListenerOptions,
    ): void => {
      host.addEventListener(type, handler, options);
      this.disposers.push(() => host.removeEventListener(type, handler, options));
    };
    listen("pointerdown", this.onDown, { capture: true });
    listen("pointermove", this.onMove, { capture: true });
    listen("pointerup", this.onUp, { capture: true });
    listen("pointercancel", this.onUp, { capture: true });
    // After the page has had the pen's last sample: only then may the edge let go.
    listen("pointerup", this.onRelease, {});
    listen("pointercancel", this.onRelease, {});
    listen("wheel", this.onWheel, { capture: true, passive: false });
  }

  /** Whether the ruler is out. */
  get isOut(): boolean {
    return this.out;
  }

  /** Where it lies now (surface px), for tests and the gallery. */
  get pose(): RulerPose {
    return { ...this.current };
  }

  /** Whether a pen stroke is following an edge right now. */
  get isFollowing(): boolean {
    return this.lock !== null;
  }

  /** Bring the ruler out, level in the middle of the pane, or put it away. */
  setOut(out: boolean, kind: RulerKind, snap: number): void {
    this.snap = snap;
    if (out === this.out) {
      if (out) this.setKind(kind);
      return;
    }
    this.out = out;
    this.releaseAll();
    this.el.toggleClass("is-hidden", !out);
    if (!out) return;
    const { clientWidth: w, clientHeight: h } = this.host;
    this.spec = rulerSpecFor(kind, w);
    this.current = openingPose(this.spec, w, h);
    this.drawBody();
    this.drawPose();
  }

  /** Another kind of ruler in place of this one, its middle and turn kept. */
  setKind(kind: RulerKind): void {
    if (!this.out || kind === this.spec.kind) return;
    const next = rulerSpecFor(kind, this.host.clientWidth);
    this.current = swapKind(this.current, this.spec, next);
    this.spec = next;
    this.releaseAll();
    this.drawBody();
    this.drawPose();
  }

  setSnap(snap: number): void {
    this.snap = snap;
  }

  /**
   * The view's scale (layout px → CSS px) changed: the marks follow it, so
   * a centimetre on the ruler stays a centimetre of the page. Cheap when
   * nothing changed; called every frame.
   */
  setScale(scale: number): void {
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    this.scale = scale;
    if (!this.out || this.spec.kind === "protractor") return;
    if (Math.abs(PAGE_PX_PER_MM * scale - this.drawnPxPerMm) < 1e-4) return;
    this.drawScale();
  }

  /** The pane changed size: keep the ruler within reach. */
  fitPane(): void {
    if (!this.out) return;
    const next = keepInPane(this.spec, this.current, this.host.clientWidth, this.host.clientHeight);
    if (next === this.current) return;
    this.current = next;
    this.drawPose();
  }

  /**
   * A pointer position (client px) as the stroke takes it: on the edge the
   * stroke follows, or as it is when it follows none.
   */
  guide(clientX: number, clientY: number): { x: number; y: number } {
    const lock = this.lock;
    if (!lock) return { x: clientX, y: clientY };
    const on = projectOntoEdge(lock.edge, { x: clientX - lock.left, y: clientY - lock.top });
    return { x: on.x + lock.left, y: on.y + lock.top };
  }

  destroy(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.el.remove();
  }

  // --- Input -----------------------------------------------------------------

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType === "pen") {
      this.penPointer = event.pointerId;
      this.penSeenAt = event.timeStamp;
    }
    if (!this.out) return;
    const at = this.local(event);
    if (event.pointerType === "touch") {
      const holding = this.grips.size > 0 && this.gripType === "touch";
      if (holding) {
        // A second finger turns the ruler, wherever it lands; a palm while
        // the pen writes does not.
        if (this.penWriting(event.timeStamp)) return;
      } else if (
        this.grips.size > 0 ||
        this.penWriting(event.timeStamp) ||
        this.hooks.fingersBusy() ||
        !hitsRuler(this.spec, this.current, at, RULER_GRAB_SLOP_PX)
      ) {
        return;
      }
      this.grip(event, at);
      return;
    }
    const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (
      event.pointerType === "mouse" &&
      event.button === 0 &&
      plain &&
      this.grips.size === 0 &&
      hitsRuler(this.spec, this.current, at, 0)
    ) {
      this.grip(event, at);
      return;
    }
    this.follow(event, at);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerType === "pen" && event.pointerId === this.penPointer) {
      this.penSeenAt = event.timeStamp;
    }
    if (!this.grips.has(event.pointerId)) return;
    event.stopPropagation();
    event.preventDefault();
    this.grips.set(event.pointerId, {
      x: event.clientX - this.gripOrigin.x,
      y: event.clientY - this.gripOrigin.y,
    });
    this.moveWithGrips();
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.grips.delete(event.pointerId)) return;
    event.stopPropagation();
    if (this.host.hasPointerCapture?.(event.pointerId)) {
      this.host.releasePointerCapture(event.pointerId);
    }
    this.anchorGrips();
  };

  private readonly onRelease = (event: PointerEvent): void => {
    if (event.pointerId === this.penPointer) this.penPointer = null;
    if (this.lock?.pointer === event.pointerId) this.endFollowing();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    // Only with Shift: a plain wheel over a long ruler still scrolls the page,
    // and Ctrl/Cmd + wheel is a zoom (a trackpad pinch), the page's too.
    if (!this.out || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    const at = this.local(event);
    if (!hitsRuler(this.spec, this.current, at, 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const lines = event.deltaMode === 1 ? 33 : 1;
    const delta =
      (Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX) * lines;
    if (Math.sign(delta) !== Math.sign(this.wheelSum)) this.wheelSum = 0;
    this.wheelSum += delta;
    let turned = false;
    while (Math.abs(this.wheelSum) >= WHEEL_STEP_PX) {
      const direction = this.wheelSum > 0 ? 1 : -1;
      this.wheelSum -= direction * WHEEL_STEP_PX;
      this.current = stepTurn(this.current, at, direction, this.snap);
      turned = true;
    }
    if (turned) this.drawPose();
  };

  /** A pen is writing: down, and heard from lately. */
  private penWriting(time: number): boolean {
    return this.penPointer !== null && time - this.penSeenAt < PEN_STALE_MS;
  }

  /** Take hold of the ruler with this pointer; the page never hears of it. */
  private grip(event: PointerEvent, at: RulerPt): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.grips.size === 0) {
      const rect = this.host.getBoundingClientRect();
      this.gripOrigin = { x: rect.left, y: rect.top };
      this.gripType = event.pointerType;
    }
    this.grips.set(event.pointerId, at);
    try {
      // So the moves come here even off the surface (a synthetic id may throw).
      this.host.setPointerCapture(event.pointerId);
    } catch {
      // The moves still bubble through the surface while over it.
    }
    this.anchorGrips();
  }

  /** The hold changed shape (a finger came or went): measure from here on. */
  private anchorGrips(): void {
    if (this.grips.size === 0) {
      this.gripStart = null;
      this.wheelSum = 0;
      return;
    }
    const ids = [...this.grips.keys()].slice(0, 2);
    const at = ids.map((id) => ({ ...(this.grips.get(id) as RulerPt) }));
    this.gripStart = { pose: { ...this.current }, ids, at };
  }

  private moveWithGrips(): void {
    const start = this.gripStart;
    if (!start) return;
    const [first, second] = start.ids.map((id) => this.grips.get(id));
    if (!first) return;
    this.current =
      second && start.at.length === 2
        ? twoFingerPose(start.pose, [start.at[0], start.at[1]], [first, second], this.snap)
        : dragPose(start.pose, first.x - start.at[0].x, first.y - start.at[0].y);
    this.drawPose();
  }

  /** A pen or mouse coming down: follow the edge it is within reach of, if it may. */
  private follow(event: PointerEvent, at: RulerPt): void {
    this.endFollowing();
    if (!this.hooks.guides(event)) return;
    const edges = rulerEdges(this.spec, this.current);
    const index = nearestEdge(edges, at, RULER_REACH_PX);
    if (index < 0) return;
    const rect = this.host.getBoundingClientRect();
    // Half the ink's width outside the edge, so the line lies beside it and shows.
    const beside = offsetEdge(
      edges[index],
      Math.max(0, this.hooks.inkWidth()) / 2 + 0.5,
      rulerMiddle(this.spec, this.current),
    );
    this.lock = { edge: beside, index, pointer: event.pointerId, left: rect.left, top: rect.top };
    this.edgeEls[index]?.classList.add("is-following");
  }

  private endFollowing(): void {
    if (this.lock) this.edgeEls[this.lock.index]?.classList.remove("is-following");
    this.lock = null;
  }

  private releaseAll(): void {
    for (const id of this.grips.keys()) {
      if (this.host.hasPointerCapture?.(id)) this.host.releasePointerCapture(id);
    }
    this.grips.clear();
    this.gripStart = null;
    this.endFollowing();
  }

  private local(event: { clientX: number; clientY: number }): RulerPt {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // --- Drawing ---------------------------------------------------------------

  private svgEl(tag: string, cls?: string): SVGElement {
    const el = activeDocument.createElementNS(SVG_NS, tag);
    if (cls) el.setAttribute("class", cls);
    return el;
  }

  /** Place the ruler and keep its angle readout upright. */
  private drawPose(): void {
    const { x, y, angle } = this.current;
    this.el.setCssStyles({ transform: `translate(${x}px, ${y}px) rotate(${angle}deg)` });
    const readout = this.angleEl;
    readout.textContent = `${readoutAngle(angle)}°`;
    const ax = readout.getAttribute("x") ?? "0";
    const ay = readout.getAttribute("y") ?? "0";
    if (Math.abs(angle) > 90) readout.setAttribute("transform", `rotate(180 ${ax} ${ay})`);
    else readout.removeAttribute("transform");
  }

  /** The outline, its edges and the parts that do not depend on the zoom. */
  private drawBody(): void {
    const spec = this.spec;
    this.svg.setAttribute("class", `goodobsidian-ruler-svg is-${spec.kind}`);
    this.el.toggleClass("is-protractor", spec.kind === "protractor");
    this.bodyEl.setAttribute("d", bodyPath(spec));
    this.edgesEl.empty();
    this.edgeEls = rulerEdges(spec, { x: 0, y: 0, angle: 0 }).map((edge) => {
      const path = this.svgEl("path", "goodobsidian-ruler-edge") as SVGPathElement;
      path.setAttribute("d", edgePath(edge));
      this.edgesEl.append(path);
      return path;
    });
    // The readout sits in the ruler's middle; the protractor has none, its scale is its angle.
    const readoutAt =
      spec.kind === "straight"
        ? { x: 0, y: 12 }
        : spec.kind === "square"
          ? { x: -spec.length / 3 + 60, y: spec.length / 3 - 54 }
          : null;
    this.angleEl.toggleClass("is-hidden", readoutAt === null);
    if (readoutAt) {
      this.angleEl.setAttribute("x", String(readoutAt.x));
      this.angleEl.setAttribute("y", String(readoutAt.y));
    }
    if (spec.kind === "protractor") this.drawProtractorScale();
    else this.drawScale();
  }

  /** The centimetre marks, at the zoom now. */
  private drawScale(): void {
    const pxPerMm = PAGE_PX_PER_MM * this.scale;
    this.drawnPxPerMm = pxPerMm;
    const spec = this.spec;
    const marks: string[] = [];
    this.labelsEl.empty();
    const label = (x: number, y: number, text: string, anchor: "middle" | "start"): void => {
      const el = this.svgEl("text", "goodobsidian-ruler-label");
      el.setAttribute("x", x.toFixed(1));
      el.setAttribute("y", y.toFixed(1));
      el.setAttribute("text-anchor", anchor);
      el.textContent = text;
      this.labelsEl.append(el);
    };
    if (spec.kind === "straight") {
      const half = spec.length / 2;
      const top = -RULER_WIDTH / 2;
      const x0 = -half + SCALE_INSET;
      for (const tick of rulerTicks(spec.length - 2 * SCALE_INSET, pxPerMm)) {
        const x = (x0 + tick.at).toFixed(1);
        const h = TICK_LENGTHS[tick.level];
        // Along both long edges, so either measures.
        marks.push(`M${x} ${top}v${h}M${x} ${-top}v${-h}`);
        if (tick.label) label(x0 + tick.at, top + LABEL_DEPTH, tick.label, "middle");
      }
    } else if (spec.kind === "square") {
      const [right] = squareCorners(spec.length);
      // Along both legs from the right angle, stopping short of the narrow ends.
      const reach = spec.length - SCALE_INSET - 56;
      for (const tick of rulerTicks(reach, pxPerMm)) {
        const h = TICK_LENGTHS[tick.level];
        const x = right.x + SCALE_INSET + tick.at;
        const y = right.y - SCALE_INSET - tick.at;
        marks.push(`M${x.toFixed(1)} ${right.y}v${-h}M${right.x} ${y.toFixed(1)}h${h}`);
        if (tick.label && tick.mm > 0) {
          label(x, right.y - LABEL_DEPTH + 10, tick.label, "middle");
          label(right.x + LABEL_DEPTH - 8, y + 4, tick.label, "start");
        }
      }
    }
    this.ticksEl.setAttribute("d", marks.join(""));
  }

  /** The degree scale round the arc, and the centre mark on the base. */
  private drawProtractorScale(): void {
    const r = this.spec.length;
    const marks: string[] = ["M-8 0H8M0 0V-8"];
    this.labelsEl.empty();
    for (const tick of protractorTicks()) {
      const rad = (tick.deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const inner = r - TICK_LENGTHS[tick.level];
      marks.push(
        `M${(r * cos).toFixed(2)} ${(-r * sin).toFixed(2)}` +
          `L${(inner * cos).toFixed(2)} ${(-inner * sin).toFixed(2)}`,
      );
      if (tick.label) {
        const at = r - LABEL_DEPTH + 2;
        const el = this.svgEl("text", "goodobsidian-ruler-label");
        el.setAttribute("x", (at * cos).toFixed(1));
        // Raised clear of the base at 0° and 180°.
        el.setAttribute("y", (-at * sin + (sin < 0.2 ? -4 : 4)).toFixed(1));
        el.setAttribute("text-anchor", "middle");
        el.textContent = tick.label;
        this.labelsEl.append(el);
      }
    }
    this.ticksEl.setAttribute("d", marks.join(""));
  }
}

/** The ruler's outline in its own frame, with a window cut in the set square and the protractor. */
function bodyPath(spec: RulerSpec): string {
  switch (spec.kind) {
    case "straight": {
      const half = spec.length / 2;
      const across = RULER_WIDTH / 2;
      const r = 6;
      return (
        `M${-half + r} ${-across}H${half - r}a${r} ${r} 0 0 1 ${r} ${r}V${across - r}` +
        `a${r} ${r} 0 0 1 ${-r} ${r}H${-half + r}a${r} ${r} 0 0 1 ${-r} ${-r}V${-across + r}` +
        `a${r} ${r} 0 0 1 ${r} ${-r}Z`
      );
    }
    case "square": {
      const corners = squareCorners(spec.length);
      // The window: the triangle shrunk about its incentre.
      const inradius = (spec.length * (2 - Math.SQRT2)) / 2;
      const centre = { x: corners[0].x + inradius, y: corners[0].y - inradius };
      const k = Math.max(0, (inradius - SQUARE_WINDOW_INSET) / inradius);
      const inner = corners.map((p) => ({
        x: centre.x + (p.x - centre.x) * k,
        y: centre.y + (p.y - centre.y) * k,
      }));
      const loop = (pts: RulerPt[]): string =>
        pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("") + "Z";
      return loop(corners) + loop(inner);
    }
    case "protractor": {
      const r = spec.length;
      const w = r * PROTRACTOR_WINDOW;
      return `M${-r} 0A${r} ${r} 0 0 1 ${r} 0ZM${-w} -14A${w} ${w} 0 0 1 ${w} -14Z`;
    }
  }
}

/** One edge as a path, in the ruler's own frame. */
function edgePath(edge: RulerEdge): string {
  if (edge.type === "line") {
    return `M${edge.a.x.toFixed(2)} ${edge.a.y.toFixed(2)}L${edge.b.x.toFixed(2)} ${edge.b.y.toFixed(2)}`;
  }
  const { r } = edge;
  return `M${-r} 0A${r} ${r} 0 0 1 ${r} 0`;
}
