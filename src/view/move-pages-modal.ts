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
import { t, tn } from "../i18n/translate";
import { type TransferTarget, orderTargets } from "../model/page-transfer";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";

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
    this.titleEl.setText(t("view.movePages.title"));
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");

    const mode = body.createDiv({
      cls: "goodobsidian-move-mode",
      attr: { role: "group", "aria-label": t("view.movePages.modeLabel") },
    });
    this.moveButton = mode.createEl("button", {
      cls: "goodobsidian-move-mode-button clickable-icon",
      text: t("view.movePages.move"),
    });
    this.copyButton = mode.createEl("button", {
      cls: "goodobsidian-move-mode-button clickable-icon",
      text: t("common.copy"),
    });
    this.moveButton.addEventListener("click", () => this.setCopy(false));
    this.copyButton.addEventListener("click", () => this.setCopy(true));

    const row = body.createDiv({ cls: "goodobsidian-move-search-row" });
    setIcon(row.createSpan({ cls: "goodobsidian-move-search-icon" }), "search");
    const search = row.createEl("input", {
      cls: "goodobsidian-move-search",
      type: "text",
      attr: {
        placeholder: t("view.movePages.find"),
        "aria-label": t("view.movePages.find"),
        enterkeyhint: "search",
        autocomplete: "off",
      },
    });
    this.keyboard.watch(search, row);
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList();
    });
    onEnterKey(search, () => {
      const first = this.matches()[0];
      if (!this.picked && first) this.picked = first;
      this.submit();
    });

    this.list = body.createDiv({
      cls: "goodobsidian-move-list",
      attr: { role: "listbox", "aria-label": t("view.movePages.listLabel") },
    });
    this.note = body.createDiv({ cls: "goodobsidian-ask-note goodobsidian-move-note" });

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    actions
      .createEl("button", { text: t("common.cancel") })
      .addEventListener("click", () => this.close());
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
    this.moveButton?.toggleClass("is-active", !this.copy);
    this.copyButton?.toggleClass("is-active", this.copy);
    this.moveButton?.setAttribute("aria-pressed", String(!this.copy));
    this.copyButton?.setAttribute("aria-pressed", String(this.copy));
    if (this.moveButton) this.moveButton.disabled = copyOnly !== null;
    this.confirm?.setText(
      this.copy ? tn("view.movePages.confirmCopy", count) : tn("view.movePages.confirmMove", count),
    );
    this.titleEl.setText(
      this.copy ? tn("view.movePages.titleCopy", count) : tn("view.movePages.titleMove", count),
    );
    this.note?.setText(
      copyOnly !== null
        ? copyOnly
        : this.copy
          ? t("view.movePages.copyNote")
          : t("view.movePages.moveNote"),
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
        row.createSpan({ cls: "goodobsidian-move-row-tag", text: t("view.movePages.lastUsed") });
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
        text: t("view.movePages.more", { count: matches.length - SHOWN }),
      });
    } else if (matches.length === 0 && this.query.trim() !== "") {
      list.createDiv({ cls: "goodobsidian-move-more", text: t("view.movePages.none") });
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
    head.createSpan({ cls: "goodobsidian-move-row-title", text: t("view.movePages.newNotebook") });
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
        placeholder: t("view.movePages.newTitlePlaceholder"),
        "aria-label": t("view.movePages.newTitleLabel"),
        enterkeyhint: "done",
        autocomplete: "off",
      },
    });
    field.value = this.newTitle;
    this.keyboard.watch(field, row);
    field.addEventListener("input", () => {
      this.newTitle = field.value;
    });
    onEnterKey(field, () => this.submit());
  }

  private submit(): void {
    const picked = this.picked;
    if (!picked) {
      this.note?.setText(t("view.movePages.pickFirst"));
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
