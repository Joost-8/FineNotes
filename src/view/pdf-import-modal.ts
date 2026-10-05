import { type App, FuzzySuggestModal, Modal, Notice, Setting, type TFile } from "obsidian";
import { allPages, parsePageRange } from "../export/page-range";
import { DialogKeyboard } from "./dialog-keyboard";
import { errorMessage } from "../util/errors";

export class VaultPdfSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly pick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Find a PDF in the vault…");
  }
  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => file.extension.toLowerCase() === "pdf");
  }
  getItemText(file: TFile): string {
    return file.path;
  }
  onChooseItem(file: TFile): void {
    this.pick(file);
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
    this.titleEl.setText("Import PDF");
    this.modalEl.addClass("goodobsidian-dialog");
    this.contentEl.createEl("p", {
      text: `${this.name} · ${this.total} pages. Added after the current page; the original PDF is preserved.`,
    });
    this.keyboard = new DialogKeyboard(this.modalEl);
    new Setting(this.contentEl).setName("Pages").addDropdown((dropdown) =>
      dropdown
        .addOption("all", "All pages")
        .addOption("custom", "Selected pages")
        .onChange((value) => {
          this.all = value === "all";
          row.settingEl.toggle(!this.all);
        }),
    );
    const row = new Setting(this.contentEl)
      .setName("Page range")
      .setDesc("For example: 1-3, 5. Pages are imported in the order entered.");
    row.settingEl.toggle(false);
    row.addText((field) => {
      field.setPlaceholder("1-3, 5").onChange((value) => {
        this.range = value;
      });
      this.keyboard?.watch(field.inputEl, row.settingEl);
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText("Import")
          .setCta()
          .onClick(async () => {
            if (this.busy) return;
            const result = this.all
              ? { ok: true as const, pages: allPages(this.total) }
              : parsePageRange(this.range, this.total);
            if (!result.ok) {
              new Notice(result.error.replace(/export/g, "import").replace(/notebook/g, "PDF"));
              return;
            }
            this.busy = true;
            button.setDisabled(true);
            try {
              if (await this.insert(result.pages)) this.close();
              else
                new Notice("PDF import stopped: the notebook is no longer available for editing.");
            } catch (error) {
              new Notice(`FineNotes: couldn't import PDF — ${errorMessage(error)}`, 8000);
            } finally {
              this.busy = false;
              button.setDisabled(false);
            }
          }),
      )
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText("Cancel")
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
