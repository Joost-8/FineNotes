import { describe, expect, it } from "vitest";
import { wordInk } from "../../src/recognition/hwr/word-ink";

const ALPHABET = ["a", "b", " ", "c", "2", "+", "="];
const C = ALPHABET.length + 1;

/**
 * Log-probabilities whose best class per frame spells `path` ("_" a blank),
 * and the stroke each frame came from.
 */
function line(path: string, strokeOf: number[]): { logp: Float32Array; frames: number } {
  const frames = path.length;
  expect(strokeOf).toHaveLength(frames);
  const logp = new Float32Array(frames * C).fill(Math.log(0.004));
  [...path].forEach((ch, t) => {
    const k = ch === "_" ? 0 : ALPHABET.indexOf(ch) + 1;
    logp[t * C + k] = Math.log(0.97);
  });
  return { logp, frames };
}

describe("wordInk", () => {
  it("gives each word the strokes its characters were read from", () => {
    //            a  _  b  _  ' ' _  c  _
    const from = [0, 0, 1, 1, 2, 2, 2, 3];
    const { logp, frames } = line("a_b_ _c_", from);
    expect(wordInk(logp, frames, ALPHABET, "ab c", from, 4)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("splits where the space was read, not where the ink has its widest gap", () => {
    // Two words written close together and a sum before them: gap cutting
    // found [2+2=] [ab c], one group short, and so shifted every word.
    //            2  +  2  =  ' ' a  b  ' ' c  _
    const from = [0, 1, 2, 3, 4, 4, 5, 6, 6, 6];
    const { logp, frames } = line("2+2= ab c_", from);
    expect(wordInk(logp, frames, ALPHABET, "2+2= ab c", from, 7)).toEqual([
      [0, 1, 2, 3],
      [4, 5],
      [6],
    ]);
  });

  it("halves the frames between two words when no space was read", () => {
    //            a  _  _  _  _  c
    const from = [0, 0, 1, 2, 3, 3];
    const { logp, frames } = line("a____c", from);
    // "a c" still fits: the space is laid on one of the blank frames.
    const words = wordInk(logp, frames, ALPHABET, "a c", from, 4);
    expect(words?.flat().sort()).toEqual([0, 1, 2, 3]);
    expect(words?.[0]).toContain(0);
    expect(words?.[1]).toContain(3);
  });

  it("lets a stroke without frames follow the stroke before it", () => {
    const from = [0, 0, 2, 2];
    const { logp, frames } = line("a_ c", from);
    expect(wordInk(logp, frames, ALPHABET, "a c", from, 3)).toEqual([[0, 1], [2]]);
  });

  it("leaves a word no stroke fell to empty, and keeps the count of words", () => {
    //            a  b  ' ' c
    const from = [0, 0, 0, 0];
    const { logp, frames } = line("ab c", from);
    expect(wordInk(logp, frames, ALPHABET, "ab c", from, 1)).toEqual([[0], []]);
  });

  it("says so when the text cannot be laid over the frames", () => {
    const from = [0, 0];
    const { logp, frames } = line("a_", from);
    expect(wordInk(logp, frames, ALPHABET, "a?", from, 1)).toBeNull();
    expect(wordInk(logp, frames, ALPHABET, "abcabc", from, 1)).toBeNull();
    expect(wordInk(logp, frames, ALPHABET, "  ", from, 1)).toEqual([]);
  });
});
