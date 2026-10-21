/**
 * Which ink and which text boxes on a page a search found (2.5), so the page
 * can light them up when a search result is opened, instead of only
 * scrolling to the top of the page.
 *
 * Handwriting is found through the device's reading of the page: each word
 * of it carries the strokes it is written with (`hwr/corrections.ts`). A
 * word is a hit when it holds any word of the query, folded for case and
 * accents exactly as the search itself folds them (`notebook-search.ts`).
 *
 * PURE: no DOM, no Obsidian.
 */

import type { TextBoxElement } from "../model/document";
import type { ReadWord } from "../recognition/hwr/corrections";
import { fold, queryTerms } from "./notebook-search";

export interface PageHits {
  /** The strokes of each word found, in reading order. */
  words: string[][];
  /** Ids of the text boxes that hold a word of the query. */
  boxes: string[];
}

const PAGE_HEADING_RE = /^#{1,6} Page (\d+)\s*$/;
const PAGE_LINK_RE = /\[\[#Page (\d+)\]\]/;

/**
 * Where a match of Obsidian's own search lands in a notebook: the page whose
 * entry in the note's text block holds it (the `### Page N` above it, or a
 * task line's `[[#Page N]]`), and the words matched, to light up there.
 * `content` is the note as the search read it; `matches` its `[start, end)`
 * offsets. `null` when the first match is in no page's text.
 */
export function searchMatchTarget(
  content: string,
  matches: ReadonlyArray<readonly [number, number]>,
): { pageIndex: number; query: string } | null {
  const first = matches[0];
  if (!first) return null;
  const [start, end] = first;
  if (!(start >= 0 && end > start && end <= content.length)) return null;
  const query = content.slice(start, end).trim();
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = content.indexOf("\n", end);
  const line = content.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const linked = PAGE_LINK_RE.exec(line);
  if (linked) return { pageIndex: Number(linked[1]) - 1, query };
  const before = content.slice(0, lineStart).split("\n");
  for (let i = before.length - 1; i >= 0; i--) {
    const heading = PAGE_HEADING_RE.exec(before[i]);
    if (heading) return { pageIndex: Number(heading[1]) - 1, query };
    // Past the text block's start: the match is in the user's own prose.
    if (before[i].includes("<!--goodobsidian-text-->")) return null;
  }
  return null;
}

/** One line of the device's reading: its text, and its ink's word groups left to right. */
export interface ReadLine {
  text: string;
  words: readonly (readonly string[])[];
}

/** A box, page px. */
interface Box {
  minX: number;
  maxX: number;
}

/** Letters and digits only, folded: how a word is compared when it was misread. */
function bare(text: string): string {
  return fold(text).text.replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Edit distance between `a` and `b`, or `max + 1` once it is past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * How many letters a word of this length may be misread by and still count
 * as found. Only asked of a page the search already found the word on (in a
 * transcription), so a short word may be one letter off too: a title "CRT"
 * read as "CRI" is still where "crt" is.
 */
function misreadAllowance(length: number): number {
  return length >= 8 ? 2 : length >= 3 ? 1 : 0;
}

/**
 * The ink of each word of the reading that holds a word of `query`, one
 * group of stroke ids per word found (2.5.1). The device's reading of a line
 * often has fewer words than the ink has word groups (a word written in two
 * pieces, a gap read as none): on a real lecture page only a quarter of the
 * lines matched one for one. So a word is placed by where it falls in its
 * line, its share of the line's characters laid along the ink's width, and
 * takes the word groups whose middles lie there. When no word holds the
 * query exactly, a word misread by a letter or two (by length) counts.
 */
export function lineHits(
  query: string,
  lines: readonly ReadLine[],
  boundsOf: (strokeIds: readonly string[]) => Box | null,
): string[][] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const exact = (token: string): boolean => terms.some((term) => fold(token).text.includes(term));
  const near = (token: string): boolean => {
    const word = bare(token);
    return terms.some((term) => {
      const t = bare(term);
      const allowance = misreadAllowance(t.length);
      return allowance > 0 && editDistance(word, t, allowance) <= allowance;
    });
  };
  const found = (holds: (token: string) => boolean): string[][] => {
    const out: string[][] = [];
    for (const line of lines) {
      const tokens = [...line.text.matchAll(/\S+/g)];
      const groups = line.words.filter((g) => g.length > 0);
      if (tokens.length === 0 || groups.length === 0) continue;
      const placed = groups.map((g) => ({ ids: g, box: boundsOf(g) }));
      const xs = placed.flatMap((p) => (p.box ? [p.box.minX, p.box.maxX] : []));
      const left = Math.min(...xs);
      const width = Math.max(...xs) - left;
      const length = line.text.length;
      // Each word's span along the ink, by its share of the line's characters.
      const spans = tokens.map((token) => {
        const start = token.index ?? 0;
        return {
          from: left + (start / length) * width,
          to: left + ((start + token[0].length) / length) * width,
        };
      });
      // Every word group goes to the word whose span is nearest its middle.
      const owned: string[][] = tokens.map(() => []);
      for (const p of placed) {
        if (!p.box) continue;
        const mid = (p.box.minX + p.box.maxX) / 2;
        let best = 0;
        let bestGap = Infinity;
        spans.forEach((span, i) => {
          const gap = mid < span.from ? span.from - mid : mid > span.to ? mid - span.to : 0;
          if (gap < bestGap) {
            bestGap = gap;
            best = i;
          }
        });
        owned[best].push(...p.ids);
      }
      tokens.forEach((token, i) => {
        if (!holds(token[0])) return;
        if (tokens.length === groups.length) out.push([...groups[i]]);
        else if (owned[i].length > 0) out.push(owned[i]);
      });
    }
    return out;
  };
  const hits = found(exact);
  return hits.length > 0 ? hits : found(near);
}

/** What on a page holds a word of `query`: read words (by their strokes) and text boxes. */
export function pageHits(
  query: string,
  words: readonly ReadWord[],
  boxes: readonly Pick<TextBoxElement, "id" | "text">[],
): PageHits {
  const terms = queryTerms(query);
  if (terms.length === 0) return { words: [], boxes: [] };
  const holds = (text: string): boolean => {
    const folded = fold(text).text;
    return terms.some((term) => folded.includes(term));
  };
  return {
    words: words
      .filter((word) => word.strokeIds.length > 0 && holds(word.text))
      .map((word) => [...word.strokeIds]),
    boxes: boxes.filter((box) => holds(box.text)).map((box) => box.id),
  };
}
