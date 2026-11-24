/**
 * The kinds of writer model this build can run, chosen by a model's
 * manifest (`manifest.ts`). A kind says which graphs it needs and, for each
 * input and output by position, what it is (its role) and its type; which
 * of the writer's copied lines to look at for a text; how to make them into
 * what its model is shown; and how to write one try. It also checks the
 * parts of the manifest only it uses. Its graphs are reached through a
 * {@link GraphRunner} with the tensor names from the manifest, so a kind
 * never names a tensor, and a manifest whose graphs are laid out otherwise
 * than the kind expects is refused by `kindFor`, not run wrongly.
 *
 * "dual" is A long (research/handwriting-rig/gen/inkdual.py): the reference
 * encoded with and without the writer, letter lengths from the summary,
 * flow-matching velocity mixed by guidance (`sampler.ts`). A pieces model
 * (C2) is another kind with its own reference; it is added here when one
 * ships.
 *
 * PURE: no DOM, no Obsidian.
 */

import {
  type ManifestProblem,
  type TensorType,
  type WriterManifest,
  isCount,
  isNum,
} from "./manifest";
import { type Reference, ROW, type TaggedLine, calm, pickLines, referenceOf } from "./rows";
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
  type: TensorType;
  data: Float32Array | BigInt64Array | Uint8Array;
  dims: number[];
}

/** Runs the model's graph `role` on inputs given in the manifest's order; outputs in its order. */
export type GraphRunner = (role: string, inputs: Tensorish[]) => Promise<Tensorish[]>;

/** One input or output as a kind passes or reads it, by position. */
export interface Slot {
  role: string;
  type: TensorType;
}

/** What a kind of model needs and does. `R` is what its model is shown for one line. */
export interface WriterKind<R = unknown> {
  /** Graph roles it runs, with each input and output in the order it passes and reads them. */
  graphs: Readonly<Record<string, { inputs: readonly Slot[]; outputs: readonly Slot[] }>>;
  /** The parts of the manifest only this kind uses; a reason when they are missing or wrong. */
  check(m: WriterManifest): string | null;
  /** The writer's copied lines to look at for `text`, best first, at most `count` (the caller ties them to their letters). */
  pick<L extends { text: string }>(text: string, pool: readonly L[], count: number): L[];
  /** What the model is shown for `text`, from the lines picked (in order) and tied to their letters; null for none. */
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

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the model's manifest has no ${what}`);
  return value;
}

/** The sampler's numbers, from a manifest the dual kind has checked. */
export function samplerMeta(m: WriterManifest): WriterMeta {
  const s = need(m.sampling, "sampling");
  return {
    chars: m.chars,
    mean: need(m.rows.mean, "rows.mean"),
    std: need(m.rows.std, "rows.std"),
    maxDur: s.maxDur,
    refCurves: need(m.reference.curves, "reference.curves"),
    steps: s.steps,
    sigma: s.sigma,
    guidance: s.guidance,
    lowGuidance: s.lowGuidance,
    lowMix: s.lowMix,
    hold: need(m.reference.hold, "reference.hold"),
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

/** The dual model's three graphs over a runner, in the order of `DUAL_KIND.graphs`. */
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

const slot = (role: string, type: TensorType): Slot => ({ role, type });

/** A long's kind. */
export const DUAL_KIND: WriterKind<Reference> = {
  graphs: {
    encode: {
      inputs: [
        slot("ref.rows", "float32"),
        slot("ref.mask", "bool"),
        slot("ref.char", "int64"),
        slot("ref.place", "int64"),
        slot("ref.length", "int64"),
        slot("ref.separator", "bool"),
        slot("drop", "bool"),
      ],
      outputs: [slot("memory", "float32"), slot("valid", "bool"), slot("summary", "float32")],
    },
    durations: {
      inputs: [slot("text.char", "int64"), slot("text.mask", "bool"), slot("summary", "float32")],
      outputs: [slot("logits", "float32")],
    },
    velocity: {
      inputs: [
        slot("rows", "float32"),
        slot("time", "float32"),
        slot("mask", "bool"),
        slot("char", "int64"),
        slot("place", "int64"),
        slot("length", "int64"),
        slot("memory", "float32"),
        slot("valid", "bool"),
        slot("summary", "float32"),
      ],
      outputs: [slot("velocity", "float32")],
    },
  },
  check(m) {
    const { rows, reference, sampling: s } = m;
    if (
      !Array.isArray(rows.mean) ||
      !Array.isArray(rows.std) ||
      rows.mean.length !== rows.channels ||
      rows.std.length !== rows.channels ||
      !rows.mean.every(isNum) ||
      !rows.std.every((v) => isNum(v) && v > 0)
    )
      return "rows mean and std";
    if (!isCount(reference.curves) || !isNum(reference.hold) || reference.hold < 0)
      return "reference curves and hold";
    if (
      !s ||
      !isCount(s.steps) ||
      !isCount(s.maxDur) ||
      ![s.sigma, s.guidance, s.lowGuidance, s.lowMix].every(isNum)
    )
      return "sampling";
    return null;
  },
  pick: (text, pool, count) => pickLines(text, pool, count),
  reference: (_text, lines, m) =>
    referenceOf(
      lines
        .slice(0, m.reference.lines)
        .map((line) => calm(line, need(m.reference.hold, "reference.hold"))),
      need(m.reference.curves, "reference.curves"),
      new Map(m.chars.map((c, i) => [c, i])),
    ),
  write: (run, m, text, ref, options) =>
    writeLine(dualGraphs(run), samplerMeta(m), text, ref, options),
};

/** Every kind this build runs, by the manifest's `kind`. */
export const WRITER_KINDS: ReadonlyMap<string, WriterKind> = new Map<string, WriterKind>([
  ["dual", DUAL_KIND],
]);

/**
 * The kind that runs `m`, from `kinds`: once each graph it needs is there
 * with every input and output in the role and type it expects at that
 * position, and the kind's own sections check out; else why not.
 */
export function kindFor(
  m: WriterManifest,
  kinds: ReadonlyMap<string, WriterKind> = WRITER_KINDS,
): { kind: WriterKind } | { problem: ManifestProblem } {
  const kind = kinds.get(m.kind);
  if (!kind) return { problem: { kind: "unknown-kind", modelKind: m.kind } };
  const layout = (detail: string) => ({ problem: { kind: "layout" as const, detail } });
  for (const [role, want] of Object.entries(kind.graphs)) {
    const g = m.graphs[role];
    if (!g) return layout(`no ${role} graph`);
    const sides = [
      ["input", want.inputs, g.inputs],
      ["output", want.outputs, g.outputs],
    ] as const;
    for (const [side, mine, theirs] of sides) {
      if (mine.length !== theirs.length)
        return layout(`${role}: ${theirs.length} ${side}s, ${mine.length} expected`);
      for (let i = 0; i < mine.length; i++) {
        if (theirs[i].role !== mine[i].role || theirs[i].type !== mine[i].type)
          return layout(`${role} ${side} ${i}: ${theirs[i].role} ${theirs[i].type}`);
      }
    }
  }
  const wrong = kind.check(m);
  return wrong ? { problem: { kind: "invalid", detail: wrong } } : { kind };
}
