/**
 * Beautify's neatness slider, at the end of the AI menu, below everything
 * else there (Joost, 2026-11-25). A pen at the left end ("most like my
 * ink") and Beautify's brush at the right ("neatest"), the tool bar's own
 * slider between, five stops (`recognition/writer/neatness.ts`); one line
 * under it says what Beautify does and what the two ends mean, at his
 * explicit word ("with explanation").
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

/** Appends the slider, under its heading and over its one line, to the menu. */
export function renderNeatnessRow(parent: HTMLElement, control: NeatnessControl): HTMLInputElement {
  parent.createDiv({ cls: "goodobsidian-aimenu-heading", text: t("ai.menu.beautify") });
  const row = parent.createDiv({ cls: "goodobsidian-neatness" });
  const end = (icon: string, label: string): void => {
    const mark = row.createSpan({
      cls: "goodobsidian-neatness-end",
      attr: { "aria-label": label },
    });
    setIcon(mark, icon);
  };
  end("pen-line", t("ai.menu.likeMyInk"));
  const track = row.createDiv({ cls: "goodobsidian-width-slider" });
  const range = track.createEl("input", {
    cls: "goodobsidian-width-range",
    type: "range",
    attr: {
      min: "0",
      max: String(NEATNESS_STEPS),
      step: "1",
      "aria-label": t("ai.menu.neatness"),
    },
  });
  range.value = String(Math.round(neatnessOf(control.get()) * NEATNESS_STEPS));
  dragRange(range);
  syncRangeFill(range);
  range.addEventListener("input", () => syncRangeFill(range));
  range.addEventListener("change", () => control.set(Number(range.value) / NEATNESS_STEPS));
  end("brush-cleaning", t("ai.menu.neatest"));
  parent.createDiv({
    cls: "goodobsidian-aimenu-reason goodobsidian-neatness-about",
    text: t("ai.menu.beautifyAbout"),
  });
  return range;
}
