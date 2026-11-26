/**
 * The edit Neaten makes to a page, worked out before anything changes: the
 * writer's strokes that go, the new strokes and where each stroke ends up
 * after Tidy has been over the neatened lines. Tidy runs here, on the page
 * as it will be, so the caller applies one command and one undo step brings
 * everything back.
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
  /** Strokes that stay but move (kept words along their line, then Tidy): their new points. */
  moved: Map<string, number[]>;
}

/**
 * The page's edit for `placed` lines, Tidy run over every line of `selected`
 * (the user asked, so steep lines are levelled too: `ASKED_LEVEL_SLOPE`). `strokes` is every stroke of the page
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
  // Tidy only the neatened lines; the rest of the page holds still around them.
  // Every selected line is tidied (Beautify), the rewritten ones and the rest; the page holds still around them.
  // A placed line has just been laid on one level baseline by `placeLines`. On plain paper Tidy
  // leaves it be: it would group it with ink of the next line and level it to that
  // ("I'm the captain" ended 16 px under its new words, a second bar in the I, 26 November).
  // On ruled paper Tidy still snaps it to the rules.
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
