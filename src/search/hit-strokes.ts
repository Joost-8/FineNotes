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
