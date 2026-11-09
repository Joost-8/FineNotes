/**
 * Plays a tip's picture: builds a scene's SVG and runs it with Web Animations.
 * Paused pictures rest on the scene's best frame, which is also what someone
 * who asked for reduced motion sees.
 */

import {
  SCENE_HEIGHT,
  SCENE_MS,
  SCENE_WIDTH,
  type Motion,
  type SceneKeyframe,
  type SceneShape,
  type TipScene,
  motionKeyframes,
  penPresence,
  sampleTrack,
} from "../model/tip-scenes";

/** Samples along a path for the pen riding it. */
const PEN_STEPS = 48;
const EASE = "cubic-bezier(.45,.05,.3,1)";

function prefersStill(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export class TipVisual {
  readonly el: HTMLElement;
  private readonly animations: Animation[] = [];
  private readonly rest: number;
  private readonly still = prefersStill();

  constructor(parent: HTMLElement, scene: TipScene) {
    this.rest = scene.rest;
    this.el = parent.createDiv({ cls: "goodobsidian-tv" });
    const svg = this.el.createSvg("svg", {
      attr: { viewBox: `0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`, "aria-hidden": "true" },
    });
    for (const shape of scene.shapes) this.add(svg, shape);
    this.pause();
    if (!this.still) this.play();
  }

  play(): void {
    if (this.still) return;
    for (const animation of this.animations) animation.play();
  }

  /** Stop on the scene's best frame. */
  pause(): void {
    for (const animation of this.animations) {
      animation.pause();
      animation.currentTime = this.rest * SCENE_MS;
    }
  }

  destroy(): void {
    for (const animation of this.animations) animation.cancel();
    this.animations.length = 0;
    this.el.remove();
  }

  private add(parent: SVGElement, shape: SceneShape): void {
    if (shape.kind === "group") {
      const holder = shape.place
        ? parent.createSvg("g", {
            attr: {
              transform: `translate(${shape.place.x} ${shape.place.y}) scale(${shape.place.scale})`,
            },
          })
        : parent;
      const group = holder.createSvg("g", { cls: "goodobsidian-tv-moves" });
      for (const child of shape.children) this.add(group, child);
      if (shape.motion) this.animate(group, shape.motion);
      return;
    }
    const el = this.painted(parent, shape);
    if (shape.motion?.draw) {
      el.setAttribute("pathLength", "1");
      el.addClass("is-drawn");
    }
    if (shape.motion) this.animate(el, shape.motion);
    if (shape.kind === "path" && shape.pen) this.ridePen(parent, el, shape.pen, shape.rider);
  }

  private painted(parent: SVGElement, shape: Exclude<SceneShape, { kind: "group" }>): SVGElement {
    const fill = shape.fill === true || shape.kind === "text";
    const cls = [
      "goodobsidian-tv-moves",
      `goodobsidian-tv-${shape.tone}`,
      fill ? "is-fill" : "is-line",
    ];
    let el: SVGElement;
    if (shape.kind === "path") {
      el = parent.createSvg("path", { cls, attr: { d: shape.d } });
    } else if (shape.kind === "rect") {
      const { x, y, w: width, h: height, r: rx = 0 } = shape;
      el = parent.createSvg("rect", { cls, attr: { x, y, width, height, rx } });
    } else if (shape.kind === "circle") {
      const { cx, cy, r } = shape;
      el = parent.createSvg("circle", { cls, attr: { cx, cy, r } });
    } else {
      el = parent.createSvg("text", {
        cls,
        attr: {
          x: shape.x,
          y: shape.y,
          "font-size": shape.size,
          ...(shape.fit === undefined
            ? {}
            : { textLength: shape.fit, lengthAdjust: "spacingAndGlyphs" }),
        },
      });
      el.textContent = shape.text;
      if (shape.face) el.addClass(`is-${shape.face}`);
    }
    el.setAttribute("stroke-width", String(shape.width ?? 2));
    if (shape.dashed) el.addClass("is-dashed");
    return el;
  }

  private animate(el: SVGElement, motion: Motion): void {
    for (const frames of motionKeyframes(motion)) {
      const easedFrames = frames.map((frame) =>
        "transform" in frame ? { ...frame, easing: EASE } : frame,
      );
      this.run(el, easedFrames);
    }
  }

  private run(el: SVGElement, frames: SceneKeyframe[]): void {
    this.animations.push(
      el.animate(frames, {
        duration: SCENE_MS,
        iterations: Infinity,
        fill: "both",
      }),
    );
  }

  /** A pencil whose tip follows `path` between the two offsets. */
  private ridePen(
    parent: SVGElement,
    path: SVGElement,
    [from, to]: readonly [number, number],
    rider: "pen" | "finger" = "pen",
  ): void {
    const geometry = path as SVGPathElement;
    const length = geometry.getTotalLength?.() ?? 0;
    if (length <= 0) return;
    const pen = parent.createSvg("g", { cls: "goodobsidian-tv-pen" });
    if (rider === "finger") {
      pen.createSvg("circle", { cls: "goodobsidian-tv-finger", attr: { r: 15 } });
    } else {
      pen.createSvg("path", { attr: { d: "M0 0L3 -11L37 -45L47 -35L13 -2Z" } });
      pen.createSvg("path", { cls: "goodobsidian-tv-pen-tip", attr: { d: "M0 0L3 -11L13 -2Z" } });
    }
    const start = geometry.getPointAtLength(0);
    const frames: SceneKeyframe[] = [
      { offset: 0, transform: `translate(${start.x}px,${start.y}px)` },
    ];
    if (from > 0) frames.push({ offset: from, transform: `translate(${start.x}px,${start.y}px)` });
    for (let i = 1; i <= PEN_STEPS; i++) {
      const point = geometry.getPointAtLength((length * i) / PEN_STEPS);
      frames.push({
        offset: from + ((to - from) * i) / PEN_STEPS,
        transform: `translate(${point.x}px,${point.y}px)`,
      });
    }
    const end = geometry.getPointAtLength(length);
    if (to < 1) frames.push({ offset: 1, transform: `translate(${end.x}px,${end.y}px)` });
    this.run(pen, frames);
    const presence = penPresence(from, to);
    this.run(
      pen,
      [...new Set([0, ...presence.map(([at]) => at), 1])].map((offset) => ({
        offset,
        opacity: sampleTrack(presence, offset),
      })),
    );
  }
}
