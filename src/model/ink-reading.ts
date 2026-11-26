/**
 * Reading a text note's handwriting on the device, for search and for
 * "Turn into text": which section to read next, how a reading is kept on
 * its section, and a section turned into typed paragraphs.
 *
 * A section's reading is stored with it, in its `%%finenotes-ink` comment
 * (`text-note-file.ts`), with a hash of the strokes it was read from. Ink
 * written since makes the section be read again; until then the old
 * reading is still searched (new strokes rarely take a word away), and a
 * section whose ink has all gone loses its reading.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Stroke } from "./document";
import {
  textBlock,
  type IdSource,
  type InkBlock,
  type NoteEdit,
  type TextBlock,
  type TextNote,
} from "./text-note";

/** The strokes the recogniser reads: pen ink, not highlighter or snapped shapes (as a notebook's). */
export function readableStrokes(strokes: readonly Stroke[]): Stroke[] {
  return strokes.filter((stroke) => stroke.tool === "pen" && !stroke.shape);
}

/** A hash of the ink a reading depends on: the readable strokes' ids and points. */
export function inkReadingHash(strokes: readonly Stroke[]): string {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  for (const stroke of readableStrokes(strokes)) {
    mix(stroke.id.length);
    for (let i = 0; i < stroke.id.length; i++) mix(stroke.id.charCodeAt(i));
    mix(stroke.pts.length);
    for (const v of stroke.pts) mix(Math.round(v * 100));
  }
  return (h >>> 0).toString(36);
}

/** What to do next for a note's handwriting. */
export type SectionStep =
  /** Read this section (its ink hashes to `hash`). */
  | { kind: "read"; index: number; block: InkBlock; hash: string }
  /** This ink was read already in this session: keep that reading on the section. */
  | { kind: "keep"; index: number; block: InkBlock; hash: string; text: string }
  /** The section's ink has gone: its reading goes too. */
  | { kind: "clear"; index: number; block: InkBlock };

export interface SectionReadingState {
  note: TextNote;
  /** Readings made in this session, by ink hash (an undo brings old ink back). */
  known?: ReadonlyMap<string, string>;
  /** Ink not to read (it failed, or took the app down), by hash. */
  skip?: ReadonlySet<string>;
  /** A section to read before the others (the one written in last). */
  first?: string | null;
}

/** The next section to read, keep or clear; null when every reading is up to date. */
export function nextSectionStep(state: SectionReadingState): SectionStep | null {
  const { note, known, skip, first } = state;
  const order = note.blocks.map((_, i) => i);
  const firstIndex = first ? note.blocks.findIndex((b) => b.id === first) : -1;
  if (firstIndex > 0) {
    order.splice(firstIndex, 1);
    order.unshift(firstIndex);
  }
  for (const index of order) {
    const block = note.blocks[index];
    if (block.type !== "ink") continue;
    if (readableStrokes(block.strokes).length === 0) {
      if (block.reading) return { kind: "clear", index, block };
      continue;
    }
    const hash = inkReadingHash(block.strokes);
    if (block.reading?.of === hash) continue;
    const text = known?.get(hash);
    if (text !== undefined) return { kind: "keep", index, block, hash, text };
    if (skip?.has(hash)) continue;
    return { kind: "read", index, block, hash };
  }
  return null;
}

/** `block` with this reading (none: `null`); the same block when nothing changes. */
export function withReading(
  block: InkBlock,
  reading: { text: string; of: string } | null,
): InkBlock {
  if (!reading) {
    if (!block.reading) return block;
    const { reading: _gone, ...rest } = block;
    return rest;
  }
  const text = cleanReading(reading.text);
  if (block.reading?.text === text && block.reading.of === reading.of) return block;
  return { ...block, reading: { text, of: reading.of } };
}

/** A reading as it is kept: its lines trimmed, blank ones dropped. */
export function cleanReading(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** A reading's lines as typed paragraphs, one a line. */
export function readingParagraphs(text: string, newId: IdSource): TextBlock[] {
  const clean = cleanReading(text);
  if (!clean) return [];
  return clean.split("\n").map((line) => textBlock(newId(), "body", [{ text: line, marks: 0 }]));
}

/**
 * The handwriting section at `index` replaced by its reading as typed
 * paragraphs, the caret at the end of the last; null when it is not a
 * section or nothing was read in it.
 */
export function turnInkIntoText(
  note: TextNote,
  index: number,
  text: string,
  newId: IdSource,
): NoteEdit | null {
  const block = note.blocks[index];
  if (!block || block.type !== "ink") return null;
  const paragraphs = readingParagraphs(text, newId);
  if (paragraphs.length === 0) return null;
  const blocks = note.blocks.slice();
  blocks.splice(index, 1, ...paragraphs);
  const last = paragraphs[paragraphs.length - 1];
  const length = last.runs.reduce((n, run) => n + run.text.length, 0);
  return {
    note: { blocks },
    caret: { block: index + paragraphs.length - 1, offset: length },
  };
}
