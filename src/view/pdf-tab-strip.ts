/**
 * The PDF tabs of a notebook (`model/beside-pdfs.ts`): a strip under the
 * tool bar, shown only once a PDF is attached, and the + list it opens.
 *
 *   [▤ Notes] [▢ W3 Hashing ✕] [▢ Exercises 3] [+]
 *
 * The strip looks like Obsidian's own tab headers, not like the binder tabs
 * on the page's edge. A tap swaps the view to that tab; the active PDF tab
 * has an ✕ (it closes the tab; the PDF stays attached). A long press or a
 * right-click opens Rename and Close (and Find file for a missing PDF). A
 * missing PDF's tab is grey and italic, and its one action is Find file.
 *
 * The + list: a search field, "In this notebook" (every attached PDF, open
 * ones marked), "In this folder" (PDFs beside the notebook not attached
 * yet, newest first), then From the vault… and From this device….
 *
 * It only shows and reports; the notebook view does the rest.
 */

import { Menu, setIcon } from "obsidian";
import { t } from "../i18n/translate";
import { NOTES_TAB, type PlusList } from "../model/pdf-tabs-list";
import { DialogKeyboard } from "./dialog-keyboard";
import { installPopoverDismiss, placePopover } from "./template-picker";
import { docOf, shownDoc, winOf } from "./host-window";

/** A tab as the strip shows it. */
export interface StripTab {
  id: string;
  label: string;
  /** The file is not in the vault. */
  missing: boolean;
}

export interface PdfTabStripCallbacks {
  /** Show this tab ({@link NOTES_TAB} for the notes). */
  onSelect: (id: string) => void;
  /** Close a PDF's tab; the PDF stays attached. */
  onClose: (id: string) => void;
  onRename: (id: string) => void;
  /** Point a missing PDF's tab at a file in the vault. */
  onFindFile: (id: string) => void;
  /** The + button: the list of PDFs. */
  onPlus: (anchor: HTMLElement) => void;
}

/** How long a finger rests on a tab before its menu opens, ms. */
const LONG_PRESS_MS = 500;
/** How far it may move meanwhile and still be a press, CSS px. */
const LONG_PRESS_SLOP = 10;

export class PdfTabStrip {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly plus: HTMLButtonElement;
  private tabs: StripTab[] = [];
  private active = NOTES_TAB;
  /** A long press opened a menu: the click that follows is not a tap. */
  private pressedMenu = false;
  private pressTimer = 0;
  /** The tab a dragged snippet is over (`setDropTarget`). */
  private dropTarget: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: PdfTabStripCallbacks,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-pdf-tabs is-hidden" });
    // A finger swipe along the strip scrolls it, not one of Obsidian's swipes.
    this.el.dataset.ignoreSwipe = "true";
    this.list = this.el.createDiv({
      cls: "goodobsidian-pdf-tabs-list",
      attr: { role: "tablist", "aria-label": t("view.pdfTabs.label") },
    });
    this.plus = this.el.createEl("button", {
      cls: "goodobsidian-pdf-tab-plus clickable-icon",
      attr: { "aria-label": t("view.pdfTabs.add"), "aria-haspopup": "dialog" },
    });
    setIcon(this.plus, "plus");
    this.plus.addEventListener("click", () => this.callbacks.onPlus(this.plus));
  }

  /** The tab that is shown, by id. */
  get activeTab(): string {
    return this.active;
  }

  /** The + button, which the + list hangs from. */
  get plusButton(): HTMLElement {
    return this.plus;
  }

  /**
   * The tab at client point (x, y), by id, or null. A dragged snippet holds
   * its pointer captured, so no tab hears it enter: the drag asks here.
   */
  tabAt(x: number, y: number): string | null {
    if (this.el.hasClass("is-hidden")) return null;
    for (const el of Array.from(this.list.querySelectorAll<HTMLElement>(".goodobsidian-pdf-tab"))) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el.dataset.tab ?? null;
    }
    return null;
  }

  /** Light tab `id` up as where a dragged snippet will go (null: none). */
  setDropTarget(id: string | null): void {
    if (id === this.dropTarget) return;
    this.dropTarget = id;
    for (const el of Array.from(this.list.querySelectorAll<HTMLElement>(".goodobsidian-pdf-tab")))
      el.toggleClass("is-drop-target", el.dataset.tab === id);
  }

  /**
   * Show these PDF tabs after Notes, `active` raised. `shown` false hides
   * the strip (a notebook with no PDF attached looks as it always did).
   */
  render(tabs: readonly StripTab[], active: string, shown: boolean): void {
    this.tabs = [...tabs];
    this.active = active;
    this.el.toggleClass("is-hidden", !shown);
    this.list.empty();
    this.tab({ id: NOTES_TAB, label: t("view.pdfTabs.notes"), missing: false }, "notebook-pen");
    for (const tab of this.tabs) this.tab(tab, "file-text");
    // The active tab in view, on a strip that scrolls sideways.
    const on = this.list.querySelector<HTMLElement>(".is-active");
    if (on && shown && typeof on.scrollIntoView === "function")
      on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private tab(tab: StripTab, icon: string): void {
    const active = tab.id === this.active;
    const notes = tab.id === NOTES_TAB;
    const el = this.list.createDiv({
      cls: "goodobsidian-pdf-tab",
      attr: { "data-tab": tab.id },
    });
    el.toggleClass("is-active", active);
    el.toggleClass("is-missing", tab.missing);
    el.toggleClass("is-drop-target", tab.id === this.dropTarget);
    const button = el.createEl("button", {
      cls: "goodobsidian-pdf-tab-main clickable-icon",
      attr: {
        role: "tab",
        "aria-selected": String(active),
        "aria-label": tab.missing ? t("view.pdfTabs.missing", { name: tab.label }) : tab.label,
      },
    });
    setIcon(button.createSpan({ cls: "goodobsidian-pdf-tab-icon" }), icon);
    button.createSpan({ cls: "goodobsidian-pdf-tab-label", text: tab.label });
    button.addEventListener("click", () => {
      if (this.pressedMenu) {
        this.pressedMenu = false;
        return;
      }
      if (!active) this.callbacks.onSelect(tab.id);
    });
    if (notes) return;
    if (tab.missing && active) {
      // Its one action, in words: a symbol would be guessed at.
      const find = el.createEl("button", {
        cls: "goodobsidian-pdf-tab-find clickable-icon",
        text: t("view.pdfTabs.findFile"),
      });
      find.addEventListener("click", () => this.callbacks.onFindFile(tab.id));
    }
    if (active) {
      const close = el.createEl("button", {
        cls: "goodobsidian-pdf-tab-close clickable-icon",
        attr: { "aria-label": t("view.pdfTabs.close", { name: tab.label }) },
      });
      setIcon(close, "x");
      close.addEventListener("click", () => this.callbacks.onClose(tab.id));
    }
    this.bindMenu(button, tab);
  }

  /** Right-click, or a finger held on the tab: Rename, Close (and Find file). */
  private bindMenu(button: HTMLElement, tab: StripTab): void {
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      // The long press already opened it.
      if (this.pressTimer === 0 && this.pressedMenu) return;
      this.openMenu(tab, event.clientX, event.clientY);
    });
    let start: { x: number; y: number; id: number } | null = null;
    const cancel = (): void => {
      winOf(button).clearTimeout(this.pressTimer);
      this.pressTimer = 0;
      start = null;
    };
    button.addEventListener("pointerdown", (event) => {
      this.pressedMenu = false;
      if (event.pointerType === "mouse") return;
      cancel();
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      this.pressTimer = winOf(button).setTimeout(() => {
        this.pressTimer = 0;
        if (!start) return;
        this.pressedMenu = true;
        this.openMenu(tab, start.x, start.y);
        start = null;
      }, LONG_PRESS_MS);
    });
    button.addEventListener("pointermove", (event) => {
      if (!start || event.pointerId !== start.id) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancel();
    });
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointercancel", cancel);
  }

  private openMenu(tab: StripTab, x: number, y: number): void {
    const menu = new Menu();
    if (tab.missing)
      menu.addItem((item) =>
        item
          .setTitle(t("view.pdfTabs.findFile"))
          .setIcon("file-search")
          .onClick(() => this.callbacks.onFindFile(tab.id)),
      );
    menu.addItem((item) =>
      item
        .setTitle(t("common.rename"))
        .setIcon("pencil")
        .onClick(() => this.callbacks.onRename(tab.id)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("view.pdfTabs.closeTab"))
        .setIcon("x")
        .onClick(() => this.callbacks.onClose(tab.id)),
    );
    menu.showAtPosition({ x, y }, docOf(this.el));
  }

  destroy(): void {
    winOf(this.el).clearTimeout(this.pressTimer);
    this.el.remove();
  }
}

// --- The + list --------------------------------------------------------------------

export interface PdfTabsPopoverOptions {
  /** The list for what is typed in the search field. */
  list: (query: string) => PlusList;
  /** An attached PDF: show its tab (opening it if it was closed). */
  onOpenAttached: (id: string) => void;
  /** A PDF beside the notebook: attach it, and show its tab. */
  onAttach: (path: string) => void;
  /** From the vault…: pick any PDF in the vault. */
  onFromVault: () => void;
  /** From this device…: a PDF from outside the vault, saved beside the notebook. */
  onFromDevice: () => void;
  onClose?: () => void;
}

/** How wide the + list is, CSS px. */
const POPOVER_WIDTH = 300;
/** How many attached PDFs it lists before "+ N more" (the search finds the rest). */
const ATTACHED_SHOWN = 8;

export class PdfTabsPopover {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly keyboard: DialogKeyboard;
  private readonly dispose: Array<() => void> = [];
  private query = "";
  private closed = false;

  constructor(
    private readonly anchor: HTMLElement,
    private readonly options: PdfTabsPopoverOptions,
  ) {
    this.el = shownDoc().body.createDiv({ cls: "goodobsidian-pdf-tabs-popover" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", t("view.pdfTabs.add"));
    this.el.dataset.ignoreSwipe = "true";
    this.keyboard = new DialogKeyboard(this.el);
    const search = this.el.createDiv({ cls: "goodobsidian-pdf-tabs-search" });
    setIcon(search.createSpan({ cls: "goodobsidian-pdf-tabs-search-icon" }), "search");
    const input = search.createEl("input", {
      type: "search",
      attr: {
        placeholder: t("view.pdfTabs.find"),
        "aria-label": t("view.pdfTabs.find"),
        enterkeyhint: "search",
      },
    });
    input.addEventListener("input", () => {
      this.query = input.value;
      this.render();
    });
    this.keyboard.watch(input, search);
    this.body = this.el.createDiv({ cls: "goodobsidian-pdf-tabs-rows" });
    this.render();
    placePopover(this.el, anchor, POPOVER_WIDTH);
    this.dispose.push(
      installPopoverDismiss(
        this.el,
        anchor,
        () => this.close(),
        () => placePopover(this.el, anchor, POPOVER_WIDTH),
      ),
    );
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  get anchorEl(): HTMLElement {
    return this.anchor;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.keyboard.end();
    for (const d of this.dispose) d();
    this.el.remove();
    this.options.onClose?.();
  }

  private render(): void {
    const body = this.body;
    body.empty();
    const { attached, attachedTotal, inFolder } = this.options.list(this.query);
    if (attachedTotal > 0) {
      body.createDiv({
        cls: "goodobsidian-pdf-tabs-heading",
        text: t("view.pdfTabs.inNotebook", { count: attachedTotal }),
      });
      const searching = this.query.trim().length > 0;
      const shown = searching ? attached : attached.slice(0, ATTACHED_SHOWN);
      for (const row of shown) {
        const el = this.row("file-text", row.label, () =>
          this.pick(() => this.options.onOpenAttached(row.id)),
        );
        el.toggleClass("is-missing", row.missing);
        if (row.open) {
          // Open in the strip: a mark, not a sentence.
          const mark = el.createSpan({ cls: "goodobsidian-pdf-tabs-open" });
          setIcon(mark, "check");
          el.setAttribute("aria-label", t("view.pdfTabs.openRow", { name: row.label }));
        }
      }
      if (shown.length < attached.length)
        body.createDiv({
          cls: "goodobsidian-pdf-tabs-more",
          text: t("view.pdfTabs.more", { count: attached.length - shown.length }),
        });
    }
    if (inFolder.length > 0) {
      body.createDiv({ cls: "goodobsidian-pdf-tabs-heading", text: t("view.pdfTabs.inFolder") });
      for (const pdf of inFolder) {
        const name = pdf.path.slice(pdf.path.lastIndexOf("/") + 1).replace(/\.pdf$/i, "");
        const el = this.row("file-plus", name, () =>
          this.pick(() => this.options.onAttach(pdf.path)),
        );
        // Not attached yet: a dot.
        el.createSpan({ cls: "goodobsidian-pdf-tabs-new" });
        el.setAttribute("aria-label", t("view.pdfTabs.attachRow", { name }));
      }
    }
    if (body.childElementCount > 0) body.createDiv({ cls: "goodobsidian-popover-divider" });
    this.row("vault", t("view.pdfTabs.fromVault"), () => this.pick(this.options.onFromVault));
    this.row("upload", t("view.pdfTabs.fromDevice"), () => this.pick(this.options.onFromDevice));
  }

  private row(icon: string, text: string, run: () => void): HTMLElement {
    const el = this.body.createEl("button", {
      cls: "goodobsidian-pdf-tabs-row clickable-icon",
    });
    setIcon(el.createSpan({ cls: "goodobsidian-pdf-tabs-row-icon" }), icon);
    el.createSpan({ cls: "goodobsidian-pdf-tabs-row-label", text });
    el.addEventListener("click", run);
    return el;
  }

  /** A row was chosen: the list goes, then the choice runs (it may open a dialog). */
  private pick(run: () => void): void {
    this.close();
    run();
  }
}
