/**
 * The dialogs around FineNotes templates (`import/template-package.ts`):
 *
 * - "Save as template": name, author, description, version and licence for
 *   the notebook being saved as a `.finetemplate` file;
 * - "New notebook from template": the template files in the vault;
 * - the gallery: the templates a gallery index lists, each installable.
 *
 * Saving, downloading and importing are the host's; these only ask.
 */

import { type App, FuzzySuggestModal, Modal, Setting, type TFile } from "obsidian";
import {
  type GalleryEntry,
  TEMPLATE_EXTENSION,
  TEMPLATE_LICENCES,
  type TemplateLicence,
} from "../import/template-package";

export interface TemplateDetails {
  name: string;
  author: string;
  description: string;
  version: string;
  licence: TemplateLicence;
}

/** Asks what the template is called and how it may be used, then hands that back. */
export class SaveTemplateModal extends Modal {
  private readonly details: TemplateDetails;

  constructor(
    app: App,
    initial: Partial<TemplateDetails>,
    private readonly save: (details: TemplateDetails) => void,
  ) {
    super(app);
    this.details = {
      name: initial.name ?? "",
      author: initial.author ?? "",
      description: initial.description ?? "",
      version: initial.version ?? "1",
      licence: initial.licence ?? "personal",
    };
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-template-save");
    this.titleEl.setText("Save as template");
    const el = this.contentEl;
    el.createDiv({
      cls: "setting-item-description",
      text:
        "One file holding the notebook and its pictures, to keep or to share. Anyone who opens it " +
        "gets a new notebook of their own.",
    });
    new Setting(el)
      .setName("Name")
      .addText((text) => text.setValue(this.details.name).onChange((v) => (this.details.name = v)));
    new Setting(el).setName("Author").addText((text) =>
      text
        .setPlaceholder("Your name")
        .setValue(this.details.author)
        .onChange((v) => (this.details.author = v)),
    );
    new Setting(el)
      .setName("Description")
      .addTextArea((text) =>
        text.setValue(this.details.description).onChange((v) => (this.details.description = v)),
      );
    new Setting(el)
      .setName("Version")
      .addText((text) =>
        text.setValue(this.details.version).onChange((v) => (this.details.version = v)),
      );
    new Setting(el)
      .setName("Licence")
      .setDesc("What others may do with it. Shown to whoever opens it.")
      .addDropdown((dropdown) => {
        for (const l of TEMPLATE_LICENCES) dropdown.addOption(l.id, l.label);
        dropdown
          .setValue(this.details.licence)
          .onChange((v) => (this.details.licence = v as TemplateLicence));
      });
    new Setting(el)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setCta()
          .setButtonText("Save")
          .onClick(() => {
            if (!this.details.name.trim()) return;
            this.close();
            this.save({ ...this.details, name: this.details.name.trim() });
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** The `.finetemplate` files in the vault, to start a notebook from. */
export class TemplateFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly choose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("New notebook from template…");
  }

  override getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => file.extension.toLowerCase() === TEMPLATE_EXTENSION)
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }

  override getItemText(file: TFile): string {
    return file.parent && !file.parent.isRoot()
      ? `${file.basename} — ${file.parent.path}`
      : file.basename;
  }

  override onChooseItem(file: TFile): void {
    this.choose(file);
  }
}

/** A gallery's templates: preview, name, author, licence; Install starts a notebook from one. */
export class TemplateGalleryModal extends Modal {
  constructor(
    app: App,
    private readonly entries: readonly GalleryEntry[],
    private readonly install: (entry: GalleryEntry) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-template-gallery");
    this.titleEl.setText("Template gallery");
    const shown = this.entries.filter((entry) => !entry.retired);
    if (shown.length === 0) {
      this.contentEl.createDiv({
        cls: "setting-item-description",
        text: "This gallery lists no templates yet.",
      });
      return;
    }
    const grid = this.contentEl.createDiv({ cls: "goodobsidian-template-grid" });
    for (const entry of shown) {
      const card = grid.createDiv({ cls: "goodobsidian-template-entry" });
      const frame = card.createDiv({ cls: "goodobsidian-template-entry-preview" });
      if (entry.preview)
        frame.createEl("img", { attr: { src: entry.preview, alt: "", loading: "lazy" } });
      card.createDiv({ cls: "goodobsidian-template-entry-name", text: entry.name });
      const meta = [entry.author, `${entry.pages} page${entry.pages === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" · ");
      card.createDiv({ cls: "goodobsidian-template-entry-meta", text: meta });
      const licence = TEMPLATE_LICENCES.find((l) => l.id === entry.licence)?.label ?? "";
      card.createDiv({ cls: "goodobsidian-template-entry-licence", text: licence });
      if (entry.description) {
        card.createDiv({ cls: "goodobsidian-template-entry-desc", text: entry.description });
      }
      const button = card.createEl("button", { cls: "mod-cta", text: "Use template" });
      button.addEventListener("click", () => {
        this.close();
        this.install(entry);
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
