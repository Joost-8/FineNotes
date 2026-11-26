/**
 * The notebook picker of "Handwrite here (choose notebook…)": Obsidian's fuzzy
 * picker over the vault's notebooks, with a new notebook for the note first.
 */

import { type App, FuzzySuggestModal, type FuzzyMatch, Modal, type TFile, setIcon } from "obsidian";
import { HANDWRITE_BLOCKS, type HandwriteBlocks } from "../model/handwrite-blocks";
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
      /** A new notebook of this name is offered first; none without it. */
      defaultCreateName?: string;
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
    if (options.defaultCreateName !== undefined) {
      list.push({ kind: "create", name: options.defaultCreateName });
    }
    for (const file of notebooks) {
      if (file.path === options.currentNotebook?.path) continue;
      list.push({ kind: "existing", file });
    }
    this.items = list;
  }

  static pick(
    app: App,
    options: {
      /** A new notebook of this name is offered first; none without it. */
      defaultCreateName?: string;
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

/** What a choice of where blocks go is called, in the setting and the first-use question. */
export function handwriteBlocksLabel(mode: HandwriteBlocks): string {
  switch (mode) {
    case "note":
      return t("notebooks.handwrite.modeNote");
    case "ask":
      return t("notebooks.handwrite.modeAsk");
    case "one":
      return t("notebooks.handwrite.modeOne");
  }
}

const MODE_ICONS: Record<HandwriteBlocks, string> = {
  note: "file-text",
  ask: "list",
  one: "book",
};

/**
 * The first "Handwrite here" asks once where blocks go: the three choices,
 * "One notebook per note" picked, and Continue. Closing it any other way
 * keeps what is picked: it never stops the block.
 */
export class HandwriteBlocksModal extends Modal {
  private picked: HandwriteBlocks = "note";
  private done = false;

  constructor(
    app: App,
    private readonly onChosen: (mode: HandwriteBlocks) => void,
  ) {
    super(app);
  }

  static choose(app: App): Promise<HandwriteBlocks> {
    return new Promise((resolve) => new HandwriteBlocksModal(app, resolve).open());
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-hw-blocks-modal");
    this.setTitle(t("notebooks.handwrite.firstUseTitle"));
    const list = this.contentEl.createDiv({
      cls: "goodobsidian-hw-blocks",
      attr: { role: "radiogroup", "aria-label": t("notebooks.handwrite.firstUseTitle") },
    });
    const rows: HTMLElement[] = [];
    const show = (): void => {
      HANDWRITE_BLOCKS.forEach((mode, i) => {
        const on = mode === this.picked;
        rows[i]?.toggleClass("is-active", on);
        rows[i]?.setAttribute("aria-checked", String(on));
      });
    };
    for (const mode of HANDWRITE_BLOCKS) {
      const row = list.createEl("button", {
        cls: "goodobsidian-hw-blocks-row",
        attr: { type: "button", role: "radio" },
      });
      setIcon(row.createSpan({ cls: "goodobsidian-hw-blocks-icon" }), MODE_ICONS[mode]);
      row.createSpan({ cls: "goodobsidian-hw-blocks-name", text: handwriteBlocksLabel(mode) });
      setIcon(row.createSpan({ cls: "goodobsidian-hw-blocks-check" }), "check");
      row.addEventListener("click", () => {
        this.picked = mode;
        show();
      });
      rows.push(row);
    }
    show();
    this.contentEl.createDiv({
      cls: "goodobsidian-hw-blocks-hint",
      text: t("notebooks.handwrite.firstUseHint"),
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const go = buttons.createEl("button", {
      cls: "mod-cta",
      text: t("notebooks.handwrite.continue"),
    });
    go.addEventListener("click", () => this.close());
    window.setTimeout(() => go.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
    if (this.done) return;
    this.done = true;
    this.onChosen(this.picked);
  }
}
