/**
 * Calculation notes, the maths card (FineNotes#178, design 2 of
 * `research/review/calc-menu-designs.html`): what a tap on a glowing sum
 * opens. The reading typeset at the top (a tap opens a dialog to type it,
 * `calc-reading-modal.ts`); what Grape was unsure of, each a tap away from
 * its other guesses; the answer as a fraction or a decimal; Write; and along the foot,
 * turn the sum into a typed equation, copy its LaTeX, or say it is not maths.
 *
 * Chrome in the paper, so it scrolls and zooms with the page; the surface
 * places it beside the sum. Every control acts on a tap (`onTap`), so the
 * Pencil works as well as a finger.
 */

import { setIcon } from "obsidian";
import { equationFrameSize, equationLayout, paintLayout } from "../canvas/equation-paint";
import { t } from "../i18n/translate";
import type { AnswerForms } from "../model/calc-tex";
import { onTap } from "./selection-bar";

/** Which form of the answer is chosen. */
export type AnswerForm = "fraction" | "decimal";

/** What the card shows: the reading, as LaTeX and as the calculator's text, and its answer. */
export interface CalcCardContent {
  tex: string;
  /** The calculator's text, which the reading dialog edits. */
  expression: string;
  forms: AnswerForms;
  form: AnswerForm;
  /**
   * What stands before the "=" when the sum becomes a typed equation: the
   * sum itself (its LaTeX), or for an equation solved, its letter ("x").
   */
  lead: string;
  /** What Grape was unsure of: each doubtful character (or piece) and its runner-ups. */
  doubts: Array<{ char: string; alternatives: string[] }>;
}

export interface CalcCardActions {
  write: (form: AnswerForm) => void;
  toEquation: (form: AnswerForm) => void;
  copyLatex: () => void;
  notMaths: () => void;
  /** Open the dialog to type the reading (the card follows what it saves). */
  editReading: () => void;
  /** The chosen form changed (remembered for the next sum). */
  formChosen: (form: AnswerForm) => void;
  /** Doubt `doubt` answered as `text`: the new content, or null when it no longer works out. */
  pick: (doubt: number, text: string) => CalcCardContent | null;
}

/** The preview's font size, CSS px. */
const PREVIEW_SIZE = 26;
/** Room kept between the card and the edge of the notebook's visible area, CSS px. */
const CARD_MARGIN = 12;

export class CalcCard {
  private readonly el: HTMLElement;
  private readonly preview: HTMLButtonElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly forms: HTMLElement;
  private readonly fractionButton: HTMLButtonElement;
  private readonly decimalButton: HTMLButtonElement;
  private readonly main: HTMLElement;
  private readonly doubtsRow: HTMLElement;
  private readonly fixView: HTMLElement;
  private readonly fixChoices: HTMLElement;
  private content: CalcCardContent | null = null;
  private actions: CalcCardActions | null = null;

  constructor(parent: HTMLElement) {
    this.el = parent.createDiv({ cls: "goodobsidian-calc-card is-hidden" });
    // Presses on the card stay on the card: none reaches the page.
    this.el.addEventListener("pointerdown", (event) => event.stopPropagation());
    const main = (this.main = this.el.createDiv({ cls: "goodobsidian-calc-card-main" }));

    this.preview = main.createEl("button", {
      cls: "goodobsidian-calc-card-preview clickable-icon",
    });
    this.preview.setAttribute("aria-label", t("calculator.fixReading"));
    this.canvas = this.preview.createEl("canvas");
    onTap(this.preview, () => this.editReading());

    // What Grape was unsure of, dotted as on the page: a tap opens its other
    // guesses. A short line says what the dotted characters are.
    this.doubtsRow = main.createDiv({ cls: "goodobsidian-calc-card-doubts" });

    this.forms = main.createDiv({ cls: "goodobsidian-segmented goodobsidian-calc-card-forms" });
    this.fractionButton = this.forms.createEl("button", {
      cls: "goodobsidian-calc-card-form clickable-icon",
    });
    this.fractionButton.setAttribute("aria-label", t("calculator.asFraction"));
    this.decimalButton = this.forms.createEl("button", {
      cls: "goodobsidian-calc-card-form clickable-icon",
    });
    this.decimalButton.setAttribute("aria-label", t("calculator.asDecimal"));
    onTap(this.fractionButton, () => this.choose("fraction"));
    onTap(this.decimalButton, () => this.choose("decimal"));

    const write = main.createEl("button", { cls: "goodobsidian-calc-card-write mod-cta" });
    setIcon(write.createSpan({ cls: "goodobsidian-calc-card-write-icon" }), "corner-down-left");
    write.createSpan({ text: t("calculator.write") });
    onTap(write, () => {
      const form = this.content?.form;
      if (form) this.actions?.write(form);
    });

    const foot = main.createDiv({ cls: "goodobsidian-calc-card-foot" });
    const icon = (name: string, label: string, action: () => void): void => {
      const b = foot.createEl("button", { cls: "clickable-icon goodobsidian-calc-card-icon" });
      setIcon(b, name);
      b.setAttribute("aria-label", label);
      onTap(b, action);
    };
    icon("sigma", t("calculator.toEquation"), () => {
      const form = this.content?.form;
      if (form) this.actions?.toEquation(form);
    });
    icon("copy", t("calculator.copyLatex"), () => this.actions?.copyLatex());
    icon("x", t("calculator.notMaths"), () => this.actions?.notMaths());

    // The correction view: a doubt's runner-ups, ✎ to type it, ← back.
    this.fixView = this.el.createDiv({ cls: "goodobsidian-calc-card-fix is-hidden" });
    const head = this.fixView.createDiv({ cls: "goodobsidian-calc-card-fix-head" });
    const back = head.createEl("button", { cls: "clickable-icon goodobsidian-calc-card-icon" });
    setIcon(back, "chevron-left");
    back.setAttribute("aria-label", t("calculator.back"));
    onTap(back, () => this.showMain());
    head.createSpan({ cls: "goodobsidian-calc-card-hint", text: t("calculator.whichDidYouWrite") });
    this.fixChoices = this.fixView.createDiv({ cls: "goodobsidian-calc-card-choices" });
  }

  /** Whether `node` is inside the card. */
  contains(node: Node | null): boolean {
    return node !== null && this.el.contains(node);
  }

  get shown(): boolean {
    return !this.el.hasClass("is-hidden");
  }

  /** Open it on `content`; with `doubt` (an index into its doubts), straight at that doubt's runner-ups. */
  show(content: CalcCardContent, actions: CalcCardActions, doubt = -1): void {
    this.actions = actions;
    this.el.removeClass("is-hidden");
    this.setContent(content);
    if (doubt >= 0 && doubt < content.doubts.length) this.showFix(doubt);
    else this.showMain();
  }

  private showMain(): void {
    this.fixView.addClass("is-hidden");
    this.main.removeClass("is-hidden");
  }

  /** The runner-ups of doubt `index`: what was read first (chosen), then the others, then ✎. */
  private showFix(index: number): void {
    const doubt = this.content?.doubts[index];
    if (!doubt) return;
    this.fixChoices.empty();
    for (const choice of [doubt.char, ...doubt.alternatives]) {
      const b = this.fixChoices.createEl("button", {
        cls: "clickable-icon goodobsidian-calc-card-choice",
        text: choice,
      });
      b.toggleClass("is-active", choice === doubt.char);
      onTap(b, () => this.pick(index, choice));
    }
    const type = this.fixChoices.createEl("button", {
      cls: "clickable-icon goodobsidian-calc-card-choice",
    });
    setIcon(type, "pencil");
    type.setAttribute("aria-label", t("calculator.fixReading"));
    onTap(type, () => {
      this.showMain();
      this.editReading();
    });
    this.main.addClass("is-hidden");
    this.fixView.removeClass("is-hidden");
  }

  /** A choice for doubt `index`: another character changes the reading; the one read confirms it. Either way the doubt goes. */
  private pick(index: number, text: string): void {
    const doubt = this.content?.doubts[index];
    if (!doubt || !this.actions) return;
    const next = this.actions.pick(index, text);
    if (next) this.update(next);
    this.showMain();
  }

  /** New content for the card while it is open (a pick, a typed reading). */
  update(next: CalcCardContent): void {
    if (!this.content) return;
    this.setContent({
      ...next,
      form: next.forms.fraction ? this.content.form : "decimal",
    });
  }

  hide(): void {
    this.el.addClass("is-hidden");
    this.content = null;
    this.actions = null;
  }

  /**
   * Put its top left at `left`, `top` in the paper's px; `flip` puts its top
   * right there instead. It then moves up as far as it must to end inside
   * `room` (the notebook's visible area, client px), but never above its top.
   */
  place(left: number, top: number, flip: boolean, room: DOMRect | null = null): void {
    this.el.setCssStyles({ left: `${left}px`, top: `${top}px` });
    this.el.toggleClass("is-flipped", flip);
    if (!room) return;
    const rect = this.el.getBoundingClientRect();
    const over = rect.bottom - (room.bottom - CARD_MARGIN);
    if (over <= 0) return;
    const up = Math.min(over, Math.max(0, rect.top - (room.top + CARD_MARGIN)));
    if (up > 0) this.el.setCssStyles({ top: `${top - up}px` });
  }

  private setContent(content: CalcCardContent): void {
    this.content = content;
    const fraction = content.forms.fraction;
    this.fractionButton.empty();
    if (fraction) {
      const f = this.fractionButton.createSpan({ cls: "goodobsidian-calc-card-frac" });
      f.createSpan({ text: fraction.n.replace(/^-/, "−") });
      f.createSpan({ text: fraction.d });
    }
    const decimal = content.forms.decimal;
    this.decimalButton.setText(decimal.shown ?? decimal.text.replace(/^-/, "−"));
    this.doubtsRow.empty();
    this.doubtsRow.toggleClass("is-hidden", content.doubts.length === 0);
    if (content.doubts.length > 0) {
      this.doubtsRow.createSpan({
        cls: "goodobsidian-calc-card-hint",
        text: t("calculator.notSure"),
      });
    }
    content.doubts.forEach((doubt, i) => {
      const chip = this.doubtsRow.createEl("button", {
        cls: "clickable-icon goodobsidian-calc-card-doubt",
        text: doubt.char,
      });
      chip.setAttribute("aria-label", t("calculator.fixChar", { char: doubt.char }));
      onTap(chip, () => this.showFix(i));
    });
    // A whole number has one form: the answer alone, no choice.
    this.fractionButton.toggleClass("is-hidden", !fraction);
    this.forms.toggleClass("is-single", !fraction);
    if (!fraction) content.form = "decimal";
    this.fractionButton.toggleClass("is-active", content.form === "fraction");
    this.decimalButton.toggleClass("is-active", content.form === "decimal");
    this.drawPreview();
  }

  private choose(form: AnswerForm): void {
    if (!this.content || this.content.form === form) return;
    this.content.form = form;
    this.fractionButton.toggleClass("is-active", form === "fraction");
    this.decimalButton.toggleClass("is-active", form === "decimal");
    this.actions?.formChosen(form);
  }

  private editReading(): void {
    this.actions?.editReading();
  }

  /** The reading typeset, as the page would set it, in the card's text colour. */
  private drawPreview(): void {
    const content = this.content;
    const ctx = this.canvas.getContext("2d");
    if (!content || !ctx) return;
    const layout = equationLayout(ctx, content.tex, PREVIEW_SIZE);
    const frame = equationFrameSize(layout, PREVIEW_SIZE);
    const cssW = Math.ceil(Math.min(240, frame.w));
    const cssH = Math.ceil(frame.h);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.setCssStyles({ width: `${cssW}px`, height: `${cssH}px` });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const k = Math.min(1, cssW / frame.w);
    const height = layout.a + layout.d;
    ctx.save();
    ctx.translate((cssW - layout.w * k) / 2, (cssH - height * k) / 2 + layout.a * k);
    ctx.scale(k, k);
    paintLayout(ctx, layout, getComputedStyle(this.preview).color || "#222");
    ctx.restore();
    this.canvas.setAttribute("aria-label", content.tex);
  }
}
