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
}

export interface ShortcutGroup {
  title: string;
  shortcuts: readonly Shortcut[];
}

const key = (...keys: string[]): ShortcutWay => ({ keys });
const held = (keys: string[], gesture: string): ShortcutWay => ({ keys, gesture });

/** Every shortcut, grouped as the settings list them. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Tools",
    shortcuts: [
      { action: "Pen", ways: [key("P"), key("W")] },
      { action: "Highlighter", ways: [key("H")] },
      { action: "Eraser", ways: [key("E")] },
      { action: "Lasso", ways: [key("V")] },
      { action: "Shapes", ways: [key("S")] },
      { action: "Text box", ways: [key("T")] },
      { action: "Laser pointer: a trail that fades, never saved", ways: [key("L")] },
    ],
  },
  {
    title: "Pens",
    shortcuts: [
      { action: "Saved pens 1 to 8", ways: [key("1"), key("8")], range: true },
      { action: "Erase, with the eraser's settings", ways: [held(["Shift"], "write")] },
    ],
  },
  {
    title: "Selection and editing",
    shortcuts: [
      { action: "Lasso select", ways: [held(["Mod"], "write")] },
      {
        action: "Select everything on the page; Delete then clears it",
        ways: [key("Mod", "A")],
      },
      { action: "Undo", ways: [key("Mod", "Z")] },
      { action: "Redo", ways: [key("Mod", "Shift", "Z")] },
    ],
  },
  {
    title: "View and zoom",
    shortcuts: [
      { action: "Zoom in or out about the pen", ways: [held(["Alt"], "write up or down")] },
      { action: "Move the page", ways: [held(["Space"], "drag")] },
      { action: "Previous and next page", ways: [key("Page Up"), key("Page Down")] },
    ],
  },
  {
    title: "Stylus",
    shortcuts: [
      { action: "Erase", ways: [{ keys: [], gesture: "Write with the eraser end" }] },
      {
        action: "Move the page, with a pen or mouse",
        ways: [{ keys: [], gesture: "Drag beside the page" }],
      },
    ],
  },
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
  return shortcut.ways.map((way) => wayText(way, apple)).join(shortcut.range ? " – " : " or ");
}
