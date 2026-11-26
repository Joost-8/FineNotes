/**
 * The edit Neaten makes to a page, worked out before anything changes: the
 * writer's strokes that go, the new strokes and where each stroke ends up
 * after Tidy has been over the selected lines. Tidy runs here, on the page
 * as it will be, so the caller applies one command and one undo step brings
 * everything back. A line `placeLines` has just stood level is not tidied
 * again on plain paper (see `neatenEdit`).
 *
 * PURE: no DOM, no Obsidian.
 */

import { ASKED_LEVEL_SLOPE, type HandProfile, type RuleBlock, tidyInk } from "../../ink/tidy";
import type { PageInk } from "../hwr/lines";
import type { PlacedLine } from "./layout";

/** A stroke Neaten adds: its points (x, y, pressure), and the line it was written for. */
export interface NewStroke {
  pts: number[];
  line: number;
}

export interface NeatenEdit {
  /** The writer's strokes the new ones replace. */
  removed: string[];
  added: NewStroke[];
  /** Strokes that stay but move (kept words along their line, and Tidy on the lines it still tidies): their new points. */
  moved: Map<string, number[]>;
}

/**
 * The page's edit for `placed` lines, Tidy run over every selected line that
 * `placeLines` did not just place (the user asked, so steep lines are levelled
 * too: `ASKED_LEVEL_SLOPE`). `strokes` is every stroke of the page
 * the edit may touch (the caller leaves out mirrors of joined pages); `rules`
 * the page's ruled lines, if any.
 */
export function neatenEdit<S extends PageInk>(
  strokes: readonly S[],
  placed: readonly PlacedLine[],
  profile: HandProfile,
  rules: readonly RuleBlock[] | null,
  selected: ReadonlySet<string> = new Set(),
): NeatenEdit {
  const removed = new Set(placed.flatMap((line) => line.removed));
  const shift = new Map<string, { dx: number; dy: number }>();
  for (const line of placed)
    for (const [id, move] of line.kept) if (move.dx !== 0 || move.dy !== 0) shift.set(id, move);
  const added = placed.flatMap((line, i) => line.added.map((s) => ({ pts: s.pts, line: i })));
  if (added.length === 0) return { removed: [], added: [], moved: new Map() };
  // The page as it will be, with ids for the new strokes no stroke has.
  const tag = (i: number): string => `\u0000neaten${i}`;
  const working: PageInk[] = [
    ...strokes
      .filter((s) => !removed.has(s.id))
      .map((s) => {
        const move = shift.get(s.id);
        if (move === undefined) return s;
        const pts = Array.from(s.pts, (v, i) =>
          i % 3 === 0 ? v + move.dx : i % 3 === 1 ? v + move.dy : v,
        );
        return { id: s.id, tool: s.tool, shape: s.shape, t0: s.t0, pts };
      }),
    ...added.map((s, i) => ({ id: tag(i), tool: "pen", shape: null, t0: null, pts: s.pts })),
  ];
  // Beautify tidies the selected lines it did not rewrite; the page holds still around them.
  // A line `placeLines` has just stood level (its new strokes and its kept words) must not be
  // regrouped with the ink of its neighbours and levelled to that again: on "I'm the captain"
  // Tidy took the kept word 6 px under the new words and moved the I's bars (26 November).
  // On plain paper it is left as placed; on ruled paper Tidy still snaps it to the rules.
  const ruled = !!rules && rules.length > 0;
  const laid = new Set<string>();
  if (!ruled)
    for (const line of placed)
      if (line.added.length > 0) for (const id of line.kept.keys()) laid.add(id);
  const only = new Set<string>();
  for (const line of placed) {
    if (ruled || line.added.length === 0) for (const id of line.kept.keys()) only.add(id);
  }
  if (ruled) added.forEach((_, i) => only.add(tag(i)));
  for (const id of selected) if (!removed.has(id) && !laid.has(id)) only.add(id);
  const tidied = tidyInk(working, { profile, rules, only, maxLevelSlope: ASKED_LEVEL_SLOPE });
  const moved = new Map<string, number[]>();
  for (const s of working) {
    if (s.id.startsWith("\u0000neaten")) continue;
    const pts = tidied.pts.get(s.id) ?? (shift.has(s.id) ? Array.from(s.pts) : null);
    if (pts) moved.set(s.id, pts);
  }
  return {
    removed: [...removed],
    added: added.map((s, i) => ({ pts: tidied.pts.get(tag(i)) ?? s.pts, line: s.line })),
    moved,
  };
}
