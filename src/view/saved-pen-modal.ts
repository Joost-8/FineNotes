/**
 * Makes or changes a saved pen, from the settings' "Pens and shortcuts"
 * (FineNotes#24): the pen's stroke on a strip of paper, then its type, its
 * width and its colour, the stroke following every change.
 *
 *   New pen                                   ✕
 *   [ ~~~~ the stroke, in its ink, on paper ~~~~ ]
 *   (fountain) (ball) (brush) (calligraphy) (highlighter)
 *   ───────────●──────────────          [0.41] mm
 *   ● ● ● ● ● ● ●   (the colour picker every colour choice opens)
 *   Same as pen 3                (only while it is)
 *                               [Cancel] [Add]
 *
 * It hands the pen back; the settings tab saves it.
 */

import { type App, Modal } from "obsidian";
import { SIZES } from "../constants";
import { relativeLuminance } from "../model/cover";
import { nearestStop, widthStops } from "../model/pen-widths";
import {
  SAVED_PEN_NAMES,
  SAVED_PEN_SCALE,
  SAVED_PEN_TYPES,
  type SavedPen,
  duplicateIndex,
  mmText,
  sampleThickness,
  savedPenLabel,
  widthFromMm,
  withPenType,
} from "../model/saved-pens";
import { renderColorPicker } from "./color-picker";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { penGlyph, penSample } from "./pen-glyph-svg";
import { syncRangeFill } from "./range-fill";

export interface SavedPenModalOptions {
  /** The pen the dialog starts from: the one being changed, or a draft for a new one. */
  pen: SavedPen;
  /** Which saved pen this is (0-based), or null for a new one. */
  index: number | null;
  /** Every saved pen now, so a pen that is saved already can be told. */
  pens: readonly SavedPen[];
  /** How opaque the page draws the highlighter (the settings' Highlighter opacity, 0–1). */
  highlighterAlpha: number;
  /** Recent custom colours, newest first, and the user's own palette. */
  recent: readonly string[];
  palette: readonly string[];
  /** A custom colour was made: the host remembers it as recent. */
  onCustomColor?: (color: string) => void;
  onSave: (pen: SavedPen) => void;
}

/** The preview strip's size when it has not been laid out yet (the stylesheet's), px. */
const PREVIEW_FALLBACK = { width: 360, height: 56 };

export class SavedPenModal extends Modal {
  private readonly keyboard: DialogKeyboard;
  private pen: SavedPen;

  constructor(
    app: App,
    private readonly options: SavedPenModalOptions,
  ) {
    super(app);
    this.pen = { ...options.pen };
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    const { index } = this.options;
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-pen-modal");
    this.titleEl.setText(index === null ? "New pen" : `Pen ${index + 1}`);
    const body = this.contentEl;
    body.addClass("goodobsidian-pen-modal-body");

    const preview = body.createDiv({ cls: "goodobsidian-size-preview goodobsidian-pen-preview" });
    preview.setAttribute("role", "img");

    const types = body.createDiv({ cls: "goodobsidian-pen-modal-types" });
    types.setAttribute("role", "radiogroup");
    types.setAttribute("aria-label", "Pen type");
    const typeButtons = SAVED_PEN_TYPES.map((type) => {
      const button = types.createEl("button", {
        cls: "goodobsidian-pen-modal-type clickable-icon",
      });
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", SAVED_PEN_NAMES[type]);
      button.setAttribute("title", SAVED_PEN_NAMES[type]);
      button.addEventListener("click", () => {
        this.pen = withPenType(this.pen, type);
        show();
      });
      return { type, button };
    });

    const widthRow = body.createDiv({ cls: "goodobsidian-pen-modal-width" });
    // The pen pill's width slider, as its width popover draws it.
    const range = widthRow.createDiv({ cls: "goodobsidian-width-slider" }).createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
    });
    range.setAttribute("aria-label", "Width");
    range.min = "0";
    range.step = "1";
    const readout = widthRow.createDiv({ cls: "goodobsidian-width-readout" });
    const field = readout.createEl("input", {
      cls: "goodobsidian-width-field goodobsidian-pen-modal-mm",
      type: "text",
    });
    field.setAttribute("inputmode", "decimal");
    field.setAttribute("enterkeyhint", "done");
    field.setAttribute("autocomplete", "off");
    field.setAttribute("spellcheck", "false");
    field.setAttribute("aria-label", "Width in millimetres");
    readout.createSpan({ cls: "goodobsidian-width-unit", text: "mm" });
    this.keyboard.watch(field, widthRow);
    /** The slider's stops for the type in hand: the pens go finer than the highlighter. */
    const stops = (): number[] => widthStops(SIZES, this.pen.type !== "highlighter");
    range.addEventListener("input", () => {
      const width = stops()[Number(range.value)];
      if (width === undefined) return;
      this.pen = { ...this.pen, size: width };
      show();
    });
    const typed = (): void => {
      // The mm are the ink's: a highlighter's band, its width times 4.
      const scale = SAVED_PEN_SCALE[this.pen.type];
      const width = widthFromMm(field.value, scale);
      field.toggleClass("is-invalid", width === null);
      if (width === null) return;
      this.pen = withPenType({ ...this.pen, size: width }, this.pen.type);
      field.value = mmText(this.pen.size, scale);
      show();
    };
    field.addEventListener("change", typed);
    onEnterKey(field, typed);

    const colors = body.createDiv({ cls: "goodobsidian-pen-modal-colors" });
    const drawColors = (): void => {
      colors.empty();
      renderColorPicker(colors, {
        current: this.pen.color,
        // The user's own colours, and the pen's colour if it is none of the offered ones.
        extra: [...this.options.palette, this.pen.color],
        recent: this.options.recent,
        onPick: (color) => {
          if (!color) return;
          this.pen = { ...this.pen, color };
          drawColors();
          show();
        },
        onCustom: (color) => {
          this.options.onCustomColor?.(color);
          this.pen = { ...this.pen, color };
          drawColors();
          show();
        },
      });
    };
    drawColors();

    const hint = body.createDiv({ cls: "goodobsidian-pen-modal-hint" });

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", {
      cls: "mod-cta",
      text: index === null ? "Add" : "Save",
    });
    save.addEventListener("click", () => {
      if (save.disabled) return;
      const pen = { ...this.pen };
      this.close();
      this.options.onSave(pen);
    });

    /** Everything that shows the pen, after any change to it. */
    const show = (): void => {
      const pen = this.pen;
      preview.empty();
      const width = preview.clientWidth || PREVIEW_FALLBACK.width;
      const height = preview.clientHeight || PREVIEW_FALLBACK.height;
      preview.append(
        penSample(
          pen.type,
          pen.color,
          sampleThickness(pen),
          width,
          height,
          this.options.highlighterAlpha,
          body.ownerDocument,
        ),
      );
      preview.setAttribute("aria-label", savedPenLabel(pen));
      preview.toggleClass("is-highlighter", pen.type === "highlighter");
      // Ink that would vanish into white paper is shown on dark paper.
      preview.toggleClass("is-light-ink", relativeLuminance(pen.color) > 0.75);
      for (const { type, button } of typeButtons) {
        button.empty();
        button.append(penGlyph(type, pen.color, body.ownerDocument));
        const on = type === pen.type;
        button.toggleClass("is-active", on);
        button.setAttribute("aria-checked", String(on));
      }
      const all = stops();
      range.max = String(all.length - 1);
      range.value = String(nearestStop(all, pen.size));
      syncRangeFill(range);
      if (body.ownerDocument.activeElement !== field) {
        field.value = mmText(pen.size, SAVED_PEN_SCALE[pen.type]);
      }
      field.removeClass("is-invalid");
      const same = duplicateIndex(this.options.pens, pen, index ?? -1);
      hint.setText(same >= 0 ? `Same as pen ${same + 1}` : "");
      hint.toggleClass("is-hidden", same < 0);
      save.disabled = same >= 0;
    };
    show();
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }
}
