/**
 * The partial eraser's command: replace strokes on one page with the pieces
 * that survived an erase gesture, as one undoable step.
 *
 * Kept in its own file rather than in `page-commands.ts` so the eraser and the
 * text-box work can change independently. Pure, like the rest of `src/model/`.
 */

import type { Command } from "./commands";
import { type InkDocument, type Stroke, pageById } from "./document";

/** One erased stroke and what is left of it (possibly nothing). */
export interface StrokeReplacement {
  original: Stroke;
  pieces: readonly Stroke[];
}

/**
 * Swap each `original` for its `pieces`, in place, so the pieces keep the
 * original's z-order. Undo puts every original back at the index it came from.
 */
export class ReplaceStrokesOnPage implements Command {
  readonly label = "Erase";
  /** Where each replacement landed on the last apply, for an exact undo. */
  private applied: Array<{ replacement: StrokeReplacement; index: number }> = [];

  constructor(
    readonly pageId: string,
    private readonly replacements: readonly StrokeReplacement[],
  ) {}

  apply(doc: InkDocument): void {
    this.applied = [];
    const page = pageById(doc, this.pageId);
    if (!page) return;
    for (const replacement of this.replacements) {
      // By identity first: stroke ids are only unique per file, and a clash
      // would otherwise splice out the wrong stroke (CLAUDE.md, "Resolve an
      // inverse by identity").
      let index = page.strokes.indexOf(replacement.original);
      if (index < 0) index = page.strokes.findIndex((s) => s.id === replacement.original.id);
      if (index < 0) continue;
      page.strokes.splice(index, 1, ...replacement.pieces);
      this.applied.push({ replacement, index });
    }
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    // Reverse order, so each recorded index is valid again when it is used.
    for (let i = this.applied.length - 1; i >= 0; i--) {
      const { replacement, index } = this.applied[i];
      const { pieces, original } = replacement;
      const at = pieces.length > 0 ? page.strokes.indexOf(pieces[0]) : -1;
      if (at >= 0) page.strokes.splice(at, pieces.length, original);
      else page.strokes.splice(Math.min(index, page.strokes.length), 0, original);
    }
    this.applied = [];
  }
}
