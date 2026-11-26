/**
 * The command behind Neaten: the writer's strokes for the rewritten words
 * go, the written ones come, and the strokes that stay take their new
 * points, as one undo step.
 *
 * PURE, like the rest of `src/model/`.
 */

import type { Command } from "./commands";
import type { Stroke } from "./document";
import { AddStrokeToPage, CompositeCommand, RemoveStrokesFromPage } from "./page-commands";
import { SetStrokePoints, type StrokePoints } from "./tidy-commands";
import { t } from "../i18n/translate";

/** What Neaten worked out for a page (`recognition/writer/apply.ts`). */
export interface NeatenChanges {
  removed: readonly string[];
  /** New strokes' points, and the line each was written for. */
  added: readonly { pts: number[]; line: number }[];
  moved: ReadonlyMap<string, number[]>;
}

export function neatenCommand(
  pageId: string,
  removed: ReadonlySet<string>,
  added: readonly Stroke[],
  moved: readonly StrokePoints[],
  label = t("surface.command.beautify"),
): Command {
  return new CompositeCommand(label, [
    new RemoveStrokesFromPage(pageId, removed, label),
    ...added.map((stroke) => new AddStrokeToPage(pageId, stroke)),
    new SetStrokePoints(pageId, moved),
  ]);
}

/**
 * The command for `changes` on a page whose strokes are `strokes` now.
 * `style[line]` is the stroke whose pen a line's new strokes take; `nextId`
 * mints stroke ids. Null when the page changed under the work (a stroke to
 * replace is gone) or there is nothing to add.
 */
export function neatenCommandFor(
  pageId: string,
  strokes: readonly Stroke[],
  changes: NeatenChanges,
  style: readonly Stroke[],
  nextId: () => string,
  /** The undo step's name; Beautify's by default. */
  label?: string,
): Command | null {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  if (changes.added.length === 0 || changes.removed.some((id) => !byId.has(id))) return null;
  const added = changes.added.flatMap((s, i): Stroke[] => {
    const pen = style[s.line];
    if (!pen) return [];
    // Every field of the pen (nib, tip, the sticky note it is on, fields added
    // later), but what belongs to that one stroke's points and identity.
    const {
      id: _id,
      pts: _pts,
      t0,
      samples: _samples,
      tilt: _tilt,
      join: _join,
      shape: _shape,
      ...kind
    } = pen;
    const stroke: Stroke = { ...kind, id: nextId(), pts: [...s.pts] };
    // Written where the line was written, in order.
    if (t0 !== undefined) stroke.t0 = t0 + i;
    return [stroke];
  });
  const moved = [...changes.moved].flatMap(([id, pts]): StrokePoints[] => {
    const stroke = byId.get(id);
    return stroke && stroke.pts.length === pts.length ? [{ stroke, pts }] : [];
  });
  return neatenCommand(pageId, new Set(changes.removed), added, moved, label);
}
