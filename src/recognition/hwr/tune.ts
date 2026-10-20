/**
 * Learning one writer's handwriting: a run of finetune_v2's recipe on their
 * labelled lines, and the gate that decides whether the tuned model is kept.
 *
 * The recipe (research/handwriting-rig/finetune_v2.py): steps of 8 lines,
 * always from the general model, Adam at 3e-4, gradients clipped at 5,
 * dropout 0.25 between layers, and the same augmentation of each line every
 * time it is drawn: scale, shear, rotation and jitter of the ink, a random
 * pen speed, then an affine map and speed change of the features. 100 steps
 * by default: in the rig, 93 % of the gain of 300.
 *
 * The gate reads held-out lines, never trained on, with both models and the
 * language model, as the plugin reads; the tuned model is kept only if it
 * gets fewer characters wrong.
 *
 * PURE: no DOM, no Obsidian.
 */

import { type HwrBundle, type NetWeights, parseBundle } from "./bundle";
import { type CurveInput, networkInput } from "./curves";
import { type InkStroke, lineFeatures } from "./features";
import { readLine } from "./recognizer";
import {
  type TrainLine,
  type TrainNet,
  adamState,
  netWeightsFrom,
  trainNetFrom,
  trainStep,
} from "./train";
import { TrainEngine } from "./train-engine";

/** A line to learn from: its ink and what it says. */
export interface LabelledLine {
  strokes: InkStroke[];
  text: string;
}

export interface TuneOptions {
  steps: number;
  batch: number;
  lr: number;
  clip: number;
  dropout: number;
  /** Seeds the run's random numbers, so a run can be repeated. */
  seed: number;
  /**
   * The device's memory in GB (`navigator.deviceMemory`), or undefined where
   * the browser does not say (WebKit never does): it sizes the engine's room
   * (tuneRoom).
   */
  deviceMemory?: number;
}

/**
 * The longest practice line learned from, in frames before augmentation.
 * The training engine keeps ~73 KB a frame for 2.5 times its longest line
 * (augmentation stretches a line up to 2.7 times, 2 for 99 % of them), so
 * one long line set the memory of the whole run: 2,000 frames took ~365 MB,
 * too much beside everything else on a 4 GB iPad. Copied practice lines run
 * to ~700; at this cap the engine stays under ~185 MB.
 */
export const TUNE_MAX_FRAMES = 1000;

/**
 * The same for a curve model (Grape 2), in curves: a curve spans ~4.3 point
 * frames, so this is a longer line than TUNE_MAX_FRAMES, but a 6×256 network
 * keeps ~170 KB a frame, so the room stays under ~90 MB at 1.3 times. The
 * longest practice or note line seen so far fits 274 curves.
 */
export const TUNE_MAX_CURVES = 400;

/** Devices with at least this much memory (GB) give the engine its full room. */
export const ROOMY_DEVICE_GB = 8;

/**
 * The training engine's room, in frames, for a run whose longest line has
 * `longest` frames before augmentation. Augmentation lengthens a line by up
 * to 2.2 times (points) or 2.0 (curves), and a line longer than the room is
 * left out of its step, so a roomy device gets 2.5 times. Elsewhere,
 * including every device that does not say (the iPad), the room is 1.3
 * times: the long lines are the ones that hardly stretch, so on 12,300
 * augmented copies of real practice and note lines none was left out for
 * either Grape (research/handwriting-rig/tune_stretch.mjs, 2026-10-20), and
 * the run learns exactly the same thing. It halves the memory reserved for
 * scratch (a 6×256 network keeps ~170 KB a frame), not what is resident:
 * pages a line never reaches are never touched (measured in Node, the
 * resident peak moved by under 1 %).
 */
export function tuneRoom(longest: number, deviceMemory?: number): number {
  const roomy = deviceMemory !== undefined && deviceMemory >= ROOMY_DEVICE_GB;
  return Math.ceil(longest * (roomy ? 2.5 : 1.3)) + 16;
}

/** finetune_v2's recipe, with 100 steps. */
export const TUNE_DEFAULTS: TuneOptions = {
  steps: 100,
  batch: 8,
  lr: 3e-4,
  clip: 5,
  dropout: 0.25,
  seed: 1,
};

/** A deterministic random number generator in [0, 1) (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal number (Box–Muller). */
function normal(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** A label as class indices (class k is `alphabet[k − 1]`), or null when a character is not in it. */
export function encodeLabel(text: string, alphabet: readonly string[]): number[] | null {
  const index = new Map(alphabet.map((c, i) => [c, i + 1]));
  const out: number[] = [];
  for (const ch of text) {
    const k = index.get(ch);
    if (k === undefined) return null;
    out.push(k);
  }
  return out.length > 0 ? out : null;
}

/** finetune_v2's `augment`: scale, shear, rotation (±3°) and 0.25 px jitter of the ink. */
export function augmentStrokes(strokes: readonly InkStroke[], random: () => number): InkStroke[] {
  const uniform = (lo: number, hi: number): number => lo + (hi - lo) * random();
  const sx = uniform(0.85, 1.15);
  const sy = sx * uniform(0.9, 1.1);
  const shear = uniform(-0.25, 0.25);
  const rot = (uniform(-3, 3) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return strokes.map((stroke) => {
    const pts = Array.from(stroke.pts);
    for (let i = 0; i + 1 < pts.length; i += 3) {
      const y = pts[i + 1] * sy;
      const x = pts[i] * sx - shear * y;
      pts[i] = c * x - s * y + normal(random) * 0.25;
      pts[i + 1] = s * x + c * y + normal(random) * 0.25;
    }
    return { pts, t0: stroke.t0 };
  });
}

/**
 * finetune_v2's `feature_augment`, on one line's features in place: an
 * affine map of (dx, dy) and a pen-speed factor on dt.
 */
export function augmentFeatures(
  features: Float32Array,
  frames: number,
  random: () => number,
): void {
  const th = normal(random) * 0.05;
  const sh = (random() - 0.5) * 0.5;
  const sx = 1 + (random() - 0.5) * 0.3;
  const sy = sx * (1 + (random() - 0.5) * 0.2);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const m00 = c * sx;
  const m01 = (c * sh - s) * sy;
  const m10 = s * sx;
  const m11 = (s * sh + c) * sy;
  const speed = Math.exp((random() - 0.5) * 0.7);
  for (let t = 0; t < frames; t++) {
    const x = features[t * 4];
    const y = features[t * 4 + 1];
    features[t * 4] = m00 * x + m01 * y;
    features[t * 4 + 1] = m10 * x + m11 * y;
    features[t * 4 + 2] *= speed;
  }
}

/** One labelled line as the trainer takes it, augmented or not; null when it cannot be. */
export function prepareLine(
  line: LabelledLine,
  alphabet: readonly string[],
  random: () => number,
  augment: boolean,
  model?: { input?: CurveInput; inputs: number },
): TrainLine | null {
  const target = encodeLabel(line.text, alphabet);
  if (!target || line.strokes.length === 0) return null;
  try {
    const strokes = augment ? augmentStrokes(line.strokes, random) : line.strokes;
    const speed = augment ? 3.5 + 4 * random() : undefined;
    const { features, frames } = lineFeatures(strokes, speed);
    if (augment) augmentFeatures(features, frames, random);
    // A curve model fits its curves to the augmented points.
    if (model?.input)
      return { ...networkInput(model.input, model.inputs, features, frames), target };
    return { features, frames, target };
  } catch {
    return null;
  }
}

/** Edit distance between two strings, by code point. */
export function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** Characters wrong and characters in all, reading `lines` with `bundle` (and its LM). */
export function scoreLines(
  bundle: HwrBundle,
  lines: readonly LabelledLine[],
): { errors: number; chars: number } {
  let errors = 0;
  let chars = 0;
  for (const line of lines) {
    let text = "";
    try {
      text = readLine(bundle, line.strokes).text;
    } catch {
      text = "";
    }
    errors += editDistance(text, line.text);
    chars += Array.from(line.text).length;
  }
  return { errors, chars };
}

/** Every fifth line, by position, is held out for the gate (at least one, when there are two or more). */
export function splitHoldout(lines: readonly LabelledLine[]): {
  train: LabelledLine[];
  holdout: LabelledLine[];
} {
  const train: LabelledLine[] = [];
  const holdout: LabelledLine[] = [];
  lines.forEach((line, i) => (i % 5 === 4 ? holdout : train).push(line));
  if (holdout.length === 0 && train.length >= 2) holdout.push(train.pop() as LabelledLine);
  return { train, holdout };
}

/** What a run made: the tuned network, and how both models read the held-out lines. */
export interface TuneResult {
  net: NetWeights;
  /** Characters wrong on the held-out lines: before and after. */
  before: { errors: number; chars: number };
  after: { errors: number; chars: number };
  /** Whether the tuned model reads them better (fewer characters wrong). */
  better: boolean;
  /** Lines trained on, and held out. */
  trained: number;
  heldOut: number;
}

/**
 * The recipe's steps on `train`; the tuned network, or null when stopped.
 *
 * The SIMD engine keeps the weights, their gradient and the Adam state in
 * its own memory, so the plain-JS copies are made only when there is no
 * engine (for a 6x256 network they are ~100 MB). Everything the steps
 * needed is unreachable once this returns, before the held-out lines are
 * read with the two networks.
 */
function trainSteps(
  start: NetWeights,
  train: readonly LabelledLine[],
  room: number,
  o: TuneOptions,
  random: () => number,
  onStep: (step: number, loss: number) => boolean | void,
  prepare: (line: LabelledLine) => TrainLine | null,
): NetWeights | null {
  const { engine, fallback } = makeTrainer(start, room);
  for (let step = 1; step <= o.steps; step++) {
    // Draw the batch without replacement, as random.sample does.
    const pool = [...train];
    const batch: TrainLine[] = [];
    while (batch.length < Math.min(o.batch, train.length) && pool.length > 0) {
      const pick = pool.splice(Math.floor(random() * pool.length), 1)[0];
      const prepared = prepare(pick);
      if (prepared) batch.push(prepared);
    }
    const stepOptions = { dropout: o.dropout, random, lr: o.lr, clip: o.clip };
    const loss = engine
      ? engine.step(batch, stepOptions)
      : trainStep(fallback!.net, fallback!.adam, batch, stepOptions);
    if (onStep(step, loss) === false) return null;
  }
  return netWeightsFrom(engine ? engine.snapshot() : fallback!.net);
}

/** The SIMD engine, or (where it cannot run) a plain-JS network and its Adam state. */
function makeTrainer(
  start: NetWeights,
  room: number,
): {
  engine: TrainEngine | null;
  fallback: { net: TrainNet; adam: ReturnType<typeof adamState> } | null;
} {
  const net = trainNetFrom(start);
  const engine = TrainEngine.create(net, room);
  return { engine, fallback: engine ? null : { net, adam: adamState(net) } };
}

/**
 * Tune the model in `bytes` on `lines`: the recipe's steps, then the gate.
 * `onStep` hears after every step (step number, mean loss), and may return
 * false to stop the run early (its result is then null).
 */
export function tune(
  bytes: Uint8Array,
  lines: readonly LabelledLine[],
  options: Partial<TuneOptions> = {},
  onStep: (step: number, loss: number) => boolean | void = () => {},
): TuneResult | null {
  const o = { ...TUNE_DEFAULTS, ...options };
  const base = parseBundle(bytes);
  const alphabet = base.meta.alphabet;
  const model = { input: base.meta.input, inputs: base.net.inputs };
  const random = seededRandom(o.seed);
  // Lines past TUNE_MAX_FRAMES (TUNE_MAX_CURVES) are left out, of the held-out lines too.
  let maxFrames = 0;
  const usable = lines.filter((line) => {
    if (encodeLabel(line.text, alphabet) === null || line.strokes.length === 0) return false;
    const prepared = prepareLine(line, alphabet, random, false, model);
    if (!prepared || prepared.frames > (model.input ? TUNE_MAX_CURVES : TUNE_MAX_FRAMES))
      return false;
    maxFrames = Math.max(maxFrames, prepared.frames);
    return true;
  });
  const { train, holdout } = splitHoldout(usable);
  if (train.length === 0) return null;
  const tuned = trainSteps(
    base.net,
    train,
    tuneRoom(maxFrames, o.deviceMemory),
    o,
    random,
    onStep,
    (line) => prepareLine(line, alphabet, random, true, model),
  );
  if (!tuned) return null;
  const candidate: HwrBundle = { ...base, net: tuned };
  const before = scoreLines(base, holdout);
  const after = scoreLines(candidate, holdout);
  return {
    net: tuned,
    before,
    after,
    better: holdout.length > 0 && after.errors < before.errors,
    trained: train.length,
    heldOut: holdout.length,
  };
}
