/**
 * The ⋯ panel beside the toolbar's settings gear: GoodNotes' "More" sheet, from
 * the screen recording Joost supplied (2026-09-22), built from what this
 * plugin has.
 *
 *   More
 *   ┌ Page 3                      [thumb] ┐
 *   │ Bookmark page / Remove bookmark     │
 *   │ Add to contents / Rename in contents│
 *   │ Copy link to page                   │
 *   │ Duplicate page                      │
 *   │ Change template (or cover)          │
 *   │ Save page as template               │
 *   │ Go to page                  (1 – 9) │
 *   └─────────────────────────────────────┘
 *   ┌ Dark pages / Light pages            ┐
 *   │ Dark PDF pages                   ✓  │  (only while pages are dark)
 *   │ Desk             [◐] [○] [●] [◍]    │
 *   │ Toolbar          [▔] [▁] [▏] [▕]    │
 *   │ Draw with finger                 ✓  │  (only where there is touch)
 *   │ Keyboard shortcuts                  │
 *   │ Copy home screen link               │
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
import { onEnterKey } from "./enter-key";
import type { FoldedBarItem } from "./toolbar";
import type { DeskChoice } from "../settings-data";
import { DARK_PAPER, LIGHT_DESK, LIGHT_PAPER } from "../canvas/backdrop";
import { type BarDock, menuAnchor, menuPlace, menuRoom } from "./bar-dock-model";

export interface MorePanelPage {
  /** Zero-based index of the page the panel is about. */
  index: number;
  total: number;
  bookmarked: boolean;
  /** Listed in the notebook's contents (it has a title). */
  titled: boolean;
  /** A cover page changes cover, not template. */
  cover: boolean;
  /** A single page cannot be duplicated or deleted. */
  single: boolean;
  /**
   * An endless board (FineNotes#46): none of the page's own items, only the
   * view's rows and clearing it.
   */
  board?: boolean;
  /** A practice file: its pages are fixed, so only going to a page and clearing one are offered. */
  fixed?: boolean;
  /** Whether there is ink to clear. */
  clearable: boolean;
  /** The pages are shown dark (the view setting). */
  darkPages?: boolean;
  /** With dark pages, PDF pages turn dark too (`invertPdfPages`). */
  darkPdf?: boolean;
  /** The desk around the pages, and its colour when it is custom. */
  desk?: { choice: DeskChoice; color: string };
  /** Tool bar buttons folded in here because the bar had no room for them. */
  folded?: FoldedBarItem[];
  /** Where the tool bar rests on this device (bar-dock-model.ts), for its row. */
  barDock?: BarDock;
  /** Fingers draw while the Pencil is away (`input/finger-draw.ts`). */
  fingerDrawing?: boolean;
}

export interface MorePanelActions {
  // Properties holding functions, not methods (CLAUDE.md: a callback is a value).
  paintThumbnail: (canvas: HTMLCanvasElement, index: number, cssWidth: number) => void;
  toggleBookmark: (index: number) => void;
  /** Add the page to the contents, or rename its entry. */
  editTitle: (index: number) => void;
  copyLink: (index: number) => void;
  duplicate: (index: number) => void;
  changeTemplate: (index: number, anchor: HTMLElement) => void;
  /** Keep the page as a paper in My templates (not offered on a cover). */
  saveAsTemplate?: (index: number) => void;
  goToPage: (index: number) => void;
  clear: (index: number) => void;
  remove: (index: number) => void;
  /** Show every notebook's pages dark, or light again. */
  toggleDarkPages: () => void;
  /** Turn PDF pages dark with dark pages, or leave them as they are. Without it the row is not offered. */
  setDarkPdf?: (dark: boolean) => void;
  /** Put the pages on another desk; `color` with custom. Without it the row is not offered. */
  setDesk?: (choice: DeskChoice, color?: string) => void;
  /** Show the keyboard and stylus shortcuts. */
  showShortcuts: () => void;
  /** Copy the link that opens this notebook from a home-screen shortcut. */
  copyHomeLink: () => void;
  /** Put the tool bar at `dock`, on this device. Without it the row is not offered. */
  setBarDock?: (dock: BarDock) => void;
  /** Let a finger draw until the Pencil writes again, or stop. Without it (no touch) the row is not offered. */
  setFingerDrawing?: (on: boolean) => void;
}

/** The tool bar's places in the Toolbar row, each its Lucide panel icon. */
const BAR_DOCKS: ReadonlyArray<{ dock: BarDock; label: string }> = [
  { dock: "top", label: "Toolbar at the top" },
  { dock: "bottom", label: "Toolbar at the bottom" },
  { dock: "left", label: "Toolbar on the left" },
  { dock: "right", label: "Toolbar on the right" },
];

/** The desks in the Desk row, in order. */
const DESKS: ReadonlyArray<{ choice: DeskChoice; label: string }> = [
  { choice: "auto", label: "Desk with the pages" },
  { choice: "light", label: "Light desk" },
  { choice: "dark", label: "Dark desk" },
  { choice: "custom", label: "Desk in a colour of your own" },
];
/** The Light and Dark desks' colours, and the usual grey a custom desk starts from. */
const LIGHT_DESK_DISC = LIGHT_DESK;
const DARK_DESK_DISC = DARK_PAPER.desk;
const CUSTOM_DESK = LIGHT_PAPER.desk;

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

    // The tool bar never scrolls: what did not fit on it is first here.
    const folded = page.folded ?? [];
    if (folded.length > 0) {
      const bar = this.group();
      for (const item of folded) {
        this.row(bar, {
          icon: item.icon,
          text: item.label,
          cls: item.marked ? "has-mark" : undefined,
          run: () => item.run(this.anchor),
        });
      }
    }

    if (page.board) {
      this.viewRows();
      this.row(this.group(), {
        icon: "x-circle",
        text: "Clear board",
        cls: "is-danger",
        enabled: page.clearable,
        run: () => actions.clear(page.index),
      });
      return;
    }

    const card = this.group();
    const head = card.createDiv({ cls: "goodobsidian-more-pagehead" });
    head.createSpan({ cls: "goodobsidian-more-pagename", text: `Page ${page.index + 1}` });
    const thumb = head.createEl("canvas", { cls: "goodobsidian-more-thumb" });
    actions.paintThumbnail(thumb, page.index, THUMB_WIDTH);

    if (page.fixed) {
      if (page.total > 1) this.goToRow(card);
      this.row(card, {
        icon: "x-circle",
        text: "Clear page",
        cls: "is-danger",
        enabled: page.clearable,
        run: () => actions.clear(page.index),
      });
      return;
    }
    this.row(card, {
      icon: page.bookmarked ? "bookmark-minus" : "bookmark",
      text: page.bookmarked ? "Remove bookmark" : "Bookmark page",
      cls: page.bookmarked ? "is-bookmarked" : "",
      run: () => actions.toggleBookmark(page.index),
    });
    this.row(card, {
      icon: page.titled ? "pencil" : "list-plus",
      text: page.titled ? "Rename in contents" : "Add to contents",
      run: () => actions.editTitle(page.index),
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
    const save = actions.saveAsTemplate;
    if (save && !page.cover) {
      this.row(card, {
        icon: "file-plus-2",
        text: "Save page as template",
        run: () => save(page.index),
      });
    }
    if (page.total > 1) this.goToRow(card);

    this.viewRows();

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

  /**
   * The quick switch for the page appearance setting, for writing at night,
   * and the shortcuts, for an iPad with no keyboard to press ? on.
   */
  private viewRows(): void {
    const { page, actions } = this;
    const view = this.group();
    this.row(view, {
      icon: page.darkPages ? "sun" : "moon",
      text: page.darkPages ? "Light pages" : "Dark pages",
      run: () => actions.toggleDarkPages(),
    });
    if (page.darkPages) this.darkPdfRow(view);
    this.deskRow(view);
    this.barDockRow(view);
    this.fingerDrawRow(view);
    this.row(view, {
      icon: "keyboard",
      text: "Keyboard shortcuts",
      run: () => actions.showShortcuts(),
    });
    this.row(view, {
      icon: "smartphone",
      text: "Copy home screen link",
      run: () => actions.copyHomeLink(),
    });
  }

  /**
   * "Dark PDF pages", while pages are dark: a check at its end while PDF
   * pages turn dark with them. A tap switches it and the panel stays, so
   * the pages behind show the change.
   */
  private darkPdfRow(parent: HTMLElement): void {
    const set = this.actions.setDarkPdf;
    if (!set) return;
    const button = parent.createEl("button", {
      cls: "goodobsidian-more-row is-switch clickable-icon",
    });
    setIcon(button.createSpan({ cls: "goodobsidian-more-icon" }), "file-text");
    button.createSpan({ cls: "goodobsidian-more-label", text: "Dark PDF pages" });
    const mark = button.createSpan({ cls: "goodobsidian-more-check" });
    setIcon(mark, "check");
    const show = (on: boolean): void => {
      mark.toggleClass("is-hidden", !on);
      button.setAttribute("role", "switch");
      button.setAttribute("aria-checked", String(on));
    };
    let on = this.page.darkPdf !== false;
    show(on);
    button.addEventListener("click", () => {
      on = !on;
      show(on);
      set(on);
    });
  }

  /**
   * "Draw with finger", where there is touch: for when the Pencil's battery
   * is flat, as Notability's "Disconnect Apple Pencil". A check while it is
   * on; switched on, the panel goes, so the finger can write at once. The
   * Pencil writing again ends it on its own (`input/finger-draw.ts`).
   */
  private fingerDrawRow(parent: HTMLElement): void {
    const set = this.actions.setFingerDrawing;
    if (!set) return;
    const on = this.page.fingerDrawing === true;
    const button = parent.createEl("button", {
      cls: "goodobsidian-more-row is-switch clickable-icon",
    });
    setIcon(button.createSpan({ cls: "goodobsidian-more-icon" }), "pointer");
    button.createSpan({ cls: "goodobsidian-more-label", text: "Draw with finger" });
    const mark = button.createSpan({ cls: "goodobsidian-more-check" });
    setIcon(mark, "check");
    mark.toggleClass("is-hidden", !on);
    button.setAttribute("role", "switch");
    button.setAttribute("aria-checked", String(on));
    button.addEventListener("click", () => {
      this.close();
      set(!on);
    });
  }

  /**
   * "Desk": the background around the pages, as four marks at the row's
   * end: with the pages (a half-filled circle: light or dark as they need),
   * light, dark, and a colour of one's own, picked with the system's colour
   * picker. The panel stays, so the desk behind shows each choice.
   */
  private deskRow(parent: HTMLElement): void {
    const set = this.actions.setDesk;
    if (!set) return;
    const desk = this.page.desk ?? { choice: "auto", color: CUSTOM_DESK };
    const row = parent.createDiv({ cls: "goodobsidian-more-row is-bar-dock is-desk" });
    setIcon(row.createSpan({ cls: "goodobsidian-more-icon" }), "square-dashed");
    row.createSpan({ cls: "goodobsidian-more-label", text: "Desk" });
    const places = row.createDiv({ cls: "goodobsidian-more-docks" });
    places.setAttribute("role", "radiogroup");
    places.setAttribute("aria-label", "Desk");
    const buttons = new Map<DeskChoice, HTMLButtonElement>();
    let chosen: DeskChoice = desk.choice;
    const mark = (): void => {
      for (const [choice, button] of buttons) {
        button.toggleClass("is-active", choice === chosen);
        button.setAttribute("aria-checked", String(choice === chosen));
      }
    };
    for (const { choice, label } of DESKS) {
      const button = places.createEl("button", {
        cls: "goodobsidian-more-dock clickable-icon",
      });
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", label);
      buttons.set(choice, button);
      if (choice === "auto") {
        setIcon(button, "contrast");
      } else {
        // Custom wears a rainbow ring: a colour to pick, not one more grey.
        const disc = button.createSpan({
          cls: `goodobsidian-more-desk-disc${choice === "custom" ? " is-custom" : ""}`,
        });
        disc.setCssProps({
          "--gob-desk-disc":
            choice === "light" ? LIGHT_DESK_DISC : choice === "dark" ? DARK_DESK_DISC : desk.color,
        });
      }
      if (choice === "custom") {
        const input = button.createEl("input", {
          cls: "goodobsidian-more-desk-input",
          type: "color",
          attr: { tabindex: "-1", "aria-hidden": "true" },
        });
        input.value = desk.color;
        input.addEventListener("input", () => {
          chosen = "custom";
          mark();
          button
            .querySelector<HTMLElement>(".goodobsidian-more-desk-disc")
            ?.setCssProps({ "--gob-desk-disc": input.value });
          set("custom", input.value);
        });
        button.addEventListener("click", (event) => {
          // The picker's own click bubbles here: it is not a second choice.
          if (event.target === input) return;
          chosen = "custom";
          mark();
          set("custom", input.value);
          input.click();
        });
      } else {
        button.addEventListener("click", () => {
          chosen = choice;
          mark();
          set(choice);
        });
      }
    }
    mark();
  }

  /**
   * "Toolbar": where the tool bar rests on this device (FineNotes#50), as
   * four panel icons at the row's end, the one in use marked. A choice moves
   * the bar this panel hangs from, so the panel closes first.
   */
  private barDockRow(parent: HTMLElement): void {
    const set = this.actions.setBarDock;
    if (!set) return;
    const row = parent.createDiv({ cls: "goodobsidian-more-row is-bar-dock" });
    setIcon(row.createSpan({ cls: "goodobsidian-more-icon" }), "layout-panel-top");
    row.createSpan({ cls: "goodobsidian-more-label", text: "Toolbar" });
    const places = row.createDiv({ cls: "goodobsidian-more-docks" });
    places.setAttribute("role", "radiogroup");
    places.setAttribute("aria-label", "Toolbar");
    for (const { dock, label } of BAR_DOCKS) {
      const button = places.createEl("button", {
        cls: "goodobsidian-more-dock clickable-icon",
      });
      setIcon(button, `panel-${dock}`);
      const chosen = dock === (this.page.barDock ?? "top");
      button.toggleClass("is-active", chosen);
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(chosen));
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => {
        this.close();
        set(dock);
      });
    }
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
    onEnterKey(input, go);
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

  /**
   * Below ⋯, right-aligned to it, as tall as the window allows; the rest
   * scrolls. From a tool bar at another edge, toward the page (`menuAnchor`).
   */
  private place(): void {
    const r = this.anchor.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    const { side, box } = menuAnchor(this.anchor);
    if (side !== "down") {
      const room = { width: window.innerWidth, height: window.innerHeight };
      const maxHeight = Math.max(160, menuRoom(side, box, room, 6, 8));
      this.el.setCssStyles({ width: `${width}px`, maxHeight: `${maxHeight}px` });
      const size = { width, height: Math.min(this.el.offsetHeight, maxHeight) };
      const at = menuPlace(side, box, size, room, "end", 6, 8);
      this.el.setCssStyles({ left: `${at.left}px`, top: `${at.top}px` });
      return;
    }
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
