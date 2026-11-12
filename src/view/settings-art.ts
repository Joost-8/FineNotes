/**
 * The drawings on the settings rows: one small SVG per setting whose effect
 * can be seen, 72 x 48, with no words in it (the tab is in 42 languages).
 *
 * Each drawing is data, so it is the same in every language and costs nothing
 * until its row is drawn. A part of a drawing may say `when` it applies
 * ("undo=on", "tool=pen|highlighter"): {@link paintArt} puts `is-on` on it
 * while that is true, and `styles.css` turns the class into a CSS transition,
 * so changing a setting moves its drawing from the old state to the new. The
 * colours are the user's: Obsidian's accent and theme variables, FineNotes'
 * Look tokens, and the chosen page appearance for anything on paper
 * (`--art-*`, from {@link artStateOf}).
 */

import { SIZES } from "../constants";
import { DARK_PAPER, LIGHT_PAPER } from "../canvas/backdrop";
import { nightColor, nightRule } from "../canvas/night";
import { DEFAULT_SETTINGS, type GoodObsidianSettings } from "../settings-data";
import { lookPaletteOf, lookStyleOf } from "../model/look";

const SVG_NS = "http://www.w3.org/2000/svg";

/** One shape of a drawing: an SVG tag, its class, its attributes, when it applies, its children. */
export interface ArtShape {
  tag: "path" | "rect" | "circle" | "ellipse" | "g";
  cls?: string;
  attrs?: Record<string, string | number>;
  when?: string;
  kids?: ArtShape[];
}

function path(cls: string, d: string, when?: string): ArtShape {
  return { tag: "path", cls, attrs: { d }, when };
}

function rect(
  cls: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rx = 0,
  when?: string,
): ArtShape {
  return { tag: "rect", cls, attrs: { x, y, width, height, rx }, when };
}

function dot(cls: string, cx: number, cy: number, r: number, when?: string): ArtShape {
  return { tag: "circle", cls, attrs: { cx, cy, r }, when };
}

function group(cls: string, kids: ArtShape[], when?: string): ArtShape {
  return { tag: "g", cls, kids, when };
}

/** The sheet most drawings happen on, in the chosen page appearance. */
const PAPER = rect("ga-paper", 1, 1, 70, 46, 7);
const RULES = path("ga-rule", "M8 17h56M8 32h56");

/** A pen held slanted, its nib at (0,0), for a `g` to place. */
const STYLUS: ArtShape[] = [
  path("ga-body", "M0 0l3-8 20-14 5 7-20 14z"),
  path("ga-accent-line", "M0 0l3-8 5 7z"),
];

/** The Colours drawing's group, which wears the chosen palette's preview class. */
const PALETTE_PREVIEW = "ga-palette goodobsidian-look-preview";

/** The class that gives `palette`'s colours to an element and what is inside it. */
export function paletteClass(palette: string): string {
  return `is-palette-${palette}`;
}

/** A line of handwriting, roughly 30 wide, for a `g` to place. */
const WORD = "M0 8c3-9 5-9 7-2s4 6 6-1 5-5 6 0 3 5 5 1 4-5 6-2";

/**
 * The drawings, by setting. Rows that cannot be drawn (a folder, a key) get a
 * Lucide tile instead: `settings.ts` says which.
 */
export const ART = {
  style: [
    rect("ga-surface", 1, 1, 70, 46, 7),
    rect("ga-shadow", 15, 19, 46, 16, 2, "style=brutalist|retro"),
    rect("ga-shadow-soft", 13, 18, 46, 16, 8, "style=material|fluent"),
    group("ga-style-bar", [
      rect("ga-bar", 12, 16, 46, 16, 8, "style=default|material|fluent"),
      rect("ga-bar ga-bar-glass", 12, 16, 46, 16, 8, "style=glass"),
      rect("ga-bar ga-bar-paper", 12, 16, 46, 16, 3, "style=paper"),
      rect("ga-bar", 10, 14, 50, 20, 10, "style=soft"),
      rect("ga-bar", 12, 18.5, 46, 11, 5.5, "style=compact"),
      rect("ga-bar", 12, 16, 46, 16, 1, "style=brutalist|retro"),
      path("ga-glint", "M18 19.5h34", "style=glass"),
      rect("ga-tool-on", 16, 19.5, 12, 9, 4),
      dot("ga-tool", 35, 24, 2.6),
      dot("ga-tool", 45, 24, 2.6),
    ]),
  ],
  /* Settings is Obsidian's window, which a palette does not reach (it is worn
     by FineNotes' own surfaces only), so the drawing wears the palette itself:
     `paintArt` gives this group the Looks section's preview class. */
  palette: [
    group(PALETTE_PREVIEW, [
      rect("ga-surface", 1, 1, 70, 46, 7),
      rect("ga-card", 9, 9, 54, 30, 6),
      dot("ga-fill", 21, 24, 6.5),
      dot("ga-fill-normal", 36, 24, 6.5),
      dot("ga-fill-muted", 51, 24, 6.5),
    ]),
  ],
  simpleLook: [
    rect("ga-surface", 1, 1, 70, 46, 7),
    rect("ga-card", 3, 9, 66, 36, 3, "simple=on"),
    group(
      "ga-chrome",
      [
        rect("ga-chrome-part", 3, 3, 66, 5, 2),
        rect("ga-chrome-part", 3, 40, 66, 5, 2),
        rect("ga-chrome-part", 3, 10, 6, 28, 2),
        rect("ga-chrome-part", 11, 10, 14, 28, 2),
      ],
      "simple=off",
    ),
    rect("ga-card", 27, 10, 42, 28, 3, "simple=off"),
    path("ga-accent-line", "M34 18h18M34 25h24M34 32h12", "simple=off"),
    path("ga-accent-line", "M13 18h34M13 26h46M13 34h24", "simple=on"),
  ],
  updates: [
    rect("ga-surface", 1, 1, 70, 46, 7),
    group("ga-gear", [
      dot("ga-line", 22, 24, 7),
      path(
        "ga-line",
        "M22 12v4M22 32v4M10 24h4M30 24h4M13.5 15.5l2.8 2.8M27.7 29.7l2.8 2.8M13.5 32.5l2.8-2.8M27.7 18.3l2.8-2.8",
      ),
    ]),
    dot("ga-fill", 31, 14, 4.5, "updates=remind|dot"),
    group(
      "ga-pop",
      [rect("ga-card", 38, 18, 28, 18, 4), path("ga-line", "M43 24h18M43 30h11")],
      "updates=remind",
    ),
  ],
  startWith: [
    PAPER,
    RULES,
    path("ga-start", "M11 31c5-15 9-15 13-2s8 11 12-2 8-11 12-1 6 7 13 1", "tool=pen|highlighter"),
    group(
      "ga-tool-eraser",
      [rect("ga-accent-box", 26, 15, 22, 13, 3), path("ga-accent-line", "M33 15v13")],
      "tool=eraser",
    ),
    {
      tag: "ellipse",
      cls: "ga-dash",
      attrs: { cx: 36, cy: 24, rx: 24, ry: 14 },
      when: "tool=select",
    },
  ],
  undo: [
    PAPER,
    dot("ga-finger", 22, 28, 6.5, "undo=on"),
    dot("ga-finger", 38, 22, 6.5, "undo=on"),
    dot("ga-finger-off", 22, 28, 6.5, "undo=off"),
    dot("ga-finger-off", 38, 22, 6.5, "undo=off"),
    group(
      "ga-undo-arrow",
      [
        path("ga-accent-line", "M49 16v6h6"),
        path("ga-accent-line", "M64 30a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L49 26"),
      ],
      "undo=on",
    ),
  ],
  lasso: [
    PAPER,
    { tag: "ellipse", cls: "ga-dash", attrs: { cx: 30, cy: 24, rx: 22, ry: 15 } },
    path("ga-accent-line", "M16 25c3-5 6 5 9 0s6 5 9 0"),
    path("ga-accent-line", "M46 27c3-4 6 4 9 0s5 3 9 0", "lasso=on"),
    path("ga-line", "M46 27c3-4 6 4 9 0s5 3 9 0", "lasso=off"),
  ],
  textDrag: [
    PAPER,
    rect("ga-text-box", 10, 14, 22, 20, 2),
    path("ga-text", "M15 21v8M15 21h6M15 21h-3"),
    dot("ga-handle", 32, 34, 3.5, "drag=on"),
  ],
  barrel: [
    PAPER,
    {
      tag: "g",
      attrs: { transform: "translate(11 41) scale(.85)" },
      kids: [...STYLUS, dot("ga-fill", 12, -13, 2.4)],
    },
    group(
      "",
      [rect("ga-accent-box", 44, 12, 18, 12, 3), path("ga-accent-line", "M50 12v12")],
      "barrel=erase",
    ),
    {
      tag: "ellipse",
      cls: "ga-dash",
      attrs: { cx: 53, cy: 20, rx: 13, ry: 9 },
      when: "barrel=lasso",
    },
    path(
      "ga-accent-line",
      "M53 11v18M44 20h18M50 14l3-3 3 3M50 26l3 3 3-3M47 17l-3 3 3 3M59 17l3 3-3 3",
      "barrel=pan",
    ),
    path("ga-line", "M47 14l12 12M59 14L47 26", "barrel=none"),
  ],
  stylusClick: [
    PAPER,
    {
      tag: "g",
      attrs: { transform: "translate(11 39) scale(.85)" },
      kids: [...STYLUS, dot("ga-fill", 12, -13, 2.4)],
    },
    path("ga-line", "M12 42h22"),
    group(
      "",
      [
        rect("ga-card", 42, 10, 24, 24, 4),
        dot("ga-fill", 49, 22, 2.6),
        dot("ga-tool", 55, 22, 2.6),
        dot("ga-tool", 61, 22, 2.6),
      ],
      "click=pen-menu",
    ),
    group(
      "",
      [rect("ga-accent-box", 44, 14, 20, 14, 3), path("ga-accent-line", "M50 14v14")],
      "click=eraser",
    ),
    path("ga-line", "M47 15l12 12M59 15L47 27", "click=none"),
  ],
  pressure: [
    PAPER,
    path("ga-ink-even", "M10 31c10-16 20-16 27-3s16 9 25-8", "pressure=off"),
    path(
      "ga-ink-fill",
      "M10 30c10-17 21-18 28-4s15 10 24-7c-7 21-18 24-27 9S20 15 10 30z",
      "pressure=on",
    ),
  ],
  tilt: [
    PAPER,
    path("ga-ink-thin", "M16 37h46", "tilt=off"),
    path("ga-ink-broad", "M16 37h46", "tilt=on"),
    group("ga-tilt-pen", [
      path("ga-body", "M26 34l4-20 7 1.5-5 19.8z"),
      path("ga-accent-line", "M26 34l1.2-6 5 1z"),
    ]),
  ],
  cursor: [
    PAPER,
    path("ga-ink-even", "M8 30c6-10 12-10 16-3s8 6 12 0"),
    dot("ga-ink-dot", 46, 24, 4, "cursor=ink"),
    path("ga-accent-line", "M46 16v16M38 24h16", "cursor=crosshair"),
    path("ga-arrow", "M42 14l14 12-7 1 4 8-4 2-4-8-5 5z", "cursor=arrow"),
  ],
  customColors: [
    PAPER,
    dot("ga-swatch-1", 14, 24, 6),
    dot("ga-swatch-2", 29, 24, 6),
    dot("ga-swatch-3", 44, 24, 6),
    dot("ga-swatch-4", 59, 24, 6),
  ],
  pageAppearance: [
    rect("ga-paper", 22, 3, 28, 42, 3),
    path("ga-rule", "M27 12h18M27 21h18M27 30h18M27 39h18"),
    path("ga-ink-even", "M28 20c3-5 5 3 8-1s4 2 7-1"),
  ],
  paperWidth: [
    rect("ga-paper ga-paper-width", 21, 3, 30, 34, 3),
    path("ga-accent-thin", "M10 43h52M14 40l-4 3 4 3M58 40l4 3-4 3"),
  ],
  ownFolder: [
    path("ga-folder", "M12 12h16l4 5h28v24H12z", "own=on"),
    path("ga-folder-off", "M12 12h16l4 5h28v24H12z", "own=off"),
    rect("ga-accent-solid", 27, 21, 15, 17, 2),
    rect("ga-card ga-own-left", 15, 25, 9, 13, 1.5, "own=on"),
    rect("ga-card ga-own-right", 46, 25, 10, 13, 1.5, "own=on"),
  ],
  contextMenu: [
    rect("ga-card", 14, 5, 44, 38, 6),
    path("ga-line", "M21 14h22M21 23h28"),
    path("ga-accent-line", "M21 32h8M34 32h16", "menu=on"),
  ],
  libraryButton: [
    rect("ga-surface", 6, 6, 60, 36, 6),
    path("ga-line", "M13 15h3M22 15h3M31 15h3"),
    rect("ga-accent-solid ga-pop-in", 50, 10, 10, 10, 2.5, "library=on"),
    path("ga-line", "M13 27h30M13 35h22"),
  ],
  folderNotebooks: [
    path("ga-folder", "M18 12h14l4 5h18v22H18z", "folders=off"),
    group(
      "ga-pop-in",
      [rect("ga-accent-solid", 24, 7, 26, 34, 3), path("ga-spine", "M29 7v34")],
      "folders=on",
    ),
  ],
  readWith: [
    PAPER,
    rect("ga-marked", 14, 14, 44, 18, 4, "read=grape|mine"),
    { tag: "g", attrs: { transform: "translate(21 19)" }, kids: [path("ga-ink-even", WORD)] },
    path("ga-rule", "M12 38h48"),
    group(
      "ga-pop-in",
      [dot("ga-accent-solid", 60, 12, 6), path("ga-spine-thin", "M57 12l2 2 4-4")],
      "read=mine",
    ),
  ],
  underline: [
    PAPER,
    { tag: "g", attrs: { transform: "translate(21 16)" }, kids: [path("ga-ink-even", WORD)] },
    path("ga-dots", "M16 33h40", "check=on"),
  ],
  calc: [
    PAPER,
    path(
      "ga-ink-even",
      "M8 19l2-2v13M14 20c1-3 6-3 6 1 0 3-6 6-6 9h6M24 23l5 6M29 23l-5 6M37 17l-5 9h8M38 20v10M44 22h5M44 27h5",
    ),
    path(
      "ga-accent-line",
      "M57 17l-4 8h7M58 20v9M63 18.2c2.6 0 3.6 1.5 2.2 3-1.5 1.5-3.2 2.4-3.2 4.3 0 1.6 2.2 2.6 3.8 1.5 1.5-1 1.2-3-.2-4.3-1.4-1.3-3.4-1.5-2.6-4.5z",
      "calc=on",
    ),
  ],
  autoRecognize: [
    rect("ga-paper", 6, 4, 26, 40, 3),
    {
      tag: "g",
      attrs: { transform: "translate(9 12) scale(.66)" },
      kids: [path("ga-ink-even", WORD)],
    },
    {
      tag: "g",
      attrs: { transform: "translate(9 25) scale(.66)" },
      kids: [path("ga-ink-even", WORD)],
    },
    path("ga-accent-line", "M36 24h6M39 21l3 3-3 3", "auto=on"),
    rect("ga-card", 46, 4, 22, 40, 3, "auto=on"),
    path("ga-line", "M51 14h12M51 22h12M51 30h8", "auto=on"),
    rect("ga-card-off", 46, 4, 22, 40, 3, "auto=off"),
  ],
  askPage: [
    rect("ga-surface", 1, 1, 70, 46, 7),
    rect("ga-card", 8, 28, 56, 14, 7),
    path("ga-line", "M16 35h22"),
    group(
      "ga-pop-in",
      [rect("ga-paper", 44, 6, 18, 20, 2), path("ga-rule", "M47 12h12M47 17h12M47 22h7")],
      "ask=on",
    ),
    rect("ga-accent-box ga-attached", 8, 7, 26, 15, 7, "ask=off"),
  ],
  debugHud: [
    PAPER,
    path("ga-rule", "M8 17h56M8 32h56"),
    group(
      "ga-pop-in",
      [
        rect("ga-hud", 8, 8, 42, 32, 3),
        path("ga-accent-line ga-hud-line", "M13 15h26M13 22h32M13 29h20M13 35h28"),
      ],
      "debug=on",
    ),
  ],
} as const satisfies Record<string, readonly ArtShape[]>;

export type ArtId = keyof typeof ART;

/** What a drawing's parts ask about, and the `--art-*` colours and sizes. */
export interface ArtState {
  on: Record<string, string>;
  vars: Record<string, string>;
}

/** Whether a part's `when` holds: "key=a|b" against the state. */
export function artPartOn(when: string, on: Record<string, string>): boolean {
  const at = when.indexOf("=");
  if (at < 0) return false;
  return when
    .slice(at + 1)
    .split("|")
    .includes(on[when.slice(0, at)] ?? "");
}

const YES_NO = (value: unknown): string => (value === true ? "on" : "off");

/** The rule colour of a ruled page by day. */
const RULE_DAY = "#d5dcea";

/** A nib the drawing can show: a size from 0 (thin) to 1 (the widest setting). */
function sizeShare(size: number): number {
  const widest = SIZES[SIZES.length - 1] ?? 12;
  return Math.max(0, Math.min(1, size / widest));
}

/** One stored number or colour list as the drawings show it, for a setting's current value. */
export function artStateOf(
  settings: GoodObsidianSettings,
  extra: { dark: boolean; reader: string; updates: string; autoRecognizing?: boolean },
): ArtState {
  const night =
    settings.pageAppearance === "dark" || (settings.pageAppearance === "system" && extra.dark);
  const inkOf = (color: string): string => (night ? nightColor(color) : color);
  const tool = settings.defaultTool;
  const share = sizeShare(Number(settings.defaultSize) || 3);
  const highlighter = tool === "highlighter";
  const width = String(highlighter ? 7 + share * 8 : 1.4 + share * 3.2);
  const custom = settings.customColors;
  const paperScale = (settings.paperWidth || DEFAULT_SETTINGS.paperWidth) / 1024;
  const vars: Record<string, string> = {
    "--art-paper": (night ? DARK_PAPER : LIGHT_PAPER).paper,
    "--art-rule": night ? nightRule(RULE_DAY) : RULE_DAY,
    "--art-ink": inkOf("#1b2a6b"),
    "--art-start-ink": inkOf(settings.defaultColor),
    "--art-start-width": `${width}px`,
    "--art-start-opacity": highlighter ? "0.45" : "1",
    "--art-paper-scale": String(Math.max(0.55, Math.min(1.35, paperScale))),
  };
  for (let i = 0; i < 4; i++) {
    const color = custom[i];
    vars[`--art-swatch-${i + 1}`] = color ? inkOf(color) : "transparent";
    vars[`--art-swatch-${i + 1}-line`] = color
      ? "transparent"
      : "var(--background-modifier-border)";
  }
  return {
    on: {
      style: lookStyleOf(settings.lookStyle),
      palette: lookPaletteOf(settings.lookPalette),
      simple: YES_NO(settings.simpleLook),
      updates: extra.updates,
      tool,
      undo: YES_NO(settings.fingerTapUndo),
      lasso: YES_NO(settings.lassoTouches),
      drag: YES_NO(settings.textDragSize),
      barrel: settings.barrelButton,
      click: settings.stylusButtonClick,
      pressure: YES_NO(settings.pressureWidth),
      tilt: YES_NO(settings.pencilTilt),
      cursor: settings.penCursor,
      own: YES_NO(settings.notebookOwnFolder),
      menu: YES_NO(settings.showNewNotebookInContextMenu),
      library: YES_NO(settings.showNewNotebookInExplorer),
      folders: YES_NO(settings.folderNotebooks),
      read: extra.reader,
      check: YES_NO(settings.checkHandwrittenWords),
      calc: YES_NO(settings.calcNotes),
      auto: extra.autoRecognizing ? "on" : "off",
      ask: YES_NO(settings.askAttachPage),
      debug: YES_NO(settings.debugHud),
    },
    vars,
  };
}

function build(doc: Document, shape: ArtShape): SVGElement {
  const el = doc.createElementNS(SVG_NS, shape.tag);
  if (shape.cls) el.setAttribute("class", shape.cls);
  for (const [name, value] of Object.entries(shape.attrs ?? {})) {
    el.setAttribute(name, String(value));
  }
  if (shape.when) {
    el.setAttribute("data-when", shape.when);
    el.setAttribute("class", `${shape.cls ?? ""} ga-when`.trim());
  }
  for (const kid of shape.kids ?? []) el.append(build(doc, kid));
  return el;
}

/** The drawing `id` as an SVG, its parts' states left for {@link paintArt}. */
export function drawArt(id: ArtId, doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 72 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "goodobsidian-art-svg");
  for (const shape of ART[id]) svg.append(build(doc, shape));
  return svg;
}

/**
 * Put the state on every drawing under `root`. The colours are variables on
 * `root` itself, so a drawing added later has them at once; `is-on` is set
 * on each part that says when it applies.
 */
export function paintArt(root: HTMLElement, state: ArtState): void {
  root.setCssProps(state.vars);
  for (const el of Array.from(root.querySelectorAll("[data-when]"))) {
    el.toggleClass("is-on", artPartOn(el.getAttribute("data-when") ?? "", state.on));
  }
  const wear = paletteClass(state.on.palette ?? "obsidian");
  for (const el of Array.from(root.querySelectorAll(".ga-palette"))) {
    for (const cls of Array.from(el.classList)) {
      if (cls.startsWith("is-palette-") && cls !== wear) el.classList.remove(cls);
    }
    el.classList.add(wear);
  }
}
