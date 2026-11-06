/**
 * − value mm +: a length typed, or stepped with a Pencil tap. The paper
 * designer's control, shared so a length in mm is set the same way
 * everywhere (the template picker's spacing, the margin's spacing).
 *
 * Return (the iPad's ✓ too) takes the number through `onEnterKey`; the
 * field's `change` (on Return or when it loses focus) reports it. Inside a
 * dialog or popover a `DialogKeyboard` keeps the row above the keyboard.
 */

import { setIcon } from "obsidian";
import type { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { t } from "../i18n/translate";

export interface MmStepperOptions {
  /** What the length is, for the buttons' and field's names. */
  label: string;
  /** How far − and + move, mm. */
  step: number;
  /** The length shown, mm. */
  get: () => number;
  /** A length asked for, mm, not yet held to any range: the owner keeps or refuses it. */
  put: (value: number) => void;
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
  /** Show the length again, unless it is being typed. */
  sync: () => void;
}

export function mmStepper(parent: HTMLElement, options: MmStepperOptions): MmStepper {
  const { label, step, get, put } = options;
  const format = options.format ?? ((value: number) => String(Number(value.toFixed(2))));
  const box = parent.createDiv({
    cls: ["goodobsidian-mm-stepper", ...(options.cls ? [options.cls] : [])],
  });
  const minus = box.createEl("button", {
    cls: "clickable-icon",
    attr: {
      "aria-label": t("notebooks.designer.less", { label }),
      title: t("notebooks.designer.lessTitle"),
    },
  });
  setIcon(minus, "minus");
  const input = box.createEl("input", {
    attr: {
      type: "text",
      inputmode: "decimal",
      enterkeyhint: "done",
      "aria-label": t("notebooks.designer.inMm", { label }),
    },
  });
  box.createSpan({ cls: "goodobsidian-mm-stepper-unit", text: "mm" });
  const plus = box.createEl("button", {
    cls: "clickable-icon",
    attr: {
      "aria-label": t("notebooks.designer.more", { label }),
      title: t("notebooks.designer.moreTitle"),
    },
  });
  setIcon(plus, "plus");
  minus.addEventListener("click", () => put(get() - step));
  plus.addEventListener("click", () => put(get() + step));
  input.addEventListener("change", () => {
    // An emptied field is no number (Number("") would be 0): the owner shows the length again.
    const text = input.value.trim().replace(",", ".");
    put(text === "" ? Number.NaN : Number(text));
  });
  onEnterKey(input, () => input.blur());
  if (options.keyboard) options.keyboard.watch(input, options.row ?? box);
  const sync = (): void => {
    if (document.activeElement !== input) input.value = format(get());
  };
  sync();
  return { el: box, input, sync };
}
