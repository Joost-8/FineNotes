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

/** A line's tokens, and the word groups each one owns (by where it falls along the ink). */
interface Placed {
  tokens: RegExpMatchArray[];
  owned: string[][];
}

/**
 * Place a line's words along its ink. The device's reading of a line often
 * has fewer words than the ink has word groups (a word written in two
 * pieces, a gap read as none): on a real lecture page only a quarter of the
 * lines matched one for one. Each word gets its share of the line's
 * characters laid along the ink's width; with at least as many groups as
 * words, the breaks between words then go in the ink's gaps, each in a wide
 * gap near where its share puts it ({@link wordBreaks}). With fewer groups,
 * every group goes to the word whose span is nearest its middle.
 */
function placeLine(
  line: ReadLine,
  boundsOf: (strokeIds: readonly string[]) => Box | null,
): Placed | null {
  const tokens = [...line.text.matchAll(/\S+/g)];
  const groups = line.words.filter((g) => g.length > 0);
  if (tokens.length === 0 || groups.length === 0) return null;
  const placed = groups.map((g) => ({ ids: g, box: boundsOf(g) }));
  const xs = placed.flatMap((p) => (p.box ? [p.box.minX, p.box.maxX] : []));
  const left = Math.min(...xs);
  const width = Math.max(...xs) - left;
  const length = line.text.length;
  const spans = tokens.map((token) => {
    const start = token.index ?? 0;
    return {
      from: left + (start / length) * width,
      to: left + ((start + token[0].length) / length) * width,
    };
  });
  const owned: string[][] = tokens.map(() => []);
  const boxed = placed
    .filter((p): p is { ids: readonly string[]; box: Box } => p.box !== null)
    .sort((a, b) => a.box.minX + a.box.maxX - (b.box.minX + b.box.maxX));
  if (tokens.length > 1 && boxed.length >= tokens.length) {
    const expected = spans.slice(1).map((span, k) => (spans[k].to + span.from) / 2);
    const breaks = wordBreaks(
      boxed.map((p) => p.box),
      expected,
    );
    let word = 0;
    boxed.forEach((p, g) => {
      if (word < breaks.length && g >= breaks[word]) word++;
      owned[word].push(...p.ids);
    });
    return { tokens, owned };
  }
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
  return { tokens, owned };
}

/** How much a break is worth per page px of gap, against each px it lies from where expected. */
const BREAK_DRIFT = 0.25;

/**
 * Where the words of a line break, as the index of the first group of each
 * word after the first: one break per `expected` position, in order, each
 * in a gap between neighbouring groups (`boxes`, left to right), chosen so
 * that wide gaps near where they are expected win (dynamic programming).
 */
function wordBreaks(boxes: readonly Box[], expected: readonly number[]): number[] {
  const gaps = boxes.slice(1).map((box, i) => ({
    width: box.minX - boxes[i].maxX,
    at: (box.minX + boxes[i].maxX) / 2,
  }));
  const n = expected.length;
  const m = gaps.length;
  // score[k][g]: the best total with break k in gap g; from[k][g]: break k-1's gap.
  const score = expected.map(() => new Array<number>(m).fill(-Infinity));
  const from = expected.map(() => new Array<number>(m).fill(-1));
  for (let k = 0; k < n; k++) {
    for (let g = k; g <= m - (n - k); g++) {
      const own = gaps[g].width - BREAK_DRIFT * Math.abs(gaps[g].at - expected[k]);
      if (k === 0) {
        score[k][g] = own;
        continue;
      }
      for (let h = k - 1; h < g; h++) {
        if (score[k - 1][h] + own > score[k][g]) {
          score[k][g] = score[k - 1][h] + own;
          from[k][g] = h;
        }
      }
    }
  }
  let g = 0;
  for (let h = 1; h < m; h++) if (score[n - 1][h] > score[n - 1][g]) g = h;
  const breaks = new Array<number>(n);
  for (let k = n - 1; k >= 0; k--) {
    breaks[k] = g + 1;
    g = from[k][g];
  }
  return breaks;
}

/** The ink of the line's words that overlap characters `from..to` of its text. */
function inkOfRange(placed: Placed, from: number, to: number): string[] {
  const out: string[] = [];
  placed.tokens.forEach((token, i) => {
    const start = token.index ?? 0;
    if (start <= to && start + token[0].length > from) out.push(...placed.owned[i]);
  });
  return out;
}

/** Letters and digits of folded text, with the index in that text each came from. */
function lettersOf(folded: string): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < folded.length; i++) {
    if (/[\p{L}\p{N}]/u.test(folded[i])) {
      text += folded[i];
      at.push(i);
    }
  }
  return { text, at };
}

/** Letters of transcript kept on each side of a word, to find where it is in the reading. */
const CONTEXT = 12;
/** The most edits per letter an aligned stretch may need and still be the same place. */
const MAX_ALIGN_COST = 0.45;

/**
 * Where `needle` sits in `hay` (semi-global edit distance: the whole needle,
 * any stretch of hay), and for each needle letter the hay letter it was
 * matched to (-1 when it was dropped). Null when it needs too many edits.
 */
function alignInto(needle: string, hay: string): number[] | null {
  const m = needle.length;
  const n = hay.length;
  if (m === 0 || n === 0) return null;
  const w = n + 1;
  const cost = new Uint16Array((m + 1) * w);
  for (let i = 1; i <= m; i++) {
    const row = i * w;
    cost[row] = i;
    for (let j = 1; j <= n; j++) {
      const sub = cost[row - w + j - 1] + (needle[i - 1] === hay[j - 1] ? 0 : 1);
      cost[row + j] = Math.min(sub, cost[row - w + j] + 1, cost[row + j - 1] + 1);
    }
  }
  const last = m * w;
  let end = 1;
  for (let j = 2; j <= n; j++) if (cost[last + j] < cost[last + end]) end = j;
  if (cost[last + end] > MAX_ALIGN_COST * m) return null;
  const match = new Array<number>(m).fill(-1);
  let i = m;
  let j = end;
  while (i > 0 && j > 0) {
    const here = cost[i * w + j];
    if (here === cost[(i - 1) * w + j - 1] + (needle[i - 1] === hay[j - 1] ? 0 : 1)) {
      match[i - 1] = j - 1;
      i--;
      j--;
    } else if (here === cost[(i - 1) * w + j] + 1) i--;
    else j--;
  }
  return match;
}

/**
 * The ink of each place `transcript` holds a word of the query, found by
 * lining the transcript up with the device's reading of the page (2.5.2).
 * The transcript (usually the AI's) reads words right that the device
 * misreads ("Software" read as "Soft ware", "plus" as "PIVJ"), so the word
 * is found there, and its letters with a few either side are matched
 * against the reading, letter by letter, to say which ink it is.
 */
function transcriptHits(
  terms: readonly string[],
  transcript: string,
  lines: readonly ReadLine[],
  placedOf: (line: number) => Placed | null,
): string[][] {
  const folded = fold(transcript).text;
  const said = lettersOf(folded);
  if (said.text.length === 0) return [];
  // Folded index → index of the first letter at or after it.
  const letterAt = new Array<number>(folded.length + 1);
  let k = 0;
  for (let i = 0; i <= folded.length; i++) {
    while (k < said.at.length && said.at[k] < i) k++;
    letterAt[i] = k;
  }
  let read = "";
  const source: { line: number; at: number }[] = [];
  lines.forEach((line, index) => {
    const f = fold(line.text);
    const letters = lettersOf(f.text);
    read += letters.text;
    for (const at of letters.at) source.push({ line: index, at: f.map[at] });
  });
  const out: string[][] = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at >= 0; at = folded.indexOf(term, at + 1)) {
      const a = letterAt[at];
      const b = letterAt[at + term.length];
      if (b <= a) continue;
      const lo = Math.max(0, a - CONTEXT);
      const hi = Math.min(said.text.length, b + CONTEXT);
      const match = alignInto(said.text.slice(lo, hi), read);
      if (!match) continue;
      // The word's letters in the reading, as a character range per line.
      const ranges = new Map<number, { from: number; to: number }>();
      for (const j of match.slice(a - lo, b - lo)) {
        if (j < 0) continue;
        const { line, at: c } = source[j];
        const range = ranges.get(line);
        if (range) {
          range.from = Math.min(range.from, c);
          range.to = Math.max(range.to, c);
        } else ranges.set(line, { from: c, to: c });
      }
      const ink: string[] = [];
      for (const [line, range] of ranges) {
        const placed = placedOf(line);
        if (placed) ink.push(...inkOfRange(placed, range.from, range.to));
      }
      if (ink.length > 0) out.push(ink);
    }
  }
  return out;
}

/**
 * The ink of each word that holds a word of `query`, one group of stroke
 * ids per word found (2.5.1): the device's reading's own words, placed by
 * where they fall in their line ({@link placeLine}), and, when the page has
 * a transcript, every place the transcript holds the query, wherever the
 * device read it differently. With neither, a word of the reading misread
 * by a letter or two (by length) counts.
 */
export function lineHits(
  query: string,
  lines: readonly ReadLine[],
  boundsOf: (strokeIds: readonly string[]) => Box | null,
  transcript = "",
): string[][] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const placedLines = new Map<number, Placed | null>();
  const placedOf = (index: number): Placed | null => {
    if (!placedLines.has(index)) placedLines.set(index, placeLine(lines[index], boundsOf));
    return placedLines.get(index) ?? null;
  };
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
    lines.forEach((_, index) => {
      const placed = placedOf(index);
      placed?.tokens.forEach((token, i) => {
        const ink = placed.owned[i];
        if (holds(token[0]) && ink.length > 0) out.push([...ink]);
      });
    });
    return out;
  };
  const hits = [...found(exact), ...transcriptHits(terms, transcript, lines, placedOf)];
  if (hits.length === 0) return found(near);
  // The reading and the transcript often find the same word: light it once.
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const ink of hits) {
    const unique = [...new Set(ink)];
    const key = [...unique].sort().join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(unique);
  }
  return out;
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
