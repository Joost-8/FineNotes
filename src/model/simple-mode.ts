/**
 * The simple look: Obsidian's own chrome tucked away so FineNotes reads as an
 * app of its own to someone new to Obsidian. It hides the title bar, the
 * status bar, the left ribbon and the sidebars, and keeps the tabs. It only
 * hides: nothing of Obsidian is removed, and one switch brings it all back.
 * The pieces are styled under one body class in styles.css.
 */

/** The body class worn while the look is on. */
export const SIMPLE_CLASS = "goodobsidian-simple";

/** The classes to wear: the one while the look is on, none when it is off. */
export function simpleClasses(on: boolean): string[] {
  return on ? [SIMPLE_CLASS] : [];
}
