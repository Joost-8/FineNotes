/**
 * The selection's floating action bar and its "…" menu (0.5), drawn from a
 * list of {@link SelectionAction} entries. `selection-bar-model.ts` decides
 * what goes where and where the bar floats; this file only makes the DOM.
 *
 * One bar serves every selection: a lone picture (which keeps its own resize
 * and rotate handles) and a lasso selection alike — and a picture being
 * cropped, and the spot a lasso tap-and-hold opened it on. The host hands it
 * the entries that fit, and where the selection is, in the coordinates of
 * the element the bar was created in:
 *
 *     bar.setActions([...]);            // rebuilds only when something drawn changed
 *     bar.show(selectionBounds, visibleArea, { clearAbove });
 *     bar.hide();
 *
 * Both the bar and the menu sit over the page, where the surface cancels a
 * Pencil's touchstart (WebKit's long press and Scribble would otherwise take
 * the stroke) — which also stops the browser synthesising a click from a
 * Pencil tap. So every control here acts on a pointerup that follows a
 * pointerdown on the same control, and on a keyboard click (`detail === 0`).
 *
 * The pill and the menu are dark in every theme, as GoodNotes draws them.
 * They carry Obsidian's own `theme-dark` class, which re-declares the
 * `--color-base-*` palette on them, and styles.css colours them from those —
 * Obsidian's variables, dark flavour, whatever the app theme is.
 */

import { setIcon } from "obsidian";
import { renderColorMixer } from "./color-picker";
import type { Bounds } from "../model/document";
import {
  type SelectionAction,
  actionsKey,
  barItems,
  isEnabled,
  menuLayout,
  placeFloating,
} from "./selection-bar-model";

/** Space between the selection (and anything sticking out of it) and the bar, px. */
const BAR_GAP_PX = 12;
/** Least distance kept between the bar or menu and the edge of the visible area, px. */
const EDGE_MARGIN_PX = 8;
/** Space between the "…" button and the menu, px. */
const MENU_GAP_PX = 6;

export interface ShowOptions {
  /** Room to keep free above the selection (a handle drawn there), px. */
  clearAbove?: number;
  /** Room to keep free below it, px. */
  clearBelow?: number;
}

export class SelectionActionBar {
  /** The pill. */
  readonly el: HTMLElement;
  private menuEl: HTMLElement | null = null;
  private moreButton: HTMLButtonElement | null = null;
  private actions: SelectionAction[] = [];
  private key = "";
  /** The visible area the bar was last placed in, for placing the menu. */
  private visible: Bounds | null = null;
  private readonly onOutsideDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target && (this.menuEl?.contains(target) || this.moreButton?.contains(target))) return;
    this.closeMenu();
  };

  constructor(
    private readonly parent: HTMLElement,
    label: string,
  ) {
    this.el = parent.createDiv({
      cls: "goodobsidian-selection-bar theme-dark is-hidden",
      attr: { role: "toolbar", "aria-label": label },
    });
    stopPageInput(this.el);
  }

  /** Replace the entries. Rebuilds only when something they draw changed. */
  setActions(actions: readonly SelectionAction[]): void {
    this.actions = [...actions];
    const key = actionsKey(actions);
    if (key === this.key) return;
    this.key = key;
    this.buildBar();
    if (this.menuEl) this.renderMenu();
  }

  /**
   * Show the bar centred above `anchor` — below it when there is no room —
   * inside `visible`. Both are in the parent element's px.
   */
  show(anchor: Bounds, visible: Bounds, options: ShowOptions = {}): void {
    this.el.removeClass("is-hidden");
    this.visible = visible;
    const at = placeFloating(anchor, { w: this.el.offsetWidth, h: this.el.offsetHeight }, visible, {
      gap: BAR_GAP_PX,
      margin: EDGE_MARGIN_PX,
      clearAbove: options.clearAbove,
      clearBelow: options.clearBelow,
    });
    this.el.setCssStyles({ left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px` });
    this.el.toggleClass("is-below", at.below);
    if (this.menuEl) this.placeMenu();
  }

  /** Hide the bar and close its menu. */
  hide(): void {
    this.closeMenu();
    this.el.addClass("is-hidden");
  }

  get isShown(): boolean {
    return !this.el.hasClass("is-hidden");
  }

  get isMenuOpen(): boolean {
    return this.menuEl !== null;
  }

  closeMenu(): void {
    if (!this.menuEl) return;
    this.menuEl.remove();
    this.menuEl = null;
    this.moreButton?.removeClass("is-active");
    this.parent.ownerDocument.removeEventListener("pointerdown", this.onOutsideDown, true);
  }

  destroy(): void {
    this.closeMenu();
    this.el.remove();
  }

  // --- The bar ----------------------------------------------------------------

  private buildBar(): void {
    this.el.empty();
    this.moreButton = null;
    for (const item of barItems(this.actions)) {
      if (item.kind === "divider") {
        this.el.createDiv({ cls: "goodobsidian-selection-divider" });
        continue;
      }
      if (item.kind === "more") {
        const more = this.button(this.el, "goodobsidian-selection-button is-more", "More");
        iconInto(more, ["more-horizontal", "ellipsis"], "…");
        onTap(more, () => this.toggleMenu());
        this.moreButton = more;
        continue;
      }
      const { action } = item;
      const button = this.button(this.el, "goodobsidian-selection-button", action.label);
      if (action.showLabel) {
        button.addClass("has-label");
        iconInto(
          button.createSpan({ cls: "goodobsidian-selection-button-icon" }),
          iconsFor(action.icon),
          "",
        );
        button.createSpan({ cls: "goodobsidian-selection-button-label", text: action.label });
      } else {
        iconInto(button, iconsFor(action.icon), action.label.slice(0, 2));
      }
      this.decorate(button, action);
      onTap(button, () => this.run(action.id, true));
    }
  }

  /** A button: `clickable-icon` keeps Obsidian's iPad padding off it. */
  private button(parent: HTMLElement, cls: string, label: string): HTMLButtonElement {
    return parent.createEl("button", {
      cls: `${cls} clickable-icon`,
      attr: { "aria-label": label, title: label },
    });
  }

  private decorate(button: HTMLButtonElement, action: SelectionAction): void {
    button.toggleClass("mod-warning", action.destructive === true);
    button.disabled = !isEnabled(action);
    button.setAttribute("aria-disabled", String(!isEnabled(action)));
  }

  /** Run an entry by id, from the latest list (it may have been replaced since the build). */
  private run(id: string, close: boolean): void {
    const action = this.actions.find((a) => a.id === id);
    if (!action || !isEnabled(action)) return;
    if (close) this.closeMenu();
    action.run?.();
  }

  // --- The "…" menu -----------------------------------------------------------

  private toggleMenu(): void {
    if (this.menuEl) {
      this.closeMenu();
      return;
    }
    this.menuEl = this.parent.createDiv({
      cls: "goodobsidian-selection-menu theme-dark",
      attr: { role: "menu" },
    });
    stopPageInput(this.menuEl);
    this.moreButton?.addClass("is-active");
    this.renderMenu();
    this.parent.ownerDocument.addEventListener("pointerdown", this.onOutsideDown, true);
  }

  private renderMenu(): void {
    const menu = this.menuEl;
    if (!menu) return;
    menu.empty();
    const layout = menuLayout(this.actions);
    if (layout.tiles.length > 0) {
      const strip = menu.createDiv({ cls: "goodobsidian-selection-tiles" });
      for (const action of layout.tiles) {
        const tile = this.button(strip, "goodobsidian-selection-tile", action.label);
        iconInto(
          tile.createSpan({ cls: "goodobsidian-selection-tile-icon" }),
          iconsFor(action.icon),
          "",
        );
        tile.createSpan({ cls: "goodobsidian-selection-tile-label", text: action.label });
        this.decorate(tile, action);
        onTap(tile, () => this.run(action.id, true));
      }
      if (layout.rows.length > 0) menu.createDiv({ cls: "goodobsidian-selection-menu-divider" });
    }
    for (const row of layout.rows) {
      if (row.kind === "divider") {
        menu.createDiv({ cls: "goodobsidian-selection-menu-divider" });
        continue;
      }
      const { action } = row;
      if (action.swatches) {
        this.renderSwatches(menu, action);
        continue;
      }
      const button = this.button(menu, "goodobsidian-selection-row", action.label);
      button.setAttribute("role", "menuitem");
      iconInto(
        button.createSpan({ cls: "goodobsidian-selection-row-icon" }),
        iconsFor(action.icon),
        "",
      );
      button.createSpan({ cls: "goodobsidian-selection-row-label", text: action.label });
      this.decorate(button, action);
      onTap(button, () => this.run(action.id, true));
    }
    this.placeMenu();
  }

  /** A labelled row of colour swatches. A pick keeps the menu open to try another. */
  private renderSwatches(menu: HTMLElement, action: SelectionAction): void {
    const swatches = action.swatches;
    if (!swatches) return;
    const block = menu.createDiv({ cls: "goodobsidian-selection-swatch-block" });
    const head = block.createDiv({ cls: "goodobsidian-selection-row is-static" });
    iconInto(
      head.createSpan({ cls: "goodobsidian-selection-row-icon" }),
      iconsFor(action.icon),
      "",
    );
    head.createSpan({ cls: "goodobsidian-selection-row-label", text: action.label });
    const row = block.createDiv({ cls: "goodobsidian-selection-swatches" });
    const current = swatches.current?.toLowerCase() ?? null;
    for (const color of swatches.colors) {
      // A 44 px target round a smaller disc. The disc *is* the ink colour:
      // a value, not chrome.
      const swatch = this.button(row, "goodobsidian-selection-swatch", color);
      swatch.createSpan({ cls: "goodobsidian-selection-swatch-disc" }).setCssStyles({
        background: color,
      });
      swatch.toggleClass("is-active", color.toLowerCase() === current);
      swatch.disabled = !isEnabled(action);
      onTap(swatch, () => {
        const latest = this.actions.find((a) => a.id === action.id);
        if (latest?.swatches && isEnabled(latest)) latest.swatches.pick(color);
      });
    }
    if (!swatches.custom) return;
    // "+": a colour of one's own, picked by hue and shade, below the row.
    const plus = this.button(row, "goodobsidian-selection-swatch is-custom", "Custom colour");
    plus.createSpan({ cls: "goodobsidian-selection-swatch-disc goodobsidian-color-more" });
    plus.disabled = !isEnabled(action);
    const mixer = block.createDiv({ cls: "is-hidden" });
    renderColorMixer(
      mixer,
      swatches.current,
      (color) => {
        const latest = this.actions.find((a) => a.id === action.id);
        if (latest?.swatches?.custom && isEnabled(latest)) latest.swatches.custom(color);
      },
      (button, run) => onTap(button as HTMLButtonElement, run),
    );
    onTap(plus, () => {
      mixer.toggleClass("is-hidden", !mixer.hasClass("is-hidden"));
      this.placeMenu();
    });
  }

  /**
   * Hang the menu from the "…" button, dropping over the page below the bar
   * as GoodNotes' does; above the bar when there is no room below.
   */
  private placeMenu(): void {
    const menu = this.menuEl;
    const more = this.moreButton;
    if (!menu || !more) return;
    const anchor: Bounds = {
      minX: this.el.offsetLeft + more.offsetLeft,
      minY: this.el.offsetTop,
      maxX: this.el.offsetLeft + more.offsetLeft + more.offsetWidth,
      maxY: this.el.offsetTop + this.el.offsetHeight,
    };
    const visible = this.visible ?? anchor;
    const at = placeFloating(anchor, { w: menu.offsetWidth, h: menu.offsetHeight }, visible, {
      gap: MENU_GAP_PX,
      margin: EDGE_MARGIN_PX,
      prefer: "below",
    });
    menu.setCssStyles({ left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px` });
  }
}

/**
 * Presses on the bar and the menu are theirs: none may reach the page below
 * and start a lasso or a stroke there.
 */
function stopPageInput(el: HTMLElement): void {
  el.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
  });
}

/**
 * Run `action` on a pointerup that follows a pointerdown on the same button,
 * or on a keyboard click. See the file comment for why not on `click`.
 */
function onTap(button: HTMLButtonElement, action: () => void): void {
  let armed: number | null = null;
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    armed = event.pointerId;
  });
  button.addEventListener("pointerup", (event) => {
    event.stopPropagation();
    if (armed !== event.pointerId) return;
    armed = null;
    if (!button.disabled) action();
  });
  button.addEventListener("pointercancel", () => {
    armed = null;
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.detail === 0 && !button.disabled) action();
  });
}

/**
 * Older names for Lucide icons that were renamed or added late, tried in
 * turn after the current one: Obsidian has shipped several Lucide versions.
 */
const ICON_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  "lock-open": ["unlock"],
  "clipboard-paste": ["clipboard"],
  "bring-to-front": ["arrow-up-to-line"],
  "send-to-back": ["arrow-down-to-line"],
  "copy-plus": ["copy"],
};

/** An icon name and its fallbacks, for {@link iconInto}. */
function iconsFor(icon: string): readonly string[] {
  const more = Object.prototype.hasOwnProperty.call(ICON_FALLBACKS, icon)
    ? ICON_FALLBACKS[icon]
    : [];
  return [icon, ...more];
}

/**
 * The first of `icons` that `setIcon` knows (Lucide renamed several between
 * the versions Obsidian has shipped), or a short text label on a build where
 * the icon comes up blank.
 */
function iconInto(el: HTMLElement, icons: readonly string[], fallback: string): void {
  for (const icon of icons) {
    el.empty();
    setIcon(el, icon);
    const svg = el.querySelector("svg");
    if (svg && svg.childElementCount > 0) return;
  }
  el.empty();
  if (fallback) el.setText(fallback);
}
