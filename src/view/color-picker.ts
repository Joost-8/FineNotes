/**
 * The colour picker every colour choice opens: pen, highlighter, shapes,
 * text, a text box's fill, and the lasso's recolour. A grid of common
 * colours, the recent custom ones, and a custom colour picked as Notability
 * does: a saturation-by-brightness square, a hue slider, the hex value and a
 * button that adds it.
 *
 * Nothing in it takes focus. The text popovers are used while a text box is
 * being edited, and a focusable slider or field would blur the box: the edit
 * would end, the keyboard drop, and the colour land on the next new box
 * instead of this one. So the square and the slider are drawn and driven by
 * pointer events, every press cancels its default, and the hex value is
 * shown, not typed. (There is no eyedropper: iPad WebKit has no EyeDropper.)
 */

import { setIcon } from "obsidian";

import {
  COMMON_COLORS,
  type Hsv,
  contrastMark,
  hexToRgb,
  hsvToRgb,
  parseHexColor,
  rgbToHex,
  rgbToHsv,
  sameColor,
} from "../model/colors";

export interface ColorPickerOptions {
  /** The colour chosen now; `null` for none (a box without fill). */
  current: string | null;
  /** Offer "none" first (a text box's fill). */
  allowNone?: boolean;
  /** Colours to offer after the common ones (e.g. soft fills, the user's own palette). */
  extra?: readonly string[];
  /** Recent custom colours, newest first. */
  recent: readonly string[];
  /** A swatch or "none" was tapped. */
  onPick: (color: string | null) => void;
  /** A custom colour was chosen with its add button. The host records it as recent. */
  onCustom: (color: string) => void;
  /** Open the custom colour at once. */
  customOpen?: boolean;
  /** How a button is activated; a `click` listener unless the host says otherwise. */
  tap?: TapBinder;
}

/**
 * Wire `run` to a button being activated. Over the page a Pencil tap never
 * becomes a `click` (the surface cancels its touches), so a picker placed
 * there is handed the host's pointer-driven binder instead.
 */
export type TapBinder = (button: HTMLElement, run: () => void) => void;

const clickTap: TapBinder = (button, run) => button.addEventListener("click", run);

/** The four dots on the "back to the common colours" button, as Notability's. */
const PRESET_DOTS = ["#fcc419", "#fa5252", "#40c057", "#228be6"] as const;

/** Fill `body` with the picker. */
export function renderColorPicker(body: HTMLElement, options: ColorPickerOptions): void {
  body.addClass("goodobsidian-color-picker");
  noFocus(body);

  const tap = options.tap ?? clickTap;
  // Everything the custom colour replaces while it shows.
  const presets: HTMLElement[] = [];
  const grid = body.createDiv({ cls: "goodobsidian-color-grid" });
  presets.push(grid);
  if (options.allowNone) {
    const none = swatch(grid, null, options.current === null, tap, () => options.onPick(null));
    none.addClass("is-none");
    none.setAttribute("aria-label", "None");
    none.setAttribute("title", "None");
  }
  const offered: string[] = [];
  for (const color of [...COMMON_COLORS, ...(options.extra ?? [])]) {
    const hex = parseHexColor(color);
    if (!hex || offered.includes(hex)) continue;
    offered.push(hex);
    swatch(grid, hex, sameColor(hex, options.current), tap, () => options.onPick(hex));
  }

  const recent = options.recent.filter((c) => !offered.includes(c));
  if (recent.length > 0) {
    presets.push(body.createDiv({ cls: "goodobsidian-popover-label", text: "Recent" }));
    const row = body.createDiv({ cls: "goodobsidian-color-grid is-recent" });
    presets.push(row);
    for (const color of recent) {
      swatch(row, color, sameColor(color, options.current), tap, () => options.onPick(color));
    }
  }

  const toggle = body.createEl("button", {
    cls: "goodobsidian-color-custom-toggle clickable-icon",
    text: "Custom colour…",
  });
  presets.push(toggle);
  const mixer = body.createDiv();
  const open = (custom: boolean): void => {
    body.toggleClass("is-custom", custom);
    for (const el of presets) el.toggleClass("is-hidden", custom);
    mixer.toggleClass("is-hidden", !custom);
  };
  tap(toggle, () => open(true));
  renderColorMixer(mixer, options.current, options.onCustom, tap, () => open(false));
  open(options.customOpen === true);
}

/**
 * The custom colour on its own, starting at `initial`: its title (and, with
 * `onBack`, a button back to the common colours), the saturation-by-
 * brightness square, the hue slider, the hex value, and a button showing the
 * colour that hands it to `onUse`.
 */
export function renderColorMixer(
  mixer: HTMLElement,
  initial: string | null,
  onUse: (color: string) => void,
  tap: TapBinder = clickTap,
  onBack?: () => void,
): void {
  mixer.addClass("goodobsidian-color-mixer");
  noFocus(mixer);
  // Kept as hue, saturation and value, not re-read from the hex: dragging
  // to white or black must not lose the hue.
  const hsv: Hsv = rgbToHsv(hexToRgb(initial ?? "") ?? { r: 0, g: 0, b: 0 });

  const head = mixer.createDiv({ cls: "goodobsidian-color-mixer-head" });
  head.createDiv({ cls: "goodobsidian-popover-title", text: "Custom colour" });
  if (onBack) {
    const back = head.createEl("button", {
      cls: "goodobsidian-color-presets clickable-icon",
      attr: { "aria-label": "Common colours", title: "Common colours" },
    });
    // The dots are colours, not chrome: values, like a swatch's.
    for (const dot of PRESET_DOTS) {
      back.createSpan({ cls: "goodobsidian-color-presets-dot" }).setCssStyles({ background: dot });
    }
    tap(back, onBack);
  }

  const square = mixer.createDiv({ cls: "goodobsidian-color-sv" });
  square.setAttribute("role", "slider");
  square.setAttribute("aria-label", "Saturation and brightness");
  const handle = square.createDiv({ cls: "goodobsidian-color-sv-handle" });
  drag(square, (x, y) => {
    hsv.s = x;
    hsv.v = 1 - y;
    sync();
  });

  const hueRow = mixer.createDiv({ cls: "goodobsidian-color-channel is-hue" });
  const hueTrack = hueRow.createDiv({ cls: "goodobsidian-color-track goodobsidian-color-hue" });
  hueTrack.setAttribute("role", "slider");
  hueTrack.setAttribute("aria-label", "Hue, 0 to 360 degrees");
  hueTrack.setAttribute("aria-valuemin", "0");
  hueTrack.setAttribute("aria-valuemax", "360");
  const hueThumb = hueTrack.createDiv({ cls: "goodobsidian-color-thumb" });
  const hueDot = hueThumb.createSpan({ cls: "goodobsidian-color-thumb-dot" });
  drag(hueTrack, (x) => {
    // 360° is red again: keep the far end on magenta-red, not a jump to 0.
    hsv.h = Math.min(359.9, x * 360);
    sync();
  });

  const foot = mixer.createDiv({ cls: "goodobsidian-color-mixer-foot" });
  const field = foot.createDiv({ cls: "goodobsidian-color-hexfield" });
  field.createSpan({ text: "#" });
  const hexLabel = field.createSpan({ cls: "goodobsidian-color-hex" });
  const use = foot.createEl("button", {
    cls: "goodobsidian-color-use clickable-icon",
    attr: { "aria-label": "Use this colour", title: "Use this colour" },
  });
  const preview = use.createSpan({ cls: "goodobsidian-color-preview" });
  setIcon(use, "circle-plus");
  // setIcon replaces the button's content; the preview goes back under the icon.
  use.prepend(preview);

  const sync = (): void => {
    const hex = rgbToHex(hsvToRgb(hsv));
    const hue = Math.round(hsv.h);
    square.setCssProps({ "--gob-hue": String(hue) });
    handle.setCssStyles({ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` });
    square.setAttribute(
      "aria-valuetext",
      `Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`,
    );
    hueThumb.setCssStyles({ left: `${(hsv.h / 360) * 100}%` });
    hueTrack.setAttribute("aria-valuenow", String(hue));
    // The thumb holds the pure hue; the preview is the colour itself.
    hueDot.setCssStyles({ background: rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 })) });
    preview.setCssStyles({ background: hex });
    // The "+" over it, dark or white, whichever reads on the colour.
    use.setCssStyles({ color: contrastMark(hex) });
    hexLabel.setText(hex.slice(1).toUpperCase());
  };
  tap(use, () => onUse(rgbToHex(hsvToRgb(hsv))));
  sync();
}

/**
 * Report where on `area` the pointer is, as fractions (0–1) across and
 * down, from press to release. The press cancels its default, so nothing
 * takes focus.
 */
function drag(area: HTMLElement, onValue: (x: number, y: number) => void): void {
  let active: number | null = null;
  const report = (event: PointerEvent): void => {
    const box = area.getBoundingClientRect();
    if (box.width <= 0) return;
    const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    const y = box.height > 0 ? Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) : 0;
    onValue(x, y);
  };
  area.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    active = event.pointerId;
    try {
      area.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer cannot be captured; moves still arrive while over the area.
    }
    report(event);
  });
  area.addEventListener("pointermove", (event) => {
    if (event.pointerId === active) report(event);
  });
  const end = (event: PointerEvent): void => {
    if (event.pointerId === active) active = null;
  };
  area.addEventListener("pointerup", end);
  area.addEventListener("pointercancel", end);
}

/** A round swatch; `null` is "none", drawn crossed out. */
function swatch(
  parent: HTMLElement,
  color: string | null,
  active: boolean,
  tap: TapBinder,
  onPick: () => void,
): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "goodobsidian-color-swatch clickable-icon" });
  const disc = button.createSpan({ cls: "goodobsidian-color-disc" });
  // The disc *is* the colour: a value, not chrome.
  if (color) disc.setCssStyles({ background: color });
  if (color) {
    button.setAttribute("aria-label", color);
    button.setAttribute("title", color.toUpperCase());
  }
  button.toggleClass("is-active", active);
  button.setAttribute("aria-pressed", String(active));
  tap(button, onPick);
  return button;
}

/** No press inside the picker may move focus (see the file comment). */
function noFocus(el: HTMLElement): void {
  const keep = (event: Event): void => event.preventDefault();
  el.addEventListener("pointerdown", keep);
  el.addEventListener("mousedown", keep);
}
