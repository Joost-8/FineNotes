/**
 * "Search this notebook": find a word across every page and say which pages
 * hold it, so a tap can jump there.
 *
 * Handwriting is searched through its transcription — there is no text in a
 * stroke — from two places:
 *
 * - the note's own text layer (AI → Transcribe), one entry per page
 *   (`src/recognition/page-transcripts.ts`);
 * - the transcript server's sidecar file, `Title.transcript.md` beside the
 *   note (or `_transcript.md` in a notebook folder), which uses the same
 *   `<!--goodobsidian-page key hash-->` markers under its own headings.
 *
 * Typed text boxes are searched as they are. Matching ignores case and
 * accents; every word of the query must be on the page, in any order.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Page } from "../model/document";
import { inkFileSuffix } from "../model/new-notebook";
import { pageKeys, parsePageTranscripts } from "../recognition/page-transcripts";

export type SourceKind = "handwriting" | "text";

export interface PageSource {
  kind: SourceKind;
  text: string;
}

/** Everything searchable on one page. */
export interface PageText {
  pageIndex: number;
  sources: PageSource[];
}

export interface Snippet {
  kind: SourceKind;
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  pageIndex: number;
  /** Occurrences of any query word on the page. */
  count: number;
  /** The first few, in reading order, with some context. */
  snippets: Snippet[];
}

/**
 * Where the transcript server keeps a note's transcriptions: `Title.transcript.md`
 * beside `Title.notebook.md` / `.page.md` / `.ink.md`, or `_transcript.md`
 * beside a notebook folder's `_notebook.md` (the transcript server's
 * `GoodObsidian-transcripts` repo, `src/vault.ts`). `null` for a file that is not a handwritten note.
 */
export function transcriptSidecarPath(notePath: string): string | null {
  const slash = notePath.lastIndexOf("/");
  const dir = slash >= 0 ? notePath.slice(0, slash + 1) : "";
  const name = notePath.slice(slash + 1);
  if (name === "_notebook.md") return `${dir}_transcript.md`;
  const suffix = inkFileSuffix(name);
  if (!suffix) return null;
  return `${dir}${name.slice(0, -suffix.length)}.transcript.md`;
}

/**
 * The page a link asks for, 0-based: `#Page 3`, `#page=3` (as PDF links
 * write it) or `#p3`. `null` for any other subpath, or a page past the end.
 */
export function pageFromSubpath(subpath: string, pageCount: number): number | null {
  const match = /^#?\s*(?:page\s*=?\s*|p)(\d+)\s*$/i.exec(subpath.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= pageCount ? n - 1 : null;
}

/** Characters of context either side of a match in a snippet. */
const CONTEXT = 36;
const MAX_SNIPPETS = 3;

/** Any heading a transcript file puts over a page: `### Page 2`, `## Page 2 · [[Note|open]]`. */
const PAGE_HEADING_RE = /^#{1,6}\s+Page\s+\d+\b.*$/;

/**
 * Per-page transcriptions from a transcript section or file, by page key.
 * Page headings are dropped first: the sidecar's carry a link, which the
 * text layer's parser does not recognise as a heading and would otherwise
 * read as the end of the previous page's text.
 */
export function transcriptsByKey(markdown: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!markdown) return out;
  const cleaned = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !PAGE_HEADING_RE.test(line.trim()))
    .join("\n");
  for (const entry of parsePageTranscripts(cleaned).entries) {
    if (!entry.text) continue;
    const prior = out.get(entry.key);
    out.set(entry.key, prior ? `${prior}\n${entry.text}` : entry.text);
  }
  return out;
}

/**
 * Collect every page's searchable text: its transcription from the text
 * layer and from the sidecar (both, when both exist and differ), then its
 * text boxes in order.
 */
export function collectPageText(
  pages: readonly Page[],
  textLayer: string | null,
  sidecar: string | null,
): PageText[] {
  const keys = pageKeys(pages);
  const layer = transcriptsByKey(textLayer);
  const file = transcriptsByKey(sidecar);
  return pages.map((page, pageIndex) => {
    const sources: PageSource[] = [];
    const own = layer.get(keys[pageIndex]);
    const server = file.get(keys[pageIndex]);
    if (own) sources.push({ kind: "handwriting", text: own });
    if (server && server !== own) sources.push({ kind: "handwriting", text: server });
    for (const box of page.textBoxes ?? []) {
      if (box.text?.trim()) sources.push({ kind: "text", text: box.text });
    }
    return { pageIndex, sources };
  });
}

/** Whether any page has a transcription at all (to explain an empty result). */
export function hasTranscripts(index: readonly PageText[]): boolean {
  return index.some((page) => page.sources.some((s) => s.kind === "handwriting"));
}

/** The words of a query, folded; empty when there is nothing to search for. */
export function queryTerms(query: string): string[] {
  return [...new Set(fold(query).text.split(/\s+/).filter(Boolean))];
}

/** Pages holding every word of `query`, in page order. */
export function searchPages(index: readonly PageText[], query: string): SearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const page of index) {
    const folded = page.sources.map((source) => ({ source, ...fold(source.text) }));
    const all = folded.map((f) => f.text).join("\n");
    if (!terms.every((term) => all.includes(term))) continue;

    let count = 0;
    const snippets: Snippet[] = [];
    for (const f of folded) {
      for (const range of occurrences(f.text, terms)) {
        count++;
        if (snippets.length < MAX_SNIPPETS) {
          snippets.push(snippetAt(f.source, f.map, range.start, range.end));
        }
      }
    }
    hits.push({ pageIndex: page.pageIndex, count, snippets });
  }
  return hits;
}

/** Non-overlapping matches of any term, left to right, longest term first at a tie. */
function occurrences(
  text: string,
  terms: readonly string[],
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const byLength = [...terms].sort((a, b) => b.length - a.length);
  let at = 0;
  while (at < text.length) {
    let best: { start: number; end: number } | null = null;
    for (const term of byLength) {
      const i = text.indexOf(term, at);
      if (i >= 0 && (best === null || i < best.start)) best = { start: i, end: i + term.length };
    }
    if (!best) break;
    out.push(best);
    at = best.end;
  }
  return out;
}

/** A match in its original spelling, with context trimmed at word boundaries, on one line. */
function snippetAt(
  source: PageSource,
  map: readonly number[],
  start: number,
  end: number,
): Snippet {
  const text = source.text;
  const from = map[start];
  const to = end < map.length ? map[end] : text.length;
  let a = Math.max(0, from - CONTEXT);
  let b = Math.min(text.length, to + CONTEXT);
  // Cut the context at word boundaries; line breaks in it read as spaces.
  if (a > 0) a = nextBoundary(text, a, from);
  if (b < text.length) b = prevBoundary(text, b, to);
  const oneLine = (s: string): string => s.replace(/\s+/g, " ");
  return {
    kind: source.kind,
    before: (a > 0 ? "…" : "") + oneLine(text.slice(a, from)).trimStart(),
    match: oneLine(text.slice(from, to)),
    after: oneLine(text.slice(to, b)).trimEnd() + (b < text.length ? "…" : ""),
  };
}

function nextBoundary(text: string, i: number, limit: number): number {
  const space = text.slice(i, limit).search(/\s/);
  return space < 0 ? i : i + space + 1;
}

function prevBoundary(text: string, i: number, limit: number): number {
  const slice = text.slice(limit, i);
  const space = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  return space < 0 ? i : limit + space;
}

/**
 * Lower-case, accent-free text, with `map[i]` the index in the original of
 * folded character `i`. Folding can change a character's length ("ﬁ" → "fi",
 * "İ" → "i̇"), so the map is what lets a snippet show the original spelling.
 */
export function fold(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const folded = ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < folded.length; k++) map.push(i);
    out += folded;
    i += ch.length;
  }
  return { text: out, map };
}
