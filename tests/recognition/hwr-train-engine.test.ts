/**
 * `src/recognition/hwr/train-engine.ts` (the SIMD trainer) against train.ts
 * (the reference, itself matched to PyTorch): the same losses, gradients and
 * Adam steps, on the golden network and on a random larger one.
 */

import { describe, expect, it } from "vitest";
import { TrainEngine } from "../../src/recognition/hwr/train-engine";
import {
  type TrainLine,
  type TrainNet,
  adamState,
  lineLossGrad,
  trainStep,
  zerosLike,
} from "../../src/recognition/hwr/train";

/** A deterministic random number generator in [0, 1). */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A random network: `layers` × `hidden`, 4 inputs, `classes` classes. */
function randomNet(layers: number, hidden: number, classes: number, seed: number): TrainNet {
  const r = rng(seed);
  const fill = (n: number, s = 0.4) => Float32Array.from({ length: n }, () => (r() - 0.5) * 2 * s);
  const G = 4 * hidden;
  const dir = (inputs: number) => ({
    inputs,
    wih: fill(G * inputs),
    whh: fill(G * hidden),
    bias: fill(G),
  });
  return {
    inputs: 4,
    hidden,
    classes,
    mean: fill(4, 0.1),
    std: Float32Array.from({ length: 4 }, () => 0.5 + r()),
    layers: Array.from({ length: layers }, (_, l) => {
      const n = l === 0 ? 4 : 2 * hidden;
      return [dir(n), dir(n)] as [ReturnType<typeof dir>, ReturnType<typeof dir>];
    }),
    out: fill(classes * 2 * hidden),
    outBias: fill(classes),
  };
}

function randomLines(count: number, classes: number, seed: number): TrainLine[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const frames = 10 + i * 7;
    return {
      features: Float32Array.from({ length: frames * 4 }, () => (r() - 0.5) * 3),
      frames,
      target: Array.from({ length: 2 + i }, () => 1 + Math.floor(r() * (classes - 1))),
    };
  });
}

function copyNet(n: TrainNet): TrainNet {
  const c = (a: Float32Array) => Float32Array.from(a);
  return {
    ...n,
    layers: n.layers.map(([f, b]) => [
      { inputs: f.inputs, wih: c(f.wih), whh: c(f.whh), bias: c(f.bias) },
      { inputs: b.inputs, wih: c(b.wih), whh: c(b.whh), bias: c(b.bias) },
    ]),
    out: c(n.out),
    outBias: c(n.outBias),
  };
}

function worst(a: TrainNet, b: TrainNet): number {
  let w = 0;
  const pairs: [Float32Array, Float32Array][] = [];
  a.layers.forEach(([fa, ba], l) => {
    const [fb, bb] = b.layers[l];
    pairs.push([fa.wih, fb.wih], [fa.whh, fb.whh], [fa.bias, fb.bias]);
    pairs.push([ba.wih, bb.wih], [ba.whh, bb.whh], [ba.bias, bb.bias]);
  });
  pairs.push([a.out, b.out], [a.outBias, b.outBias]);
  for (const [x, y] of pairs)
    for (let k = 0; k < x.length; k++) w = Math.max(w, Math.abs(x[k] - y[k]));
  return w;
}

const noDropout = { dropout: 0, random: () => 0.5 };

describe("the SIMD trainer matches the reference", () => {
  for (const [name, layers, hidden, classes] of [
    ["2x8", 2, 8, 6],
    ["3x16", 3, 16, 11],
  ] as const) {
    it(`${name}: losses and gradients`, () => {
      const net = randomNet(layers, hidden, classes, 11);
      const lines = randomLines(3, classes, 5);
      const engine = TrainEngine.create(copyNet(net), 64);
      expect(engine).not.toBeNull();
      const ref = zerosLike(net);
      engine!.zeroGrads();
      for (const line of lines) {
        const a = engine!.lineLossGrad(line, 1 / 3, noDropout);
        const b = lineLossGrad(net, line, ref, 1 / 3, noDropout);
        expect(a).toBeCloseTo(b, 4);
      }
      expect(worst(engine!.gradients(), ref)).toBeLessThan(2e-5);
    });

    it(`${name}: three Adam steps to the same weights`, () => {
      const net = randomNet(layers, hidden, classes, 13);
      const lines = randomLines(3, classes, 7);
      const engine = TrainEngine.create(copyNet(net), 64)!;
      const adam = adamState(net);
      const options = { ...noDropout, lr: 1e-2, clip: 5 };
      for (let s = 0; s < 3; s++) {
        expect(engine.step(lines, options)).toBeCloseTo(trainStep(net, adam, lines, options), 4);
      }
      expect(worst(engine.snapshot(), net)).toBeLessThan(5e-5);
    });
  }

  it("skips a line longer than its room", () => {
    const net = randomNet(1, 8, 6, 3);
    const engine = TrainEngine.create(net, 8)!;
    const [line] = randomLines(1, 6, 1); // 10 frames
    expect(engine.lineLossGrad(line, 1, noDropout)).toBe(0);
  });
});
