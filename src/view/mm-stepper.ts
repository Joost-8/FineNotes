/**
 * A length in mm on a slider, with its value as a field beside it: dragged,
 * or typed. The paper designer's control, shared so a length in mm is set the
 * same way everywhere (the template picker's spacing, the margin's spacing).
 * It was − value mm + until FineNotes#211: a long way took many taps; the
 * slider is the pens' width slider (`dragRange`, `syncRangeFill`).
 *
 * The slider steps by the length's own step and reports when it is let go
 * (`put`), or at every step with `live`. Return (the iPad's ✓ too) takes a
 * typed number through `onEnterKey`; the field's `change` (on Return or when
 * it loses focus) reports it. Inside a dialog or popover a `DialogKeyboard`
 * keeps the row above the keyboard.
 */

import type { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";
import { t } from "../i18n/translate";

export interface MmStepperOptions {
  /** What the length is, for the slider's and field's names. */
  label: string;
  /** The slider's ends and step, mm. */
  min: number;
  max: number;
  step: number;
  /** The length shown, mm. */
  get: () => number;
  /** A length asked for, mm, not yet held to any range: the owner keeps or refuses it. */
  put: (value: number) => void;
  /** Report each step while the slider is dragged, not only when it is let go. */
  live?: boolean;
  /** How the field shows a length; default: up to two decimals. */
  format?: (value: number) => string;
  /** Keeps `row` above the iPad keyboard while the field has focus. */
  keyboard?: DialogKeyboard;
  row?: HTMLElement;
  /** Extra class on the control. */
  cls?: string;
}

export interface MmStepper {
  el: HTMLElement;
  input: HTMLInputElement;
  range: HTMLInputElement;
  /** Show the length again, unless it is being typed. */
  sync: () => void;
}

export function mmStepper(parent: HTMLElement, options: MmStepperOptions): MmStepper {
  const { label, min, max, step, get, put } = options;
  const format = options.format ?? ((value: number) => String(Number(value.toFixed(2))));
  const box = parent.createDiv({
    cls: ["goodobsidian-mm-stepper", ...(options.cls ? [options.cls] : [])],
  });
  const track = box.createDiv({ cls: "goodobsidian-width-slider goodobsidian-mm-stepper-slider" });
  const range = track.createEl("input", {
    cls: "goodobsidian-width-range",
    type: "range",
    attr: { "aria-label": label },
  });
  dragRange(range);
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  const input = box.createEl("input", {
    attr: {
      type: "text",
      inputmode: "decimal",
      enterkeyhint: "done",
      "aria-label": t("notebooks.designer.inMm", { label }),
    },
  });
  box.createSpan({ cls: "goodobsidian-mm-stepper-unit", text: "mm" });
  range.addEventListener("input", () => {
    const value = Number(range.value);
    syncRangeFill(range);
    input.value = format(value);
    if (options.live) put(value);
  });
  range.addEventListener("change", () => put(Number(range.value)));
  input.addEventListener("change", () => {
    // An emptied field is no number (Number("") would be 0): the owner shows the length again.
    const text = input.value.trim().replace(",", ".");
    put(text === "" ? Number.NaN : Number(text));
  });
  onEnterKey(input, () => input.blur());
  if (options.keyboard) options.keyboard.watch(input, options.row ?? box);
  const sync = (): void => {
    const value = get();
    if (input.doc.activeElement !== input) input.value = format(value);
    range.value = String(value);
    syncRangeFill(range);
  };
  sync();
  return { el: box, input, range, sync };
}
