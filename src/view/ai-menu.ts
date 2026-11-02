/**
 * The AI menu: the sheet the toolbar's sparkles button opens. Same look and
 * behaviour as the Add Page popover (a card attached to <body>, below its
 * button, closed by a tap outside, Escape or a second tap on the button).
 *
 * It renders whatever list of `AiMenuItem`s it is given — what is offered and
 * why an entry is greyed out is decided in `recognition/ai-menu-model.ts`, and
 * what each entry does is the host's `run(id)`; a switch (`on` set) calls
 * `toggle(id, on)` and leaves the menu open. A disabled entry stays in the
 * list with its reason underneath, because a feature that silently vanishes is
 * harder to understand than one that says what it needs.
 *
 * Its two sections have headings: the features that need the user's own AI
 * key (Ask and the rest, what the menu is mostly opened for), then the
 * handwriting reader on this device; "AI settings…" closes the menu. With
 * `keyFolded`, the first is one row that opens it, so it stays out of the
 * way of anyone who has no key.
 */

import { setIcon } from "obsidian";
import type { AiMenuItem } from "../recognition/ai-menu-model";
import { menuAnchor, menuPlace } from "./bar-dock-model";

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
    private readonly toggle: (id: string, on: boolean) => void = () => {},
    private readonly choose: (id: string, value: string) => void = () => {},
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
    if (key.length > 0) this.keySection(key, keyFolded);
    if (device.length > 0) {
      const heading = this.heading(this.el, "Handwriting · on this device");
      heading.createSpan({ cls: "goodobsidian-beta-tag", text: "Beta" });
      this.rows(this.el, device);
    }
    // Set up, the key's settings row ends the menu, below both sections.
    if (!keyFolded)
      this.rows(
        this.el,
        key.filter((item) => item.footer),
      );
  }

  /** The features that need a key; with `keyFolded`, one row that opens them in place. */
  private keySection(key: readonly AiMenuItem[], keyFolded: boolean): void {
    if (!keyFolded) {
      this.heading(this.el, "With your own AI key");
      this.rows(
        this.el,
        key.filter((item) => !item.footer),
      );
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

  private heading(parent: HTMLElement, text: string): HTMLElement {
    return parent.createDiv({ cls: "goodobsidian-aimenu-heading", text });
  }

  private rows(parent: HTMLElement, items: readonly AiMenuItem[]): void {
    let dividerDrawn = false;
    for (const item of items) {
      if (item.footer && !dividerDrawn) {
        parent.createDiv({ cls: "goodobsidian-addpage-divider" });
        dividerDrawn = true;
      }
      if (item.on !== undefined) {
        this.switchRow(parent, item, item.on);
        continue;
      }
      if (item.choices) {
        this.choiceRow(parent, item, item.choices);
        continue;
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

  /**
   * A row that is a choice: its icon and name, then its options side by
   * side, the one picked filled. A tap picks another and leaves the menu
   * open; the host may rebuild it, as the section changes with the choice.
   */
  private choiceRow(
    parent: HTMLElement,
    item: AiMenuItem,
    choices: ReadonlyArray<{ id: string; label: string }>,
  ): void {
    const row = parent.createDiv({ cls: "goodobsidian-addpage-row goodobsidian-aimenu-choice" });
    setIcon(row.createSpan({ cls: "goodobsidian-addpage-row-icon" }), item.icon);
    row.createSpan({ cls: "goodobsidian-aimenu-label", text: item.label });
    const group = row.createDiv({
      cls: "goodobsidian-segmented",
      attr: { role: "radiogroup", "aria-label": item.label },
    });
    const buttons: HTMLButtonElement[] = [];
    for (const choice of choices) {
      const button = group.createEl("button", {
        cls: "clickable-icon",
        text: choice.label,
        attr: { role: "radio", "aria-checked": String(choice.id === item.value) },
      });
      button.toggleClass("is-active", choice.id === item.value);
      button.addEventListener("click", () => {
        for (const other of buttons) {
          other.toggleClass("is-active", other === button);
          other.setAttribute("aria-checked", String(other === button));
        }
        this.choose(item.id, choice.id);
      });
      buttons.push(button);
    }
  }

  /** A row that is a switch: its line under the label always shows, and a tap flips it in place. */
  private switchRow(parent: HTMLElement, item: AiMenuItem, on: boolean): void {
    const row = parent.createEl("button", {
      cls: "goodobsidian-addpage-row goodobsidian-aimenu-row goodobsidian-switch-row clickable-icon",
      attr: { role: "menuitemcheckbox", "aria-checked": String(on), "aria-label": item.label },
    });
    setIcon(row.createSpan({ cls: "goodobsidian-addpage-row-icon" }), item.icon);
    const text = row.createSpan({ cls: "goodobsidian-aimenu-text" });
    text.createSpan({ cls: "goodobsidian-aimenu-label", text: item.label });
    if (item.reason) text.createSpan({ cls: "goodobsidian-aimenu-reason", text: item.reason });
    row.createSpan({ cls: "goodobsidian-switch" }).createSpan({ cls: "goodobsidian-switch-thumb" });
    row.toggleClass("is-on", on);
    let current = on;
    row.addEventListener("click", () => {
      current = !current;
      row.toggleClass("is-on", current);
      row.setAttribute("aria-checked", String(current));
      this.toggle(item.id, current);
    });
  }

  /**
   * Below the anchor, left-aligned to it, kept inside the window; toward the
   * page from a tool bar at another edge (`menuAnchor`).
   */
  private place(): void {
    const r = this.anchor.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
    const height = this.el.offsetHeight;
    const { side, box } = menuAnchor(this.anchor);
    if (side !== "down") {
      const room = { width: window.innerWidth, height: window.innerHeight };
      const at = menuPlace(side, box, { width, height }, room, "start", 6, 8);
      this.el.setCssStyles({ left: `${at.left}px`, top: `${at.top}px`, width: `${width}px` });
      return;
    }
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    // Below the button, always: it never covers the bar it hangs from. A
    // window too short for the whole menu scrolls it instead.
    const top = r.bottom + 6;
    const room = Math.max(160, window.innerHeight - top - 8);
    this.el.setCssStyles({
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      maxHeight: height > room ? `${room}px` : "",
      overflowY: height > room ? "auto" : "",
    });
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
