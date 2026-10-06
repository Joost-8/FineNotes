/**
 * Asks for a page's title in the notebook's contents: "Add to contents" for
 * a page not listed yet, "Rename in contents" for one that is.
 *
 *   Add to contents
 *   Listed in the Contents tab of the page sidebar, where it starts a section.
 *   [ Page 16                       ]
 *                              12/80
 *                    [Cancel] [Add]
 *
 * The field starts empty for a new entry, with "Page N" as its placeholder,
 * so typing starts the title at once; an empty field adds "Page N". It only
 * hands back the title; the host applies it as an undoable command.
 */

import { type App, Modal } from "obsidian";
import { MAX_PAGE_TITLE_LENGTH, normalizePageTitle } from "../model/contents";
import { DialogKeyboard } from "./dialog-keyboard";

export class ContentsTitleModal extends Modal {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    /** Zero-based index of the page being titled. */
    private readonly index: number,
    /** Its title now; `undefined` when it is not in the contents yet. */
    private readonly current: string | undefined,
    private readonly submit: (title: string) => void,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    const renaming = this.current !== undefined;
    const fallback = `Page ${this.index + 1}`;
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-contents-modal");
    this.titleEl.setText(renaming ? "Rename in contents" : "Add to contents");
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    body.createDiv({
      cls: "goodobsidian-ask-note",
      text: "Listed in the Contents tab of the page sidebar, where it starts a section.",
    });
    const row = body.createDiv({ cls: "goodobsidian-contents-field-row" });
    const field = row.createEl("input", {
      cls: "goodobsidian-contents-field",
      type: "text",
      attr: {
        placeholder: fallback,
        "aria-label": `Title for page ${this.index + 1}`,
        maxlength: String(MAX_PAGE_TITLE_LENGTH),
        enterkeyhint: "done",
        autocomplete: "off",
      },
    });
    field.value = this.current ?? "";
    const count = row.createDiv({ cls: "goodobsidian-contents-count" });
    const updateCount = (): void => {
      count.setText(`${field.value.length}/${MAX_PAGE_TITLE_LENGTH}`);
    };
    updateCount();
    field.addEventListener("input", updateCount);
    this.keyboard.watch(field, row);

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const done = actions.createEl("button", {
      cls: "mod-cta",
      text: renaming ? "Save" : "Add",
    });
    const finish = (): void => {
      const title = normalizePageTitle(field.value) ?? fallback;
      this.close();
      if (title !== this.current) this.submit(title);
    };
    done.addEventListener("click", finish);
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      finish();
    });

    field.focus();
    field.select();
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }
}
