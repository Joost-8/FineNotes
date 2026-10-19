/**
 * The calculator: the sheet the toolbar's calculator button opens. A card
 * attached to <body> below its button, as the Add Page and AI menus are,
 * closed by a tap outside, Escape or a second tap on the button.
 *
 * It has its own keypad, so the iPad keyboard never comes up, and it listens
 * to a hardware keyboard while open. The keys act on `pointerup` after a
 * `pointerdown` on the same key (the card floats over the page, and a Pencil
 * tap there may never become a click: CLAUDE.md, "A Pencil tap on a button
 * over the page never becomes a click"); `click` serves keyboard activation
 * only. Every button carries `clickable-icon`, or Obsidian pads it 20 px on
 * the iPad.
 *
 * The arithmetic is `model/calculator.ts`, the keypad and typing rules are
 * `model/calculator-keys.ts`, and what is remembered (the switches, a short
 * history per notebook) is `model/calculator-store.ts`; this file only
 * draws them and routes input.
 */

import { setIcon } from "obsidian";
import {
  BASE_LABELS,
  type CalcValue,
  NUMBER_BASES,
  type NumberBase,
  add,
  calculate,
  deleteLast,
  formatValue,
  rational,
  subtract,
} from "../model/calculator";
import {
  type CalcAction,
  type CalcKey,
  type Entry,
  HEX_ROW,
  MEMORY_ROW,
  NUMBER_ROWS,
  SCIENTIFIC_ROWS,
  keyEnabled,
  keyboardKey,
  spellAns,
  typeInto,
} from "../model/calculator-keys";
import {
  type CalcEntry,
  type CalculatorData,
  historyOf,
  withEntry,
  withPrefs,
  withoutHistory,
} from "../model/calculator-store";

const POPOVER_WIDTH = 360;

/** What the calculator needs from the notebook view. */
export interface CalculatorHost {
  /** The notebook's path, which its history is kept under. */
  path: string;
  load(): CalculatorData;
  save(data: CalculatorData): void;
  /** Put `text` on the page in view as a text box (one undo step); false when it could not. */
  insert(text: string): boolean;
}

/** The answer and the memory outlive the sheet, as on a pocket calculator. */
const session: { ans: CalcValue; memory: CalcValue } = { ans: rational(0n), memory: rational(0n) };

export class CalculatorPopover {
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  private closed = false;
  private data: CalculatorData;
  private entry: Entry = { expr: "", fresh: false };
  /** `Ans` while the current expression is typed: what it means in it. */
  private exprAns: CalcValue = session.ans;
  /** The result on show, kept exact so a switch can show it again differently. */
  private shown: CalcValue | null = null;
  /** The line the result on show came from, for Insert. */
  private shownLine: CalcEntry | null = null;
  private error = "";
  private showingHistory = false;

  private readonly exprEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly memoryEl: HTMLElement;
  private readonly baseEl: HTMLElement;
  private readonly historyButton: HTMLButtonElement;
  private readonly bodyEl: HTMLElement;
  private readonly insertButtons: HTMLButtonElement[] = [];

  constructor(
    private readonly anchor: HTMLElement,
    private readonly host: CalculatorHost,
  ) {
    this.data = host.load();
    this.el = document.body.createDiv({ cls: "goodobsidian-addpage goodobsidian-calc" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Calculator");

    const head = this.el.createDiv({ cls: "goodobsidian-calc-head" });
    this.baseEl = head.createDiv({ cls: "goodobsidian-segmented goodobsidian-calc-bases" });
    this.baseEl.setAttribute("role", "radiogroup");
    this.baseEl.setAttribute("aria-label", "Number base");
    for (const base of NUMBER_BASES) {
      const button = this.button(this.baseEl, BASE_LABELS[base], () => this.setBase(base));
      button.dataset.base = String(base);
      button.setAttribute("role", "radio");
    }
    this.historyButton = this.button(
      head,
      "",
      () => this.toggleHistory(),
      "goodobsidian-calc-icon",
    );
    setIcon(this.historyButton, "history");
    this.historyButton.setAttribute("aria-label", "History");

    const display = this.el.createDiv({ cls: "goodobsidian-calc-display" });
    this.memoryEl = display.createDiv({ cls: "goodobsidian-calc-flags" });
    this.exprEl = display.createDiv({ cls: "goodobsidian-calc-expr" });
    this.resultEl = display.createDiv({ cls: "goodobsidian-calc-result" });
    this.resultEl.setAttribute("aria-live", "polite");

    const actions = this.el.createDiv({ cls: "goodobsidian-calc-actions" });
    this.insertButtons.push(
      this.button(actions, "Insert", () => this.insert(true), "goodobsidian-calc-insert"),
      this.button(actions, "Insert answer", () => this.insert(false), "goodobsidian-calc-insert"),
    );
    this.insertButtons[0].setAttribute("aria-label", "Insert the sum and its answer on the page");
    this.insertButtons[1].setAttribute("aria-label", "Insert only the answer on the page");

    this.bodyEl = this.el.createDiv({ cls: "goodobsidian-calc-body" });
    this.render();
    this.place();
    this.installDismiss();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  get anchorEl(): HTMLElement {
    return this.anchor;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const d of this.dispose) d();
    this.el.remove();
  }

  /**
   * Type `text` into the expression, as a key would. The way in for an
   * expression from elsewhere (a recognised handwritten one).
   */
  type(text: string): void {
    this.entry = typeInto(this.entry, text, false);
    if (this.entry.expr === text) this.exprAns = session.ans;
    this.error = "";
    this.refresh();
  }

  // --- Building ---------------------------------------------------------------

  /** A button driven by pointer events; `click` only for keyboard activation. */
  private button(parent: HTMLElement, label: string, run: () => void, cls = ""): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `clickable-icon ${cls}`.trim(), text: label });
    let down = false;
    const release = (): void => {
      down = false;
      button.removeAttribute("data-pressed");
    };
    button.addEventListener("pointerdown", (event) => {
      // Keeps focus (and any page text box's keyboard) where it was.
      event.preventDefault();
      down = !button.disabled;
      if (down) button.setAttribute("data-pressed", "");
    });
    button.addEventListener("pointerup", () => {
      const fire = down && !button.disabled;
      release();
      if (fire) run();
    });
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
    button.addEventListener("click", (event) => {
      if (event.detail === 0 && !button.disabled) run();
    });
    return button;
  }

  private render(): void {
    this.bodyEl.empty();
    this.bodyEl.toggleClass("is-history", this.showingHistory);
    this.historyButton.toggleClass("is-active", this.showingHistory);
    this.historyButton.setAttribute("aria-pressed", String(this.showingHistory));
    if (this.showingHistory) this.renderHistory();
    else this.renderKeys();
    this.refresh();
  }

  private renderKeys(): void {
    const { base } = this.data.prefs;
    const grid = this.bodyEl.createDiv({ cls: "goodobsidian-calc-keys" });
    const rows: (readonly CalcKey[])[] = [...SCIENTIFIC_ROWS];
    if (base === 16) rows.push(HEX_ROW);
    rows.push(MEMORY_ROW, ...NUMBER_ROWS);
    for (const row of rows) {
      for (const key of row) this.key(grid, key, base);
    }
  }

  private key(grid: HTMLElement, key: CalcKey, base: NumberBase): void {
    const button = this.button(
      grid,
      this.keyLabel(key),
      () => this.press(key),
      "goodobsidian-calc-key",
    );
    if (key.tone) button.addClass(`is-${key.tone}`);
    if (key.span && key.span > 1) button.setCssStyles({ gridColumn: `span ${key.span}` });
    button.setAttribute("aria-label", key.aria ?? key.label);
    if (key.action === "fractions") {
      button.toggleClass("is-active", this.data.prefs.fractions);
      button.setAttribute("aria-pressed", String(this.data.prefs.fractions));
    }
    button.disabled = !keyEnabled(key, base);
  }

  private keyLabel(key: CalcKey): string {
    if (key.action === "angle") return this.data.prefs.angle === "deg" ? "DEG" : "RAD";
    return key.label;
  }

  private renderHistory(): void {
    const entries = historyOf(this.data, this.host.path);
    const list = this.bodyEl.createDiv({ cls: "goodobsidian-calc-history" });
    if (entries.length === 0) {
      list.createDiv({
        cls: "goodobsidian-calc-empty",
        text: "No sums yet in this notebook. Tap a line to use its answer.",
      });
      return;
    }
    for (const line of entries) {
      const row = this.button(list, "", () => this.useHistory(line), "goodobsidian-calc-line");
      row.createSpan({ cls: "goodobsidian-calc-line-expr", text: line.expr });
      row.createSpan({ cls: "goodobsidian-calc-line-result", text: `= ${line.result}` });
      row.setAttribute("aria-label", `${line.expr} equals ${line.result}`);
    }
    this.button(
      this.bodyEl,
      "Clear history",
      () => {
        this.save(withoutHistory(this.data, this.host.path));
        this.render();
      },
      "goodobsidian-calc-clear",
    );
  }

  // --- Behaviour --------------------------------------------------------------

  private ctx(): { angle: "deg" | "rad"; base: NumberBase; ans: CalcValue; memory: CalcValue } {
    const { angle, base } = this.data.prefs;
    return { angle, base, ans: this.exprAns, memory: session.memory };
  }

  private format(value: CalcValue): string | null {
    const { fractions, base } = this.data.prefs;
    return formatValue(value, { fractions, base });
  }

  private press(key: CalcKey): void {
    if (key.insert !== undefined) {
      const wasFresh = this.entry.fresh;
      this.entry = typeInto(this.entry, key.insert, key.continues === true);
      if (wasFresh) this.exprAns = session.ans;
      this.error = "";
      this.refresh();
      return;
    }
    if (key.action) this.act(key.action);
  }

  private act(action: CalcAction): void {
    switch (action) {
      case "equals":
        this.equals();
        return;
      case "back":
        this.entry = { expr: this.entry.fresh ? "" : deleteLast(this.entry.expr), fresh: false };
        this.error = "";
        break;
      case "clear":
        this.entry = { expr: "", fresh: false };
        this.shown = null;
        this.shownLine = null;
        this.error = "";
        break;
      case "mc":
        session.memory = rational(0n);
        break;
      case "mr":
        this.entry = typeInto(this.entry, "M", false);
        break;
      case "m+":
      case "m-": {
        const value = this.currentValue();
        if (value === null) return;
        session.memory =
          action === "m+" ? add(session.memory, value) : subtract(session.memory, value);
        break;
      }
      case "angle":
        this.save(withPrefs(this.data, { angle: this.data.prefs.angle === "deg" ? "rad" : "deg" }));
        this.render();
        return;
      case "fractions":
        this.save(withPrefs(this.data, { fractions: !this.data.prefs.fractions }));
        this.render();
        return;
    }
    this.refresh();
  }

  /** The value on show or of the expression typed; null (with the error shown) when there is none. */
  private currentValue(): CalcValue | null {
    if (this.entry.fresh && this.shown !== null) return this.shown;
    const result = calculate(this.entry.expr, this.ctx(), this.data.prefs);
    if (result.ok) return result.value;
    if (this.entry.expr.trim()) this.error = result.error;
    this.refresh();
    return null;
  }

  private equals(): boolean {
    if (this.entry.fresh) return this.shown !== null;
    const expr = this.entry.expr;
    if (!expr.trim()) return false;
    const result = calculate(expr, this.ctx(), this.data.prefs);
    if (!result.ok) {
      this.error = result.error;
      this.refresh();
      return false;
    }
    const ansText = this.format(this.exprAns) ?? "";
    const line = { expr: spellAns(expr, ansText), result: result.text };
    session.ans = result.value;
    this.exprAns = result.value;
    this.shown = result.value;
    this.shownLine = line;
    this.entry = { expr, fresh: true };
    this.error = "";
    this.save(withEntry(this.data, this.host.path, line, Date.now()));
    this.refresh();
    return true;
  }

  private useHistory(line: CalcEntry): void {
    this.showingHistory = false;
    if (this.entry.fresh) this.exprAns = session.ans;
    this.entry = typeInto(this.entry, line.result, false);
    this.render();
  }

  private toggleHistory(): void {
    this.showingHistory = !this.showingHistory;
    this.render();
    this.place();
  }

  /**
   * A new base shows what is on screen in it: the result, or the value of
   * the expression typed when it has one; otherwise the expression stays.
   */
  private setBase(base: NumberBase): void {
    if (base === this.data.prefs.base) return;
    let value: CalcValue | null = null;
    if (this.entry.fresh) value = this.shown;
    else if (this.entry.expr.trim()) {
      const result = calculate(this.entry.expr, this.ctx(), this.data.prefs);
      if (result.ok) value = result.value;
    }
    this.save(withPrefs(this.data, { base }));
    if (value !== null) {
      const text = this.format(value);
      if (text === null) {
        this.error = "Not a whole number";
      } else {
        this.entry = { expr: text, fresh: false };
        this.error = "";
      }
      this.shown = null;
    }
    this.render();
  }

  private insert(withSum: boolean): void {
    if (!this.entry.fresh && !this.equals()) return;
    const line = this.shownLine;
    if (!line) return;
    const result = this.shown !== null ? (this.format(this.shown) ?? line.result) : line.result;
    const text = withSum ? `${line.expr} = ${result}` : result;
    if (this.host.insert(text)) this.close();
  }

  private save(data: CalculatorData): void {
    this.data = data;
    this.host.save(data);
  }

  /** Redraw the display and the switches from the state. */
  private refresh(): void {
    const { base, angle, fractions } = this.data.prefs;
    for (const button of Array.from(this.baseEl.querySelectorAll("button"))) {
      const active = button.dataset.base === String(base);
      button.toggleClass("is-active", active);
      button.setAttribute("aria-checked", String(active));
    }
    const flags: string[] = [];
    if (base === 10) flags.push(angle === "deg" ? "DEG" : "RAD");
    if (base === 10 && fractions) flags.push("a/b");
    if (formatValue(session.memory) !== "0") flags.push("M");
    this.memoryEl.setText(flags.join("  "));

    this.exprEl.setText(this.entry.expr);
    this.exprEl.toggleClass("is-empty", this.entry.expr === "");
    this.resultEl.removeClass("is-error", "is-preview");
    if (this.error) {
      this.resultEl.setText(this.error);
      this.resultEl.addClass("is-error");
    } else if (this.entry.fresh && this.shown !== null) {
      this.resultEl.setText(this.format(this.shown) ?? "Not a whole number");
      if (this.format(this.shown) === null) this.resultEl.addClass("is-error");
    } else {
      // A quiet preview while typing; errors wait for =.
      const result = this.entry.expr.trim()
        ? calculate(this.entry.expr, this.ctx(), this.data.prefs)
        : null;
      this.resultEl.setText(result?.ok ? result.text : this.entry.expr ? "" : "0");
      this.resultEl.addClass("is-preview");
    }
    const canInsert = this.entry.fresh || this.entry.expr.trim() !== "";
    for (const button of this.insertButtons) button.disabled = !canInsert;
  }

  // --- Placement and dismissal ------------------------------------------------

  /** Below the anchor, left-aligned to it, kept inside the window. */
  private place(): void {
    const r = this.anchor.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const height = this.el.offsetHeight;
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    this.el.setCssStyles({ left: `${left}px`, top: `${top}px`, width: `${width}px` });
  }

  private installDismiss(): void {
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && (this.el.contains(target) || this.anchor.contains(target))) return;
      this.close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const mapped = keyboardKey(event.key);
      if (!mapped) return;
      event.preventDefault();
      event.stopPropagation();
      if ("action" in mapped) {
        this.act(mapped.action);
        return;
      }
      if (this.showingHistory) {
        this.showingHistory = false;
        this.render();
      }
      this.press({ label: mapped.insert, insert: mapped.insert, continues: mapped.continues });
    };
    const onResize = (): void => {
      if (this.anchor.isConnected) this.place();
      else this.close();
    };
    // Capture: the drawing surface consumes its own pointer events, and its
    // single-letter shortcuts (P, E, T) must not fire while typing a sum.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    this.dispose.push(() => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    });
  }
}
