/**
 * Text box commands added by the 0.5 text tool. New commands live in new
 * files (contracts/api.md §6), so this sits beside `page-commands.ts`, which
 * keeps adding, removing, moving and resizing a box.
 *
 * Every change a text-pill control makes to the box being edited is one
 * {@link SetTextBoxStyle}, so each is one step of undo.
 *
 * ## Extending to per-word formatting
 *
 * Styles are whole-box in this wave. Per-word formatting would keep the box's
 * style as its base and add `runs: { start, end, patch }[]` over the text;
 * this command would then take an optional character range and split or merge
 * runs, with the same snapshot-and-restore inverse. The pure line layout in
 * `src/canvas/text-layout.ts` already measures through an injected function,
 * so it would measure run by run instead of line by line.
 *
 * Nothing here touches the DOM or Obsidian.
 */

import type { Command } from "./commands";
import { type InkDocument, type TextBoxElement, pageById } from "./document";
import { type TextStylePatch, applyTextStyle } from "./text-style";

/** Every key a style change can touch; the inverse restores all of them. */
const STYLE_KEYS = [
  "color",
  "fontSize",
  "font",
  "bold",
  "italic",
  "underline",
  "strike",
  "align",
  "lineHeight",
  "fill",
] as const;

/** A box's style keys before a change. A key absent here was absent on the box. */
type StyleSnapshot = Map<(typeof STYLE_KEYS)[number], unknown>;

/** Change the style of one text box on one page. */
export class SetTextBoxStyle implements Command {
  readonly label = "Text style";
  private previous: StyleSnapshot | null = null;
  /** The box's key order before the change, so undo is `JSON.stringify`-identical. */
  private order: string[] = [];
  /** The box acted on, so undo restores exactly that object (ids can repeat). */
  private target: TextBoxElement | null = null;

  constructor(
    readonly pageId: string,
    private readonly textBoxId: string,
    private readonly patch: TextStylePatch,
  ) {}

  apply(doc: InkDocument): void {
    const box = this.target ?? this.find(doc);
    if (!box) return;
    this.target = box;
    this.previous = snapshot(box);
    this.order = Object.keys(box);
    applyTextStyle(box, this.patch);
  }

  /**
   * Put back exactly what was there: a key that was absent is deleted, never
   * set to `false`, and keys return to their old order. Only style keys are
   * restored — the text is typed straight into the box, not through commands,
   * so it keeps whatever was typed since.
   */
  invert(doc: InkDocument): void {
    const box = this.target ?? this.find(doc);
    const previous = this.previous;
    if (!box || !previous) return;
    const record = box as unknown as Record<string, unknown>;
    const current = new Map(Object.entries(record));
    for (const key of current.keys()) delete record[key];
    for (const key of this.order) {
      if (isStyleKey(key)) {
        if (previous.has(key)) record[key] = previous.get(key);
      } else if (current.has(key)) {
        record[key] = current.get(key);
      }
    }
    // Anything another command added since (a fixed height, say) stays.
    for (const [key, value] of current) {
      if (!isStyleKey(key) && !(key in record)) record[key] = value;
    }
  }

  private find(doc: InkDocument): TextBoxElement | null {
    return pageById(doc, this.pageId)?.textBoxes.find((t) => t.id === this.textBoxId) ?? null;
  }
}

function isStyleKey(key: string): key is (typeof STYLE_KEYS)[number] {
  return (STYLE_KEYS as readonly string[]).includes(key);
}

function snapshot(box: TextBoxElement): StyleSnapshot {
  const record = box as unknown as Record<string, unknown>;
  const snap: StyleSnapshot = new Map();
  for (const key of STYLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) snap.set(key, record[key]);
  }
  return snap;
}
