/**
 * Asks what lassoed handwriting says before it becomes a text box
 * (FineNotes#42): Turn into › Text, or the "Turn selection into text"
 * command. The words fill in from the ink as the device reads it, a line
 * for each written line, so usually the answer is one tap or Enter.
 *
 *   Turn into text
 *   [ Buy milk                      ]
 *   [ and eggs                      ]
 *                  [Cancel] [Replace]
 *
 * Built like the task dialog (`task-modal.ts`), with a field of several
 * lines: Enter replaces, Shift+Enter starts a new line. It only hands back
 * the text; the host applies it as an undoable command.
 *
 * KNOWN BUG, unfixed (2026-10-25, Joost on the iPad): the on-screen
 * keyboard's ✓ does not replace. With the reading selected it removes the
 * text and types a new line, and the dialog stays open; Replace works. Three
 * tries in `enter-key.ts` (keydown, beforeinput, then restoring the text
 * from before the press) fixed the one-line dialogs but not this field of
 * several lines; why iOS gets past all three is unknown. Untried: a one-line
 * field here, as the dialogs that work have.
 */

import { type App, Modal } from "obsidian";
import { inkTextLines } from "../model/ink-to-text";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { type SpellingFix, SpellingRows } from "./spelling-row";

/** Longest text a box made from ink takes; a page of writing fits. */
const MAX_INK_TEXT = 4000;

export class InkTextModal extends Modal {
  private readonly keyboard: DialogKeyboard;
  private field: HTMLTextAreaElement | null = null;
  private typed = false;

  constructor(
    app: App,
    private readonly submit: (text: string) => void,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-contents-modal");
    this.titleEl.setText("Turn into text");
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    const field = body.createEl("textarea", {
      cls: "goodobsidian-ask-input",
      attr: {
        placeholder: "What the ink says",
        "aria-label": "Text",
        maxlength: String(MAX_INK_TEXT),
        enterkeyhint: "done",
        autocomplete: "off",
      },
    });
    this.field = field;
    this.keyboard.watch(field, field);

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const done = actions.createEl("button", { cls: "mod-cta", text: "Replace" });
    const sync = (): void => {
      done.disabled = inkTextLines(field.value).length === 0;
    };
    sync();
    field.addEventListener("input", () => {
      this.typed = true;
      sync();
    });
    const finish = (): void => {
      const text = inkTextLines(field.value).join("\n");
      if (text === "") return;
      this.close();
      this.submit(text);
    };
    done.addEventListener("click", finish);
    onEnterKey(field, finish, { shiftNewline: true });
    field.focus();
  }

  /**
   * The words read from the ink, which arrive after the dialog opens: they
   * fill the field, selected so typing replaces them, unless the user has
   * typed already. `fixes`: words the ink may say otherwise.
   */
  suggest(text: string, fixes: readonly SpellingFix[] = []): void {
    const field = this.field;
    const lines = inkTextLines(text);
    if (!field || this.typed || lines.length === 0) return;
    field.value = lines.join("\n");
    field.dispatchEvent(new Event("input"));
    this.typed = false;
    field.select();
    if (fixes.length > 0) new SpellingRows(field, field, fixes);
  }

  override onClose(): void {
    this.field = null;
    this.keyboard.end();
    this.contentEl.empty();
  }
}
