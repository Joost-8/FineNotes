/**
 * Home's search inside notebooks: the words on every page of every
 * notebook, so a search on Home finds a page and opens the notebook there.
 * Titles come first on Home; these are the pages below them.
 *
 * A notebook's own text (its transcriptions and text boxes) is taken from
 * the file once, in Home's read worker ({@link notebookText}), and kept
 * on this device with the file's time and size. What this device has
 * worked out about a page is added when searching ({@link assemblePages}):
 * the transcript server's file, Grape's reading of the handwriting (only
 * while the page is as it was read, and only where no transcription
 * exists, since a transcription reads better) and the PDF's printed text.
 *
 * Grape misreads a letter here and there, so a word found in its reading
 * may be a little off ({@link searchLibrary}); everything else must match
 * as typed, as in the notebook's own search.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Page } from "../model/document";
import { pageContentHash, pageKeys } from "../recognition/page-transcripts";
import { editDistance } from "./hit-strokes";
import {
  type PageSource,
  type PageText,
  type Snippet,
  collectPageText,
  foldedOf,
  queryTerms,
  searchPages,
  snippetAt,
} from "./notebook-search";

/** One page as Home keeps it for searching. */
export interface IndexedPage {
  id: string;
  /** The page's key in transcriptions (`pageKeys`). */
  key: string;
  /** What the page holds now (`pageContentHash`): a reading of another hash is out of date. */
  hash: string;
  /** The PDF page under it, whose printed text may have been read on this device. */
  pdf?: { path: string; page: number };
  /** The note's own transcription of the page, then its text boxes. */
  sources: PageSource[];
}

/**
 * A notebook's own searchable text, page by page, from its pages and the
 * note's text layer (`readTextSection` of the note's body).
 */
export function notebookText(
  pages: readonly Page[],
  textLayer: string | null,
  budget = MAX_NOTEBOOK_TEXT,
): IndexedPage[] {
  const keys = pageKeys(pages);
  const texts = collectPageText(pages, textLayer, null);
  let left = budget;
  return pages.map((page, i) => {
    const backdrop = page.backdrop;
    const sources: PageSource[] = [];
    for (const source of texts[i].sources) {
      const text = source.kind === "handwriting" ? plainTranscript(source.text) : source.text;
      if (left <= 0) break;
      // Past the budget the rest of the notebook is not kept: one odd notebook never fills the device.
      sources.push({ ...source, text: text.length > left ? text.slice(0, left) : text });
      left -= text.length;
    }
    return {
      id: page.id,
      key: keys[i],
      hash: pageContentHash(page),
      ...(backdrop.kind === "pdf" ? { pdf: { path: backdrop.path, page: backdrop.page } } : {}),
      sources,
    };
  });
}

/**
 * The most text kept for one notebook, in characters. A full lecture
 * notebook holds tens of thousands; this only stops a pathological one
 * (a pasted book) from filling the device and every search.
 */
export const MAX_NOTEBOOK_TEXT = 1_000_000;

/** LaTeX commands that read as a sign, and what they show as. */
const LATEX_SIGNS: Readonly<Record<string, string>> = {
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  to: "→",
  rightarrow: "→",
  infty: "∞",
  sum: "∑",
  int: "∫",
  sqrt: "√",
};

/**
 * A transcription as plain text, for searching and snippets: Markdown's
 * marks (headings, list bullets and boxes, bold, code, links, quotes) and
 * LaTeX's (`$`, braces, `\left`) go; every word stays, so nothing that
 * could be searched for is lost. A link keeps the words it shows.
 */
export function plainTranscript(text: string): string {
  return (
    text
      .replace(/<!--[\s\S]*?-->/g, "")
      // [[target|shown]] and [[target]]; [shown](url).
      .replace(
        /!?\[\[([^\]|]*)\|?([^\]]*)\]\]/g,
        (_, target: string, shown: string) => shown || target,
      )
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Line starts: headings, quotes, bullets, numbers, task boxes.
      .replace(
        /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/gm,
        "",
      )
      .replace(
        /\\([a-zA-Z]+)/g,
        (_, name: string) =>
          LATEX_SIGNS[name] ?? (name === "left" || name === "right" || name === "frac" ? "" : name),
      )
      .replace(/\*\*|__|`|\$\$?|[{}]/g, "")
      .replace(/[ \t]{2,}/g, " ")
  );
}

/** What this device adds to a notebook's own text. */
export interface PageExtras {
  /** The transcript server's transcriptions, by page key. */
  sidecar?: ReadonlyMap<string, string>;
  /** Grape's reading of a page, if one was kept for this page as it is now. */
  reading?: (page: IndexedPage) => string | undefined;
  /** The printed text of a PDF page, if it was read on this device. */
  printed?: (pdf: { path: string; page: number }) => string | undefined;
}

/** The pages as the search sees them: the note's text with this device's additions. */
export function assemblePages(pages: readonly IndexedPage[], extras: PageExtras): PageText[] {
  return pages.map((page, pageIndex) => {
    const own = page.sources.filter((s) => s.kind === "handwriting");
    const sources: PageSource[] = [...own];
    const raw = extras.sidecar?.get(page.key);
    const server = raw ? plainTranscript(raw) : undefined;
    if (server && !own.some((s) => s.text === server))
      sources.push({ kind: "handwriting", text: server });
    sources.push(...page.sources.filter((s) => s.kind !== "handwriting"));
    if (!sources.some((s) => s.kind === "handwriting")) {
      const reading = extras.reading?.(page);
      if (reading?.trim()) sources.push({ kind: "handwriting", text: reading, guess: true });
    }
    const printed = page.pdf ? extras.printed?.(page.pdf) : undefined;
    if (printed?.trim()) sources.push({ kind: "pdf", text: printed });
    return { pageIndex, sources };
  });
}

export interface LibraryBook {
  path: string;
  pages: readonly PageText[];
}

export interface LibraryHit {
  path: string;
  pageIndex: number;
  /** The page holds the query's words as typed, one after another. */
  phrase: boolean;
  /** Found only with a word read a little off by Grape. */
  near: boolean;
  count: number;
  snippets: Snippet[];
}

/**
 * How many letters a word of this length may be off in Grape's reading
 * and still be found. Stricter than the notebook's own highlight
 * (`hit-strokes.ts`), which only looks on a page already known to hold the
 * word: here a short word one letter off would find half the vault.
 */
export function nearAllowance(length: number): number {
  return length >= 9 ? 2 : length >= 5 ? 1 : 0;
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** A reading's words, folded, with where each starts and ends in the folded text. */
const wordsOfSource = new WeakMap<
  PageSource,
  { of: string; words: Array<{ text: string; start: number; end: number }> }
>();

function wordsOf(source: PageSource): Array<{ text: string; start: number; end: number }> {
  const kept = wordsOfSource.get(source);
  if (kept?.of === source.text) return kept.words;
  const folded = foldedOf(source).text;
  const words = [...folded.matchAll(WORD_RE)].map((m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
  wordsOfSource.set(source, { of: source.text, words });
  return words;
}

/** Where `term` is in a reading, a little off: the first word (or start of a word) within its allowance. */
function nearMatch(source: PageSource, term: string): { start: number; end: number } | null {
  const max = nearAllowance(term.length);
  if (max === 0) return null;
  for (const word of wordsOf(source)) {
    if (word.text.length < term.length - max) continue;
    // A word still being typed matches the start of a longer one, as an exact search does.
    const head = word.text.length > term.length ? word.text.slice(0, term.length) : word.text;
    if (editDistance(head, term, max) <= max) {
      return { start: word.start, end: word.start + head.length };
    }
  }
  return null;
}

/** Snippets a page shows at most. */
const MAX_SNIPPETS = 2;

/**
 * Pages holding every word of `query`, across `books` in their order: pages
 * holding it as a phrase first, then the rest, then pages found only with
 * Grape's near readings; at most `max`.
 */
export function searchLibrary(
  books: readonly LibraryBook[],
  query: string,
  max = 60,
): LibraryHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const phrases: LibraryHit[] = [];
  const exact: LibraryHit[] = [];
  const near: LibraryHit[] = [];
  for (const book of books) {
    if (phrases.length >= max) break;
    const found = new Set<number>();
    for (const hit of searchPages(book.pages, query)) {
      found.add(hit.pageIndex);
      (hit.phrase ? phrases : exact).push({
        path: book.path,
        pageIndex: hit.pageIndex,
        phrase: hit.phrase,
        near: false,
        count: hit.count,
        snippets: hit.snippets.slice(0, MAX_SNIPPETS),
      });
    }
    if (near.length >= max) continue;
    for (const page of book.pages) {
      if (found.has(page.pageIndex)) continue;
      const guesses = page.sources.filter((s) => s.guess);
      if (guesses.length === 0) continue;
      const hit = nearHit(page, guesses, terms);
      if (hit) near.push({ path: book.path, ...hit });
    }
  }
  return [...phrases, ...exact, ...near].slice(0, max);
}

/** A page found with every term, as typed anywhere on it or a little off in a reading. */
function nearHit(
  page: PageText,
  guesses: readonly PageSource[],
  terms: readonly string[],
): Omit<LibraryHit, "path"> | null {
  const all = page.sources.map((s) => foldedOf(s).text).join("\n");
  const snippets: Snippet[] = [];
  let count = 0;
  let off = false;
  for (const term of terms) {
    const at = all.indexOf(term);
    if (at >= 0) {
      count++;
      continue;
    }
    let spot: { source: PageSource; start: number; end: number } | null = null;
    for (const source of guesses) {
      const range = nearMatch(source, term);
      if (range) {
        spot = { source, ...range };
        break;
      }
    }
    if (!spot) return null;
    off = true;
    count++;
    if (snippets.length < MAX_SNIPPETS) {
      snippets.push(snippetAt(spot.source, foldedOf(spot.source).map, spot.start, spot.end));
    }
  }
  if (!off) return null;
  return { pageIndex: page.pageIndex, phrase: false, near: true, count, snippets };
}
