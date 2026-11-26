/**
 * Words Beautify leaves in the writer's own ink instead of writing them.
 *
 * Beautify writes every word Grape read that was not asked about, and the
 * read-back only checks the model's writing against Grape's own reading, so a
 * misread word is rewritten as a different word. Measured on 1,022 labelled
 * words of donated handwriting: 26 % of one-character words and 37 % of words
 * with a sureness under 0.5 were wrong among those that would be written,
 * against 13.6 % overall (research/handwriting-rig/gen/neaten_ledger.mts with
 * neaten_tally.mjs, 2026-11-26). So a word keeps the writer's ink when it is
 *
 * - "exponent": read with a "^", which the model cannot raise (answered or not);
 * - "lone": one letter or digit at most;
 * - "unsure": Grape's sureness of it is under `WRITE_UNASKED_FROM`.
 *
 * A word the writer answered about is never kept for these reasons.
 *
 * PURE: no DOM, no Obsidian.
 */

/** A word the writer did not answer is written only when Grape's sureness of it (`wordSureness`) is at least this. */
export const WRITE_UNASKED_FROM = 0.5;

export type OwnInkReason = "exponent" | "lone" | "unsure";

/**
 * Whether a word is read with an exponent mark ("a^2"). The model writes along
 * one line and cannot raise anything: it wrote the mark like a 7. Of 48 such
 * words on donated handwriting the read-back refused 30 and 17 took a card
 * whose answer could not be written either.
 */
export function holdsExponent(text: string): boolean {
  return text.includes("^");
}

export interface OwnInkWord {
  text: string;
  sure: number;
  answered: boolean;
}

/** Whether a word has at most one letter or digit ("I", "5", "(a)"). */
export function isLone(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length <= 1;
}

/** Why a word keeps the writer's ink, or null when it may be written. */
export function ownInkReason(word: OwnInkWord): OwnInkReason | null {
  // Even when answered: no answer makes it writable.
  if (holdsExponent(word.text)) return "exponent";
  if (word.answered) return null;
  if (isLone(word.text)) return "lone";
  if (word.sure < WRITE_UNASKED_FROM) return "unsure";
  return null;
}

/** `rewrite` with every word that has a reason set false. */
export function keepOwnInk(words: readonly OwnInkWord[], rewrite: readonly boolean[]): boolean[] {
  return rewrite.map((r, i) => r && (!words[i] || ownInkReason(words[i]) === null));
}

/** A line as Beautify holds it, for `ownInkRewrite`. */
export interface OwnInkLine {
  read: readonly string[];
  sure: readonly number[];
  answered?: readonly boolean[];
  /** Words the writer answered on an earlier run (`applyAnswers`): never kept for these reasons. */
  known?: readonly boolean[];
  rewrite: readonly boolean[];
}

/** The line's `rewrite` with the words that keep the writer's ink set false. */
export function ownInkRewrite(line: OwnInkLine): boolean[] {
  const words = line.read.map((text, i) => ({
    text,
    sure: line.sure[i] ?? 0,
    answered: (line.known?.[i] ?? false) || (line.answered?.[i] ?? false),
  }));
  return keepOwnInk(words, line.rewrite);
}
