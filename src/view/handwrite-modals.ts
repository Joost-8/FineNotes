/**
 * The notebook picker of "Handwrite here (choose notebook…)": Obsidian's fuzzy
 * picker over the vault's notebooks, with a new notebook for the note first.
 */

import { type App, FuzzySuggestModal, type FuzzyMatch, type TFile, setIcon } from "obsidian";
import { NOTEBOOK_FILE_SUFFIX } from "../constants";
import { t } from "../i18n/translate";
import { stripInkSuffix } from "../model/new-notebook";

export type NotebookPickChoice =
  { kind: "create"; name: string } | { kind: "existing"; file: TFile; current?: boolean };

/**
 * Native Obsidian fuzzy picker for choosing an existing `.notebook.md` or
 * creating a new one for Handwrite Here.
 */
export class InlineNotebookPickerModal extends FuzzySuggestModal<NotebookPickChoice> {
  private resolved = false;
  private readonly items: NotebookPickChoice[];

  constructor(
    app: App,
    options: {
      defaultCreateName: string;
      currentNotebook?: TFile | null;
      placeholder: string;
    },
    private readonly onPick: (choice: NotebookPickChoice | null) => void,
  ) {
    super(app);
    this.setPlaceholder(options.placeholder);

    const notebooks = app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().endsWith(NOTEBOOK_FILE_SUFFIX))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    const list: NotebookPickChoice[] = [];
    if (options.currentNotebook) {
      list.push({ kind: "existing", file: options.currentNotebook, current: true });
    }
    list.push({ kind: "create", name: options.defaultCreateName });
    for (const file of notebooks) {
      if (file.path === options.currentNotebook?.path) continue;
      list.push({ kind: "existing", file });
    }
    this.items = list;
  }

  static pick(
    app: App,
    options: {
      defaultCreateName: string;
      currentNotebook?: TFile | null;
      placeholder: string;
    },
  ): Promise<NotebookPickChoice | null> {
    return new Promise((resolve) => {
      new InlineNotebookPickerModal(app, options, resolve).open();
    });
  }

  override getItems(): NotebookPickChoice[] {
    return this.items;
  }

  override getItemText(item: NotebookPickChoice): string {
    if (item.kind === "create") return t("notebooks.handwrite.pickCreate", { name: item.name });
    return `${stripInkSuffix(item.file.basename)} ${item.file.parent?.path ?? ""}`;
  }

  override renderSuggestion(match: FuzzyMatch<NotebookPickChoice>, el: HTMLElement): void {
    const item = match.item;
    el.addClass("goodobsidian-hw-pick-row");
    const icon = el.createSpan({ cls: "goodobsidian-hw-pick-icon" });
    setIcon(icon, item.kind === "create" ? "plus-circle" : "book-open");
    const text = el.createDiv({ cls: "goodobsidian-hw-pick-text" });
    if (item.kind === "create") {
      text.createDiv({
        cls: "goodobsidian-hw-pick-title",
        text: t("notebooks.handwrite.pickCreate", { name: item.name }),
      });
      text.createDiv({
        cls: "goodobsidian-hw-pick-sub",
        text: t("notebooks.handwrite.pickCreateSub"),
      });
    } else {
      const title = text.createDiv({ cls: "goodobsidian-hw-pick-title" });
      title.createSpan({ text: stripInkSuffix(item.file.basename) });
      if (item.current) {
        title.createSpan({
          cls: "goodobsidian-hw-pick-badge",
          text: t("notebooks.handwrite.pickCurrent"),
        });
      }
      text.createDiv({
        cls: "goodobsidian-hw-pick-sub",
        text: item.file.parent && !item.file.parent.isRoot() ? item.file.parent.path : "/",
      });
    }
  }

  override onChooseItem(item: NotebookPickChoice): void {
    this.resolved = true;
    this.onPick(item);
  }

  override onClose(): void {
    super.onClose();
    if (!this.resolved) {
      this.resolved = true;
      // Defer slightly so onChooseItem runs first on click/Enter.
      window.setTimeout(() => this.onPick(null), 0);
    }
  }
}
