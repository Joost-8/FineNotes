/**
 * The simple look: Obsidian's own chrome tucked away so FineNotes reads as an
 * app of its own to someone new to Obsidian. It hides the status bar, the
 * ribbon, the right sidebar (with its drawer and toggle) and the tab strip
 * of the left sidebar, and keeps the tabs of the main area. In the left
 * sidebar it shows the Folders sidebar (`view/folder-sidebar`), and the
 * notebook library opens as the Folders library from there. The chrome is
 * only hidden: nothing of Obsidian is removed, and one switch brings it all
 * back, closing the Folders tab and stopping its search with it. The pieces
 * are styled under one body class in styles.css.
 */

/** The body class worn while the look is on. */
export const SIMPLE_CLASS = "goodobsidian-simple";

/** The classes to wear: the one while the look is on, none when it is off. */
export function simpleClasses(on: boolean): string[] {
  return on ? [SIMPLE_CLASS] : [];
}
