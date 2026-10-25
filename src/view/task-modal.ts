/**
 * Asks what a handwritten checklist item says (2.5): Turn into › Task on a
 * lasso selection, or Edit task on one. The words fill in from the ink as
 * the device reads it, so usually the answer is one tap.
 *
 *   Make a task
 *   A box goes beside the ink, and the task is listed in the note, where
 *   Obsidian's Tasks plugin finds it.
 *   [ Buy milk                      ]
 *                    [Cancel] [Add]
 *
 * Built like the contents title dialog (`contents-title-modal.ts`): it only
 * hands back the text; the host applies it as an undoable command.
 */

import { type App, Modal } from "obsidian";
import { MAX_TASK_TEXT, normalizeTaskText } from "../model/tasks";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { type SpellingFix, SpellingRows } from "./spelling-row";

export class TaskModal extends Modal {
  private readonly keyboard: DialogKeyboard;
  private field: HTMLInputElement | null = null;
  private fieldRow: HTMLElement | null = null;
  private typed = false;

  constructor(
    app: App,
    /** Its text now; `undefined` for a new task. */
    private readonly current: string | undefined,
    private readonly submit: (text: string) => void,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    const editing = this.current !== undefined;
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-contents-modal");
    this.titleEl.setText(editing ? "Edit task" : "Make a task");
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    body.createDiv({
      cls: "goodobsidian-ask-note",
      text: "A box goes beside the ink, and the task is listed in the note, where the Tasks plugin finds it.",
    });
    const row = body.createDiv({ cls: "goodobsidian-contents-field-row" });
    const field = row.createEl("input", {
      cls: "goodobsidian-contents-field",
      type: "text",
      attr: {
        placeholder: "What to do",
        "aria-label": "Task",
        maxlength: String(MAX_TASK_TEXT),
        enterkeyhint: "done",
        autocomplete: "off",
      },
    });
    field.value = this.current ?? "";
    this.field = field;
    this.fieldRow = row;
    field.addEventListener("input", () => {
      this.typed = true;
    });
    this.keyboard.watch(field, row);

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const done = actions.createEl("button", { cls: "mod-cta", text: editing ? "Save" : "Add" });
    const finish = (): void => {
      const text = normalizeTaskText(field.value);
      this.close();
      if (text !== this.current) this.submit(text);
    };
    done.addEventListener("click", finish);
    onEnterKey(field, finish);

    field.focus();
    field.select();
  }

  /**
   * The words read from the ink, which arrive after the dialog opens: they
   * fill the field, selected so typing replaces them, unless the user has
   * typed already or is editing. `fixes`: words the ink may say otherwise.
   */
  suggest(text: string, fixes: readonly SpellingFix[] = []): void {
    const field = this.field;
    const words = normalizeTaskText(text);
    if (!field || this.typed || this.current !== undefined || words === "") return;
    field.value = words;
    field.select();
    if (fixes.length > 0 && this.fieldRow) new SpellingRows(this.fieldRow, field, fixes);
  }

  override onClose(): void {
    this.field = null;
    this.fieldRow = null;
    this.keyboard.end();
    this.contentEl.empty();
  }
}
