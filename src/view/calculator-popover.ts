/**
 * The calculator: the sheet the toolbar's calculator button opens. A card
 * attached to <body> below its button, as the Add Page and AI menus are,
 * closed by a tap outside, Escape or a second tap on the button.
 *
 * What it borrows, and from where (Joost's brief, 2026-10-19): iOS's keys
 * (round number keys, the operators in an accent column, a press that
 * visibly gives, AC that becomes C while there is something to clear, a
 * swipe across the display to delete); NumWorks' and Casio's natural
 * display (the expression set as a textbook would, the result under it,
 * the history as pairs to tap); Google's and Windows' 2nd key in place of
 * a wall of keys; and Desmos' graph (`calculator-graph.ts`). It wears
 * Obsidian's variables and FineNotes' chrome, so it looks native in both
 * themes. Nothing in it moves while typing: the display's lines have fixed
 * heights, and a long expression or result is scaled down to fit.
 *
 * It has its own keypad, so the iPad keyboard never comes up, and it hears
 * a hardware keyboard while open. Keys act on `pointerup` after a
 * `pointerdown` on the same key (a Pencil tap over the page may never
 * become a click: CLAUDE.md); `click` serves keyboard activation only.
 * Every button carries `clickable-icon`, or Obsidian pads it 20 px on the
 * iPad.
 *
 * The arithmetic is `model/calculator.ts`, the layout of the expression
 * `model/calc-display.ts`, the keypad `model/calculator-keys.ts`, and what
 * is remembered `model/calculator-store.ts`.
 */

import { setIcon } from "obsidian";
import { type MathBox, layoutExpression } from "../model/calc-display";
import {
  type AngleMode,
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
  usesVariable,
} from "../model/calculator";
import {
  type CalcAction,
  type CalcKey,
  type Entry,
  HEX_ROW,
  NUMBER_ROWS,
  SCIENTIFIC_ROWS,
  fittedFontSize,
  keyEnabled,
  keyboardKey,
  shownKey,
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
import { type GraphSpec, defaultRange } from "../model/graph";
import { GraphPanel, type GraphState } from "./calculator-graph";

const POPOVER_WIDTH = 360;
const RESULT_MAX_PX = 32;
const RESULT_MIN_PX = 15;
/** A swipe across the display this far deletes one sign, as on iOS. */
const SWIPE_PX = 36;

/** What the calculator needs from the notebook view. */
export interface CalculatorHost {
  /** The notebook's path, which its history is kept under. */
  path: string;
  load(): CalculatorData;
  save(data: CalculatorData): void;
  /** Put `text` on the page in view as a text box (one undo step); false when it could not. */
  insert(text: string): boolean;
  /**
   * Put a graph on the page in view (one undo step); false when it could
   * not. Absent: the graph pane offers no Insert graph.
   */
  insertGraph?(spec: GraphSpec): boolean;
}

export interface CalculatorOptions {
  /**
   * Open on the graph pane to edit this graph (a graph on a page); its Done
   * hands the edited graph to `done` and closes. The calculator's own graph
   * of the notebook is left as it was.
   */
  editGraph?: { spec: GraphSpec; done: (spec: GraphSpec) => void };
}

/** The answer and the memory outlive the sheet, as on a pocket calculator. */
const session: { ans: CalcValue; memory: CalcValue } = {
  ans: rational(0n),
  memory: rational(0n),
};
/** Each notebook's graph, while the app runs. */
const graphs = new Map<string, GraphState>();

type Pane = "keys" | "history" | "graph";

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
  private pane: Pane = "keys";
  private shifted = false;
  private graph: GraphPanel | null = null;
  private readonly graphState: GraphState;
  /** The angle of a graph being edited ({@link CalculatorOptions.editGraph}); its own, not the calculator's. */
  private editAngle: AngleMode | null = null;
  /** Insert graph, or Done while editing one: shown in the graph pane in place of Insert. */
  private readonly graphAction: HTMLButtonElement | null;

  private readonly angleChip: HTMLButtonElement;
  private readonly fractionChip: HTMLButtonElement;
  private readonly memoryFlag: HTMLElement;
  private readonly exprEl: HTMLElement;
  private readonly mathEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly baseEl: HTMLElement;
  private readonly paneButtons = new Map<Pane, HTMLButtonElement>();
  private readonly bodyEl: HTMLElement;
  private readonly insertButtons: HTMLButtonElement[] = [];

  constructor(
    private readonly anchor: HTMLElement,
    private readonly host: CalculatorHost,
    private readonly options: CalculatorOptions = {},
  ) {
    this.data = host.load();
    const edited = options.editGraph?.spec;
    if (edited) {
      const { xMin, xMax, yMin, yMax } = edited;
      this.graphState = { expressions: [...edited.expressions], range: { xMin, xMax, yMin, yMax } };
      this.editAngle = edited.angle ?? "rad";
      this.pane = "graph";
    } else {
      const kept = graphs.get(host.path);
      this.graphState = kept ?? { expressions: [], range: null };
      if (!kept) graphs.set(host.path, this.graphState);
    }
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
    this.paneButton(head, "graph", "chart-spline", "Graph");
    this.paneButton(head, "history", "history", "History");

    const display = this.el.createDiv({ cls: "goodobsidian-calc-display" });
    const flags = display.createDiv({ cls: "goodobsidian-calc-flags" });
    this.angleChip = this.button(flags, "DEG", () => this.toggleAngle(), "goodobsidian-calc-chip");
    this.angleChip.setAttribute("aria-label", "Degrees or radians");
    this.fractionChip = this.button(
      flags,
      "a/b",
      () => this.toggleFractions(),
      "goodobsidian-calc-chip",
    );
    this.fractionChip.setAttribute("aria-label", "Show fractions");
    this.memoryFlag = flags.createSpan({ cls: "goodobsidian-calc-memory", text: "M" });
    this.exprEl = display.createDiv({ cls: "goodobsidian-calc-expr" });
    this.mathEl = this.exprEl.createDiv({ cls: "goodobsidian-calc-math" });
    this.resultEl = display.createDiv({ cls: "goodobsidian-calc-result" });
    this.resultEl.setAttribute("aria-live", "polite");
    this.installSwipe(display);

    const actions = this.el.createDiv({ cls: "goodobsidian-calc-actions" });
    this.insertButtons.push(
      this.button(actions, "Insert", () => this.insert(true), "goodobsidian-calc-insert"),
      this.button(actions, "Insert answer", () => this.insert(false), "goodobsidian-calc-insert"),
    );
    this.insertButtons[0].setAttribute("aria-label", "Insert the sum and its answer on the page");
    this.insertButtons[1].setAttribute("aria-label", "Insert only the answer on the page");
    this.graphAction = null;
    if (options.editGraph) {
      this.graphAction = this.button(
        actions,
        "Done",
        () => this.finishGraph(),
        "goodobsidian-calc-insert",
      );
      this.graphAction.setAttribute("aria-label", "Done: put the edited graph back on the page");
    } else if (host.insertGraph) {
      this.graphAction = this.button(
        actions,
        "Insert graph",
        () => this.finishGraph(),
        "goodobsidian-calc-insert",
      );
      this.graphAction.setAttribute("aria-label", "Insert the graph on the page");
    }

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

  /** The graph as a plain object (expressions and range), for a graph on a page to store; null when empty. */
  graphSpec(): GraphSpec | null {
    if (this.graphState.expressions.length === 0) return null;
    if (this.graph) return this.graph.spec();
    const range = this.graphState.range ?? defaultRange(1, 1);
    return {
      expressions: [...this.graphState.expressions],
      ...range,
      angle: this.graphAngle(),
    };
  }

  /** The angle the graph is drawn in: the edited graph's own, else the calculator's. */
  private graphAngle(): AngleMode {
    return this.editAngle ?? this.data.prefs.angle;
  }

  /** Insert graph, or Done: hand the graph over and close. */
  private finishGraph(): void {
    const spec = this.graphSpec();
    if (!spec) return;
    const edit = this.options.editGraph;
    if (edit) {
      edit.done(spec);
      this.close();
    } else if (this.host.insertGraph?.(spec)) {
      this.close();
    }
  }

  /** The graph panel while it shows (the gallery measures its frames). */
  get graphPanel(): GraphPanel | null {
    return this.graph;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.graph?.destroy();
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

  private paneButton(parent: HTMLElement, pane: Pane, icon: string, label: string): void {
    const button = this.button(parent, "", () => this.showPane(pane), "goodobsidian-calc-icon");
    setIcon(button, icon);
    button.setAttribute("aria-label", label);
    this.paneButtons.set(pane, button);
  }

  private render(): void {
    this.graph?.destroy();
    this.graph = null;
    this.bodyEl.empty();
    this.bodyEl.className = `goodobsidian-calc-body is-${this.pane}`;
    for (const [pane, button] of this.paneButtons) {
      const on = pane === this.pane;
      button.toggleClass("is-active", on);
      button.setAttribute("aria-pressed", String(on));
    }
    if (this.pane === "history") this.renderHistory();
    else if (this.pane === "graph") this.renderGraph();
    else this.renderKeys();
    this.refresh();
  }

  private renderKeys(): void {
    const { base } = this.data.prefs;
    const science = this.bodyEl.createDiv({ cls: "goodobsidian-calc-keys is-science" });
    const rows = base === 16 ? [SCIENTIFIC_ROWS[0], SCIENTIFIC_ROWS[1], HEX_ROW] : SCIENTIFIC_ROWS;
    for (const row of rows) for (const key of row) this.key(science, key, base);
    const numbers = this.bodyEl.createDiv({ cls: "goodobsidian-calc-keys is-numbers" });
    for (const row of NUMBER_ROWS) for (const key of row) this.key(numbers, key, base);
  }

  private key(grid: HTMLElement, face: CalcKey, base: NumberBase): void {
    const key = shownKey(face, this.shifted);
    const button = this.button(
      grid,
      this.keyLabel(key),
      () => this.press(key),
      "goodobsidian-calc-key",
    );
    const digit = key.digit !== undefined && key.digit < 10;
    button.addClass(digit ? "is-digit" : `is-${key.tone ?? "plain"}`);
    if (key !== face) button.addClass("is-second");
    if (key.span && key.span > 1) button.setCssStyles({ gridColumn: `span ${key.span}` });
    button.setAttribute("aria-label", key.aria ?? key.label);
    if (key.action === "shift") {
      button.toggleClass("is-active", this.shifted);
      button.setAttribute("aria-pressed", String(this.shifted));
    }
    if (key.action === "clear") button.dataset.clear = "";
    button.disabled = !keyEnabled(key, base);
  }

  private keyLabel(key: CalcKey): string {
    if (key.action === "clear") return this.clearsAll() ? "AC" : "C";
    return key.label;
  }

  /** AC clears everything; C, while something is typed, only the expression. */
  private clearsAll(): boolean {
    return this.entry.fresh || this.entry.expr === "";
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
      const expr = row.createDiv({ cls: "goodobsidian-calc-line-expr goodobsidian-calc-math" });
      this.drawMath(expr, line.expr);
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

  private renderGraph(): void {
    const list = this.bodyEl.createDiv({ cls: "goodobsidian-calc-functions" });
    const graph = new GraphPanel(this.bodyEl, this.graphState, () => this.graphAngle());
    this.graph = graph;
    const errors = graph.errors();
    this.graphState.expressions.forEach((expression, index) => {
      const row = list.createDiv({ cls: "goodobsidian-calc-function" });
      row.createSpan({ cls: "goodobsidian-calc-swatch" }).setCssStyles({
        backgroundColor: graph.colorOf(index),
      });
      const edit = this.button(
        row,
        "",
        () => this.editFunction(index),
        "goodobsidian-calc-function-text",
      );
      edit.setAttribute("aria-label", `Edit y = ${expression}`);
      const math = edit.createDiv({ cls: "goodobsidian-calc-math" });
      math.createSpan({ cls: "gob-m-var", text: "y" });
      math.createSpan({ cls: "gob-m-op", text: " = " });
      this.drawMath(math.createSpan(), expression);
      const error = errors[index];
      if (error) edit.createDiv({ cls: "goodobsidian-calc-function-error", text: error });
      const remove = this.button(
        row,
        "",
        () => this.removeFunction(index),
        "goodobsidian-calc-remove",
      );
      setIcon(remove, "x");
      remove.setAttribute("aria-label", `Remove y = ${expression}`);
    });
    const typed = this.entry.fresh ? "" : this.entry.expr;
    const plottable = typed !== "" && usesVariable(typed);
    if (this.graphState.expressions.length === 0 || plottable) {
      const addRow = this.button(
        list,
        "",
        () => this.addFunction(),
        "goodobsidian-calc-function goodobsidian-calc-add",
      );
      setIcon(addRow.createSpan({ cls: "goodobsidian-calc-add-icon" }), "plus");
      addRow.createSpan({
        text: plottable ? `Plot y = ${typed}` : "Type an expression in x, then plot it here",
      });
      addRow.disabled = !plottable;
    }
    graph.paintNow();
  }

  /** Lay out `expression` as math into `parent`; the text as typed when it cannot be read. */
  private drawMath(parent: HTMLElement, expression: string): boolean {
    const box = layoutExpression(expression, this.data.prefs.base);
    if (!box) {
      parent.createSpan({ text: expression });
      return false;
    }
    renderBox(parent, box);
    return true;
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
      this.afterKey();
      return;
    }
    if (key.action) this.act(key.action);
  }

  /** A typed key turns 2nd off: one-shot, as on a pocket calculator. */
  private afterKey(): void {
    if (this.shifted) {
      this.shifted = false;
      this.render();
      return;
    }
    this.refresh();
  }

  private act(action: CalcAction): void {
    switch (action) {
      case "equals":
        if (this.pane === "graph" && usesVariable(this.entry.expr)) this.addFunction();
        else this.equals();
        return;
      case "shift":
        this.shifted = !this.shifted;
        this.render();
        return;
      case "back":
        this.entry = { expr: this.entry.fresh ? "" : deleteLast(this.entry.expr), fresh: false };
        this.error = "";
        break;
      case "clear":
        if (this.clearsAll()) {
          this.shown = null;
          this.shownLine = null;
        }
        this.entry = { expr: "", fresh: false };
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
    }
    this.afterKey();
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
      this.error =
        result.error === "Unknown name: x" ? "Has x: open the graph to plot it" : result.error;
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
    this.pane = "keys";
    if (this.entry.fresh) this.exprAns = session.ans;
    this.entry = typeInto(this.entry, line.result, false);
    this.render();
  }

  private showPane(pane: Pane): void {
    this.pane = this.pane === pane ? "keys" : pane;
    // Opening the graph with an expression in x plots it.
    const typed = this.entry.fresh ? "" : this.entry.expr;
    if (this.pane === "graph" && typed && usesVariable(typed)) {
      if (!this.graphState.expressions.includes(typed)) this.graphState.expressions.push(typed);
      this.entry = { expr: "", fresh: false };
    }
    this.render();
    this.place();
  }

  private addFunction(): void {
    const typed = this.entry.expr;
    if (!usesVariable(typed)) return;
    if (!this.graphState.expressions.includes(typed)) this.graphState.expressions.push(typed);
    this.entry = { expr: "", fresh: false };
    this.render();
  }

  private editFunction(index: number): void {
    const [expression] = this.graphState.expressions.splice(index, 1);
    this.entry = { expr: expression, fresh: false };
    this.pane = "keys";
    this.render();
  }

  private removeFunction(index: number): void {
    this.graphState.expressions.splice(index, 1);
    this.render();
  }

  private toggleAngle(): void {
    if (this.editAngle !== null) {
      this.editAngle = this.editAngle === "deg" ? "rad" : "deg";
      this.render();
      return;
    }
    this.save(withPrefs(this.data, { angle: this.data.prefs.angle === "deg" ? "rad" : "deg" }));
    if (this.graph) this.render();
    else this.refresh();
  }

  private toggleFractions(): void {
    this.save(withPrefs(this.data, { fractions: !this.data.prefs.fractions }));
    this.refresh();
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
    this.angleChip.setText((this.editAngle ?? angle) === "deg" ? "DEG" : "RAD");
    this.angleChip.disabled = base !== 10;
    this.fractionChip.toggleClass("is-active", fractions);
    this.fractionChip.setAttribute("aria-pressed", String(fractions));
    this.fractionChip.disabled = base !== 10;
    this.memoryFlag.toggleClass("is-hidden", formatValue(session.memory) === "0");
    const clear = this.bodyEl.querySelector<HTMLElement>("[data-clear]");
    if (clear) clear.setText(this.clearsAll() ? "AC" : "C");

    this.mathEl.empty();
    const expr = this.entry.expr;
    let laid = true;
    if (expr) laid = this.drawMath(this.mathEl, expr);
    this.mathEl.toggleClass("is-raw", !laid);
    if (!this.entry.fresh) this.mathEl.createSpan({ cls: "goodobsidian-calc-caret" });
    this.exprEl.toggleClass("is-done", this.entry.fresh);
    this.fitExpression();

    this.resultEl.removeClass("is-error", "is-preview");
    let text: string;
    if (this.error) {
      text = this.error;
      this.resultEl.addClass("is-error");
    } else if (this.entry.fresh && this.shown !== null) {
      const shown = this.format(this.shown);
      text = shown ?? "Not a whole number";
      if (shown === null) this.resultEl.addClass("is-error");
    } else {
      // A quiet preview while typing; errors wait for =.
      const result = expr.trim() ? calculate(expr, this.ctx(), this.data.prefs) : null;
      text = result?.ok ? result.text : expr ? "" : "0";
      this.resultEl.addClass("is-preview");
    }
    this.resultEl.setText(text);
    this.fitResult();
    const canInsert = this.entry.fresh || expr.trim() !== "";
    const graphing = this.pane === "graph" && this.graphAction !== null;
    for (const button of this.insertButtons) {
      button.disabled = !canInsert;
      button.toggleClass("is-hidden", graphing);
    }
    if (this.graphAction) {
      this.graphAction.toggleClass("is-hidden", !graphing);
      this.graphAction.disabled = this.graphState.expressions.length === 0;
    }
  }

  /** Scale the expression down to its line instead of letting the display grow. */
  private fitExpression(): void {
    this.mathEl.setCssStyles({ transform: "" });
    const room = this.exprEl.clientWidth;
    const height = this.exprEl.clientHeight;
    const w = this.mathEl.scrollWidth;
    const h = this.mathEl.scrollHeight;
    if (!room || !w) return;
    const scale = Math.min(1, room / w, height / Math.max(1, h));
    if (scale < 1) this.mathEl.setCssStyles({ transform: `scale(${scale})` });
  }

  /** The result's font shrinks to fit its line, as iOS's does. */
  private fitResult(): void {
    this.resultEl.setCssStyles({ fontSize: `${RESULT_MAX_PX}px` });
    const size = fittedFontSize(
      this.resultEl.scrollWidth,
      this.resultEl.clientWidth,
      RESULT_MAX_PX,
      RESULT_MIN_PX,
    );
    if (size !== RESULT_MAX_PX) this.resultEl.setCssStyles({ fontSize: `${size}px` });
  }

  // --- Gestures, placement and dismissal --------------------------------------

  /** A finger drawn across the display deletes a sign per {@link SWIPE_PX}, as on iOS. */
  private installSwipe(display: HTMLElement): void {
    let from: number | null = null;
    display.addEventListener("pointerdown", (event) => {
      if ((event.target as Element | null)?.closest("button")) return;
      from = event.clientX;
    });
    display.addEventListener("pointermove", (event) => {
      if (from === null || Math.abs(event.clientX - from) < SWIPE_PX) return;
      from = event.clientX;
      this.act("back");
    });
    const end = (): void => {
      from = null;
    };
    display.addEventListener("pointerup", end);
    display.addEventListener("pointercancel", end);
    display.addEventListener("pointerleave", end);
  }

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
      if (this.pane === "history") {
        this.pane = "keys";
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

/** A {@link MathBox} as spans (styles.css, `.gob-m-*`). */
function renderBox(parent: HTMLElement, box: MathBox): void {
  switch (box.t) {
    case "row":
      for (const item of box.items) renderBox(parent, item);
      return;
    case "text":
      parent.createSpan({ cls: `gob-m-${box.role}`, text: box.s });
      return;
    case "slot":
      parent.createSpan({ cls: "gob-m-slot" });
      return;
    case "frac": {
      const frac = parent.createSpan({ cls: "gob-m-frac" });
      renderBox(frac.createSpan({ cls: "gob-m-numer" }), box.num);
      renderBox(frac.createSpan({ cls: "gob-m-denom" }), box.den);
      return;
    }
    case "sup": {
      const sup = parent.createSpan({ cls: "gob-m-pow" });
      renderBox(sup.createSpan({ cls: "gob-m-base" }), box.base);
      renderBox(sup.createSpan({ cls: "gob-m-sup" }), box.exp);
      return;
    }
    case "root": {
      const root = parent.createSpan({ cls: "gob-m-root" });
      if (box.index) renderBox(root.createSpan({ cls: "gob-m-index" }), box.index);
      root.createSpan({ cls: "gob-m-radical", text: "√" });
      renderBox(root.createSpan({ cls: "gob-m-radicand" }), box.body);
      return;
    }
    case "paren":
    case "abs": {
      const [open, close] = box.t === "paren" ? ["(", ")"] : ["|", "|"];
      const group = parent.createSpan({ cls: "gob-m-group" });
      group.createSpan({ cls: "gob-m-fence", text: open });
      renderBox(group.createSpan(), box.body);
      group.createSpan({ cls: "gob-m-fence", text: close });
      return;
    }
    case "bigop": {
      const op = parent.createSpan({ cls: "gob-m-bigop" });
      const limits = op.createSpan({ cls: "gob-m-limits" });
      renderBox(limits.createSpan({ cls: "gob-m-hi" }), box.hi);
      limits.createSpan({ cls: "gob-m-sym", text: box.sym });
      renderBox(limits.createSpan({ cls: "gob-m-lo" }), box.lo);
      renderBox(op.createSpan({ cls: "gob-m-body" }), box.body);
      if (box.tail) op.createSpan({ cls: "gob-m-var gob-m-tail", text: box.tail });
      return;
    }
  }
}
