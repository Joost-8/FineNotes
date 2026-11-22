/**
 * Merging a text note that changed on disk (a sync from another device)
 * with what this device has, saved or not: the note's version of the
 * notebook's reload merge (FineNotes#273). PURE.
 *
 * A text note stays one Markdown file. Instead of a file per page per
 * device, the merge is three-way and by section: `base` is the text both
 * sides started from (what this view last read or wrote), `mine` what this
 * view has now, `theirs` the file as it is now. A section only one side
 * changed takes that side's version; one both changed keeps both, so
 * nothing is lost; a handwriting section both wrote in is merged stroke by
 * stroke (strokes keep their ids in the file, and each device mints its
 * own), so two people writing in one section both keep their ink.
 */

import { encodeNote } from "./text-note-file";
import type { InkBlock, NoteBlock, TextNote } from "./text-note";

/** What a merge made: the note, and how many sections it kept from both sides. */
export interface NoteMerge {
  note: TextNote;
  /** Sections both sides changed: kept twice, or their ink put together. */
  carried: number;
}

/** A section's content, without its id (ids are per view, not per file). */
export function blockKey(block: NoteBlock): string {
  if (block.type === "ink") {
    // Its strokes are known by their ids: an erase or a new stroke gives new ones.
    return `ink|${block.height}|${block.paper ?? ""}|${block.strokes.map((s) => s.id).join(",")}`;
  }
  return encodeNote({ blocks: [block] });
}

/** Index pairs of a longest common subsequence of `a` and `b`, in order. */
function commonPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // Common ends first: a sync usually changes a little in the middle.
  let head = 0;
  while (head < n && head < m && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < head; i++) pairs.push([i, i]);
  const an = n - head - tail;
  const bm = m - head - tail;
  if (an > 0 && bm > 0) {
    const table: Uint32Array[] = [];
    for (let i = 0; i <= an; i++) table.push(new Uint32Array(bm + 1));
    for (let i = an - 1; i >= 0; i--) {
      for (let j = bm - 1; j >= 0; j--) {
        table[i][j] =
          a[head + i] === b[head + j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < an && j < bm) {
      if (a[head + i] === b[head + j]) {
        pairs.push([head + i, head + j]);
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) i++;
      else j++;
    }
  }
  for (let t = tail; t > 0; t--) pairs.push([n - t, m - t]);
  return pairs;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** Two handwriting sections both changed, put together stroke by stroke over `base`. */
export function mergeInk(base: InkBlock | null, mine: InkBlock, theirs: InkBlock): InkBlock {
  const was = new Set(base?.strokes.map((s) => s.id) ?? []);
  const kept = new Set(mine.strokes.map((s) => s.id));
  const there = new Set(theirs.strokes.map((s) => s.id));
  const strokes = [
    // Theirs, less what this device erased.
    ...theirs.strokes.filter((s) => !(was.has(s.id) && !kept.has(s.id))),
    // And what this device wrote.
    ...mine.strokes.filter((s) => !was.has(s.id) && !there.has(s.id)),
  ];
  const paper = base && mine.paper !== base.paper ? mine.paper : theirs.paper;
  const { reading: _reading, paper: _paper, ...rest } = mine;
  return {
    ...rest,
    height: Math.max(mine.height, theirs.height),
    strokes,
    ...(paper ? { paper } : {}),
  };
}

function shares(a: InkBlock, b: InkBlock): boolean {
  const ids = new Set(a.strokes.map((s) => s.id));
  return b.strokes.some((s) => ids.has(s.id));
}

/** A stretch both sides changed: mine, with what only theirs has put in. */
function both(
  base: readonly NoteBlock[],
  mine: readonly NoteBlock[],
  theirs: readonly NoteBlock[],
): { blocks: NoteBlock[]; carried: number } {
  const baseKeys = new Set(base.map(blockKey));
  const theirKeys = new Set(theirs.map(blockKey));
  // Left alone here but changed or taken away there: theirs stands for it.
  const blocks = mine.filter((block) => {
    const key = blockKey(block);
    return !(baseKeys.has(key) && !theirKeys.has(key));
  });
  const mineKeys = new Set(blocks.map(blockKey));
  let carried = 0;
  for (const block of theirs) {
    const key = blockKey(block);
    // Already here, or unchanged there and taken away here.
    if (mineKeys.has(key) || baseKeys.has(key)) continue;
    if (block.type === "ink") {
      const at = blocks.findIndex((b) => b.type === "ink" && shares(b, block));
      const from = base.find((b): b is InkBlock => b.type === "ink" && shares(b, block)) ?? null;
      if (at >= 0) {
        blocks[at] = mergeInk(from, blocks[at] as InkBlock, block);
        carried++;
        continue;
      }
    }
    blocks.push(block);
    carried++;
  }
  return { blocks, carried };
}

/** Merge `mine` and `theirs`, both changed from `base`. */
export function mergeNotes(base: TextNote, mine: TextNote, theirs: TextNote): NoteMerge {
  const b = base.blocks.map(blockKey);
  const m = mine.blocks.map(blockKey);
  const t = theirs.blocks.map(blockKey);
  const toMine = new Map(commonPairs(b, m));
  const toTheirs = new Map(commonPairs(b, t));
  const out: NoteBlock[] = [];
  let carried = 0;
  let i = 0;
  let j = 0;
  let k = 0;
  const stretch = (endB: number, endM: number, endT: number): void => {
    const bk = b.slice(i, endB);
    const mk = m.slice(j, endM);
    const tk = t.slice(k, endT);
    const mb = mine.blocks.slice(j, endM);
    const tb = theirs.blocks.slice(k, endT);
    if (sameKeys(mk, bk)) out.push(...tb);
    else if (sameKeys(tk, bk) || sameKeys(mk, tk)) out.push(...mb);
    else {
      const merged = both(base.blocks.slice(i, endB), mb, tb);
      out.push(...merged.blocks);
      carried += merged.carried;
    }
  };
  for (let s = 0; s < b.length; s++) {
    const sm = toMine.get(s);
    const st = toTheirs.get(s);
    // A section both sides still have, unchanged, after where we are.
    if (sm === undefined || st === undefined || sm < j || st < k) continue;
    stretch(s, sm, st);
    out.push(mine.blocks[sm]);
    i = s + 1;
    j = sm + 1;
    k = st + 1;
  }
  stretch(b.length, m.length, t.length);
  return { note: { ...theirs, blocks: out }, carried };
}

/**
 * The texts a view wrote or read itself, newest last: one of them coming
 * back from a sync is an older version of this view's, not a change made
 * elsewhere (`ownTexts` in the notebook view).
 */
export class OwnTexts {
  private readonly texts: string[] = [];

  constructor(private readonly limit = 16) {}

  note(text: string): void {
    const at = this.texts.indexOf(text);
    if (at >= 0) this.texts.splice(at, 1);
    this.texts.push(text);
    if (this.texts.length > this.limit) this.texts.shift();
  }

  has(text: string): boolean {
    return this.texts.includes(text);
  }

  forget(): void {
    this.texts.length = 0;
  }
}
