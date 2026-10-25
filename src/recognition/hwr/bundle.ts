/**
 * Reads a recogniser file written by research/handwriting-rig/export_hwr.py:
 * a JSON header, the network in int8 ("NET1") and, optionally, the character
 * language model ("LM01"). The file's docstring there is the format's spec.
 *
 * The weights are research-only and never ship: the file is read from a
 * path the user sets, in their own vault.
 *
 * PURE: no DOM, no Obsidian.
 */

import { CharLm } from "./char-lm";
import { CURVE_RAW, type CurveInput } from "./curves";

const MAGIC = 0x57484e46; // "FNHW", little-endian

/**
 * File format versions: 1 reads point frames (Grape 1.0); 2 adds `input` to
 * the header, which says what the network reads (Grape 2 reads Bézier
 * curves). A build that reads only 1 refuses a version 2 file, rather than
 * feeding a curve network points.
 */
export const BUNDLE_FORMAT_POINTS = 1;
export const BUNDLE_FORMAT_INPUT = 2;

/**
 * The format version in a model file's header, without reading the rest;
 * null when it is not a FineNotes handwriting model at all.
 */
export function bundleFormatOf(bytes: ArrayBuffer | Uint8Array): number | null {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (src.byteLength < 8) return null;
  const view = new DataView(src.buffer, src.byteOffset, 8);
  return view.getUint32(0, true) === MAGIC ? view.getUint32(4, true) : null;
}

/** What the header says about the model and how to run it. */
export interface HwrMeta {
  format: string;
  version: number;
  name: string;
  licence: string;
  exported: string;
  /** The characters the network writes; class 0 is the CTC blank, class k is `alphabet[k - 1]`. */
  alphabet: string[];
  net: {
    inputs: number;
    hidden: number;
    layers: number;
    classes: number;
    standardize: boolean;
    quant: string;
  };
  features: {
    version: string;
    norm: string;
    pointsPerUnit: number;
    heightsPerSecond: number;
    coreUnits: number;
  };
  decoder: { alpha: number; beta: number; beam: number; topk: number; prune: number };
  /**
   * Set (true) only on a model measured to read digits and operators well
   * enough that a calculation from its reading can be trusted: calculation
   * notes stay off with any other. Grape 2.0 does not set it (on its
   * developer's own ink it reads about seven digits in ten right). A model
   * learned from one keeps its header, so it keeps the flag.
   */
  maths?: boolean;
  /**
   * What the network reads, from format 2: absent means point frames (the
   * features above). Curves are fitted to those frames (curves.ts); the
   * network's inputs may be wider than a curve's CURVE_RAW values, padded
   * with zeros to a multiple of four for the SIMD kernels.
   */
  input?: CurveInput;
  lm?: {
    order: number;
    chars: string[];
    V: number;
    nodes: number;
    preds: number;
    minCount: number;
  };
}

/** One direction of one LSTM layer. Weights are `q · scale[row]`. */
export interface LstmDirection {
  /** Inputs per step: 4 for layer 0, 2·hidden after. */
  inputs: number;
  /** `4H × inputs`, gate order input, forget, cell, output. */
  wih: Int8Array;
  wihScale: Float32Array;
  /** `4H × H`. */
  whh: Int8Array;
  whhScale: Float32Array;
  /** `bias_ih + bias_hh`, `4H`. */
  bias: Float32Array;
}

export interface NetWeights {
  inputs: number;
  hidden: number;
  classes: number;
  /** Per-channel standardisation, or null. */
  mean: Float32Array | null;
  std: Float32Array | null;
  /** Per layer: forward, then backward. */
  layers: [LstmDirection, LstmDirection][];
  /** `classes × 2H`. */
  out: Int8Array;
  outScale: Float32Array;
  outBias: Float32Array;
}

export interface HwrBundle {
  meta: HwrMeta;
  net: NetWeights;
  lm: CharLm | null;
}

/** Whether a model's header says it reads maths well enough to calculate with ({@link HwrMeta.maths}). */
export function readsMaths(meta: Pick<HwrMeta, "maths">): boolean {
  return meta.maths === true;
}

/** A file that is not a recogniser this build can read. */
export class HwrFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HwrFormatError";
  }
}

/** Reads typed arrays off a little-endian buffer, each block 4-byte aligned. */
class Reader {
  private pos = 0;
  constructor(
    private readonly buffer: ArrayBuffer,
    private readonly start: number,
    private readonly end: number,
  ) {
    this.pos = start;
  }

  private take(bytes: number): number {
    const at = this.pos;
    if (at + bytes > this.end) throw new HwrFormatError("the file ends inside the network");
    this.pos += bytes + ((4 - (bytes % 4)) % 4);
    return at;
  }

  f32(n: number): Float32Array {
    return new Float32Array(this.buffer, this.take(n * 4), n);
  }

  i8(n: number): Int8Array {
    return new Int8Array(this.buffer, this.take(n), n);
  }

  get consumed(): number {
    return this.pos - this.start;
  }
}

function readNet(meta: HwrMeta, buffer: ArrayBuffer, start: number, end: number): NetWeights {
  const { inputs, hidden: H, layers, classes, standardize } = meta.net;
  const r = new Reader(buffer, start, end);
  const mean = standardize ? r.f32(inputs) : null;
  const std = standardize ? r.f32(inputs) : null;
  const out: [LstmDirection, LstmDirection][] = [];
  for (let k = 0; k < layers; k++) {
    const n = k === 0 ? inputs : 2 * H;
    const dir = (): LstmDirection => {
      const wihScale = r.f32(4 * H);
      const whhScale = r.f32(4 * H);
      const bias = r.f32(4 * H);
      const wih = r.i8(4 * H * n);
      const whh = r.i8(4 * H * H);
      return { inputs: n, wih, wihScale, whh, whhScale, bias };
    };
    out.push([dir(), dir()]);
  }
  const outScale = r.f32(classes);
  const outBias = r.f32(classes);
  const weights = r.i8(classes * 2 * H);
  if (start + r.consumed !== end)
    throw new HwrFormatError("the network section has a size its header does not explain");
  return { inputs, hidden: H, classes, mean, std, layers: out, out: weights, outScale, outBias };
}

/** A format 2 header must say what the network reads, in a way this build computes. */
function checkInput(meta: HwrMeta): void {
  const input = meta.input;
  if (!input) throw new HwrFormatError("a version 2 model file must say what its network reads");
  if (input.kind !== "curves" || input.encoding !== "raw") {
    throw new HwrFormatError(
      `the model reads ${String(input.kind)} (${String(input.encoding)}); this build computes raw curves`,
    );
  }
  if (!(input.tol > 0 && Number.isFinite(input.tol)))
    throw new HwrFormatError(`curve tolerance ${input.tol}`);
  if (meta.net.inputs < CURVE_RAW)
    throw new HwrFormatError(`${meta.net.inputs} network inputs for ${CURVE_RAW} curve values`);
}

/**
 * Parse a recogniser file. The bytes are copied once into an aligned buffer
 * the typed arrays then view, so the caller's buffer may be reused.
 */
export function parseBundle(bytes: ArrayBuffer | Uint8Array): HwrBundle {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = new ArrayBuffer(src.byteLength);
  new Uint8Array(buffer).set(src);
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== MAGIC) {
    throw new HwrFormatError("not a FineNotes handwriting model (no FNHW header)");
  }
  const version = view.getUint32(4, true);
  if (version !== BUNDLE_FORMAT_POINTS && version !== BUNDLE_FORMAT_INPUT)
    throw new HwrFormatError(
      `model file version ${version}; this build reads ${BUNDLE_FORMAT_POINTS} and ${BUNDLE_FORMAT_INPUT}`,
    );
  const metaLength = view.getUint32(8, true);
  if (12 + metaLength > buffer.byteLength)
    throw new HwrFormatError("the file ends inside its header");
  const meta = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 12, metaLength)),
  ) as HwrMeta;
  if (meta.features?.version !== "v2" || meta.features.norm !== "skew=0,slant=0,scale=core") {
    throw new HwrFormatError(
      `the model expects ${meta.features?.version} features with "${meta.features?.norm}"; this build computes v2 with core scaling only`,
    );
  }
  if (version === BUNDLE_FORMAT_POINTS) delete meta.input;
  else checkInput(meta);
  if (meta.net.classes !== meta.alphabet.length + 1) {
    throw new HwrFormatError(`${meta.net.classes} classes for ${meta.alphabet.length} characters`);
  }
  let o = 12 + metaLength;
  let net: NetWeights | null = null;
  let lm: CharLm | null = null;
  while (o + 8 <= buffer.byteLength) {
    const tag = String.fromCharCode(...new Uint8Array(buffer, o, 4));
    const size = view.getUint32(o + 4, true);
    const start = o + 8;
    if (start + size > buffer.byteLength)
      throw new HwrFormatError(`section ${tag} runs past the end of the file`);
    if (tag === "NET1") net = readNet(meta, buffer, start, start + size);
    else if (tag === "LM01" && meta.lm) lm = CharLm.fromSection(meta.lm, buffer, start, size);
    o = start + size + ((4 - (size % 4)) % 4);
  }
  if (!net) throw new HwrFormatError("the file has no network");
  return { meta, net, lm };
}
