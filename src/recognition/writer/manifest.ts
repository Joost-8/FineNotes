/**
 * What a handwriting writer model is, read from the manifest it ships with
 * (`writer-<version>.json`, written by research/handwriting-rig/gen/
 * neaten_v1.py `release`): which kind of model it is, its graphs with
 * every input and output (by role, type and shape), the curve rows it reads
 * and writes, how much of a writer it is shown, and its characters. What
 * only one kind of model has (A long's sampling) is in sections that kind
 * checks itself (`kinds.ts`).
 *
 * Nothing in Neaten is tied to one model: the manifest's `kind` chooses the
 * code that builds the reference and samples, and a manifest this build
 * cannot run (a newer format, an unknown kind, graphs laid out otherwise,
 * rows of another format) is refused with the reason, never run wrongly.
 *
 * PURE: no DOM, no Obsidian.
 */

import { ROW } from "./rows";

/** The manifest format this build reads. A model whose `format` is higher is refused. */
export const WRITER_FORMAT = 1;

/** The curve rows this build makes from ink and draws as ink (`hwr/curves.ts`, `rows.ts`). */
export const ROW_ENCODING = "grape2-raw";

export type TensorType = "float32" | "int64" | "bool";

/** One input or output of a graph: what it is to the kind (`role`), its name in the graph, type and dimensions. */
export interface TensorSpec {
  role: string;
  name: string;
  type: TensorType;
  dims: (number | string)[];
}

/** One ONNX graph of the model: its file, inputs and outputs, in the order its kind passes them. */
export interface GraphSpec {
  file: string;
  inputs: TensorSpec[];
  outputs: TensorSpec[];
}

export interface WriterManifest {
  format: number;
  /** The model family ("a-long") and this file's version. */
  id: string;
  version: string;
  /** Which code runs it (`kinds.ts`): "dual" is A long's. */
  kind: string;
  /** The graphs by the role the kind gives them ("encode", "durations", "velocity", …). */
  graphs: Record<string, GraphSpec>;
  rows: {
    encoding: string;
    channels: number;
    /** Curve-fitting tolerance and normalisation the model was trained on: the reader's must be the same. */
    tol: number;
    norm: string;
    /** Per channel, for a kind that normalises rows (A long's velocity). */
    mean?: number[];
    std?: number[];
  };
  reference: {
    /** Lines of the writer's ink shown per written line. */
    lines: number;
    /** For a kind that shows whole lines: rows shown, and the longest pen jump shown. */
    curves?: number;
    hold?: number;
  };
  /** For a flow-matching kind (A long): steps, noise, guidance and the repair's settings. */
  sampling?: {
    steps: number;
    sigma: number;
    guidance: number;
    lowGuidance: number;
    lowMix: number;
    maxDur: number;
  };
  /** The model's characters; index 0 is the blank, a character's id is its index. */
  chars: string[];
}

/** Why a manifest cannot be run here. */
export type ManifestProblem =
  | { kind: "newer"; format: number }
  | { kind: "unknown-kind"; modelKind: string }
  | { kind: "layout"; detail: string }
  | { kind: "rows"; detail: string }
  | { kind: "invalid"; detail: string };

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const TYPES = new Set(["float32", "int64", "bool"]);

function tensorOk(t: unknown): t is TensorSpec {
  if (!t || typeof t !== "object") return false;
  const s = t as Partial<TensorSpec>;
  return (
    isStr(s.role) &&
    isStr(s.name) &&
    TYPES.has(s.type as string) &&
    Array.isArray(s.dims) &&
    s.dims.every((d) => isNum(d) || isStr(d))
  );
}

/**
 * The manifest in `json` checked for what every kind of model has: its
 * format, rows this build makes, its graphs, characters and how many lines
 * it is shown; and that `kinds` (the kinds this build has) holds its kind.
 * What the kind itself needs is `kindFor`'s check. A problem says which,
 * for the message the user sees.
 */
export function parseManifest(
  json: unknown,
  kinds: ReadonlySet<string>,
): { manifest: WriterManifest } | { problem: ManifestProblem } {
  const invalid = (detail: string) => ({ problem: { kind: "invalid" as const, detail } });
  if (!json || typeof json !== "object") return invalid("not an object");
  const m = json as Partial<WriterManifest>;
  if (!isCount(m.format)) return invalid("no format");
  // A newer format may change anything below: say so before reading further.
  if (m.format > WRITER_FORMAT) return { problem: { kind: "newer", format: m.format } };
  if (!isStr(m.id) || !isStr(m.version) || !isStr(m.kind)) return invalid("no id, version or kind");
  const r = m.rows;
  if (!r || !isStr(r.encoding)) return invalid("no rows");
  if (r.encoding !== ROW_ENCODING || r.channels !== ROW)
    return { problem: { kind: "rows", detail: `${r.encoding} with ${r.channels} channels` } };
  if (!isNum(r.tol) || r.tol <= 0 || !isStr(r.norm)) return invalid("rows tol and norm");
  if (!kinds.has(m.kind)) return { problem: { kind: "unknown-kind", modelKind: m.kind } };
  if (!m.reference || !isCount(m.reference.lines)) return invalid("reference lines");
  if (!Array.isArray(m.chars) || m.chars.length < 2 || !m.chars.every((c) => typeof c === "string"))
    return invalid("chars");
  if (!m.graphs || typeof m.graphs !== "object" || Object.keys(m.graphs).length === 0)
    return invalid("graphs");
  for (const [role, g] of Object.entries(m.graphs)) {
    if (!g || !isStr(g.file) || !Array.isArray(g.inputs) || !Array.isArray(g.outputs))
      return invalid(`graph ${role}`);
    if (!g.inputs.every(tensorOk) || !g.outputs.every(tensorOk))
      return invalid(`graph ${role} tensors`);
  }
  return { manifest: m as WriterManifest };
}

/** The format of a stored manifest file, for the download store (null: not a writer manifest). */
export function manifestFormat(text: string): number | null {
  try {
    const m = JSON.parse(text) as Partial<WriterManifest>;
    return isCount(m.format) && isStr(m.kind) ? m.format : null;
  } catch {
    return null;
  }
}
