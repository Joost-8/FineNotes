/**
 * Beautify on one held word (design rulings, 2026-11-26): a long press on a
 * word offers "Beautify this word", and only that word is rewritten. The lasso
 * still beautifies whole lines (`layout.ts`).
 *
 * The model writes the word alone (its style comes from the practice sheets,
 * not from the line). The new word takes the old one's place: its left edge
 * where the old one began, its letters standing where the writer's stood, at
 * the writer's x-height. The words after it on the line move along by as much
 * as the word grew or shrank, and nothing else moves: no Tidy runs.
 *
 * PURE: no DOM, no Obsidian.
 */

import { ASKED_LEVEL_SLOPE, lineOfStroke, measureHand } from "../../ink/tidy";
import type { PageInk } from "../hwr/lines";
import type { NeatenEdit } from "./apply";
import { LETTER_REACH, type PlacedLine, bodyOf } from "./layout";
import { median } from "./rows";
import type { WrittenStroke } from "./rows";

/** Which word of which line holds the stroke `id`; null when none does. */
export function heldWordAt(
  lines: readonly { words: readonly (readonly string[])[] }[],
  id: string,
): { line: number; word: number } | null {
  for (const [line, job] of lines.entries()) {
    const word = job.words.findIndex((ids) => ids.includes(id));
    if (word >= 0) return { line, word };
  }
  return null;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function boxOf(pts: ArrayLike<number>): Box | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 3) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return x0 <= x1 ? { x0, x1, y0, y1 } : null;
}

/**
 * The ink of a word written on its own, where no line runs through it: the
 * held stroke and every pen stroke that comes within `reach` of it along the
 * line and shares its height, and so on from those.
 */
export function wordAround<S extends PageInk>(
  strokes: readonly S[],
  heldId: string,
  reach: number,
): S[] {
  const pen = strokes
    .filter((s) => s.tool === "pen" && !s.shape)
    .flatMap((s) => {
      const box = boxOf(s.pts);
      return box ? [{ s, box }] : [];
    });
  const held = pen.find((p) => p.s.id === heldId);
  if (!held) return [];
  const taken = new Set([held.s.id]);
  const all = { ...held.box };
  for (let grew = true; grew;) {
    grew = false;
    for (const { s, box } of pen) {
      if (taken.has(s.id)) continue;
      const along = Math.max(box.x0 - all.x1, all.x0 - box.x1);
      const across = Math.min(box.y1, all.y1) - Math.max(box.y0, all.y0);
      if (along > reach || across <= 0) continue;
      taken.add(s.id);
      all.x0 = Math.min(all.x0, box.x0);
      all.x1 = Math.max(all.x1, box.x1);
      all.y0 = Math.min(all.y0, box.y0);
      all.y1 = Math.max(all.y1, box.y1);
      grew = true;
    }
  }
  return strokes.filter((s) => taken.has(s.id));
}

/**
 * The ink read for a held word: the line of running text it is on
 * (`lineOfStroke`), or, on no such line, the word's own ink (`wordAround`,
 * reaching a letter gap of the page's x-height, else the held stroke's height).
 */
export function inkToBeautify<S extends PageInk>(strokes: readonly S[], heldId: string): S[] {
  const ids = lineOfStroke(strokes, heldId, ASKED_LEVEL_SLOPE);
  if (ids) return strokes.filter((s) => ids.includes(s.id));
  const held = strokes.find((s) => s.id === heldId);
  const box = held && boxOf(held.pts);
  const xHeight =
    measureHand(strokes.filter((s) => s.tool === "pen" && !s.shape))?.xHeight ??
    (box ? box.y1 - box.y0 : 0);
  return wordAround(strokes, heldId, LETTER_REACH * xHeight);
}

/** One held word to put back. */
export interface WordToPlace<S extends PageInk> {
  /** The strokes of the line the word is on (the word's own when it stands alone), page px. */
  line: readonly S[];
  /** The held word's strokes (ids), as read: pieces from elsewhere on the line are left out. */
  word: readonly string[];
  /** The stroke that was held: the word is the run of ink that holds it. */
  held?: string;
  /** How the line climbs (page px down per px along): the words after it move along it. */
  slope?: number;
  /** The word as the model wrote it, model units (x right, y up). */
  written: readonly WrittenStroke[];
  /** The writer's x-height on the line (page px), the written word's (model units), the least to write at (page px). */
  xHeight: { ink: number | null; written: number | null; least: number };
  /** Where the letters stand: the writer's (page px, y down) and the written word's (model units, y up). */
  foot: { ink: number | null; written: number | null };
  /** The page's width (page px): a word that would push ink past it is not placed. */
  pageWidth?: number;
}

/**
 * Where the written word goes, as a placed line of one word. Null when it
 * cannot be placed: nothing written, or the words after it would be pushed
 * past the page's edge.
 */
export function placeWord<S extends PageInk>(w: WordToPlace<S>): PlacedLine | null {
  // The word's own run of ink, as for lines (`bodyOf`): a comma the reading gave it stays.
  const byId = new Map(w.line.map((s) => [s.id, s] as const));
  const held = w.held !== undefined ? byId.get(w.held) : undefined;
  const reach = LETTER_REACH * (w.xHeight.ink ?? (held ? heightOf(held.pts) : 0));
  const body = reach > 0 ? bodyOf(w.word, byId, reach) : [...w.word];
  if (w.held !== undefined && w.word.includes(w.held) && !body.includes(w.held)) return null;
  const ids = new Set(body);
  const own = w.line.filter((s) => ids.has(s.id));
  const old = own.map((s) => boxOf(s.pts)).filter((b): b is Box => b !== null);
  const made = w.written.flatMap((s) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i + 1 < s.pts.length; i += 2) {
      xs.push(s.pts[i]);
      ys.push(s.pts[i + 1]);
    }
    return xs.length ? [{ xs, ys }] : [];
  });
  if (old.length === 0 || made.length === 0) return null;
  const ox0 = Math.min(...old.map((b) => b.x0));
  const ox1 = Math.max(...old.map((b) => b.x1));
  const oy1 = Math.max(...old.map((b) => b.y1));
  const mx0 = Math.min(...made.flatMap((m) => m.xs));
  const mx1 = Math.max(...made.flatMap((m) => m.xs));
  const my0 = Math.min(...made.flatMap((m) => m.ys));
  // Model units to page px: at the writer's x-height (never under the least the model
  // writes legibly at), else as wide as the writer's word was.
  const { ink, written, least } = w.xHeight;
  const size =
    ink !== null && written !== null && written > 0
      ? Math.max(ink, least) / written
      : mx1 > mx0
        ? (ox1 - ox0) / (mx1 - mx0)
        : 0;
  if (!(size > 0) || !Number.isFinite(size)) return null;
  // The letters stand where the writer's stood; without both feet, the words' bottoms meet.
  const both = w.foot.ink !== null && w.foot.written !== null;
  const baseY = both ? (w.foot.ink as number) : oy1;
  const baseM = both ? (w.foot.written as number) : my0;
  const pressure = median(own.flatMap((s) => every(s.pts, 2)));
  const added = made.map((m) => {
    const pts: number[] = [];
    m.xs.forEach((x, i) =>
      pts.push(ox0 + (x - mx0) * size, baseY - (m.ys[i] - baseM) * size, pressure),
    );
    return { pts, word: 0 };
  });
  // The words after it move along the line by as much as the word grew or shrank.
  const dx = ox0 + (mx1 - mx0) * size - ox1;
  const dy = w.slope ? w.slope * dx : 0;
  const oldMid = 0.5 * (ox0 + ox1);
  const kept = new Map<string, { dx: number; dy: number }>();
  let right = -Infinity;
  let rightBefore = -Infinity;
  for (const s of w.line) {
    if (ids.has(s.id)) continue;
    const box = boxOf(s.pts);
    if (!box) continue;
    const after = 0.5 * (box.x0 + box.x1) > oldMid;
    kept.set(s.id, after ? { dx, dy } : { dx: 0, dy: 0 });
    right = Math.max(right, box.x1 + (after ? dx : 0));
    rightBefore = Math.max(rightBefore, box.x1);
  }
  right = Math.max(right, ...added.flatMap((s) => every(s.pts, 0)));
  rightBefore = Math.max(rightBefore, ox1);
  if (w.pageWidth !== undefined && right > Math.max(w.pageWidth, rightBefore)) return null;
  return { added, kept, removed: body };
}

function heightOf(pts: ArrayLike<number>): number {
  const box = boxOf(pts);
  return box ? box.y1 - box.y0 : 0;
}

/** The page's edit for one placed word: nothing is tidied, only what moved moves. */
export function wordEdit<S extends PageInk>(strokes: readonly S[], placed: PlacedLine): NeatenEdit {
  const moved = new Map<string, number[]>();
  for (const s of strokes) {
    const move = placed.kept.get(s.id);
    if (!move || (move.dx === 0 && move.dy === 0)) continue;
    moved.set(
      s.id,
      Array.from(s.pts, (v, i) => (i % 3 === 0 ? v + move.dx : i % 3 === 1 ? v + move.dy : v)),
    );
  }
  return {
    removed: [...placed.removed],
    added: placed.added.map((s) => ({ pts: s.pts, line: 0 })),
    moved,
  };
}

function every(pts: ArrayLike<number>, at: number): number[] {
  const out: number[] = [];
  for (let i = at; i < pts.length; i += 3) out.push(pts[i]);
  return out;
}
