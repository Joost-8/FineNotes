/**
 * The command behind Tidy handwriting: give strokes new points, as one
 * undoable step. The strokes stay the same objects (a selection that holds
 * them still does), each with a fresh points array, so a cached outline of the
 * old points is never drawn for the new ones.
 *
 * PURE, like the rest of `src/model/`.
 */

import type { Command } from "./commands";
import { type InkDocument, type Stroke, pageById } from "./document";
import { t } from "../i18n/translate";

/** One stroke and the points it gets (same length as it has). */
export interface StrokePoints {
  stroke: Stroke;
  pts: readonly number[];
}

export class SetStrokePoints implements Command {
  readonly label = t("surface.command.tidy");
  /** What each stroke held before the last apply, for an exact undo. */
  private before: { stroke: Stroke; pts: number[] }[] = [];

  constructor(
    readonly pageId: string,
    private readonly changes: readonly StrokePoints[],
  ) {}

  apply(doc: InkDocument): void {
    this.before = [];
    const page = pageById(doc, this.pageId);
    if (!page) return;
    for (const change of this.changes) {
      // By identity first: stroke ids are only unique per file.
      const stroke = page.strokes.includes(change.stroke)
        ? change.stroke
        : page.strokes.find((s) => s.id === change.stroke.id);
      if (!stroke || stroke.pts.length !== change.pts.length) continue;
      this.before.push({ stroke, pts: stroke.pts });
      stroke.pts = [...change.pts];
    }
  }

  invert(): void {
    for (const { stroke, pts } of this.before) stroke.pts = pts;
    this.before = [];
  }
}
