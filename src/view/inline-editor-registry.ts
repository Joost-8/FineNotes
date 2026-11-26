/**
 * Which handwriting block is being edited in place (`embed-inline-editor.ts`),
 * and closing it from wherever its block goes away: the embed taken down by
 * Live Preview (a long scroll, the cursor on its line, the tab closed), the
 * embeds' component, the plugin itself. One block is edited at a time.
 *
 * Pure: no DOM beyond the element a block lives in, no Obsidian.
 */

export interface InlineEditorHandle {
  /** The block's element the editor is mounted in. */
  readonly hostSlot: HTMLElement;
  /**
   * Save, then take the editor down. False when the save failed and the
   * editor stayed open; `force` takes it down even then (its block is gone).
   */
  close(force?: boolean): Promise<boolean>;
}

let active: InlineEditorHandle | null = null;

/** The editor open now, if any. */
export function activeInlineEditor(): InlineEditorHandle | null {
  return active;
}

/** `editor` is the one open now. */
export function claimInlineEditor(editor: InlineEditorHandle): void {
  active = editor;
}

/** `editor` has closed; nothing is open unless another has claimed since. */
export function releaseInlineEditor(editor: InlineEditorHandle): void {
  if (active === editor) active = null;
}

/**
 * Make room for an editor over `slot`: close the one open over another
 * block. False when there is one over `slot` already, or the open one could
 * not save and stays open over a block still on screen; an editor whose
 * block is gone is always taken down.
 */
export async function makeRoomFor(slot: HTMLElement): Promise<boolean> {
  for (;;) {
    const open = active;
    if (!open) return true;
    if (open.hostSlot === slot) return false;
    const ok = await open.close(!open.hostSlot.isConnected);
    // Closed, or another editor claimed meanwhile: look again.
    if (!ok && active === open) return false;
  }
}

/**
 * The block `slot` is going away: its editor saves and closes, whether the
 * save worked or not (a Notice has said so), so nothing it holds outlives it.
 */
export function closeInlineEditorIn(slot: HTMLElement): Promise<boolean> {
  const open = active;
  if (!open || open.hostSlot !== slot) return Promise.resolve(true);
  return open.close(true);
}

/** Close any editor open (the plugin unloading). */
export function closeAnyInlineEditor(): Promise<boolean> {
  return active ? active.close(true) : Promise.resolve(true);
}
