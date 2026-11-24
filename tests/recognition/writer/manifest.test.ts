import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { filesOfVersion, storedVersions } from "../../../src/downloads/model-manifest";
import {
  type GraphRunner,
  type Tensorish,
  type WriterKind,
  DUAL_KIND,
  WRITER_KINDS,
  kindFor,
} from "../../../src/recognition/writer/kinds";
import {
  ROW_ENCODING,
  WRITER_FORMAT,
  type WriterManifest,
  manifestFormat,
  parseManifest,
} from "../../../src/recognition/writer/manifest";
import { neatenLine } from "../../../src/recognition/writer/repair";
import { ROW, type TaggedLine } from "../../../src/recognition/writer/rows";
import type { Written } from "../../../src/recognition/writer/sampler";
import { WRITER_MODEL } from "../../../src/recognition/writer/writer-model";

/** A long's manifest as released (research/handwriting-rig/gen/neaten_v1.py `release`). */
const aLongText = readFileSync(join(__dirname, "fixtures", "dostoyev-1.0.json"), "utf8");
const aLong = (): Record<string, unknown> => JSON.parse(aLongText) as Record<string, unknown>;

const tensor = (role: string, type: "float32" | "int64" | "bool", dims: (number | string)[]) => ({
  role,
  name: role.replace(".", "_"),
  type,
  dims,
});

/**
 * A pieces model (C2), as a stub of its own: one graph that takes a line's
 * letters and the writer's letter pieces and writes the rows in one pass.
 * None of A long's sections (no sampling, no row statistics, no whole-line
 * reference size): only what every kind has.
 */
function piecesManifest(): Record<string, unknown> {
  return {
    format: 1,
    id: "pieces-stub",
    version: "2.0",
    kind: "pieces",
    graphs: {
      write: {
        file: "dostoyev-2.0-write.onnx",
        inputs: [tensor("text.char", "int64", [1, "L"]), tensor("pieces", "float32", [1, "P"])],
        outputs: [tensor("rows", "float32", [1, "T", 10])],
      },
    },
    rows: { encoding: ROW_ENCODING, channels: 10, tol: 0.01, norm: "skew=0,slant=0,scale=core" },
    reference: { lines: 4 },
    chars: ["<blank>", " ", "a", "b", "c", "d", "e", "o", "g"],
  };
}

/** What the stub pieces kind shows its model: the letters of the text found in the writer's lines. */
interface Pieces {
  letters: string;
}

const PIECES_KIND: WriterKind<Pieces> = {
  graphs: {
    write: {
      inputs: [
        { role: "text.char", type: "int64" },
        { role: "pieces", type: "float32" },
      ],
      outputs: [{ role: "rows", type: "float32" }],
    },
  },
  check: () => null,
  // The lines holding any of the text's letters, unlike A long's ranking by shared letters.
  pick: (text, pool, count) =>
    pool.filter((l) => [...text].some((c) => l.text.includes(c))).slice(0, count),
  reference: (text, lines) => ({
    letters: [...new Set(text)].filter((c) => lines.some((l) => l.text.includes(c))).join(""),
  }),
  async write(run, m, text, ref) {
    const ids = [...text].map((c) => m.chars.indexOf(c));
    const [rows] = await run("write", [
      { type: "int64", data: BigInt64Array.from(ids.map(BigInt)), dims: [1, ids.length] },
      {
        type: "float32",
        data: Float32Array.from([...ref.letters].map((c) => c.charCodeAt(0))),
        dims: [1, ref.letters.length],
      },
    ]);
    const x = rows.data as Float32Array;
    const n = x.length / ROW;
    return { x, n, char: Int32Array.from({ length: n }, (_, i) => Math.min(i, text.length - 1)) };
  },
};

const BOTH = new Map<string, WriterKind>([...WRITER_KINDS, ["pieces", PIECES_KIND as WriterKind]]);

function parsed(json: unknown, kinds: ReadonlySet<string> = new Set(BOTH.keys())): WriterManifest {
  const out = parseManifest(json, kinds);
  if ("problem" in out) throw new Error(JSON.stringify(out.problem));
  return out.manifest;
}

describe("parseManifest", () => {
  it("reads A long's released manifest, and the dual kind runs it", () => {
    const m = parsed(aLong(), new Set(WRITER_KINDS.keys()));
    expect(m).toMatchObject({ format: WRITER_FORMAT, id: "dostoyev", kind: "dual" });
    expect(Object.keys(m.graphs).sort()).toEqual(["durations", "encode", "velocity"]);
    expect(kindFor(m)).toEqual({ kind: DUAL_KIND });
  });

  it("reads a pieces model's manifest, which has none of A long's sections, and the pieces kind runs it", () => {
    const m = parsed(piecesManifest());
    expect(m.sampling).toBeUndefined();
    expect(kindFor(m, BOTH)).toEqual({ kind: PIECES_KIND });
  });

  it("refuses a kind this build does not have (not run as another kind)", () => {
    expect(parseManifest(piecesManifest(), new Set(WRITER_KINDS.keys()))).toEqual({
      problem: { kind: "unknown-kind", modelKind: "pieces" },
    });
  });

  it.each([0, 1.5, -1])("calls format %s invalid", (format) => {
    const out = parseManifest({ ...aLong(), format }, new Set(["dual"]));
    expect("problem" in out && out.problem.kind).toBe("invalid");
  });

  it("refuses a newer format before reading anything else", () => {
    expect(parseManifest({ format: WRITER_FORMAT + 1 }, new Set(["dual"]))).toEqual({
      problem: { kind: "newer", format: WRITER_FORMAT + 1 },
    });
  });

  it.each([
    ["another encoding", { encoding: "points-v3" }],
    ["another number of channels", { channels: 12 }],
  ])("refuses rows of %s", (_name, change) => {
    const json = aLong();
    json.rows = { ...(json.rows as object), ...change };
    const out = parseManifest(json, new Set(["dual"]));
    expect("problem" in out && out.problem.kind).toBe("rows");
  });

  it.each([
    ["no chars", (j: Record<string, unknown>) => delete j.chars],
    [
      "no lines shown",
      (j: Record<string, unknown>) => ((j.reference as { lines: number }).lines = 0),
    ],
    ["no tolerance", (j: Record<string, unknown>) => delete (j.rows as { tol?: number }).tol],
    [
      "a tensor without a role",
      (j: Record<string, unknown>) =>
        ((j.graphs as Record<string, { inputs: unknown[] }>).encode.inputs[0] = {
          name: "rx",
          type: "float32",
          dims: [1],
        }),
    ],
    ["not an object", (j: Record<string, unknown>) => Object.keys(j).forEach((k) => delete j[k])],
  ])("calls a manifest with %s invalid", (_name, spoil) => {
    const json = aLong();
    spoil(json);
    const out = parseManifest(json, new Set(["dual"]));
    expect("problem" in out && out.problem.kind).toBe("invalid");
  });
});

describe("kindFor", () => {
  it("refuses graphs laid out otherwise: a missing graph, an extra output", () => {
    const json = aLong();
    delete (json.graphs as Record<string, unknown>).durations;
    expect(kindFor(parsed(json))).toMatchObject({ problem: { kind: "layout" } });
    const two = aLong();
    (two.graphs as Record<string, { outputs: unknown[] }>).velocity.outputs.push(
      tensor("extra", "float32", [1]),
    );
    expect(kindFor(parsed(two))).toMatchObject({ problem: { kind: "layout" } });
  });

  it("refuses two inputs of one type in swapped places, which would run without an error", () => {
    const json = aLong();
    const inputs = (json.graphs as Record<string, { inputs: unknown[] }>).encode.inputs;
    [inputs[2], inputs[3]] = [inputs[3], inputs[2]]; // ref.char and ref.place, both int64 [1, R]
    expect(kindFor(parsed(json))).toEqual({
      problem: { kind: "layout", detail: "encode input 2: ref.place int64" },
    });
  });

  it("refuses an input of another type at its place", () => {
    const json = aLong();
    const inputs = (json.graphs as Record<string, { inputs: { type: string }[] }>).encode.inputs;
    inputs[1].type = "int64";
    expect(kindFor(parsed(json))).toMatchObject({ problem: { kind: "layout" } });
  });

  it("leaves a kind's own sections to the kind: A long without sampling is refused, the pieces model needs none", () => {
    const json = aLong();
    delete json.sampling;
    expect(kindFor(parsed(json))).toEqual({ problem: { kind: "invalid", detail: "sampling" } });
    expect("kind" in kindFor(parsed(piecesManifest()), BOTH)).toBe(true);
  });
});

describe("one Neaten for both shapes", () => {
  const line = (text: string): TaggedLine => ({
    text,
    x: new Float32Array(3 * ROW),
    n: 3,
    char: Int32Array.from([0, 1, 2]),
  });
  const pool = [line("cab"), line("dog"), line("bed")];

  /** A runner standing in for ORT: answers each graph with tensors of the shapes the manifest says. */
  function runner(m: WriterManifest, log: string[]): GraphRunner {
    return (role, inputs) => {
      log.push(role);
      const spec = m.graphs[role];
      expect(inputs.map((t) => t.type)).toEqual(spec.inputs.map((s) => s.type));
      return Promise.resolve(
        spec.outputs.map((o): Tensorish => {
          if (o.role === "logits") {
            const L = inputs[0].dims[1];
            const D = m.sampling?.maxDur ?? 1;
            const data = new Float32Array(L * D);
            for (let i = 0; i < L; i++) data[i * D] = 1; // one row a letter
            return { type: "float32", data, dims: [1, L, D] };
          }
          if (o.role === "summary")
            return { type: "float32", data: new Float32Array(256), dims: [1, 256] };
          if (o.role === "valid") return { type: "bool", data: new Uint8Array(4), dims: [1, 4] };
          if (o.role === "memory")
            return { type: "float32", data: new Float32Array(4 * 256), dims: [1, 4, 256] };
          // velocity, or the pieces model's rows: one row per input row or letter
          const T = inputs[0].dims[1];
          return { type: "float32", data: new Float32Array(T * ROW), dims: [1, T, ROW] };
        }),
      );
    };
  }

  it.each([
    ["A long (dual)", aLong, new Map([["dual", DUAL_KIND as WriterKind]])],
    ["a pieces model (stub)", piecesManifest, BOTH],
  ])(
    "picks, shows, writes and repairs a line with %s, through its kind alone",
    async (_name, make, kinds) => {
      const m = parsed(make(), new Set(kinds.keys()));
      const found = kindFor(m, kinds);
      if ("problem" in found) throw new Error(JSON.stringify(found.problem));
      const kind = found.kind;
      const log: string[] = [];
      const run = runner(m, log);
      const picked = kind.pick("bad", pool, m.reference.lines + 2);
      expect(picked.length).toBeGreaterThan(0);
      const ref = kind.reference("bad", picked, m);
      expect(ref).not.toBeNull();
      const done = await neatenLine(
        "bad",
        ref,
        0,
        (text, r, seed, id, low): Promise<Written> =>
          kind.write(run, m, text, r, { seed, id, low }),
        () => Promise.resolve("bad"),
        { seed: 0, tries: 2, repair: true },
      );
      expect(done?.written.n).toBeGreaterThan(0);
      // Each kind ran only its own graphs.
      expect([...new Set(log)].sort()).toEqual(Object.keys(kind.graphs).sort());
    },
  );
});

describe("versions of the writer in its folder", () => {
  const current = WRITER_MODEL.files.map((f) => f.name);

  it("knows its own manifest as current and other versions by their manifest, whatever the model family", () => {
    const names = [
      ...current,
      "dostoyev-0.9.json",
      "dostoyev-0.9-encode.int8.onnx",
      "dostoyev-2.0.json",
    ];
    const found = storedVersions(WRITER_MODEL, names);
    expect(found.current).toBe(true);
    expect(found.others.map((o) => o.version)).toEqual(["2.0", "0.9"]);
  });

  it("gives a superseded version its graphs too, so it goes whole", () => {
    const names = [
      ...current,
      "dostoyev-0.9.json",
      "dostoyev-0.9-encode.int8.onnx",
      "dostoyev-0.9-velocity.int8.onnx",
    ];
    expect(
      filesOfVersion(WRITER_MODEL, names, { version: "0.9", file: "dostoyev-0.9.json" }).sort(),
    ).toEqual([
      "dostoyev-0.9-encode.int8.onnx",
      "dostoyev-0.9-velocity.int8.onnx",
      "dostoyev-0.9.json",
    ]);
  });

  it("reads a stored manifest's format for the store, and nothing from a file that is not one", () => {
    expect(manifestFormat(aLongText)).toBe(WRITER_FORMAT);
    expect(manifestFormat(JSON.stringify({ ...aLong(), format: 2 }))).toBe(2);
    expect(manifestFormat("not json")).toBeNull();
    expect(manifestFormat(JSON.stringify({ format: 1 }))).toBeNull();
  });
});
