/**
 * The on-device recogniser (src/recognition/hwr/) against its Python
 * reference, on synthetic data: ink drawn by a script, a random 2x8 BLSTM
 * and an LM on made-up sentences (tests/recognition/fixtures/hwr-golden.json,
 * from research/handwriting-rig/export_port_fixtures.py --public). The real
 * model and Joost's ink are checked by hwr-real.test.ts where they exist.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forward, simdAvailable } from "../../src/recognition/hwr/blstm";
import { HwrFormatError, parseBundle } from "../../src/recognition/hwr/bundle";
import { BOS } from "../../src/recognition/hwr/char-lm";
import { DEFAULT_BEAM, beamDecode, greedyDecode } from "../../src/recognition/hwr/ctc";
import { lineFeatures, robustLine, writingOrder } from "../../src/recognition/hwr/features";
import { autoWordGap, segmentPage } from "../../src/recognition/hwr/lines";
import {
  fitLine,
  interp,
  linspace,
  median,
  npMean,
  npSum,
  percentileSorted,
  sorted,
} from "../../src/recognition/hwr/numeric";
import { readLine, readPage } from "../../src/recognition/hwr/recognizer";
import { type GoldenLine, type GoldenPage, checkLine, checkPage } from "./hwr-golden";

interface Golden {
  bundle: string;
  bundleMin2: string;
  lmQueries: { hist: string; c: string; p: number; pMin2: number; pFull: number }[];
  numeric: {
    a: number[];
    sum: number;
    mean: number;
    median: number;
    percentiles: Record<string, number>;
    xp: number[];
    fp: number[];
    x: number[];
    interp: number[];
    stop: number;
    linspace: number[];
  }[];
  robustLine: { x: number[]; y: number[]; line: [number, number] }[];
  lines: GoldenLine[];
  pages: GoldenPage[];
}

const golden = JSON.parse(
  readFileSync("tests/recognition/fixtures/hwr-golden.json", "utf8"),
) as Golden;
const bytes = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));
const bundle = parseBundle(bytes(golden.bundle));
const bundleMin2 = parseBundle(bytes(golden.bundleMin2));

describe("numpy's arithmetic", () => {
  it("sums, means, medians and percentiles exactly as numpy", () => {
    for (const c of golden.numeric) {
      expect(npSum(c.a)).toBe(c.sum);
      expect(npMean(c.a)).toBe(c.mean);
      expect(median(c.a)).toBe(c.median);
      const s = sorted(c.a);
      for (const [q, v] of Object.entries(c.percentiles))
        expect(percentileSorted(s, Number(q))).toBe(v);
    }
  });

  it("interpolates and spaces points exactly as numpy", () => {
    for (const c of golden.numeric) {
      expect(Array.from(interp(c.x, c.xp, c.fp))).toEqual(c.interp);
      expect(Array.from(linspace(0, c.stop, c.linspace.length))).toEqual(c.linspace);
    }
  });

  it("handles the edges numpy handles", () => {
    expect(Array.from(linspace(2, 5, 1))).toEqual([2]);
    expect(Array.from(interp([0, 1, 2], [1], [7]))).toEqual([7, 7, 7]);
    // Out of order x still finds each value's anchor.
    expect(Array.from(interp([0.75, 0.25], [0, 0.5, 1], [0, 10, 20]))).toEqual([15, 5]);
    expect(Number.isNaN(median([]))).toBe(true);
    expect(fitLine([0, 1, 2, 3], [1, 3, 5, 7])).toEqual([2, 1]);
  });

  it("fits the baseline as the reference's robust line", () => {
    for (const c of golden.robustLine) {
      const [a, b] = robustLine(c.x, c.y);
      expect(a).toBeCloseTo(c.line[0], 9);
      expect(b).toBeCloseTo(c.line[1], 9);
    }
  });
});

describe("the recogniser file", () => {
  it("describes the network, the decoder and the LM", () => {
    expect(bundle.meta.net).toMatchObject({ inputs: 4, hidden: 8, layers: 2, standardize: true });
    expect(bundle.meta.net.classes).toBe(bundle.meta.alphabet.length + 1);
    expect(bundle.net.layers).toHaveLength(2);
    expect(bundle.net.layers[1][0].inputs).toBe(16);
    expect(bundle.meta.decoder).toMatchObject({ alpha: 0.3, beta: 0, beam: 16, topk: 8 });
    expect(bundle.lm?.order).toBe(6);
    expect(bundle.lm?.chars[0]).toBe(BOS);
  });

  it("reads a copy at any byte offset", () => {
    const raw = bytes(golden.bundle);
    const shifted = new Uint8Array(raw.length + 3);
    shifted.set(raw, 3);
    const again = parseBundle(shifted.subarray(3));
    expect(Array.from(again.net.outScale)).toEqual(Array.from(bundle.net.outScale));
    expect(parseBundle(new Uint8Array(raw).buffer).meta.name).toBe(bundle.meta.name);
  });

  it("refuses what it cannot read", () => {
    const raw = bytes(golden.bundle);
    const broken = (edit: (b: Uint8Array, v: DataView) => void, size = raw.length): Uint8Array => {
      const b = new Uint8Array(size);
      b.set(raw.subarray(0, size));
      edit(b, new DataView(b.buffer));
      return b;
    };
    expect(() => parseBundle(new Uint8Array(4))).toThrow(HwrFormatError);
    expect(() => parseBundle(broken((b) => (b[0] = 0)))).toThrow(/no FNHW header/);
    expect(() => parseBundle(broken((_, v) => v.setUint32(4, 2, true)))).toThrow(/version 2/);
    expect(() => parseBundle(broken((_, v) => v.setUint32(8, 1e7, true)))).toThrow(
      /inside its header/,
    );
    expect(() => parseBundle(broken(() => undefined, raw.length - 40))).toThrow(HwrFormatError);
    // A model trained on other features is refused, not run wrongly.
    const metaLength = new DataView(raw.buffer, raw.byteOffset).getUint32(8, true);
    const header = new TextDecoder().decode(raw.subarray(12, 12 + metaLength));
    const swapped = new TextEncoder().encode(header.replace("scale=core", "scale=full"));
    expect(swapped.length).toBe(metaLength);
    expect(() => parseBundle(broken((b) => b.set(swapped, 12)))).toThrow(/core scaling only/);
    expect(() => parseBundle(broken(() => undefined, 12 + metaLength))).toThrow(/no network/);
  });
});

describe("the character LM", () => {
  it("gives the reference's probabilities, unpruned and pruned", () => {
    const lm = bundle.lm;
    const lm2 = bundleMin2.lm;
    expect(lm).not.toBeNull();
    expect(lm2).not.toBeNull();
    for (const q of golden.lmQueries) {
      expect(lm?.prob(q.hist, q.c)).toBe(q.p);
      expect(lm?.prob(q.hist, q.c)).toBe(q.pFull);
      expect(lm2?.prob(q.hist, q.c)).toBe(q.pMin2);
    }
    expect(lm?.codeOf("w")).toBe(-1);
  });
});

describe("one line", () => {
  for (const line of golden.lines) {
    it(`matches the reference: ${line.name}`, () => {
      const { logpDiff } = checkLine(bundle, line, 1e-5);
      expect(logpDiff).toBeLessThan(1e-5);
    });
  }

  it("puts strokes in writing order: by time, else left to right", () => {
    const a = { pts: [5, 0, 0.5], t0: 20 };
    const b = { pts: [1, 0, 0.5], t0: 10 };
    const c = { pts: [3, 0, 0.5] };
    expect(writingOrder([a, b])).toEqual([b, a]);
    expect(writingOrder([a, b, c])).toEqual([b, c, a]);
    expect(() => lineFeatures([{ pts: [] }])).toThrow(/at least one stroke/);
  });

  it("reads a line end to end, with and without the LM", () => {
    const line = golden.lines.find((l) => l.name === "long") as GoldenLine;
    const ticks = [0, 4, 9, 15, 22];
    const clock = (): number => ticks.shift() ?? 30;
    const read = readLine(bundle, line.strokes, { now: clock });
    expect(read.greedy).toBe(line.greedy.text);
    expect(read.text).toBe(line.beam[0].text);
    expect(read.frames).toBe(line.frames);
    expect(read.timings).toEqual({ features: 4, network: 5, greedy: 6, beam: 7 });
    expect(readLine(bundle, line.strokes, { useLm: false }).text).toBe(line.greedy.text);
    const plain = line.beam.find(
      (b) => !b.lm && b.beam === DEFAULT_BEAM.beam,
    ) as GoldenLine["beam"][0];
    const logp = forward(bundle.net, lineFeatures(line.strokes).features, line.frames);
    expect(beamDecode(logp, line.frames, bundle.meta.alphabet, null)).toBe(plain.text);
  });

  it("runs the network with WebAssembly SIMD here, and without it on request", () => {
    expect(simdAvailable(bundle.net)).toBe(true);
    const line = golden.lines[0];
    const features = lineFeatures(line.strokes).features;
    const simd = forward(bundle.net, features, line.frames);
    const plain = forward(bundle.net, features, line.frames, { simd: false });
    let worst = 0;
    for (let i = 0; i < simd.length; i++) worst = Math.max(worst, Math.abs(simd[i] - plain[i]));
    expect(worst).toBeLessThan(1e-5);
    // A longer line than any before grows the kernel's memory.
    const long = new Float32Array(20000 * 4).map((_, i) => (i % 4 === 3 ? 0 : Math.sin(i) * 0.05));
    expect(forward(bundle.net, long, 20000)).toHaveLength(20000 * bundle.net.classes);
  });

  it("reads nothing from no frames", () => {
    expect(forward(bundle.net, new Float32Array(0), 0)).toHaveLength(0);
    expect(greedyDecode(new Float32Array(0), 0, ["a"])).toEqual({
      text: "",
      spans: [],
      confidence: 0,
    });
    expect(beamDecode(new Float32Array(0), 0, ["a"], null)).toBe("");
  });
});

describe("a page", () => {
  for (const page of golden.pages) {
    it(`finds the reference's lines and reads them: ${page.name}`, () => {
      checkPage(bundle, page);
    });
  }

  it("has no lines without writing", () => {
    const shape = { id: "s1", tool: "pen", shape: "rect", pts: [0, 0, 0.5, 10, 10, 0.5] };
    const marker = { id: "s2", tool: "highlighter", pts: [0, 0, 0.5, 10, 0, 0.5] };
    const rule = { id: "s3", tool: "pen", pts: [0, 0, 0.5, 500, 0.5, 0.5] };
    expect(segmentPage([shape, marker]).lines).toEqual([]);
    expect(segmentPage([rule, { ...rule, id: "s4" }]).lines).toEqual([]);
    expect(readPage(bundle, [shape]).lines).toEqual([]);
  });

  it("keeps the default word gap when a page has few gaps", () => {
    expect(autoWordGap([0.2, 0.3, 2])).toBe(1);
    expect(autoWordGap([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])).toBeCloseTo(0.6, 12);
  });
});
