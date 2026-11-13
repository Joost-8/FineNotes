/**
 * The ink of each word of a reading, from the network itself
 * (FineNotes#202). The reading's text is laid back over the frames it was
 * decoded from (the best CTC path, `forceAlign`), every frame knows its
 * stroke, and so every stroke goes to the word most of its frames fall in.
 *
 * Before this, a word's ink was a guess made beside the reading: the line's
 * strokes were cut at wide gaps, and the groups were handed to the words in
 * order when their counts happened to agree. A sum on the line read as no
 * word, or two words written close, moved every later word one group along
 * with the counts still equal.
 *
 * PURE: no DOM, no Obsidian.
 */

import { forceAlign } from "./lexicon";

/**
 * For each word of `text` (split on spaces, in order), the indices of the
 * strokes it was read from, in `frameStroke`'s numbering; a word no stroke
 * fell to has none. Null when the text cannot be laid over the frames (a
 * character the network has no class for, or too few frames).
 *
 * A frame belongs to the word of the nearest character on the path; between
 * two words the frame where the space was read is the border when there is
 * one. A stroke without frames of its own (or with the space's alone)
 * follows the stroke before it.
 */
export function wordInk(
  logp: Float32Array,
  frames: number,
  alphabet: readonly string[],
  text: string,
  frameStroke: ArrayLike<number>,
  strokes: number,
): number[][] | null {
  const C = alphabet.length + 1;
  const index = new Map<string, number>();
  alphabet.forEach((c, i) => index.set(c, i + 1));
  const ids: number[] = [];
  /** The word each character is in; -1 for a space. */
  const wordOf: number[] = [];
  let words = 0;
  let inWord = false;
  for (const ch of text) {
    const k = index.get(ch);
    if (k === undefined) return null;
    ids.push(k);
    const space = /\s/.test(ch);
    if (!space && !inWord) words++;
    inWord = !space;
    wordOf.push(space ? -1 : words - 1);
  }
  if (words === 0) return [];
  const pos = forceAlign(logp, frames, C, ids);
  if (!pos) return null;

  // Each frame's word: the word of the nearest character on the path.
  const frameWord = new Int32Array(frames).fill(-1);
  let from = -1;
  let fromWord = -1;
  for (let t = 0; t <= frames; t++) {
    const w = t < frames && pos[t] >= 0 ? wordOf[pos[t]] : -1;
    if (t < frames && w < 0) continue;
    // Frames from..t lie between two characters of words (or an end of the line).
    if (fromWord < 0) frameWord.fill(w, 0, t);
    else if (t === frames || w === fromWord) frameWord.fill(fromWord, from, t);
    else {
      // The frame the space was read on is the border, and no word's; with
      // no space read, the frames are halved.
      let cut = (from + t) / 2;
      let space = false;
      for (let u = from + 1; u < t && !space; u++) {
        if (pos[u] >= 0) {
          cut = u;
          space = true;
        }
      }
      for (let u = from; u < t; u++) {
        frameWord[u] = u < cut || (u === cut && !space) ? fromWord : u > cut ? w : -1;
      }
    }
    if (t < frames) frameWord[t] = w;
    from = t;
    fromWord = w;
  }

  const votes = Array.from({ length: strokes }, () => new Map<number, number>());
  for (let t = 0; t < frames; t++) {
    const s = frameStroke[t];
    const w = frameWord[t];
    if (s === undefined || s < 0 || s >= strokes || w < 0) continue;
    votes[s].set(w, (votes[s].get(w) ?? 0) + 1);
  }
  const out: number[][] = Array.from({ length: words }, () => []);
  let last = 0;
  for (let s = 0; s < strokes; s++) {
    let best = -1;
    let bestN = 0;
    for (const [w, n] of votes[s]) {
      if (n > bestN || (n === bestN && w < best)) {
        best = w;
        bestN = n;
      }
    }
    if (best < 0) best = last;
    out[best].push(s);
    last = best;
  }
  return out;
}
