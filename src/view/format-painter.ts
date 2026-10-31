/**
 * The format painter over the page: once a selection's style is copied
 * ("Copy style" in its menu), a Pencil or mouse that taps or sweeps over
 * ink lays that style on it, a sweep at a time, until the user picks
 * another tool, presses the bar's ✕ or Escape. Fingers still scroll and
 * zoom: they are never taken.
 *
 * Like the eyedropper (`./eyedropper.ts`), every pen and mouse pointer is
 * handled on the window in the capture phase, before the page's own input
 * sees it. Unlike it, a press elsewhere (the toolbar's undo, a menu) does
 * not end it: picking a tool does, through the host. The bar at the bottom
 * is the eyedropper's, with the copied style drawn as a mark in place of
 * words.
 *
 * What a sweep hits and how it is painted are the host's (`paintAlong`,
 * `finish`): one sweep is one undo step.
 */

import { setIcon } from "obsidian";

import type { InkStyle } from "../model/format-painter";
import { swallowGhostClick } from "./ghost-click";
import { onTap } from "./selection-bar";

export interface FormatPainterHost {
  /** The page's input overlay: a press inside it is aimed at the page. */
  input: HTMLElement;
  /** Where the bar is drawn: a positioned box over the page. */
  layer: HTMLElement;
  /** Paint what lies along the sweep from one client point to the next. */
  paintAlong: (fromX: number, fromY: number, toX: number, toY: number) => void;
  /** The sweep has ended: make what it painted one undo step. */
  finish: () => void;
}

/** Controls inside the page's overlay (the lasso's bar and menu): pressing one is not painting. */
const CHROME = "button, .goodobsidian-selection-menu, .goodobsidian-selection-bar";

/** The widest the bar's mark draws a line, CSS px: a highlighter's band is shown narrower. */
const MARK_MAX_PX = 12;

export class FormatPainter {
  private copied: InkStyle | null = null;
  /** The pointer painting now, between its press and its lift. */
  private painting: number | null = null;
  private last: { x: number; y: number } | null = null;
  private bar: HTMLElement | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly host: FormatPainterHost) {}

  get armed(): boolean {
    return this.copied !== null;
  }

  /** The style being laid down, or `null` when the painter is away. */
  get style(): InkStyle | null {
    return this.copied;
  }

  /** Paint with `style` from now on; arming again replaces the style. */
  arm(style: InkStyle): void {
    this.cancel();
    this.copied = style;
    this.host.layer.addClass("is-format-painting");
    this.showBar(style);
    this.listen();
  }

  /** Put the painter away; a sweep under way is kept. */
  cancel(): void {
    if (!this.copied) return;
    if (this.painting !== null) this.host.finish();
    this.copied = null;
    this.painting = null;
    this.last = null;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.bar?.remove();
    this.bar = null;
    this.host.layer.removeClass("is-format-painting");
  }

  private get win(): Window {
    return this.host.input.ownerDocument.defaultView ?? window;
  }

  // --- Input -------------------------------------------------------------------

  private listen(): void {
    const win = this.win;
    const on = <K extends keyof WindowEventMap>(
      type: K,
      handle: (event: WindowEventMap[K]) => void,
    ): void => {
      const options = { capture: true, passive: false };
      win.addEventListener(type, handle, options);
      this.disposers.push(() => win.removeEventListener(type, handle, options));
    };
    on("pointerdown", (event) => this.onDown(event));
    on("pointermove", (event) => this.onMove(event));
    on("pointerup", (event) => this.onUp(event));
    // WebKit's own long press ends a still Pencil in a cancel: keep the sweep.
    on("pointercancel", (event) => this.onUp(event));
    on("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    });
  }

  /** Whether `target` is the page, not a control over it or anything elsewhere. */
  private onPage(target: EventTarget | null): boolean {
    const el = target as Element | null;
    if (!el || !this.host.input.contains(el)) return false;
    return typeof el.closest !== "function" || el.closest(CHROME) === null;
  }

  private onDown(event: PointerEvent): void {
    // Fingers scroll and zoom as ever; the bar's buttons are buttons.
    if (event.pointerType === "touch" || !this.onPage(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    // A second pen, or a mouse's other buttons, paint nothing.
    if (this.painting !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    this.painting = event.pointerId;
    this.last = { x: event.clientX, y: event.clientY };
    this.host.paintAlong(event.clientX, event.clientY, event.clientX, event.clientY);
  }

  private onMove(event: PointerEvent): void {
    if (event.pointerId !== this.painting || !this.last) return;
    event.preventDefault();
    event.stopPropagation();
    const samples =
      typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    for (const sample of samples.length > 0 ? samples : [event]) {
      this.host.paintAlong(this.last.x, this.last.y, sample.clientX, sample.clientY);
      this.last = { x: sample.clientX, y: sample.clientY };
    }
  }

  private onUp(event: PointerEvent): void {
    if (event.pointerId !== this.painting) return;
    event.preventDefault();
    event.stopPropagation();
    this.painting = null;
    this.last = null;
    // A mouse's lift still makes a click on the page; it is not the page's.
    if (event.type === "pointerup") swallowGhostClick(this.host.input.ownerDocument, event);
    this.host.finish();
  }

  // --- The bar ---------------------------------------------------------------------

  private showBar(style: InkStyle): void {
    const bar = this.host.layer.createDiv({
      cls: "goodobsidian-eyedrop-bar goodobsidian-paint-bar",
    });
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-label", "Paste style");
    setIcon(bar.createSpan({ cls: "goodobsidian-eyedrop-bar-icon" }), "paintbrush");
    // The mark *is* the style: a value, not chrome.
    const mark = bar.createSpan({ cls: "goodobsidian-paint-mark" });
    mark.setAttribute("aria-hidden", "true");
    const width = Math.max(2, Math.min(MARK_MAX_PX, style.size));
    const dash = style.shape?.dash;
    mark.setCssStyles({
      borderTop: `${width}px ${dash === "dot" ? "dotted" : dash === "dash" ? "dashed" : "solid"} ${style.color}`,
    });
    mark.toggleClass("is-highlighter", style.tool === "highlighter");
    const close = bar.createEl("button", {
      cls: "goodobsidian-eyedrop-bar-button clickable-icon",
      attr: { "aria-label": "Done", title: "Done" },
    });
    setIcon(close, "x");
    onTap(close, () => this.cancel());
    this.bar = bar;
  }
}
