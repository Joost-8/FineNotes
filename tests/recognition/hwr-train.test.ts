/**
 * `src/recognition/hwr/train.ts` against PyTorch: a random 2×8 BLSTM-CTC and
 * made-up lines (tests/recognition/fixtures/hwr-train-golden.json, from
 * research/handwriting-rig/export_train_fixtures.py). Log-probabilities,
 * the CTC loss, every gradient and two clipped Adam steps must match.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type TrainLine,
  type TrainNet,
  adamState,
  clipGrads,
  ctcLossGrad,
  lineLossGrad,
  netWeightsFrom,
  quantiseRows,
  trainNetFrom,
  trainStep,
  zerosLike,
} from "../../src/recognition/hwr/train";

interface DirJson {
  wih: number[];
  whh: number[];
  bias: number[];
}
type ParamsJson = Record<string, DirJson> & { out: number[]; outBias: number[] };

const G = JSON.parse(readFileSync("tests/recognition/fixtures/hwr-train-golden.json", "utf8")) as {
  inputs: number;
  hidden: number;
  layers: number;
  classes: number;
  lr: number;
  clip: number;
  mean: number[];
  std: number[];
  initial: ParamsJson;
  lines: { frames: number; features: number[]; target: number[] }[];
  logp0: number[];
  loss: number;
  lineLosses: number[];
  grads: ParamsJson;
  gradNorm: number;
  afterStep1: ParamsJson;
  loss2: number;
  afterStep2: ParamsJson;
};

function netFrom(p: ParamsJson): TrainNet {
  const dir = (k: string, inputs: number) => ({
    inputs,
    wih: Float32Array.from(p[k].wih),
    whh: Float32Array.from(p[k].whh),
    bias: Float32Array.from(p[k].bias),
  });
  return {
    inputs: G.inputs,
    hidden: G.hidden,
    classes: G.classes,
    mean: Float32Array.from(G.mean),
    std: Float32Array.from(G.std),
    layers: Array.from({ length: G.layers }, (_, l) => {
      const n = l === 0 ? G.inputs : 2 * G.hidden;
      return [dir(`l${l}d0`, n), dir(`l${l}d1`, n)] as [
        ReturnType<typeof dir>,
        ReturnType<typeof dir>,
      ];
    }),
    out: Float32Array.from(p.out),
    outBias: Float32Array.from(p.outBias),
  };
}

const lines: TrainLine[] = G.lines.map((l) => ({
  features: Float32Array.from(l.features),
  frames: l.frames,
  target: l.target,
}));

const noDropout = { dropout: 0, random: () => 0.5 };

/** Every array of a network, flattened in a fixed order, with names. */
function flat(net: TrainNet): [string, Float32Array][] {
  const out: [string, Float32Array][] = [];
  net.layers.forEach(([f, b], l) => {
    for (const [d, dir] of [
      [0, f],
      [1, b],
    ] as const) {
      out.push(
        [`l${l}d${d}.wih`, dir.wih],
        [`l${l}d${d}.whh`, dir.whh],
        [`l${l}d${d}.bias`, dir.bias],
      );
    }
  });
  out.push(["out", net.out], ["outBias", net.outBias]);
  return out;
}

function expectClose(actual: TrainNet, expected: TrainNet, tolerance: number): void {
  const want = new Map(flat(expected));
  for (const [name, a] of flat(actual)) {
    const e = want.get(name)!;
    let worst = 0;
    for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - e[k]));
    expect(worst, name).toBeLessThan(tolerance);
  }
}

describe("the training step matches PyTorch", () => {
  it("computes each line's CTC loss (divided by its label's length)", () => {
    const net = netFrom(G.initial);
    lines.forEach((line, i) => {
      const loss = lineLossGrad(net, line, zerosLike(net), 1, noDropout);
      expect(loss, `line ${i}`).toBeCloseTo(G.lineLosses[i], 4);
    });
  });

  it("costs nothing for a line its frames cannot spell (zero_infinity)", () => {
    const net = netFrom(G.initial);
    const grads = zerosLike(net);
    expect(lineLossGrad(net, lines[3], grads, 1, noDropout)).toBe(0);
    expect(flat(grads).every(([, a]) => a.every((v) => v === 0))).toBe(true);
  });

  it("computes every gradient of the batch's mean loss", () => {
    const net = netFrom(G.initial);
    const grads = zerosLike(net);
    let loss = 0;
    for (const line of lines) loss += lineLossGrad(net, line, grads, 1 / lines.length, noDropout);
    expect(loss).toBeCloseTo(G.loss, 4);
    expectClose(grads, netFrom(G.grads), 2e-5);
    expect(clipGrads(net, grads, G.clip)).toBeCloseTo(G.gradNorm, 4);
  });

  it("takes two clipped Adam steps to the same weights", () => {
    const net = netFrom(G.initial);
    const adam = adamState(net);
    const options = { ...noDropout, lr: G.lr, clip: G.clip };
    expect(trainStep(net, adam, lines, options)).toBeCloseTo(G.loss, 4);
    expectClose(net, netFrom(G.afterStep1), 2e-5);
    expect(trainStep(net, adam, lines, options)).toBeCloseTo(G.loss2, 4);
    expectClose(net, netFrom(G.afterStep2), 4e-5);
  });
});

describe("pieces", () => {
  it("CTC: a single-frame blank line, and an impossible one", () => {
    const logp = Float64Array.from([Math.log(0.6), Math.log(0.4)]);
    const blank = ctcLossGrad(logp, 1, 2, []);
    expect(blank.loss).toBeCloseTo(-Math.log(0.6), 10);
    // Gradient: softmax − occupancy; the blank holds all of it.
    expect(blank.grad?.[0]).toBeCloseTo(0.6 - 1, 10);
    expect(blank.grad?.[1]).toBeCloseTo(0.4, 10);
    expect(ctcLossGrad(logp, 1, 2, [1, 1]).loss).toBe(Infinity);
  });

  it("clipping scales a gradient over the limit down to it, counting each bias twice", () => {
    const net = netFrom(G.initial);
    const grads = zerosLike(net);
    grads.out[0] = 3;
    grads.layers[0][0].bias[0] = 4 / Math.SQRT2; // counts twice: 8 in the square sum
    const norm = clipGrads(net, grads, 1);
    expect(norm).toBeCloseTo(Math.sqrt(9 + 16), 5);
    expect(grads.out[0]).toBeCloseTo(3 / 5, 5);
  });

  it("dropout masks the layers' inputs and still gives a finite gradient", () => {
    const net = netFrom(G.initial);
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const grads = zerosLike(net);
    const loss = lineLossGrad(net, lines[0], grads, 1, { dropout: 0.25, random });
    expect(Number.isFinite(loss)).toBe(true);
    expect(flat(grads).every(([, a]) => a.every(Number.isFinite))).toBe(true);
  });

  it("quantises per row as export_hwr does, and round-trips a network through int8", () => {
    const { q, scale } = quantiseRows(Float32Array.from([0.5, -1, 0.25, 2, 0, -2]), 3);
    expect([...q]).toEqual([64, -127, 32, 127, 0, -127]);
    expect(scale[1]).toBeCloseTo(2 / 127, 7);
    const net = netFrom(G.initial);
    const back = trainNetFrom(netWeightsFrom(net));
    expectClose(back, net, 0.02);
  });
});
