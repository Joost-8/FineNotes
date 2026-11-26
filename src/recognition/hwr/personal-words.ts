/**
 * The writer's own words: every word an answer about Grape's reading says
 * is a real word, joined to the word list (Joost, 2026-11-26: "imprinting"
 * a corrected word without training). One list then serves everything that
 * reads by it, so an answer given anywhere (a tapped underline, Correct,
 * Beautify's question before Dostoyev writes) counts everywhere:
 *
 * - the reread (`rereadOutOfList`) no longer turns the word into a list
 *   word (Resit → Debit, Acks → Acts), and can turn a misreading into it;
 * - the word is never underlined again, a corrected misread included;
 * - Beautify does not ask about it again, on any page.
 *
 * Measured on Joost's 188 answers, each word's ink read alone
 * (RESEARCH-LOG 2026-11-26, `lexicon/personal_list.mts`): the next time a
 * word is written, 74 → 96 of 188 read right, none worse.
 *
 * Which word an answer gives:
 * - misread: what the writer typed (the label);
 * - mistake with `meant`: the meant word, never the misspelling the ink
 *   holds, so a slip is still underlined the next time;
 * - mistake without `meant` ("It says …") and ignore: the reading, which
 *   the writer said is right.
 *
 * Pieces of a calculation note's sum are notation, not words: left out.
 * Only plain words (`plainWord`), as the list holds them.
 *
 * PURE: no DOM, no Obsidian.
 */

import { type Correction, type CorrectionsFile, plainWord } from "./corrections";

/** The word an answer adds to the writer's list; null when it adds none. */
export function answeredWord(
  c: Pick<Correction, "kind" | "text" | "meant" | "source">,
): string | null {
  if (c.source === "calc") return null;
  const word = (c.kind === "mistake" && c.meant ? c.meant : c.text).trim();
  // An answer of several words ("71 mod 7 =") is a line, not a word to learn.
  if (/\s/.test(word)) return null;
  return plainWord(word);
}

/** Every word the writer's answers add, lower case. */
export function personalWords(file: CorrectionsFile): Set<string> {
  const out = new Set<string>();
  for (const c of file.corrections) {
    const word = answeredWord(c);
    if (word) out.add(word);
  }
  return out;
}

/** The word list with the writer's words; `list` itself when they add nothing. */
export function withPersonal(
  list: ReadonlySet<string>,
  personal: ReadonlySet<string>,
): ReadonlySet<string> {
  let added = false;
  for (const w of personal) {
    if (!list.has(w)) {
      added = true;
      break;
    }
  }
  if (!added) return list;
  return new Set([...list, ...personal]);
}
