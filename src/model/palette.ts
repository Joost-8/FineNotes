/**
 * A notebook's palette: a few colours that belong together, chosen for the
 * notebook and offered first in every colour picker. Choosing another
 * palette recolours the notebook — every stroke, shape fill, text and text
 * box in an old palette colour takes the new palette's colour in the same
 * place — so one template comes in any colour scheme, where a PDF planner
 * ships twelve copies (research/reports/GoodNotes aesthetics and design
 * freedom.md, "colour-variant explosion").
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument } from "./document";

export interface NotebookPalette {
  /** A curated palette's id, or "custom". */
  id: string;
  name: string;
  /** `#rrggbb`, ink first: the colour writing and text start in. */
  colors: string[];
}

/** How many colours a palette holds. */
export const PALETTE_SIZE = 6;

/**
 * The curated palettes. "Classic" is the pen row's own colours, so a
 * notebook written before it had a palette recolours from it.
 */
export const PALETTES: readonly NotebookPalette[] = [
  {
    id: "classic",
    name: "Classic",
    colors: ["#1a1a1a", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5"],
  },
  {
    id: "ocean",
    name: "Ocean",
    colors: ["#0b3954", "#087e8b", "#3fa7d6", "#59cd90", "#ee6c4d", "#5e60ce"],
  },
  {
    id: "sunset",
    name: "Sunset",
    colors: ["#3d2c2e", "#d1495b", "#00798c", "#30638e", "#edae49", "#f08a4b"],
  },
  {
    id: "forest",
    name: "Forest",
    colors: ["#283618", "#bc4b51", "#2a6f97", "#606c38", "#dda15e", "#7f5539"],
  },
  {
    id: "berry",
    name: "Berry",
    colors: ["#2b2d42", "#c9184a", "#4361ee", "#2d6a4f", "#f77f00", "#7209b7"],
  },
  {
    id: "pastel",
    name: "Pastel",
    colors: ["#4a4e69", "#e5989b", "#7aa5d2", "#84a98c", "#e9c46a", "#b392ac"],
  },
  {
    id: "mono",
    name: "Mono",
    colors: ["#111111", "#c92a2a", "#495057", "#868e96", "#adb5bd", "#343a40"],
  },
];

/** The palette a notebook without one is written in. */
export const DEFAULT_PALETTE = PALETTES[0];

const HEX6 = /^#[0-9a-f]{6}$/i;

/** A stored palette, or `undefined` when it is not one: exactly six `#rrggbb` colours. */
export function readPalette(raw: unknown): NotebookPalette | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.colors) || r.colors.length !== PALETTE_SIZE) return undefined;
  if (!r.colors.every((c) => typeof c === "string" && HEX6.test(c))) return undefined;
  return {
    id: typeof r.id === "string" && r.id ? r.id : "custom",
    name: typeof r.name === "string" && r.name ? r.name : "Custom",
    colors: (r.colors as string[]).map((c) => c.toLowerCase()),
  };
}

/** The palette a notebook is in: its own, or {@link DEFAULT_PALETTE}. */
export function paletteOf(doc: Pick<InkDocument, "palette">): NotebookPalette {
  return readPalette(doc.palette) ?? DEFAULT_PALETTE;
}

/**
 * The colour `color` becomes going from palette `from` to `to`: the `to`
 * colour in the same place when its `#rrggbb` part is a `from` colour, its
 * alpha kept (a soft fill stays soft); otherwise unchanged.
 */
export function swapColor(color: string, from: readonly string[], to: readonly string[]): string {
  if (typeof color !== "string" || color.length < 7) return color;
  const rgb = color.slice(0, 7).toLowerCase();
  const i = from.findIndex((c) => c.toLowerCase() === rgb);
  if (i < 0 || !to[i]) return color;
  return `${to[i].toLowerCase()}${color.slice(7)}`;
}

/** One colour field of one object, before and after. */
interface Change {
  target: Record<string, unknown>;
  key: string;
  before: unknown;
}

/**
 * Give the notebook `palette`, recolouring what is in its old palette's
 * colours: strokes (and shape fills), text and its box (fill, border).
 * Pictures and paper keep theirs. Undo restores every field it changed and
 * the palette that was.
 */
export class SetNotebookPalette implements Command {
  readonly label = "Change notebook colours";
  private changes: Change[] = [];
  private previous: NotebookPalette | undefined;
  private hadKey = false;

  constructor(
    private readonly palette: NotebookPalette,
    /** Recolour what is in the old palette's colours, or only set the palette. */
    private readonly recolor = true,
  ) {}

  apply(doc: InkDocument): void {
    this.changes = [];
    this.hadKey = "palette" in doc;
    this.previous = doc.palette ? { ...doc.palette, colors: [...doc.palette.colors] } : undefined;
    const from = paletteOf(doc).colors;
    const to = this.palette.colors;
    if (this.recolor) {
      const swap = (target: object, key: string): void => {
        const record = target as Record<string, unknown>;
        const value = record[key];
        if (typeof value !== "string") return;
        const next = swapColor(value, from, to);
        if (next === value) return;
        this.changes.push({ target: record, key, before: value });
        record[key] = next;
      };
      for (const page of doc.pages) {
        for (const stroke of page.strokes) {
          swap(stroke, "color");
          swap(stroke, "fill");
        }
        for (const box of page.textBoxes) {
          swap(box, "color");
          swap(box, "fill");
          if (box.border) {
            // A new border object: an undo snapshot elsewhere may hold the old one.
            const before = box.border;
            const color = swapColor(before.color, from, to);
            if (color !== before.color) {
              this.changes.push({
                target: box as unknown as Record<string, unknown>,
                key: "border",
                before,
              });
              box.border = { ...before, color };
            }
          }
        }
      }
    }
    doc.palette = { ...this.palette, colors: [...this.palette.colors] };
  }

  /** How many colour fields the change recoloured. */
  get recolored(): number {
    return this.changes.length;
  }

  invert(doc: InkDocument): void {
    for (let i = this.changes.length - 1; i >= 0; i--) {
      const { target, key, before } = this.changes[i];
      target[key] = before;
    }
    this.changes = [];
    if (this.previous) doc.palette = this.previous;
    else delete doc.palette;
    if (!this.hadKey) delete doc.palette;
  }
}
