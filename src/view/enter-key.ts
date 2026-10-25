/**
 * Return in a dialog's field: confirm the dialog, and never type a line
 * break over its text.
 *
 * On the iPad, the keyboard's Return (drawn as ✓ for `enterkeyhint="done"`)
 * pressed while the field's text was selected — the reading a lassoed
 * dialog fills in, selected so typing replaces it — wiped the text and
 * confirmed nothing (FineNotes#42, Joost on device). A `keydown` handler
 * alone missed it: iPadOS can report that Return as part of a composition
 * (`isComposing`, keyCode 229), which the handlers rightly skip, and then
 * inserts the line break over the selection. Which of the two it was is
 * unproven; both are covered. The line break always comes as a
 * `beforeinput` of `insertLineBreak` or `insertParagraph`, which this
 * cancels and takes as the Return, whatever the `keydown` said. An input
 * method's own Return, which confirms its characters, is a composition
 * event, not a line break, so it still does only that.
 */

/** The parts of a keydown this reads. */
interface KeyLike {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  preventDefault(): void;
}

/** The parts of a beforeinput this reads. */
interface InputLike {
  inputType: string;
  preventDefault(): void;
}

/**
 * Run `confirm` on Return in `field`, once per press.
 *
 * - `shiftNewline` (a field of several lines): Shift+Return types a line
 *   break instead.
 * - `keydownHandled` (Obsidian's search list, whose own keymap takes a
 *   plain Return): only the Return that arrives as a line break is this
 *   one's to confirm.
 */
export function onEnterKey(
  field: Pick<EventTarget, "addEventListener">,
  confirm: () => void,
  options: { shiftNewline?: boolean; keydownHandled?: boolean } = {},
): void {
  /** The press's keydown confirmed already, or asked for a line break: its beforeinput is not a second Return. */
  let handled: "confirmed" | "newline" | null = null;
  field.addEventListener("keydown", (event) => {
    const key = event as unknown as KeyLike;
    handled = null;
    if (key.key !== "Enter" || key.isComposing) return;
    if (options.shiftNewline && key.shiftKey) {
      handled = "newline";
      return;
    }
    handled = "confirmed";
    if (options.keydownHandled) return;
    key.preventDefault();
    confirm();
  });
  field.addEventListener("beforeinput", (event) => {
    const input = event as unknown as InputLike;
    if (input.inputType !== "insertLineBreak" && input.inputType !== "insertParagraph") return;
    const was = handled;
    handled = null;
    if (was === "newline") return;
    input.preventDefault();
    if (was !== "confirmed") confirm();
  });
}
