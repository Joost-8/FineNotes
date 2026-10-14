/**
 * The keyboard and stylus shortcuts as a list: in groups, two columns, each
 * key a key cap as Obsidian's Hotkeys tab draws its chips. The settings tab
 * shows it under "Pens and shortcuts", and the notebook in a pop-up
 * (`../ui/shortcuts-modal.ts`, the ? key). What is listed is
 * `../model/shortcuts.ts`.
 */

import {
  SHORTCUT_GROUPS,
  type ShortcutWay,
  keyLabel,
  keyName,
  shortcutText,
} from "../model/shortcuts";

/**
 * Fill `parent` with the list, keys named for Apple devices (`apple`: ⌘ ⌥ ⇧)
 * or for the rest (Ctrl, Alt, Shift). Returns the list's element.
 */
export function renderShortcutList(parent: HTMLElement, apple: boolean): HTMLElement {
  const list = parent.createDiv({ cls: "goodobsidian-shortcuts" });
  for (const group of SHORTCUT_GROUPS) {
    const block = list.createDiv({ cls: "goodobsidian-shortcut-group" });
    block.createDiv({ cls: "goodobsidian-shortcut-group-title", text: group.title });
    for (const shortcut of group.shortcuts) {
      const line = block.createDiv({ cls: "goodobsidian-shortcut" });
      line.createDiv({ cls: "goodobsidian-shortcut-action", text: shortcut.action });
      const keys = line.createDiv({ cls: "goodobsidian-shortcut-keys" });
      keys.setAttribute("aria-label", shortcutText(shortcut, apple));
      shortcut.ways.forEach((way, index) => {
        if (index > 0) {
          keys.createSpan({ cls: "goodobsidian-shortcut-sep", text: shortcut.range ? "–" : "or" });
        }
        drawWay(keys, way, apple);
      });
    }
  }
  return list;
}

/** One way to do a shortcut: a key cap per key, then what the pen or mouse does. */
function drawWay(parent: HTMLElement, way: ShortcutWay, apple: boolean): void {
  const span = parent.createSpan({ cls: "goodobsidian-shortcut-way" });
  way.keys.forEach((name, index) => {
    // Obsidian joins keys with "+" in words, and sets glyphs side by side.
    if (index > 0 && !apple) span.createSpan({ cls: "goodobsidian-shortcut-plus", text: "+" });
    const label = keyLabel(name, apple);
    const cap = span.createEl("kbd", { cls: "goodobsidian-key", text: label });
    // ⌘ ⌥ ⇧ are small in most fonts: their caps set them larger.
    if (label !== name && label.length === 1) cap.addClass("is-glyph");
    const spoken = keyName(name, apple);
    if (spoken !== label) cap.setAttribute("title", spoken);
  });
  if (way.gesture) {
    span.createSpan({
      cls: "goodobsidian-shortcut-gesture",
      text: way.keys.length > 0 ? `+ ${way.gesture}` : way.gesture,
    });
  }
}
