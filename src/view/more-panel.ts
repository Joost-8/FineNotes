/**
 * The ⋯ panel beside the toolbar's settings gear: GoodNotes' "More" sheet, from
 * the screen recording Joost supplied (2026-09-22), built from what this
 * plugin has.
 *
 *   More
 *   ┌ Page 3                      [thumb] ┐
 *   │ Bookmark page / Remove bookmark     │
 *   │ Copy link to page                   │
 *   │ Duplicate page                      │
 *   │ Change template (or cover)          │
 *   │ Go to page                  (1 – 9) │
 *   └─────────────────────────────────────┘
 *   Clear or delete page
 *   ┌ Clear page · Delete page (red)      ┐
 *
 * GoodNotes also puts its settings in this sheet; here the gear beside ⋯
 * keeps them (Joost, 2026-09-22: "setting icon wheel is fine").
 *
 * It lives on `<body>`, like the other toolbar sheets, and closes on any
 * press or swipe outside it, on Escape, or on a second tap on ⋯ — as the
 * GoodNotes sheet goes away the moment the page is touched. It only reports
 * what was chosen; the host does it.
 */

import { setIcon } from "obsidian";
import { DialogKeyboard } from "./dialog-keyboard";

export interface MorePanelPage {
  /** Zero-based index of the page the panel is about. */
  index: number;
  total: number;
  bookmarked: boolean;
  /** A cover page changes cover, not template. */
  cover: boolean;
  /** A single page cannot be duplicated or deleted. */
  single: boolean;
  /** Whether there is ink to clear. */
  clearable: boolean;
}

export interface MorePanelActions {
  // Properties holding functions, not methods (CLAUDE.md: a callback is a value).
  paintThumbnail: (canvas: HTMLCanvasElement, index: number, cssWidth: number) => void;
  toggleBookmark: (index: number) => void;
  copyLink: (index: number) => void;
  duplicate: (index: number) => void;
  changeTemplate: (index: number, anchor: HTMLElement) => void;
  goToPage: (index: number) => void;
  clear: (index: number) => void;
  remove: (index: number) => void;
}

const PANEL_WIDTH = 330;
const THUMB_WIDTH = 34;

export class MorePanel {
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  /**
   * Keeps the go-to-page field above the iPad keyboard and lifts Obsidian's
   * keyboard cap meanwhile: without it the field sat under the keyboard and
   * the notebook behind went black (Joost, 2026-09-24).
   */
  private readonly keyboard: DialogKeyboard;
  private closed = false;

  constructor(
    private readonly anchor: HTMLElement,
    private readonly page: MorePanelPage,
    private readonly actions: MorePanelActions,
  ) {
    this.el = document.body.createDiv({ cls: "goodobsidian-more" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "More");
    this.keyboard = new DialogKeyboard(this.el);
    this.render();
    this.place();
    this.installDismiss();
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
  }

  private render(): void {
    const { page, actions } = this;
    this.el.createDiv({ cls: "goodobsidian-more-title", text: "More" });

    const card = this.group();
    const head = card.createDiv({ cls: "goodobsidian-more-pagehead" });
    head.createSpan({ cls: "goodobsidian-more-pagename", text: `Page ${page.index + 1}` });
    const thumb = head.createEl("canvas", { cls: "goodobsidian-more-thumb" });
    actions.paintThumbnail(thumb, page.index, THUMB_WIDTH);

    this.row(card, {
      icon: page.bookmarked ? "bookmark-minus" : "bookmark",
      text: page.bookmarked ? "Remove bookmark" : "Bookmark page",
      cls: page.bookmarked ? "is-bookmarked" : "",
      run: () => actions.toggleBookmark(page.index),
    });
    this.row(card, {
      icon: "link",
      text: "Copy link to page",
      run: () => actions.copyLink(page.index),
    });
    if (!page.single) {
      this.row(card, {
        icon: "copy",
        text: "Duplicate page",
        run: () => actions.duplicate(page.index),
      });
    }
    this.row(card, {
      icon: page.cover ? "palette" : "layout-template",
      text: page.cover ? "Change cover" : "Change template",
      run: (button) => actions.changeTemplate(page.index, button),
    });
    if (page.total > 1) this.goToRow(card);

    this.heading("Clear or delete page");
    const danger = this.group();
    this.row(danger, {
      icon: "x-circle",
      text: "Clear page",
      cls: "is-danger",
      enabled: page.clearable,
      run: () => actions.clear(page.index),
    });
    this.row(danger, {
      icon: "trash-2",
      text: "Delete page",
      cls: "is-danger",
      enabled: page.total > 1,
      run: () => actions.remove(page.index),
    });
  }

  private group(): HTMLElement {
    return this.el.createDiv({ cls: "goodobsidian-more-group" });
  }

  private heading(text: string): void {
    this.el.createDiv({ cls: "goodobsidian-more-heading", text });
  }

  /**
   * One row: icon, label, and whatever sits at its end. Choosing it closes
   * the panel first, so a picker it opens is not closed by the panel's own
   * outside-press handling.
   */
  private row(
    parent: HTMLElement,
    options: {
      icon: string;
      text: string;
      cls?: string;
      enabled?: boolean;
      run: (button: HTMLButtonElement) => void;
    },
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `goodobsidian-more-row clickable-icon${options.cls ? ` ${options.cls}` : ""}`,
    });
    setIcon(button.createSpan({ cls: "goodobsidian-more-icon" }), options.icon);
    button.createSpan({ cls: "goodobsidian-more-label", text: options.text });
    button.disabled = options.enabled === false;
    button.addEventListener("click", () => {
      if (button.disabled) return;
      this.close();
      options.run(button);
    });
    return button;
  }

  /** "Go to page (1 – N)": tapping it turns the hint into a number field. */
  private goToRow(parent: HTMLElement): void {
    const { total } = this.page;
    const row = parent.createDiv({ cls: "goodobsidian-more-row is-goto" });
    setIcon(row.createSpan({ cls: "goodobsidian-more-icon" }), "arrow-right-to-line");
    row.createSpan({ cls: "goodobsidian-more-label", text: "Go to page" });
    const input = row.createEl("input", {
      cls: "goodobsidian-more-goto",
      type: "text",
      attr: {
        inputmode: "numeric",
        enterkeyhint: "go",
        placeholder: `(1 – ${total})`,
        "aria-label": `Page number, 1 to ${total}`,
      },
    });
    const go = (): void => {
      const n = Number.parseInt(input.value, 10);
      if (!Number.isFinite(n)) return;
      this.close();
      this.actions.goToPage(Math.min(total, Math.max(1, n)) - 1);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") go();
    });
    this.keyboard.watch(input, row);
    // The whole row is the target, not only the field — and a press on it
    // must undo the scroll iPadOS makes to reveal the field, as one on the
    // field itself does.
    row.addEventListener("pointerdown", (event) => {
      if (event.target !== input && document.activeElement !== input) {
        this.keyboard.holdWindow(input);
      }
    });
    row.addEventListener("click", () => input.focus());
  }

  /** Below ⋯, right-aligned to it, as tall as the window allows; the rest scrolls. */
  private place(): void {
    const r = this.anchor.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const top = r.bottom + 6;
    this.el.setCssStyles({
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      maxHeight: `${Math.max(160, window.innerHeight - top - 8)}px`,
    });
  }

  private installDismiss(): void {
    const outside = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && (this.el.contains(target) || this.anchor.contains(target))) return;
      this.close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") this.close();
    };
    const onResize = (): void => {
      if (this.anchor.isConnected) this.place();
      else this.close();
    };
    // Capture: the drawing surface consumes its own pointer events. A swipe
    // anywhere else starts with one of these, so it closes the panel too.
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("touchstart", outside, { capture: true, passive: true });
    document.addEventListener("wheel", outside, { capture: true, passive: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    this.dispose.push(() => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("touchstart", outside, true);
      document.removeEventListener("wheel", outside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    });
  }
}
