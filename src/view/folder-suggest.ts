/**
 * Picking a vault folder, two ways:
 *
 * - {@link FolderSuggestModal} — a searchable list of every folder, for the
 *   "New notebook" dialog's Folder row and the note settings' folder rows. A full-screen-friendly list is what a
 *   finger on an iPad wants; type-ahead needs the keyboard up.
 * - {@link FolderInputSuggest} — type-ahead on a text field, for the
 *   "Default folder for new notebooks" setting.
 */

import { AbstractInputSuggest, type App, FuzzySuggestModal, type TFolder } from "obsidian";

/** How a folder reads in a list: its path, or "/" for the vault root. */
export function folderLabel(folder: TFolder): string {
  return folder.isRoot() ? "/" : folder.path;
}

/** Every folder in the vault, the root first, then alphabetically. */
function allFolders(app: App): TFolder[] {
  return app.vault
    .getAllFolders(true)
    .sort((a, b) => (a.isRoot() ? -1 : b.isRoot() ? 1 : a.path.localeCompare(b.path)));
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  /**
   * `initial` is the folder chosen so far: it is written in the search field
   * when the list opens, so reopening the picker shows the choice, and the
   * list starts at it and its subfolders.
   */
  constructor(
    app: App,
    private readonly onChoose: (path: string) => void,
    placeholder = "Choose a folder for the new notebook",
    private readonly initial = "",
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  override async onOpen(): Promise<void> {
    // Opening empties the field and lists every folder; write the choice after.
    await super.onOpen();
    if (!this.initial) return;
    this.inputEl.value = this.initial;
    // The list filters on input: tell it the query changed.
    this.inputEl.dispatchEvent(new Event("input"));
  }

  getItems(): TFolder[] {
    return allFolders(this.app);
  }

  getItemText(folder: TFolder): string {
    return folderLabel(folder);
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder.isRoot() ? "" : folder.path);
  }
}

export class FolderInputSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private readonly input: HTMLInputElement,
    private readonly onChoose: (path: string) => void,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): TFolder[] {
    const q = query.trim().toLowerCase();
    return allFolders(this.app).filter((folder) => folderLabel(folder).toLowerCase().includes(q));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folderLabel(folder));
  }

  override selectSuggestion(folder: TFolder): void {
    const path = folder.isRoot() ? "" : folder.path;
    this.input.value = path;
    this.onChoose(path);
    this.close();
  }
}
