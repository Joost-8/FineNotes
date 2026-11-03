/**
 * The keyboard and stylus shortcuts the settings tab lists (FineNotes#25),
 * as data: grouped, each shortcut one or more ways to do it, each way the
 * keys held together and what the pen or mouse then does.
 *
 * Keys are named as Obsidian's own Hotkeys tab names them, so the list reads
 * like the rest of the settings: on a Mac or an iPad the modifier glyphs
 * (⌘ ⌥ ⇧), elsewhere the words (Ctrl, Alt, Shift).
 *
 * PURE: no DOM, no Obsidian.
 */

import { type TextKey, t } from "../i18n/translate";

/** A modifier, by the name the shortcuts are written with. */
export type Modifier = "Mod" | "Alt" | "Shift";

/** One way to do a shortcut: keys held together, then (optionally) a pen gesture. */
export interface ShortcutWay {
  /** Keys pressed together, in order: modifiers first. Modifiers by their {@link Modifier} name. */
  keys: readonly string[];
  /** What the pen, mouse or finger does with them held ("write", "drag"); none for a plain key. */
  gesture?: string;
}

export interface Shortcut {
  /** What it does. */
  action: string;
  /** Each way to do it; shown with "or" between them. */
  ways: readonly ShortcutWay[];
  /** `ways` are the two ends of a run of keys ("1" to "8"), not alternatives. */
  range?: boolean;
  /**
   * The row of `./shortcut-bindings.ts` this line describes, so the sheet
   * can show a key the user changed; "pen.saved" for the eight saved pens.
   */
  binding?: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: readonly Shortcut[];
}

const key = (...keys: string[]): ShortcutWay => ({ keys });
/** Keys held while the pen does something; the gesture is read in the language in use. */
const held = (keys: string[], gesture: TextKey): ShortcutWay => ({
  keys,
  get gesture() {
    return t(gesture);
  },
});
/** A gesture with no key to hold. */
const gesture = (name: TextKey): ShortcutWay => held([], name);

/** A line of the list: its action is read in the language in use. */
const line = (
  action: TextKey,
  ways: readonly ShortcutWay[],
  more: Pick<Shortcut, "range" | "binding"> = {},
): Shortcut => ({
  get action() {
    return t(action);
  },
  ways,
  ...more,
});

/** A group of the list: its title is read in the language in use. */
const group = (title: TextKey, shortcuts: readonly Shortcut[]): ShortcutGroup => ({
  get title() {
    return t(title);
  },
  shortcuts,
});

/** Every shortcut, grouped as the settings list them. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  group("toolbar.shortcut.group.tools", [
    line("toolbar.tool.pen", [key("P"), key("W")], { binding: "tool.pen" }),
    line("toolbar.tool.highlighter", [key("H")], { binding: "tool.highlighter" }),
    line("toolbar.tool.eraser", [key("E")], { binding: "tool.eraser" }),
    line("toolbar.tool.lasso", [key("V")], { binding: "tool.select" }),
    line("toolbar.tool.shapes", [key("S")], { binding: "tool.shape" }),
    line("toolbar.tool.textBox", [key("T")], { binding: "tool.text" }),
    line("toolbar.shortcut.sheet.laser", [key("L")], { binding: "tool.laser" }),
  ]),
  group("toolbar.shortcut.group.pens", [
    line("toolbar.shortcut.sheet.savedPens", [key("1"), key("8")], {
      range: true,
      binding: "pen.saved",
    }),
    line("toolbar.shortcut.sheet.eraseWithSettings", [
      held(["Shift"], "toolbar.shortcut.gesture.write"),
    ]),
  ]),
  group("toolbar.shortcut.group.selectionEditing", [
    line("toolbar.shortcut.sheet.lassoSelect", [held(["Mod"], "toolbar.shortcut.gesture.write")]),
    line("toolbar.shortcut.sheet.selectAll", [key("Mod", "A")], { binding: "edit.select-all" }),
    line("toolbar.shortcut.deleteSelection", [key("Delete"), key("Backspace")], {
      binding: "edit.delete",
    }),
    line("common.copy", [key("Mod", "C")], { binding: "edit.copy" }),
    line("common.cut", [key("Mod", "X")], { binding: "edit.cut" }),
    line("common.paste", [key("Mod", "V")], { binding: "edit.paste" }),
    line("common.undo", [key("Mod", "Z")], { binding: "edit.undo" }),
    line("common.redo", [key("Mod", "Shift", "Z")], { binding: "edit.redo" }),
  ]),
  group("toolbar.shortcut.group.viewZoom", [
    line("toolbar.shortcut.sheet.zoomAboutPen", [held(["Alt"], "toolbar.shortcut.gesture.drag")]),
    line("toolbar.shortcut.sheet.movePage", [held(["Space"], "toolbar.shortcut.gesture.drag")], {
      binding: "tool.pan",
    }),
    line("toolbar.shortcut.previousPage", [key("Page Up")], { binding: "view.previous-page" }),
    line("toolbar.shortcut.nextPage", [key("Page Down")], { binding: "view.next-page" }),
    line("toolbar.shortcut.sheet.toggleList", [key("?")], { binding: "view.shortcuts" }),
  ]),
  group("toolbar.shortcut.group.stylus", [
    line("toolbar.shortcut.sheet.erase", [gesture("toolbar.shortcut.gesture.eraserEnd")]),
    line("toolbar.shortcut.sheet.movePageWithPen", [
      gesture("toolbar.shortcut.gesture.dragBeside"),
    ]),
  ]),
];

const APPLE: Record<Modifier, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧" };
const OTHER: Record<Modifier, string> = { Mod: "Ctrl", Alt: "Alt", Shift: "Shift" };
const SPOKEN: Record<Modifier, string> = { Mod: "Command", Alt: "Option", Shift: "Shift" };

function isModifier(name: string): name is Modifier {
  return name === "Mod" || name === "Alt" || name === "Shift";
}

/**
 * A key as its key cap shows it: on Apple devices (`apple`) the modifier
 * glyphs, elsewhere their names; every other key as written.
 */
export function keyLabel(name: string, apple: boolean): string {
  if (!isModifier(name)) return name;
  return (apple ? APPLE : OTHER)[name];
}

/** A key's full name, for a screen reader or a tooltip ("Command" for ⌘). */
export function keyName(name: string, apple: boolean): string {
  if (!isModifier(name)) return name;
  return apple ? SPOKEN[name] : OTHER[name];
}

/**
 * One way as plain text, as Obsidian prints a hotkey: "Ctrl + Shift + Z",
 * "⌘ ⇧ Z"; a gesture follows its keys ("Shift + write").
 */
export function wayText(way: ShortcutWay, apple: boolean): string {
  const keys = way.keys.map((name) => keyLabel(name, apple)).join(apple ? " " : " + ");
  if (!way.gesture) return keys;
  return keys ? `${keys} + ${way.gesture}` : way.gesture;
}

/** A shortcut's ways as plain text: "P or W", "1 – 8". */
export function shortcutText(shortcut: Shortcut, apple: boolean): string {
  const joiner = shortcut.range ? " – " : ` ${t("toolbar.shortcut.or")} `;
  return shortcut.ways.map((way) => wayText(way, apple)).join(joiner);
}
