/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The toolbar on its own, floating over a page on the desk, in every tool's
 * state and with every popover behind its chevrons. The toolbar's popovers
 * have no public open method, so the scenes click the buttons, as a user does.
 */
import { Toolbar } from "../../../src/view/toolbar";
import { PALETTE, SIZES } from "../../../src/constants";
import { LIGHT_PAPER, drawSynthetic } from "../../../src/canvas/backdrop";
import type { Scene } from "./types";
import { callbacks, toolState } from "./fixtures";

const SIZE = { width: 1180, height: 560 };

/** A page on the desk under the toolbar, as in the notebook view. */
function desk(host: HTMLElement): void {
  host.setCssStyles({ background: LIGHT_PAPER.desk });
  const w = 720;
  const geometry = { width: 1024, height: 1448 };
  const k = w / geometry.width;
  const canvas = host.createEl("canvas", { cls: "gallery-page" });
  const dpr = 2;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(SIZE.height * dpr);
  canvas.setCssStyles({
    position: "absolute",
    left: `${(SIZE.width - w) / 2}px`,
    top: "84px",
    width: `${w}px`,
    height: `${SIZE.height}px`,
    boxShadow: "0 1px 2px rgba(0,0,0,0.25), 0 6px 20px rgba(0,0,0,0.3)",
  });
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
  drawSynthetic(ctx, { kind: "ruled-narrow" } as never, geometry as never, LIGHT_PAPER, 1);
}

function mount(
  frame: HTMLElement,
  state: Record<string, unknown>,
  target: unknown = null,
): Toolbar {
  const host = frame.createDiv({ cls: "goodobsidian-view" });
  host.setCssStyles({ position: "absolute", inset: "0", overflow: "hidden" });
  desk(host);
  const toolbar = new Toolbar(
    host,
    [...PALETTE],
    [...SIZES],
    toolState(state) as never,
    callbacks({ onTextDelete: () => undefined } as any),
  );
  if (target) toolbar.setTextTarget(target as never);
  toolbar.applyPosition();
  return toolbar;
}

function click(frame: HTMLElement, selector: string): void {
  const el = frame.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`gallery: nothing matches ${selector}`);
  el.click();
}

const byLabel = (label: string): string => `[aria-label^="${label}"]`;

const TEXT_STYLE = { color: "#1a1a1a", fontSize: 24, font: "sans" };

interface ToolbarScene {
  id: string;
  title: string;
  note: string;
  state: Record<string, unknown>;
  target?: unknown;
  open?: string[];
  group?: string;
}

const LIST: ToolbarScene[] = [
  // Tier 2, per tool
  {
    id: "toolbar-pen",
    title: "Toolbar — pen",
    note: "Tier 1 and the pen's options pill: pen type, three widths, three colours, more colours, auto-shape.",
    state: {},
  },
  {
    id: "toolbar-highlighter",
    title: "Toolbar — highlighter",
    note: "The pen's pill with the highlighter chosen as the pen type.",
    state: { tool: "highlighter", penType: "highlighter", color: "#ffd43b", size: 12 },
  },
  {
    id: "toolbar-eraser",
    title: "Toolbar — eraser",
    note: "Eraser mode, three sizes, what it erases, Clear page.",
    state: { tool: "eraser", eraserMode: "standard", eraserSize: 24, eraserFilter: "all" },
  },
  {
    id: "toolbar-shapes",
    title: "Toolbar — shapes",
    note: "Auto, then the shape families, line and arrow, table, and the shape colour.",
    state: { tool: "shape", shapeMode: "auto", shapeColor: "#1971c2" },
  },
  {
    id: "toolbar-text",
    title: "Toolbar — text",
    note: "The text tool's pill before a box is chosen: list and delete are disabled.",
    state: { tool: "text", textStyle: TEXT_STYLE },
  },
  {
    id: "toolbar-text-editing",
    title: "Toolbar — text, editing a box",
    note: "The same pill while a text box is being edited: it shows that box's style.",
    state: { tool: "text", textStyle: TEXT_STYLE },
    target: { ...TEXT_STYLE, bold: true, fontSize: 32 },
  },
  {
    id: "toolbar-lasso",
    title: "Toolbar — lasso",
    note: "The lasso has no pill; tapping the active lasso opens its options.",
    state: { tool: "select" },
    open: [byLabel("Lasso select")],
  },
  // Popovers behind the pen's chevrons
  {
    id: "popover-pen-type",
    title: "Pen — pen type",
    group: "Toolbar popovers",
    note: "Behind the pen swatch: Fountain, Ball, Brush, and the way into pen gestures.",
    state: {},
    open: [".goodobsidian-pentype"],
  },
  {
    id: "popover-pen-gestures",
    title: "Pen — pen gestures",
    group: "Toolbar popovers",
    note: "Page two of the pen popover: scribble to erase, circle to lasso.",
    state: {},
    open: [".goodobsidian-pentype", ".goodobsidian-popover-link"],
  },
  {
    id: "popover-widths",
    title: "Pen — more widths",
    group: "Toolbar popovers",
    note: "The width slider with its readout in mm, and all five widths.",
    state: {},
    open: [byLabel("More widths")],
  },
  {
    id: "popover-color",
    title: "Pen — colours",
    group: "Toolbar popovers",
    note: "The colour picker: palette, recent colours, custom colour.",
    state: {},
    open: [".goodobsidian-color-more"],
  },
  {
    id: "popover-color-custom",
    title: "Pen — custom colour",
    group: "Toolbar popovers",
    note: "The picker with the RGB mixer open.",
    state: {},
    open: [".goodobsidian-color-more", ".goodobsidian-color-custom-toggle"],
  },
  {
    id: "popover-eraser-mode",
    title: "Eraser — mode",
    group: "Toolbar popovers",
    note: "Standard (rub out) or whole stroke.",
    state: { tool: "eraser" },
    open: [byLabel("Eraser mode")],
  },
  {
    id: "popover-eraser-filter",
    title: "Eraser — what it erases",
    group: "Toolbar popovers",
    note: "Switches for highlighter and pen ink.",
    state: { tool: "eraser" },
    open: [byLabel("Eraser erases")],
  },
  {
    id: "popover-table",
    title: "Shapes — table size",
    group: "Toolbar popovers",
    note: "Pick a table size on the 8 × 8 grid, then drag it out on the page.",
    state: { tool: "shape", shapeMode: "table", tableSize: { rows: 3, cols: 4 } },
    open: [".goodobsidian-shape.is-table"],
  },
  {
    id: "popover-shape-color",
    title: "Shapes — colour",
    group: "Toolbar popovers",
    note: "The shape colour picker.",
    state: { tool: "shape" },
    open: [".goodobsidian-shape-color"],
  },
  {
    id: "popover-text-size",
    title: "Text — size",
    group: "Toolbar popovers",
    note: "Font sizes.",
    state: { tool: "text", textStyle: TEXT_STYLE },
    open: [byLabel("Font size")],
  },
  {
    id: "popover-text-font",
    title: "Text — font",
    group: "Toolbar popovers",
    note: "Typefaces, each shown in itself.",
    state: { tool: "text", textStyle: TEXT_STYLE },
    open: [byLabel("Font:")],
  },
  {
    id: "popover-text-format",
    title: "Text — bold, italic…",
    group: "Toolbar popovers",
    note: "Bold, italic, underline, strikethrough.",
    state: { tool: "text", textStyle: TEXT_STYLE },
    open: [byLabel("Bold, italic")],
  },
  {
    id: "popover-text-align",
    title: "Text — alignment",
    group: "Toolbar popovers",
    note: "Left, centre, right, justified.",
    state: { tool: "text", textStyle: TEXT_STYLE },
    open: [byLabel("Alignment")],
  },
  {
    id: "popover-text-spacing",
    title: "Text — line spacing",
    group: "Toolbar popovers",
    note: "Line heights.",
    state: { tool: "text", textStyle: TEXT_STYLE },
    open: [byLabel("Line spacing")],
  },
  {
    id: "popover-text-fill",
    title: "Text — box fill",
    group: "Toolbar popovers",
    note: "The box's background colour, or none.",
    state: { tool: "text", textStyle: TEXT_STYLE },
    open: [byLabel("Box fill")],
  },
  {
    id: "popover-text-list",
    title: "Text — bullets and numbering",
    group: "Toolbar popovers",
    note: "Enabled while a box is being edited.",
    state: { tool: "text", textStyle: TEXT_STYLE },
    target: TEXT_STYLE,
    open: [byLabel("Bullets and numbering")],
  },
];

export const TOOLBAR_SCENES: Scene[] = LIST.map((s) => ({
  id: s.id,
  title: s.title,
  group: s.group ?? "Toolbar",
  note: `${s.note} src/view/toolbar.ts`,
  size: SIZE,
  render: async ({ frame, settle }) => {
    mount(frame, s.state, s.target);
    await settle(80);
    for (const sel of s.open ?? []) {
      click(frame, sel);
      await settle(120);
    }
  },
}));
