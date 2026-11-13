import { type App, Modal, Notice, Setting, SuggestModal, type TFile, setIcon } from "obsidian";
import { type PickerFolder, type PickerPdf, browsePdfs, searchPdfs } from "../model/pdf-picker";
import { allPages, parsePageRange } from "../export/page-range";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { errorMessage } from "../util/errors";
import { t } from "../i18n/translate";

/** A row of the vault PDF picker: back to the folder above, a folder to open, or a PDF to take. */
type PickRow =
  | { kind: "up"; path: string }
  | { kind: "folder"; folder: PickerFolder }
  | { kind: "pdf"; pdf: PickerPdf; showFolder: boolean };

/** The folder the picker was left in, so the next import starts there (this session). */
let lastFolder = "";

/**
 * Pick a PDF from the vault: its folders to browse, as Obsidian's file list
 * shows them, with the PDFs in each to tap; typing in the field above
 * searches every PDF instead (the list is in `model/pdf-picker.ts`).
 *
 *   [ Find a PDF in the vault…                ]
 *   ‹  Courses                                   (back to the folder above)
 *   📁 Lecture Slides                        14
 *   📄 handout
 */
export class VaultPdfSuggestModal extends SuggestModal<PickRow> {
  private readonly keyboard: DialogKeyboard;
  private readonly paths: string[];
  private folder: string;

  constructor(
    app: App,
    private readonly pick: (file: TFile) => void,
  ) {
    super(app);
    this.paths = app.vault
      .getFiles()
      .filter((file) => file.extension.toLowerCase() === "pdf")
      .map((file) => file.path);
    // Where the last import was picked from, while it still leads to a PDF.
    const kept = browsePdfs(this.paths, lastFolder);
    this.folder = kept.folders.length + kept.pdfs.length > 0 ? lastFolder : "";
    this.keyboard = new DialogKeyboard(this.modalEl);
    this.modalEl.addClass("goodobsidian-pdf-pick");
    this.limit = 500;
    this.setPlaceholder(t("notebooks.pdfImport.find"));
    this.emptyStateText = t("notebooks.pdfImport.none");
    // The iPad's Return can come only as a line break (enter-key.ts).
    onEnterKey(
      this.inputEl,
      () => this.selectActiveSuggestion(new KeyboardEvent("keydown", { key: "Enter" })),
      { keydownHandled: true },
    );
  }

  override async onOpen(): Promise<void> {
    await super.onOpen();
    this.keyboard.start(this.inputEl);
  }

  override onClose(): void {
    super.onClose();
    this.keyboard.end();
  }

  getSuggestions(query: string): PickRow[] {
    if (query.trim() !== "") {
      return searchPdfs(this.paths, query).map((pdf) => ({ kind: "pdf", pdf, showFolder: true }));
    }
    const here = browsePdfs(this.paths, this.folder);
    return [
      ...(here.up === null ? [] : [{ kind: "up" as const, path: here.up }]),
      ...here.folders.map((folder) => ({ kind: "folder" as const, folder })),
      ...here.pdfs.map((pdf) => ({ kind: "pdf" as const, pdf, showFolder: false })),
    ];
  }

  renderSuggestion(row: PickRow, el: HTMLElement): void {
    el.addClass("goodobsidian-link-choice", `is-${row.kind}`);
    const icon =
      row.kind === "up" ? "chevron-left" : row.kind === "folder" ? "folder" : "file-text";
    setIcon(el.createSpan({ cls: "goodobsidian-link-choice-icon" }), icon);
    const text = el.createDiv({ cls: "goodobsidian-link-choice-text" });
    const title = text.createDiv({ cls: "goodobsidian-link-choice-title" });
    switch (row.kind) {
      case "up": {
        // Back is named by where it goes, as a navigation bar does.
        const name = row.path === "" ? this.app.vault.getName() : row.path.split("/").pop();
        title.setText(name ?? row.path);
        el.setAttribute("aria-label", t("notebooks.pdfImport.back", { name: name ?? row.path }));
        break;
      }
      case "folder":
        title.setText(row.folder.name);
        el.createSpan({ cls: "goodobsidian-pdf-pick-count", text: String(row.folder.count) });
        break;
      case "pdf":
        title.setText(row.pdf.name);
        if (row.showFolder && row.pdf.folder !== "") {
          text.createDiv({ cls: "goodobsidian-link-choice-sub", text: row.pdf.folder });
        }
        break;
    }
  }

  /** A folder (or back) opens in place, the list staying up; a PDF is taken. */
  override selectSuggestion(row: PickRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.kind === "pdf") {
      super.selectSuggestion(row, evt);
      return;
    }
    this.openFolder(row.kind === "up" ? row.path : row.folder.path);
  }

  onChooseSuggestion(row: PickRow): void {
    if (row.kind !== "pdf") return;
    const file = this.app.vault.getFileByPath(row.pdf.path);
    if (!file) return;
    lastFolder = row.pdf.folder;
    this.pick(file);
  }

  private openFolder(path: string): void {
    this.folder = path;
    lastFolder = path;
    this.inputEl.value = "";
    // The list follows the field: an input event rebuilds it from the folder now open.
    this.inputEl.dispatchEvent(new Event("input"));
    this.resultContainerEl.scrollTop = 0;
  }
}

/** Choose source pages before any attachment is saved or notebook changed. */
export class PdfImportModal extends Modal {
  private range = "";
  private all = true;
  private busy = false;
  private keyboard: DialogKeyboard | null = null;

  constructor(
    app: App,
    private readonly name: string,
    private readonly total: number,
    private readonly insert: (indices: number[]) => Promise<boolean>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(t("notebooks.pdfImport.title"));
    this.modalEl.addClass("goodobsidian-dialog");
    this.contentEl.createEl("p", {
      text: t("notebooks.pdfImport.summary", { name: this.name, total: this.total }),
    });
    this.keyboard = new DialogKeyboard(this.modalEl);
    new Setting(this.contentEl).setName(t("notebooks.pdfImport.pages")).addDropdown((dropdown) =>
      dropdown
        .addOption("all", t("notebooks.pdfImport.allPages"))
        .addOption("custom", t("notebooks.pdfImport.selectedPages"))
        .onChange((value) => {
          this.all = value === "all";
          row.settingEl.toggle(!this.all);
        }),
    );
    const row = new Setting(this.contentEl)
      .setName(t("notebooks.pdfImport.range"))
      .setDesc(t("notebooks.pdfImport.rangeInfo"));
    row.settingEl.toggle(false);
    row.addText((field) => {
      field.setPlaceholder(t("notebooks.pdfImport.rangePlaceholder")).onChange((value) => {
        this.range = value;
      });
      this.keyboard?.watch(field.inputEl, row.settingEl);
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText(t("notebooks.pdfImport.import"))
          .setCta()
          .onClick(async () => {
            if (this.busy) return;
            const result = this.all
              ? { ok: true as const, pages: allPages(this.total) }
              : parsePageRange(this.range, this.total, "import");
            if (!result.ok) {
              new Notice(result.error);
              return;
            }
            this.busy = true;
            button.setDisabled(true);
            try {
              if (await this.insert(result.pages)) this.close();
              else new Notice(t("notebooks.pdfImport.stopped"));
            } catch (error) {
              new Notice(t("notebooks.pdfImport.failed", { reason: errorMessage(error) }), 8000);
            } finally {
              this.busy = false;
              button.setDisabled(false);
            }
          }),
      )
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText(t("common.cancel"))
          .onClick(() => {
            if (!this.busy) this.close();
          }),
      );
  }
  override onClose(): void {
    this.keyboard?.end();
    this.contentEl.empty();
  }
}
