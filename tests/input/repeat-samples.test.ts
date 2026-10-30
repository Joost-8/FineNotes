import { describe, expect, it } from "vitest";
import { freshSamples, type RawSample } from "../../src/input/repeat-samples";

const at = (x: number, y: number, t: number, pressure = 0.5): RawSample => ({ x, y, pressure, t });

describe("freshSamples (FineNotes#85)", () => {
  const a = [
    at(366.9, 427.9, 10),
    at(367.8, 425.5, 12),
    at(368.7, 423.7, 14),
    at(369.3, 421.9, 16),
  ];
  const b = [at(370.2, 420.1, 18), at(371.1, 418.6, 20), at(372, 417.1, 22), at(373.2, 415.9, 24)];

  it("passes the first move whole", () => {
    expect(freshSamples(a, [])).toEqual(a);
  });

  it("drops a batch handed over twice, with its stamps or new ones", () => {
    expect(freshSamples(a, a)).toEqual([]);
    const restamped = a.map((s) => ({ ...s, t: s.t + 8 }));
    expect(freshSamples(restamped, a)).toEqual([]);
  });

  it("keeps a new batch, and the new part of one that overlaps the last", () => {
    expect(freshSamples(b, a)).toEqual(b);
    expect(freshSamples([...a.slice(2), ...b.slice(0, 2)], a)).toEqual(b.slice(0, 2));
  });

  it("drops samples stamped before the last move ended", () => {
    expect(freshSamples([at(1, 1, 15), at(2, 2, 16), at(3, 3, 17)], a)).toEqual([
      at(2, 2, 16),
      at(3, 3, 17),
    ]);
  });

  it("keeps a pen pressing harder where it stands", () => {
    const harder = at(369.3, 421.9, 18, 0.7);
    expect(freshSamples([harder], a)).toEqual([harder]);
  });

  it("returns the caller's own objects, in order", () => {
    const fresh = freshSamples(b, a);
    fresh.forEach((s, i) => expect(s).toBe(b[i]));
  });

  it("removes every repeat from the reporter's A A B B C C stream", () => {
    const c = b.map((s) => ({ ...s, x: s.x + 5, t: s.t + 8 }));
    let previous: RawSample[] = [];
    const kept: RawSample[] = [];
    for (const batch of [a, a, b, b, c, c]) {
      kept.push(...freshSamples(batch, previous));
      previous = batch;
    }
    expect(kept).toEqual([...a, ...b, ...c]);
  });
});
