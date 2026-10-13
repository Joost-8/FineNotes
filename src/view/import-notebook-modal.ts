/**
 * The "Import notebook" dialog: pick Goodnotes or Notability files (from the
 * device or the vault), convert them, save each as a notebook with its
 * attachments, and show what came over. The converting is
 * `import/import-notebook.ts`; this file only reads, writes and shows.
 */

import {
  type App,
  FuzzySuggestModal,
  Modal,
  Notice,
  normalizePath,
  Platform,
  setIcon,
  Setting,
  type TFile,
} from "obsidian";
import {
  IMPORT_EXTENSIONS,
  importNotebooks,
  relinkAttachments,
  type ImportBatch,
  type ImportResult,
} from "../import/import-notebook";
import {
  describeImport,
  importHeading,
  isImportFileName,
  progressText,
  withPageText,
} from "../import/import-summary";
import {
  cleanTitle,
  joinVaultPath,
  newNoteBody,
  normalizeFolder,
  notebookPaths,
  stripInkSuffix,
} from "../model/new-notebook";
import { buildInkFile } from "../model/serialize";
import { errorMessage } from "../util/errors";
import { saveImageAttachment } from "./image-import";
import { measurePdfPages, rasterizePdfFirstPage } from "./pdf-pages";

export interface ImportNotebookOptions {
  /** Where new notebooks go (vault-relative, "" for the root). */
  folder: string;
  /** Give each notebook a folder of its own, as "New notebook" does. */
  ownFolder: boolean;
  /** Open a notebook the import wrote. */
  open: (file: TFile) => Promise<void>;
}

/** A picked file before it is read. */
interface Picked {
  name: string;
  read: () => Promise<ArrayBuffer>;
}

export class ImportNotebookModal extends Modal {
  private busy = false;
  /** Closed while importing: stop after the notebook being saved. */
  private closed = false;

  constructor(
    app: App,
    private readonly options: ImportNotebookOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.showPicker();
  }

  override onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }

  /** The dialog's title at each step, tagged as a beta. */
  private showTitle(text: string): void {
    this.titleEl.setText(text);
    this.titleEl.createSpan({ cls: "goodobsidian-beta-tag", text: "Beta" });
  }

  // --- Step 1: choose files ---------------------------------------------------

  private showPicker(): void {
    this.showTitle("Import notebook");
    const el = this.contentEl;
    el.empty();
    el.createDiv({
      cls: "goodobsidian-beta-note",
      text:
        "Beta: Goodnotes and Notability do not publish their file formats, so a notebook " +
        "may not come over completely. Check it after importing. The files you import " +
        "from are not changed.",
    });
    el.createEl("p", {
      text:
        "Bring notebooks over from Goodnotes or Notability. Your handwriting stays editable, " +
        "and paper and pictures come along.",
    });

    new Setting(el)
      .setName("From this device")
      .setDesc("A .goodnotes or .note file, or a backup .zip. You can pick several.")
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText("Choose files…")
          .setCta()
          .onClick(() => {
            // Opened inside the tap: iPadOS only shows a picker for a click made in a gesture.
            void pickFiles(el).then((files) => {
              if (files.length > 0) void this.run(files);
            });
          }),
      );

    new Setting(el)
      .setName("From the vault")
      .setDesc("A file already synced into this vault.")
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText("Choose…")
          .onClick(() => {
            new VaultImportSuggestModal(this.app, (file) => {
              void this.run([{ name: file.name, read: () => this.app.vault.readBinary(file) }]);
            }).open();
          }),
      );

    new Setting(el)
      .setName("Save to")
      .setDesc(this.options.folder ? this.options.folder : "The vault's top folder");

    const help = el.createEl("details", { cls: "goodobsidian-import-help" });
    const summary = help.createEl("summary");
    setIcon(summary.createSpan({ cls: "goodobsidian-import-help-chevron" }), "chevron-right");
    summary.createSpan({ text: "How do I export my notebooks?" });
    const steps = help.createEl("ul");
    steps.createEl("li", {
      text:
        "Goodnotes: share or export a notebook in the Goodnotes format. To move everything at " +
        "once, turn on auto-backup in Goodnotes format and pick the backup .zip.",
    });
    steps.createEl("li", { text: "Notability: share or export a note in the Note format." });
    steps.createEl("li", {
      text: "Save the file to this vault's folder or to Files, then choose it here.",
    });

    new Setting(el).addButton((button) =>
      button
        .setClass("clickable-icon")
        .setButtonText("Cancel")
        .onClick(() => this.close()),
    );
  }

  // --- Step 2: convert and save ------------------------------------------------

  private async run(files: Picked[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const el = this.contentEl;
    el.empty();
    this.showTitle("Importing…");
    const status = el.createEl("p");
    const batch: ImportBatch = { results: [], failures: [] };
    const written: Array<{ result: ImportResult; file: TFile }> = [];
    try {
      for (const [index, picked] of files.entries()) {
        if (this.closed) break;
        status.setText(progressText(index, files.length, picked.name));
        let one: ImportBatch;
        try {
          // Each notebook is saved, and its files let go, before the next is read.
          one = await importNotebooks(new Uint8Array(await picked.read()), picked.name, {
            measurePdf: (bytes) => measurePdfPages(ownBuffer(bytes)),
            rasterizePdf: (bytes) => rasterizePdfFirstPage(bytes),
            onResult: async (result) => {
              written.push({ result, file: await this.save(result) });
            },
            cancelled: () => this.closed,
          });
        } catch (error) {
          batch.failures.push({
            name: picked.name,
            reason: `It could not be read (${errorMessage(error)}).`,
          });
          continue;
        }
        batch.failures.push(...one.failures);
        batch.results.push(...one.results);
      }
    } finally {
      this.busy = false;
    }
    if (this.closed) {
      // Closed mid-import: what was saved stays, and the user is told so.
      if (written.length > 0) {
        new Notice(
          `Import stopped. ${written.length} notebook${written.length === 1 ? " was" : "s were"} imported.`,
        );
      }
      return;
    }
    this.showResults(batch, written);
  }

  /** Write one converted notebook and its attachments; returns the notebook file. */
  private async save(result: ImportResult): Promise<TFile> {
    const vault = this.app.vault;
    const dir = normalizeFolder(this.options.folder);
    const parent = dir ? vault.getFolderByPath(dir) : vault.getRoot();
    const taken = new Set(parent?.children.map((child) => child.name) ?? []);
    const paths = notebookPaths(dir, result.title, "notebook", this.options.ownFolder, taken);
    for (const path of paths.folders) {
      if (!vault.getFolderByPath(path)) await vault.createFolder(path);
    }
    const notePath = normalizePath(joinVaultPath(paths.folder, paths.fileName));
    if (paths.attachments) result.doc.folders = { ...paths.attachments };

    const saved = new Map<string, string>();
    for (const attachment of result.attachments) {
      const dot = attachment.name.lastIndexOf(".");
      const ext = dot > 0 ? attachment.name.slice(dot + 1) : "bin";
      const bytes = ownBuffer(attachment.bytes);
      const file = await saveImageAttachment(
        this.app,
        { bytes, mime: attachment.mime, ext, width: 0, height: 0 },
        attachment.name,
        notePath,
        paths.attachments?.images,
      );
      saved.set(attachment.name, file.path);
    }
    relinkAttachments(result.doc, saved);

    const heading = cleanTitle(result.title) || stripInkSuffix(paths.fileName);
    const body = withPageText(
      newNoteBody(heading, new Date().toISOString()),
      result.doc,
      result.pageText,
    );
    const content = buildInkFile(body, result.doc);
    return vault.create(notePath, content);
  }

  // --- Step 3: what came over ----------------------------------------------------

  private showResults(
    batch: ImportBatch,
    written: Array<{ result: ImportResult; file: TFile }>,
  ): void {
    this.showTitle(importHeading(batch));
    const el = this.contentEl;
    el.empty();

    for (const { result, file } of written) {
      const row = new Setting(el).setName(result.title).setDesc(describeImport(result));
      setIcon(row.nameEl.createSpan({ cls: "goodobsidian-import-mark", prepend: true }), "check");
      for (const warning of result.warnings) {
        row.descEl.createDiv({ text: warning, cls: "mod-warning" });
      }
      row.addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText("Open")
          .onClick(() => {
            this.close();
            void this.options.open(file);
          }),
      );
    }
    for (const failure of batch.failures) {
      const row = new Setting(el).setName(failure.name).setDesc(failure.reason);
      row.descEl.addClass("mod-warning");
      setIcon(
        row.nameEl.createSpan({ cls: "goodobsidian-import-mark", prepend: true }),
        "alert-triangle",
      );
    }

    const buttons = new Setting(el);
    const first = written[0];
    if (first) {
      buttons.addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText(written.length === 1 ? "Open notebook" : "Open the first")
          .setCta()
          .onClick(() => {
            this.close();
            void this.options.open(first.file);
          }),
      );
    }
    buttons
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText("Import more")
          .onClick(() => this.showPicker()),
      )
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText("Done")
          .onClick(() => this.close()),
      );
  }
}

/** The bytes as an ArrayBuffer of their own, copied only when they share one. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return whole && bytes.buffer instanceof ArrayBuffer ? bytes.buffer : bytes.slice().buffer;
}

/** Notebook files already in the vault. */
class VaultImportSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly pick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Find a .goodnotes, .note or .zip file in the vault…");
  }
  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => isImportFileName(file.name));
  }
  getItemText(file: TFile): string {
    return file.path;
  }
  onChooseItem(file: TFile): void {
    this.pick(file);
  }
}

/**
 * The system picker, several files at once. On iPad and phones no `accept`
 * is set: iOS greys out file types it has no app registered for, which would
 * hide a `.goodnotes` file once Goodnotes is uninstalled. Picks with other
 * extensions are dropped.
 */
function pickFiles(host: HTMLElement): Promise<Picked[]> {
  const input = host.createEl("input", {
    cls: "goodobsidian-file-input",
    attr: { type: "file", multiple: "", "aria-hidden": "true", tabindex: "-1" },
  });
  if (!Platform.isMobile) input.accept = IMPORT_EXTENSIONS.map((ext) => `.${ext}`).join(",");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (files: File[]): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(
        files
          .filter((file) => isImportFileName(file.name))
          .map((file) => ({ name: file.name, read: () => file.arrayBuffer() })),
      );
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => finish([]));
    input.click();
  });
}

/**
 * Open the import dialog. `openImportNotebook(folder)` in the plugin calls
 * this with its own settings.
 */
export function openImportNotebookModal(app: App, options: ImportNotebookOptions): void {
  new ImportNotebookModal(app, options).open();
}
