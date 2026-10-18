/**
 * Correcting what Grape read, one word at a time, and learning from it.
 *
 * After a page is read, each word Grape is unsure of (one that is not in
 * the word list, `flagWords`) is underlined on the ink. A tap on it gives
 * three answers, and each becomes a labelled word, ink and text, that
 * "Learn my handwriting" and the nightly loop train on:
 *
 * - **misread**: Grape read it wrong; the label is what the writer typed;
 * - **mistake**: the writer wrote it wrong; Grape read it right, so the
 *   label is the reading;
 * - **ignore**: a real word the list lacks (a name, course jargon); the
 *   label is the reading, and it is never underlined again.
 *
 * The ink is copied into the record, so a label outlives edits to its page.
 * Stored as `<plugin>/handwriting/corrections.json`.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { InkStroke } from "./features";
import type { PageLineReading } from "./recognizer";

export type CorrectionKind = "misread" | "mistake" | "ignore";

export const CORRECTION_KINDS: readonly CorrectionKind[] = ["misread", "mistake", "ignore"];

export interface CorrectionStroke {
  /** The stroke's id on its page when it was corrected. */
  id: string;
  /** x, y, pressure, … */
  pts: number[];
  /** ms from the page's first pen-down; null when unknown. */
  t0: number | null;
}

export interface Correction {
  kind: CorrectionKind;
  /** What Grape read. */
  read: string;
  /** What the word is: the writer's text for a misread, else the reading. */
  text: string;
  /** Vault path of the note, and the page's id in it. */
  note: string;
  page: string;
  strokes: CorrectionStroke[];
  /** ms since the epoch. */
  at: number;
}

export interface CorrectionsFile {
  version: 1;
  corrections: Correction[];
}

/** One word of a reading: its text and the strokes it is written with. */
export interface ReadWord {
  text: string;
  strokeIds: string[];
}

/** A word to underline, from `flagWords`. */
export type FlaggedWord = ReadWord;

/** Most characters a stored word may have: more is a line, not a word. */
const MAX_WORD = 64;

export function emptyCorrections(): CorrectionsFile {
  return { version: 1, corrections: [] };
}

/**
 * Read the corrections file, keeping every well-formed record and dropping
 * the rest: one bad record (a hand edit, a newer build) must not lose the
 * others.
 */
export function parseCorrections(raw: string | null): CorrectionsFile {
  const out = emptyCorrections();
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  const list = isRecord(data) && Array.isArray(data.corrections) ? data.corrections : [];
  for (const item of list) {
    const correction = readCorrection(item);
    if (correction) out.corrections.push(correction);
  }
  return out;
}

export function serializeCorrections(file: CorrectionsFile): string {
  return `${JSON.stringify(file, null, 1)}\n`;
}

function readCorrection(item: unknown): Correction | null {
  if (!isRecord(item)) return null;
  const { kind, read, text, note, page, strokes, at } = item;
  if (!(CORRECTION_KINDS as readonly unknown[]).includes(kind)) return null;
  if (typeof read !== "string" || typeof text !== "string") return null;
  if (typeof note !== "string" || typeof page !== "string") return null;
  const word = text.trim();
  if (!word || word.length > MAX_WORD || !Array.isArray(strokes)) return null;
  const ink: CorrectionStroke[] = [];
  for (const stroke of strokes) {
    if (!isRecord(stroke) || typeof stroke.id !== "string" || !Array.isArray(stroke.pts)) {
      return null;
    }
    const pts = stroke.pts as unknown[];
    // Whole points of finite numbers only: a ragged or poisoned array is no ink.
    if (pts.length === 0 || pts.length % 3 !== 0) return null;
    if (!pts.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    const t0 = typeof stroke.t0 === "number" && Number.isFinite(stroke.t0) ? stroke.t0 : null;
    ink.push({ id: stroke.id, pts: pts as number[], t0 });
  }
  if (ink.length === 0) return null;
  return {
    kind: kind as CorrectionKind,
    read,
    text: word,
    note,
    page,
    strokes: ink,
    at: typeof at === "number" && Number.isFinite(at) ? at : 0,
  };
}

/**
 * Add a correction. One for the same strokes on the same page replaces it,
 * so answering a word again changes the answer instead of doubling it.
 */
export function addCorrection(file: CorrectionsFile, correction: Correction): CorrectionsFile {
  const key = inkKey(correction);
  return {
    version: 1,
    corrections: [...file.corrections.filter((c) => inkKey(c) !== key), correction],
  };
}

function inkKey(c: Pick<Correction, "note" | "page" | "strokes">): string {
  return JSON.stringify([c.note, c.page, strokeKey(c.strokes.map((s) => s.id))]);
}

/** The labelled words to learn from: every answer, its ink and its text. */
export function correctionLines(
  file: CorrectionsFile,
): Array<{ strokes: InkStroke[]; text: string }> {
  return file.corrections.map((c) => ({
    strokes: c.strokes.map((s) => ({ pts: s.pts, t0: s.t0 })),
    text: c.text,
  }));
}

/**
 * Pair each line's words with their text: the reading's words, split on
 * spaces, against the word stroke groups the line was found with. A line
 * whose counts differ is skipped (the reader joined or split a word), so a
 * word is never tied to the wrong ink.
 */
export function readWords(lines: readonly PageLineReading[]): ReadWord[] {
  const out: ReadWord[] = [];
  for (const line of lines) {
    const texts = line.text.trim().split(/\s+/).filter(Boolean);
    if (texts.length === 0 || texts.length !== line.words.length) continue;
    texts.forEach((text, i) => out.push({ text, strokeIds: [...line.words[i]] }));
  }
  return out;
}

/**
 * A word as the word list holds it: lower case, without the punctuation
 * around it ("Hello," → "hello"); `null` for anything that is not a plain
 * word (digits, maths, a lone letter), which is never underlined.
 */
export function plainWord(text: string): string | null {
  const word = text
    .normalize("NFC")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .toLowerCase();
  if (word.length < 3) return null;
  // Letters, with an apostrophe or hyphen inside ("don't", "e-mail").
  return /^\p{L}+(?:['’-]\p{L}+)*$/u.test(word) ? word : null;
}

/** The words a list of corrections says to leave alone. */
export function ignoredWords(file: CorrectionsFile): Set<string> {
  const out = new Set<string>();
  for (const c of file.corrections) {
    if (c.kind === "misread") continue;
    // A word answered as right is right from then on, whatever its kind.
    const word = plainWord(c.text);
    if (word) out.add(word);
  }
  return out;
}

/**
 * The words to underline: plain words in neither the word list nor
 * `ignored`, and not already answered (`answered`: their stroke-id keys).
 */
export function flagWords(
  words: readonly ReadWord[],
  known: ReadonlySet<string>,
  ignored: ReadonlySet<string>,
  answered: ReadonlySet<string> = new Set(),
): FlaggedWord[] {
  return words.filter((w) => {
    const word = plainWord(w.text);
    if (!word || known.has(word) || ignored.has(word)) return false;
    return !answered.has(strokeKey(w.strokeIds));
  });
}

/** A word's ink as a key: its stroke ids, sorted. */
export function strokeKey(strokeIds: readonly string[]): string {
  return [...strokeIds].sort().join(",");
}

/** The stroke-id keys of a page's answered words. */
export function answeredOn(file: CorrectionsFile, note: string, page: string): Set<string> {
  return new Set(
    file.corrections
      .filter((c) => c.note === note && c.page === page)
      .map((c) => strokeKey(c.strokes.map((s) => s.id))),
  );
}

/** A word list file: one word a line, `#` comments; read as `plainWord`s. */
export function parseWordList(raw: string): Set<string> {
  const out = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const word = plainWord(text);
    if (word) out.add(word);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
