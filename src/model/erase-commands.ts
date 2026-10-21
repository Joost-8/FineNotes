/**
 * The partial eraser's command: replace strokes on one page with the pieces
 * that survived an erase gesture, as one undoable step.
 *
 * Kept in its own file rather than in `page-commands.ts` so the eraser and the
 * text-box work can change independently. Pure, like the rest of `src/model/`.
 */

import type { Command } from "./commands";
import { type InkDocument, type InkLink, type InkTask, type Stroke, pageById } from "./document";

/** One erased stroke and what is left of it (possibly nothing). */
export interface StrokeReplacement {
  original: Stroke;
  pieces: readonly Stroke[];
}

/**
 * Swap each `original` for its `pieces`, in place, so the pieces keep the
 * original's z-order. A link the original was in holds its pieces instead,
 * and goes when nothing of it is left. Undo puts every original back at the
 * index it came from, and the page's links as they were.
 */
export class ReplaceStrokesOnPage implements Command {
  readonly label = "Erase";
  /** Where each replacement landed on the last apply, for an exact undo. */
  private applied: Array<{ replacement: StrokeReplacement; index: number }> = [];
  /** The page's links and tasks before the last apply; `null` until it has run. */
  private links: { before: InkLink[] | undefined } | null = null;
  private tasks: { before: InkTask[] | undefined } | null = null;

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
    this.links = { before: page.links };
    if (page.links) {
      const pieces = new Map(
        this.applied.map(({ replacement }) => [
          replacement.original.id,
          replacement.pieces.map((p) => p.id),
        ]),
      );
      const links = page.links
        .map((link) => ({ ...link, strokes: link.strokes.flatMap((id) => pieces.get(id) ?? [id]) }))
        .filter((link) => link.strokes.length > 0);
      if (links.length > 0) page.links = links;
      else delete page.links;
    }
    this.tasks = { before: page.tasks };
    if (page.tasks) {
      // A task's ink, cut in pieces, stays one task.
      const pieces = new Map(
        this.applied.map(({ replacement }) => [
          replacement.original.id,
          replacement.pieces.map((p) => p.id),
        ]),
      );
      const tasks = page.tasks
        .map((task) => ({ ...task, strokes: task.strokes.flatMap((id) => pieces.get(id) ?? [id]) }))
        .filter((task) => task.strokes.length > 0);
      if (tasks.length > 0) page.tasks = tasks;
      else delete page.tasks;
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
    if (this.links) {
      const { before } = this.links;
      if (before === undefined) delete page.links;
      else page.links = before;
      this.links = null;
    }
    if (this.tasks) {
      const { before } = this.tasks;
      if (before === undefined) delete page.tasks;
      else page.tasks = before;
      this.tasks = null;
    }
  }
}
