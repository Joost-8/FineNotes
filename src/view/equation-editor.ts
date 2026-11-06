/**
 * The equation window (discussion #166): the LaTeX source in a field, the
 * formula below it as the page will draw it (the page's own painter, on a
 * canvas), ✓ to place it. Return places it too, Esc closes, and an empty
 * source places nothing. It floats over the notebook like the calculator
 * (`floating-window.ts`), so it moves and closes the same way.
 */

import { setIcon } from "obsidian";
import type { WindowPlace } from "../model/calculator-store";
import { equationFrameSize, equationLayout, paintLayout } from "../canvas/equation-paint";
import { FloatingWindow } from "./floating-window";
import { t } from "../i18n/translate";

export interface EquationEditorOptions {
  /** The notebook view's content area. */
  container: HTMLElement;
  /** The source to start from: an equation's, to edit it; "" for a new one. */
  tex: string;
  /** Its ink colour and size, for the preview. */
  color: string;
  size: number;
  /** Placed (✓ or Return) with a source that is not blank. */
  done(tex: string): void;
  /** Closed without placing (the cross, Esc, or a blank source). */
  cancel?(): void;
}

/** Where the window was last, this session: it opens there again. */
let lastPlace: WindowPlace | null = null;

/** The window's size on first opening, CSS px. */
const FIRST = { w: 440, h: 250 };
/** The smallest it may be sized to. */
const MIN = { w: 280, h: 200 };
/** The preview's largest size, CSS px: a big formula is shown smaller, never cut off. */
const PREVIEW_MAX_SIZE = 30;

export class EquationEditor {
  private readonly frame: FloatingWindow;
  private readonly field: HTMLTextAreaElement;
  private readonly preview: HTMLCanvasElement;
  private readonly placeButton: HTMLButtonElement;
  private closed = false;
  private resizeWatch: ResizeObserver | null = null;

  constructor(private readonly options: EquationEditorOptions) {
    this.frame = new FloatingWindow({
      container: options.container,
      cls: "goodobsidian-eq-window",
      title: t("surface.equation.title"),
      label: t("surface.equation.title"),
      closeLabel: t("common.cancel"),
      min: MIN,
      firstPlace: (bounds) => ({
        x: Math.max(8, Math.round((bounds.w - FIRST.w) / 2)),
        // Below the Text tool's pill, which stays in view while it is open.
        y: 120,
        w: FIRST.w,
        h: FIRST.h,
      }),
      place: () => lastPlace,
      savePlace: (place) => {
        lastPlace = place;
      },
      onClose: () => this.close(false),
    });
    const body = this.frame.body.createDiv({ cls: "goodobsidian-eq" });
    this.field = body.createEl("textarea", {
      cls: "goodobsidian-eq-source",
      attr: {
        rows: "2",
        spellcheck: "false",
        autocapitalize: "off",
        autocomplete: "off",
        autocorrect: "off",
        "aria-label": t("surface.equation.source"),
        placeholder: "\\frac{a}{b}",
      },
    });
    this.field.value = options.tex;
    this.preview = body.createEl("canvas", { cls: "goodobsidian-eq-preview" });
    this.preview.setAttribute("role", "img");
    const bar = body.createDiv({ cls: "goodobsidian-eq-bar" });
    this.placeButton = bar.createEl("button", {
      cls: "clickable-icon goodobsidian-eq-place mod-cta",
      attr: { "aria-label": t("surface.equation.place") },
    });
    setIcon(this.placeButton, "check");
    // A Pencil tap over the page may never become a click (CLAUDE.md): act on pointerup.
    this.placeButton.addEventListener("pointerup", (event) => {
      event.preventDefault();
      this.place();
    });
    this.placeButton.addEventListener("click", (event) => {
      if (event.detail === 0) this.place();
    });
    this.field.addEventListener("input", () => this.draw());
    this.field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.place();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close(false);
      }
      // The notebook's own keys (tools, undo) are not for this field.
      event.stopPropagation();
    });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeWatch = new ResizeObserver(() => this.draw());
      this.resizeWatch.observe(this.preview);
    }
    this.draw();
    this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
  }

  /** The source in the field now. */
  get tex(): string {
    return this.field.value;
  }

  /** Take the window away without placing anything (another one opened, the view closed). */
  close(placed = false): void {
    if (this.closed) return;
    this.closed = true;
    this.resizeWatch?.disconnect();
    this.frame.destroy();
    if (!placed) this.options.cancel?.();
  }

  private place(): void {
    const tex = this.field.value.trim();
    if (!tex) {
      this.close(false);
      return;
    }
    this.close(true);
    this.options.done(tex);
  }

  /** Draw the formula as the page will, fitted into the preview. */
  private draw(): void {
    const canvas = this.preview;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || cssW === 0 || cssH === 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const tex = this.field.value.trim();
    this.placeButton.disabled = tex.length === 0;
    canvas.setAttribute("aria-label", tex);
    if (!tex) return;
    const size = Math.min(this.options.size, PREVIEW_MAX_SIZE);
    const layout = equationLayout(ctx, tex, size);
    const frame = equationFrameSize(layout, size);
    const k = Math.min(1, cssW / frame.w, cssH / frame.h);
    const height = layout.a + layout.d;
    ctx.save();
    ctx.translate((cssW - layout.w * k) / 2, (cssH - height * k) / 2 + layout.a * k);
    ctx.scale(k, k);
    // The text colour of the window, not the ink's: the preview sits on the window, not the page.
    const color = getComputedStyle(canvas).color || this.options.color;
    paintLayout(ctx, layout, color);
    ctx.restore();
  }
}
