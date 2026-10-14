/**
 * The eyedropper over the page. A colour picker arms it; the next press on
 * the page picks the colour there and hands it back, and the page does
 * nothing else with that press. A loupe shows the colour under the pen,
 * finger or mouse while it aims (and while a mouse or a hovering Pencil
 * moves over the page), a bar at the bottom says what to do and cancels, and
 * Escape or a press anywhere off the page cancels too.
 *
 * What a press picks is the host's call (`colorAt`, from
 * `../canvas/eyedropper`): an element's stored colour, else the pixels.
 *
 * Every pointer is handled through pointer events on the window, in the
 * capture phase, before the page's own input sees them: a Pencil tap over
 * the page never becomes a `click` (the surface cancels its touches), and a
 * press cancelled here keeps its default, so focus never moves. A text box
 * being edited keeps its keyboard while a colour is picked for it.
 *
 * On a computer, where the browser has its own `EyeDropper` (Chromium, so
 * Obsidian's desktop app), the bar also offers to pick from anywhere on the
 * screen. That colour is whatever the screen shows, dark pages included:
 * the screen has no note behind it to read a stored colour from.
 */

import { setIcon } from "obsidian";

import type { EyedropResult } from "../canvas/eyedropper";
import { parseHexColor } from "../model/colors";
import { onTap } from "./selection-bar";

export interface EyedropperHost {
  /** The page's input overlay: a press inside it is aimed at the page. */
  input: HTMLElement;
  /** Where the loupe and the bar are drawn: a positioned box over the page. */
  layer: HTMLElement;
  /** What a press at this client point picks; `null` off the pages. */
  colorAt: (clientX: number, clientY: number) => EyedropResult | null;
}

interface ScreenEyeDropper {
  open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
}

/** The browser's own eyedropper, where it has one: Chromium, so Obsidian on a computer. */
export function screenEyeDropper(win: Window): (new () => ScreenEyeDropper) | null {
  const ctor = (win as unknown as { EyeDropper?: unknown }).EyeDropper;
  return typeof ctor === "function" ? (ctor as new () => ScreenEyeDropper) : null;
}

/** Controls inside the page's overlay (the lasso's bar and menu): pressing one is not aiming. */
const CHROME = "button, .goodobsidian-selection-menu, .goodobsidian-selection-bar";

/** How long after a pick the click a mouse makes of it is swallowed. */
const CLICK_AFTER_PICK_MS = 500;

export class Eyedropper {
  private done: ((color: string | null) => void) | null = null;
  /** The pointer aiming now, between its press and its lift. */
  private aiming: number | null = null;
  private loupe: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private screenPick: AbortController | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly host: EyedropperHost) {}

  get armed(): boolean {
    return this.done !== null;
  }

  /**
   * Wait for a pick. `done` gets the colour (`#rrggbb`), or `null` when the
   * pick is cancelled. Arming again cancels the pick still waiting.
   */
  arm(done: (color: string | null) => void): void {
    this.cancel();
    this.done = done;
    this.host.layer.addClass("is-eyedropping");
    this.showBar();
    this.listen();
  }

  /** Stop waiting; the host hears `null`. */
  cancel(): void {
    this.finish(null);
  }

  private get win(): Window {
    return this.host.input.ownerDocument.defaultView ?? window;
  }

  private finish(color: string | null): void {
    const done = this.done;
    if (!done) return;
    this.done = null;
    this.aiming = null;
    this.screenPick?.abort();
    this.screenPick = null;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.loupe?.remove();
    this.loupe = null;
    this.bar?.remove();
    this.bar = null;
    this.host.layer.removeClass("is-eyedropping");
    done(color);
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
    on("pointercancel", (event) => {
      // WebKit took the pointer (its own long press): aim again.
      if (event.pointerId !== this.aiming) return;
      this.aiming = null;
      this.hideLoupe();
    });
    // No click, scroll or focus from a touch on the page while armed.
    const holdTouch = (event: TouchEvent): void => {
      if (this.onPage(event.target) && event.cancelable) event.preventDefault();
    };
    on("touchstart", holdTouch);
    on("touchmove", holdTouch);
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

  private onBar(target: EventTarget | null): boolean {
    return this.bar?.contains(target as Node | null) === true;
  }

  private onDown(event: PointerEvent): void {
    // The bar's buttons are buttons.
    if (this.onBar(event.target)) return;
    if (!this.onPage(event.target)) {
      // A press anywhere else (the toolbar, a menu, another pane) cancels,
      // and goes on to do what it does.
      this.cancel();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // A second finger, or a mouse's other buttons, aim nothing.
    if (this.aiming !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    this.aiming = event.pointerId;
    this.preview(event.clientX, event.clientY);
  }

  private onMove(event: PointerEvent): void {
    if (event.pointerId === this.aiming) {
      event.preventDefault();
      event.stopPropagation();
      this.preview(event.clientX, event.clientY);
      return;
    }
    if (this.aiming !== null || this.screenPick) return;
    // A mouse, or a Pencil hovering over the glass: the loupe follows, nothing is picked.
    const hovering = event.pointerType !== "touch" && event.buttons === 0;
    if (hovering && this.onPage(event.target)) this.preview(event.clientX, event.clientY);
    else this.hideLoupe();
  }

  private onUp(event: PointerEvent): void {
    if (event.pointerId !== this.aiming) return;
    event.preventDefault();
    event.stopPropagation();
    this.aiming = null;
    const picked = this.host.colorAt(event.clientX, event.clientY);
    // Lifting off the pages (the desk beside them) is a cancel, not a pick.
    this.swallowClick();
    this.finish(picked?.color ?? null);
  }

  /** A mouse's pick still makes a click on the page after the lift; it is not the page's. */
  private swallowClick(): void {
    const win = this.win;
    const input = this.host.input;
    const stop = (event: MouseEvent): void => {
      if (!input.contains(event.target as Node | null)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    win.addEventListener("click", stop, true);
    win.setTimeout(() => win.removeEventListener("click", stop, true), CLICK_AFTER_PICK_MS);
  }

  // --- The loupe -----------------------------------------------------------------

  /** Show what a press here would pick, beside the point. */
  private preview(clientX: number, clientY: number): void {
    const loupe = this.loupe ?? this.makeLoupe();
    const picked = this.host.colorAt(clientX, clientY);
    const box = this.host.layer.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    loupe.removeClass("is-hidden");
    // Above the point, out from under a finger; below it near the top.
    loupe.toggleClass("is-below", y < 120);
    loupe.setCssStyles({ left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
    loupe.toggleClass("is-off", !picked);
    const swatch = loupe.querySelector<HTMLElement>(".goodobsidian-eyedrop-swatch");
    const label = loupe.querySelector<HTMLElement>(".goodobsidian-eyedrop-hex");
    // The swatch *is* the colour: a value, not chrome.
    swatch?.setCssStyles({ backgroundColor: picked?.color ?? "" });
    label?.setText(picked ? picked.color.toUpperCase() : "Off the page");
  }

  private makeLoupe(): HTMLElement {
    const loupe = this.host.layer.createDiv({ cls: "goodobsidian-eyedrop-loupe is-hidden" });
    loupe.setAttribute("aria-hidden", "true");
    loupe.createDiv({ cls: "goodobsidian-eyedrop-target" });
    const bubble = loupe.createDiv({ cls: "goodobsidian-eyedrop-bubble" });
    bubble.createDiv({ cls: "goodobsidian-eyedrop-swatch" });
    bubble.createDiv({ cls: "goodobsidian-eyedrop-hex" });
    this.loupe = loupe;
    return loupe;
  }

  private hideLoupe(): void {
    this.loupe?.addClass("is-hidden");
  }

  // --- The bar ---------------------------------------------------------------------

  private showBar(): void {
    const bar = this.host.layer.createDiv({ cls: "goodobsidian-eyedrop-bar" });
    bar.setAttribute("role", "status");
    setIcon(bar.createSpan({ cls: "goodobsidian-eyedrop-bar-icon" }), "pipette");
    bar.createSpan({ cls: "goodobsidian-eyedrop-bar-text", text: "Tap the page to pick a colour" });
    if (screenEyeDropper(this.win)) {
      const screen = this.barButton(bar, "monitor", "Pick from the screen", "From screen");
      onTap(screen, () => void this.pickFromScreen());
    }
    const close = this.barButton(bar, "x", "Cancel");
    onTap(close, () => this.cancel());
    this.bar = bar;
  }

  private barButton(
    bar: HTMLElement,
    icon: string,
    label: string,
    text?: string,
  ): HTMLButtonElement {
    const button = bar.createEl("button", {
      cls: "goodobsidian-eyedrop-bar-button clickable-icon",
      attr: { "aria-label": label, title: label },
    });
    setIcon(button, icon);
    if (text) button.createSpan({ text });
    return button;
  }

  /**
   * The browser's eyedropper, over the whole screen. Escape there gives up
   * on the screen only: the page can still be tapped.
   */
  private async pickFromScreen(): Promise<void> {
    const Picker = screenEyeDropper(this.win);
    if (!Picker || this.screenPick) return;
    const abort = new AbortController();
    this.screenPick = abort;
    this.hideLoupe();
    this.bar?.addClass("is-screen");
    try {
      const { sRGBHex } = await new Picker().open({ signal: abort.signal });
      if (this.screenPick !== abort) return;
      const color = parseHexColor(sRGBHex);
      this.screenPick = null;
      if (color) this.finish(color);
      else this.bar?.removeClass("is-screen");
    } catch {
      // Cancelled with Escape, or aborted because the pick ended.
      if (this.screenPick !== abort) return;
      this.screenPick = null;
      this.bar?.removeClass("is-screen");
    }
  }
}
