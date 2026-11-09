/**
 * Each character Grape read, with the strokes it came from, how sure Grape
 * was of it, and its runner-up guesses (FineNotes#178: a doubtful character
 * in a calculation note offers "2 · z · 7").
 *
 * Nothing here changes the model or what it reads: it looks again at the
 * network's per-frame log-probabilities, which the greedy decoder already
 * reduced to one best class per frame. A character's frames are the ones
 * where it was the best class (`GreedyResult.spans`); the frames' strokes come
 * from the feature step (`frameStroke`, or `curveStroke` for a model that
 * reads curves).
 *
 * PURE: no DOM, no Obsidian.
 */

/** One character as read, aligned with the greedy text. */
export interface CharReading {
  char: string;
  /** Indices into the strokes the line was read from (the caller's order). */
  strokes: number[];
  /** Its highest probability over its own frames. */
  confidence: number;
  /** Other characters the same frames could have been, most likely first. */
  alternatives: Array<{ char: string; p: number }>;
}

/** Runner-ups at least this likely are offered. */
const ALTERNATIVE_MIN_P = 0.005;
/** How many runner-ups a character offers. */
const ALTERNATIVES = 3;

/**
 * The characters of a greedy reading. `spans[i]` is the frames of the i-th
 * character of `text`; `frameStroke[t]` the index, in `order`, of the stroke
 * frame `t` came from; `order[j]` the index in the caller's strokes of the
 * j-th stroke in writing order. A runner-up is scored by its best
 * probability over the character's frames and the frame either side (CTC
 * puts a character on one or two frames, between blanks).
 */
export function charReadings(
  logp: Float32Array,
  frames: number,
  alphabet: readonly string[],
  text: string,
  spans: readonly (readonly [number, number])[],
  frameStroke: ArrayLike<number>,
  order: readonly number[],
): CharReading[] {
  const C = alphabet.length + 1;
  const chars = Array.from(text);
  // The greedy text holds one entry per span; a character outside the BMP
  // would split in two code units, but the alphabet has none.
  if (chars.length !== spans.length) return [];
  return chars.map((char, i) => {
    const [a, b] = spans[i];
    const own = alphabet.indexOf(char) + 1;
    let confidence = 0;
    const strokes = new Set<number>();
    for (let t = a; t <= b && t < frames; t++) {
      confidence = Math.max(confidence, Math.exp(logp[t * C + own]));
      const s = frameStroke[t];
      if (s !== undefined && s >= 0 && s < order.length) strokes.add(order[s]);
    }
    const best = new Float64Array(C);
    for (let t = Math.max(0, a - 1); t <= Math.min(frames - 1, b + 1); t++) {
      for (let k = 1; k < C; k++) best[k] = Math.max(best[k], Math.exp(logp[t * C + k]));
    }
    const alternatives: Array<{ char: string; p: number }> = [];
    for (let k = 1; k < C; k++) {
      if (k === own || best[k] < ALTERNATIVE_MIN_P) continue;
      alternatives.push({ char: alphabet[k - 1], p: best[k] });
    }
    alternatives.sort((x, y) => y.p - x.p);
    return {
      char,
      strokes: [...strokes].sort((x, y) => x - y),
      confidence,
      alternatives: alternatives.slice(0, ALTERNATIVES),
    };
  });
}
