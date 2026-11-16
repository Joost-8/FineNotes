/**
 * The notebook search's results list (discussion #112): every match, one
 * row each, to step through with Next and Previous instead of searching
 * again. The pages come in the order `searchPages` gives them (those holding
 * the words as a phrase first, each in page order); on a page, its matches
 * in the order its texts are searched: handwriting, text boxes, PDF text.
 *
 * Each result knows which match of its kind on its page it is (`nth`), so
 * the view can mark that one among the page's lit words, and, in a text
 * box, which box.
 *
 * PURE: no DOM, no Obsidian.
 */

import {
  type PageText,
  type Snippet,
  type SourceKind,
  foldedOf,
  matchFolded,
  searchPages,
  snippetAt,
} from "./notebook-search";

export interface SearchResult {
  pageIndex: number;
  kind: SourceKind;
  /** Which match of its kind on its page, 0-based, in reading order. */
  nth: number;
  /** The text box it is in, for a text box's match. */
  boxId?: string;
  snippet: Snippet;
}

export interface ResultList {
  /** The results, at most the cap given. */
  results: SearchResult[];
  /** Every match, listed or not. */
  total: number;
}

/**
 * Most rows listed. A common word in a long PDF matches thousands of
 * times; a row each would stall an iPad, and nobody steps through more.
 */
export const MAX_RESULTS = 1000;

/** Every match of `query` in the notebook, a result each (see the file's comment). */
export function listResults(
  index: readonly PageText[],
  query: string,
  cap = MAX_RESULTS,
): ResultList {
  const pages = new Map(index.map((page) => [page.pageIndex, page]));
  const results: SearchResult[] = [];
  let total = 0;
  for (const hit of searchPages(index, query)) {
    const page = pages.get(hit.pageIndex);
    if (!page) continue;
    const nth: Record<SourceKind, number> = { handwriting: 0, text: 0, pdf: 0 };
    for (const source of page.sources) {
      const folded = foldedOf(source);
      for (const span of matchFolded(folded.text, query, hit.phrase)) {
        total++;
        const n = nth[source.kind]++;
        if (results.length >= cap) continue;
        const result: SearchResult = {
          pageIndex: hit.pageIndex,
          kind: source.kind,
          nth: n,
          snippet: snippetAt(source, folded.map, span.start, span.end),
        };
        if (source.boxId) result.boxId = source.boxId;
        results.push(result);
      }
    }
  }
  return { results, total };
}

/** How many matches of `kind` a page has: what its results of that kind count up to. */
export function matchesOfKind(
  page: PageText | undefined,
  query: string,
  phrase: boolean,
  kind: SourceKind,
): number {
  if (!page) return 0;
  let count = 0;
  for (const source of page.sources) {
    if (source.kind === kind) count += matchFolded(foldedOf(source).text, query, phrase).length;
  }
  return count;
}

/**
 * The result `delta` steps from `current`, wrapping round at either end;
 * from none, Next is the first and Previous the last. `null` for no results.
 */
export function stepResult(current: number | null, length: number, delta: 1 | -1): number | null {
  if (length <= 0) return null;
  if (current === null || current < 0 || current >= length) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}

/** Whether two results are the same match: same page, same kind, same place among that kind. */
export function sameResult(a: SearchResult, b: SearchResult): boolean {
  return a.pageIndex === b.pageIndex && a.kind === b.kind && a.nth === b.nth;
}

/**
 * Where the result being looked at is in a list made again (more of the
 * notebook was read, so more results arrived): the same match, or `null`
 * when it is gone.
 */
export function keepCurrent(
  current: SearchResult | null,
  results: readonly SearchResult[],
): number | null {
  if (!current) return null;
  const at = results.findIndex((result) => sameResult(result, current));
  return at < 0 ? null : at;
}

/** A box on the page: the lit words' bounds. */
export interface Spot {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The positions of `spots` in reading order: by lines, top to bottom, and
 * left to right in a line. Two spots share a line when they overlap by
 * half the shorter one's height. Handwritten hits come from this device's
 * reading in no fixed order; this lines them up with the transcript's.
 */
export function readingOrder(spots: readonly Spot[]): number[] {
  const order = spots.map((_, i) => i).sort((a, b) => spots[a].minY - spots[b].minY);
  const lines: number[][] = [];
  for (const i of order) {
    const s = spots[i];
    const line = lines.find((members) => {
      const first = spots[members[0]];
      const overlap = Math.min(first.maxY, s.maxY) - Math.max(first.minY, s.minY);
      const shorter = Math.min(first.maxY - first.minY, s.maxY - s.minY);
      return overlap >= shorter / 2;
    });
    if (line) line.push(i);
    else lines.push([i]);
  }
  return lines.flatMap((line) => line.sort((a, b) => spots[a].minX - spots[b].minX));
}
