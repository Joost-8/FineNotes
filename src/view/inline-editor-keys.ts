/**
 * Which keys finish a block being written in place (`embed-inline-editor.ts`):
 * Esc and Mod+Enter, pressed in the block, when nothing else in it or over
 * it wants them. Everything else goes on to Obsidian and the other panes:
 * the note's own text, another notebook, a popover's Esc, a text box.
 *
 * Pure: facts about the key in, a verdict out.
 */

export interface InlineKeyFacts {
  key: string;
  /** Cmd on macOS and iPadOS, Ctrl elsewhere. */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Someone has already handled it. */
  prevented: boolean;
  /** An input method is composing. */
  composing: boolean;
  /** A dialog or a menu is open: its keys are its own. */
  modalOpen: boolean;
  /** The key was pressed in the block (focus is inside it). */
  inside: boolean;
  /** In a field that types (a text box, a table cell, an equation). */
  editable: boolean;
  /** One of the block's popovers is open: its Esc closes it. */
  popoverOpen: boolean;
}

/**
 * - `"pass"`: not the block's; Obsidian and the page go on as if it were not there.
 * - `"surface"`: Esc, for the surface first (a selection, a tool it is in the
 *   middle of); the block finishes only if the surface had nothing to leave.
 * - `"finish"`: save and close the block.
 */
export type InlineKeyVerdict = "pass" | "surface" | "finish";

export function inlineKeyVerdict(f: InlineKeyFacts): InlineKeyVerdict {
  if (f.prevented || f.composing || f.modalOpen || !f.inside || f.editable) return "pass";
  if (f.key === "Enter" && f.mod && !f.shift && !f.alt) return "finish";
  if (f.key === "Escape" && !f.mod && !f.shift && !f.alt) {
    return f.popoverOpen ? "pass" : "surface";
  }
  return "pass";
}
