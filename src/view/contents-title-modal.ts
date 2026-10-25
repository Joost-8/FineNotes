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
 * so typing starts the title at once; an empty field adds "Page N". For a
 * heading inside a page (a section), the note says where it is listed and
 * the fallback is "Section on page N". It only hands back the title; the
 * host applies it as an undoable command.
 */

import { type App, Modal } from "obsidian";
import { MAX_PAGE_TITLE_LENGTH, normalizePageTitle } from "../model/contents";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { type SpellingFix, SpellingRows } from "./spelling-row";

export class ContentsTitleModal extends Modal {
  private readonly keyboard: DialogKeyboard;
  /** The title field, once open; and whether the user has typed in it. */
  private field: HTMLInputElement | null = null;
  private fieldRow: HTMLElement | null = null;
  private typed = false;

  constructor(
    app: App,
    /** Zero-based index of the page being titled. */
    private readonly index: number,
    /** Its title now; `undefined` when it is not in the contents yet. */
    private readonly current: string | undefined,
    private readonly submit: (title: string) => void,
    /** A heading inside the page, listed with its page's other headings, rather than the page itself. */
    private readonly section = false,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    const renaming = this.current !== undefined;
    const fallback = this.section ? `Section on page ${this.index + 1}` : `Page ${this.index + 1}`;
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-contents-modal");
    this.titleEl.setText(renaming ? "Rename in contents" : "Add to contents");
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    body.createDiv({
      cls: "goodobsidian-ask-note",
      text: this.section
        ? "Listed in the Contents tab with its page, and marked by a ribbon in the margin."
        : "Listed in the Contents tab of the page sidebar, where it starts a section.",
    });
    const row = body.createDiv({ cls: "goodobsidian-contents-field-row" });
    const field = row.createEl("input", {
      cls: "goodobsidian-contents-field",
      type: "text",
      attr: {
        placeholder: fallback,
        "aria-label": this.section
          ? `Title for a section on page ${this.index + 1}`
          : `Title for page ${this.index + 1}`,
        maxlength: String(MAX_PAGE_TITLE_LENGTH),
        enterkeyhint: "done",
        autocomplete: "off",
      },
    });
    field.value = this.current ?? "";
    this.field = field;
    this.fieldRow = row;
    const count = row.createDiv({ cls: "goodobsidian-contents-count" });
    const updateCount = (): void => {
      count.setText(`${field.value.length}/${MAX_PAGE_TITLE_LENGTH}`);
    };
    this.updateCount = updateCount;
    updateCount();
    field.addEventListener("input", () => {
      this.typed = true;
      updateCount();
    });
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
    onEnterKey(field, finish);

    field.focus();
    field.select();
  }

  private updateCount: () => void = () => {};

  /**
   * A title read from the heading's ink, which arrives after the dialog
   * opens: it fills the field, selected so typing replaces it, unless the
   * user has typed already or the dialog is renaming. `fixes`: words the
   * ink may say otherwise, offered under the field (spelling-row.ts).
   */
  suggest(title: string, fixes: readonly SpellingFix[] = []): void {
    const field = this.field;
    const text = normalizePageTitle(title);
    if (!field || this.typed || this.current !== undefined || text === undefined) return;
    field.value = text.slice(0, MAX_PAGE_TITLE_LENGTH);
    this.updateCount();
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
