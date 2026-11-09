/**
 * `src/recognition/hwr/char-readings.ts`: each character Grape read, with
 * the strokes its frames came from, its confidence and its runner-ups, taken
 * from the per-frame log-probabilities the greedy decoder already reduced.
 * Synthetic frames, so every number is known.
 */

import { describe, expect, it } from "vitest";
import { charReadings } from "../../src/recognition/hwr/char-readings";
import { greedyDecode } from "../../src/recognition/hwr/ctc";

const ALPHABET = ["1", "2", "7", "z", "+"];
const C = ALPHABET.length + 1;

/** Frames from probability rows (blank first, then the alphabet), as log-probabilities. */
function logpOf(rows: number[][]): Float32Array {
  const out = new Float32Array(rows.length * C);
  rows.forEach((row, t) => {
    const sum = row.reduce((a, b) => a + b, 0);
    row.forEach((p, k) => {
      out[t * C + k] = Math.log(Math.max(p / sum, 1e-9));
    });
  });
  return out;
}

/** A frame sure of class `k` (0 = blank) with `p`, the rest spread over `others`. */
function frame(k: number, p: number, others: Record<number, number> = {}): number[] {
  const row = new Array<number>(C).fill(1e-6);
  row[k] = p;
  for (const [o, q] of Object.entries(others)) row[Number(o)] = q;
  return row;
}

describe("charReadings", () => {
  it("gives each character its strokes, confidence and runner-ups", () => {
    // "12": a sure 1 on stroke 0, a close-call 2 (z and 7 behind it) on strokes 1 and 2.
    const rows = [
      frame(1, 0.97, { 0: 0.03 }),
      frame(0, 0.9),
      frame(2, 0.55, { 4: 0.3, 3: 0.1, 0: 0.05 }),
      frame(2, 0.5, { 4: 0.2, 3: 0.25, 0: 0.05 }),
      frame(0, 0.95),
    ];
    const logp = logpOf(rows);
    const greedy = greedyDecode(logp, rows.length, ALPHABET);
    expect(greedy.text).toBe("12");
    const frameStroke = [0, 0, 1, 2, 2];
    // Writing order differs from the caller's: the caller passed them as [2, 0, 1].
    const order = [1, 2, 0];
    const chars = charReadings(
      logp,
      rows.length,
      ALPHABET,
      greedy.text,
      greedy.spans,
      frameStroke,
      order,
    );
    expect(chars.map((c) => c.char)).toEqual(["1", "2"]);
    expect(chars[0].strokes).toEqual([1]);
    expect(chars[1].strokes).toEqual([0, 2]);
    expect(chars[0].confidence).toBeCloseTo(0.97, 2);
    expect(chars[1].confidence).toBeCloseTo(0.55, 2);
    expect(chars[1].alternatives.map((a) => a.char)).toEqual(["z", "7"]);
    expect(chars[1].alternatives[0].p).toBeCloseTo(0.3, 2);
    // The character itself and blanks are never runner-ups.
    expect(chars[1].alternatives.some((a) => a.char === "2")).toBe(false);
  });

  it("offers at most three runner-ups, and none too unlikely", () => {
    const rows = [frame(5, 0.4, { 1: 0.2, 2: 0.15, 3: 0.12, 4: 0.1 }), frame(0, 0.99)];
    const logp = logpOf(rows);
    const greedy = greedyDecode(logp, rows.length, ALPHABET);
    const chars = charReadings(logp, rows.length, ALPHABET, greedy.text, greedy.spans, [0, 0], [0]);
    expect(chars[0].alternatives.map((a) => a.char)).toEqual(["1", "2", "7"]);
    const sure = logpOf([frame(1, 0.999), frame(0, 0.999)]);
    const g2 = greedyDecode(sure, 2, ALPHABET);
    expect(charReadings(sure, 2, ALPHABET, g2.text, g2.spans, [0, 0], [0])[0].alternatives).toEqual(
      [],
    );
  });

  it("gives nothing when the text and spans disagree", () => {
    const logp = logpOf([frame(1, 0.9)]);
    expect(charReadings(logp, 1, ALPHABET, "12", [[0, 0]], [0], [0])).toEqual([]);
  });
});
