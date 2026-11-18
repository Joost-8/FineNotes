/**
 * Pick a file from the vault: its folders to browse, as Obsidian's file list
 * shows them, with the files of the kind asked for in each to tap; typing in
 * the field above searches every such file instead. Import PDF › From vault
 * and Insert image › From vault are both this (the list is in
 * `model/vault-picker.ts`).
 *
 *   [ Find a PDF in the vault…                ]
 *   ‹  Courses                                   (back to the folder above)
 *   📁 Lecture Slides                        14
 *   📄 handout
 *
 * On the iPad the field stays above the keyboard (DialogKeyboard) and its
 * Return picks the row selected (enter-key.ts); rows are finger-sized
 * (styles.css, `.goodobsidian-file-pick`).
 */

import { type App, SuggestModal, type TFile, setIcon } from "obsidian";
import {
  type PickerFile,
  type PickerFolder,
  browseFiles,
  searchFiles,
} from "../model/vault-picker";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { t } from "../i18n/translate";

/** A row: back to the folder above, a folder to open, or a file to take. */
export type PickRow =
  | { kind: "up"; path: string }
  | { kind: "folder"; folder: PickerFolder }
  | { kind: "file"; file: PickerFile; showFolder: boolean };

export interface VaultFilePickerOptions {
  /** Which files are offered, by path. */
  accepts: (path: string) => boolean;
  /** The field's placeholder. */
  placeholder: string;
  /** What the list says with nothing to show. */
  empty: string;
  /** The Lucide icon of a file row. */
  icon: string;
  /** Show each file's extension beside its name (the kind offered has several). */
  showExtension?: boolean;
  /** Where the last pick was made, by picker: the next one opens there (this session). */
  memory: { folder: string };
}

export class VaultFilePicker extends SuggestModal<PickRow> {
  private readonly keyboard: DialogKeyboard;
  private readonly paths: string[];
  private folder: string;

  constructor(
    app: App,
    private readonly options: VaultFilePickerOptions,
    private readonly pick: (file: TFile) => void,
  ) {
    super(app);
    this.paths = app.vault
      .getFiles()
      .filter((file) => options.accepts(file.path))
      .map((file) => file.path);
    // Where the last file was picked, while it still leads to one.
    const kept = browseFiles(this.paths, options.memory.folder);
    this.folder = kept.folders.length + kept.files.length > 0 ? options.memory.folder : "";
    this.keyboard = new DialogKeyboard(this.modalEl);
    this.modalEl.addClass("goodobsidian-file-pick");
    this.limit = 500;
    this.setPlaceholder(options.placeholder);
    this.emptyStateText = options.empty;
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
      return searchFiles(this.paths, query).map((file) => ({
        kind: "file",
        file,
        showFolder: true,
      }));
    }
    const here = browseFiles(this.paths, this.folder);
    return [
      ...(here.up === null ? [] : [{ kind: "up" as const, path: here.up }]),
      ...here.folders.map((folder) => ({ kind: "folder" as const, folder })),
      ...here.files.map((file) => ({ kind: "file" as const, file, showFolder: false })),
    ];
  }

  renderSuggestion(row: PickRow, el: HTMLElement): void {
    el.addClass("goodobsidian-link-choice", `is-${row.kind}`);
    const icon =
      row.kind === "up" ? "chevron-left" : row.kind === "folder" ? "folder" : this.options.icon;
    setIcon(el.createSpan({ cls: "goodobsidian-link-choice-icon" }), icon);
    const text = el.createDiv({ cls: "goodobsidian-link-choice-text" });
    const title = text.createDiv({ cls: "goodobsidian-link-choice-title" });
    const aux = (value: string): void => {
      el.createSpan({ cls: "goodobsidian-file-pick-aux", text: value });
    };
    switch (row.kind) {
      case "up": {
        // Back is named by where it goes, as a navigation bar does.
        const name = row.path === "" ? this.app.vault.getName() : row.path.split("/").pop();
        title.setText(name ?? row.path);
        el.setAttribute("aria-label", t("common.backTo", { name: name ?? row.path }));
        break;
      }
      case "folder":
        title.setText(row.folder.name);
        aux(String(row.folder.count));
        break;
      case "file":
        title.setText(row.file.name);
        if (row.showFolder && row.file.folder !== "") {
          text.createDiv({ cls: "goodobsidian-link-choice-sub", text: row.file.folder });
        }
        if (this.options.showExtension && row.file.ext !== "") aux(row.file.ext.toUpperCase());
        break;
    }
  }

  /** A folder (or back) opens in place, the list staying up; a file is taken. */
  override selectSuggestion(row: PickRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.kind === "file") {
      super.selectSuggestion(row, evt);
      return;
    }
    this.openFolder(row.kind === "up" ? row.path : row.folder.path);
  }

  onChooseSuggestion(row: PickRow): void {
    if (row.kind !== "file") return;
    const file = this.app.vault.getFileByPath(row.file.path);
    if (!file) return;
    this.options.memory.folder = row.file.folder;
    this.pick(file);
  }

  private openFolder(path: string): void {
    this.folder = path;
    this.options.memory.folder = path;
    this.inputEl.value = "";
    // The list follows the field: an input event rebuilds it from the folder now open.
    this.inputEl.dispatchEvent(new Event("input"));
    this.resultContainerEl.scrollTop = 0;
  }
}
