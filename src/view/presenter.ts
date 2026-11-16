/**
 * Present mode (⋯ › Present): the notebook as slides, for a lecture or a
 * screen share. The toolbar, pills and page counter go; the page being read
 * fills the screen on a dark desk; the laser pointer is in hand; a
 * presentation clicker or the arrow keys turn the pages (`present-keys.ts`).
 * A small bar of ‹ 3 / 12 › ✕ shows while the pointer moves and goes again
 * when it rests, so a finger or the Pencil can turn pages too.
 *
 * Where the window can go full screen (a computer, Android), the notebook
 * takes the whole screen; on an iPad the host hides Obsidian's chrome
 * instead. The host puts the pages, the tool and the zoom back on `onEnd`.
 */

import { setIcon } from "obsidian";
import { t } from "../i18n/translate";
import { swallowGhostClick } from "./ghost-click";
import { docOf, winOf } from "./host-window";
import { presentCount, presentStep } from "./present-keys";

export interface PresenterHost {
  /** The view's root: it takes the class and, where it can, the screen. */
  root: HTMLElement;
  next: () => void;
  previous: () => void;
  first: () => void;
  last: () => void;
  /** The page shown (zero-based) and how many there are. */
  page: () => { index: number; total: number };
  /** Present mode ended (✕, Escape, or the screen leaving full screen). */
  onEnd: () => void;
}

/** How long the bar stays after the pointer last moved, ms. */
const BAR_REST_MS = 2500;

export const PRESENTING_CLASS = "goodobsidian-presenting";

export class Presenter {
  private readonly bar: HTMLElement;
  private readonly count: HTMLElement;
  private readonly off: Array<() => void> = [];
  private hideTimer = 0;
  private ended = false;
  /** Whether this presenter put the root in full screen (so leaving it ends Present). */
  private tookScreen = false;

  constructor(private readonly host: PresenterHost) {
    const { root } = host;
    root.addClass(PRESENTING_CLASS);
    this.bar = root.createDiv({ cls: "goodobsidian-present-bar" });
    this.bar.setAttribute("role", "toolbar");
    this.bar.setAttribute("aria-label", t("view.morePanel.present"));
    this.button("chevron-left", t("toolbar.shortcut.previousPage"), () => host.previous());
    this.count = this.bar.createSpan({ cls: "goodobsidian-present-count" });
    this.button("chevron-right", t("toolbar.shortcut.nextPage"), () => host.next());
    this.button("x", t("view.present.stop"), () => this.stop());
    this.refresh();

    const win = winOf(root);
    const onKey = (event: KeyboardEvent): void => this.onKey(event);
    // Capture: a clicker's PageDown turns a page before the notebook scrolls.
    win.addEventListener("keydown", onKey, true);
    this.off.push(() => win.removeEventListener("keydown", onKey, true));
    const wake = (): void => this.showBar();
    root.addEventListener("pointermove", wake);
    root.addEventListener("pointerdown", wake);
    this.off.push(() => {
      root.removeEventListener("pointermove", wake);
      root.removeEventListener("pointerdown", wake);
    });
    this.takeScreen();
    this.showBar();
  }

  /** Whether a press of the ✕ or Escape has not ended it yet. */
  get active(): boolean {
    return !this.ended;
  }

  /** The page shown changed: the count follows. */
  refresh(): void {
    const { index, total } = this.host.page();
    this.count.setText(presentCount(index, total));
  }

  /** End Present mode: the screen, the bar and the class go, and the host restores the rest. */
  stop(): void {
    if (this.ended) return;
    this.ended = true;
    window.clearTimeout(this.hideTimer);
    for (const off of this.off.splice(0)) off();
    this.bar.remove();
    this.host.root.removeClass(PRESENTING_CLASS);
    const doc = docOf(this.host.root);
    if (this.tookScreen && doc.fullscreenElement === this.host.root) {
      void doc.exitFullscreen().catch(() => undefined);
    }
    this.host.onEnd();
  }

  private onKey(event: KeyboardEvent): void {
    // Typing in a text box keeps its keys.
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
    ) {
      return;
    }
    const step = presentStep(event);
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    if (step === "leave") {
      this.stop();
      return;
    }
    const { host } = this;
    if (step === "next") host.next();
    else if (step === "previous") host.previous();
    else if (step === "first") host.first();
    else host.last();
  }

  /** The whole screen where the platform allows it; leaving it (Esc in Chrome) ends Present. */
  private takeScreen(): void {
    const { root } = this.host;
    const doc = docOf(root);
    if (!doc.fullscreenEnabled || typeof root.requestFullscreen !== "function") return;
    const onChange = (): void => {
      if (doc.fullscreenElement === root) this.tookScreen = true;
      else if (this.tookScreen) this.stop();
    };
    doc.addEventListener("fullscreenchange", onChange);
    this.off.push(() => doc.removeEventListener("fullscreenchange", onChange));
    void root.requestFullscreen().catch(() => undefined);
  }

  private showBar(): void {
    if (this.ended) return;
    this.bar.addClass("is-shown");
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.bar.removeClass("is-shown"), BAR_REST_MS);
  }

  /**
   * A bar button: it acts on pointerup, since a Pencil tap over the page
   * makes no click on the iPad, and on click only from the keyboard.
   */
  private button(icon: string, label: string, run: () => void): void {
    const button = this.bar.createEl("button", { cls: "clickable-icon" });
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    let downHere = false;
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      downHere = true;
    });
    button.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      if (!downHere) return;
      downHere = false;
      swallowGhostClick(docOf(button), event);
      run();
      this.showBar();
    });
    button.addEventListener("pointercancel", () => {
      downHere = false;
    });
    button.addEventListener("click", (event) => {
      if (event.detail === 0) run();
    });
  }
}
