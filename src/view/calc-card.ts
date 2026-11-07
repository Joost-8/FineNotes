/**
 * Calculation notes, the maths card (FineNotes#178, design 2 of
 * `research/review/calc-menu-designs.html`): what a tap on a glowing sum
 * opens. The reading typeset at the top, which a tap turns into a field to
 * fix it; the answer as a fraction or a decimal; Write; and along the foot,
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
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { onTap } from "./selection-bar";

/** Which form of the answer is chosen. */
export type AnswerForm = "fraction" | "decimal";

/** What the card shows: the reading, as LaTeX and as the calculator's text, and its answer. */
export interface CalcCardContent {
  tex: string;
  /** The calculator's text, which the fix field edits. */
  expression: string;
  forms: AnswerForms;
  form: AnswerForm;
  /** What Grape was unsure of: each doubtful character (or piece) and its runner-ups. */
  doubts: Array<{ char: string; alternatives: string[] }>;
}

export interface CalcCardActions {
  write: (form: AnswerForm) => void;
  toEquation: (form: AnswerForm) => void;
  copyLatex: () => void;
  notMaths: () => void;
  /** A fixed reading: its new content, or null when the calculator cannot work it out. */
  fix: (expression: string) => CalcCardContent | null;
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
  private readonly field: HTMLInputElement;
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

    // What Grape was unsure of, dotted as on the page: a tap opens its runner-ups.
    this.doubtsRow = main.createDiv({ cls: "goodobsidian-calc-card-doubts" });

    this.field = main.createEl("input", {
      cls: "goodobsidian-calc-card-field is-hidden",
      attr: { type: "text", enterkeyhint: "done", autocapitalize: "off", spellcheck: "false" },
    });
    this.field.setAttribute("aria-label", t("calculator.fixReading"));
    onEnterKey(this.field, () => this.commitReading());
    // On the iPad the card rises above the keyboard while the reading is typed.
    new DialogKeyboard(this.el).watch(this.field, this.field);
    this.field.addEventListener("blur", () => this.commitReading());

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
    this.fixChoices = this.fixView.createDiv({ cls: "goodobsidian-calc-card-choices" });
  }

  /** Whether `node` is inside the card. */
  contains(node: Node | null): boolean {
    return node !== null && this.el.contains(node);
  }

  get shown(): boolean {
    return !this.el.hasClass("is-hidden");
  }

  /** Whether the reading is being typed in (the keyboard may be up). */
  get editing(): boolean {
    return !this.field.hasClass("is-hidden");
  }

  /** Open it on `content`; with `doubt` (an index into its doubts), straight at that doubt's runner-ups. */
  show(content: CalcCardContent, actions: CalcCardActions, doubt = -1): void {
    this.actions = actions;
    this.field.addClass("is-hidden");
    this.preview.removeClass("is-hidden");
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

  private pick(index: number, text: string): void {
    const doubt = this.content?.doubts[index];
    if (!doubt || !this.actions) return;
    if (text !== doubt.char) {
      const next = this.actions.pick(index, text);
      if (next)
        this.setContent({
          ...next,
          form: next.forms.fraction ? (this.content?.form ?? "decimal") : "decimal",
        });
    }
    this.showMain();
  }

  hide(): void {
    this.el.addClass("is-hidden");
    this.field.addClass("is-hidden");
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
    if (!room || this.editing) return;
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
    this.decimalButton.setText(content.forms.decimal.text.replace(/^-/, "−"));
    this.doubtsRow.empty();
    this.doubtsRow.toggleClass("is-hidden", content.doubts.length === 0);
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
    if (!this.content) return;
    this.field.value = this.content.expression.replace(/\*/g, "×");
    this.preview.addClass("is-hidden");
    this.field.removeClass("is-hidden");
    this.field.focus();
    this.field.select();
  }

  private commitReading(): void {
    if (!this.editing || !this.content || !this.actions) return;
    const text = this.field.value.replace(/×/g, "*").trim();
    this.field.addClass("is-hidden");
    this.preview.removeClass("is-hidden");
    if (!text || text === this.content.expression) return;
    const next = this.actions.fix(text);
    if (next)
      this.setContent({ ...next, form: next.forms.fraction ? this.content.form : "decimal" });
    else this.el.addClass("is-refused");
    window.setTimeout(() => this.el.removeClass("is-refused"), 400);
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
