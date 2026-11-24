import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { storedVersions } from "../../../src/downloads/model-manifest";
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
const aLongText = readFileSync(join(__dirname, "fixtures", "a-long-1.0.json"), "utf8");
const aLong = (): Record<string, unknown> => JSON.parse(aLongText) as Record<string, unknown>;

const spec = (name: string, type: "float32" | "int64" | "bool" = "float32") => ({
  name,
  type,
  dims: [1, "T"],
});

/**
 * A pieces model (C2), as a stub: one graph that takes a line's letters and
 * the writer's letter pieces and writes the rows in one pass. Its reference
 * is the letters the text needs, not whole lines.
 */
function piecesManifest(): Record<string, unknown> {
  return {
    ...aLong(),
    id: "pieces-stub",
    version: "0.1",
    kind: "pieces",
    graphs: {
      write: {
        file: "pieces-stub-0.1-write.onnx",
        inputs: [spec("letters", "int64"), spec("pieces")],
        outputs: [spec("rows")],
      },
    },
  };
}

/** What the stub pieces kind shows its model: the letters of the text found in the writer's lines. */
interface Pieces {
  letters: string;
}

const PIECES_KIND: WriterKind<Pieces> = {
  graphs: { write: { inputs: 2, outputs: 1 } },
  // The lines holding the most of the text's letters that are still missing, unlike A long's ranking.
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
    return {
      x,
      n: x.length / ROW,
      char: Int32Array.from({ length: x.length / ROW }, (_, i) => Math.min(i, text.length - 1)),
    };
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
    expect(m).toMatchObject({ format: WRITER_FORMAT, id: "a-long", kind: "dual" });
    expect(m.rows.encoding).toBe(ROW_ENCODING);
    expect(Object.keys(m.graphs).sort()).toEqual(["durations", "encode", "velocity"]);
    expect(kindFor(m)).toEqual({ kind: DUAL_KIND });
  });

  it("reads a pieces model's manifest, a model of another shape, and the pieces kind runs it", () => {
    const m = parsed(piecesManifest());
    expect(m.kind).toBe("pieces");
    expect(kindFor(m, BOTH)).toEqual({ kind: PIECES_KIND });
  });

  it("refuses a kind this build does not have, saying so (not run as another kind)", () => {
    expect(parseManifest(piecesManifest(), new Set(WRITER_KINDS.keys()))).toEqual({
      problem: { kind: "unknown-kind", modelKind: "pieces" },
    });
  });

  it("refuses a newer format before reading anything else", () => {
    expect(parseManifest({ format: WRITER_FORMAT + 1 }, new Set(["dual"]))).toEqual({
      problem: { kind: "newer", format: WRITER_FORMAT + 1 },
    });
  });

  it("refuses rows of another format", () => {
    const json = aLong();
    json.rows = { ...(json.rows as object), encoding: "points-v3" };
    expect(parseManifest(json, new Set(["dual"]))).toEqual({
      problem: { kind: "rows", encoding: "points-v3" },
    });
  });

  it.each([
    ["no chars", (j: Record<string, unknown>) => delete j.chars],
    ["a short mean", (j: Record<string, unknown>) => ((j.rows as { mean: number[] }).mean = [0])],
    [
      "no sampling steps",
      (j: Record<string, unknown>) => ((j.sampling as { steps?: number }).steps = 0),
    ],
    [
      "a tensor without a type",
      (j: Record<string, unknown>) =>
        ((j.graphs as Record<string, { inputs: unknown[] }>).encode.inputs[0] = {
          name: "rx",
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
  it("refuses a model whose graphs are not the ones its kind runs", () => {
    const json = aLong();
    delete (json.graphs as Record<string, unknown>).durations;
    expect(kindFor(parsed(json))).toEqual({ problem: "no durations graph" });
    const two = aLong();
    (two.graphs as Record<string, { outputs: unknown[] }>).velocity.outputs.push(spec("extra"));
    expect("problem" in kindFor(parsed(two))).toBe(true);
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
      log.push(`${role}:${inputs.length}`);
      expect(inputs).toHaveLength(m.graphs[role].inputs.length);
      return Promise.resolve(
        m.graphs[role].outputs.map((o): Tensorish => {
          if (role === "durations") {
            const L = inputs[0].dims[1];
            const D = m.sampling.maxDur;
            const data = new Float32Array(L * D);
            for (let i = 0; i < L; i++) data[i * D] = 1; // one row a letter
            return { type: "float32", data, dims: [1, L, D] };
          }
          if (o.name === "g")
            return { type: "float32", data: new Float32Array(256), dims: [1, 256] };
          if (o.name === "valid") return { type: "bool", data: new Uint8Array(4), dims: [1, 4] };
          if (o.name === "mem")
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
      if ("problem" in found) throw new Error(found.problem);
      const kind = found.kind;
      const log: string[] = [];
      const run = runner(m, log);
      const shown = kind.pick("bad", pool, 2);
      expect(shown.length).toBeGreaterThan(0);
      const ref = kind.reference("bad", shown, m);
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
      // Each kind ran only its own graphs, with the manifest's number of inputs.
      const roles = new Set(log.map((l) => l.split(":")[0]));
      expect([...roles].sort()).toEqual(Object.keys(kind.graphs).sort());
    },
  );
});

describe("versions of the writer in its folder", () => {
  it("knows its own manifest as current and another version's as older, by name", () => {
    const names = [...WRITER_MODEL.files.map((f) => f.name), "a-long-0.9.json"];
    const found = storedVersions(WRITER_MODEL, names);
    expect(found.current).toBe(true);
    expect(found.others).toEqual([{ version: "0.9", file: "a-long-0.9.json" }]);
  });

  it("reads a stored manifest's format for the store, and nothing from a file that is not one", () => {
    expect(manifestFormat(aLongText)).toBe(WRITER_FORMAT);
    expect(manifestFormat(JSON.stringify({ ...aLong(), format: 2 }))).toBe(2);
    expect(manifestFormat("not json")).toBeNull();
    expect(manifestFormat(JSON.stringify({ format: 1 }))).toBeNull();
  });
});
