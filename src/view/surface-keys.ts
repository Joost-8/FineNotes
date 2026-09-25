/**
 * What a key pressed on the notebook stands for. The surface describes what
 * is on screen, this module names the action, and the surface carries it
 * out. The checks run in the order keys are claimed: Escape closes an open
 * menu before it lets go of the selection under it, and a crop being edited
 * keeps Delete from reaching the picture.
 *
 * The questions about the screen are functions, asked only when a check
 * needs the answer and in the order written here, because some of the
 * surface's answers also tidy up state that went stale (a selection an undo
 * took away).
 *
 * Pure: no DOM, no Obsidian.
 */

import type { ActiveTool } from "./toolbar";

/** The parts of a keyboard event this module reads. */
export interface KeyChord {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** What the surface is showing when the key goes down. */
export interface KeyScene {
  /** A picture is in crop mode. */
  cropping: boolean;
  /** A page text box has the focus; Cmd/Ctrl + a key is then the text's. */
  editingText: () => boolean;
  /** Offer Cmd/Ctrl + this key to the clipboard (cut, copy, paste): true if it took it. */
  clipboard: () => boolean;
  /** The selection's "…" menu is open. */
  menuOpen: () => boolean;
  /** A picture is selected on its own. */
  imageSelected: () => boolean;
  /** A lasso selection is on the page. */
  groupSelected: () => boolean;
  /** The lasso's tap-and-hold bar (Paste, Unlock) is open. */
  pressMenuOpen: () => boolean;
  /** Pages run across and the page fits the pane top to bottom, so ↑ and ↓ cannot scroll. */
  rowFitsPane: () => boolean;
}

/**
 * What to do. `none` takes the key and does nothing more: a crop holds
 * Delete back from the picture, and the clipboard has already acted.
 */
export type KeyAction =
  | "undo"
  | "redo"
  | "keep-crop"
  | "drop-crop"
  | "none"
  | "close-menu"
  | "delete-image"
  | "deselect-image"
  | "delete-selection"
  | "clear-selection"
  | "next-page"
  | "previous-page"
  | "scroll-down"
  | "scroll-up"
  | { tool: ActiveTool };

export interface KeyOutcome {
  action: KeyAction;
  /** Whether the browser's own handling of the key is to be cancelled. */
  preventDefault: boolean;
}

/** A letter for each tool, pressed on its own; either case. */
export const TOOL_KEYS: ReadonlyMap<string, ActiveTool> = new Map<string, ActiveTool>([
  ["p", "pen"],
  ["h", "highlighter"],
  ["e", "eraser"],
  ["v", "select"],
  ["s", "shape"],
  ["t", "text"],
]);

/** The action `chord` stands for on this `scene`, or null when the surface has no use for it. */
export function keyOutcome(chord: KeyChord, scene: KeyScene): KeyOutcome | null {
  const { key } = chord;
  const command = chord.metaKey || chord.ctrlKey;
  // Page and arrow keys, and tool letters, only count on their own.
  const bare = !command && !chord.altKey;
  const erase = key === "Delete" || key === "Backspace";
  const escape = key === "Escape";
  const cancelling = (action: KeyAction): KeyOutcome => ({ action, preventDefault: true });
  const passing = (action: KeyAction): KeyOutcome => ({ action, preventDefault: false });

  if (command && key.toLowerCase() === "z") return cancelling(chord.shiftKey ? "redo" : "undo");

  if (scene.cropping) {
    if (key === "Enter") return cancelling("keep-crop");
    if (escape) return cancelling("drop-crop");
    if (erase) return passing("none");
  }

  const clipboardChord = command && !chord.altKey && !chord.shiftKey;
  if (clipboardChord && !scene.editingText() && scene.clipboard()) return passing("none");

  if (escape && scene.menuOpen()) return passing("close-menu");
  if (erase && scene.imageSelected()) return cancelling("delete-image");
  if (escape && scene.imageSelected()) return passing("deselect-image");
  if (erase && scene.groupSelected()) return cancelling("delete-selection");
  if (escape && (scene.groupSelected() || scene.pressMenuOpen())) return passing("clear-selection");

  if (bare && (key === "PageDown" || key === "PageUp")) {
    return cancelling(key === "PageDown" ? "next-page" : "previous-page");
  }
  if (bare && (key === "ArrowDown" || key === "ArrowUp")) {
    const down = key === "ArrowDown";
    if (scene.rowFitsPane()) return cancelling(down ? "next-page" : "previous-page");
    return cancelling(down ? "scroll-down" : "scroll-up");
  }

  const tool = bare ? TOOL_KEYS.get(key.toLowerCase()) : undefined;
  return tool ? passing({ tool }) : null;
}
