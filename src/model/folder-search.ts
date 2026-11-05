/**
 * The Folders sidebar's search inside notes: how text is split into words,
 * the in-memory inverted index over every page of every note, notebook and
 * PDF, how a query is matched and ranked, the snippet shown under a hit, and
 * how the OCR cache FineNotes keeps for scanned PDFs is read. No Obsidian,
 * no DOM, no storage: the index class in `view/folder-sidebar/search-index.ts`
 * feeds this and keeps the pages on disk.
 */

/** The shortest and longest word that is indexed. */
export const MIN_WORD_LENGTH = 2;
export const MAX_WORD_LENGTH = 32;
/** A word must be this long to be searched as a prefix. */
export const MIN_QUERY_WORD_LENGTH = 3;
/** The most pages one word may list before the search says it was cut short. */
export const MAX_PAGES_PER_WORD = 50000;
/** The most words one prefix is allowed to expand to, and the most it is kept to. */
export const MAX_PREFIX_EXPANSION = 3000;
export const KEPT_PREFIX_EXPANSION = 300;
/** The most notes a search lists. */
export const MAX_HITS = 40;
/** A page of text shorter than this counts as having no text (a scanned page). */
export const MIN_PAGE_TEXT = 20;
/** The most text kept of one page. */
export const MAX_PAGE_TEXT = 8000;
/** A page was dead (removed) this many times over, and a quarter of all, before the index is rebuilt. */
export const COMPACT_DEAD_PAGES = 20000;

/** What kind of file a document is. */
export type IndexedKind = "note" | "notebook" | "pdf";

/** The words of `text`: accents folded away, lower case, between 2 and 32 characters. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_WORD_LENGTH && word.length <= MAX_WORD_LENGTH);
}

/** The first index in the sorted `list` whose entry is not before `value`. */
export function lowerBound(list: readonly string[], value: string): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The part of a page's text to show under a hit: about 150 characters around
 * the first query word found (with … where it was cut), or the start of the
 * page when none is.
 */
export function snippetOf(text: string, words: readonly string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const word of words) {
    const found = lower.indexOf(word);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return flat.slice(0, 140);
  const start = Math.max(0, at - 50);
  const end = Math.min(flat.length, at + 100);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

// --- FineNotes' OCR cache ---------------------------------------------------------

/** One page of text read from an OCR cache. */
export interface IndexedPage {
  /** Zero-based page number. */
  p: number;
  t: string;
}

/**
 * The pages of text in one OCR cache file (FineNotes' `ocr/<hash>.json`:
 * `{ format, pages: { "<zero-based page>": { lines: [{ words: [{ text }] }] } } }`).
 * A page with no words, or a key that is not a page number, is left out.
 * Throws when the text is not JSON.
 */
export function parseOcrSidecar(text: string): IndexedPage[] {
  const out: IndexedPage[] = [];
  const file = JSON.parse(text) as { pages?: unknown } | null;
  const pages = file?.pages;
  if (!pages || typeof pages !== "object") return out;
  for (const [key, page] of Object.entries(pages as Record<string, unknown>)) {
    const number = Number(key);
    const lines = (page as { lines?: unknown } | null)?.lines;
    if (!Number.isInteger(number) || number < 0 || !Array.isArray(lines)) continue;
    const spoken: string[] = [];
    for (const line of lines as unknown[]) {
      const words = (line as { words?: unknown } | null)?.words;
      if (!Array.isArray(words)) continue;
      const texts = (words as unknown[])
        .map((word) =>
          typeof word === "string"
            ? word
            : typeof (word as { text?: unknown } | null)?.text === "string"
              ? (word as { text: string }).text
              : "",
        )
        .filter(Boolean);
      if (texts.length) spoken.push(texts.join(" "));
    }
    const joined = spoken.join(" ");
    if (joined.trim()) out.push({ p: number, t: joined.slice(0, MAX_PAGE_TEXT) });
  }
  return out;
}

/**
 * Pages whose own text is shorter than {@link MIN_PAGE_TEXT} take the OCR
 * text when it is longer; pages the PDF text lacks are added. Returns the
 * merged pages in page order; `pages` is changed in place.
 */
export function mergeOcrPages(pages: IndexedPage[], ocr: readonly IndexedPage[]): IndexedPage[] {
  if (ocr.length === 0) return pages;
  const byPage = new Map(pages.map((page) => [page.p, page]));
  for (const read of ocr) {
    const own = byPage.get(read.p);
    if (own) {
      if (own.t.length < MIN_PAGE_TEXT && read.t.length > own.t.length) own.t = read.t;
    } else {
      pages.push(read);
    }
  }
  pages.sort((a, b) => a.p - b.p);
  return pages;
}

// --- The index ----------------------------------------------------------------------

/** A notebook page that has a PDF page behind it. */
export interface PdfReference {
  pdf: string;
  pdfPage: number;
  nbPage: number;
}

/** A document as it is stored and indexed. */
export interface StoredDocument {
  path: string;
  sig: string;
  kind: IndexedKind;
  title: string;
  pages: IndexedPage[];
  refs?: PdfReference[];
  /** A PDF most of whose pages have no text of their own. */
  scanned?: boolean;
  skipped?: "too-large" | "failed";
  /** The SHA-256 of a PDF's bytes: its OCR cache's name. */
  hash?: string;
  /** When the OCR cache was last read into this document. */
  ocrSig?: string;
}

/** What the index knows of a document besides its words. */
export interface DocumentInfo {
  kind: IndexedKind;
  title: string;
  sig: string;
  refs?: PdfReference[];
  scanned?: boolean;
  skipped?: "too-large" | "failed";
  ocrDone: boolean;
  pageIds: number[];
}

/** A notebook page that shows a PDF's page. */
export interface PdfUse {
  nb: string;
  nbPage: number;
  pdfPage: number;
}

/** One note that matches, with the pages that do. */
export interface MatchGroup {
  path: string;
  kind: IndexedKind;
  /** One-based page numbers. */
  pages: Set<number>;
  /** Where the words were found: the page whose text gives the snippet comes first. */
  sources: { doc: string; p: number }[];
  score: number;
  titleMatch: boolean;
}

export interface MatchResult {
  /** Best first, at most {@link MAX_HITS}. */
  groups: { group: MatchGroup; score: number }[];
  tooShort: boolean;
  truncated: boolean;
}

/** What the index holds, counted for the settings and the search footer. */
export interface IndexCounts {
  docs: number;
  notebooks: number;
  pdfs: number;
  /** Scanned PDFs (or ones that failed) with no OCR text yet. */
  unsearchablePdfs: number;
  tooLargePdfs: number;
}

/**
 * Every page of every document, as words → the pages they are on. A page is
 * a number; removing a document marks its pages dead rather than rewriting
 * the lists, and {@link needsCompaction} says when the dead outnumber enough
 * to start over.
 */
export class SearchPostings {
  readonly docs = new Map<string, DocumentInfo>();
  /** Page number → the document's path. */
  readonly pageDoc: string[] = [];
  /** Page number → the page's number in its document. */
  readonly pageNo: number[] = [];
  readonly dead = new Set<number>();
  private readonly postings = new Map<string, number[]>();
  private vocab: string[] = [];
  private vocabDirty = true;
  /** PDF path → the notebook pages that show it. */
  pdfUsers = new Map<string, PdfUse[]>();

  clear(): void {
    this.docs.clear();
    this.pageDoc.length = 0;
    this.pageNo.length = 0;
    this.dead.clear();
    this.postings.clear();
    this.vocab = [];
    this.vocabDirty = true;
    this.pdfUsers = new Map();
  }

  removeDoc(path: string): void {
    const doc = this.docs.get(path);
    if (!doc) return;
    for (const id of doc.pageIds) this.dead.add(id);
    this.docs.delete(path);
  }

  addDoc(doc: StoredDocument): void {
    this.removeDoc(doc.path);
    const pageIds: number[] = [];
    for (const page of doc.pages) {
      const id = this.pageDoc.length;
      this.pageDoc.push(doc.path);
      this.pageNo.push(page.p);
      pageIds.push(id);
      for (const word of new Set(tokenize(page.t))) {
        let list = this.postings.get(word);
        if (!list) {
          list = [];
          this.postings.set(word, list);
          this.vocabDirty = true;
        }
        list.push(id);
      }
    }
    this.docs.set(doc.path, {
      kind: doc.kind,
      title: doc.title,
      sig: doc.sig,
      refs: doc.refs,
      scanned: doc.scanned,
      skipped: doc.skipped,
      ocrDone: doc.ocrSig !== undefined,
      pageIds,
    });
  }

  /** Which notebook pages show which PDF, from the notebooks now indexed. */
  rebuildRefs(): void {
    const users = new Map<string, PdfUse[]>();
    for (const [path, doc] of this.docs) {
      if (doc.kind !== "notebook" || !doc.refs) continue;
      for (const ref of doc.refs) {
        let list = users.get(ref.pdf);
        if (!list) {
          list = [];
          users.set(ref.pdf, list);
        }
        list.push({ nb: path, nbPage: ref.nbPage, pdfPage: ref.pdfPage });
      }
    }
    this.pdfUsers = users;
  }

  /** Whether enough pages are dead that the index should be loaded again. */
  needsCompaction(): boolean {
    return !(this.dead.size < COMPACT_DEAD_PAGES || this.dead.size < this.pageDoc.length * 0.25);
  }

  counts(): IndexCounts {
    let notebooks = 0;
    let pdfs = 0;
    let unsearchablePdfs = 0;
    let tooLargePdfs = 0;
    for (const doc of this.docs.values()) {
      if (doc.kind === "notebook") notebooks++;
      if (doc.kind !== "pdf") continue;
      pdfs++;
      if (doc.skipped === "too-large") tooLargePdfs++;
      else if ((doc.scanned && !doc.ocrDone) || doc.skipped === "failed") unsearchablePdfs++;
    }
    return { docs: this.docs.size, notebooks, pdfs, unsearchablePdfs, tooLargePdfs };
  }

  private sortedVocab(): string[] {
    if (this.vocabDirty) {
      this.vocab = Array.from(this.postings.keys()).sort();
      this.vocabDirty = false;
    }
    return this.vocab;
  }

  /**
   * The live pages with `word` (`exact`), or with a word that starts with it.
   * A prefix that matches too many words keeps the most common ones.
   */
  pagesFor(word: string, exact: boolean): { ids: Set<number>; truncated: boolean } {
    const ids = new Set<number>();
    let truncated = false;
    const take = (term: string): void => {
      for (const id of this.postings.get(term) ?? []) {
        if (this.dead.has(id)) continue;
        if (ids.size >= MAX_PAGES_PER_WORD) {
          truncated = true;
          return;
        }
        ids.add(id);
      }
    };
    if (exact) {
      take(word);
    } else {
      const vocab = this.sortedVocab();
      const terms: string[] = [];
      for (let i = lowerBound(vocab, word); i < vocab.length && vocab[i].startsWith(word); i++) {
        terms.push(vocab[i]);
        if (terms.length >= MAX_PREFIX_EXPANSION) break;
      }
      if (terms.length > KEPT_PREFIX_EXPANSION) {
        terms.sort(
          (a, b) => (this.postings.get(b)?.length ?? 0) - (this.postings.get(a)?.length ?? 0),
        );
        terms.length = KEPT_PREFIX_EXPANSION;
        truncated = true;
      }
      for (const term of terms) {
        take(term);
        if (truncated && ids.size >= MAX_PAGES_PER_WORD) break;
      }
    }
    return { ids, truncated };
  }

  /**
   * The notes matching every word of `query`: a word of 3 letters or more
   * matches as a prefix, a shorter one only exactly; a PDF's pages count for
   * the notebooks that show them; a note whose title holds every word ranks
   * first. Best first; a query with no word of 3 letters is "too short".
   */
  match(query: string): MatchResult {
    const words = Array.from(new Set(tokenize(query)));
    const long = words.filter((word) => word.length >= MIN_QUERY_WORD_LENGTH);
    if (long.length === 0) return { groups: [], tooShort: true, truncated: false };
    const short = words.filter((word) => word.length < MIN_QUERY_WORD_LENGTH);
    let truncated = false;
    const sets: Set<number>[] = [];
    for (const word of long) {
      const found = this.pagesFor(word, false);
      if (!truncated) truncated = found.truncated;
      sets.push(found.ids);
    }
    for (const word of short) sets.push(this.pagesFor(word, true).ids);
    sets.sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = sets;
    const common: number[] = [];
    for (const id of smallest ?? []) {
      if (rest.every((set) => set.has(id))) common.push(id);
    }
    const groups = new Map<string, MatchGroup>();
    const groupOf = (path: string, kind: IndexedKind): MatchGroup => {
      let group = groups.get(path);
      if (!group) {
        group = { path, kind, pages: new Set(), sources: [], score: 0, titleMatch: false };
        groups.set(path, group);
      }
      return group;
    };
    for (const id of common) {
      const path = this.pageDoc[id];
      const doc = this.docs.get(path);
      if (!doc) continue;
      const page = this.pageNo[id];
      if (doc.kind === "pdf") {
        const uses = (this.pdfUsers.get(path) ?? []).filter((use) => use.pdfPage === page);
        if (uses.length === 0) {
          const group = groupOf(path, "pdf");
          group.pages.add(page + 1);
          group.sources.push({ doc: path, p: page });
          group.score += 1;
        }
        for (const use of uses) {
          const group = groupOf(use.nb, "notebook");
          group.pages.add(use.nbPage + 1);
          group.sources.push({ doc: path, p: page });
          group.score += 1;
        }
      } else {
        const group = groupOf(path, doc.kind);
        group.pages.add(page + 1);
        group.sources.push({ doc: path, p: page });
        group.score += doc.kind === "notebook" ? 2 : 1.5;
      }
    }
    for (const [path, doc] of this.docs) {
      if (doc.kind === "pdf" && this.pdfUsers.has(path)) continue;
      const title = tokenize(doc.title);
      const every = words.every((word) =>
        title.some((part) =>
          word.length >= MIN_QUERY_WORD_LENGTH ? part.startsWith(word) : part === word,
        ),
      );
      if (!every) continue;
      const group = groupOf(path, doc.kind);
      group.titleMatch = true;
      group.score += 10;
    }
    const ranked = Array.from(groups.values())
      .map((group) => ({ group, score: group.score + Math.min(group.pages.size, 10) * 0.2 }))
      .sort((a, b) => b.score - a.score);
    return {
      groups: ranked.slice(0, MAX_HITS),
      tooShort: false,
      truncated: truncated || groups.size > MAX_HITS,
    };
  }
}
