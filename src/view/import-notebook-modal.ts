/**
 * The "Import notebook" dialog: pick notebooks from Goodnotes, Notability,
 * Noteful, Xournal++, Saber, reMarkable, Supernote or FreeNotes, or a PDF
 * (from the device or the vault), convert them, save each as a notebook with its
 * attachments, and show what came over. The converting is
 * `import/import-notebook.ts`; this file only reads, writes and shows.
 */

import {
  type App,
  FuzzySuggestModal,
  Modal,
  normalizePath,
  Notice,
  Platform,
  setIcon,
  Setting,
  type TFile,
  TFolder,
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
  foldersDownTo,
  importFolder,
  importHeading,
  isImportFileName,
  progressText,
  sortDropped,
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
import { isPdf, readPdf } from "../import/pdf";
import { readPdfPages } from "./pdf-reading";
import { FolderSuggestModal } from "./folder-suggest";
import { measurePdfPages, rasterizePdfFirstPage } from "./pdf-pages";

export interface ImportNotebookOptions {
  /** Where new notebooks go (vault-relative, "" for the root). */
  folder: string;
  /** Give each notebook a folder of its own, as "New notebook" does. */
  ownFolder: boolean;
  /** Open a notebook the import wrote. */
  open: (file: TFile) => Promise<void>;
  /** Files already chosen (a template from the vault or a gallery): imported at once. */
  preset?: readonly PickedFile[];
}

/** Whether a drag carries files from outside the app. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/** A picked file before it is read. */
export interface PickedFile {
  name: string;
  read: () => Promise<ArrayBuffer>;
}
type Picked = PickedFile;

export class ImportNotebookModal extends Modal {
  private busy = false;
  /** Where the notebooks go: the caller's folder, until changed here. */
  private folder: string;
  /** Closed while importing: stop after the notebook being saved. */
  private closed = false;

  constructor(
    app: App,
    private readonly options: ImportNotebookOptions,
  ) {
    super(app);
    this.folder = options.folder;
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.keepDropsInside();
    if (this.options.preset && this.options.preset.length > 0) void this.run(this.options.preset);
    else this.showPicker();
  }

  /**
   * A file let go over the dialog but outside the drop zone does nothing,
   * rather than reaching Obsidian, which would copy it into the vault.
   */
  private keepDropsInside(): void {
    for (const type of ["dragover", "drop"] as const) {
      this.containerEl.addEventListener(type, (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      });
    }
  }

  /**
   * The drop zone: files dragged over it light it up, and import when let
   * go. The drop stops here, so Obsidian does not also copy the files into
   * the vault. Drags that carry no files (text, a vault file from the
   * explorer) are left alone.
   */
  private listenForDrops(zone: HTMLElement): void {
    let depth = 0;
    const highlight = (on: boolean): void => {
      zone.toggleClass("is-dragging", on);
    };
    zone.addEventListener("dragenter", (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth++;
      highlight(!this.busy);
    });
    zone.addEventListener("dragover", (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = this.busy ? "none" : "copy";
    });
    zone.addEventListener("dragleave", (event) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) highlight(false);
    });
    zone.addEventListener("drop", (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      highlight(false);
      if (this.busy) return;
      const { accepted, refused } = sortDropped(Array.from(event.dataTransfer?.files ?? []));
      if (refused) new Notice(refused);
      if (accepted.length > 0) {
        void this.run(
          accepted.map((file) => ({ name: file.name, read: () => file.arrayBuffer() })),
        );
      }
    });
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

  /**
   * The first screen, in two columns: where the notebooks come from (drop
   * zone with the picker, or a vault file) and what comes over. Under them,
   * where they go (a folder button that opens the folder list) and the
   * export help. On a narrow screen the columns stack.
   */
  private showPicker(): void {
    this.titleEl.setText("Import notebooks");
    const el = this.contentEl;
    el.empty();
    const cols = el.createDiv({ cls: "goodobsidian-import-cols" });

    // Where from: the drop zone, with the picker inside it, and the vault.
    const from = cols.createDiv({ cls: "goodobsidian-import-from" });
    const zone = from.createDiv({ cls: "goodobsidian-import-drop" });
    setIcon(zone.createDiv({ cls: "goodobsidian-import-drop-icon" }), "file-up");
    zone.createDiv({
      cls: "goodobsidian-import-drop-title",
      text: Platform.isPhone ? "Choose notebooks" : "Drop files or a .zip",
    });
    zone.createDiv({
      cls: "goodobsidian-import-drop-desc",
      text: "Notebook files or a PDF, several at once",
    });
    const choose = zone.createEl("button", {
      cls: "mod-cta clickable-icon goodobsidian-import-drop-button",
      text: "Choose files",
      attr: { type: "button" },
    });
    choose.addEventListener("click", () => {
      // Opened inside the tap: iPadOS only shows a picker for a click made in a gesture.
      void pickFiles(el).then((files) => {
        if (files.length > 0) void this.run(files);
      });
    });
    this.listenForDrops(zone);

    const vault = from.createEl("button", {
      cls: "goodobsidian-import-row clickable-icon",
      attr: { type: "button" },
    });
    setIcon(vault.createSpan({ cls: "goodobsidian-import-row-icon" }), "folder-open");
    vault.createSpan({ cls: "goodobsidian-import-row-label", text: "From this vault" });
    setIcon(vault.createSpan({ cls: "goodobsidian-import-row-icon is-trailing" }), "chevron-right");
    vault.addEventListener("click", () => {
      new VaultImportSuggestModal(this.app, (file) => {
        void this.run([{ name: file.name, read: () => this.app.vault.readBinary(file) }]);
      }).open();
    });

    // What comes over.
    const what = cols.createDiv({ cls: "goodobsidian-import-what" });
    what.createDiv({ cls: "goodobsidian-import-what-title", text: "What comes over" });
    for (const line of ["Handwriting, still editable", "Paper and templates", "Pictures"]) {
      const item = what.createDiv({ cls: "goodobsidian-import-what-item" });
      setIcon(item.createSpan({ cls: "goodobsidian-import-what-check" }), "check");
      item.createSpan({ text: line });
    }
    what.createDiv({
      cls: "goodobsidian-import-what-apps",
      text: "From Goodnotes, Freenotes, Notability and more.",
    });
    // A PDF's own content is never turned back into ink: say so before anyone picks one.
    const pdf = what.createDiv({ cls: "goodobsidian-import-what-note" });
    setIcon(pdf.createSpan({ cls: "goodobsidian-import-what-note-icon" }), "file-text");
    pdf.createSpan({
      text: "A PDF comes in as it is: you can write over its pages, but what's already on them can't be edited.",
    });

    // Where to, and help.
    const footer = el.createDiv({ cls: "goodobsidian-import-footer" });
    footer.createSpan({ cls: "goodobsidian-import-footer-label", text: "Save to" });
    const folder = footer.createEl("button", {
      cls: "goodobsidian-import-folder clickable-icon",
      attr: { type: "button", "aria-label": "Choose the folder to save to" },
    });
    setIcon(folder.createSpan({ cls: "goodobsidian-import-folder-icon" }), "folder");
    const folderName = folder.createSpan({ cls: "goodobsidian-import-folder-name" });
    setIcon(folder.createSpan({ cls: "goodobsidian-import-folder-icon" }), "chevron-down");
    const showFolder = (): void => {
      folderName.setText(this.folder || "Vault's top folder");
    };
    showFolder();
    folder.addEventListener("click", () => {
      new FolderSuggestModal(
        this.app,
        (path) => {
          this.folder = normalizeFolder(path);
          showFolder();
        },
        "Choose a folder for the imported notebooks",
        this.folder,
      ).open();
    });

    const helpToggle = footer.createEl("button", {
      cls: "goodobsidian-import-help-toggle clickable-icon",
      text: "How do I export?",
      attr: { type: "button", "aria-expanded": "false" },
    });
    const help = el.createDiv({ cls: "goodobsidian-import-help is-hidden" });
    helpToggle.addEventListener("click", () => {
      const open = help.hasClass("is-hidden");
      help.toggleClass("is-hidden", !open);
      helpToggle.setAttribute("aria-expanded", String(open));
    });
    const steps = help.createEl("ul");
    steps.createEl("li", {
      text:
        "Goodnotes: in the library tap Select, pick notebooks or whole folders, tap Export and " +
        "choose the Goodnotes format. Several at once come as one .zip, folders and all. An " +
        "auto-backup .zip in Goodnotes format works too.",
    });
    steps.createEl("li", {
      text:
        "Notability: share or export a note in the Note format. For everything at once, turn " +
        "on Auto-backup with the Note format.",
    });
    steps.createEl("li", {
      text:
        "Xournal++ and Saber: the notebook file itself (.xopp, .xoj, .sbn2, .sba). reMarkable: " +
        "export a notebook as .rmdoc. Supernote: the .note file from the device. FreeNotes: " +
        "share a notebook as a .freenotes file.",
    });
    steps.createEl("li", {
      text:
        "Noteful: export a notebook in the Noteful format (.noteful), or make a backup and pick its " +
        "files. Any other app (Apple Notes, Noteshelf, Nebo, CollaNote…): export a PDF. A PDF " +
        "stays a PDF: you write over its pages, but its own handwriting and text can't be edited.",
    });
    steps.createEl("li", {
      text: "Save the file to this vault's folder or to Files, then choose it here.",
    });
  }
  // --- Step 2: convert and save ------------------------------------------------

  private async run(files: readonly Picked[]): Promise<void> {
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
          const bytes = new Uint8Array(await picked.read());
          if (isPdf(bytes)) {
            // A PDF needs pdf.js to read its pages and ink, so it is read here.
            one = await importPdf(bytes, picked.name);
            for (const result of one.results) {
              written.push({ result, file: await this.save(result) });
            }
          } else {
            // Each notebook is saved, and its files let go, before the next is read.
            one = await importNotebooks(bytes, picked.name, {
              measurePdf: (pdf) => measurePdfPages(ownBuffer(pdf)),
              rasterizePdf: (pdf) => rasterizePdfFirstPage(pdf),
              readPdfInk: async (pdf) => (await readPdfPages(pdf)).pages,
              onResult: async (result) => {
                written.push({ result, file: await this.save(result) });
              },
              cancelled: () => this.closed,
            });
          }
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

  /**
   * Write one converted notebook and its attachments; returns the notebook
   * file. A notebook from a backup's folder goes in that folder, made under
   * the chosen one.
   */
  private async save(result: ImportResult): Promise<TFile> {
    const vault = this.app.vault;
    const dir = await this.makeFolders(importFolder(this.folder, result));
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

  /**
   * Make every folder down to `path` that is missing; returns the path as the
   * vault spells it. A folder that differs only in case is the same folder on
   * Windows, macOS and iOS, so it is used instead of made.
   */
  private async makeFolders(path: string): Promise<string> {
    const vault = this.app.vault;
    let made = "";
    for (const wanted of foldersDownTo(normalizeFolder(path))) {
      const name = wanted.slice(wanted.lastIndexOf("/") + 1);
      const parent = made ? vault.getFolderByPath(made) : vault.getRoot();
      const same = parent?.children.find(
        (child) => child instanceof TFolder && child.name.toLowerCase() === name.toLowerCase(),
      );
      made = same ? same.path : joinVaultPath(made, name);
      if (!vault.getFolderByPath(made)) await vault.createFolder(made);
    }
    return made;
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

/** A PDF from another app: its pages as paper, its ink annotations as ink. */
async function importPdf(bytes: Uint8Array, name: string): Promise<ImportBatch> {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const title = leaf.replace(/\.pdf$/i, "") || "Imported notebook";
  const { pages, madeBy } = await readPdfPages(bytes);
  return { results: [readPdf(bytes, pages, title, madeBy)], failures: [] };
}

/**
 * Open the import dialog. `openImportNotebook(folder)` in the plugin calls
 * this with its own settings.
 */
export function openImportNotebookModal(app: App, options: ImportNotebookOptions): void {
  new ImportNotebookModal(app, options).open();
}
