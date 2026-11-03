/** A one-line "Rename" dialog: the current name selected, Return renames. */

import { type App, Modal, Setting } from "obsidian";
import { onEnterKey } from "./enter-key";

export class RenameModal extends Modal {
  private done = false;

  constructor(
    app: App,
    private readonly current: string,
    private readonly onRename: (name: string) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("Rename");
    const input = this.contentEl.createEl("input", {
      type: "text",
      cls: "goodobsidian-rename-input",
      attr: { "aria-label": "Name", enterkeyhint: "done" },
    });
    input.value = this.current;
    onEnterKey(input, () => this.submit(input.value));
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Rename")
        .setCta()
        .onClick(() => this.submit(input.value)),
    );
    // Not on a tablet: the keyboard would cover the dialog before it was asked for.
    if (!window.matchMedia("(pointer: coarse)").matches) {
      input.focus();
      input.select();
    }
  }

  private submit(name: string): void {
    if (this.done) return;
    this.done = true;
    this.close();
    this.onRename(name);
  }
}
