/**
 * What a finger tap, or a mouse right-click, on the paper hits among a
 * page's marked ink: a link, a suggested link, or a word the handwriting
 * check underlined. Links win over suggestions, and suggestions over
 * flagged words, as each is drawn above the next. PURE.
 */

import type { Bounds } from "../model/document";

export type InkTargetKind = "link" | "suggestion" | "flag";

/** The hit: which list, and the index of the entry in it. */
export interface InkTarget {
  kind: InkTargetKind;
  index: number;
}

/** A page's marked ink, each entry its stroke ids. Leave a list empty to skip it. */
export interface InkTargets {
  links: ReadonlyArray<readonly string[]>;
  suggestions: ReadonlyArray<readonly string[]>;
  flags: ReadonlyArray<readonly string[]>;
}

/** How far round the ink a point still hits it, page px; `below` reaches down to its underline. */
export interface InkReach {
  tolerance: number;
  below: number;
}

/** True when `p` is on ink with bounds `b`, or within reach of it. */
export function hitsInk(b: Bounds, p: { x: number; y: number }, reach: InkReach): boolean {
  if (p.x < b.minX - reach.tolerance || p.x > b.maxX + reach.tolerance) return false;
  return p.y >= b.minY - reach.tolerance && p.y <= b.maxY + reach.below + reach.tolerance;
}

/**
 * The first entry whose ink is at page point `p`, or null. `boundsOf` gives
 * an entry's bounds from its stroke ids, null when none of its ink is left;
 * it is asked lazily, in order, until one hits.
 */
export function inkTargetAt(
  targets: InkTargets,
  boundsOf: (strokes: readonly string[]) => Bounds | null,
  p: { x: number; y: number },
  reach: InkReach,
): InkTarget | null {
  const kinds: InkTargetKind[] = ["link", "suggestion", "flag"];
  const lists = { link: targets.links, suggestion: targets.suggestions, flag: targets.flags };
  for (const kind of kinds) {
    const list = lists[kind];
    for (let index = 0; index < list.length; index++) {
      const b = boundsOf(list[index]);
      if (b && hitsInk(b, p, reach)) return { kind, index };
    }
  }
  return null;
}
