/**
 * What a handwriting writer model is, read from the manifest it ships with
 * (`writer-<version>.json`, written by research/handwriting-rig/gen/
 * neaten_v1.py meta): which kind of model it is, its graphs and their
 * inputs and outputs, the curve rows it reads and writes, how much of a
 * writer it is shown, how it samples, and its characters.
 *
 * Nothing in Neaten is tied to one model: the manifest's `kind` chooses the
 * code that builds the reference and samples (`kinds.ts`), and a manifest
 * this build cannot run (a newer format, an unknown kind, rows of another
 * format) is refused with the reason, never run wrongly.
 *
 * PURE: no DOM, no Obsidian.
 */

/** The manifest format this build reads. A model whose `format` is higher is refused. */
export const WRITER_FORMAT = 1;

/** The curve rows this build makes from ink and draws as ink (`hwr/curves.ts`, `rows.ts`). */
export const ROW_ENCODING = "grape2-raw";

/** One input or output of a graph: its name, element type and dimensions (a name for a free one). */
export interface TensorSpec {
  name: string;
  type: "float32" | "int64" | "bool";
  dims: (number | string)[];
}

/** One ONNX graph of the model: its file, inputs and outputs, in the order its kind expects them. */
export interface GraphSpec {
  file: string;
  inputs: TensorSpec[];
  outputs: TensorSpec[];
}

export interface WriterManifest {
  format: number;
  /** Stable id of the model family ("a-long"), and this file's version. */
  id: string;
  version: string;
  /** Which code runs it (`kinds.ts`): "dual" is A long's (a reference encoded twice, letter lengths, velocity). */
  kind: string;
  /** The graphs by the role the kind gives them ("encode", "durations", "velocity", …). */
  graphs: Record<string, GraphSpec>;
  rows: {
    encoding: string;
    channels: number;
    /** Curve-fitting tolerance and normalisation the model was trained on (Grape 2's). */
    tol: number;
    norm: string;
    /** Per channel: the velocity works on rows normalised by these. */
    mean: number[];
    std: number[];
  };
  reference: {
    /** Rows of the writer's ink shown per line, from how many lines, and the longest pen jump shown. */
    curves: number;
    lines: number;
    hold: number;
  };
  sampling: {
    steps: number;
    sigma: number;
    guidance: number;
    /** Guidance on letters the repair rewrites, and how much of the writer's summary sets their length. */
    lowGuidance: number;
    lowMix: number;
    /** Most rows one character may get. */
    maxDur: number;
  };
  /** The model's characters; index 0 is the blank, a character's id is its index. */
  chars: string[];
}

/** Why a manifest cannot be run here. */
export type ManifestProblem =
  | { kind: "newer"; format: number }
  | { kind: "unknown-kind"; modelKind: string }
  | { kind: "rows"; encoding: string }
  | { kind: "invalid"; detail: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function tensorOk(t: unknown): t is TensorSpec {
  if (!t || typeof t !== "object") return false;
  const s = t as Partial<TensorSpec>;
  return (
    isStr(s.name) &&
    (s.type === "float32" || s.type === "int64" || s.type === "bool") &&
    Array.isArray(s.dims) &&
    s.dims.every((d) => isNum(d) || isStr(d))
  );
}

/**
 * The manifest in `json` checked against what this build can run: its
 * format, its row encoding and (given `kinds`, the kinds this build has)
 * its kind. A problem says which, for the message the user sees.
 */
export function parseManifest(
  json: unknown,
  kinds: ReadonlySet<string>,
): { manifest: WriterManifest } | { problem: ManifestProblem } {
  const invalid = (detail: string) => ({ problem: { kind: "invalid" as const, detail } });
  if (!json || typeof json !== "object") return invalid("not an object");
  const m = json as Partial<WriterManifest>;
  if (!isNum(m.format)) return invalid("no format");
  // A newer format may change anything below: say so before reading further.
  if (m.format > WRITER_FORMAT) return { problem: { kind: "newer", format: m.format } };
  if (!isStr(m.id) || !isStr(m.version) || !isStr(m.kind)) return invalid("no id, version or kind");
  if (!m.rows || !isStr(m.rows.encoding)) return invalid("no rows");
  if (m.rows.encoding !== ROW_ENCODING)
    return { problem: { kind: "rows", encoding: m.rows.encoding } };
  if (!kinds.has(m.kind)) return { problem: { kind: "unknown-kind", modelKind: m.kind } };
  const r = m.rows;
  if (!isNum(r.channels) || !isNum(r.tol) || !isStr(r.norm)) return invalid("rows incomplete");
  if (
    !Array.isArray(r.mean) ||
    !Array.isArray(r.std) ||
    r.mean.length !== r.channels ||
    r.std.length !== r.channels
  )
    return invalid("rows mean/std");
  if (!r.mean.every(isNum) || !r.std.every(isNum)) return invalid("rows mean/std");
  const ref = m.reference;
  if (!ref || !isNum(ref.curves) || !isNum(ref.lines) || !isNum(ref.hold))
    return invalid("reference");
  const s = m.sampling;
  if (
    !s ||
    ![s.steps, s.sigma, s.guidance, s.lowGuidance, s.lowMix, s.maxDur].every(isNum) ||
    s.steps < 1 ||
    s.maxDur < 1
  )
    return invalid("sampling");
  if (!Array.isArray(m.chars) || m.chars.length < 2 || !m.chars.every((c) => typeof c === "string"))
    return invalid("chars");
  if (!m.graphs || typeof m.graphs !== "object") return invalid("graphs");
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
    return isNum(m.format) && isStr(m.kind) ? m.format : null;
  } catch {
    return null;
  }
}
