/**
 * "Move to another notebook" (FineNotes#33): where the pages selected in the
 * page sidebar should go.
 *
 *   Move 2 pages
 *   [ Move | Copy ]
 *   [ Find a notebook          ]
 *   ( Maths                      )   last used first, then newest edit
 *   ( Physics                    )
 *   ( + New notebook             )
 *                [Cancel] [Move 2 pages]
 *
 * It only hands the choice back; the notebook view does the moving.
 */

import { type App, Modal, setIcon } from "obsidian";
import { type TransferTarget, orderTargets } from "../model/page-transfer";
import { DialogKeyboard } from "./dialog-keyboard";

export type MoveDestination =
  { kind: "notebook"; target: TransferTarget } | { kind: "new"; title: string };

export interface MoveChoice {
  destination: MoveDestination;
  /** Keep the pages here too. */
  copy: boolean;
}

export interface MovePagesOptions {
  /** How many pages are going. */
  count: number;
  /** Every notebook the vault holds, this one too. */
  targets: readonly TransferTarget[];
  /** Paths moved to before, most recent first. */
  recent: readonly string[];
  /** The notebook the pages are in. */
  exclude: string;
  /** Why moving is not on offer here (only Copy is), or `null` when it is. */
  copyOnly: string | null;
  onChoose: (choice: MoveChoice) => void;
}

/** How many notebooks the list shows before "Keep typing to narrow it". */
const SHOWN = 30;

export class MovePagesModal extends Modal {
  private readonly keyboard: DialogKeyboard;
  private copy: boolean;
  private query = "";
  private picked: TransferTarget | "new" | null = null;
  private newTitle = "";
  private list: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  private confirm: HTMLButtonElement | null = null;
  private moveButton: HTMLButtonElement | null = null;
  private copyButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private readonly options: MovePagesOptions,
  ) {
    super(app);
    this.copy = options.copyOnly !== null;
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-move-modal");
    this.titleEl.setText("Move to another notebook");
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");

    const mode = body.createDiv({
      cls: "goodobsidian-move-mode",
      attr: { role: "group", "aria-label": "Move or copy" },
    });
    this.moveButton = mode.createEl("button", {
      cls: "goodobsidian-move-mode-button clickable-icon",
      text: "Move",
    });
    this.copyButton = mode.createEl("button", {
      cls: "goodobsidian-move-mode-button clickable-icon",
      text: "Copy",
    });
    this.moveButton.addEventListener("click", () => this.setCopy(false));
    this.copyButton.addEventListener("click", () => this.setCopy(true));

    const row = body.createDiv({ cls: "goodobsidian-move-search-row" });
    setIcon(row.createSpan({ cls: "goodobsidian-move-search-icon" }), "search");
    const search = row.createEl("input", {
      cls: "goodobsidian-move-search",
      type: "text",
      attr: {
        placeholder: "Find a notebook",
        "aria-label": "Find a notebook",
        enterkeyhint: "search",
        autocomplete: "off",
      },
    });
    this.keyboard.watch(search, row);
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      const first = this.matches()[0];
      if (!this.picked && first) this.picked = first;
      this.submit();
    });

    this.list = body.createDiv({
      cls: "goodobsidian-move-list",
      attr: { role: "listbox", "aria-label": "Notebooks" },
    });
    this.note = body.createDiv({ cls: "goodobsidian-ask-note goodobsidian-move-note" });

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    this.confirm = actions.createEl("button", { cls: "mod-cta" });
    this.confirm.addEventListener("click", () => this.submit());

    this.syncMode();
    this.renderList();
    search.focus();
  }

  private matches(): TransferTarget[] {
    const { targets, recent, exclude } = this.options;
    return orderTargets(targets, recent, this.query, exclude);
  }

  private setCopy(copy: boolean): void {
    this.copy = copy || this.options.copyOnly !== null;
    this.syncMode();
  }

  private syncMode(): void {
    const { count, copyOnly } = this.options;
    const what = count === 1 ? "1 page" : `${count} pages`;
    this.moveButton?.toggleClass("is-active", !this.copy);
    this.copyButton?.toggleClass("is-active", this.copy);
    this.moveButton?.setAttribute("aria-pressed", String(!this.copy));
    this.copyButton?.setAttribute("aria-pressed", String(this.copy));
    if (this.moveButton) this.moveButton.disabled = copyOnly !== null;
    this.confirm?.setText(`${this.copy ? "Copy" : "Move"} ${what}`);
    this.titleEl.setText(`${this.copy ? "Copy" : "Move"} ${what} to another notebook`);
    this.note?.setText(
      copyOnly !== null
        ? copyOnly
        : this.copy
          ? "The pages stay here as well."
          : "Undo (Cmd/Ctrl+Z) brings the pages back here; the copy in the other notebook stays until you delete it.",
    );
  }

  private renderList(): void {
    const list = this.list;
    if (!list) return;
    list.empty();
    const matches = this.matches();
    for (const target of matches.slice(0, SHOWN)) {
      const row = list.createEl("button", {
        cls: "goodobsidian-move-row clickable-icon",
        attr: { role: "option", "aria-selected": String(this.picked === target) },
      });
      setIcon(row.createSpan({ cls: "goodobsidian-move-row-icon" }), "book");
      const text = row.createSpan({ cls: "goodobsidian-move-row-text" });
      text.createSpan({ cls: "goodobsidian-move-row-title", text: target.title });
      const folder = target.path.includes("/")
        ? target.path.slice(0, target.path.lastIndexOf("/"))
        : "";
      if (folder) text.createSpan({ cls: "goodobsidian-move-row-folder", text: folder });
      if (this.options.recent[0] === target.path) {
        row.createSpan({ cls: "goodobsidian-move-row-tag", text: "Last used" });
      }
      row.toggleClass("is-picked", this.picked === target);
      row.addEventListener("click", () => {
        this.picked = target;
        this.renderList();
      });
      row.addEventListener("dblclick", () => {
        this.picked = target;
        this.submit();
      });
    }
    if (matches.length > SHOWN) {
      list.createDiv({
        cls: "goodobsidian-move-more",
        text: `${matches.length - SHOWN} more. Keep typing to narrow the list.`,
      });
    } else if (matches.length === 0 && this.query.trim() !== "") {
      list.createDiv({ cls: "goodobsidian-move-more", text: "No notebook by that name." });
    }
    this.renderNewRow(list);
  }

  /** "New notebook", which opens a title field in its place when picked. */
  private renderNewRow(list: HTMLElement): void {
    const picked = this.picked === "new";
    const row = list.createDiv({
      cls: "goodobsidian-move-new",
      attr: { role: "option", "aria-selected": String(picked) },
    });
    row.toggleClass("is-picked", picked);
    const head = row.createEl("button", { cls: "goodobsidian-move-row clickable-icon" });
    setIcon(head.createSpan({ cls: "goodobsidian-move-row-icon" }), "plus");
    head.createSpan({ cls: "goodobsidian-move-row-title", text: "New notebook" });
    head.addEventListener("click", () => {
      this.picked = "new";
      this.renderList();
      this.list?.querySelector<HTMLInputElement>(".goodobsidian-move-new-field")?.focus();
    });
    if (!picked) return;
    const field = row.createEl("input", {
      cls: "goodobsidian-move-new-field",
      type: "text",
      attr: {
        placeholder: "Notebook title",
        "aria-label": "Title of the new notebook",
        enterkeyhint: "done",
        autocomplete: "off",
      },
    });
    field.value = this.newTitle;
    this.keyboard.watch(field, row);
    field.addEventListener("input", () => {
      this.newTitle = field.value;
    });
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      this.submit();
    });
  }

  private submit(): void {
    const picked = this.picked;
    if (!picked) {
      this.note?.setText("Pick a notebook first.");
      return;
    }
    const destination: MoveDestination =
      picked === "new"
        ? { kind: "new", title: this.newTitle.trim() }
        : { kind: "notebook", target: picked };
    const choice: MoveChoice = { destination, copy: this.copy };
    this.close();
    this.options.onChoose(choice);
  }

  override onClose(): void {
    this.list = null;
    this.note = null;
    this.keyboard.end();
    this.contentEl.empty();
  }
}
