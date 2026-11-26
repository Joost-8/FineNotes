/**
 * A page's reading with the writer's answers in it: a word answered as
 * misread shows what the writer typed, and one written wrong shows what
 * they meant (corrections.ts `shownAnswers`). What search finds and lights
 * up is this text, so a correction changes what the page says, not only
 * what Grape learns.
 *
 * A word is matched to its answer by its strokes (`strokeKey`), as the
 * underlines are. Only a line whose words pair one for one with its ink
 * groups can say which token is which word (as `readWords`); any other
 * line is left as it was read.
 *
 * PURE: no DOM, no Obsidian.
 */

import { strokeKey } from "./corrections";

/** A line of a reading: its text and each word's strokes, in order. */
export interface ReadLineWords {
  text: string;
  words: readonly (readonly string[])[];
}

/**
 * Each line's text with the answered words replaced; the same array of
 * texts when no answer applies. `shown`: what each answered word shows, by
 * its stroke key.
 */
export function answeredTexts(
  lines: readonly ReadLineWords[],
  shown: ReadonlyMap<string, string>,
): string[] {
  return lines.map((line) => {
    if (shown.size === 0) return line.text;
    const tokens = [...line.text.matchAll(/\S+/g)];
    if (tokens.length === 0 || tokens.length !== line.words.length) return line.text;
    let out = "";
    let from = 0;
    tokens.forEach((m, i) => {
      const answer = line.words[i].length > 0 ? shown.get(strokeKey(line.words[i])) : undefined;
      if (answer === undefined) return;
      const start = m.index ?? 0;
      out += line.text.slice(from, start) + answer;
      from = start + m[0].length;
    });
    return out + line.text.slice(from);
  });
}
