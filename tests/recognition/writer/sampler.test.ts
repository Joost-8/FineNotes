import { describe, expect, it } from "vitest";

import { ROW, type Reference } from "../../../src/recognition/writer/rows";
import {
  lineSeed,
  normals,
  textIds,
  writeLine,
  type Encoded,
  type Graphs,
  type WriterMeta,
} from "../../../src/recognition/writer/sampler";

interface FakeEnc extends Encoded {
  drop: boolean;
}

const REF = {
  x: new Float32Array(0),
  n: 0,
  cid: new Int32Array(0),
  k: new Int32Array(0),
  d: new Int32Array(0),
  sep: new Uint8Array(0),
} as Reference;

function metaWith(extra: Partial<WriterMeta> = {}): WriterMeta {
  return {
    chars: ["", "a", "b", "c"],
    mean: Array.from({ length: ROW }, (_, c) => c),
    std: Array.from({ length: ROW }, () => 2),
    maxDur: 4,
    refCurves: 10,
    steps: 2,
    sigma: 0,
    guidance: 2,
    lowGuidance: 0.5,
    lowMix: 0.25,
    hold: 6,
    refLines: 3,
    ...extra,
  };
}

interface Fake {
  graphs: Graphs<FakeEnc>;
  /** The summaries `durations` was given, in order. */
  durationG: number[][];
  velocityCalls: {
    x: Float32Array;
    tau: number;
    cid: number[];
    k: number[];
    d: number[];
    drop: boolean;
  }[];
}

/**
 * `rows(id, g0)`: rows a character gets for the first value of the summary.
 * `velocity(x, drop)`: the velocity of `x`.
 */
function fake(
  maxDur: number,
  rows: (id: number, g0: number, index: number) => number,
  velocity: (x: Float32Array, drop: boolean) => Float32Array,
): Fake {
  const out: Fake = { graphs: null as never, durationG: [], velocityCalls: [] };
  out.graphs = {
    async encode(_ref, drop) {
      return { g: Float32Array.from([drop ? 0 : 1, drop ? 0 : 1]), drop };
    },
    async durations(ids, g) {
      out.durationG.push([...g]);
      const logits = new Float32Array(ids.length * maxDur);
      ids.forEach((id, i) => {
        logits[i * maxDur + rows(id, g[0], i) - 1] = 5;
      });
      return logits;
    },
    async velocity(x, tau, cid, k, d, enc) {
      out.velocityCalls.push({
        x: Float32Array.from(x),
        tau,
        cid: [...cid],
        k: [...k],
        d: [...d],
        drop: enc.drop,
      });
      return velocity(x, enc.drop);
    },
  };
  return out;
}

const constant = (his: number, none: number) => (x: Float32Array, drop: boolean) =>
  new Float32Array(x.length).fill(drop ? none : his);
const zero = (x: Float32Array) => new Float32Array(x.length);

describe("textIds", () => {
  it("maps each character to its index in the model's list", () => {
    expect([...(textIds("abc", metaWith()) ?? [])]).toEqual([1, 2, 3]);
  });

  it("is null for a character the model lacks, and for the blank", () => {
    expect(textIds("abz", metaWith())).toBeNull();
    expect(textIds("", metaWith())?.length).toBe(0);
    expect(textIds("a\u0000", metaWith({ chars: ["\u0000", "a"] }))).toBeNull();
  });
});

describe("normals", () => {
  it("draws about mean 0 and sd 1 over 20k draws", () => {
    const draw = normals(42);
    const n = 20000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const v = draw();
      sum += v;
      sq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });

  it("repeats for a seed and differs between seeds", () => {
    const a = normals(1);
    const b = normals(1);
    const c = normals(2);
    const va = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(va);
    expect([c(), c(), c()]).not.toEqual(va);
  });
});

describe("lineSeed", () => {
  it("depends on both the try's seed and the line's number", () => {
    expect(lineSeed(1, 0)).not.toBe(lineSeed(2, 0));
    expect(lineSeed(1, 0)).not.toBe(lineSeed(1, 1));
    expect(lineSeed(1, 3)).toBe(lineSeed(1, 3));
  });
});

describe("writeLine", () => {
  it("throws for text the model cannot write", async () => {
    const f = fake(4, () => 1, zero);
    await expect(writeLine(f.graphs, metaWith(), "abz", REF, { seed: 0, id: 0 })).rejects.toThrow();
    await expect(writeLine(f.graphs, metaWith(), "", REF, { seed: 0, id: 0 })).rejects.toThrow();
  });

  it("gives each character the number of rows of its logits' argmax plus one, and tags rows with the character", async () => {
    const f = fake(4, (id) => id + 1, zero); // a 2 rows, b 3, c 4
    const out = await writeLine(f.graphs, metaWith(), "abc", REF, { seed: 0, id: 0 });
    expect(out.n).toBe(9);
    expect([...out.char]).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2]);
    expect(out.x.length).toBe(9 * ROW);
    // The model sees the same layout: ids, place in character, row count.
    const call = f.velocityCalls[0];
    expect(call.cid).toEqual([1, 1, 2, 2, 2, 3, 3, 3, 3]);
    expect(call.k).toEqual([0, 1, 0, 1, 2, 0, 1, 2, 3]);
    expect(call.d).toEqual([2, 2, 3, 3, 3, 4, 4, 4, 4]);
  });

  it("takes the row counts of low characters from the mixed summary", async () => {
    // With the writer's summary (g0 = 1) a character gets 3 rows; with the mix, 2.
    const f = fake(4, (_id, g0) => (g0 === 1 ? 3 : 2), zero);
    const out = await writeLine(f.graphs, metaWith({ lowMix: 0.25 }), "abc", REF, {
      seed: 0,
      id: 0,
      low: new Set([1]),
    });
    expect(f.durationG).toEqual([
      [1, 1],
      // lowMix * g_his + (1 - lowMix) * g_none, g_none = 0
      [0.25, 0.25],
    ]);
    expect([...out.char]).toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
  });

  it("asks the durations graph once when nothing is low", async () => {
    const f = fake(4, () => 2, zero);
    await writeLine(f.graphs, metaWith(), "ab", REF, { seed: 0, id: 0 });
    expect(f.durationG).toHaveLength(1);
  });

  it("mixes v_none + g * (v_his - v_none) per row, with the low guidance on low characters, and denormalises", async () => {
    // Every row of every character is 2 rows. v_his = 3, v_none = 1, x starts at 0 (sigma 0).
    const f = fake(4, () => 2, constant(3, 1));
    const meta = metaWith({ steps: 2, guidance: 2, lowGuidance: 0.5, lowMix: 1 });
    const out = await writeLine(f.graphs, meta, "ab", REF, { seed: 0, id: 0, low: new Set([1]) });
    // Normal rows: two steps of (1 + 2 * 2) / 2 = 2.5 each: 5 -> * std 2 + mean c.
    // Low rows:    two steps of (1 + 0.5 * 2) / 2 = 1 each: 2 -> * 2 + c.
    expect(out.x[0 * ROW + 0]).toBeCloseTo(10);
    expect(out.x[1 * ROW + 3]).toBeCloseTo(10 + 3);
    expect(out.x[2 * ROW + 0]).toBeCloseTo(4);
    expect(out.x[3 * ROW + 5]).toBeCloseTo(4 + 5);
    // Both graphs see the model's time: step / steps.
    expect(f.velocityCalls.map((c) => [c.tau, c.drop])).toEqual([
      [0, false],
      [0, true],
      [0.5, false],
      [0.5, true],
    ]);
  });

  it("thresholds the pen-up value to 0 or 1", async () => {
    for (const [mean, want] of [
      [0.4, 0],
      [0.6, 1],
      [-3, 0],
      [9, 1],
    ] as const) {
      const m = metaWith({
        mean: Array.from({ length: ROW }, (_, c) => (c === ROW - 1 ? mean : 0)),
      });
      const out = await writeLine(fake(4, () => 2, zero).graphs, m, "a", REF, { seed: 0, id: 0 });
      expect(out.x[ROW - 1]).toBe(want);
      expect(out.x[2 * ROW - 1]).toBe(want);
    }
  });

  describe("noise", () => {
    // Zero velocity, one step, sigma 1, std 1, mean 0: the output is the starting noise.
    const meta = metaWith({
      sigma: 1,
      steps: 1,
      mean: Array.from({ length: ROW }, () => 0),
      std: Array.from({ length: ROW }, () => 1),
    });
    const cols = (x: Float32Array, row: number): number[] =>
      Array.from(x.subarray(row * ROW, row * ROW + ROW - 1));

    it("repeats for the same seed and id, and changes with the id and the seed", async () => {
      const run = (seed: number, id: number) =>
        writeLine(fake(4, () => 2, zero).graphs, meta, "ab", REF, { seed, id }).then((w) => w.x);
      const a = await run(1, 1);
      expect(Array.from(await run(1, 1))).toEqual(Array.from(a));
      expect(Array.from(await run(1, 2))).not.toEqual(Array.from(a));
      expect(Array.from(await run(2, 1))).not.toEqual(Array.from(a));
      // The noise is not all zero.
      expect(cols(a, 0).some((v) => v !== 0)).toBe(true);
    });

    it("keeps a character's noise when only another character's row count changes", async () => {
      let aRows = 2;
      const f = fake(4, (id) => (id === 1 ? aRows : 3), zero);
      const first = await writeLine(f.graphs, meta, "ab", REF, { seed: 4, id: 9 });
      aRows = 4;
      const second = await writeLine(f.graphs, meta, "ab", REF, { seed: 4, id: 9 });
      expect(first.n).toBe(5);
      expect(second.n).toBe(7);
      // "b" is the last 3 rows in both.
      for (let r = 0; r < 3; r++) expect(cols(second.x, 4 + r)).toEqual(cols(first.x, 2 + r));
      // And "a"'s first rows are the same noise too.
      for (let r = 0; r < 2; r++) expect(cols(second.x, r)).toEqual(cols(first.x, r));
    });
  });
});
