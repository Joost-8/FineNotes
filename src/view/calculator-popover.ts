/**
 * The calculator: a window floating over the notebook, as the graph window
 * does (`floating-window.ts`): moved by its title bar, resized from its
 * corner, opened where it was left, and closed by its cross or a second tap
 * on the toolbar's calculator button, never by a tap on the page, so it
 * stays open beside the notes while you write. It hears a hardware keyboard
 * only while it is the window in use (the last tap was inside it), so the
 * page's own shortcuts work again once you write.
 *
 * What it borrows, and from where (Joost's briefs, 2026-10-19): iOS's keys
 * (round number keys, the operators in an accent column, a press that
 * visibly gives, AC that becomes C while there is something to clear, a
 * swipe across the display to delete); NumWorks' and Casio's natural
 * display (the expression set as a textbook would, boxes to fill for a
 * function's inputs, the result under it, the history as pairs to tap);
 * Google's and Windows' 2nd key and tabs in place of a wall of keys; and
 * Desmos' graph (`calculator-graph.ts`). It wears Obsidian's variables and
 * FineNotes' chrome, so it looks native in both themes. Nothing in it moves
 * while typing: the display's lines have fixed heights, every tab has the
 * same three rows, and a long expression or result is scaled down to fit.
 *
 * Keys explain themselves: a long press shows what a key does (and a hover
 * does on a computer), a function with several inputs types a template with
 * a box per input, and a line under the display says what the inputs are
 * while one is being filled.
 *
 * It has its own keypad, so the iPad keyboard never comes up, and it hears
 * a hardware keyboard while open. Keys act on `pointerup` after a
 * `pointerdown` on the same key (a Pencil tap over the page may never
 * become a click: CLAUDE.md); `click` serves keyboard activation only.
 * Every button carries `clickable-icon`, or Obsidian pads it 20 px on the
 * iPad.
 *
 * The arithmetic is `model/calculator.ts`, the layout of the expression
 * `model/calc-display.ts`, the keypad and typing `model/calculator-keys.ts`,
 * and what is remembered `model/calculator-store.ts`.
 */

import { setIcon } from "obsidian";
import { type MathBox, layoutWithEnding } from "../model/calc-display";
import {
  type AngleMode,
  BASE_LABELS,
  type CalcValue,
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
  KEY_TABS,
  type KeyTab,
  NUMBER_ROWS,
  TAB_ROWS,
  backspace,
  boxes,
  fittedFontSize,
  hintFor,
  keyEnabled,
  keyboardKey,
  moveCursor,
  moveToBox,
  nextBox,
  shownKey,
  spellAns,
  typeInto,
  toEnd,
  typeKey,
  withCursor,
} from "../model/calculator-keys";
import {
  CALC_WINDOW_MIN,
  type CalcEntry,
  type CalcMode,
  type CalculatorData,
  defaultCalcPlace,
  historyOf,
  withCalcWindow,
  withEntry,
  withPrefs,
  withoutHistory,
} from "../model/calculator-store";
import { type Worked, readable, work } from "../model/algebra/work";
import type { GraphSpec } from "../model/graph";
import { MAX_LINES, newLineId, normalizeGraphSpec } from "../model/graph-lines";
import { basicKeyFor } from "../model/basic-calc";
import { BasicPad } from "./calculator-basic";
import { GraphPanel, type GraphState, graphChanged, newGraphState } from "./calculator-graph";
import { FloatingWindow } from "./floating-window";

const RESULT_MAX_PX = 32;
const RESULT_MIN_PX = 15;
/** A swipe across the display this far deletes one sign, as on iOS. */
const SWIPE_PX = 36;
/** A key held this long shows what it does instead of typing. */
const HOLD_MS = 450;
/** A tip stays this long after the finger lifts. */
const TIP_MS = 1200;

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
  /** Pop the graph out into its floating window; absent hides the button. */
  popOutGraph?(): void;
}

export interface CalculatorOptions {
  /** Open on the keys typing this graph line of the notebook's graph (null: a new line). */
  editLine?: string | null;
  /**
   * Open on the graph pane to edit this graph (a graph on a page); its
   * Update graph button hands the edited graph to `done` and closes. The
   * calculator's own graph of the notebook is left as it was.
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

/** The notebook's graph while the app runs: the pop-up's graph pane and the graph window share it. */
export function graphStateFor(path: string): GraphState {
  let state = graphs.get(path);
  if (!state) {
    state = newGraphState();
    graphs.set(path, state);
  }
  return state;
}

/** A graph line laid out as math into `parent` (the graph window's list uses it too). */
export function drawGraphMath(parent: HTMLElement, text: string): void {
  const laid = layoutWithEnding(text, 10, { graph: true });
  if (laid) renderBox(parent, laid.box);
  else parent.createSpan({ cls: "goodobsidian-calc-raw", text });
}

/**
 * The size of everything drawn in `el`, its pieces included: an integral's
 * limits and a power's exponent hang outside the box `scrollHeight` sees.
 */
function drawnSize(el: HTMLElement): { w: number; h: number; dy: number } {
  const own = el.getBoundingClientRect();
  let top = own.top;
  let bottom = own.bottom;
  let left = own.left;
  let right = own.right;
  for (const child of Array.from(el.querySelectorAll("*"))) {
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  const dy = (top + bottom) / 2 - (own.top + own.bottom) / 2;
  return { w: Math.max(el.scrollWidth, right - left), h: bottom - top, dy };
}

/** Scale math about its right middle, moved so what is drawn is centred (`dy` from {@link drawnSize}). */
function centred(scale: number, dy: number): string {
  const shift = Math.abs(dy) > 0.5 ? `translateY(${(-dy * scale).toFixed(1)}px) ` : "";
  return scale < 1 || shift ? `${shift}scale(${scale})` : "";
}

type Pane = "keys" | "history" | "graph" | "steps";

/** A symbolic answer on show, with the expression it answers. */
type Shown = Extract<Worked, { ok: true }> & { expr: string };

export class CalculatorPopover {
  private readonly frame: FloatingWindow;
  private readonly el: HTMLElement;
  /** The window in use: a hardware keyboard types into it (the last tap was inside). */
  private active = true;
  private readonly dispose: Array<() => void> = [];
  private closed = false;
  private data: CalculatorData;
  private entry: Entry = { expr: "", cursor: 0, fresh: false };
  /** `Ans` while the current expression is typed: what it means in it. */
  private exprAns: CalcValue = session.ans;
  /** The result on show, kept exact so a switch can show it again differently. */
  private shown: CalcValue | null = null;
  /** The line the result on show came from, for Insert. */
  private shownLine: CalcEntry | null = null;
  /** The answer on show when it was worked symbolically (∫, d/dx, an equation), with its steps. */
  private worked: Shown | null = null;
  private error = "";
  private pane: Pane = "keys";
  private shifted = false;
  /** The graph line being typed on the keys: its id, or "new". */
  private editingLine: string | null = null;
  private graph: GraphPanel | null = null;
  private readonly graphState: GraphState;
  /** The angle of a graph being edited ({@link CalculatorOptions.editGraph}); its own, not the calculator's. */
  private editAngle: AngleMode | null = null;
  private tip: HTMLElement | null = null;
  private tipTimer = 0;
  /** Scientific (the keys and menus) or Basic (a pocket calculator). */
  private mode: CalcMode;
  private readonly basic: BasicPad;

  private readonly angleChip: HTMLButtonElement;
  private readonly fractionChip: HTMLButtonElement;
  private readonly baseChip: HTMLElement;
  private readonly memoryChip: HTMLButtonElement;
  private readonly editChip: HTMLButtonElement;
  private readonly displayEl: HTMLElement;
  private readonly exprEl: HTMLElement;
  private readonly mathEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly paneButtons = new Map<Pane, HTMLButtonElement>();
  private readonly bodyEl: HTMLElement;
  private readonly insertButtons: HTMLButtonElement[] = [];
  /** Insert graph, or Update graph while editing one: shown in the graph pane in place of Insert. */
  private readonly graphAction: HTMLButtonElement | null;

  constructor(
    container: HTMLElement,
    private readonly host: CalculatorHost,
    private readonly options: CalculatorOptions = {},
  ) {
    this.data = host.load();
    const edited = options.editGraph?.spec;
    if (edited) {
      this.graphState = newGraphState(edited);
      this.editAngle = edited.angle ?? "rad";
      this.pane = "graph";
    } else {
      this.graphState = graphStateFor(host.path);
    }
    // A graph or a graph line is edited on the scientific keys, whatever the mode.
    const modal = options.editGraph !== undefined || options.editLine !== undefined;
    this.mode = modal ? "scientific" : (this.data.prefs.mode ?? "scientific");
    this.frame = new FloatingWindow({
      container,
      cls: "goodobsidian-calc-window",
      title: options.editGraph ? "Edit graph" : "Calculator",
      label: "Calculator",
      buttons: modal
        ? []
        : [
            {
              icon: "calculator",
              label: "Basic calculator",
              run: () => this.setMode(this.otherMode()),
            },
          ],
      closeLabel: "Close the calculator",
      min: CALC_WINDOW_MIN,
      firstPlace: defaultCalcPlace,
      place: () => this.data.calcWindow ?? null,
      savePlace: (place) => this.save(withCalcWindow(this.data, place)),
      onClose: () => this.close(),
    });
    this.el = this.frame.body.createDiv({ cls: "goodobsidian-calc" });

    const display = this.el.createDiv({ cls: "goodobsidian-calc-display" });
    this.displayEl = display;
    const flags = display.createDiv({ cls: "goodobsidian-calc-flags" });
    this.angleChip = this.button(
      flags,
      "DEG",
      () => this.toggleAngle(),
      "goodobsidian-calc-chip",
      "Switch angles between degrees and radians",
    );
    this.angleChip.setAttribute("aria-label", "Degrees or radians");
    this.fractionChip = this.button(
      flags,
      "a/b",
      () => this.toggleFractions(),
      "goodobsidian-calc-chip",
      "Show answers as fractions",
    );
    this.fractionChip.setAttribute("aria-label", "Show fractions");
    this.baseChip = flags.createSpan({ cls: "goodobsidian-calc-flag" });
    this.memoryChip = this.button(
      flags,
      "M",
      () => this.act("mr"),
      "goodobsidian-calc-chip is-memory",
      "The memory: tap to type it (MR)",
    );
    this.editChip = this.button(
      flags,
      "",
      () => this.cancelLine(),
      "goodobsidian-calc-chip is-editing",
      "Stop editing this graph line",
    );
    flags.createDiv({ cls: "goodobsidian-calc-flags-gap" });
    for (const [icon, by, label] of [
      ["chevron-left", -1, "Cursor left"],
      ["chevron-right", 1, "Cursor right"],
    ] as const) {
      const move = this.button(
        flags,
        "",
        () => {
          this.entry = moveCursor(this.entry, by);
          this.refresh();
        },
        "goodobsidian-calc-icon is-cursor",
        `${label}: a box counts as one sign`,
      );
      setIcon(move, icon);
      move.setAttribute("aria-label", label);
    }
    if (host.popOutGraph && !options.editGraph) {
      const out = this.button(
        flags,
        "",
        () => {
          host.popOutGraph?.();
          // The graph now has its own window: this one goes back to its keys.
          if (this.pane === "graph") this.showPane("graph");
        },
        "goodobsidian-calc-icon is-popout",
        "Pop the graph out into a window that stays open while you write",
      );
      setIcon(out, "picture-in-picture-2");
      out.setAttribute("aria-label", "Pop out the graph");
    }
    this.paneButton(flags, "steps", "list-ordered", "Steps");
    this.paneButton(flags, "graph", "chart-spline", "Graph");
    this.paneButton(flags, "history", "history", "History");
    this.exprEl = display.createDiv({ cls: "goodobsidian-calc-expr" });
    this.mathEl = this.exprEl.createDiv({ cls: "goodobsidian-calc-math" });
    this.resultEl = display.createDiv({ cls: "goodobsidian-calc-result" });
    this.resultEl.setAttribute("aria-live", "polite");
    this.hintEl = display.createDiv({ cls: "goodobsidian-calc-hint" });
    this.installDisplayInput(display);
    // Basic's number sits where the display is, its keys where the keypad is.
    const basicDisplay = this.el.createDiv({ cls: "goodobsidian-calc-basic-slot" });

    const actions = this.el.createDiv({ cls: "goodobsidian-calc-actions" });
    this.insertButtons.push(
      this.button(
        actions,
        "Insert",
        () => this.insert(true),
        "goodobsidian-calc-insert",
        "Put the sum and its answer on the page",
      ),
      this.button(
        actions,
        "Insert answer",
        () => this.insert(false),
        "goodobsidian-calc-insert",
        "Put only the answer on the page",
      ),
    );
    this.insertButtons[0].setAttribute("aria-label", "Insert the sum and its answer on the page");
    this.insertButtons[1].setAttribute("aria-label", "Insert only the answer on the page");
    this.graphAction = null;
    if (options.editGraph) {
      this.graphAction = this.button(
        actions,
        "Update graph",
        () => this.finishGraph(),
        "goodobsidian-calc-insert",
      );
      this.graphAction.setAttribute("aria-label", "Update the graph on the page");
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
    const basicKeys = this.el.createDiv({ cls: "goodobsidian-calc-basic-slot is-keys" });
    this.basic = new BasicPad(basicDisplay, basicKeys, {
      button: (parent, label, run, cls) => this.button(parent, label, run, cls),
      worked: (line) => this.save(withEntry(this.data, this.host.path, line, Date.now())),
      changed: () => this.refreshInsert(),
    });
    this.applyMode();
    this.render();
    this.installKeys();
    this.installTouchGuard();
    if (options.editLine !== undefined) this.editLine(options.editLine);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** The graph as a plain object (lines, sliders, view, range), for a graph on a page; null when empty. */
  graphSpec(): GraphSpec | null {
    const spec =
      this.graph?.spec() ??
      normalizeGraphSpec({ ...this.graphState.spec, angle: this.graphAngle() });
    return (spec.lines ?? []).length === 0 ? null : spec;
  }

  /** The graph panel while it shows (the gallery measures its frames). */
  get graphPanel(): GraphPanel | null {
    return this.graph;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.graph?.destroy();
    window.clearTimeout(this.tipTimer);
    for (const d of this.dispose) d();
    this.frame.destroy();
  }

  /**
   * Type `text` into the expression, as a key would. The way in for an
   * expression from elsewhere (a recognised handwritten one).
   */
  type(text: string): void {
    // An expression is typed on the scientific keys (not remembered as the mode).
    if (this.mode === "basic") this.setMode("scientific", false);
    const wasFresh = this.entry.fresh;
    this.entry = typeInto(this.entry, text, false);
    if (wasFresh || this.entry.expr === text) this.exprAns = session.ans;
    this.error = "";
    this.refresh();
  }

  // --- Building ---------------------------------------------------------------

  /**
   * A button driven by pointer events; `click` only for keyboard activation.
   * With `help`, a long press shows it instead of running the button, and a
   * hover shows it as the title.
   */
  private button(
    parent: HTMLElement,
    label: string,
    run: () => void,
    cls = "",
    help?: string,
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `clickable-icon ${cls}`.trim(), text: label });
    if (help) button.setAttribute("title", help);
    let down = false;
    let held = false;
    let holdTimer = 0;
    const release = (): void => {
      down = false;
      window.clearTimeout(holdTimer);
      button.removeAttribute("data-pressed");
      // A tip shown by this hold stays while the finger does, then goes.
      if (held) this.hideTipSoon();
    };
    button.addEventListener("pointerdown", (event) => {
      // Keeps focus (and any page text box's keyboard) where it was.
      event.preventDefault();
      down = !button.disabled;
      held = false;
      if (!down) return;
      button.setAttribute("data-pressed", "");
      const text = help ?? button.getAttribute("title");
      if (text) {
        // "Nothing happened for HOLD_MS" is a timer (ledger), not a check on pointerup.
        holdTimer = window.setTimeout(() => {
          held = true;
          this.showTip(button, text);
        }, HOLD_MS);
      }
    });
    button.addEventListener("pointerup", () => {
      const fire = down && !held && !button.disabled;
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

  /** What a key does, in a bubble above it, for a moment. */
  private showTip(over: HTMLElement, text: string): void {
    this.hideTip();
    const card = this.el.getBoundingClientRect();
    const key = over.getBoundingClientRect();
    const tip = this.el.createDiv({ cls: "goodobsidian-calc-tip", text });
    tip.setAttribute("role", "tooltip");
    const width = Math.min(card.width - 16, 280);
    const left = Math.max(
      8,
      Math.min(card.width - width - 8, key.left - card.left + key.width / 2 - width / 2),
    );
    tip.setCssStyles({ left: `${left}px`, width: `${width}px` });
    const top = key.top - card.top - tip.offsetHeight - 6;
    tip.setCssStyles({ top: `${top < 4 ? key.bottom - card.top + 6 : top}px` });
    this.tip = tip;
  }

  private hideTipSoon(): void {
    window.clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => this.hideTip(), TIP_MS);
  }

  private hideTip(): void {
    window.clearTimeout(this.tipTimer);
    this.tip?.remove();
    this.tip = null;
  }

  private paneButton(parent: HTMLElement, pane: Pane, icon: string, label: string): void {
    const button = this.button(
      parent,
      "",
      () => this.showPane(pane),
      "goodobsidian-calc-icon",
      label,
    );
    setIcon(button, icon);
    button.setAttribute("aria-label", label);
    this.paneButtons.set(pane, button);
  }

  // --- Modes --------------------------------------------------------------------

  private otherMode(): CalcMode {
    return this.mode === "basic" ? "scientific" : "basic";
  }

  /** Show the calculator in `mode`, remembered for next time unless `remember` is false. */
  private setMode(mode: CalcMode, remember = true): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (remember) this.save(withPrefs(this.data, { mode }));
    this.hideTip();
    if (mode === "basic" && this.pane !== "keys") {
      // The graph's panel stops painting; Basic has no panes.
      this.pane = "keys";
      this.render();
    }
    this.applyMode();
  }

  /** The window's face for the mode, and its switch naming the other one. */
  private applyMode(): void {
    const basic = this.mode === "basic";
    this.el.toggleClass("is-basic", basic);
    const toggle = this.frame.barButtons[0];
    if (toggle) {
      const label = basic ? "Scientific calculator" : "Basic calculator";
      setIcon(toggle, basic ? "sigma" : "calculator");
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
    }
    if (basic) this.basic.refresh();
    else this.refresh();
    this.refreshInsert();
  }

  private render(): void {
    this.graph?.destroy();
    this.graph = null;
    this.hideTip();
    this.bodyEl.empty();
    this.bodyEl.className = `goodobsidian-calc-body is-${this.pane}`;
    // On the graph, Insert graph sits under the list, by the thumb (styles.css).
    this.el.toggleClass("is-graphing", this.pane === "graph");
    for (const [pane, button] of this.paneButtons) {
      const on = pane === this.pane;
      button.toggleClass("is-active", on);
      button.setAttribute("aria-pressed", String(on));
    }
    if (this.pane === "history") this.renderHistory();
    else if (this.pane === "steps") this.renderSteps();
    else if (this.pane === "graph") this.renderGraph();
    else this.renderKeys();
    this.refresh();
  }

  /** The tab the function keys show: Graph while a graph line is typed, else the one last used. */
  private tab(): KeyTab {
    return this.editingLine !== null && this.graphTab ? "graph" : this.data.prefs.tab;
  }
  /** While a graph line is typed, Graph is the tab until another is picked. */
  private graphTab = true;

  private renderKeys(): void {
    const { base } = this.data.prefs;
    const tabs = this.bodyEl.createDiv({ cls: "goodobsidian-calc-tabs" });
    tabs.setAttribute("role", "tablist");
    const current = this.tab();
    for (const { id, label } of KEY_TABS) {
      if (id === "graph" && this.editingLine === null) continue;
      const tab = this.button(tabs, label, () => this.setTab(id), "goodobsidian-calc-tab");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(id === current));
      tab.toggleClass("is-active", id === current);
    }
    const science = this.bodyEl.createDiv({ cls: "goodobsidian-calc-keys is-science" });
    for (const row of TAB_ROWS[current]) {
      for (const key of row) {
        if (key) this.key(science, key, base);
        else science.createDiv({ cls: "goodobsidian-calc-spacer" });
      }
    }
    const numbers = this.bodyEl.createDiv({ cls: "goodobsidian-calc-keys is-numbers" });
    for (const row of NUMBER_ROWS) for (const key of row) this.key(numbers, key, base);
  }

  private setTab(tab: KeyTab): void {
    this.shifted = false;
    if (tab === "graph") {
      this.graphTab = true;
    } else {
      if (this.editingLine !== null) this.graphTab = false;
      if (tab !== this.data.prefs.tab) this.save(withPrefs(this.data, { tab }));
    }
    this.render();
  }

  private key(grid: HTMLElement, face: CalcKey, base: NumberBase): void {
    const key = shownKey(face, this.shifted);
    const button = this.button(
      grid,
      this.keyLabel(key),
      () => this.press(key),
      "goodobsidian-calc-key",
      key.help,
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
    if (key.action === "base") {
      const on = key.base === base;
      button.toggleClass("is-active", on);
      button.setAttribute("aria-pressed", String(on));
    }
    if (key.action === "clear") button.dataset.clear = "";
    if (key.action === "equals") button.dataset.equals = "";
    button.disabled = !keyEnabled(key, base);
  }

  private keyLabel(key: CalcKey): string {
    if (key.action === "clear") return this.clearsAll() ? "AC" : "C";
    if (key.action === "angle") return this.angle() === "deg" ? "DEG" : "RAD";
    if (key.action === "equals" && this.editingLine !== null) return "Plot";
    return key.label;
  }

  /** AC clears everything; C, while something is typed, only the expression. */
  private clearsAll(): boolean {
    return this.entry.fresh || this.entry.expr === "";
  }

  /** The working of the answer on show: each step's rule, then what it left; the answer last. */
  private renderSteps(): void {
    const worked = this.showing();
    const list = this.bodyEl.createDiv({
      cls: "goodobsidian-calc-history goodobsidian-calc-steps",
    });
    if (!worked) return;
    for (const step of worked.steps) {
      const row = list.createDiv({ cls: "goodobsidian-calc-step" });
      row.createDiv({ cls: "goodobsidian-calc-step-rule", text: step.rule });
      this.drawLines(row.createDiv({ cls: "goodobsidian-calc-step-math" }), step.math, "or");
    }
    const answer = list.createDiv({ cls: "goodobsidian-calc-step is-answer" });
    this.drawLines(answer.createDiv({ cls: "goodobsidian-calc-step-math" }), worked.answer, "or");
    if (worked.note) answer.createDiv({ cls: "goodobsidian-calc-step-rule", text: worked.note });
    this.button(
      this.bodyEl,
      "Insert steps",
      () => this.insertSteps(),
      "goodobsidian-calc-insert goodobsidian-calc-insert-steps",
      "Put the working and the answer on the page as a text box",
    );
  }

  /** Several lines of math in a row, joined by a word ("or") or a comma. */
  private drawLines(parent: HTMLElement, lines: readonly string[], joiner: string): void {
    lines.forEach((line, i) => {
      if (i > 0) parent.createSpan({ cls: "goodobsidian-calc-step-join", text: joiner });
      const span = parent.createSpan({ cls: "goodobsidian-calc-math" });
      // Whole names (u, k, C) and = at the top, as an answer is written.
      const laid = layoutWithEnding(line, 10, { relations: true });
      if (laid) renderBox(span, laid.box);
      else span.createSpan({ cls: "goodobsidian-calc-raw", text: line });
    });
  }

  /** The symbolic answer on show, if the display shows one. */
  private showing(): Shown | null {
    const w = this.worked;
    return w && this.entry.fresh && w.expr === this.entry.expr ? w : null;
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
    this.graph = new GraphPanel(this.bodyEl, this.graphState, {
      angle: () => this.graphAngle(),
      editLine: (id) => this.editLine(id),
      changed: () => this.refresh(),
      drawMath: (parent, text) => this.drawMath(parent, text, true),
    });
    this.graph.paintNow();
  }

  /**
   * Lay `expression` out as math into `parent`; the text as typed when it
   * cannot be read. The display keeps what the layout had to add at the end
   * (its boxes), so a tap on one of those can add them to the text.
   */
  private drawMath(parent: HTMLElement, expression: string, graph = false, live = false): boolean {
    const laid = layoutWithEnding(expression, graph ? 10 : this.data.prefs.base, { graph });
    if (live) this.displayEnding = laid?.ending ?? "";
    if (!laid) {
      parent.createSpan({ cls: "goodobsidian-calc-raw", text: expression.replace(/[‸]/g, "") });
      return false;
    }
    renderBox(parent, laid.box);
    return true;
  }
  /** What the display added at the end of the expression to lay it out. */
  private displayEnding = "";

  // --- Behaviour --------------------------------------------------------------

  private angle(): AngleMode {
    return this.data.prefs.angle;
  }

  private ctx(): { angle: AngleMode; base: NumberBase; ans: CalcValue; memory: CalcValue } {
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
      // A graph line never carries a result on: an operator just types.
      this.entry = typeKey(
        this.entry,
        key.insert,
        key.continues === true && this.editingLine === null,
      );
      if (wasFresh) this.exprAns = session.ans;
      this.error = "";
      this.afterKey();
      return;
    }
    if (key.action) this.act(key.action, key);
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

  private act(action: CalcAction, key?: CalcKey): void {
    switch (action) {
      case "equals":
        if (boxes(this.entry.expr).length > 0 && !this.entry.fresh) {
          // Boxes still empty: = goes to the next one.
          this.entry = nextBox(this.entry);
          this.refresh();
        } else if (this.editingLine !== null) {
          this.plotLine();
        } else {
          this.equals();
        }
        return;
      case "shift":
        this.shifted = !this.shifted;
        this.render();
        return;
      case "angle":
        this.toggleAngle();
        return;
      case "base":
        if (key?.base) this.setBase(key.base);
        return;
      case "back":
        this.entry = backspace(this.entry, deleteLast);
        this.error = "";
        break;
      case "clear":
        if (this.clearsAll()) {
          this.shown = null;
          this.shownLine = null;
        }
        this.entry = { expr: "", cursor: 0, fresh: false };
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
    // ∫, d/dx, an equation or anything with x: worked symbolically, with steps.
    const symbolic = this.data.prefs.base === 10 ? work(expr, this.angle()) : null;
    if (symbolic) return this.showWorked(expr, symbolic);
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
    this.entry = { expr, cursor: expr.length, fresh: true };
    this.error = "";
    this.save(withEntry(this.data, this.host.path, line, Date.now()));
    this.refresh();
    return true;
  }

  private showWorked(expr: string, symbolic: Worked): boolean {
    if (!symbolic.ok) {
      this.error = symbolic.error;
      this.refresh();
      return false;
    }
    const ansText = this.format(this.exprAns) ?? "";
    const result = [...symbolic.answer, ...(symbolic.note ? [symbolic.note] : [])].join(", ");
    const line = { expr: spellAns(expr, ansText), result };
    this.worked = { ...symbolic, expr };
    // A single number (x = 3, the area from 0 to 3) becomes Ans; an expression does not.
    this.shown = null;
    if (symbolic.value !== undefined) {
      session.ans = symbolic.value;
      this.exprAns = symbolic.value;
    }
    this.shownLine = line;
    this.entry = { expr, cursor: expr.length, fresh: true };
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
    if (this.editingLine !== null && pane !== "keys") this.cancelLine(false);
    this.pane = this.pane === pane ? "keys" : pane;
    // Opening the graph with an expression in x plots it.
    const typed = this.entry.fresh ? "" : this.entry.expr;
    if (this.pane === "graph" && typed && usesVariable(typed)) {
      this.addLine(typed);
      this.entry = { expr: "", cursor: 0, fresh: false };
    }
    this.render();
  }

  // --- Graph lines on the keys ----------------------------------------------------

  private graphLines(): NonNullable<GraphSpec["lines"]> {
    const spec = this.graphState.spec;
    if (!spec.lines) spec.lines = [];
    return spec.lines;
  }

  private addLine(text: string): void {
    const lines = this.graphLines();
    if (lines.length >= MAX_LINES || lines.some((l) => l.text === text)) return;
    lines.push({ id: newLineId(lines), text });
    this.graphState.spec.expressions = lines.map((l) => l.text);
    graphChanged(this.graphState);
  }

  /** Type a graph line on the keys: an existing one (by id), or a new one. */
  private editLine(id: string | null): void {
    const line = id === null ? null : this.graphLines().find((l) => l.id === id);
    this.editingLine = line ? line.id : "new";
    this.graphTab = true;
    this.shifted = false;
    const expr = line?.text ?? "";
    this.entry = { expr, cursor: expr.length, fresh: false };
    this.error = "";
    this.pane = "keys";
    this.render();
  }

  /** Plot what is typed: the line edited, or a new one; then back to the graph. */
  private plotLine(): void {
    const text = this.entry.expr.trim();
    const lines = this.graphLines();
    const id = this.editingLine;
    if (id !== null && id !== "new") {
      const line = lines.find((l) => l.id === id);
      if (line) {
        if (text) line.text = text;
        else lines.splice(lines.indexOf(line), 1);
      }
    } else if (text) {
      this.addLine(text);
    }
    this.graphState.spec.expressions = lines.map((l) => l.text);
    graphChanged(this.graphState);
    this.editingLine = null;
    this.entry = { expr: "", cursor: 0, fresh: false };
    this.pane = "graph";
    this.render();
  }

  private cancelLine(render = true): void {
    this.editingLine = null;
    this.entry = { expr: "", cursor: 0, fresh: false };
    this.pane = "graph";
    if (render) this.render();
  }

  private graphAngle(): AngleMode {
    return this.editAngle ?? this.data.prefs.angle;
  }

  /** Insert graph, or Update graph: hand the graph over and close. */
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

  private toggleAngle(): void {
    if (this.editAngle !== null && this.pane === "graph") {
      this.editAngle = this.editAngle === "deg" ? "rad" : "deg";
    } else {
      this.save(withPrefs(this.data, { angle: this.data.prefs.angle === "deg" ? "rad" : "deg" }));
    }
    this.render();
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
        this.entry = { expr: text, cursor: text.length, fresh: false };
        this.error = "";
      }
      this.shown = null;
    }
    this.render();
  }

  private insert(withSum: boolean): void {
    if (this.mode === "basic") {
      const line = this.basic.lineForInsert();
      if (!line) return;
      const text =
        withSum && line.expr !== line.result ? `${line.expr} = ${line.result}` : line.result;
      if (this.host.insert(text)) this.close();
      return;
    }
    if (!this.entry.fresh && !this.equals()) return;
    const line = this.shownLine;
    if (!line) return;
    const worked = this.showing();
    if (worked) {
      const answer = worked.answer.map(readable).join(", ");
      const text = withSum ? `${readable(line.expr)}: ${answer}` : answer;
      if (this.host.insert(text)) this.close();
      return;
    }
    const result = this.shown !== null ? (this.format(this.shown) ?? line.result) : line.result;
    const text = withSum ? `${line.expr} = ${result}` : result;
    if (this.host.insert(text)) this.close();
  }

  /** The problem, each step (its rule, then its math) and the answer, as lines of a text box. */
  private insertSteps(): void {
    const worked = this.showing();
    if (!worked) return;
    const lines = [readable(worked.expr)];
    for (const step of worked.steps) {
      lines.push(step.rule, `   ${step.math.map(readable).join("  or  ")}`);
    }
    lines.push(`Answer: ${worked.answer.map(readable).join(", ")}`);
    if (worked.note) lines.push(worked.note);
    if (this.host.insert(lines.join("\n"))) this.close();
  }

  private save(data: CalculatorData): void {
    this.data = data;
    this.host.save(data);
  }

  /** Redraw the display and the switches from the state. */
  private refresh(): void {
    const { base, fractions } = this.data.prefs;
    const editing = this.editingLine !== null;
    const graphing = this.pane === "graph";
    this.angleChip.setText((graphing ? this.graphAngle() : this.angle()) === "deg" ? "DEG" : "RAD");
    this.angleChip.disabled = base !== 10 && !graphing;
    this.fractionChip.toggleClass("is-active", fractions);
    this.fractionChip.setAttribute("aria-pressed", String(fractions));
    this.fractionChip.disabled = base !== 10;
    this.fractionChip.toggleClass("is-hidden", graphing || editing);
    this.baseChip.setText(base === 10 ? "" : BASE_LABELS[base]);
    this.baseChip.toggleClass("is-hidden", base === 10 || graphing || editing);
    const memory = formatValue(session.memory, { base });
    this.memoryChip.setText(`M = ${memory ?? "…"}`);
    this.memoryChip.toggleClass(
      "is-hidden",
      formatValue(session.memory) === "0" || graphing || editing,
    );
    const index = this.graphLines().findIndex((l) => l.id === this.editingLine);
    this.editChip.setText(
      this.editingLine === "new" ? "New graph line  ✕" : `Graph line ${index + 1}  ✕`,
    );
    this.editChip.toggleClass("is-hidden", !editing || graphing);
    for (const move of Array.from(this.el.querySelectorAll(".is-cursor"))) {
      move.toggleClass("is-hidden", graphing);
    }
    this.el.querySelector(".is-popout")?.toggleClass("is-hidden", !graphing);
    const clear = this.bodyEl.querySelector<HTMLElement>("[data-clear]");
    if (clear) clear.setText(this.clearsAll() ? "AC" : "C");
    const equalsKey = this.bodyEl.querySelector<HTMLElement>("[data-equals]");
    if (equalsKey) equalsKey.setText(editing ? "Plot" : "=");

    this.mathEl.empty();
    const expr = this.entry.expr;
    const typing = !this.entry.fresh;
    const marked = typing ? withCursor(this.entry) : expr;
    let laid = true;
    if (marked) laid = this.drawMath(this.mathEl, marked, editing, true);
    if (!laid && typing) this.mathEl.createSpan({ cls: "goodobsidian-calc-caret" });
    if (!marked && typing) this.mathEl.createSpan({ cls: "goodobsidian-calc-caret" });
    this.mathEl.toggleClass("is-raw", !laid);
    this.exprEl.toggleClass("is-done", this.entry.fresh);
    this.exprEl.toggleClass("is-hidden-expr", graphing);
    const worked = !this.error && !graphing && !editing ? this.showing() : null;
    // A worked answer is math, often stacked (x⁴ over 12): the expression
    // gives it some of its height, so both fit and the keys stay put.
    this.displayEl.toggleClass("has-math", worked !== null);
    this.resultEl.toggleClass("is-math", worked !== null);
    this.fitExpression();

    this.resultEl.removeClass("is-error", "is-preview");
    let text: string;
    if (this.error) {
      text = this.error;
      this.resultEl.addClass("is-error");
    } else if (graphing) {
      text = "";
    } else if (editing) {
      text = "";
    } else if (this.showing()) {
      text = "";
    } else if (this.entry.fresh && this.shown !== null) {
      const shown = this.format(this.shown);
      text = shown ?? "Not a whole number";
      if (shown === null) this.resultEl.addClass("is-error");
    } else {
      // A quiet preview while typing; errors wait for =.
      const result =
        expr.trim() && boxes(expr).length === 0
          ? calculate(expr, this.ctx(), this.data.prefs)
          : null;
      text = result?.ok ? result.text : expr ? "" : "0";
      this.resultEl.addClass("is-preview");
    }
    this.resultEl.setText(text);
    if (worked) {
      this.drawLines(
        this.resultEl.createSpan({ cls: "goodobsidian-calc-answer" }),
        worked.answer,
        ",",
      );
    }
    // The steps button shows only while there are steps to show.
    this.paneButtons.get("steps")?.toggleClass("is-hidden", !worked || worked.steps.length === 0);
    this.fitResult();
    this.hintEl.setText(this.hint());

    this.refreshInsert();
  }

  /** Insert and Insert answer (or, on the graph, Insert graph) for what is on show. */
  private refreshInsert(): void {
    const basic = this.mode === "basic";
    const editing = this.editingLine !== null;
    const graphing = this.pane === "graph" && !basic;
    const canInsert = basic
      ? this.basic.canInsert()
      : this.entry.fresh || (this.entry.expr.trim() !== "" && !editing);
    const graphActions = graphing && this.graphAction !== null;
    for (const button of this.insertButtons) {
      button.disabled = !canInsert;
      button.toggleClass("is-hidden", graphActions);
    }
    if (this.graphAction) {
      this.graphAction.toggleClass("is-hidden", !graphActions);
      this.graphAction.disabled = this.graphLines().length === 0;
    }
  }

  private hint(): string {
    if (this.pane === "graph") return "";
    const worked = this.showing();
    if (worked) return worked.note ?? (worked.approx ? "Found numerically" : "");
    return hintFor(this.entry);
  }

  /** Scale the expression down to its line instead of letting the display grow. */
  private fitExpression(): void {
    this.mathEl.setCssStyles({ transform: "" });
    const room = this.exprEl.clientWidth;
    const height = this.exprEl.clientHeight - 6;
    const { w, h, dy } = drawnSize(this.mathEl);
    if (!room || !w) return;
    const scale = Math.min(1, room / w, height / Math.max(1, h));
    this.mathEl.setCssStyles({ transform: centred(scale, dy) });
  }

  /**
   * The result's font shrinks to fit its line, as iOS's does; an answer
   * laid out as math scales down to its row's width and height, as the
   * expression does.
   */
  private fitResult(): void {
    this.resultEl.setCssStyles({ fontSize: `${RESULT_MAX_PX}px` });
    const answer = this.resultEl.querySelector<HTMLElement>(".goodobsidian-calc-answer");
    if (answer) {
      answer.setCssStyles({ transform: "" });
      const { w, h, dy } = drawnSize(answer);
      if (!w || !h) return;
      const room = this.resultEl.clientWidth - 4;
      const scale = Math.min(1, room / w, (this.resultEl.clientHeight - 4) / h);
      answer.setCssStyles({ transform: centred(scale, dy) });
      return;
    }
    const size = fittedFontSize(
      this.resultEl.scrollWidth,
      this.resultEl.clientWidth,
      RESULT_MAX_PX,
      RESULT_MIN_PX,
    );
    if (size !== RESULT_MAX_PX) this.resultEl.setCssStyles({ fontSize: `${size}px` });
  }

  // --- Gestures, placement and dismissal --------------------------------------

  /**
   * The display: a finger drawn across it deletes a sign per
   * {@link SWIPE_PX}, as on iOS; a tap on a box moves the cursor to it, a
   * tap elsewhere to the end.
   */
  private installDisplayInput(display: HTMLElement): void {
    let from: number | null = null;
    let swiped = false;
    display.addEventListener("pointerdown", (event) => {
      if ((event.target as Element | null)?.closest("button")) return;
      from = event.clientX;
      swiped = false;
    });
    display.addEventListener("pointermove", (event) => {
      if (from === null || Math.abs(event.clientX - from) < SWIPE_PX) return;
      from = event.clientX;
      swiped = true;
      this.act("back");
    });
    display.addEventListener("pointerup", (event) => {
      const tapped = from !== null && !swiped;
      from = null;
      if (!tapped || this.entry.fresh || this.tapSlot(event)) return;
      // A tap on the display away from every box: the cursor after
      // everything shown, past the brackets the display draws closed.
      this.entry = toEnd(this.entry);
      this.refresh();
    });
    // A box's 44 px target reaches past the display's edge onto the card.
    const onCard = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (display.contains(target) || target?.closest("button, input, canvas")) return;
      if (!this.entry.fresh) this.tapSlot(event);
    };
    this.el.addEventListener("pointerup", onCard);
    this.dispose.push(() => this.el.removeEventListener("pointerup", onCard));
    const end = (): void => {
      from = null;
    };
    display.addEventListener("pointercancel", end);
    display.addEventListener("pointerleave", end);
  }

  /** Move the cursor into the box nearest a tap, if one is within reach; false when none is. */
  private tapSlot(event: PointerEvent): boolean {
    const slot = nearestSlot(this.mathEl, event.clientX, event.clientY);
    const index = slot ? Number(slot.dataset.slot) : NaN;
    if (!Number.isInteger(index)) return false;
    this.entry = moveToBox(this.entry, index, this.displayEnding);
    this.refresh();
    return true;
  }

  /**
   * iOS claims a still finger on a key for its own long press (selection,
   * a callout) and then cancels the pointer; cancelling `touchstart` on the
   * keys keeps the hold ours (CLAUDE.md, the draw-and-hold entry). Lists
   * that scroll are left alone.
   */
  private installTouchGuard(): void {
    const guard = (event: TouchEvent): void => {
      const target = event.target as Element | null;
      if (
        target?.closest(
          ".goodobsidian-calc-key, .goodobsidian-calc-tab, .goodobsidian-calc-chip, .goodobsidian-calc-display, .goodobsidian-calc-bkey, .goodobsidian-calc-basic-display",
        )
      ) {
        event.preventDefault();
      }
    };
    this.el.addEventListener("touchstart", guard, { passive: false });
    this.dispose.push(() => this.el.removeEventListener("touchstart", guard));
  }

  /**
   * A hardware keyboard types into the calculator while it is the window in
   * use: from opening it, or a tap inside it, until a tap anywhere else.
   * Escape then cancels a graph line being typed, or closes the calculator.
   */
  private installKeys(): void {
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      this.active = !!target && this.frame.el.contains(target);
      if (target && this.tip && !this.tip.contains(target)) this.hideTip();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (!this.active || this.frame.isMinimised) return;
      if (this.mode === "basic") {
        this.basicKey(event);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (this.editingLine !== null) this.cancelLine();
        else this.close();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const mapped = keyboardKey(event.key);
      if (!mapped) return;
      event.preventDefault();
      event.stopPropagation();
      if ("move" in mapped) {
        this.entry =
          event.key === "Tab" ? nextBox(this.entry) : moveCursor(this.entry, mapped.move);
        this.refresh();
        return;
      }
      if ("action" in mapped) {
        this.act(mapped.action);
        return;
      }
      if (this.pane !== "keys") {
        if (this.pane === "graph") this.editLine(null);
        else {
          this.pane = "keys";
          this.render();
        }
      }
      this.press({ label: mapped.insert, insert: mapped.insert, continues: mapped.continues });
    };
    // Capture: the drawing surface consumes its own pointer events, and its
    // single-letter shortcuts (P, E, T) must not fire while typing a sum.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    this.dispose.push(() => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    });
  }

  /**
   * A hardware key in Basic: digits, + - * x /, %, Enter or = and Backspace
   * as on its keys; Escape clears (C, then AC), and closes once all is clear.
   */
  private basicKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    const key = basicKeyFor(event.key);
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    if ("clear" in key && event.key === "Escape" && this.basic.isClear) this.close();
    else this.basic.press(key);
  }
}

/** Reach of a tap around a box, px: 22 each way makes a 44 px target of a 13 px glyph. */
const SLOT_REACH = 22;

/** The box nearest a tap at (x, y), within {@link SLOT_REACH}; null when none is that close. */
function nearestSlot(root: HTMLElement, x: number, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDistance = SLOT_REACH;
  for (const slot of Array.from(root.querySelectorAll<HTMLElement>(".gob-m-slot"))) {
    const r = slot.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }
  return best;
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
      parent
        .createSpan({ cls: box.active ? "gob-m-slot is-active" : "gob-m-slot" })
        .setAttribute("data-slot", String(box.index ?? ""));
      return;
    case "caret":
      parent.createSpan({ cls: "goodobsidian-calc-caret" });
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
      if (box.hi) renderBox(limits.createSpan({ cls: "gob-m-hi" }), box.hi);
      limits.createSpan({ cls: "gob-m-sym", text: box.sym });
      if (box.lo) renderBox(limits.createSpan({ cls: "gob-m-lo" }), box.lo);
      renderBox(op.createSpan({ cls: "gob-m-body" }), box.body);
      if (box.tail) op.createSpan({ cls: "gob-m-var gob-m-tail", text: box.tail });
      return;
    }
  }
}
