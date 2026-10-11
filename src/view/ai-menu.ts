/**
 * The AI menu: the sheet the toolbar's sparkles button opens. Same look and
 * behaviour as the Add Page popover (a card attached to <body>, below its
 * button, closed by a tap outside, Escape or a second tap on the button).
 *
 * It renders whatever list of `AiMenuItem`s it is given — what is offered and
 * why an entry is greyed out is decided in `recognition/ai-menu-model.ts`, and
 * what each entry does is the host's `run(id)`. A disabled entry stays in the
 * list with its reason underneath, because a feature that silently vanishes is
 * harder to understand than one that says what it needs.
 *
 * Its two sections have headings: the handwriting reader on this device,
 * then the features that need the user's own AI key. With `keyFolded`, the
 * second is one row that opens it, so it stays out of the way of anyone who
 * has no key.
 */

import { setIcon } from "obsidian";
import type { AiMenuItem } from "../recognition/ai-menu-model";

const POPOVER_WIDTH = 320;

export class AiMenuPopover {
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly anchor: HTMLElement,
    items: readonly AiMenuItem[],
    private readonly run: (id: string) => void,
    keyFolded = false,
  ) {
    this.el = document.body.createDiv({ cls: "goodobsidian-addpage goodobsidian-aimenu" });
    this.el.setAttribute("role", "menu");
    this.el.setAttribute("aria-label", "AI");
    this.build(items, keyFolded);
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
    for (const d of this.dispose) d();
    this.el.remove();
  }

  private build(items: readonly AiMenuItem[], keyFolded: boolean): void {
    this.el.createDiv({ cls: "goodobsidian-addpage-title", text: "AI" });
    const device = items.filter((item) => item.section === "device");
    const key = items.filter((item) => item.section !== "device");
    if (device.length > 0) {
      this.heading(this.el, "Handwriting · on this device");
      this.rows(this.el, device);
    }
    if (key.length === 0) return;
    if (!keyFolded) {
      this.heading(this.el, "With your own AI key");
      this.rows(this.el, key);
      return;
    }
    // No key: one row, which opens the section in place.
    const toggle = this.el.createEl("button", {
      cls: "goodobsidian-addpage-row goodobsidian-aimenu-row goodobsidian-aimenu-fold clickable-icon",
    });
    toggle.setAttribute("aria-expanded", "false");
    const chevron = toggle.createSpan({ cls: "goodobsidian-addpage-row-icon" });
    setIcon(chevron, "chevron-right");
    const text = toggle.createSpan({ cls: "goodobsidian-aimenu-text" });
    text.createSpan({ cls: "goodobsidian-aimenu-label", text: "With your own AI key" });
    text.createSpan({
      cls: "goodobsidian-aimenu-reason",
      text: "Transcribe, ask about pages and make images. Needs an API key.",
    });
    const body = this.el.createDiv({ cls: "goodobsidian-aimenu-folded is-hidden" });
    this.rows(body, key);
    toggle.addEventListener("click", () => {
      const open = body.hasClass("is-hidden");
      body.toggleClass("is-hidden", !open);
      toggle.setAttribute("aria-expanded", String(open));
      setIcon(chevron, open ? "chevron-down" : "chevron-right");
      this.place();
    });
  }

  private heading(parent: HTMLElement, text: string): void {
    parent.createDiv({ cls: "goodobsidian-aimenu-heading", text });
  }

  private rows(parent: HTMLElement, items: readonly AiMenuItem[]): void {
    let dividerDrawn = false;
    for (const item of items) {
      if (item.footer && !dividerDrawn) {
        parent.createDiv({ cls: "goodobsidian-addpage-divider" });
        dividerDrawn = true;
      }
      // `clickable-icon`: Obsidian pads any other button 20 px on iPad.
      const row = parent.createEl("button", {
        cls: "goodobsidian-addpage-row goodobsidian-aimenu-row clickable-icon",
      });
      row.setAttribute("role", "menuitem");
      const icon = row.createSpan({ cls: "goodobsidian-addpage-row-icon" });
      setIcon(icon, item.icon);
      const text = row.createSpan({ cls: "goodobsidian-aimenu-text" });
      text.createSpan({ cls: "goodobsidian-aimenu-label", text: item.label });
      if (!item.enabled) {
        row.disabled = true;
        row.setAttribute("aria-disabled", "true");
        if (item.reason) {
          text.createSpan({ cls: "goodobsidian-aimenu-reason", text: item.reason });
          row.setAttribute("aria-label", `${item.label} — ${item.reason}`);
        }
        continue;
      }
      row.addEventListener("click", () => {
        this.close();
        this.run(item.id);
      });
    }
  }

  /** Below the anchor, left-aligned to it, kept inside the window. */
  private place(): void {
    const r = this.anchor.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const height = this.el.offsetHeight;
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
    this.el.setCssStyles({ left: `${left}px`, top: `${top}px`, width: `${width}px` });
  }

  private installDismiss(): void {
    const onDown = (event: PointerEvent): void => {
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
