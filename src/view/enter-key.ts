/**
 * Return in a dialog's field: confirm the dialog, and never type a line
 * break over its text.
 *
 * On the iPad, the keyboard's Return (drawn as ✓ for `enterkeyhint="done"`)
 * pressed while the field's text was selected — the reading a lassoed
 * dialog fills in, selected so typing replaces it — wiped the text and
 * confirmed nothing (FineNotes#42, Joost on device). A `keydown` handler
 * alone missed it: iPadOS can report that Return as part of a composition
 * (`isComposing`, keyCode 229), or not as an Enter keydown at all, and then
 * types the line break. So this listens at three points, and the first
 * that sees the press confirms it, once:
 *
 * 1. a `keydown` of Enter that is not composing;
 * 2. a `beforeinput` that would type a line break (`insertLineBreak`,
 *    `insertParagraph`, or text holding one), cancelled;
 * 3. an `input` that typed a line break anyway: in a field of several
 *    lines the ✓ still did (Joost, the same day) though the other dialogs'
 *    one-line fields were fixed by 1 and 2.
 *
 * Whichever sees it, the field's text is put back as it was before the
 * press. Joost's recording showed the ✓ over a selected word that iOS
 * offered corrections for ("What": Wat, Wrat): the word was removed first,
 * as an edit of its own, and only then the line break typed, so "before
 * the line break" was already empty. Before the press means the text at
 * the Return keydown, or before a removal just ahead of the break.
 *
 * Pasted text keeps its lines, and an input method's own Return, which
 * confirms its characters, types no line break, so it still does only that.
 */

/** The parts of a keydown this reads. */
interface KeyLike {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  preventDefault(): void;
}

/** The parts of a beforeinput or input this reads; a script's own `new Event("input")` has neither field. */
interface InputLike {
  inputType?: string;
  data?: string | null;
  preventDefault(): void;
}

/** A field: anything that sends the events, with the text it holds. */
export interface EnterField {
  addEventListener: EventTarget["addEventListener"];
  value: string;
}

const lineBreaks = (text: string): number => text.split("\n").length - 1;

/**
 * How soon after a removal a line break counts as the same ✓: the iPad
 * sends the two back to back. Long enough for that, too short for a person
 * to delete and then reach the key.
 */
const REMOVAL_MS = 250;

/** Whether an input event, by its own account, types a line break that is not pasted or dropped. */
function typesBreak(input: InputLike): boolean {
  const type = input.inputType ?? "";
  if (type === "insertLineBreak" || type === "insertParagraph") return true;
  return !type.startsWith("insertFrom") && (input.data ?? "").includes("\n");
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
  field: EnterField,
  confirm: () => void,
  options: { shiftNewline?: boolean; keydownHandled?: boolean } = {},
): void {
  /** What this press already did: confirmed, or asked for a line break (Shift+Return). */
  let handled: "confirmed" | "newline" | null = null;
  /** The field's text before the change now under way, and after the last one. */
  let before: string | null = null;
  let last = field.value;
  /** The text when Return went down, composing or not: before iPadOS takes the selected word away. */
  let atReturn: string | null = null;
  /** The text before a removal just now, and when: the ✓ removes the selection, then types the break. */
  let removed: { text: string; at: number } | null = null;

  /** What the field said before this press touched it. */
  const pressStart = (fallback: string): string => {
    if (atReturn !== null) return atReturn;
    if (removed && Date.now() - removed.at <= REMOVAL_MS) return removed.text;
    return fallback;
  };

  /** Put the field's text back as it was before the press, then confirm, once. */
  const confirmPress = (fallback: string): void => {
    const text = pressStart(fallback);
    if (field.value !== text) field.value = text;
    // A line break typed after all (an event iOS would not cancel) is taken back to this.
    before = text;
    last = text;
    atReturn = null;
    removed = null;
    if (handled !== "confirmed") confirm();
    handled = "confirmed";
  };

  field.addEventListener("keydown", (event) => {
    const key = event as unknown as KeyLike;
    handled = null;
    atReturn = key.key === "Enter" ? field.value : null;
    if (key.key !== "Enter" || key.isComposing) return;
    if (options.shiftNewline && key.shiftKey) {
      handled = "newline";
      atReturn = null;
      return;
    }
    handled = "confirmed";
    if (options.keydownHandled) return;
    key.preventDefault();
    atReturn = null;
    confirm();
  });

  field.addEventListener("beforeinput", (event) => {
    const input = event as unknown as InputLike;
    before = field.value;
    if (!typesBreak(input) || handled === "newline") return;
    input.preventDefault();
    confirmPress(field.value);
  });

  field.addEventListener("input", (event) => {
    const input = event as unknown as InputLike;
    const was = before ?? last;
    before = null;
    const type = input.inputType;
    const broke =
      type !== undefined &&
      !type.startsWith("insertFrom") &&
      (typesBreak(input) || lineBreaks(field.value) > lineBreaks(was));
    if (!broke || handled === "newline") {
      // Typing ends the press: a later Return with no keydown is a new one.
      if (type !== undefined) handled = null;
      removed =
        type !== undefined && !broke && field.value.length < was.length
          ? { text: was, at: Date.now() }
          : null;
      last = field.value;
      return;
    }
    // The ✓ typed a line break after all: take it back, and confirm.
    confirmPress(was);
    before = null;
    handled = null;
  });
}
