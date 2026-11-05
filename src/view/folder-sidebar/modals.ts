/**
 * The Folders sidebar's small windows: choosing a folder's colour, asking
 * for a name, confirming a delete, and picking the folder to move notes to.
 */

import { type App, FuzzySuggestModal, Modal, Notice, type TFolder, normalizePath } from "obsidian";
import {
  DEFAULT_CUSTOM_COLOR,
  FOLDER_PALETTE,
  isHexColor,
  isPaletteColor,
  normalizeHex,
  typedHex,
} from "../../model/folder-colors";
import { hasPathSeparator, isRootPath, childPath, parentPath } from "../../model/folder-paths";
import { t, tn } from "../../i18n/translate";
import { errorMessage } from "../../util/errors";
import type { FolderSidebarController } from "./controller";

/** A button made of a div: Obsidian restyles real buttons, and on the iPad pads each by 20 px. */
function addButton(
  parent: HTMLElement,
  label: string,
  cls: string,
  onClick: () => void,
): HTMLElement {
  const button = parent.createDiv({
    cls: `fs-modal-btn ${cls}`.trim(),
    text: label,
    attr: { role: "button", tabindex: "0" },
  });
  button.addEventListener("click", onClick);
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  });
  return button;
}

/** The translated name of a palette colour. */
function paletteName(id: (typeof FOLDER_PALETTE)[number]["id"]): string {
  switch (id) {
    case "rose":
      return t("view.folders.color.rose");
    case "amber":
      return t("view.folders.color.amber");
    case "moss":
      return t("view.folders.color.moss");
    case "tide":
      return t("view.folders.color.tide");
    case "plum":
      return t("view.folders.color.plum");
  }
}

/** Choose a folder's colour: none, the palette, one used lately, or any hex colour. */
export class FolderColorModal extends Modal {
  private applied = false;
  private readonly chosen: string | null;
  private picker!: HTMLInputElement;
  private hex!: HTMLInputElement;

  constructor(
    app: App,
    private readonly controller: FolderSidebarController,
    private readonly folder: TFolder,
  ) {
    super(app);
    this.chosen = controller.getFolderColor(folder.path);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fs-color-modal");
    this.titleEl.setText(t("view.folders.colorFor", { name: this.folder.name }));
    const swatches = contentEl.createDiv({ cls: "fs-swatches" });
    this.addSwatch(swatches, t("view.folders.color.none"), null);
    for (const entry of FOLDER_PALETTE)
      this.addSwatch(swatches, paletteName(entry.id), entry.color);
    const recent = this.controller.data.recentColors;
    if (recent.length > 0) {
      contentEl.createDiv({ cls: "fs-modal-label", text: t("view.folders.color.yours") });
      const row = contentEl.createDiv({ cls: "fs-swatches" });
      for (const color of recent) this.addSwatch(row, color, color);
    }
    contentEl.createDiv({ cls: "fs-modal-label", text: t("view.folders.color.any") });
    const custom = contentEl.createDiv({ cls: "fs-custom-row" });
    this.picker = custom.createEl("input", {
      cls: "fs-color-input",
      attr: { type: "color", "aria-label": t("view.folders.color.pick") },
    });
    this.picker.value =
      this.chosen && isHexColor(this.chosen) ? normalizeHex(this.chosen) : DEFAULT_CUSTOM_COLOR;
    this.hex = custom.createEl("input", {
      cls: "fs-hex-input",
      attr: {
        type: "text",
        placeholder: "#rrggbb",
        "aria-label": t("view.folders.color.hex"),
        maxlength: "7",
        autocapitalize: "off",
        spellcheck: "false",
      },
    });
    this.hex.value = this.picker.value;
    this.picker.addEventListener("input", () => {
      this.hex.value = this.picker.value;
      this.preview(this.picker.value);
    });
    this.hex.addEventListener("input", () => {
      const typed = typedHex(this.hex.value);
      if (!isHexColor(typed)) return;
      this.picker.value = normalizeHex(typed);
      this.preview(normalizeHex(typed));
    });
    this.hex.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      this.applyCustom();
    });
    const buttons = contentEl.createDiv({ cls: "fs-modal-buttons" });
    addButton(buttons, t("common.cancel"), "", () => this.close());
    addButton(buttons, t("view.folders.color.apply"), "is-primary", () => this.applyCustom());
  }

  private addSwatch(parent: HTMLElement, label: string, color: string | null): void {
    const swatch = parent.createDiv({
      cls: color ? "fs-swatch" : "fs-swatch is-none",
      attr: { role: "button", tabindex: "0", title: label, "aria-label": label },
    });
    if (color) swatch.setCssStyles({ backgroundColor: color });
    if (color === this.chosen) swatch.addClass("is-current");
    const choose = (): void => this.commit(color);
    swatch.addEventListener("click", choose);
    swatch.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      choose();
    });
  }

  private applyCustom(): void {
    const typed = typedHex(this.hex.value);
    if (!isHexColor(typed)) {
      new Notice(t("view.folders.color.invalid"));
      return;
    }
    this.commit(normalizeHex(typed));
  }

  private commit(color: string | null): void {
    this.applied = true;
    if (color) {
      this.controller.setFolderColor(this.folder.path, color);
      if (!isPaletteColor(color)) this.controller.addRecentColor(color);
    } else {
      this.controller.clearFolderColor(this.folder.path);
    }
    this.close();
  }

  /** Show the colour on the folder's rows in the sidebar while it is being chosen. */
  private preview(color: string): void {
    activeDocument
      .querySelectorAll<HTMLElement>(".folder-sidebar-root .fs-item[data-path]")
      .forEach((row) => {
        if (row.getAttribute("data-path") !== this.folder.path) return;
        row.addClass("has-color");
        row.setCssProps({ "--fs-color": color });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
    // Closed without choosing: the sidebar goes back to the colour it had.
    if (!this.applied) this.controller.notifyDataChanged();
  }
}

/** Ask for one line of text. */
export class PromptModal extends Modal {
  private done = false;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly initial: string,
    private readonly confirmLabel: string,
    private readonly onSubmit: (value: string) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fs-prompt-modal");
    this.titleEl.setText(this.heading);
    const input = contentEl.createEl("input", {
      cls: "fs-prompt-input",
      attr: { type: "text", "aria-label": this.heading },
    });
    input.value = this.initial;
    const submit = (): void => {
      if (this.done) return;
      const value = input.value.trim();
      if (!value) return;
      this.done = true;
      this.close();
      this.onSubmit(value);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      submit();
    });
    const buttons = contentEl.createDiv({ cls: "fs-modal-buttons" });
    addButton(buttons, t("common.cancel"), "", () => this.close());
    addButton(buttons, this.confirmLabel, "is-primary", submit);
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Ask for a new name for `folder` and rename it. */
export function promptRenameFolder(app: App, folder: TFolder): void {
  new PromptModal(app, t("view.folders.renameTitle"), folder.name, t("common.rename"), (name) => {
    if (name === folder.name) return;
    if (hasPathSeparator(name)) {
      new Notice(t("view.folders.nameInvalid"));
      return;
    }
    const target = normalizePath(childPath(parentPath(folder.path), name));
    app.fileManager.renameFile(folder, target).catch((error: unknown) => {
      new Notice(t("view.folders.renameFailed", { reason: errorMessage(error) }));
    });
  }).open();
}

/** Ask before a folder and everything in it goes to the trash. */
export class DeleteFolderModal extends Modal {
  constructor(
    app: App,
    private readonly folder: TFolder,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(t("view.folders.deleteTitle"));
    contentEl.createEl("p", { text: t("view.folders.deleteBody", { name: this.folder.name }) });
    const buttons = contentEl.createDiv({ cls: "fs-modal-buttons" });
    addButton(buttons, t("common.cancel"), "", () => this.close());
    addButton(buttons, t("common.delete"), "is-danger", () => {
      this.close();
      this.app.fileManager.trashFile(this.folder).catch((error: unknown) => {
        new Notice(t("view.folders.deleteFailed", { reason: errorMessage(error) }));
      });
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Pick the folder selected notes are moved to. */
export class MoveToFolderModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private readonly folders: TFolder[],
    private readonly choose: (folder: TFolder) => void,
  ) {
    super(app);
    this.setPlaceholder(t("view.folders.moveTo"));
  }

  override getItems(): TFolder[] {
    return this.folders;
  }

  override getItemText(folder: TFolder): string {
    return isRootPath(folder.path) ? "/" : folder.path;
  }

  override onChooseItem(folder: TFolder): void {
    this.choose(folder);
  }
}

/** Ask before the selected notes go to the trash. */
export class DeleteNotesModal extends Modal {
  constructor(
    app: App,
    private readonly count: number,
    private readonly confirm: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(tn("view.folders.deleteNotesTitle", this.count));
    contentEl.createEl("p", { text: t("view.folders.deleteNotesBody") });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    this.addAction(buttons, t("common.cancel"), "fl-modal-btn", () => this.close());
    this.addAction(buttons, t("common.delete"), "fl-modal-btn mod-warning", () => {
      this.close();
      this.confirm();
    });
  }

  private addAction(parent: HTMLElement, label: string, cls: string, onClick: () => void): void {
    const button = parent.createDiv({
      cls,
      text: label,
      attr: { role: "button", tabindex: "0", "aria-label": label, title: label },
    });
    button.addEventListener("click", onClick);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onClick();
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
