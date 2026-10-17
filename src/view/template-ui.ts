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

import { type App, FuzzySuggestModal, Modal, Notice, Setting, type TFile } from "obsidian";
import {
  SHARE_CATEGORIES,
  type ShareDetails,
  shareProblems,
  submissionUrl,
} from "../model/gallery-share";
import {
  GALLERY_CATEGORIES,
  type GalleryEntry,
  TEMPLATE_EXTENSION,
  galleryMatches,
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
  private query = "";
  private category = "all";
  private listEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly entries: readonly GalleryEntry[],
    private readonly install: (entry: GalleryEntry) => void,
    /** Open a creator's shop, for a template sold there. */
    private readonly openShop: (url: string) => void = (url) => window.open(url),
    /** The gallery closed, after an install or without one. */
    private readonly onClosed?: () => void,
    /** Share one of your own templates with the gallery. */
    private readonly onShare?: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-template-gallery");
    this.titleEl.setText("Template gallery");
    const onShare = this.onShare;
    if (onShare) {
      const head = this.contentEl.createDiv({ cls: "goodobsidian-gallery-head" });
      head.createSpan({
        cls: "setting-item-description",
        text: "Templates shared by people who use FineNotes.",
      });
      const share = head.createEl("button", { text: "Share yours…" });
      share.addEventListener("click", () => {
        this.close();
        onShare();
      });
    }
    const shown = this.entries.filter((entry) => !entry.retired);
    if (shown.length === 0) {
      this.contentEl.createDiv({
        cls: "setting-item-description",
        text: "This gallery lists no templates yet.",
      });
      return;
    }
    // Search, then a chip per category that has templates.
    const search = this.contentEl.createEl("input", {
      cls: "goodobsidian-gallery-search",
      type: "search",
      attr: { placeholder: "Search templates", "aria-label": "Search templates" },
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList(shown);
    });
    const chips = this.contentEl.createDiv({ cls: "goodobsidian-gallery-chips" });
    const used = GALLERY_CATEGORIES.filter((c) => shown.some((e) => e.category === c.id));
    const chipButtons: HTMLElement[] = [];
    for (const category of [{ id: "all", label: "All" }, ...used]) {
      const chip = chips.createEl("button", {
        cls: "goodobsidian-gallery-chip clickable-icon",
        text: category.label,
      });
      chip.toggleClass("is-active", category.id === this.category);
      chip.addEventListener("click", () => {
        this.category = category.id;
        for (const other of chipButtons) other.toggleClass("is-active", other === chip);
        this.renderList(shown);
      });
      chipButtons.push(chip);
    }
    this.listEl = this.contentEl.createDiv({ cls: "goodobsidian-template-grid" });
    this.renderList(shown);
  }

  private renderList(shown: readonly GalleryEntry[]): void {
    const grid = this.listEl;
    if (!grid) return;
    grid.empty();
    const matching = shown.filter(
      (entry) =>
        (this.category === "all" || entry.category === this.category) &&
        galleryMatches(entry, this.query),
    );
    if (matching.length === 0) {
      grid.createDiv({ cls: "setting-item-description", text: "No templates match." });
      return;
    }
    for (const entry of matching) {
      const card = grid.createDiv({ cls: "goodobsidian-template-entry" });
      const frame = card.createDiv({ cls: "goodobsidian-template-entry-preview" });
      if (entry.preview)
        frame.createEl("img", { attr: { src: entry.preview, alt: "", loading: "lazy" } });
      card.createDiv({ cls: "goodobsidian-template-entry-name", text: entry.name });
      const what = entry.kind === "notebook" ? "Notebook" : "Paper";
      const meta = [what, entry.author, `${entry.pages} page${entry.pages === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" · ");
      card.createDiv({ cls: "goodobsidian-template-entry-meta", text: meta });
      const licence = TEMPLATE_LICENCES.find((l) => l.id === entry.licence)?.label ?? "";
      card.createDiv({ cls: "goodobsidian-template-entry-licence", text: licence });
      if (entry.description) {
        card.createDiv({ cls: "goodobsidian-template-entry-desc", text: entry.description });
      }
      if (entry.download) {
        const button = card.createEl("button", {
          cls: "mod-cta",
          text: entry.kind === "notebook" ? "Use template" : "Add to My templates",
        });
        button.addEventListener("click", () => {
          this.close();
          this.install(entry);
        });
      }
      if (entry.shop) {
        // Sold by its creator in their own shop; FineNotes only links there.
        const shop = card.createEl("button", { text: "Get it from the creator" });
        shop.addEventListener("click", () => this.openShop(entry.shop));
      }
    }
  }

  override onClose(): void {
    this.listEl = null;
    this.contentEl.empty();
    this.onClosed?.();
  }
}

/** A template in My templates that can be shared: its file and how it shows. */
export interface ShareableTemplate {
  path: string;
  name: string;
  pages: number;
}

/**
 * "Share…": a template from My templates to the community gallery. Asks
 * the few things the gallery's form needs, then opens that form on GitHub
 * already filled in (`model/gallery-share.ts`) and says which file to drag
 * in there; a bot does the rest. Opens nothing until asked.
 */
export class ShareTemplateModal extends Modal {
  private details: ShareDetails;
  private chosen: ShareableTemplate | null;

  constructor(
    app: App,
    private readonly templates: readonly ShareableTemplate[],
    initial: string | undefined,
    private readonly openForm: (url: string, template: ShareableTemplate, author: string) => void,
    author: string,
  ) {
    super(app);
    this.chosen = templates.find((t) => t.path === initial) ?? templates[0] ?? null;
    this.details = {
      name: this.chosen?.name ?? "",
      author,
      category: "planner",
      licence: "cc-by",
    };
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-share-template");
    this.titleEl.setText("Share a template");
    const el = this.contentEl;
    el.empty();
    if (!this.chosen) {
      el.createDiv({
        cls: "setting-item-description",
        text: "My templates is empty. Bring in a PDF or picture, or save a page as a template, then share it.",
      });
      return;
    }
    el.createDiv({
      cls: "setting-item-description goodobsidian-share-intro",
      text:
        "Everyone who uses FineNotes can find it in the template gallery once it is reviewed. " +
        "FineNotes opens the submission form on GitHub with this filled in; you attach the file " +
        "there and send it. You need a free GitHub account.",
    });
    let nameField: { setValue(value: string): unknown } | null = null;
    new Setting(el).setName("Template").addDropdown((dropdown) => {
      for (const t of this.templates) {
        dropdown.addOption(t.path, `${t.name} (${t.pages} page${t.pages === 1 ? "" : "s"})`);
      }
      dropdown.setValue(this.chosen?.path ?? "");
      dropdown.onChange((path) => {
        this.chosen = this.templates.find((t) => t.path === path) ?? this.chosen;
        if (this.chosen) {
          this.details.name = this.chosen.name;
          nameField?.setValue(this.chosen.name);
        }
        this.renderFile();
      });
    });
    new Setting(el).setName("Name").addText((text) => {
      nameField = text;
      text.setValue(this.details.name).onChange((v) => (this.details.name = v));
    });
    new Setting(el)
      .setName("Your name, as it shows")
      .addText((text) =>
        text.setValue(this.details.author).onChange((v) => (this.details.author = v)),
      );
    new Setting(el).setName("Category").addDropdown((dropdown) => {
      for (const c of SHARE_CATEGORIES) dropdown.addOption(c.id, c.label);
      dropdown.setValue(this.details.category);
      dropdown.onChange((v) => (this.details.category = v));
    });
    new Setting(el).setName("Licence").addDropdown((dropdown) => {
      for (const l of TEMPLATE_LICENCES) dropdown.addOption(l.id, l.label);
      dropdown.setValue(this.details.licence);
      dropdown.onChange((v) => (this.details.licence = v as TemplateLicence));
    });
    new Setting(el)
      .setName("Description")
      .addTextArea((text) => text.onChange((v) => (this.details.description = v)));
    new Setting(el)
      .setName("Tags")
      .setDesc("A few words, separated by commas.")
      .addText((text) => text.onChange((v) => (this.details.tags = v)));
    this.fileEl = el.createDiv({ cls: "goodobsidian-share-file" });
    this.renderFile();
    new Setting(el)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setCta()
          .setButtonText("Open the form on GitHub")
          .onClick(() => {
            const problems = shareProblems(this.details);
            if (problems.length > 0 || !this.chosen) {
              new Notice(problems.join(" ") || "Choose a template.");
              return;
            }
            const chosen = this.chosen;
            this.close();
            this.openForm(submissionUrl(this.details), chosen, this.details.author.trim());
          }),
      );
  }

  private fileEl: HTMLElement | null = null;

  /** Which file to drag into the form, and where it is. */
  private renderFile(): void {
    const el = this.fileEl;
    if (!el || !this.chosen) return;
    el.empty();
    el.createDiv({ cls: "goodobsidian-share-file-label", text: "On GitHub, attach this file:" });
    el.createDiv({ cls: "goodobsidian-share-file-path", text: this.chosen.path });
  }

  override onClose(): void {
    this.fileEl = null;
    this.contentEl.empty();
  }
}
