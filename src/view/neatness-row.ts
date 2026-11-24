/**
 * Beautify's neatness slider, in the Lasso tool popover (Beautify is a
 * lasso action; a tool's settings live in its own popover, design rulings
 * 2026-10-27). A pen at the left end ("most like my ink") and Beautify's
 * brush at the right ("neatest"; sparkles already mean AI in the bar), the
 * tool bar's own slider between, five stops; the middle is the model's own
 * guidance (`recognition/writer/neatness.ts`).
 */

import { setIcon } from "obsidian";

import { t } from "../i18n/translate";
import { NEATNESS_STEPS, neatnessOf } from "../recognition/writer/neatness";
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";

/** Where the slider reads and keeps its value (the plugin's settings). */
export interface NeatnessControl {
  get(): number;
  set(neatness: number): void;
}

/** Appends the slider, under its label, to a popover's body. */
export function renderNeatnessRow(body: HTMLElement, control: NeatnessControl): HTMLInputElement {
  body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.lasso.beautify") });
  const row = body.createDiv({ cls: "goodobsidian-neatness" });
  const end = (icon: string, label: string): void => {
    const mark = row.createSpan({
      cls: "goodobsidian-neatness-end",
      attr: { "aria-label": label },
    });
    setIcon(mark, icon);
  };
  end("pen-line", t("toolbar.lasso.likeMyInk"));
  const track = row.createDiv({ cls: "goodobsidian-width-slider" });
  const range = track.createEl("input", {
    cls: "goodobsidian-width-range",
    type: "range",
    attr: {
      min: "0",
      max: String(NEATNESS_STEPS),
      step: "1",
      "aria-label": t("toolbar.lasso.neatness"),
    },
  });
  range.value = String(Math.round(neatnessOf(control.get()) * NEATNESS_STEPS));
  dragRange(range);
  syncRangeFill(range);
  range.addEventListener("input", () => syncRangeFill(range));
  range.addEventListener("change", () => control.set(Number(range.value) / NEATNESS_STEPS));
  end("brush-cleaning", t("toolbar.lasso.neatest"));
  return range;
}
