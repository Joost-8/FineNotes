/**
 * Enter (or replace) one API key. The settings tab never shows a stored key —
 * it says "Set" or "Not set" — so this modal is the only place a key is typed,
 * and it starts empty every time.
 */

import { type App, Modal, Setting } from "obsidian";

export interface ApiKeyModalOptions {
  title: string;
  placeholder: string;
  /** One sentence on where the key will be kept. */
  where: string;
  onSave: (key: string) => void;
}

export class ApiKeyModal extends Modal {
  constructor(
    app: App,
    private readonly options: ApiKeyModalOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.titleEl.setText(this.options.title);
    this.contentEl.addClass("goodobsidian-key-modal");
    this.contentEl.createEl("p", { cls: "goodobsidian-key-where", text: this.options.where });

    const input = this.contentEl.createEl("input", {
      cls: "goodobsidian-key-input",
      type: "password",
      placeholder: this.options.placeholder,
    });
    // A key is not a word: no autocorrect, capitals or password-manager guesses.
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    input.setAttribute("aria-label", this.options.title);

    const save = (): void => {
      const key = input.value.trim();
      if (!key) {
        input.focus();
        return;
      }
      input.value = "";
      this.close();
      this.options.onSave(key);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
    });

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Save").setCta().onClick(save));

    window.setTimeout(() => input.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
