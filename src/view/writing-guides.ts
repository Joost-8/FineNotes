/**
 * Writing guides in a view: each notebook's own (`model/writing-guides.ts`),
 * kept in the plugin's settings by its path, shown on its surface and in its
 * inline Handwrite here blocks alike.
 *
 * The toolbar button works as the ruler's does: a tap turns the guides on or
 * off; while they are on, its chevron opens their look (style, spacing,
 * thickness, opacity, colour) in the toolbar's own popover.
 *
 * A slider changes the page as it is dragged, but only the page: the
 * surface repairs its tiles within the frame budget (`Renderer.refreshAll`)
 * and the settings are written once, when the slider is let go.
 */

import { addIcon, setIcon } from "obsidian";
import { t } from "../i18n/translate";
import type { GoodObsidianSettings } from "../settings-data";
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";
import { pageToMm } from "../model/units";
import {
  DEFAULT_WRITING_GUIDES,
  type GuideEntry,
  WRITING_GUIDES_ICON,
  guidesOf,
  withGuides,
  writingGuidesOf,
  type WritingGuideStyle,
} from "../model/writing-guides";
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

/** Every binding over one settings object hears a change to any notebook's guides. */
const listenersBySettings = new WeakMap<GoodObsidianSettings, Set<(path: string) => void>>();

function listenersOf(settings: GoodObsidianSettings): Set<(path: string) => void> {
  let set = listenersBySettings.get(settings);
  if (!set) {
    set = new Set();
    listenersBySettings.set(settings, set);
  }
  return set;
}

/** One view's hold on its notebook's guides (`bindWritingGuides`). */
export interface GuideBinding {
  /** Whether this notebook's guides show. */
  on: () => boolean;
  /** Turn them on or off, and keep it. */
  toggle: () => void;
  /** Read the notebook's guides again (its path changed) and show them. */
  sync: () => void;
  /** Draw the look's controls into `body`; the returned function takes them down. */
  render: (body: HTMLElement, resize: () => void) => () => void;
  dispose: () => void;
}

export function bindWritingGuides(opts: {
  settings: GoodObsidianSettings;
  /** Write the settings to disk. */
  save: () => void;
  /** The notebook's path; `null` while it has no file. */
  path: () => string | null;
  /** Show `style` on the surface, or no guides (`null`). */
  apply: (style: WritingGuideStyle | null) => void;
  /** The guides were turned on or off: the toolbar's mark follows. */
  changed: () => void;
}): GuideBinding {
  const { settings } = opts;
  const listeners = listenersOf(settings);
  const entry = (): GuideEntry =>
    guidesOf(settings.writingGuideNotebooks, settings.writingGuides, opts.path());
  const sync = (): void => {
    const now = entry();
    opts.apply(now.on ? now.style : null);
    opts.changed();
  };
  /** Set this notebook's guides; every view of it follows; `keep` writes them to disk. */
  const set = (next: GuideEntry, keep: boolean): void => {
    const path = opts.path();
    if (path === null) return;
    settings.writingGuideNotebooks = withGuides(settings.writingGuideNotebooks, path, next);
    // A notebook turned on later starts in the look chosen last.
    settings.writingGuides = { ...next.style };
    for (const heard of [...listeners]) heard(path);
    if (keep) opts.save();
  };
  const heard = (path: string): void => {
    if (path === opts.path()) sync();
  };
  listeners.add(heard);
  sync();
  return {
    on: () => entry().on,
    toggle: () => {
      const now = entry();
      set({ on: !now.on, style: now.style }, true);
    },
    sync,
    render: (body, resize) =>
      renderGuideControls(body, resize, {
        style: () => entry().style,
        configure: (patch, keep) => {
          const now = entry();
          set({ on: now.on, style: writingGuidesOf({ ...now.style, ...patch }) }, keep);
        },
        save: opts.save,
        subscribe: (update) => {
          const onChange = (path: string): void => {
            if (path === opts.path()) update();
          };
          listeners.add(onChange);
          return () => listeners.delete(onChange);
        },
      }),
    dispose: () => {
      listeners.delete(heard);
    },
  };
}

interface ControlsHost {
  style: () => WritingGuideStyle;
  /** Change the look; `keep` writes it to disk (a slider passes false while it moves). */
  configure: (patch: Partial<WritingGuideStyle>, keep: boolean) => void;
  save: () => void;
  subscribe: (changed: () => void) => () => void;
}

function switchRow(parent: HTMLElement, label: string, onChange: (on: boolean) => void) {
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
  row.addEventListener("click", () => onChange(!current));
  return { set };
}

/** The look's controls: style tiles, three sliders, auto colour or a colour, reset. */
function renderGuideControls(
  parent: HTMLElement,
  resize: () => void,
  host: ControlsHost,
): () => void {
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
    btn.addEventListener("click", () => host.configure({ style: id }, true));
    styleButtons.set(id, btn);
  }

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
    // While it moves the page follows; it is written to disk once, let go.
    input.addEventListener("input", () => {
      syncRangeFill(input);
      host.configure({ [key]: Number(input.value) / factor }, false);
    });
    input.addEventListener("change", () => host.save());
    sliders.set(key, { input, readout });
  }

  const colorSwitches = parent.createDiv({ cls: "goodobsidian-switch-list" });
  const autoColor = switchRow(colorSwitches, t("toolbar.guides.autoColor"), (on) =>
    host.configure({ colorMode: on ? "auto" : "custom" }, true),
  );
  const pickerWrap = parent.createDiv({ cls: "is-hidden" });
  let pickerColor = "";

  const reset = parent.createEl("button", {
    cls: "goodobsidian-width-reset clickable-icon",
    attr: { "aria-label": t("toolbar.reset") },
  });
  setIcon(reset, "rotate-ccw");
  reset.addEventListener("click", () => host.configure({ ...DEFAULT_WRITING_GUIDES }, true));

  const refresh = (): void => {
    const style = host.style();
    for (const [id, btn] of styleButtons) {
      const active = id === style.style;
      btn.toggleClass("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    for (const [key, ctrl] of sliders) {
      const n = style[key];
      // A slider being dragged keeps its own value.
      if (parent.ownerDocument.activeElement !== ctrl.input) {
        ctrl.input.value = String(key === "opacity" ? Math.round(n * 100) : n);
        syncRangeFill(ctrl.input);
      }
      ctrl.readout.setText(
        key === "opacity"
          ? `${Math.round(n * 100)}%`
          : key === "thickness"
            ? n.toFixed(1)
            : `${pageToMm(n).toFixed(1)} mm`,
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
          if (color) host.configure({ customColor: color, colorMode: "custom" }, true);
        },
        onCustom: (color) => host.configure({ customColor: color, colorMode: "custom" }, true),
      });
    } else if (isAuto) {
      pickerColor = "";
    }
    if (wasHidden !== isAuto) resize();
  };

  refresh();
  return host.subscribe(refresh);
}
