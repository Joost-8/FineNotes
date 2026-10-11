/**
 * Fine-tuning at speed: the training step of train.ts, with the weights,
 * their gradients and a line's activations in a WebAssembly SIMD kernel's
 * memory (simd.ts). The matrix work runs in the kernel: the forward pass's
 * projections and recurrence (`affine`), and the backward pass's gradients
 * through the weights and into them (`axpy`, the weight gradients batched
 * over a line's frames so each row stays in cache). The gates, the CTC and
 * Adam stay in JavaScript, where they are a small share of the work.
 *
 * It computes what train.ts computes (float32 here, float64 sums there);
 * hwr-train-engine.test.ts holds the two together, and train.ts holds
 * itself to PyTorch.
 *
 * PURE: no DOM, no Obsidian.
 */

import { simdKernel, type SimdKernel } from "./simd";
import {
  type AdamState,
  type StepOptions,
  type TrainDirection,
  type TrainLine,
  type TrainNet,
  adamState,
  adamStep,
  clipGrads,
  ctcLossGrad,
} from "./train";

/** Where one direction's arrays sit in the kernel's memory (float offsets). */
interface DirAt {
  inputs: number;
  wih: number;
  whh: number;
  bias: number;
}

/** A layout of a network's arrays, as float offsets. */
interface NetAt {
  dirs: DirAt[];
  out: number;
  outBias: number;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export class TrainEngine {
  private readonly kernel: SimdKernel;
  private readonly H: number;
  private readonly G: number;
  private readonly C: number;
  /** Classes rounded up to the kernel's four rows. */
  private readonly Cp: number;
  private readonly layers: number;
  private readonly inputs: number;
  private readonly params: NetAt;
  private readonly grads: NetAt;
  /** Scratch for one line, sized for `maxFrames` (float offsets). */
  private readonly scratch: number;
  private readonly maxFrames: number;
  /** The network's arrays, as views on the kernel's memory. */
  readonly net: TrainNet;
  private readonly gradNet: TrainNet;
  readonly adam: AdamState;

  /**
   * An engine for `net`, with room for lines of up to `maxFrames` frames;
   * null where WebAssembly SIMD cannot run it (the caller trains with
   * train.ts instead).
   */
  static create(net: TrainNet, maxFrames: number): TrainEngine | null {
    const H = net.hidden;
    if (H % 4 !== 0 || net.inputs % 4 !== 0) return null;
    const engine = new TrainEngine(net, maxFrames);
    return engine.kernel ? engine : null;
  }

  private constructor(net: TrainNet, maxFrames: number) {
    const H = net.hidden;
    const G = 4 * H;
    this.H = H;
    this.G = G;
    this.C = net.classes;
    this.Cp = Math.ceil(net.classes / 4) * 4;
    this.layers = net.layers.length;
    this.inputs = net.inputs;
    this.maxFrames = maxFrames;
    let at = 0;
    const layout = (): NetAt => {
      const dirs: DirAt[] = [];
      for (const pair of net.layers) {
        for (const d of pair) {
          const wih = at;
          at += G * d.inputs;
          const whh = at;
          at += G * H;
          const bias = at;
          at += G;
          dirs.push({ inputs: d.inputs, wih, whh, bias });
        }
      }
      const out = at;
      at += this.Cp * 2 * H;
      const outBias = at;
      at += this.Cp;
      return { dirs, out, outBias };
    };
    this.params = layout();
    this.grads = layout();
    this.scratch = at;
    const kernel = simdKernel((at + this.scratchFloats()) * 4);
    if (!kernel) throw new Error("no SIMD");
    this.kernel = kernel;
    const f = this.f32();
    // The weights in; padded output rows stay 0.
    net.layers.forEach((pair, l) =>
      pair.forEach((d, k) => {
        const p = this.params.dirs[l * 2 + k];
        f.set(d.wih, p.wih);
        f.set(d.whh, p.whh);
        f.set(d.bias, p.bias);
      }),
    );
    f.set(net.out, this.params.out);
    f.set(net.outBias, this.params.outBias);
    this.net = this.view(this.params, net);
    this.gradNet = this.view(this.grads, net);
    this.adam = adamState(this.net);
  }

  /** How many floats one line's scratch needs. */
  private scratchFloats(): number {
    const T = this.maxFrames;
    const { H, G, Cp } = this;
    const In = Math.max(this.inputs, 2 * H);
    // Per layer: input and its dropout mask (T × In); per direction: z (T × G),
    // gates i f g o, c, tanh c, h (7 × T × H). Then the output layer's logits
    // and their gradient (twice T × Cp), dZ^T (G × T), the last layer's
    // output, the top gradient and dX (three times T × In), and a few vectors.
    const perLayer = 2 * T * In + 2 * (T * G + 7 * T * H);
    return this.layers * perLayer + 3 * T * Cp + G * T + 3 * T * In + 2 * G + 64;
  }

  private f32(): Float32Array {
    return new Float32Array(this.kernel.memory.buffer);
  }

  /** A TrainNet whose arrays are views on the kernel's memory. */
  private view(at: NetAt, like: TrainNet): TrainNet {
    const f = this.f32();
    const { G, H } = this;
    const dir = (d: DirAt): TrainDirection => ({
      inputs: d.inputs,
      wih: f.subarray(d.wih, d.wih + G * d.inputs),
      whh: f.subarray(d.whh, d.whh + G * H),
      bias: f.subarray(d.bias, d.bias + G),
    });
    return {
      inputs: like.inputs,
      hidden: H,
      classes: like.classes,
      mean: like.mean,
      std: like.std,
      layers: like.layers.map((_, l) => [dir(at.dirs[l * 2]), dir(at.dirs[l * 2 + 1])]),
      out: f.subarray(at.out, at.out + this.C * 2 * H),
      outBias: f.subarray(at.outBias, at.outBias + this.C),
    };
  }

  /** A copy of the network as it is now, outside the kernel. */
  snapshot(): TrainNet {
    const copy = (a: Float32Array): Float32Array => Float32Array.from(a);
    const n = this.net;
    return {
      ...n,
      layers: n.layers.map(([f, b]) => [
        { inputs: f.inputs, wih: copy(f.wih), whh: copy(f.whh), bias: copy(f.bias) },
        { inputs: b.inputs, wih: copy(b.wih), whh: copy(b.whh), bias: copy(b.bias) },
      ]),
      out: copy(n.out),
      outBias: copy(n.outBias),
    };
  }

  /** One step on a batch: mean loss, clipped, Adam. Returns the mean loss. */
  step(batch: readonly TrainLine[], options: StepOptions & { lr: number; clip: number }): number {
    this.f32().fill(0, this.grads.dirs[0].wih, this.scratch);
    let loss = 0;
    for (const line of batch) loss += this.lineLossGrad(line, 1 / batch.length, options);
    clipGrads(this.net, this.gradNet, options.clip);
    adamStep(this.net, this.gradNet, this.adam, options.lr);
    return loss;
  }

  /** The gradient this engine holds now (for tests). */
  gradients(): TrainNet {
    return this.gradNet;
  }

  /** Zero the gradient (for tests that call `lineLossGrad` alone). */
  zeroGrads(): void {
    this.f32().fill(0, this.grads.dirs[0].wih, this.scratch);
  }

  /**
   * One line's loss (divided by its label's length), its gradient added in
   * with weight `weight`. A line longer than the engine's room is skipped.
   */
  lineLossGrad(line: TrainLine, weight: number, options: StepOptions): number {
    const T = line.frames;
    if (T > this.maxFrames || T === 0) return 0;
    const { H, G, C, Cp, kernel } = this;
    const f = this.f32();
    const In0 = this.inputs;
    const InMax = Math.max(In0, 2 * H);
    // Scratch layout for this line.
    let at = this.scratch;
    const take = (n: number): number => {
      const p = at;
      at += n;
      return p;
    };
    const layerIn: number[] = [];
    const layerMask: number[] = [];
    const dirZ: number[][] = [];
    const dirGates: {
      i: number;
      f: number;
      g: number;
      o: number;
      c: number;
      tc: number;
      h: number;
    }[][] = [];
    for (let l = 0; l < this.layers; l++) {
      layerIn.push(take(T * InMax));
      layerMask.push(take(T * InMax));
      dirZ.push([take(T * G), take(T * G)]);
      dirGates.push(
        [0, 1].map(() => ({
          i: take(T * H),
          f: take(T * H),
          g: take(T * H),
          o: take(T * H),
          c: take(T * H),
          tc: take(T * H),
          h: take(T * H),
        })),
      );
    }
    const logits = take(T * Cp);
    const dL = take(T * Cp);
    const dLT = take(Cp * T);
    const dZT = take(G * T);
    const dTop = take(T * InMax);
    const dXb = take(T * InMax);
    const dz = take(G);
    const dhPrev = take(H);
    const bytes = (p: number): number => p * 4;

    // --- Forward ---
    const { mean, std } = this.net;
    const x0 = layerIn[0];
    for (let t = 0; t < T; t++) {
      for (let j = 0; j < In0; j++) {
        const v = line.features[t * In0 + j];
        f[x0 + t * In0 + j] = mean && std ? Math.fround(v - mean[j]) / std[j] : v;
      }
    }
    let prevOut = -1;
    for (let l = 0; l < this.layers; l++) {
      const In = l === 0 ? In0 : 2 * H;
      const x = layerIn[l];
      if (l > 0) {
        const mask = layerMask[l];
        const keep = 1 / (1 - options.dropout);
        for (let k = 0; k < T * In; k++) {
          let m = 1;
          if (options.dropout > 0) m = options.random() < options.dropout ? 0 : keep;
          f[mask + k] = m;
          f[x + k] = f[prevOut + k] * m;
        }
      }
      // The layer's output goes to the next layer's input slot, or to dTop's
      // neighbour for the last layer (reused as `top`).
      const out = l + 1 < this.layers ? layerIn[l + 1] : take(T * 2 * H);
      for (let d = 0; d < 2; d++) {
        const p = this.params.dirs[l * 2 + d];
        const z = dirZ[l][d];
        const gs = dirGates[l][d];
        for (let t = 0; t < T; t++) {
          kernel.affine(bytes(p.wih), In, bytes(x + t * In), bytes(p.bias), bytes(z + t * G), G);
        }
        let prev = -1;
        for (let step = 0; step < T; step++) {
          const t = d === 0 ? step : T - 1 - step;
          const zt = z + t * G;
          if (prev >= 0) {
            kernel.affine(bytes(p.whh), H, bytes(gs.h + prev * H), bytes(zt), bytes(zt), G);
          }
          for (let u = 0; u < H; u++) {
            const k = t * H + u;
            const ig = sigmoid(f[zt + u]);
            const fg = sigmoid(f[zt + H + u]);
            const gg = Math.tanh(f[zt + 2 * H + u]);
            const og = sigmoid(f[zt + 3 * H + u]);
            const cPrev = prev >= 0 ? f[gs.c + prev * H + u] : 0;
            const c = fg * cPrev + ig * gg;
            const tc = Math.tanh(c);
            f[gs.i + k] = ig;
            f[gs.f + k] = fg;
            f[gs.g + k] = gg;
            f[gs.o + k] = og;
            f[gs.c + k] = c;
            f[gs.tc + k] = tc;
            const h = og * tc;
            f[gs.h + k] = h;
            f[out + t * 2 * H + d * H + u] = h;
          }
          prev = t;
        }
      }
      prevOut = out;
    }
    const top = prevOut;
    const logp = new Float64Array(T * C);
    for (let t = 0; t < T; t++) {
      kernel.affine(
        bytes(this.params.out),
        2 * H,
        bytes(top + t * 2 * H),
        bytes(this.params.outBias),
        bytes(logits + t * Cp),
        Cp,
      );
      let max = -Infinity;
      for (let k = 0; k < C; k++) max = Math.max(max, f[logits + t * Cp + k]);
      let sum = 0;
      for (let k = 0; k < C; k++) sum += Math.exp(f[logits + t * Cp + k] - max);
      const lse = max + Math.log(sum);
      for (let k = 0; k < C; k++) logp[t * C + k] = f[logits + t * Cp + k] - lse;
    }

    // --- Loss ---
    const { loss, grad } = ctcLossGrad(logp, T, C, line.target);
    if (!grad || !Number.isFinite(loss)) return 0;
    const scale = weight / line.target.length;

    // --- Backward: the output layer ---
    f.fill(0, dL, dL + T * Cp);
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < C; k++) {
        const v = grad[t * C + k] * scale;
        f[dL + t * Cp + k] = v;
        f[dLT + k * T + t] = v;
        f[this.grads.outBias + k] += v;
      }
    }
    for (let k = C; k < Cp; k++) f.fill(0, dLT + k * T, dLT + (k + 1) * T);
    for (let k = 0; k < C; k++) {
      kernel.axpy(
        bytes(this.grads.out + k * 2 * H),
        0,
        bytes(top),
        2 * H * 4,
        bytes(dLT + k * T),
        T,
        2 * H,
      );
    }
    f.fill(0, dTop, dTop + T * 2 * H);
    for (let t = 0; t < T; t++) {
      kernel.axpy(
        bytes(dTop + t * 2 * H),
        0,
        bytes(this.params.out),
        2 * H * 4,
        bytes(dL + t * Cp),
        C,
        2 * H,
      );
    }

    // --- Backward: the LSTM layers, top down ---
    let dY = dTop;
    for (let l = this.layers - 1; l >= 0; l--) {
      const In = l === 0 ? In0 : 2 * H;
      const x = layerIn[l];
      const dX = dY === dTop ? dXb : dTop;
      f.fill(0, dX, dX + T * In);
      for (let d = 0; d < 2; d++) {
        const p = this.params.dirs[l * 2 + d];
        const g = this.grads.dirs[l * 2 + d];
        const gs = dirGates[l][d];
        const dhNext = new Float64Array(H);
        const dcNext = new Float64Array(H);
        for (let step = T - 1; step >= 0; step--) {
          const t = d === 0 ? step : T - 1 - step;
          const prevT = step > 0 ? (d === 0 ? t - 1 : t + 1) : -1;
          for (let u = 0; u < H; u++) {
            const k = t * H + u;
            const dh = f[dY + t * 2 * H + d * H + u] + dhNext[u];
            const o = f[gs.o + k];
            const tc = f[gs.tc + k];
            const dc = dh * o * (1 - tc * tc) + dcNext[u];
            const i = f[gs.i + k];
            const fg = f[gs.f + k];
            const gg = f[gs.g + k];
            const cPrev = prevT >= 0 ? f[gs.c + prevT * H + u] : 0;
            const zi = dc * gg * i * (1 - i);
            const zf = dc * cPrev * fg * (1 - fg);
            const zg = dc * i * (1 - gg * gg);
            const zo = dh * tc * o * (1 - o);
            f[dz + u] = zi;
            f[dz + H + u] = zf;
            f[dz + 2 * H + u] = zg;
            f[dz + 3 * H + u] = zo;
            f[dZT + u * T + t] = zi;
            f[dZT + (H + u) * T + t] = zf;
            f[dZT + (2 * H + u) * T + t] = zg;
            f[dZT + (3 * H + u) * T + t] = zo;
            dcNext[u] = dc * fg;
          }
          // dX[t] += Wihᵀ dz; dh_prev = Whhᵀ dz.
          kernel.axpy(bytes(dX + t * In), 0, bytes(p.wih), In * 4, bytes(dz), G, In);
          if (prevT >= 0) {
            f.fill(0, dhPrev, dhPrev + H);
            kernel.axpy(bytes(dhPrev), 0, bytes(p.whh), H * 4, bytes(dz), G, H);
            for (let u = 0; u < H; u++) dhNext[u] = f[dhPrev + u];
          } else {
            dhNext.fill(0);
          }
        }
        // Weight gradients, batched over the line's frames.
        for (let r = 0; r < G; r++) {
          const row = dZT + r * T;
          let sum = 0;
          for (let t = 0; t < T; t++) sum += f[row + t];
          f[g.bias + r] += sum;
          kernel.axpy(bytes(g.wih + r * In), 0, bytes(x), In * 4, bytes(row), T, In);
          if (T > 1) {
            // h of the frame before, in the direction's own order.
            if (d === 0)
              kernel.axpy(bytes(g.whh + r * H), 0, bytes(gs.h), H * 4, bytes(row + 1), T - 1, H);
            else kernel.axpy(bytes(g.whh + r * H), 0, bytes(gs.h + H), H * 4, bytes(row), T - 1, H);
          }
        }
      }
      if (l > 0 && options.dropout > 0) {
        const mask = layerMask[l];
        for (let k = 0; k < T * In; k++) f[dX + k] *= f[mask + k];
      }
      dY = dX;
    }
    return loss * scale;
  }
}
