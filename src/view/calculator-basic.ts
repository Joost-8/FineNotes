/**
 * The calculator's Basic mode: a pocket calculator laid out as the iPhone's
 * Calculator in portrait. A large number, right-aligned, that shrinks to
 * fit; the sum so far above it; and a 4 x 5 grid of big round keys, the
 * operators in the accent colour and the one just pressed lit. It wears
 * Obsidian's variables and FineNotes' chrome, not Apple's artwork.
 *
 * The counting is `model/basic-calc.ts`. The window, the mode switch, Insert
 * and the hardware keyboard belong to `calculator-popover.ts`, which hands
 * this its pointer-driven button maker (a Pencil tap over the page may never
 * become a click: CLAUDE.md).
 */

import { fittedFontSize } from "../model/calculator-keys";
import {
  BASIC_START,
  type BasicKey,
  type BasicOp,
  type BasicState,
  activeOp,
  basicDisplay,
  basicTape,
  clearLabel,
  formatBasic,
  isBasicClear,
  pressBasic,
  shownValue,
} from "../model/basic-calc";

const NUMBER_MAX_PX = 64;
const NUMBER_MIN_PX = 22;
/** A swipe across the number this far deletes a digit, as on iOS. */
const SWIPE_PX = 36;

/** What Basic needs from the calculator around it. */
export interface BasicHost {
  button(parent: HTMLElement, label: string, run: () => void, cls?: string): HTMLButtonElement;
  /** = worked out a line: for the notebook's history. */
  worked(line: { expr: string; result: string }): void;
  /** The state changed (Insert's buttons follow it). */
  changed(): void;
}

interface PadKey {
  label: string;
  aria: string;
  key: BasicKey;
  tone: "fn" | "digit" | "op" | "equals";
  wide?: true;
}

const op = (o: BasicOp, aria: string): PadKey => ({ label: o, aria, key: { op: o }, tone: "op" });
const digit = (d: number): PadKey => ({
  label: String(d),
  aria: String(d),
  key: { digit: d },
  tone: "digit",
});

/** The keypad, row by row, as the iPhone lays it out in portrait. */
const PAD: readonly (readonly PadKey[])[] = [
  [
    { label: "AC", aria: "Clear", key: { clear: true }, tone: "fn" },
    { label: "±", aria: "Change sign", key: { negate: true }, tone: "fn" },
    { label: "%", aria: "Percent", key: { percent: true }, tone: "fn" },
    op("÷", "Divide"),
  ],
  [digit(7), digit(8), digit(9), op("×", "Multiply")],
  [digit(4), digit(5), digit(6), op("−", "Subtract")],
  [digit(1), digit(2), digit(3), op("+", "Add")],
  [
    { ...digit(0), wide: true },
    { label: ".", aria: "Decimal point", key: { point: true }, tone: "digit" },
    { label: "=", aria: "Equals", key: { equals: true }, tone: "equals" },
  ],
];

/** Basic's sum outlives the window, as the scientific answer does. */
let kept: BasicState = BASIC_START;

export class BasicPad {
  readonly displayEl: HTMLElement;
  readonly padEl: HTMLElement;
  private readonly tapeEl: HTMLElement;
  private readonly numberEl: HTMLElement;
  private readonly clearKey: HTMLButtonElement;
  private readonly opKeys = new Map<BasicOp, HTMLButtonElement>();

  constructor(
    displayParent: HTMLElement,
    padParent: HTMLElement,
    private readonly host: BasicHost,
  ) {
    this.displayEl = displayParent.createDiv({ cls: "goodobsidian-calc-basic-display" });
    this.tapeEl = this.displayEl.createDiv({ cls: "goodobsidian-calc-basic-tape" });
    this.numberEl = this.displayEl.createDiv({ cls: "goodobsidian-calc-basic-number" });
    this.numberEl.setAttribute("aria-live", "polite");
    this.installSwipe();

    this.padEl = padParent.createDiv({ cls: "goodobsidian-calc-basic-pad" });
    const grid = this.padEl.createDiv({ cls: "goodobsidian-calc-basic-grid" });
    let clearKey: HTMLButtonElement | null = null;
    for (const row of PAD) {
      for (const pad of row) {
        const button = host.button(
          grid,
          pad.label,
          () => this.press(pad.key),
          `goodobsidian-calc-bkey is-${pad.tone}`,
        );
        button.setAttribute("aria-label", pad.aria);
        if (pad.wide) button.addClass("is-wide");
        if ("clear" in pad.key) clearKey = button;
        if ("op" in pad.key) this.opKeys.set(pad.key.op, button);
      }
    }
    this.clearKey = clearKey as unknown as HTMLButtonElement;
    this.refresh();
  }

  /** Nothing typed and nothing worked out: AC would change nothing. */
  get isClear(): boolean {
    return isBasicClear(kept);
  }

  press(key: BasicKey): void {
    const before = kept;
    kept = pressBasic(kept, key);
    if (kept.line && kept.line !== before.line) this.host.worked(kept.line);
    this.refresh();
    this.host.changed();
  }

  /** Whether Insert has something to put on the page. */
  canInsert(): boolean {
    return !kept.error;
  }

  /**
   * The line Insert puts on the page: a sum still open is worked out first
   * (as = would), then the last line; a number alone is its own answer.
   */
  lineForInsert(): { expr: string; result: string } | null {
    if (kept.error) return null;
    if (kept.stack.length > 0) this.press({ equals: true });
    if (kept.error) return null;
    if (kept.line) return kept.line;
    const shown = formatBasic(shownValue(kept));
    return { expr: shown, result: shown };
  }

  refresh(): void {
    this.tapeEl.setText(basicTape(kept));
    this.numberEl.setText(basicDisplay(kept));
    this.numberEl.toggleClass("is-error", kept.error);
    const label = clearLabel(kept);
    this.clearKey.setText(label);
    this.clearKey.setAttribute("aria-label", label === "C" ? "Clear entry" : "All clear");
    const lit = activeOp(kept);
    for (const [o, button] of this.opKeys) {
      button.toggleClass("is-active", o === lit);
      button.setAttribute("aria-pressed", String(o === lit));
    }
    this.fit();
  }

  /** The number's font shrinks to fit its line, as iOS's does. */
  private fit(): void {
    this.numberEl.setCssStyles({ fontSize: `${NUMBER_MAX_PX}px` });
    const size = fittedFontSize(
      this.numberEl.scrollWidth,
      this.numberEl.clientWidth,
      NUMBER_MAX_PX,
      NUMBER_MIN_PX,
    );
    if (size !== NUMBER_MAX_PX) this.numberEl.setCssStyles({ fontSize: `${size}px` });
  }

  /** A finger drawn across the number deletes a digit per {@link SWIPE_PX}, as on iOS. */
  private installSwipe(): void {
    let from: number | null = null;
    this.displayEl.addEventListener("pointerdown", (event) => {
      from = event.clientX;
    });
    this.displayEl.addEventListener("pointermove", (event) => {
      if (from === null || Math.abs(event.clientX - from) < SWIPE_PX) return;
      from = event.clientX;
      this.press({ back: true });
    });
    const end = (): void => {
      from = null;
    };
    for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
      this.displayEl.addEventListener(type, end);
    }
  }
}
