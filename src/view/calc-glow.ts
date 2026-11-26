/**
 * Calculation notes (FineNotes#178): the glow that says "this ink was read
 * as maths". A canvas in the paper, over the sum's bounds, that draws a soft
 * accent halo along the sum's strokes and a dotted accent line under each
 * group Grape was unsure of. It is chrome, not ink: nothing on the page
 * changes. A tap on it opens the maths card (the surface wires that).
 *
 * The halo is drawn with `shadowBlur`, not `ctx.filter`: WebKit before
 * Safari 18 has no canvas filters.
 */

import { type Bounds, POINT_STRIDE, type Stroke, strokeBounds } from "../model/document";
import { t } from "../i18n/translate";
import { onTap } from "./selection-bar";

/** Room around the sum for the halo, page px at fit zoom. */
const PAD = 18;
/** How far off the canvas the strokes are drawn, for their shadow alone to land on it, device px. */
const SHADOW_SHIFT = 100000;

export interface CalcGlowSpec {
  pageId: string;
  strokes: readonly Stroke[];
  /** Groups of stroke ids Grape was unsure of: a dotted line under each. */
  doubts: readonly (readonly string[])[];
}

export class CalcGlow {
  private readonly el: HTMLButtonElement;
  private readonly canvas: HTMLCanvasElement;
  private spec: CalcGlowSpec | null = null;
  private bounds: Bounds | null = null;
  /** The scale it was last drawn at, so a move alone does not redraw. */
  private drawnScale = 0;
  /** Where it was last placed, so a change of what is asked can redraw it there. */
  private placed: { left: number; top: number; scale: number } | null = null;
  /** The doubt the card is asking about ("Which did you write?"), or -1. */
  private asked = -1;

  /**
   * `onOpen` runs on a tap: with the index of the doubt tapped (its dotted
   * ink), or -1 for a tap anywhere else on the glow.
   */
  constructor(parent: HTMLElement, onOpen: (doubt: number) => void) {
    this.el = parent.createEl("button", { cls: "goodobsidian-calc-glow clickable-icon is-hidden" });
    this.el.setAttribute("aria-label", t("calculator.mathsMark"));
    this.canvas = this.el.createEl("canvas");
    let at = { x: 0, y: 0 };
    this.el.addEventListener("pointerdown", (event) => {
      at = { x: event.clientX, y: event.clientY };
    });
    onTap(this.el, () => onOpen(this.doubtAt(at.x, at.y)));
  }

  /** The doubt whose ink is under the client point, or -1. */
  private doubtAt(clientX: number, clientY: number): number {
    const spec = this.spec;
    const b = this.bounds;
    const scale = this.drawnScale;
    if (!spec || !b || !(scale > 0)) return -1;
    const rect = this.el.getBoundingClientRect();
    const x = (clientX - rect.left) / scale + b.minX - PAD;
    const y = (clientY - rect.top) / scale + b.minY - PAD;
    // Within about a fingertip of the character's ink.
    const reach = 14 / scale;
    let best = -1;
    let bestD = Infinity;
    spec.doubts.forEach((ids, i) => {
      const gb = unionBounds(spec.strokes.filter((s) => ids.includes(s.id)));
      if (!gb) return;
      const dx = Math.max(gb.minX - x, 0, x - gb.maxX);
      const dy = Math.max(gb.minY - y, 0, y - (gb.maxY + 8));
      const d = Math.hypot(dx, dy);
      if (d <= reach && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  /** Whether `node` is the glow (or inside it). */
  contains(node: Node | null): boolean {
    return node !== null && this.el.contains(node);
  }

  get pageId(): string | null {
    return this.spec?.pageId ?? null;
  }

  show(spec: CalcGlowSpec): void {
    this.spec = spec;
    let box: Bounds | null = null;
    for (const s of spec.strokes) {
      const b = strokeBounds(s);
      if (!b) continue;
      box = box
        ? {
            minX: Math.min(box.minX, b.minX),
            minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX),
            maxY: Math.max(box.maxY, b.maxY),
          }
        : { ...b };
    }
    this.bounds = box;
    this.drawnScale = 0;
    this.asked = -1;
    this.el.toggleClass("is-hidden", box === null);
  }

  hide(): void {
    this.spec = null;
    this.bounds = null;
    this.asked = -1;
    this.el.addClass("is-hidden");
  }

  /**
   * Mark doubt `doubt` as the one the card asks about: its ink gets a
   * highlighter band in the glow's colour, so it is plain which character
   * "Which did you write?" means. -1 takes the band away.
   */
  ask(doubt: number): void {
    if (doubt === this.asked) return;
    this.asked = doubt;
    this.drawnScale = 0;
    const at = this.placed;
    if (at) this.place(at.left, at.top, at.scale);
  }

  /** Place it over the sum: `left`, `top` are the page's corner in paper px, `scale` paper px per page px. */
  place(left: number, top: number, scale: number): void {
    const b = this.bounds;
    if (!b || !this.spec) return;
    this.placed = { left, top, scale };
    const pad = PAD;
    const x = (b.minX - pad) * scale;
    const y = (b.minY - pad) * scale;
    const w = (b.maxX - b.minX + 2 * pad) * scale;
    const h = (b.maxY - b.minY + 2 * pad) * scale;
    this.el.setCssStyles({
      left: `${left + x}px`,
      top: `${top + y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    if (Math.abs(scale - this.drawnScale) > 1e-6) this.draw(scale, w, h);
  }

  private draw(scale: number, w: number, h: number): void {
    const spec = this.spec;
    const b = this.bounds;
    const ctx = this.canvas.getContext("2d");
    if (!spec || !b || !ctx) return;
    this.drawnScale = scale;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.setCssStyles({ width: `${w}px`, height: `${h}px` });
    const accent = getComputedStyle(this.el).color || "#7b6cd9";
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.translate(PAD - b.minX, PAD - b.minY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // While the card asks about one character, only that one is lit.
    const lit = litFor(spec, this.asked);
    // The halo: only the blurred shadow of the strokes, so the ink under it
    // stays its own colour. The strokes are drawn far off the canvas and
    // their shadow shifted back (a shadow's offset is in device px).
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.globalAlpha = 0.65;
    ctx.shadowBlur = 12 * scale * dpr;
    ctx.shadowOffsetX = SHADOW_SHIFT;
    ctx.translate(-SHADOW_SHIFT / (dpr * scale), 0);
    for (const s of lit.strokes) {
      ctx.lineWidth = Math.max(5, s.size * 3);
      tracePath(ctx, s.pts);
      ctx.stroke();
    }
    ctx.restore();
    // The doubt the card asks about, marked as with a highlighter.
    const band = askedBand(spec, this.asked);
    if (band) {
      ctx.save();
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(band.minX, band.minY, band.maxX - band.minX, band.maxY - band.minY);
      ctx.restore();
    }
    // A dotted line under each group Grape was unsure of.
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([0.1, 5]);
    for (const ids of lit.doubts) {
      const group = spec.strokes.filter((s) => ids.includes(s.id));
      const gb = unionBounds(group);
      if (!gb) continue;
      ctx.beginPath();
      ctx.moveTo(gb.minX, gb.maxY + 5);
      ctx.lineTo(gb.maxX, gb.maxY + 5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * What glows: every stroke and every doubt's dotted line, or while the card
 * asks about doubt `asked`, that doubt's ink alone, so nothing else on the
 * page competes with it.
 */
export function litFor(
  spec: CalcGlowSpec,
  asked: number,
): { strokes: readonly Stroke[]; doubts: readonly (readonly string[])[] } {
  const ids = asked >= 0 ? spec.doubts[asked] : undefined;
  if (!ids) return { strokes: spec.strokes, doubts: spec.doubts };
  return { strokes: spec.strokes.filter((s) => ids.includes(s.id)), doubts: [ids] };
}

/** Room around an asked character's ink for its highlighter band, page px. */
const BAND_PAD = 4;

/**
 * The highlighter band for doubt `doubt` of `spec`, page px: its ink's
 * bounds with a little room, or null when there is no such doubt.
 */
export function askedBand(spec: CalcGlowSpec, doubt: number): Bounds | null {
  const ids = doubt >= 0 ? spec.doubts[doubt] : undefined;
  if (!ids) return null;
  const box = unionBounds(spec.strokes.filter((s) => ids.includes(s.id)));
  if (!box) return null;
  return {
    minX: box.minX - BAND_PAD,
    minY: box.minY - BAND_PAD,
    maxX: box.maxX + BAND_PAD,
    maxY: box.maxY + BAND_PAD,
  };
}

function tracePath(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
  ctx.beginPath();
  if (pts.length < POINT_STRIDE) return;
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === POINT_STRIDE) ctx.lineTo(pts[0] + 0.01, pts[1]);
  for (let i = POINT_STRIDE; i + 1 < pts.length; i += POINT_STRIDE) ctx.lineTo(pts[i], pts[i + 1]);
}

function unionBounds(strokes: readonly Stroke[]): Bounds | null {
  let box: Bounds | null = null;
  for (const s of strokes) {
    const b = strokeBounds(s);
    if (!b) continue;
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : { ...b };
  }
  return box;
}
