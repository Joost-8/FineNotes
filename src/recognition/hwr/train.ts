/**
 * Fine-tuning the recogniser to one writer: the training half of the
 * network (research/handwriting-rig/finetune_v2.py, ported). A float32 copy
 * of the int8 model is trained with the CTC loss, backpropagation through
 * time, gradient clipping at 5 and Adam at 3e-4, and quantised back to int8
 * per row (as export_hwr.py does) to be saved.
 *
 * PyTorch's conventions are kept, so a step here matches a step there
 * (tests/recognition/hwr-train.test.ts, golden numbers from
 * export_train_fixtures.py):
 * - the CTC loss of a line is divided by its label's length, then the
 *   batch's losses are averaged (`CTCLoss(reduction="mean")`), and a line
 *   the frames cannot spell costs 0 (`zero_infinity`);
 * - PyTorch keeps two bias vectors per LSTM direction (`bias_ih`,
 *   `bias_hh`), which get the same gradient and the same Adam step; the
 *   model here keeps their sum, so it moves by two steps, and both count
 *   in the gradient's norm;
 * - dropout between LSTM layers (0.25 in the recipe) masks each layer's
 *   output before the next, scaled by 1 / (1 − p).
 *
 * Each line is run on its own, not padded into a batch: a padded batch
 * feeds the backward direction of a short line some zero frames first,
 * which only the padding's length decides.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { LstmDirection, NetWeights } from "./bundle";

/** One direction of one LSTM layer, in float32. */
export interface TrainDirection {
  inputs: number;
  /** `4H × inputs`, gate order input, forget, cell, output. */
  wih: Float32Array;
  /** `4H × H`. */
  whh: Float32Array;
  /** `bias_ih + bias_hh`, `4H`. */
  bias: Float32Array;
}

/** The network as it trains: float32 weights. */
export interface TrainNet {
  inputs: number;
  hidden: number;
  classes: number;
  mean: Float32Array | null;
  std: Float32Array | null;
  /** Per layer: forward, then backward. */
  layers: [TrainDirection, TrainDirection][];
  /** `classes × 2H`. */
  out: Float32Array;
  outBias: Float32Array;
}

/** A gradient (or Adam moment) for every trained array, in the network's shape. */
export type TrainGrads = TrainNet;

/** A labelled line, ready to train on. */
export interface TrainLine {
  /** `frames × inputs`, as `lineFeatures` writes them (before standardisation). */
  features: Float32Array;
  frames: number;
  /** Class indices, 1 … classes − 1 (0 is the CTC blank). */
  target: number[];
}

export interface StepOptions {
  /** Dropout between LSTM layers; 0 to train without it. */
  dropout: number;
  /** A uniform random number in [0, 1). */
  random: () => number;
}

// --- Conversions -------------------------------------------------------------------

function dequantise(q: Int8Array, scale: Float32Array, n: number): Float32Array {
  const out = new Float32Array(q.length);
  for (let r = 0; r < scale.length; r++) {
    const s = scale[r];
    for (let j = 0; j < n; j++) out[r * n + j] = q[r * n + j] * s;
  }
  return out;
}

/** The float32 network a model's int8 weights stand for. */
export function trainNetFrom(net: NetWeights): TrainNet {
  const H = net.hidden;
  const dir = (d: LstmDirection): TrainDirection => ({
    inputs: d.inputs,
    wih: dequantise(d.wih, d.wihScale, d.inputs),
    whh: dequantise(d.whh, d.whhScale, H),
    bias: Float32Array.from(d.bias),
  });
  return {
    inputs: net.inputs,
    hidden: H,
    classes: net.classes,
    mean: net.mean ? Float32Array.from(net.mean) : null,
    std: net.std ? Float32Array.from(net.std) : null,
    layers: net.layers.map(([f, b]) => [dir(f), dir(b)]),
    out: dequantise(net.out, net.outScale, 2 * H),
    outBias: Float32Array.from(net.outBias),
  };
}

/**
 * Symmetric int8 per output row, as `export_hwr.quantise_rows`: the weight
 * is `q · scale`, `scale = max|row| / 127 + 1e-12`.
 */
export function quantiseRows(w: Float32Array, n: number): { q: Int8Array; scale: Float32Array } {
  const rows = w.length / n;
  const q = new Int8Array(w.length);
  const scale = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    let max = 0;
    for (let j = 0; j < n; j++) max = Math.max(max, Math.abs(w[r * n + j]));
    const s = Math.fround(Math.fround(max / 127) + 1e-12);
    scale[r] = s;
    for (let j = 0; j < n; j++) {
      q[r * n + j] = Math.max(-127, Math.min(127, Math.round(w[r * n + j] / s)));
    }
  }
  return { q, scale };
}

/** The int8 model a trained network quantises to. */
export function netWeightsFrom(net: TrainNet): NetWeights {
  const H = net.hidden;
  const dir = (d: TrainDirection): LstmDirection => {
    const ih = quantiseRows(d.wih, d.inputs);
    const hh = quantiseRows(d.whh, H);
    return {
      inputs: d.inputs,
      wih: ih.q,
      wihScale: ih.scale,
      whh: hh.q,
      whhScale: hh.scale,
      bias: Float32Array.from(d.bias),
    };
  };
  const out = quantiseRows(net.out, 2 * H);
  return {
    inputs: net.inputs,
    hidden: H,
    classes: net.classes,
    mean: net.mean ? Float32Array.from(net.mean) : null,
    std: net.std ? Float32Array.from(net.std) : null,
    layers: net.layers.map(([f, b]) => [dir(f), dir(b)]),
    out: out.q,
    outScale: out.scale,
    outBias: Float32Array.from(net.outBias),
  };
}

/** A zero gradient in the network's shape. */
export function zerosLike(net: TrainNet): TrainGrads {
  const z = (a: Float32Array): Float32Array => new Float32Array(a.length);
  return {
    ...net,
    layers: net.layers.map(([f, b]) => [
      { inputs: f.inputs, wih: z(f.wih), whh: z(f.whh), bias: z(f.bias) },
      { inputs: b.inputs, wih: z(b.wih), whh: z(b.whh), bias: z(b.bias) },
    ]),
    out: z(net.out),
    outBias: z(net.outBias),
  };
}

/** Every trained array of a network, in a fixed order (for Adam and the norm). */
function arrays(net: TrainNet): Float32Array[] {
  const out: Float32Array[] = [];
  for (const dirs of net.layers) for (const d of dirs) out.push(d.wih, d.whh, d.bias);
  out.push(net.out, net.outBias);
  return out;
}

/** Whether array `i` of `arrays` is a summed LSTM bias (two PyTorch parameters). */
function isBias(net: TrainNet, i: number): boolean {
  const lstm = net.layers.length * 2 * 3;
  return i < lstm && i % 3 === 2;
}

// --- Forward, keeping what the backward pass needs -----------------------------------

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** One direction's run over a line: the gates and states of every frame. */
interface DirRun {
  /** `frames × H` each, in frame order. */
  i: Float64Array;
  f: Float64Array;
  g: Float64Array;
  o: Float64Array;
  c: Float64Array;
  tanhC: Float64Array;
  h: Float64Array;
}

function runDirection(
  d: TrainDirection,
  x: Float32Array,
  frames: number,
  reverse: boolean,
  H: number,
): DirRun {
  const n = d.inputs;
  const G = 4 * H;
  const run: DirRun = {
    i: new Float64Array(frames * H),
    f: new Float64Array(frames * H),
    g: new Float64Array(frames * H),
    o: new Float64Array(frames * H),
    c: new Float64Array(frames * H),
    tanhC: new Float64Array(frames * H),
    h: new Float64Array(frames * H),
  };
  const z = new Float64Array(G);
  let prev = -1;
  for (let step = 0; step < frames; step++) {
    const t = reverse ? frames - 1 - step : step;
    for (let r = 0; r < G; r++) {
      let a = d.bias[r];
      const wo = r * n;
      for (let j = 0; j < n; j++) a += d.wih[wo + j] * x[t * n + j];
      if (prev >= 0) {
        const ho = r * H;
        for (let j = 0; j < H; j++) a += d.whh[ho + j] * run.h[prev * H + j];
      }
      z[r] = a;
    }
    for (let u = 0; u < H; u++) {
      const at = t * H + u;
      const ig = sigmoid(z[u]);
      const fg = sigmoid(z[H + u]);
      const gg = Math.tanh(z[2 * H + u]);
      const og = sigmoid(z[3 * H + u]);
      const cPrev = prev >= 0 ? run.c[prev * H + u] : 0;
      const c = fg * cPrev + ig * gg;
      const tc = Math.tanh(c);
      run.i[at] = ig;
      run.f[at] = fg;
      run.g[at] = gg;
      run.o[at] = og;
      run.c[at] = c;
      run.tanhC[at] = tc;
      run.h[at] = og * tc;
    }
    prev = t;
  }
  return run;
}

/** Everything one line's forward pass leaves for its backward pass. */
interface LineRun {
  frames: number;
  /** Each layer's input (after dropout), `frames × inputs`. */
  inputs: Float32Array[];
  /** Each layer's dropout mask on its input (null for layer 0, or without dropout). */
  masks: (Float32Array | null)[];
  dirs: [DirRun, DirRun][];
  /** The last layer's output, `frames × 2H`. */
  top: Float32Array;
  /** `frames × classes`. */
  logp: Float64Array;
}

function forward(net: TrainNet, line: TrainLine, options: StepOptions): LineRun {
  const { frames } = line;
  const H = net.hidden;
  const n0 = net.inputs;
  let x = new Float32Array(frames * n0);
  for (let t = 0; t < frames; t++) {
    for (let j = 0; j < n0; j++) {
      const v = line.features[t * n0 + j];
      x[t * n0 + j] = net.mean && net.std ? Math.fround(v - net.mean[j]) / net.std[j] : v;
    }
  }
  const inputs: Float32Array[] = [];
  const masks: (Float32Array | null)[] = [];
  const dirs: [DirRun, DirRun][] = [];
  net.layers.forEach(([fd, bd], l) => {
    let mask: Float32Array | null = null;
    if (l > 0 && options.dropout > 0) {
      const keep = 1 / (1 - options.dropout);
      mask = new Float32Array(x.length);
      for (let k = 0; k < x.length; k++) {
        mask[k] = options.random() < options.dropout ? 0 : keep;
        x[k] *= mask[k];
      }
    }
    inputs.push(x);
    masks.push(mask);
    const fr = runDirection(fd, x, frames, false, H);
    const br = runDirection(bd, x, frames, true, H);
    dirs.push([fr, br]);
    const y = new Float32Array(frames * 2 * H);
    for (let t = 0; t < frames; t++) {
      for (let u = 0; u < H; u++) {
        y[t * 2 * H + u] = fr.h[t * H + u];
        y[t * 2 * H + H + u] = br.h[t * H + u];
      }
    }
    x = y;
  });
  const C = net.classes;
  const n = 2 * H;
  const logp = new Float64Array(frames * C);
  const logits = new Float64Array(C);
  for (let t = 0; t < frames; t++) {
    let max = -Infinity;
    for (let k = 0; k < C; k++) {
      let a = net.outBias[k];
      for (let j = 0; j < n; j++) a += net.out[k * n + j] * x[t * n + j];
      logits[k] = a;
      if (a > max) max = a;
    }
    let sum = 0;
    for (let k = 0; k < C; k++) sum += Math.exp(logits[k] - max);
    const lse = max + Math.log(sum);
    for (let k = 0; k < C; k++) logp[t * C + k] = logits[k] - lse;
  }
  return { frames, inputs, masks, dirs, top: x, logp };
}

// --- CTC -------------------------------------------------------------------------------

function logAdd(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  return a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b));
}

/**
 * The CTC loss of one line (`−log p(target | logp)`), and its gradient with
 * respect to the logits before the log-softmax (`softmax − occupancy`), or
 * an infinite loss and no gradient when the frames cannot spell the target.
 */
export function ctcLossGrad(
  logp: Float64Array,
  frames: number,
  C: number,
  target: readonly number[],
): { loss: number; grad: Float64Array | null } {
  const S = 2 * target.length + 1;
  const label = (s: number): number => (s % 2 === 0 ? 0 : target[(s - 1) >> 1]);
  // α_t(s) with the emission at t; β_t(s) without it (what follows t).
  const alpha = new Float64Array(frames * S).fill(-Infinity);
  const beta = new Float64Array(frames * S).fill(-Infinity);
  const skip = (s: number): boolean => s >= 2 && label(s) !== 0 && label(s) !== label(s - 2);
  alpha[0] = logp[0];
  if (S > 1) alpha[1] = logp[label(1)];
  for (let t = 1; t < frames; t++) {
    for (let s = 0; s < S; s++) {
      let a = alpha[(t - 1) * S + s];
      if (s >= 1) a = logAdd(a, alpha[(t - 1) * S + s - 1]);
      if (skip(s)) a = logAdd(a, alpha[(t - 1) * S + s - 2]);
      alpha[t * S + s] = a === -Infinity ? a : a + logp[t * C + label(s)];
    }
  }
  const last = frames - 1;
  beta[last * S + S - 1] = 0;
  if (S > 1) beta[last * S + S - 2] = 0;
  for (let t = last - 1; t >= 0; t--) {
    for (let s = 0; s < S; s++) {
      const next = (s2: number): number => beta[(t + 1) * S + s2] + logp[(t + 1) * C + label(s2)];
      let b = next(s);
      if (s + 1 < S) b = logAdd(b, next(s + 1));
      if (s + 2 < S && skip(s + 2)) b = logAdd(b, next(s + 2));
      beta[t * S + s] = b;
    }
  }
  let logProb = alpha[last * S + S - 1];
  if (S > 1) logProb = logAdd(logProb, alpha[last * S + S - 2]);
  if (logProb === -Infinity) return { loss: Infinity, grad: null };
  const grad = new Float64Array(frames * C);
  for (let t = 0; t < frames; t++) {
    for (let k = 0; k < C; k++) grad[t * C + k] = Math.exp(logp[t * C + k]);
    for (let s = 0; s < S; s++) {
      const occ = alpha[t * S + s] + beta[t * S + s] - logProb;
      if (occ > -700) grad[t * C + label(s)] -= Math.exp(occ);
    }
  }
  return { loss: -logProb, grad };
}

// --- Backward ----------------------------------------------------------------------------

function backwardDirection(
  d: TrainDirection,
  g: TrainDirection,
  run: DirRun,
  x: Float32Array,
  dH: Float64Array,
  dX: Float64Array,
  frames: number,
  reverse: boolean,
  H: number,
): void {
  const n = d.inputs;
  const G = 4 * H;
  const dz = new Float64Array(G);
  let dhNext = new Float64Array(H);
  let dcNext = new Float64Array(H);
  for (let step = frames - 1; step >= 0; step--) {
    const t = reverse ? frames - 1 - step : step;
    const prevT = step > 0 ? (reverse ? t + 1 : t - 1) : -1;
    const dhPrev = new Float64Array(H);
    const dcPrev = new Float64Array(H);
    for (let u = 0; u < H; u++) {
      const at = t * H + u;
      const dh = dH[at] + dhNext[u];
      const o = run.o[at];
      const tc = run.tanhC[at];
      const dc = dh * o * (1 - tc * tc) + dcNext[u];
      const i = run.i[at];
      const f = run.f[at];
      const gg = run.g[at];
      const cPrev = prevT >= 0 ? run.c[prevT * H + u] : 0;
      dz[u] = dc * gg * i * (1 - i);
      dz[H + u] = dc * cPrev * f * (1 - f);
      dz[2 * H + u] = dc * i * (1 - gg * gg);
      dz[3 * H + u] = dh * tc * o * (1 - o);
      dcPrev[u] = dc * f;
    }
    for (let r = 0; r < G; r++) {
      const v = dz[r];
      if (v === 0) continue;
      g.bias[r] += v;
      const wo = r * n;
      for (let j = 0; j < n; j++) {
        g.wih[wo + j] += v * x[t * n + j];
        dX[t * n + j] += d.wih[wo + j] * v;
      }
      if (prevT >= 0) {
        const ho = r * H;
        for (let j = 0; j < H; j++) {
          g.whh[ho + j] += v * run.h[prevT * H + j];
          dhPrev[j] += d.whh[ho + j] * v;
        }
      }
    }
    dhNext = dhPrev;
    dcNext = dcPrev;
  }
}

/**
 * One line's loss (divided by its label's length) and its gradient, added
 * into `grads` with weight `weight`. Returns the loss; 0 for a line the
 * frames cannot spell (`zero_infinity`), which adds nothing.
 */
export function lineLossGrad(
  net: TrainNet,
  line: TrainLine,
  grads: TrainGrads,
  weight: number,
  options: StepOptions,
): number {
  const run = forward(net, line, options);
  const C = net.classes;
  const { loss, grad } = ctcLossGrad(run.logp, run.frames, C, line.target);
  if (!grad || !Number.isFinite(loss)) return 0;
  const scale = weight / line.target.length;
  const frames = run.frames;
  const H = net.hidden;
  const n = 2 * H;
  // The output layer.
  let dY = new Float64Array(frames * n);
  for (let t = 0; t < frames; t++) {
    for (let k = 0; k < C; k++) {
      const v = grad[t * C + k] * scale;
      if (v === 0) continue;
      grads.outBias[k] += v;
      const wo = k * n;
      for (let j = 0; j < n; j++) {
        grads.out[wo + j] += v * run.top[t * n + j];
        dY[t * n + j] += net.out[wo + j] * v;
      }
    }
  }
  // The LSTM layers, top down.
  for (let l = net.layers.length - 1; l >= 0; l--) {
    const [fd, bd] = net.layers[l];
    const [fg, bg] = grads.layers[l];
    const [fr, br] = run.dirs[l];
    const x = run.inputs[l];
    const dHf = new Float64Array(frames * H);
    const dHb = new Float64Array(frames * H);
    for (let t = 0; t < frames; t++) {
      for (let u = 0; u < H; u++) {
        dHf[t * H + u] = dY[t * n + u];
        dHb[t * H + u] = dY[t * n + H + u];
      }
    }
    const dX = new Float64Array(frames * fd.inputs);
    backwardDirection(fd, fg, fr, x, dHf, dX, frames, false, H);
    backwardDirection(bd, bg, br, x, dHb, dX, frames, true, H);
    const mask = run.masks[l];
    if (mask) for (let k = 0; k < dX.length; k++) dX[k] *= mask[k];
    dY = dX;
  }
  return loss * scale;
}

// --- Clipping and Adam ---------------------------------------------------------------------

/**
 * Scale the gradient so its norm is at most `max` (`clip_grad_norm_`): each
 * summed LSTM bias counts twice, as PyTorch's two copies do. Returns the
 * norm before clipping.
 */
export function clipGrads(net: TrainNet, grads: TrainGrads, max: number): number {
  let sq = 0;
  arrays(grads).forEach((a, i) => {
    const twice = isBias(net, i) ? 2 : 1;
    for (const v of a) sq += twice * v * v;
  });
  const norm = Math.sqrt(sq);
  const factor = max / (norm + 1e-6);
  if (factor < 1) for (const a of arrays(grads)) for (let k = 0; k < a.length; k++) a[k] *= factor;
  return norm;
}

/** Adam's state: the moments of every trained array, and the step count. */
export interface AdamState {
  m: TrainGrads;
  v: TrainGrads;
  step: number;
}

export function adamState(net: TrainNet): AdamState {
  return { m: zerosLike(net), v: zerosLike(net), step: 0 };
}

/**
 * One Adam step (β 0.9 and 0.999, ε 1e-8, PyTorch's form). A summed LSTM
 * bias moves by twice the step: its two PyTorch copies each take one.
 */
export function adamStep(
  net: TrainNet,
  grads: TrainGrads,
  state: AdamState,
  lr: number,
  beta1 = 0.9,
  beta2 = 0.999,
  eps = 1e-8,
): void {
  state.step += 1;
  const bc1 = 1 - beta1 ** state.step;
  const bc2 = 1 - beta2 ** state.step;
  const ps = arrays(net);
  const gs = arrays(grads);
  const ms = arrays(state.m);
  const vs = arrays(state.v);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const g = gs[i];
    const m = ms[i];
    const v = vs[i];
    const times = isBias(net, i) ? 2 : 1;
    for (let k = 0; k < p.length; k++) {
      m[k] = beta1 * m[k] + (1 - beta1) * g[k];
      v[k] = beta2 * v[k] + (1 - beta2) * g[k] * g[k];
      const denom = Math.sqrt(v[k]) / Math.sqrt(bc2) + eps;
      p[k] -= times * (lr / bc1) * (m[k] / denom);
    }
  }
}

/**
 * One training step on a batch: the mean of the lines' losses, clipped and
 * applied with Adam. Returns the batch's mean loss.
 */
export function trainStep(
  net: TrainNet,
  state: AdamState,
  batch: readonly TrainLine[],
  options: StepOptions & { lr: number; clip: number },
): number {
  const grads = zerosLike(net);
  let loss = 0;
  for (const line of batch) loss += lineLossGrad(net, line, grads, 1 / batch.length, options);
  clipGrads(net, grads, options.clip);
  adamStep(net, grads, state, options.lr);
  return loss;
}
