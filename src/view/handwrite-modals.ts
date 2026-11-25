/**
 * FineNotes-native prompts for Handwrite Here:
 * - {@link HandwriteSetupModal}: shown once on first use so the user can pick
 *   their preferred notebook strategy ("Ask once per note", "Automatic", or
 *   "Always ask") with clear descriptions.
 * - {@link InlineNotebookPickerModal}: native fuzzy picker of existing
 *   `.notebook.md` files plus a "Create new notebook" option at the top.
 */

import { type App, FuzzySuggestModal, type FuzzyMatch, Modal, type TFile, setIcon } from "obsidian";
import { NOTEBOOK_FILE_SUFFIX } from "../constants";
import { stripInkSuffix } from "../model/new-notebook";

export type InlineHandwriteMode = "once" | "auto" | "always";

interface ModeOption {
  id: InlineHandwriteMode;
  icon: string;
  title: string;
  badge?: string;
  desc: string;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  {
    id: "once",
    icon: "book-marked",
    title: "Ask once per note",
    badge: "Recommended",
    desc: "Choose or create a notebook the first time you handwrite in a note, then reuse it automatically.",
  },
  {
    id: "auto",
    icon: "sparkles",
    title: "Automatic (one per note)",
    desc: "Never ask — automatically creates a matching notebook in your attachments folder.",
  },
  {
    id: "always",
    icon: "folder-search",
    title: "Always ask",
    desc: "Choose which notebook to store each block in every time you run Handwrite here.",
  },
];

/**
 * First-time Handwrite Here setup prompt styled to match FineNotes' native
 * modals (`goodobsidian-ask`).
 */
export class HandwriteSetupModal extends Modal {
  private selected: InlineHandwriteMode;
  private resolved = false;

  constructor(
    app: App,
    initial: InlineHandwriteMode,
    private readonly onChoose: (mode: InlineHandwriteMode | null) => void,
  ) {
    super(app);
    this.selected = initial;
  }

  static prompt(
    app: App,
    initial: InlineHandwriteMode = "once",
  ): Promise<InlineHandwriteMode | null> {
    return new Promise((resolve) => {
      new HandwriteSetupModal(app, initial, resolve).open();
    });
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("goodobsidian-hw-setup-modal");
    contentEl.addClass("goodobsidian-ask", "goodobsidian-hw-setup");
    this.setTitle("Where should inline handwriting live?");

    contentEl.createDiv({
      cls: "goodobsidian-hw-setup-sub",
      text: "Each handwriting block is stored as a page inside a FineNotes notebook and embedded in your note.",
    });

    const list = contentEl.createDiv({
      cls: "goodobsidian-hw-setup-cards",
      attr: { role: "radiogroup", "aria-label": "Inline handwriting notebook preference" },
    });

    const cardButtons = new Map<InlineHandwriteMode, HTMLButtonElement>();
    const sync = (): void => {
      for (const [id, btn] of cardButtons) {
        const active = id === this.selected;
        btn.toggleClass("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      }
    };

    for (const opt of MODE_OPTIONS) {
      const card = list.createEl("button", {
        cls: "clickable-icon goodobsidian-hw-setup-card",
        attr: { type: "button", role: "radio", "aria-checked": String(opt.id === this.selected) },
      });
      const iconWrap = card.createSpan({ cls: "goodobsidian-hw-setup-icon" });
      setIcon(iconWrap, opt.icon);

      const copy = card.createDiv({ cls: "goodobsidian-hw-setup-copy" });
      const heading = copy.createDiv({ cls: "goodobsidian-hw-setup-title" });
      heading.createSpan({ text: opt.title });
      if (opt.badge) {
        heading.createSpan({ cls: "goodobsidian-hw-setup-badge", text: opt.badge });
      }
      copy.createDiv({ cls: "goodobsidian-hw-setup-desc", text: opt.desc });

      card.addEventListener("click", () => {
        this.selected = opt.id;
        sync();
      });
      cardButtons.set(opt.id, card);
    }
    sync();

    contentEl.createDiv({
      cls: "goodobsidian-hw-setup-hint",
      text: "You can change this anytime in FineNotes Settings → Pages.",
    });

    const actions = contentEl.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const go = actions.createEl("button", { cls: "mod-cta", text: "Continue" });
    go.addEventListener("click", () => {
      this.resolved = true;
      this.onChoose(this.selected);
      this.close();
    });
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.onChoose(null);
    }
  }
}

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
    if (item.kind === "create") return `Create new notebook: ${item.name}`;
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
        text: `Create "${item.name}.notebook"`,
      });
      text.createDiv({
        cls: "goodobsidian-hw-pick-sub",
        text: "New FineNotes notebook in your inline handwriting folder",
      });
    } else {
      const title = text.createDiv({ cls: "goodobsidian-hw-pick-title" });
      title.createSpan({ text: stripInkSuffix(item.file.basename) });
      if (item.current) {
        title.createSpan({ cls: "goodobsidian-hw-setup-badge", text: "Current" });
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
