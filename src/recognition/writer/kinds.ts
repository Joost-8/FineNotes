/**
 * The kinds of writer model this build can run, chosen by a model's
 * manifest (`manifest.ts`). A kind says which graphs it needs, which of the
 * writer's copied lines to show for a text, how to make them into what its
 * model is shown, and how to write one try. Its graphs are reached through
 * a {@link GraphRunner}: inputs and outputs by position, with the tensor
 * names taken from the manifest, so a kind never names a tensor itself.
 *
 * "dual" is A long (research/handwriting-rig/gen/inkdual.py): the reference
 * encoded with and without the writer, letter lengths from the summary,
 * flow-matching velocity mixed by guidance (`sampler.ts`). A pieces model
 * (C2) would be another kind with its own reference; it is added here when
 * one ships.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { WriterManifest } from "./manifest";
import { type Reference, ROW, type TaggedLine, pickLines, referenceOf } from "./rows";
import {
  type Encoded,
  type Graphs,
  type WriteOptions,
  type WriterMeta,
  type Written,
  writeLine,
} from "./sampler";

/** A tensor going into or coming out of a graph. */
export interface Tensorish {
  type: "float32" | "int64" | "bool";
  data: Float32Array | BigInt64Array | Uint8Array;
  dims: number[];
}

/** Runs the model's graph `role` on inputs given in the manifest's order; outputs in its order. */
export type GraphRunner = (role: string, inputs: Tensorish[]) => Promise<Tensorish[]>;

/** What a kind of model needs and does. `R` is what its model is shown for one line. */
export interface WriterKind<R = unknown> {
  /** Graph roles it runs, with how many inputs and outputs each has. */
  graphs: Readonly<Record<string, { inputs: number; outputs: number }>>;
  /** The writer's copied lines to look at for `text`, best first, at most `count` (the caller ties them to their letters). */
  pick<L extends { text: string }>(text: string, pool: readonly L[], count: number): L[];
  /** What the model is shown for `text`, from the lines picked and tied to their letters; null for none. */
  reference(text: string, lines: readonly TaggedLine[], m: WriterManifest): R | null;
  /** One try of a line. */
  write(
    run: GraphRunner,
    m: WriterManifest,
    text: string,
    ref: R,
    options: WriteOptions,
  ): Promise<Written>;
}

/** The sampler's numbers, from a manifest. */
export function samplerMeta(m: WriterManifest): WriterMeta {
  return {
    chars: m.chars,
    mean: m.rows.mean,
    std: m.rows.std,
    maxDur: m.sampling.maxDur,
    refCurves: m.reference.curves,
    steps: m.sampling.steps,
    sigma: m.sampling.sigma,
    guidance: m.sampling.guidance,
    lowGuidance: m.sampling.lowGuidance,
    lowMix: m.sampling.lowMix,
    hold: m.reference.hold,
    refLines: m.reference.lines,
  };
}

const f32 = (data: Float32Array, dims: number[]): Tensorish => ({ type: "float32", data, dims });
const i64 = (v: ArrayLike<number>, dims: number[]): Tensorish => ({
  type: "int64",
  data: BigInt64Array.from(Array.from(v, (n) => BigInt(n))),
  dims,
});
const bools = (v: ArrayLike<number>, dims: number[]): Tensorish => ({
  type: "bool",
  data: Uint8Array.from(v, (n) => (n ? 1 : 0)),
  dims,
});
const ones = (n: number): Uint8Array => new Uint8Array(n).fill(1);

/** An encoded reference as the dual model's velocity takes it. */
export interface DualEncoded extends Encoded {
  mem: Tensorish;
  valid: Tensorish;
  gTensor: Tensorish;
}

/** The dual model's three graphs over a runner (gen/export_onnx.py's inputs, in that order). */
export function dualGraphs(run: GraphRunner): Graphs<DualEncoded> {
  return {
    async encode(ref: Reference, drop: boolean): Promise<DualEncoded> {
      const R = ref.n;
      const [mem, valid, g] = await run("encode", [
        f32(ref.x, [1, R, ROW]),
        bools(ones(R), [1, R]),
        i64(ref.cid, [1, R]),
        i64(ref.k, [1, R]),
        i64(ref.d, [1, R]),
        bools(ref.sep, [1, R]),
        bools([drop ? 1 : 0], [1]),
      ]);
      return { mem, valid, gTensor: g, g: Float32Array.from(g.data as Float32Array) };
    },
    async durations(ids: Int32Array, g: Float32Array): Promise<Float32Array> {
      const L = ids.length;
      const [logits] = await run("durations", [
        i64(ids, [1, L]),
        bools(ones(L), [1, L]),
        f32(g, [1, g.length]),
      ]);
      return Float32Array.from(logits.data as Float32Array);
    },
    async velocity(x, tau, cid, k, d, enc): Promise<Float32Array> {
      const n = cid.length;
      const [v] = await run("velocity", [
        f32(x, [1, n, ROW]),
        f32(Float32Array.from([tau]), [1]),
        bools(ones(n), [1, n]),
        i64(cid, [1, n]),
        i64(k, [1, n]),
        i64(d, [1, n]),
        enc.mem,
        enc.valid,
        enc.gTensor,
      ]);
      return Float32Array.from(v.data as Float32Array);
    },
  };
}

/** A long's kind. */
export const DUAL_KIND: WriterKind<Reference> = {
  graphs: {
    encode: { inputs: 7, outputs: 3 },
    durations: { inputs: 3, outputs: 1 },
    velocity: { inputs: 9, outputs: 1 },
  },
  pick: (text, pool, count) => pickLines(text, pool, count),
  reference: (_text, lines, m) =>
    referenceOf(lines, m.reference.curves, new Map(m.chars.map((c, i) => [c, i]))),
  write: (run, m, text, ref, options) =>
    writeLine(dualGraphs(run), samplerMeta(m), text, ref, options),
};

/** Every kind this build runs, by the manifest's `kind`. */
export const WRITER_KINDS: ReadonlyMap<string, WriterKind> = new Map<string, WriterKind>([
  ["dual", DUAL_KIND],
]);

/**
 * The kind that runs `m`, from `kinds`, once its graphs are the ones that
 * kind needs (each role present, with its number of inputs and outputs);
 * else why not.
 */
export function kindFor(
  m: WriterManifest,
  kinds: ReadonlyMap<string, WriterKind> = WRITER_KINDS,
): { kind: WriterKind } | { problem: string } {
  const kind = kinds.get(m.kind);
  if (!kind) return { problem: `unknown kind ${m.kind}` };
  for (const [role, want] of Object.entries(kind.graphs)) {
    const g = m.graphs[role];
    if (!g) return { problem: `no ${role} graph` };
    if (g.inputs.length !== want.inputs || g.outputs.length !== want.outputs)
      return {
        problem: `the ${role} graph has ${g.inputs.length} inputs and ${g.outputs.length} outputs`,
      };
  }
  return { kind };
}
