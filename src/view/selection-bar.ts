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
 * Android does synthesise that click, after the action ran; `ghost-click.ts`
 * eats it, or it would close a dialog the action opened.
 *
 * The pill and the menu are dark in every theme, as GoodNotes draws them.
 * They carry Obsidian's own `theme-dark` class, which re-declares the
 * `--color-base-*` palette on them, and styles.css colours them from those —
 * Obsidian's variables, dark flavour, whatever the app theme is.
 */

import { setIcon } from "obsidian";
import { renderColorMixer, renderColorPicker } from "./color-picker";
import type { Bounds } from "../model/document";
import { FILL_OPACITIES, nearestFillOpacity } from "../model/shape-style";
import { swallowGhostClick } from "./ghost-click";
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";
import {
  type ActionLine,
  type PanelFill,
  type SelectionAction,
  actionsKey,
  barItems,
  compactSwatches,
  isEnabled,
  menuLayout,
  placeFloating,
} from "./selection-bar-model";
import { t } from "../i18n/translate";

/** Space between the selection (and anything sticking out of it) and the bar, px. */
const BAR_GAP_PX = 12;
/** Least distance kept between the bar or menu and the edge of the visible area, px. */
const EDGE_MARGIN_PX = 8;
/** Space between the "…" button and the menu, px. */
const MENU_GAP_PX = 6;
/** The menu's height cap never goes below this, however little room is left. */
const MENU_MIN_HEIGHT_PX = 160;

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
  /** The submenu shown in place of the menu ("Turn into"), or null for the menu itself. */
  private submenu: string | null = null;
  /** The colour row shows every colour, the eyedropper and "+", until the menu closes. */
  private swatchesOpen = false;
  /** The visible area the bar was last placed in, for placing the menu. */
  private visible: Bounds | null = null;
  /** The colour panel, open from the bar's colour disc; and the entry it belongs to. */
  private panelEl: HTMLElement | null = null;
  private panelFor: string | null = null;
  private readonly onOutsideDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target && (this.menuEl?.contains(target) || this.moreButton?.contains(target))) return;
    this.closeMenu();
  };
  private readonly onOutsidePanel = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target && (this.panelEl?.contains(target) || this.panelButton()?.contains(target))) return;
    this.closePanel();
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
    if (this.panelEl) this.renderPanel();
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
    if (this.panelEl) this.placePanel();
  }

  /** Hide the bar and close its menu and colour panel. */
  hide(): void {
    this.closeMenu();
    this.closePanel();
    this.el.addClass("is-hidden");
  }

  /** Whether the colour panel is open. */
  get isPanelOpen(): boolean {
    return this.panelEl !== null;
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
    this.submenu = null;
    this.swatchesOpen = false;
    this.moreButton?.removeClass("is-active");
    this.parent.ownerDocument.removeEventListener("pointerdown", this.onOutsideDown, true);
  }

  closePanel(): void {
    if (!this.panelEl) return;
    this.panelEl.remove();
    this.panelEl = null;
    this.panelButton()?.removeClass("is-active");
    this.panelFor = null;
    this.parent.ownerDocument.removeEventListener("pointerdown", this.onOutsidePanel, true);
  }

  destroy(): void {
    this.closeMenu();
    this.closePanel();
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
        const more = this.button(
          this.el,
          "goodobsidian-selection-button is-more",
          t("common.more"),
        );
        iconInto(more, ["more-horizontal", "ellipsis"], "…");
        onTap(more, () => this.toggleMenu());
        this.moreButton = more;
        continue;
      }
      const { action } = item;
      if (action.swatches) {
        this.colourDisc(action);
        continue;
      }
      const button = this.button(this.el, "goodobsidian-selection-button", action.label);
      if (action.line) {
        // Opens the line panel, as the colour disc opens the colour panel.
        button.addClass("is-panel");
        button.dataset.action = action.id;
        button.setAttribute("aria-haspopup", "dialog");
        iconInto(button, iconsFor(action.icon), action.label.slice(0, 2));
        button.toggleClass("is-active", this.panelFor === action.id);
        this.decorate(button, action);
        onTap(button, () => this.togglePanel(action.id));
        continue;
      }
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
      if (action.checked !== undefined) {
        // A switch in the bar (the resize handles, a shape's corner points):
        // pressed while on.
        button.setAttribute("aria-pressed", String(action.checked));
        button.toggleClass("is-on", action.checked);
      }
      this.decorate(button, action);
      onTap(button, () => this.run(action.id, true));
    }
  }

  /**
   * The bar's colour: a disc of the selection's colour (a ring of the
   * common colours when it mixes them) that opens the colour panel.
   */
  private colourDisc(action: SelectionAction): void {
    const swatches = action.swatches;
    if (!swatches) return;
    const button = this.button(this.el, "goodobsidian-selection-button is-colour", action.label);
    button.dataset.action = action.id;
    button.setAttribute("aria-haspopup", "dialog");
    const disc = button.createSpan({ cls: "goodobsidian-selection-colour-disc" });
    const current = swatches.current;
    // The disc *is* the colour: a value, not chrome.
    if (current) disc.setCssStyles({ background: swatches.shown?.(current) ?? current });
    else disc.addClass("is-mixed");
    button.toggleClass("is-active", this.panelFor === action.id);
    this.decorate(button, action);
    onTap(button, () => this.togglePanel(action.id));
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
    // A choice in the bar itself (a linked shape's type) marks the one it is.
    if (action.checked !== undefined && action.bar === true) {
      button.toggleClass("is-on", action.checked);
      button.setAttribute("aria-pressed", String(action.checked));
    }
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

  // --- The colour panel ------------------------------------------------------

  /** The bar's disc the open panel hangs from. */
  private panelButton(): HTMLElement | null {
    if (this.panelFor === null) return null;
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>("[data-action]"))) {
      if (el.dataset.action === this.panelFor) return el;
    }
    return null;
  }

  private togglePanel(id: string): void {
    if (this.panelEl) {
      this.closePanel();
      return;
    }
    this.closeMenu();
    this.panelFor = id;
    const action = this.actions.find((a) => a.id === id);
    this.panelEl = this.parent.createDiv({
      cls: "goodobsidian-selection-menu goodobsidian-colour-panel theme-dark",
      attr: { role: "dialog", "aria-label": action?.label ?? "" },
    });
    stopPageInput(this.panelEl);
    this.panelButton()?.addClass("is-active");
    this.renderPanel();
    this.parent.ownerDocument.addEventListener("pointerdown", this.onOutsidePanel, true);
  }

  /**
   * Goodnotes' Change colour: the colours (the same picker as the pens', so
   * one pattern serves everywhere), then, for shapes that fill, the fill's
   * switch and its opacity.
   */
  private renderPanel(): void {
    const panel = this.panelEl;
    const action = this.actions.find((a) => a.id === this.panelFor);
    if (panel && action?.line) {
      panel.empty();
      this.panelButton()?.addClass("is-active");
      panel.createDiv({ cls: "goodobsidian-colour-panel-title", text: action.label });
      this.renderLine(panel, action);
      this.placePanel();
      return;
    }
    const swatches = action?.swatches;
    if (!panel || !action || !swatches) {
      this.closePanel();
      return;
    }
    panel.empty();
    this.panelButton()?.addClass("is-active");
    panel.createDiv({ cls: "goodobsidian-colour-panel-title", text: action.label });
    const latest = (): SelectionAction | undefined =>
      this.actions.find((a) => a.id === action.id && isEnabled(a));
    const picker = panel.createDiv({ cls: "goodobsidian-colour-panel-picker" });
    const eyedropper = swatches.eyedropper;
    renderColorPicker(picker, {
      current: swatches.current,
      notebook: swatches.notebook,
      extra: swatches.colors,
      recent: swatches.recent ?? [],
      shown: swatches.shown,
      onPick: (color) => {
        if (color) latest()?.swatches?.pick(color);
      },
      onCustom: (color) => {
        const now = latest()?.swatches;
        (now?.custom ?? now?.pick)?.(color);
      },
      ...(eyedropper
        ? {
            onEyedropper: () => {
              // The next tap on the page picks; the panel would cover it.
              this.closePanel();
              latest()?.swatches?.eyedropper?.();
            },
          }
        : {}),
      tap: (button, run) => onTap(button as HTMLButtonElement, run),
    });
    if (swatches.fill) this.renderFill(panel, swatches.fill, () => latest()?.swatches?.fill);
    this.placePanel();
  }

  /** The fill's switch, and while it is on, its opacity slider. */
  private renderFill(
    panel: HTMLElement,
    fill: PanelFill,
    latest: () => PanelFill | undefined,
  ): void {
    panel.createDiv({ cls: "goodobsidian-selection-menu-divider" });
    const list = panel.createDiv({ cls: "goodobsidian-switch-list" });
    const label = t("surface.shapeStyle.fill");
    const row = list.createEl("button", {
      cls: "goodobsidian-switch-row clickable-icon",
      attr: { role: "switch", "aria-checked": String(fill.on === true), "aria-label": label },
    });
    row.createSpan({ cls: "goodobsidian-switch-label", text: label });
    row.createSpan({ cls: "goodobsidian-switch" }).createSpan({ cls: "goodobsidian-switch-thumb" });
    row.toggleClass("is-on", fill.on === true);
    onTap(row, () => latest()?.set(fill.on !== true));
    if (fill.on !== true) return;

    const head = panel.createDiv({
      cls: "goodobsidian-width-head goodobsidian-colour-panel-opacity",
    });
    const opacity = t("surface.selectionBar.segment.opacity");
    head.createDiv({ cls: "goodobsidian-popover-label", text: opacity });
    const readout = head.createSpan({ cls: "goodobsidian-width-readout" });
    const slider = panel.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": opacity },
    });
    range.min = "0";
    range.max = String(FILL_OPACITIES.length - 1);
    range.step = "1";
    range.value = String(FILL_OPACITIES.indexOf(nearestFillOpacity(fill.alpha)));
    dragRange(range);
    const stop = (): number => FILL_OPACITIES[Number(range.value)] ?? 1;
    const show = (): void => {
      readout.setText(`${Math.round(stop() * 100)} %`);
      syncRangeFill(range);
    };
    show();
    range.addEventListener("input", show);
    // One undo step per drag: the shapes take the opacity the knob is let go at.
    range.addEventListener("change", () => latest()?.setAlpha(stop()));
  }

  /**
   * The line panel: its styles as tiles (None, Solid, Dashed, Dotted), the
   * width on a slider with its mm readout, then the corners and arrowheads
   * as the menu drew them. A tap keeps the panel open, to try another.
   */
  private renderLine(panel: HTMLElement, action: SelectionAction): void {
    const line = action.line;
    if (!line) return;
    const latest = (): ActionLine | undefined =>
      this.actions.find((a) => a.id === action.id && isEnabled(a))?.line;
    const strip = panel.createDiv({ cls: "goodobsidian-selection-tiles is-line-styles" });
    for (const style of line.styles) {
      const tile = this.button(strip, "goodobsidian-selection-tile", style.label);
      iconInto(
        tile.createSpan({ cls: "goodobsidian-selection-tile-icon" }),
        iconsFor(style.icon),
        "",
      );
      tile.createSpan({ cls: "goodobsidian-selection-tile-label", text: style.label });
      tile.toggleClass("is-active", style.checked === true);
      tile.setAttribute("aria-pressed", String(style.checked === true));
      this.decorate(tile, style);
      onTap(tile, () => {
        const now = latest()?.styles.find((s) => s.id === style.id);
        if (now && isEnabled(now)) now.run?.();
      });
    }

    const head = panel.createDiv({
      cls: "goodobsidian-width-head goodobsidian-colour-panel-opacity",
    });
    const widthLabel = t("toolbar.width.title");
    head.createDiv({ cls: "goodobsidian-popover-label", text: widthLabel });
    const readout = head.createSpan({ cls: "goodobsidian-width-readout" });
    const slider = panel.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": widthLabel },
    });
    const stops = line.stops;
    range.min = "0";
    range.max = String(Math.max(0, stops.length - 1));
    range.step = "1";
    range.value = String(nearestIndex(stops, line.width ?? stops[0] ?? 1));
    dragRange(range);
    const width = (): number => stops[Number(range.value)] ?? line.width ?? 1;
    const show = (moved: boolean): void => {
      readout.setText(line.width === null && !moved ? "–" : line.label(width()));
      syncRangeFill(range);
    };
    show(false);
    range.addEventListener("input", () => show(true));
    // One undo step per drag: the width the knob is let go at.
    range.addEventListener("change", () => latest()?.setWidth(width()));

    const segments: string[] = [];
    for (const row of line.rows) {
      if (row.segment !== undefined && !segments.includes(row.segment)) segments.push(row.segment);
    }
    if (segments.length > 0) panel.createDiv({ cls: "goodobsidian-selection-menu-divider" });
    for (const segment of segments) {
      this.renderSegments(
        panel,
        segment,
        line.rows.filter((row) => row.segment === segment),
        (id) => {
          const now = latest()?.rows.find((row) => row.id === id);
          if (now && isEnabled(now)) now.run?.();
        },
      );
    }
  }

  /** Hang the panel from the colour disc, below the bar, or above it when there is no room. */
  private placePanel(): void {
    const panel = this.panelEl;
    const disc = this.panelButton();
    if (!panel || !disc) return;
    const anchor: Bounds = {
      minX: this.el.offsetLeft + disc.offsetLeft,
      minY: this.el.offsetTop,
      maxX: this.el.offsetLeft + disc.offsetLeft + disc.offsetWidth,
      maxY: this.el.offsetTop + this.el.offsetHeight,
    };
    const visible = this.visible ?? anchor;
    const below = visible.maxY - EDGE_MARGIN_PX - (anchor.maxY + MENU_GAP_PX);
    const above = anchor.minY - MENU_GAP_PX - (visible.minY + EDGE_MARGIN_PX);
    panel.setCssStyles({
      maxHeight: `${Math.round(Math.max(MENU_MIN_HEIGHT_PX, below, above))}px`,
    });
    const at = placeFloating(anchor, { w: panel.offsetWidth, h: panel.offsetHeight }, visible, {
      gap: MENU_GAP_PX,
      margin: EDGE_MARGIN_PX,
      prefer: below >= above ? "below" : "above",
    });
    panel.setCssStyles({ left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px` });
  }

  // --- The "…" menu -----------------------------------------------------------

  private toggleMenu(): void {
    if (this.menuEl) {
      this.closeMenu();
      return;
    }
    this.closePanel();
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
    const open = this.submenu
      ? layout.rows.find((row) => row.kind === "submenu" && row.label === this.submenu)
      : undefined;
    if (open?.kind === "submenu") {
      // A sub-panel in place of the menu: a way back, then its rows.
      const back = this.button(
        menu,
        "goodobsidian-selection-row is-back",
        t("surface.selectionBar.back"),
      );
      iconInto(back.createSpan({ cls: "goodobsidian-selection-row-icon" }), ["chevron-left"], "‹");
      back.createSpan({ cls: "goodobsidian-selection-row-label", text: open.label });
      onTap(back, () => {
        this.submenu = null;
        this.renderMenu();
      });
      menu.createDiv({ cls: "goodobsidian-selection-menu-divider" });
      for (const action of open.actions) this.renderRow(menu, action);
      this.placeMenu();
      return;
    }
    this.submenu = null;
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
      } else if (row.kind === "segments") {
        this.renderSegments(menu, row.label, row.actions);
      } else if (row.kind === "submenu") {
        const button = this.button(menu, "goodobsidian-selection-row", row.label);
        button.setAttribute("role", "menuitem");
        button.setAttribute("aria-haspopup", "menu");
        iconInto(
          button.createSpan({ cls: "goodobsidian-selection-row-icon" }),
          iconsFor(row.icon),
          "",
        );
        button.createSpan({ cls: "goodobsidian-selection-row-label", text: row.label });
        iconInto(
          button.createSpan({ cls: "goodobsidian-selection-row-check is-chevron" }),
          ["chevron-right"],
          "›",
        );
        const label = row.label;
        onTap(button, () => {
          this.submenu = label;
          this.renderMenu();
        });
      } else if (row.action.swatches) {
        this.renderSwatches(menu, row.action);
      } else {
        this.renderRow(menu, row.action);
      }
    }
    this.placeMenu();
  }

  /** One row of the menu: icon, label, and a check when it is a choice that is on. */
  private renderRow(menu: HTMLElement, action: SelectionAction): void {
    const button = this.button(menu, "goodobsidian-selection-row", action.label);
    button.setAttribute("role", "menuitem");
    iconInto(
      button.createSpan({ cls: "goodobsidian-selection-row-icon" }),
      iconsFor(action.icon),
      "",
    );
    button.createSpan({ cls: "goodobsidian-selection-row-label", text: action.label });
    if (action.checked !== undefined) {
      button.setAttribute("role", "menuitemcheckbox");
      button.setAttribute("aria-checked", String(action.checked));
      const check = button.createSpan({ cls: "goodobsidian-selection-row-check" });
      if (action.checked) iconInto(check, ["check"], "✓");
    }
    this.decorate(button, action);
    onTap(button, () => this.run(action.id, true));
  }

  /**
   * A labelled row of icon buttons, the one that is on lit. A tap keeps the
   * menu open, as a swatch does, so a fill and a line can be tried in turn.
   */
  private renderSegments(
    menu: HTMLElement,
    label: string,
    actions: SelectionAction[],
    run: (id: string) => void = (id) => this.run(id, false),
  ): void {
    const row = menu.createDiv({ cls: "goodobsidian-selection-segments" });
    row.createSpan({ cls: "goodobsidian-selection-segments-label", text: label });
    const group = row.createDiv({
      cls: "goodobsidian-selection-segment-group",
      attr: { role: "group", "aria-label": label },
    });
    for (const action of actions) {
      const button = this.button(group, "goodobsidian-selection-segment", action.label);
      if (action.showLabel) {
        // A value no icon says (an opacity): its words.
        button.addClass("has-label");
        button.setText(action.label);
      } else {
        iconInto(button, iconsFor(action.icon), action.label.slice(0, 2));
      }
      if (action.checked !== undefined) {
        button.setAttribute("aria-pressed", String(action.checked));
        button.toggleClass("is-active", action.checked);
      }
      this.decorate(button, action);
      onTap(button, () => run(action.id));
    }
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
    // One line at first: the first colours (the selection's own among them)
    // and a chevron; the rest, the eyedropper and "+" come with the chevron.
    const shown = compactSwatches(swatches.colors, current);
    block.toggleClass("is-expanded", this.swatchesOpen);
    for (const color of swatches.colors) {
      // A 44 px target round a smaller disc. The disc *is* the ink colour:
      // a value, not chrome.
      const swatch = this.button(row, "goodobsidian-selection-swatch", color);
      swatch.createSpan({ cls: "goodobsidian-selection-swatch-disc" }).setCssStyles({
        background: swatches.shown?.(color) ?? color,
      });
      swatch.toggleClass("is-active", color.toLowerCase() === current);
      swatch.toggleClass("is-extra", !shown.has(color));
      swatch.disabled = !isEnabled(action);
      onTap(swatch, () => {
        const latest = this.actions.find((a) => a.id === action.id);
        if (latest?.swatches && isEnabled(latest)) latest.swatches.pick(color);
      });
    }
    if (swatches.eyedropper) {
      // The eyedropper: the next tap on the page picks the colour.
      const dropper = this.button(
        row,
        "goodobsidian-selection-swatch is-eyedropper is-extra",
        t("surface.selectionBar.pickFromPage"),
      );
      setIcon(dropper.createSpan({ cls: "goodobsidian-selection-swatch-disc" }), "pipette");
      dropper.disabled = !isEnabled(action);
      onTap(dropper, () => {
        const latest = this.actions.find((a) => a.id === action.id);
        if (latest?.swatches?.eyedropper && isEnabled(latest)) latest.swatches.eyedropper();
      });
    }
    const expand = this.button(
      row,
      "goodobsidian-selection-swatch is-expand",
      t("surface.selectionBar.moreColours"),
    );
    const syncExpand = (): void => {
      setIcon(expand, this.swatchesOpen ? "chevron-up" : "chevron-down");
      const label = this.swatchesOpen
        ? t("surface.selectionBar.fewerColours")
        : t("surface.selectionBar.moreColours");
      expand.setAttribute("aria-label", label);
      expand.setAttribute("title", label);
      expand.setAttribute("aria-expanded", String(this.swatchesOpen));
    };
    syncExpand();
    onTap(expand, () => {
      this.swatchesOpen = !this.swatchesOpen;
      block.toggleClass("is-expanded", this.swatchesOpen);
      syncExpand();
      this.placeMenu();
    });
    if (!swatches.custom) return;
    // "+": a colour of one's own, picked by hue and shade, below the row.
    const plus = this.button(
      row,
      "goodobsidian-selection-swatch is-custom is-extra",
      t("surface.selectionBar.customColour"),
    );
    plus.createSpan({ cls: "goodobsidian-selection-swatch-disc goodobsidian-color-more" });
    plus.disabled = !isEnabled(action);
    row.append(expand);
    const mixer = block.createDiv({ cls: "goodobsidian-selection-mixer is-hidden" });
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
      // Opened at the bottom of a menu that may now scroll: show all of it.
      if (!mixer.hasClass("is-hidden") && this.menuEl) {
        this.menuEl.scrollTop = this.menuEl.scrollHeight;
      }
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
    // Never taller than the room beside the bar (the custom colour picker
    // made it run off the screen): past that it scrolls.
    const below = visible.maxY - EDGE_MARGIN_PX - (anchor.maxY + MENU_GAP_PX);
    const above = anchor.minY - MENU_GAP_PX - (visible.minY + EDGE_MARGIN_PX);
    menu.setCssStyles({ maxHeight: `${Math.round(Math.max(MENU_MIN_HEIGHT_PX, below, above))}px` });
    const at = placeFloating(anchor, { w: menu.offsetWidth, h: menu.offsetHeight }, visible, {
      gap: MENU_GAP_PX,
      margin: EDGE_MARGIN_PX,
      prefer: "below",
    });
    menu.setCssStyles({ left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px` });
  }
}

/** The index of the value in `stops` nearest `value`. */
function nearestIndex(stops: readonly number[], value: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - value) < Math.abs(stops[best] - value)) best = i;
  }
  return best;
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
export function onTap(button: HTMLButtonElement, action: () => void): void {
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
    if (button.disabled) return;
    // Android follows the lift with a click at whatever is under it by then,
    // such as the background of a dialog this action opens, which closes it.
    swallowGhostClick(button.ownerDocument, event);
    action();
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
  "wand-sparkles": ["wand-2", "wand"],
  "square-check-big": ["check-square"],
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
