/**
 * The network's forward pass: a stack of bidirectional LSTMs (PyTorch's
 * `nn.LSTM(bidirectional=True)`, gate order input, forget, cell, output),
 * a linear layer and a log-softmax, on int8 weights with one float scale per
 * row. The port of `htr.BLSTM.__call__`.
 *
 * Each direction runs in two passes: every frame's input projection at once
 * (no dependency between frames), then the recurrence, which is sequential.
 * Two kernels compute it: WebAssembly SIMD (simd.ts; float32 throughout, as
 * numpy) where it runs, else plain JavaScript (float64 sums, float32 between
 * layers). Both stay within ~3e-5 of the reference's log-probabilities.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { LstmDirection, NetWeights } from "./bundle";
import { type SimdKernel, simdKernel } from "./simd";

/** `1 / (1 + e^-x)`, clipped at ±60 as the reference. */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(x < -60 ? 60 : x > 60 ? -60 : -x));
}

/**
 * `pre[t, r] = bias[r] + scale[r] · Σ_j wih[r, j] · x[t, j]` for every frame:
 * four rows at a time, so each input value is read once per four rows.
 */
export function project(
  x: Float32Array,
  frames: number,
  d: LstmDirection,
  pre: Float32Array,
): void {
  const n = d.inputs;
  const G = d.bias.length;
  const w = d.wih;
  const scale = d.wihScale;
  const bias = d.bias;
  for (let t = 0; t < frames; t++) {
    const xo = t * n;
    const po = t * G;
    let r = 0;
    for (; r + 3 < G; r += 4) {
      const w0 = r * n;
      const w1 = w0 + n;
      const w2 = w1 + n;
      const w3 = w2 + n;
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let a3 = 0;
      for (let j = 0; j < n; j++) {
        const v = x[xo + j];
        a0 += w[w0 + j] * v;
        a1 += w[w1 + j] * v;
        a2 += w[w2 + j] * v;
        a3 += w[w3 + j] * v;
      }
      pre[po + r] = bias[r] + scale[r] * a0;
      pre[po + r + 1] = bias[r + 1] + scale[r + 1] * a1;
      pre[po + r + 2] = bias[r + 2] + scale[r + 2] * a2;
      pre[po + r + 3] = bias[r + 3] + scale[r + 3] * a3;
    }
    for (; r < G; r++) {
      let a = 0;
      for (let j = 0; j < n; j++) a += w[r * n + j] * x[xo + j];
      pre[po + r] = bias[r] + scale[r] * a;
    }
  }
}

/**
 * The recurrence of one direction over projected inputs `pre`; writes each
 * frame's hidden state to `out[t · stride + offset …]`.
 */
export function recur(
  pre: Float32Array,
  frames: number,
  d: LstmDirection,
  reverse: boolean,
  out: Float32Array,
  offset: number,
  stride: number,
): void {
  const G = d.bias.length;
  const H = G >> 2;
  const w = d.whh;
  const scale = d.whhScale;
  const h = new Float64Array(H);
  const c = new Float64Array(H);
  const z = new Float64Array(G);
  for (let step = 0; step < frames; step++) {
    const t = reverse ? frames - 1 - step : step;
    const po = t * G;
    let r = 0;
    for (; r + 3 < G; r += 4) {
      const w0 = r * H;
      const w1 = w0 + H;
      const w2 = w1 + H;
      const w3 = w2 + H;
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let a3 = 0;
      for (let j = 0; j < H; j++) {
        const v = h[j];
        a0 += w[w0 + j] * v;
        a1 += w[w1 + j] * v;
        a2 += w[w2 + j] * v;
        a3 += w[w3 + j] * v;
      }
      z[r] = pre[po + r] + scale[r] * a0;
      z[r + 1] = pre[po + r + 1] + scale[r + 1] * a1;
      z[r + 2] = pre[po + r + 2] + scale[r + 2] * a2;
      z[r + 3] = pre[po + r + 3] + scale[r + 3] * a3;
    }
    for (; r < G; r++) {
      let a = 0;
      for (let j = 0; j < H; j++) a += w[r * H + j] * h[j];
      z[r] = pre[po + r] + scale[r] * a;
    }
    const oo = t * stride + offset;
    for (let u = 0; u < H; u++) {
      const cu = sigmoid(z[H + u]) * c[u] + sigmoid(z[u]) * Math.tanh(z[2 * H + u]);
      c[u] = cu;
      const hu = sigmoid(z[3 * H + u]) * Math.tanh(cu);
      h[u] = hu;
      out[oo + u] = hu;
    }
  }
}

/** Per-channel standardisation, in float32 as the reference. */
function standardize(net: NetWeights, features: Float32Array, frames: number): Float32Array {
  const n = net.inputs;
  const x = new Float32Array(frames * n);
  const { mean, std } = net;
  for (let t = 0; t < frames; t++) {
    for (let j = 0; j < n; j++) {
      const v = features[t * n + j];
      x[t * n + j] = mean && std ? Math.fround(v - mean[j]) / std[j] : v;
    }
  }
  return x;
}

/** The linear layer and log-softmax: `frames × classes` log-probabilities. */
function classify(net: NetWeights, x: Float32Array, frames: number): Float32Array {
  const n = 2 * net.hidden;
  const C = net.classes;
  const w = net.out;
  const out = new Float32Array(frames * C);
  const logits = new Float64Array(C);
  for (let t = 0; t < frames; t++) {
    const xo = t * n;
    let max = -Infinity;
    for (let k = 0; k < C; k++) {
      const wo = k * n;
      let a = 0;
      for (let j = 0; j < n; j++) a += w[wo + j] * x[xo + j];
      const l = net.outBias[k] + net.outScale[k] * a;
      logits[k] = l;
      if (l > max) max = l;
    }
    let sum = 0;
    for (let k = 0; k < C; k++) sum += Math.exp(logits[k] - max);
    const lse = Math.log(sum);
    for (let k = 0; k < C; k++) out[t * C + k] = logits[k] - max - lse;
  }
  return out;
}

/** `frames × classes` log-probabilities from the linear layer's output rows (stride `Cp`). */
function logSoftmax(
  logits: Float32Array,
  at: number,
  frames: number,
  C: number,
  Cp: number,
): Float32Array {
  const out = new Float32Array(frames * C);
  for (let t = 0; t < frames; t++) {
    const o = at + t * Cp;
    let max = -Infinity;
    for (let k = 0; k < C; k++) if (logits[o + k] > max) max = logits[o + k];
    let sum = 0;
    for (let k = 0; k < C; k++) sum += Math.exp(logits[o + k] - max);
    const lse = Math.log(sum);
    for (let k = 0; k < C; k++) out[t * C + k] = logits[o + k] - max - lse;
  }
  return out;
}

/** The plain JavaScript forward pass (int8 weights, float64 sums). */
function forwardJs(net: NetWeights, features: Float32Array, frames: number): Float32Array {
  const H = net.hidden;
  let x = standardize(net, features, frames);
  const pre = new Float32Array(frames * 4 * H);
  for (const [fwd, bwd] of net.layers) {
    const y = new Float32Array(frames * 2 * H);
    project(x, frames, fwd, pre);
    recur(pre, frames, fwd, false, y, 0, 2 * H);
    project(x, frames, bwd, pre);
    recur(pre, frames, bwd, true, y, H, 2 * H);
    x = y;
  }
  return classify(net, x, frames);
}

/** A network laid out in a SIMD kernel's memory: de-quantised float32 weights, byte offsets. */
interface SimdNet {
  kernel: SimdKernel;
  /** Per layer, forward then backward: where its weights and bias start. */
  layers: { wih: number; whh: number; bias: number; inputs: number }[][];
  out: number;
  outBias: number;
  /** Classes rounded up to the kernel's four rows. */
  classesPadded: number;
  /** The first byte after the weights. */
  free: number;
}

const simdNets = new WeakMap<NetWeights, SimdNet | null>();

/** Copy `q · scale[row]` (rows × n) to `f` at float index `at`; rows past `q` stay 0. */
function dequantise(
  f: Float32Array,
  at: number,
  q: Int8Array,
  scale: Float32Array,
  n: number,
): void {
  for (let r = 0; r < scale.length; r++) {
    const s = scale[r];
    for (let j = 0; j < n; j++) f[at + r * n + j] = q[r * n + j] * s;
  }
}

/** The network in a SIMD kernel, laid out once per model; null where SIMD cannot run it. */
function simdNet(net: NetWeights): SimdNet | null {
  if (simdNets.has(net)) return simdNets.get(net) ?? null;
  const H = net.hidden;
  const G = 4 * H;
  const Cp = Math.ceil(net.classes / 4) * 4;
  let made: SimdNet | null = null;
  if (H % 4 === 0 && net.inputs % 4 === 0) {
    let floats = 0;
    for (const dirs of net.layers) for (const d of dirs) floats += G * d.inputs + G * H + G;
    floats += Cp * 2 * H + Cp;
    const kernel = simdKernel(floats * 4 + (1 << 20));
    if (kernel) {
      const f = new Float32Array(kernel.memory.buffer);
      let at = 0;
      const layers = net.layers.map((dirs) =>
        dirs.map((d) => {
          const wih = at;
          dequantise(f, at, d.wih, d.wihScale, d.inputs);
          at += G * d.inputs;
          const whh = at;
          dequantise(f, at, d.whh, d.whhScale, H);
          at += G * H;
          const bias = at;
          f.set(d.bias, at);
          at += G;
          return { wih: wih * 4, whh: whh * 4, bias: bias * 4, inputs: d.inputs };
        }),
      );
      const out = at;
      dequantise(f, at, net.out, net.outScale, 2 * H);
      at += Cp * 2 * H;
      const outBias = at;
      f.set(net.outBias, at);
      at += Cp;
      made = {
        kernel,
        layers,
        out: out * 4,
        outBias: outBias * 4,
        classesPadded: Cp,
        free: at * 4,
      };
    }
  }
  simdNets.set(net, made);
  return made;
}

/** Whether this runtime runs the network with WebAssembly SIMD. */
export function simdAvailable(net: NetWeights): boolean {
  return simdNet(net) !== null;
}

/** The forward pass with the SIMD kernels: the sums and the gates. */
function forwardSimd(
  s: SimdNet,
  net: NetWeights,
  features: Float32Array,
  frames: number,
): Float32Array {
  const H = net.hidden;
  const G = 4 * H;
  const n0 = net.inputs;
  const Cp = s.classesPadded;
  // Activations after the weights, in floats: two layer buffers, the
  // projections, one step's gates, the hidden and cell states, the logits.
  const width = Math.max(n0, 2 * H);
  const A = s.free / 4;
  const B = A + frames * width;
  const PRE = B + frames * width;
  const Z = PRE + frames * G;
  const HS = Z + G;
  const CS = HS + H;
  const LOG = CS + H;
  const need = (LOG + frames * Cp) * 4;
  const memory = s.kernel.memory;
  if (need > memory.buffer.byteLength) {
    memory.grow(Math.ceil((need - memory.buffer.byteLength) / 65536));
  }
  const f = new Float32Array(memory.buffer);
  f.set(standardize(net, features, frames), A);
  const { affine, cell } = s.kernel;
  let input = A;
  let output = B;
  for (let k = 0; k < s.layers.length; k++) {
    const n = s.layers[k][0].inputs;
    for (let dir = 0; dir < 2; dir++) {
      const L = s.layers[k][dir];
      for (let t = 0; t < frames; t++)
        affine(L.wih, n, (input + t * n) * 4, L.bias, (PRE + t * G) * 4, G);
      f.fill(0, HS, HS + 2 * H);
      const offset = dir * H;
      for (let step = 0; step < frames; step++) {
        const t = dir === 0 ? step : frames - 1 - step;
        affine(L.whh, H, HS * 4, (PRE + t * G) * 4, Z * 4, G);
        cell(Z * 4, CS * 4, HS * 4, (output + t * 2 * H + offset) * 4, H);
      }
    }
    const swap = input;
    input = output;
    output = swap;
  }
  for (let t = 0; t < frames; t++) {
    affine(s.out, 2 * H, (input + t * 2 * H) * 4, s.outBias, (LOG + t * Cp) * 4, Cp);
  }
  return logSoftmax(f, LOG, frames, net.classes, Cp);
}

/**
 * Log-probabilities (`frames × classes`, row-major) for one line's features:
 * with WebAssembly SIMD where it runs (unless `simd` is false), else in plain
 * JavaScript. Both agree with the reference to ~1e-5.
 */
export function forward(
  net: NetWeights,
  features: Float32Array,
  frames: number,
  options: { simd?: boolean } = {},
): Float32Array {
  if (frames === 0) return new Float32Array(0);
  const s = options.simd === false ? null : simdNet(net);
  return s ? forwardSimd(s, net, features, frames) : forwardJs(net, features, frames);
}
