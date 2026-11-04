/** A one-line "Rename" dialog: the current name selected, Return renames. */

import { type App, Modal, Platform, Setting } from "obsidian";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";

export class RenameModal extends Modal {
  private done = false;
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly current: string,
    private readonly onRename: (name: string) => void,
    private readonly heading = "Rename",
    private readonly action = "Rename",
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl("input", {
      type: "text",
      cls: "goodobsidian-rename-input",
      attr: { "aria-label": "Name", enterkeyhint: "done" },
    });
    input.value = this.current;
    onEnterKey(input, () => this.submit(input.value));
    // The dialog rises above the on-screen keyboard while the field has focus.
    this.keyboard.watch(input, input);
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText(this.action)
        .setCta()
        .onClick(() => this.submit(input.value)),
    );
    // Not on a phone or tablet: the keyboard comes up when the field is tapped.
    if (!Platform.isMobile) {
      input.focus();
      input.select();
    }
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }

  private submit(name: string): void {
    if (this.done) return;
    this.done = true;
    this.close();
    this.onRename(name);
  }
}
