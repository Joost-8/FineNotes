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

import { type App, FuzzySuggestModal, Modal, Notice, Setting, type TFile, setIcon } from "obsidian";
import {
  SHARE_CATEGORIES,
  type ShareDetails,
  shareProblems,
  submissionUrl,
} from "../model/gallery-share";
import {
  GALLERY_CATEGORIES,
  GALLERY_SORTS,
  type GalleryEntry,
  type GallerySort,
  formatDownloads,
  sortGallery,
  TEMPLATE_EXTENSION,
  galleryMatches,
  TEMPLATE_LICENCES,
  type TemplateLicence,
} from "../import/template-package";
import { t, tn } from "../i18n/translate";

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
    this.titleEl.setText(t("notebooks.templateUi.saveTitle"));
    const el = this.contentEl;
    el.createDiv({
      cls: "setting-item-description",
      text: t("notebooks.templateUi.saveIntro"),
    });
    new Setting(el)
      .setName(t("notebooks.templateUi.name"))
      .addText((text) => text.setValue(this.details.name).onChange((v) => (this.details.name = v)));
    new Setting(el).setName(t("notebooks.templateUi.author")).addText((text) =>
      text
        .setPlaceholder(t("notebooks.templateUi.yourName"))
        .setValue(this.details.author)
        .onChange((v) => (this.details.author = v)),
    );
    new Setting(el)
      .setName(t("notebooks.templateUi.description"))
      .addTextArea((text) =>
        text.setValue(this.details.description).onChange((v) => (this.details.description = v)),
      );
    new Setting(el)
      .setName(t("notebooks.templateUi.version"))
      .addText((text) =>
        text.setValue(this.details.version).onChange((v) => (this.details.version = v)),
      );
    new Setting(el)
      .setName(t("notebooks.templateUi.licence"))
      .setDesc(t("notebooks.templateUi.licenceInfo"))
      .addDropdown((dropdown) => {
        for (const l of TEMPLATE_LICENCES) dropdown.addOption(l.id, l.title);
        dropdown
          .setValue(this.details.licence)
          .onChange((v) => (this.details.licence = v as TemplateLicence));
      });
    new Setting(el)
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setCta()
          .setButtonText(t("common.save"))
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
    this.setPlaceholder(t("notebooks.command.newFromTemplate"));
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
/** "1.2k downloads", "1 download", "No downloads yet". */
function downloadsLabel(n: number): string {
  if (n <= 0) return t("notebooks.templateUi.noDownloads");
  return tn("notebooks.templateUi.downloads", n, { count: formatDownloads(n) });
}

export class TemplateGalleryModal extends Modal {
  private query = "";
  private category = "all";
  private sort: GallerySort = "popular";
  private listEl: HTMLElement | null = null;
  /** Where the browse view was scrolled, kept while a template's page shows. */
  private browseScroll = 0;

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
    this.titleEl.setText(t("notebooks.templateUi.galleryTitle"));
    this.showBrowse();
  }

  /**
   * Browsing, as Goodnotes' gallery: a search, a chip per category, and a
   * grid of covers. A tap opens the template's own page.
   */
  private showBrowse(): void {
    const el = this.contentEl;
    el.empty();
    el.removeClass("is-detail");
    const shown = this.entries.filter((entry) => !entry.retired);
    const head = el.createDiv({ cls: "goodobsidian-gallery-head" });
    head.createSpan({
      cls: "setting-item-description",
      text: t("notebooks.templateUi.galleryIntro"),
    });
    const onShare = this.onShare;
    if (onShare) {
      const share = head.createEl("button", { text: t("notebooks.templateUi.shareYours") });
      share.addEventListener("click", () => {
        this.close();
        onShare();
      });
    }
    if (shown.length === 0) {
      el.createDiv({
        cls: "setting-item-description",
        text: t("notebooks.templateUi.galleryEmpty"),
      });
      return;
    }
    const search = el.createEl("input", {
      cls: "goodobsidian-gallery-search",
      type: "search",
      attr: {
        placeholder: t("notebooks.templateUi.search"),
        "aria-label": t("notebooks.templateUi.search"),
      },
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList(shown);
    });
    const filters = el.createDiv({ cls: "goodobsidian-gallery-filters" });
    const chips = filters.createDiv({ cls: "goodobsidian-gallery-chips" });
    const used = GALLERY_CATEGORIES.filter((c) => shown.some((e) => e.category === c.id));
    const chipButtons: HTMLElement[] = [];
    for (const category of [{ id: "all", label: t("notebooks.templateUi.all") }, ...used]) {
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
    // Popular (most downloaded) · New · A–Z.
    const sorts = filters.createDiv({ cls: "goodobsidian-segmented goodobsidian-gallery-sort" });
    const sortButtons: HTMLElement[] = [];
    for (const sort of GALLERY_SORTS) {
      const button = sorts.createEl("button", { cls: "clickable-icon", text: sort.label });
      button.toggleClass("is-active", sort.id === this.sort);
      button.setAttribute("aria-pressed", String(sort.id === this.sort));
      button.addEventListener("click", () => {
        this.sort = sort.id;
        for (const other of sortButtons) {
          other.toggleClass("is-active", other === button);
          other.setAttribute("aria-pressed", String(other === button));
        }
        this.renderList(shown);
      });
      sortButtons.push(button);
    }
    this.listEl = el.createDiv({ cls: "goodobsidian-gallery-grid" });
    this.renderList(shown);
    this.listEl.scrollTop = this.browseScroll;
  }

  private renderList(shown: readonly GalleryEntry[]): void {
    const grid = this.listEl;
    if (!grid) return;
    grid.empty();
    const matching = sortGallery(
      shown.filter(
        (entry) =>
          (this.category === "all" || entry.category === this.category) &&
          galleryMatches(entry, this.query),
      ),
      this.sort,
    );
    if (matching.length === 0) {
      grid.createDiv({ cls: "setting-item-description", text: t("notebooks.templateUi.noMatch") });
      return;
    }
    for (const entry of matching) {
      const card = grid.createEl("button", {
        cls: "goodobsidian-gallery-card clickable-icon",
        attr: { "aria-label": entry.name },
      });
      const cover = card.createDiv({ cls: "goodobsidian-gallery-cover" });
      const src = entry.preview || entry.previews[0];
      if (src) cover.createEl("img", { attr: { src, alt: "", loading: "lazy" } });
      if (entry.pages > 1) {
        cover.createSpan({
          cls: "goodobsidian-gallery-badge",
          text: t("notebooks.templateUi.pagesBadge", { count: entry.pages }),
        });
      }
      card.createDiv({ cls: "goodobsidian-gallery-card-name", text: entry.name });
      card.createDiv({ cls: "goodobsidian-gallery-card-meta", text: entry.author });
      const where =
        entry.shop && !entry.download
          ? t("notebooks.templateUi.inShop")
          : t("notebooks.templateUi.free");
      card.createDiv({
        cls: "goodobsidian-gallery-card-meta",
        text: [where, entry.download ? downloadsLabel(entry.downloads) : ""]
          .filter(Boolean)
          .join(" · "),
      });
      card.addEventListener("click", () => this.showDetail(entry));
    }
  }

  /**
   * A template's own page, as Goodnotes' gallery has: its name and maker,
   * the button that adds it, every page side by side to swipe through, then
   * what it is (description, tags, licence).
   */
  private showDetail(entry: GalleryEntry): void {
    this.browseScroll = this.listEl?.scrollTop ?? 0;
    this.listEl = null;
    const el = this.contentEl;
    el.empty();
    el.addClass("is-detail");
    const back = el.createEl("button", {
      cls: "goodobsidian-gallery-back clickable-icon",
      attr: { "aria-label": t("notebooks.templateUi.backToGallery") },
    });
    setIcon(back.createSpan({ cls: "goodobsidian-gallery-back-icon" }), "chevron-left");
    back.createSpan({ text: t("notebooks.templateUi.gallery") });
    back.addEventListener("click", () => this.showBrowse());

    const head = el.createDiv({ cls: "goodobsidian-gallery-detail-head" });
    const titles = head.createDiv({ cls: "goodobsidian-gallery-detail-titles" });
    titles.createDiv({ cls: "goodobsidian-gallery-detail-name", text: entry.name });
    if (entry.author) {
      titles.createDiv({
        cls: "goodobsidian-gallery-detail-author",
        text: t("notebooks.templateUi.by", { author: entry.author }),
      });
    }
    const actions = head.createDiv({ cls: "goodobsidian-gallery-detail-actions" });
    if (entry.download) {
      const add = actions.createEl("button", {
        cls: "mod-cta",
        text:
          entry.kind === "notebook"
            ? t("notebooks.templateUi.use")
            : t("notebooks.templateUi.addToMine"),
      });
      add.addEventListener("click", () => {
        this.close();
        this.install(entry);
      });
    }
    if (entry.shop) {
      const shop = actions.createEl("button", { text: t("notebooks.templateUi.getFromCreator") });
      shop.addEventListener("click", () => this.openShop(entry.shop));
    }

    // Every page, side by side, to swipe through.
    const pages = entry.previews.length > 0 ? entry.previews : entry.preview ? [entry.preview] : [];
    if (pages.length > 0) {
      const strip = el.createDiv({ cls: "goodobsidian-gallery-pages" });
      pages.forEach((src, i) => {
        const page = strip.createDiv({ cls: "goodobsidian-gallery-page" });
        // The first few at once, so the page never opens empty; the rest as swiped to.
        page.createDiv({ cls: "goodobsidian-gallery-page-frame" }).createEl("img", {
          attr: {
            src,
            alt: t("notebooks.export.page", { page: i + 1 }),
            loading: i < 4 ? "eager" : "lazy",
          },
        });
        page.createDiv({ cls: "goodobsidian-gallery-page-number", text: String(i + 1) });
      });
      if (entry.pages > pages.length) {
        el.createDiv({
          cls: "goodobsidian-gallery-more",
          text: t("notebooks.templateUi.firstPages", { shown: pages.length, count: entry.pages }),
        });
      }
    }

    const about = el.createDiv({ cls: "goodobsidian-gallery-about" });
    if (entry.description) about.createEl("p", { text: entry.description });
    const facts = about.createDiv({ cls: "goodobsidian-gallery-facts" });
    const fact = (label: string, value: string): void => {
      // Label and value are the grid's own cells: a row wrapper would need
      // `display: contents`, which the directory's review flags as only
      // partly supported.
      facts.createSpan({ cls: "goodobsidian-gallery-fact-label", text: label });
      facts.createSpan({ text: value });
    };
    fact(t("notebooks.templateUi.factPages"), String(entry.pages));
    if (entry.download)
      fact(t("notebooks.templateUi.factDownloads"), downloadsLabel(entry.downloads));
    fact(
      t("notebooks.templateUi.factKind"),
      entry.kind === "notebook"
        ? t("notebooks.templateUi.kindNotebook")
        : t("notebooks.templateUi.kindPaper"),
    );
    const category = GALLERY_CATEGORIES.find((c) => c.id === entry.category)?.label;
    if (category) fact(t("notebooks.templateUi.factCategory"), category);
    fact(
      t("notebooks.templateUi.licence"),
      TEMPLATE_LICENCES.find((l) => l.id === entry.licence)?.title ?? "",
    );
    if (entry.tags.length > 0) {
      const tags = about.createDiv({ cls: "goodobsidian-gallery-tags" });
      for (const tag of entry.tags) tags.createSpan({ cls: "goodobsidian-gallery-tag", text: tag });
    }
  }

  override onClose(): void {
    this.listEl = null;
    this.contentEl.empty();
    this.onClosed?.();
  }
}

/** A share category's name for the person, in the language in use. */
function shareCategoryLabel(category: { id: string; label: string }): string {
  switch (category.id) {
    case "planner":
      return t("notebooks.shareCategory.planner");
    case "study":
      return t("notebooks.shareCategory.study");
    case "journal":
      return t("notebooks.shareCategory.journal");
    case "work":
      return t("notebooks.shareCategory.work");
    case "paper":
      return t("notebooks.shareCategory.paper");
    case "other":
      return t("notebooks.shareCategory.other");
    default:
      return category.label;
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
    this.titleEl.setText(t("notebooks.templateUi.shareTitle"));
    const el = this.contentEl;
    el.empty();
    if (!this.chosen) {
      el.createDiv({
        cls: "setting-item-description",
        text: t("notebooks.templateUi.shareEmpty"),
      });
      return;
    }
    el.createDiv({
      cls: "setting-item-description goodobsidian-share-intro",
      text: t("notebooks.templateUi.shareIntro"),
    });
    let nameField: { setValue(value: string): unknown } | null = null;
    new Setting(el).setName(t("notebooks.templateUi.template")).addDropdown((dropdown) => {
      for (const template of this.templates) {
        dropdown.addOption(
          template.path,
          tn("notebooks.templateUi.shareOption", template.pages, { name: template.name }),
        );
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
    new Setting(el).setName(t("notebooks.templateUi.name")).addText((text) => {
      nameField = text;
      text.setValue(this.details.name).onChange((v) => (this.details.name = v));
    });
    new Setting(el)
      .setName(t("notebooks.templateUi.yourNameShown"))
      .addText((text) =>
        text.setValue(this.details.author).onChange((v) => (this.details.author = v)),
      );
    new Setting(el).setName(t("notebooks.templateUi.factCategory")).addDropdown((dropdown) => {
      for (const c of SHARE_CATEGORIES) dropdown.addOption(c.id, shareCategoryLabel(c));
      dropdown.setValue(this.details.category);
      dropdown.onChange((v) => (this.details.category = v));
    });
    new Setting(el).setName(t("notebooks.templateUi.licence")).addDropdown((dropdown) => {
      for (const l of TEMPLATE_LICENCES) dropdown.addOption(l.id, l.title);
      dropdown.setValue(this.details.licence);
      dropdown.onChange((v) => (this.details.licence = v as TemplateLicence));
    });
    new Setting(el)
      .setName(t("notebooks.templateUi.description"))
      .addTextArea((text) => text.onChange((v) => (this.details.description = v)));
    new Setting(el)
      .setName(t("notebooks.templateUi.tags"))
      .setDesc(t("notebooks.templateUi.tagsInfo"))
      .addText((text) => text.onChange((v) => (this.details.tags = v)));
    this.fileEl = el.createDiv({ cls: "goodobsidian-share-file" });
    this.renderFile();
    new Setting(el)
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setCta()
          .setButtonText(t("notebooks.templateUi.openForm"))
          .onClick(() => {
            const problems = shareProblems(this.details);
            if (problems.length > 0 || !this.chosen) {
              new Notice(problems.join(" ") || t("notebooks.templateUi.chooseTemplate"));
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
    el.createDiv({
      cls: "goodobsidian-share-file-label",
      text: t("notebooks.templateUi.attachFile"),
    });
    el.createDiv({ cls: "goodobsidian-share-file-path", text: this.chosen.path });
  }

  override onClose(): void {
    this.fileEl = null;
    this.contentEl.empty();
  }
}

/** A yes-or-no question before something is removed: Cancel, or the red button. */
export class ConfirmModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onAnswer: (yes: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.confirmLabel)
          .setDestructive()
          .setCta()
          .onClick(() => {
            this.answered = true;
            this.close();
            this.onAnswer(true);
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.answered) this.onAnswer(false);
  }
}
