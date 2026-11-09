/**
 * Calculation notes (FineNotes#178): fixing what Grape read of a sum, typed.
 * A dialog like the word check's ("What does it say?"), so on the iPad it
 * rises above the keyboard instead of the keyboard covering the card: the
 * reading as text (× ÷ as written), the sum typeset as it is typed, and
 * Save. A sum the calculator cannot work out stays open with a line saying
 * so.
 */

import { type App, Modal } from "obsidian";
import { equationFrameSize, equationLayout, paintLayout } from "../canvas/equation-paint";
import { t } from "../i18n/translate";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";

export interface CalcReadingOptions {
  /** The reading as it is now, in the calculator's text. */
  expression: string;
  /** The typed text as LaTeX, for the preview; null while it does not read. */
  preview: (text: string) => string | null;
  /** Use the typed text: true when it worked out (the dialog closes). */
  submit: (text: string) => boolean;
}

/** The calculator's text as a writer types it: × ÷ − for * / -. */
export function readableSum(expression: string): string {
  return expression
    .replace(/\s*\*\s*/g, " × ")
    .replace(/\s*\/\s*/g, " ÷ ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What was typed, in the calculator's text. */
export function typedSum(text: string): string {
  return text.replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").trim();
}

export class CalcReadingModal extends Modal {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly options: CalcReadingOptions,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.titleEl.setText(t("calculator.readingTitle"));
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    body.createDiv({ cls: "goodobsidian-ask-note", text: t("calculator.readingNote") });
    const canvas = body.createEl("canvas", { cls: "goodobsidian-calc-reading-preview" });
    const row = body.createDiv({ cls: "goodobsidian-contents-field-row" });
    const field = row.createEl("input", {
      cls: "goodobsidian-contents-field",
      type: "text",
      attr: {
        "aria-label": t("calculator.fixReading"),
        autocapitalize: "none",
        spellcheck: "false",
        enterkeyhint: "done",
      },
    });
    field.value = readableSum(this.options.expression);
    this.keyboard.watch(field, row);
    const save = row.createEl("button", { cls: "mod-cta", text: t("common.save") });
    const refused = body.createDiv({
      cls: "goodobsidian-calc-reading-refused is-hidden",
      text: t("calculator.readingRefused"),
    });
    const draw = (): void => this.draw(canvas, this.options.preview(typedSum(field.value)));
    field.addEventListener("input", () => {
      refused.addClass("is-hidden");
      draw();
    });
    const done = (): void => {
      const text = typedSum(field.value);
      if (!text) return;
      if (this.options.submit(text)) this.close();
      else refused.removeClass("is-hidden");
    };
    save.addEventListener("click", done);
    onEnterKey(field, done);
    window.setTimeout(() => {
      draw();
      field.focus();
      field.select();
    }, 0);
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }

  /** The typed sum typeset, in the dialog's text colour; blank while it does not read. */
  private draw(canvas: HTMLCanvasElement, tex: string | null): void {
    const ctx = canvas.getContext("2d");
    const cssW = canvas.clientWidth || 280;
    const cssH = 56;
    if (!ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.setCssStyles({ height: `${cssH}px` });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!tex) return;
    const size = 24;
    const layout = equationLayout(ctx, tex, size);
    const frame = equationFrameSize(layout, size);
    const k = Math.min(1, cssW / frame.w, cssH / frame.h);
    ctx.save();
    ctx.translate((cssW - layout.w * k) / 2, (cssH - (layout.a + layout.d) * k) / 2 + layout.a * k);
    ctx.scale(k, k);
    paintLayout(ctx, layout, getComputedStyle(canvas).color || "#222");
    ctx.restore();
  }
}
