import { describe, expect, it } from "vitest";

import {
  errorRate,
  neatenLine,
  opcodes,
  readBackRewrite,
  rejected,
  wordSpan,
  type Opcode,
} from "../../../src/recognition/writer/repair";
import type { Reference } from "../../../src/recognition/writer/rows";
import type { Written } from "../../../src/recognition/writer/sampler";

/**
 * Expected outputs of Python's
 * difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes(), run with
 * Python 3.13 on these inputs (2026-11-24).
 */
const PYTHON: { a: string[]; b: string[]; ops: Opcode[] }[] = [
  {
    a: ["the", "cat", "sat", "on", "the", "mat"],
    b: ["the", "cat", "sat", "on", "a", "mat"],
    ops: [
      ["equal", 0, 4, 0, 4],
      ["replace", 4, 5, 4, 5],
      ["equal", 5, 6, 5, 6],
    ],
  },
  {
    a: ["a", "b", "c", "d"],
    b: ["a", "c", "d"],
    ops: [
      ["equal", 0, 1, 0, 1],
      ["delete", 1, 2, 1, 1],
      ["equal", 2, 4, 1, 3],
    ],
  },
  {
    a: ["a", "b", "c"],
    b: ["a", "b", "c", "d", "e"],
    ops: [
      ["equal", 0, 3, 0, 3],
      ["insert", 3, 3, 3, 5],
    ],
  },
  { a: [], b: ["x", "y"], ops: [["insert", 0, 0, 0, 2]] },
  { a: ["x", "y"], b: [], ops: [["delete", 0, 2, 0, 0]] },
  { a: [], b: [], ops: [] },
  {
    a: ["a", "b", "a", "b", "a", "b"],
    b: ["b", "a", "b", "a"],
    ops: [
      ["delete", 0, 1, 0, 0],
      ["equal", 1, 5, 0, 4],
      ["delete", 5, 6, 4, 4],
    ],
  },
  {
    a: ["one", "two", "three"],
    b: ["three", "two", "one"],
    ops: [
      ["insert", 0, 0, 0, 2],
      ["equal", 0, 1, 2, 3],
      ["delete", 1, 3, 3, 3],
    ],
  },
  {
    a: ["k", "i", "t", "t", "e", "n"],
    b: ["s", "i", "t", "t", "i", "n", "g"],
    ops: [
      ["replace", 0, 1, 0, 1],
      ["equal", 1, 4, 1, 4],
      ["replace", 4, 5, 4, 5],
      ["equal", 5, 6, 5, 6],
      ["insert", 6, 6, 6, 7],
    ],
  },
  {
    a: ["a", "b", "c", "a", "b", "b", "a"],
    b: ["c", "b", "a", "b", "a", "c"],
    ops: [
      ["insert", 0, 0, 0, 2],
      ["equal", 0, 2, 2, 4],
      ["insert", 2, 2, 4, 5],
      ["equal", 2, 3, 5, 6],
      ["delete", 3, 7, 6, 6],
    ],
  },
  { a: ["h", "e", "l", "l", "o"], b: ["h", "e", "l", "l", "o"], ops: [["equal", 0, 5, 0, 5]] },
  {
    a: ["a", "a", "a", "a"],
    b: ["a", "a"],
    ops: [
      ["equal", 0, 2, 0, 2],
      ["delete", 2, 4, 2, 2],
    ],
  },
  {
    a: ["a", "b", "c", "d"],
    b: ["d", "c", "b", "a"],
    ops: [
      ["insert", 0, 0, 0, 3],
      ["equal", 0, 1, 3, 4],
      ["delete", 1, 4, 4, 4],
    ],
  },
  {
    a: ["we", "like", "to", "write", "neatly", "by", "hand"],
    b: ["we", "lke", "to", "wite", "neatly", "hand", "by"],
    ops: [
      ["equal", 0, 1, 0, 1],
      ["replace", 1, 2, 1, 2],
      ["equal", 2, 3, 2, 3],
      ["replace", 3, 4, 3, 4],
      ["equal", 4, 5, 4, 5],
      ["insert", 5, 5, 5, 6],
      ["equal", 5, 6, 6, 7],
      ["delete", 6, 7, 7, 7],
    ],
  },
  {
    a: ["x", "a", "x", "b", "x", "c", "x"],
    b: ["a", "b", "c"],
    ops: [
      ["delete", 0, 1, 0, 0],
      ["equal", 1, 2, 0, 1],
      ["delete", 2, 3, 1, 1],
      ["equal", 3, 4, 1, 2],
      ["delete", 4, 5, 2, 2],
      ["equal", 5, 6, 2, 3],
      ["delete", 6, 7, 3, 3],
    ],
  },
];

describe("opcodes", () => {
  it.each(PYTHON.map((c, i) => [i, c] as const))(
    "equals difflib's get_opcodes, case %i",
    (_i, c) => {
      expect(opcodes(c.a, c.b)).toEqual(c.ops);
    },
  );

  it("covers both sequences without gaps", () => {
    const a = [..."abracadabra"];
    const b = [..."avadakedavra"];
    const ops = opcodes(a, b);
    let i = 0;
    let j = 0;
    for (const [, a0, a1, b0, b1] of ops) {
      expect([a0, b0]).toEqual([i, j]);
      i = a1;
      j = b1;
    }
    expect([i, j]).toEqual([a.length, b.length]);
  });
});

describe("rejected", () => {
  it("gives a word read differently only its replaced or missing letters", () => {
    const out = rejected("the cat sat", "the cot sat");
    expect([...out.keys()]).toEqual([1]);
    // "cat" starts at 4; its "a" is at 5.
    expect([...(out.get(1) ?? [])]).toEqual([5]);
  });

  it("gives a word with nothing read in its place all its letters", () => {
    const out = rejected("the cat sat", "the sat");
    expect([...out.keys()]).toEqual([1]);
    expect([...(out.get(1) ?? [])].sort()).toEqual([4, 5, 6]);
  });

  it("is empty when the reading equals the text", () => {
    expect(rejected("the cat sat", "the cat sat").size).toBe(0);
    expect(rejected("the cat sat", "the   cat\nsat").size).toBe(0);
  });

  it("keeps only letters and digits among the marked ones", () => {
    const out = rejected("cat, dog", "cot dog");
    // "cat," against "cot": a replaced, "," deleted: only the letter counts.
    expect([...(out.get(0) ?? [])]).toEqual([1]);
  });

  it("falls back to every character of the word when only punctuation differs", () => {
    const out = rejected("cat, dog", "cat dog");
    expect([...(out.get(0) ?? [])].sort()).toEqual([0, 1, 2, 3]);
  });

  it("handles several rejected words in one replaced block", () => {
    const out = rejected("a b c", "x");
    expect([...out.entries()].map(([w, s]) => [w, [...s]])).toEqual([
      [0, [0]],
      [1, [2]],
      [2, [4]],
    ]);
  });
});

describe("readBackRewrite", () => {
  it("keeps the writer's ink for a word read back as another (Joost's iPad: simple written as single)", () => {
    expect(
      readBackRewrite("test again but simple", "test ag ain but single", [false, true, true, true]),
    ).toEqual([false, false, true, false]);
  });

  it("leaves every word rewritten when the line reads back right, and never rewrites a kept one", () => {
    expect(readBackRewrite("the new one", "the new one", [true, false, true])).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe("wordSpan", () => {
  it("is the positions of one word's characters in the text", () => {
    expect([...wordSpan("ab cde f", 1)]).toEqual([3, 4, 5]);
    expect([...wordSpan("ab cde f", 0)]).toEqual([0, 1]);
  });

  it("is empty for a word that is not there", () => {
    expect(wordSpan("ab", 4).size).toBe(0);
  });
});

describe("errorRate", () => {
  it("is the edit distance per character of the text", () => {
    expect(errorRate("abc", "abc")).toBe(0);
    expect(errorRate("abc", "abd")).toBeCloseTo(1 / 3);
    expect(errorRate("kitten", "sitting")).toBeCloseTo(3 / 6);
    expect(errorRate("abc", "")).toBe(1);
    expect(errorRate("", "")).toBe(0);
    expect(errorRate("", "x")).toBe(1);
  });
});

describe("neatenLine", () => {
  const ref = {} as Reference;
  const TEXT = "hello world";

  interface Call {
    seed: number;
    id: number;
    low: number[];
  }

  /** A fake writer whose every call is a number the fake reader maps to a reading. */
  function fakes(reads: (call: Call, n: number) => string) {
    const calls: Call[] = [];
    const readings = new Map<Written, string>();
    const write = async (
      _t: string,
      _r: Reference,
      seed: number,
      id: number,
      low: ReadonlySet<number>,
    ): Promise<Written> => {
      const call = { seed, id, low: [...low].sort((a, b) => a - b) };
      calls.push(call);
      const w: Written = { x: new Float32Array(0), n: calls.length, char: new Int32Array(0) };
      readings.set(w, reads(call, calls.length - 1));
      return w;
    };
    const read = async (w: Written): Promise<string> => readings.get(w) ?? "";
    return { calls, write, read };
  }

  it("keeps the try the reader reads best, using seeds seed * tries + s", async () => {
    const f = fakes((_c, n) => ["hello wrld", "hello world", "hellx world"][n]);
    const out = await neatenLine(TEXT, ref, 7, f.write, f.read, {
      seed: 2,
      tries: 3,
      repair: false,
    });
    expect(f.calls.map((c) => c.seed)).toEqual([6, 7, 8]);
    expect(f.calls.every((c) => c.id === 7)).toBe(true);
    expect(out?.seed).toBe(7);
    expect(out?.read).toBe("hello world");
    expect(out?.repairs).toEqual({ tried: 0, kept: 0 });
  });

  it("replaces the kept try only when another reads strictly better", async () => {
    const f = fakes((_c, n) => ["hello wrld", "hello wxld"][n] ?? "hello wxld");
    const out = await neatenLine(TEXT, ref, 0, f.write, f.read, {
      seed: 0,
      tries: 2,
      repair: false,
    });
    expect(out?.seed).toBe(0);
  });

  it("skips the repair rounds when repair is off, even for a rejected word", async () => {
    const f = fakes(() => "hello wrld");
    const out = await neatenLine(TEXT, ref, 0, f.write, f.read, {
      seed: 0,
      tries: 1,
      repair: false,
    });
    expect(f.calls).toHaveLength(1);
    expect(out?.read).toBe("hello wrld");
  });

  it("does not repair a line that reads right", async () => {
    const f = fakes(() => TEXT);
    const out = await neatenLine(TEXT, ref, 0, f.write, f.read, {
      seed: 0,
      tries: 1,
      repair: true,
    });
    expect(f.calls).toHaveLength(1);
    expect(out?.repairs).toEqual({ tried: 0, kept: 0 });
  });

  it("round 1 passes only the wrong letters as low, from the same try's seed", async () => {
    const f = fakes((_c, n) => (n === 0 ? "hello wrld" : TEXT));
    const out = await neatenLine(TEXT, ref, 3, f.write, f.read, {
      seed: 5,
      tries: 1,
      repair: true,
    });
    expect(f.calls).toHaveLength(2);
    // "world" starts at 6; its "o" (position 7) is the letter the reader dropped.
    expect(f.calls[1]).toEqual({ seed: 5, id: 3, low: [7] });
    expect(out?.read).toBe(TEXT);
    expect(out?.repairs).toEqual({ tried: 1, kept: 1 });
    expect(out?.seed).toBe(5);
  });

  it("round 2 rewrites whole rejected words when round 1 did not help", async () => {
    const f = fakes((_c, n) => (n < 2 ? "hello wrld" : TEXT));
    const out = await neatenLine(TEXT, ref, 0, f.write, f.read, {
      seed: 0,
      tries: 1,
      repair: true,
    });
    expect(f.calls.map((c) => c.low)).toEqual([[], [7], [6, 7, 8, 9, 10]]);
    expect(out?.read).toBe(TEXT);
    expect(out?.repairs).toEqual({ tried: 2, kept: 1 });
  });

  it("does not keep a rewrite that reads better but rejects a word that was read right before", async () => {
    // "world" was rejected; the rewrite fixes it but breaks "hello".
    const f = fakes((_c, n) => (n === 0 ? "hello wxxxx" : "hallo world"));
    const out = await neatenLine(TEXT, ref, 0, f.write, f.read, {
      seed: 0,
      tries: 1,
      repair: true,
    });
    expect(errorRate(TEXT, "hallo world")).toBeLessThan(errorRate(TEXT, "hello wxxxx"));
    expect(out?.read).toBe("hello wxxxx");
    expect(out?.repairs).toEqual({ tried: 2, kept: 0 });
  });

  it("does not keep a rewrite that reads no better", async () => {
    const f = fakes((_c, n) => (n === 0 ? "hello wrld" : "hello wrd"));
    const out = await neatenLine(TEXT, ref, 0, f.write, f.read, {
      seed: 0,
      tries: 1,
      repair: true,
    });
    expect(out?.read).toBe("hello wrld");
    expect(out?.repairs.kept).toBe(0);
  });

  it("gives null when stop() says so, before a try", async () => {
    const f = fakes(() => TEXT);
    const out = await neatenLine(TEXT, ref, 0, f.write, f.read, {
      seed: 0,
      tries: 3,
      repair: true,
      stop: () => true,
    });
    expect(out).toBeNull();
    expect(f.calls).toHaveLength(0);
  });

  it("gives null when stop() says so between the tries and the repair", async () => {
    const f = fakes(() => "hello wrld");
    let asked = 0;
    const out = await neatenLine(TEXT, ref, 0, f.write, f.read, {
      seed: 0,
      tries: 1,
      repair: true,
      stop: () => ++asked > 1,
    });
    expect(out).toBeNull();
    expect(f.calls).toHaveLength(1);
  });

  it("gives null for no tries", async () => {
    const f = fakes(() => TEXT);
    expect(
      await neatenLine(TEXT, ref, 0, f.write, f.read, { seed: 0, tries: 0, repair: true }),
    ).toBeNull();
  });
});
