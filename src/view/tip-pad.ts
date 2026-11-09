/**
 * "Try it": a small sheet that runs the real recognisers, so a gesture can be
 * practised without touching a notebook.
 */

import { setIcon } from "obsidian";
import { recognizeShape } from "../ink/shape-recognizer";
import { detectScribble } from "../ink/scribble";
import { SCENE_HEIGHT, SCENE_WIDTH, scrawl } from "../model/tip-scenes";

const SCALE = 2;
const HOLD_MS = 380;
const STILL_PX = 5;
const INK = "#1b2a6b";

export class TipPad {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly done: HTMLElement;
  private readonly word = new Path2D(scrawl(60, 100, 200, 3, 16));
  /** The stroke being drawn, flat `[x, y, pressure, …]` in canvas px. */
  private points: number[] = [];
  private timer = 0;
  private anchor: readonly [number, number] = [0, 0];
  private live = false;

  constructor(
    parent: HTMLElement,
    private readonly mode: "shape" | "scribble",
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-tips-pad" });
    this.canvas = this.el.createEl("canvas", {
      attr: { width: SCENE_WIDTH * SCALE, height: SCENE_HEIGHT * SCALE },
    });
    this.done = this.el.createDiv({ cls: "goodobsidian-tips-pad-done" });
    setIcon(this.done, "check");
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("FineNotes: no canvas for the tips pad");
    this.g = context;
    this.g.lineCap = "round";
    this.g.lineJoin = "round";
    this.reset();
    this.canvas.addEventListener("pointerdown", (event) => this.down(event));
    this.canvas.addEventListener("pointermove", (event) => this.move(event));
    this.canvas.addEventListener("pointerup", () => this.up());
    this.canvas.addEventListener("pointercancel", () => this.up());
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.el.remove();
  }

  private reset(): void {
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.done.removeClass("is-shown");
    if (this.mode !== "scribble") return;
    this.g.save();
    this.g.scale(SCALE, SCALE);
    this.g.lineWidth = 2.6;
    this.g.strokeStyle = INK;
    this.g.stroke(this.word);
    this.g.restore();
  }

  private at(event: PointerEvent): [number, number] {
    const box = this.canvas.getBoundingClientRect();
    return [
      ((event.clientX - box.left) * this.canvas.width) / Math.max(1, box.width),
      ((event.clientY - box.top) * this.canvas.height) / Math.max(1, box.height),
    ];
  }

  private down(event: PointerEvent): void {
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.reset();
    const [x, y] = this.at(event);
    this.points = [x, y, 0.5];
    this.live = true;
    this.anchor = [x, y];
    this.armHold();
  }

  private move(event: PointerEvent): void {
    if (!this.live) return;
    const [x, y] = this.at(event);
    const lastX = this.points[this.points.length - 3];
    const lastY = this.points[this.points.length - 2];
    if (Math.hypot(x - lastX, y - lastY) < 2) return;
    this.g.lineWidth = 5.2;
    this.g.strokeStyle = this.mode === "scribble" ? "#d0394b" : INK;
    this.g.beginPath();
    this.g.moveTo(lastX, lastY);
    this.g.lineTo(x, y);
    this.g.stroke();
    this.points.push(x, y, 0.5);
    if (Math.hypot(x - this.anchor[0], y - this.anchor[1]) > STILL_PX * SCALE) {
      this.anchor = [x, y];
      this.armHold();
    }
  }

  private up(): void {
    window.clearTimeout(this.timer);
    if (!this.live) return;
    this.live = false;
    if (this.mode !== "scribble") return;
    if (detectScribble(this.points, { minSize: 40 * SCALE })) {
      this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.done.addClass("is-shown");
    }
  }

  /** "Nothing happened for a moment" is a timer: a still pen sends no events. */
  private armHold(): void {
    window.clearTimeout(this.timer);
    if (this.mode === "shape") this.timer = window.setTimeout(() => this.snap(), HOLD_MS);
  }

  private snap(): void {
    if (!this.live) return;
    const result = recognizeShape(this.points, { held: true });
    if (!result) return;
    this.live = false;
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.g.lineWidth = 5.2;
    this.g.strokeStyle = INK;
    this.g.beginPath();
    for (let i = 0; i + 1 < result.pts.length; i += 3) {
      if (i === 0) this.g.moveTo(result.pts[i], result.pts[i + 1]);
      else this.g.lineTo(result.pts[i], result.pts[i + 1]);
    }
    this.g.stroke();
    this.done.addClass("is-shown");
  }
}
