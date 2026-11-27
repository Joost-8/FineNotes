/**
 * Writing Guides popover — reuses FineNotes' existing popover switches
 * (`.goodobsidian-switch-row`), tile selectors (`.goodobsidian-shape-tiles`),
 * range sliders (`.goodobsidian-width-range` + `dragRange` + `syncRangeFill`),
 * and colour picker (`renderColorPicker`).
 */

import { addIcon, setIcon } from "obsidian";
import { t } from "../i18n/translate";
import type { GoodObsidianSettings } from "../settings-data";
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";
import { blankPage } from "../model/document";
import {
  DEFAULT_WRITING_GUIDES,
  WRITING_GUIDES_ICON,
  writingGuidesOf,
  type WritingGuideStyle,
} from "../model/writing-guides";
import { paintWritingGuides } from "../canvas/writing-guides";
import { renderColorPicker } from "./color-picker";

export { WRITING_GUIDES_ICON };
const WRITING_GUIDES_SVG =
  '<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/>' +
  '<path d="M3.5 9h17M3.5 14.5h17"/>' +
  '<path d="M9.5 3.5v17M15 3.5v17" stroke-opacity="0.38" stroke-dasharray="2 2"/>' +
  "</g>";

let guideIconRegistered = false;

export function ensureWritingGuidesIcon(): void {
  if (guideIconRegistered || typeof addIcon !== "function") return;
  guideIconRegistered = true;
  addIcon(WRITING_GUIDES_ICON, WRITING_GUIDES_SVG);
}

export interface WritingGuideHost {
  state: () => {
    enabled: boolean;
    style: WritingGuideStyle;
    paper: string;
    scale: number;
  };
  enable: (enabled: boolean) => void;
  configure: (patch: Partial<WritingGuideStyle>) => void;
  subscribe: (changed: () => void) => () => void;
}

/** All open surfaces reflect the same plugin settings. */
const listenersBySettings = new WeakMap<GoodObsidianSettings, Set<() => void>>();

export function watchWritingGuides(settings: GoodObsidianSettings, update: () => void): () => void {
  let listeners = listenersBySettings.get(settings);
  if (!listeners) {
    listeners = new Set();
    listenersBySettings.set(settings, listeners);
  }
  listeners.add(update);
  return () => listeners.delete(update);
}

export function writingGuideHost(
  settings: GoodObsidianSettings,
  save: () => void,
  context: () => { paper: string; scale: number } | undefined,
): WritingGuideHost {
  const apply = (enabled: boolean, style: WritingGuideStyle): void => {
    settings.writingGuidesEnabled = enabled;
    settings.writingGuides = { ...style };
    for (const update of listenersBySettings.get(settings) ?? []) update();
    save();
  };
  return {
    state: () => ({
      enabled: settings.writingGuidesEnabled === true,
      style: writingGuidesOf(settings.writingGuides),
      ...(context() ?? { paper: "#ffffff", scale: 1 }),
    }),
    enable: (enabled) => apply(enabled, writingGuidesOf(settings.writingGuides)),
    configure: (patch) =>
      apply(
        settings.writingGuidesEnabled === true,
        writingGuidesOf({ ...writingGuidesOf(settings.writingGuides), ...patch }),
      ),
    subscribe: (update) => watchWritingGuides(settings, update),
  };
}

interface SwitchControl {
  set: (on: boolean) => void;
}

function makeSwitchRow(
  parent: HTMLElement,
  label: string,
  onChange: (on: boolean) => void,
): SwitchControl {
  const row = parent.createEl("button", {
    cls: "goodobsidian-switch-row clickable-icon",
    attr: { role: "switch", "aria-checked": "false" },
  });
  row.createSpan({ cls: "goodobsidian-switch-label", text: label });
  row.createSpan({ cls: "goodobsidian-switch" }).createSpan({ cls: "goodobsidian-switch-thumb" });
  let current = false;
  const set = (on: boolean): void => {
    current = on;
    row.toggleClass("is-on", on);
    row.setAttribute("aria-checked", String(on));
  };
  row.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !current;
    set(next);
    onChange(next);
  });
  return { set };
}

function renderWritingGuideControls(
  parent: HTMLElement,
  host: WritingGuideHost,
  onResize?: () => void,
): () => void {
  const switches = parent.createDiv({ cls: "goodobsidian-switch-list" });
  const enabled = makeSwitchRow(switches, t("toolbar.tool.guides"), (v) => host.enable(v));
  parent.createDiv({ cls: "goodobsidian-popover-divider" });

  // Style tiles reusing FineNotes' `.goodobsidian-shape-tiles` row.
  parent.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.style") });
  const tiles = parent.createDiv({
    cls: "goodobsidian-shape-tiles",
    attr: { role: "group", "aria-label": t("toolbar.text.style") },
  });
  const styleButtons = new Map<WritingGuideStyle["style"], HTMLButtonElement>();
  for (const [id, icon, label] of [
    ["lines", "align-justify", t("notebooks.designer.ruling.lines")],
    ["grid", "grid", t("surface.margin.paper.grid")],
    ["dots", "grip", t("notebooks.designer.ruling.dots")],
  ] as const) {
    const btn = tiles.createEl("button", {
      cls: "goodobsidian-shape-tile clickable-icon",
      attr: { "aria-pressed": "false" },
    });
    setIcon(btn.createSpan({ cls: "goodobsidian-shape-tile-icon" }), icon);
    btn.createSpan({ cls: "goodobsidian-shape-tile-label", text: label });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      host.configure({ style: id });
    });
    styleButtons.set(id, btn);
  }

  // Sliders reusing FineNotes' `.goodobsidian-width-head` + `.goodobsidian-width-range`.
  const sliders = new Map<
    "spacing" | "thickness" | "opacity",
    { input: HTMLInputElement; readout: HTMLElement }
  >();
  for (const [key, title, min, max, step, factor] of [
    ["spacing", t("notebooks.designer.spacing"), 8, 128, 1, 1],
    ["thickness", t("toolbar.guides.thickness"), 0.5, 3, 0.1, 1],
    ["opacity", t("surface.selectionBar.segment.opacity"), 5, 60, 1, 100],
  ] as const) {
    const head = parent.createDiv({ cls: "goodobsidian-width-head goodobsidian-shape-panel-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: title });
    const readout = head.createSpan({ cls: "goodobsidian-width-readout" });
    const slider = parent.createDiv({ cls: "goodobsidian-width-slider" });
    const input = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": title },
    });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    dragRange(input);
    input.addEventListener("input", () => {
      syncRangeFill(input);
      host.configure({ [key]: Number(input.value) / factor });
    });
    sliders.set(key, { input, readout });
  }

  parent.createDiv({ cls: "goodobsidian-popover-divider" });

  // Auto colour switch + FineNotes' shared colour picker when custom colour is enabled.
  const colorSwitches = parent.createDiv({ cls: "goodobsidian-switch-list" });
  const autoColor = makeSwitchRow(colorSwitches, t("toolbar.guides.autoColor"), (on) => {
    host.configure({ colorMode: on ? "auto" : "custom" });
  });
  const pickerWrap = parent.createDiv({ cls: "is-hidden" });
  let pickerColor = "";

  const preview = parent.createEl("canvas", {
    cls: "goodobsidian-guide-preview",
    attr: { "aria-label": t("toolbar.guides.preview") },
  });

  const footer = parent.createDiv({ cls: "goodobsidian-guide-footer" });
  const hint = footer.createSpan({ cls: "goodobsidian-popover-hint" });
  const reset = footer.createEl("button", {
    cls: "goodobsidian-width-reset clickable-icon",
    attr: { "aria-label": t("toolbar.reset"), title: t("toolbar.reset") },
  });
  setIcon(reset, "rotate-ccw");
  reset.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    host.configure({ ...DEFAULT_WRITING_GUIDES });
  });

  let previewKey = "";
  const refresh = (): void => {
    const state = host.state();
    const style = writingGuidesOf(state.style);
    enabled.set(state.enabled);

    for (const [id, btn] of styleButtons) {
      const active = id === style.style;
      btn.toggleClass("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    }

    for (const [key, ctrl] of sliders) {
      const n = style[key];
      ctrl.input.value = String(key === "opacity" ? Math.round(n * 100) : n);
      syncRangeFill(ctrl.input);
      ctrl.readout.setText(
        key === "opacity"
          ? `${Math.round(n * 100)}%`
          : key === "thickness"
            ? `${n.toFixed(1)} px`
            : `${n} px`,
      );
    }

    const isAuto = style.colorMode === "auto";
    const wasHidden = pickerWrap.hasClass("is-hidden");
    autoColor.set(isAuto);
    pickerWrap.toggleClass("is-hidden", isAuto);
    if (!isAuto && pickerColor !== style.customColor) {
      pickerColor = style.customColor;
      pickerWrap.empty();
      renderColorPicker(pickerWrap, {
        current: style.customColor,
        recent: [],
        onPick: (color) => {
          if (color) host.configure({ customColor: color, colorMode: "custom" });
        },
        onCustom: (color) => host.configure({ customColor: color, colorMode: "custom" }),
      });
    } else if (isAuto) {
      pickerColor = "";
    }
    if (wasHidden !== isAuto) onResize?.();

    const scale = Math.max(0.1, state.scale);
    hint.setText(t("toolbar.guides.zoomSpacing", { value: (style.spacing * scale).toFixed(0) }));
    const key = JSON.stringify([style, state.paper, Math.round(scale * 100)]);
    if (previewKey === key) return;
    previewKey = key;

    const dpr = Math.min(2, parent.ownerDocument.defaultView?.devicePixelRatio || 1);
    const width = 264;
    const height = 56;
    preview.width = width * dpr;
    preview.height = height * dpr;
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = state.paper;
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);
    const page = blankPage("guide-preview", { width: width / scale, height: height / scale });
    paintWritingGuides(
      ctx,
      page,
      { minX: 0, minY: 0, maxX: page.geometry.width, maxY: page.geometry.height },
      style,
      state.paper,
      scale,
      scale * dpr,
    );
  };

  refresh();
  return host.subscribe(refresh);
}

export class WritingGuidePopover {
  private readonly el: HTMLElement;
  private readonly cleanups: Array<() => void> = [];
  private closed = false;

  constructor(
    readonly anchorEl: HTMLElement,
    host: WritingGuideHost,
    onClose?: () => void,
  ) {
    const doc = anchorEl.ownerDocument;
    const win = doc.defaultView ?? window;
    this.el = doc.body.createDiv({
      cls: "goodobsidian-popover goodobsidian-guide-popover",
    });
    this.el.setAttribute("role", "dialog");
    const body = this.el.createDiv({ cls: "goodobsidian-popover-body goodobsidian-shape-panel" });

    // Isolate events so tapping inside the popover never flips Live Preview to raw code.
    const stop = (e: Event): void => e.stopPropagation();
    for (const evt of ["mousedown", "pointerdown", "touchstart", "click"] as const) {
      this.el.addEventListener(evt, stop);
      this.cleanups.push(() => this.el.removeEventListener(evt, stop));
    }

    const place = (): void => {
      const rect = anchorEl.getBoundingClientRect();
      const popW = this.el.offsetWidth || 320;
      const popH = this.el.offsetHeight || 340;
      const left = Math.max(
        8,
        Math.min(win.innerWidth - popW - 8, rect.left + rect.width / 2 - popW / 2),
      );
      const below = rect.bottom + 8;
      const top = below + popH <= win.innerHeight - 8 ? below : Math.max(8, rect.top - popH - 8);
      this.el.setCssStyles({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    };

    this.cleanups.push(renderWritingGuideControls(body, host, place));
    place();
    const raf = win.requestAnimationFrame(place);
    this.cleanups.push(() => win.cancelAnimationFrame(raf));

    const onOutside = (e: Event): void => {
      const target = e.target as Node | null;
      if (!target || this.el.contains(target) || anchorEl.contains(target)) return;
      this.close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
      anchorEl.focus({ preventScroll: true });
    };
    win.addEventListener("resize", place);
    this.cleanups.push(() => win.removeEventListener("resize", place));
    win.addEventListener("pointerdown", onOutside, true);
    win.addEventListener("keydown", onKey, true);
    this.cleanups.push(() => win.removeEventListener("pointerdown", onOutside, true));
    this.cleanups.push(() => win.removeEventListener("keydown", onKey, true));
    if (onClose) this.cleanups.push(onClose);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.el.remove();
  }
}
