/**
 * The card a tapped underlined word opens (word-check.ts says what is in
 * it): a FineNotes popover on <body>, below the tap, closed by a tap
 * outside, Escape, or an answer. Styled like the Add Page and AI popovers.
 *
 * - When its ink fits list words about as well as the reading, they come
 *   first as chips ("Did you mean"), the first tinted with the accent.
 * - Then rows, each an icon, a label and an optional sub-line.
 */

import { setIcon } from "obsidian";

const POPOVER_WIDTH = 300;

export interface WordPopoverRow {
  icon: string;
  label: string;
  sub?: string;
  run: () => void;
}

export interface WordPopoverContent {
  /** What Grape read. */
  read: string;
  /** Words to offer as chips, best first; none for no "Did you mean". */
  chips: readonly string[];
  onChip: (word: string) => void;
  rows: readonly WordPopoverRow[];
}

export class WordPopover {
  /** One card at a time: opening another closes this one. */
  private static current: WordPopover | null = null;
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly at: { x: number; y: number },
    content: WordPopoverContent,
    private readonly onClose: () => void = () => {},
  ) {
    WordPopover.current?.close();
    WordPopover.current = this;
    this.el = document.body.createDiv({ cls: "goodobsidian-addpage goodobsidian-wordcheck" });
    this.el.setAttribute("role", "menu");
    this.el.setAttribute("aria-label", `Read as “${content.read}”`);
    this.build(content);
    this.place();
    this.installDismiss();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (WordPopover.current === this) WordPopover.current = null;
    for (const d of this.dispose) d();
    this.el.remove();
    this.onClose();
  }

  private build(content: WordPopoverContent): void {
    this.el.createDiv({ cls: "goodobsidian-wordcheck-read", text: `Read as “${content.read}”` });
    if (content.chips.length > 0) {
      this.el.createDiv({ cls: "goodobsidian-wordcheck-caption", text: "Did you mean" });
      const chips = this.el.createDiv({ cls: "goodobsidian-wordcheck-chips" });
      content.chips.forEach((word, i) => {
        // `clickable-icon`: Obsidian pads any other button 20 px on iPad.
        const chip = chips.createEl("button", {
          cls: "goodobsidian-wordcheck-chip clickable-icon",
          text: word,
        });
        chip.toggleClass("is-first", i === 0);
        chip.setAttribute("role", "menuitem");
        chip.addEventListener("click", () => {
          this.close();
          content.onChip(word);
        });
      });
      this.el.createDiv({ cls: "goodobsidian-addpage-divider" });
    }
    const rows = this.el.createDiv({ cls: "goodobsidian-wordcheck-rows" });
    for (const item of content.rows) {
      const row = rows.createEl("button", {
        cls: "goodobsidian-addpage-row goodobsidian-aimenu-row clickable-icon",
      });
      row.setAttribute("role", "menuitem");
      const icon = row.createSpan({ cls: "goodobsidian-addpage-row-icon" });
      setIcon(icon, item.icon);
      const text = row.createSpan({ cls: "goodobsidian-aimenu-text" });
      text.createSpan({ cls: "goodobsidian-aimenu-label", text: item.label });
      if (item.sub) text.createSpan({ cls: "goodobsidian-aimenu-reason", text: item.sub });
      row.addEventListener("click", () => {
        this.close();
        item.run();
      });
    }
  }

  /** Below the tap, kept inside the window; above it when there is no room below. */
  private place(): void {
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(this.at.x - 32, window.innerWidth - width - 8));
    const height = this.el.offsetHeight;
    let top = this.at.y + 16;
    if (top + height > window.innerHeight - 8) top = Math.max(8, this.at.y - height - 16);
    this.el.setCssStyles({ left: `${left}px`, top: `${top}px`, width: `${width}px` });
  }

  private installDismiss(): void {
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && this.el.contains(target)) return;
      this.close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") this.close();
    };
    const onResize = (): void => this.place();
    // Capture: the drawing surface consumes its own pointer events.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    this.dispose.push(() => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    });
  }
}
