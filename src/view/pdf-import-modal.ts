import { type App, Modal, Notice, Setting, type TFile, setIcon } from "obsidian";
import { allPages, parsePageRange } from "../export/page-range";
import { DialogKeyboard } from "./dialog-keyboard";
import { VaultFilePicker } from "./vault-file-picker";
import { errorMessage } from "../util/errors";
import { t, tn } from "../i18n/translate";

/** Where the last PDF was picked from the vault (this session). */
const lastPdfFolder = { folder: "" };

/** Import PDF › From vault: the vault's folders, the PDFs in them, search on top (vault-file-picker.ts). */
export class VaultPdfSuggestModal extends VaultFilePicker {
  constructor(app: App, pick: (file: TFile) => void) {
    super(
      app,
      {
        accepts: (path) => path.toLowerCase().endsWith(".pdf"),
        placeholder: t("notebooks.pdfImport.find"),
        empty: t("notebooks.pdfImport.none"),
        icon: "file-text",
        memory: lastPdfFolder,
      },
      pick,
    );
  }
}

/**
 * Import PDF: first how (`keepBeside` given): keep the PDF beside the notes
 * as a tab, or write on it, its pages added to the notes; then, for the
 * latter, which pages, before any attachment is saved or notebook changed.
 */
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
    /** Keep it beside the notes as a tab instead; whether that was done. */
    private readonly keepBeside?: () => Promise<boolean>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(t("notebooks.pdfImport.title"));
    this.modalEl.addClass("goodobsidian-dialog");
    // The question first; what Write on it does is said where its pages are picked.
    const summary = this.contentEl.createEl("p", {
      text: this.keepBeside
        ? tn("notebooks.pdfImport.size", this.total, { name: this.name })
        : t("notebooks.pdfImport.summary", { name: this.name, total: this.total }),
    });
    if (this.keepBeside) this.chooseHow(this.keepBeside, summary);
    else this.choosePages();
  }

  /** The one question: a tab beside the notes, or pages in them. */
  private chooseHow(keep: () => Promise<boolean>, summary: HTMLElement): void {
    const choices = this.contentEl.createDiv({ cls: "goodobsidian-pdf-import-choices" });
    const choice = (icon: string, title: string, info: string, cta: boolean): HTMLButtonElement => {
      const button = choices.createEl("button", {
        cls: "goodobsidian-pdf-import-choice clickable-icon",
      });
      button.toggleClass("mod-cta", cta);
      setIcon(button.createSpan({ cls: "goodobsidian-pdf-import-choice-icon" }), icon);
      const words = button.createSpan({ cls: "goodobsidian-pdf-import-choice-words" });
      words.createSpan({ cls: "goodobsidian-pdf-import-choice-title", text: title });
      words.createSpan({ cls: "goodobsidian-pdf-import-choice-info", text: info });
      return button;
    };
    const beside = choice(
      "panel-top",
      t("notebooks.pdfImport.keepBeside"),
      t("notebooks.pdfImport.keepBesideInfo"),
      true,
    );
    const write = choice(
      "file-pen-line",
      t("notebooks.pdfImport.writeOn"),
      t("notebooks.pdfImport.writeOnInfo"),
      false,
    );
    beside.addEventListener("click", () => {
      if (this.busy) return;
      this.busy = true;
      beside.disabled = true;
      keep()
        .then((done) => {
          if (done) this.close();
        })
        .catch(
          (error: unknown) =>
            new Notice(t("notebooks.pdfImport.failed", { reason: errorMessage(error) }), 8000),
        )
        .finally(() => {
          this.busy = false;
          beside.disabled = false;
        });
    });
    write.addEventListener("click", () => {
      if (this.busy) return;
      choices.remove();
      summary.setText(t("notebooks.pdfImport.summary", { name: this.name, total: this.total }));
      this.choosePages();
    });
  }

  /** Which pages to write on: all, or a range. */
  private choosePages(): void {
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
