import { describe, expect, it } from "vitest";

import type { CharLm } from "../../src/recognition/hwr/char-lm";
import { beamDecode, mathLogp } from "../../src/recognition/hwr/ctc";

const LM = {
  codeOf: (c: string) => (c === "(" ? 1 : c === "a" ? 2 : -1),
  context: () => [],
  probIn: (_: unknown, code: number) => (code < 0 ? 1e-6 : 0.4),
} as unknown as CharLm;
const OPTIONS = { alpha: 1, beta: 0, beam: 8, topk: 4, prune: -100 };

describe("mathLogp", () => {
  const alphabet = ["1", "x", "a", "∫"];
  const logp = new Float32Array([-1, -2, -3, -4, -5, -6, -7, -8, -9, -10]);

  it("rewards signs most, x y f less, and nothing else", () => {
    expect(Array.from(mathLogp(logp, 2, alphabet))).toEqual([
      -1, 1, -1.5, -4, -2, -6, -4, -6.5, -9, -7,
    ]);
  });

  it("leaves the network's output alone", () => {
    mathLogp(logp, 2, alphabet);
    expect(logp[1]).toBe(-2);
  });
});

describe("symbols the language model never saw", () => {
  const read = (symbol: string) =>
    beamDecode(new Float32Array([-9, -1.5, -0.5]), 1, ["a", symbol], LM, OPTIONS);

  it("are scored as a bracket, so a clear one is read", () => {
    for (const s of ["∑", "∫", "≤", "≥", "√", "π"]) expect(read(s)).toBe(s);
  });

  it("stay as they were for every other character", () => {
    expect(read("~")).toBe("a");
  });
});
