/**
 * The fast way beside the slow way: a menu entry that also has a key says
 * so, in its tooltip and at the end of its row, so the menu teaches the
 * key. PURE: which entries have one, and how the key reads on this device
 * (the user's own shortcut table, so a key they changed is the key shown).
 */

import { type ShortcutTable, inputText } from "./shortcut-bindings";

/** Menu entries (by their id in the selection bar, press menu and More panel) and their shortcut rows. */
export const FAST_WAY_SHORTCUTS: Readonly<Record<string, string>> = {
  cut: "edit.cut",
  copy: "edit.copy",
  paste: "edit.paste",
  delete: "edit.delete",
  "select-all": "edit.select-all",
  "to-text": "edit.turn-into-text",
  shortcuts: "view.shortcuts",
};

/**
 * The key for a menu entry as this device has it, e.g. "Ctrl + C"; null
 * when the entry has no key, the user took it away, or two rows share it
 * (a shared key does nothing).
 */
export function fastKeys(
  menuId: string,
  table: ShortcutTable | null,
  apple: boolean,
): string | null {
  const actionId = FAST_WAY_SHORTCUTS[menuId];
  if (!actionId || !table) return null;
  const row = table.rows.find((r) => r.action.id === actionId);
  if (!row || row.conflicted) return null;
  // A key, never a pen button: the hint is for a hand on the keyboard.
  const input = row.inputs.find((i) => i.type === "key");
  return input ? inputText(input, apple) : null;
}

/** A label with its key after it, as the toolbar's tooltips read: "Copy (Ctrl + C)". */
export function withKeys(label: string, keys: string | null): string {
  return keys ? `${label} (${keys})` : label;
}
