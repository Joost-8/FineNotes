/**
 * Searching text notes, alongside the notebooks Home searches: a text note
 * is one "page" to `searchLibrary` (`library-search.ts`), its typed text one
 * source and each handwriting section's reading another, read by the
 * device and so allowed to be a little off. Opening a hit, the note marks
 * every place it holds the query ({@link noteHits}).
 *
 * PURE: no DOM, no Obsidian.
 */

import { blockText, type TextNote } from "../model/text-note";
import { editDistance } from "./hit-strokes";
import { type LibraryHit, nearAllowance } from "./library-search";
import {
  type PageSource,
  type PageText,
  fold,
  holdsPhrase,
  matchText,
  queryTerms,
} from "./notebook-search";

/** A text note as search sees it: one page, its typed lines, then each section's reading. */
export function notePageText(note: TextNote): PageText {
  const sources: PageSource[] = [];
  const typed = note.blocks
    .filter((block) => block.type === "text")
    .map(blockText)
    .filter((line) => line.trim() !== "")
    .join("\n");
  if (typed) sources.push({ kind: "text", text: typed });
  for (const block of note.blocks) {
    if (block.type === "ink" && block.reading?.text) {
      sources.push({ kind: "handwriting", text: block.reading.text, guess: true });
    }
  }
  return { pageIndex: 0, sources };
}

/** Where a note holds the query: spans of typed lines, and the sections whose reading holds it. */
export interface NoteHits {
  text: Array<{ block: number; start: number; end: number }>;
  ink: number[];
}

/** Whether a reading holds `term`, as typed or a little off (as Home's search allows). */
function readingHolds(reading: string, term: string): boolean {
  const folded = fold(reading).text;
  if (folded.includes(term)) return true;
  const max = nearAllowance(term.length);
  if (max === 0) return false;
  for (const word of folded.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const head = word.length > term.length ? word.slice(0, term.length) : word;
    if (head.length >= term.length - max && editDistance(head, term, max) <= max) return true;
  }
  return false;
}

/**
 * Every place `note` holds `query`, in the note's order: as a phrase where
 * the note holds it as one, else word by word. A section counts when its
 * reading holds every word.
 */
export function noteHits(note: TextNote, query: string): NoteHits {
  const terms = queryTerms(query);
  const hits: NoteHits = { text: [], ink: [] };
  if (terms.length === 0) return hits;
  const phrase = holdsPhrase(notePageText(note), query);
  note.blocks.forEach((block, index) => {
    if (block.type === "text") {
      for (const span of matchText(blockText(block), query, phrase)) {
        hits.text.push({ block: index, ...span });
      }
    } else if (block.type === "ink" && block.reading?.text) {
      const text = block.reading.text;
      if (terms.every((term) => readingHolds(text, term))) hits.ink.push(index);
    }
  });
  return hits;
}

/** Hits with the note in use first, as found, then the rest in their order. */
export function currentFirst(hits: readonly LibraryHit[], current: string | null): LibraryHit[] {
  if (!current) return [...hits];
  return [...hits.filter((h) => h.path === current), ...hits.filter((h) => h.path !== current)];
}
