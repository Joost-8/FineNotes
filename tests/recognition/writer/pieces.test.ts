import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { kindFor } from "../../../src/recognition/writer/kinds";
import { parseManifest, type WriterManifest } from "../../../src/recognition/writer/manifest";
import { guidanceAt, neatnessOf } from "../../../src/recognition/writer/neatness";
import {
  LETTER,
  LINE,
  PIECES_KIND,
  WORD,
  WORD_MAX,
  assemble,
  bankOf,
  mixedReference,
  piecesGraphs,
  uniform,
} from "../../../src/recognition/writer/pieces";
import { ROW, type TaggedLine } from "../../../src/recognition/writer/rows";
import type { Tensorish } from "../../../src/recognition/writer/tensors";

const CHARS = ["<b>", " ", ..."abcdefghijklmnopqrstuvwxyzJK,.".split("")];
const INDEX = new Map(CHARS.map((c, i) => [c, i]));

/**
 * A tagged line: each letter two pen-down rows, each space one pen-up row.
 * With `lifts`, each letter also ends in a pen-up row of its own (the pen
 * lifts between letters, so each is a lone letter too).
 */
function line(text: string, lifts = false): TaggedLine {
  const rows: number[][] = [];
  const char: number[] = [];
  for (const [u, c] of [...text].entries()) {
    const n = c === " " ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const r = new Array<number>(ROW).fill(0);
      r[0] = u + i / 2; // where it is, to tell rows apart
      r[ROW - 1] = c === " " ? 1 : 0;
      rows.push(r);
      char.push(u);
    }
    if (lifts && c !== " ") {
      const r = new Array<number>(ROW).fill(0);
      r[ROW - 1] = 1;
      rows.push(r);
      char.push(u);
    }
  }
  return { text, x: Float32Array.from(rows.flat()), n: rows.length, char: Int32Array.from(char) };
}

describe("bankOf", () => {
  it("keeps every line whole, its words, and the letters with a pen lift on both sides", () => {
    const bank = bankOf([line("ab cd"), line("ef g", true)], INDEX);
    expect(bank.lines.map((l) => [l.n, l.unit])).toEqual([
      [9, LINE],
      [10, LINE],
    ]);
    expect(
      bank.words.map((w) => [w.line, [...w.piece.chars].join(""), w.piece.n, w.piece.unit]),
    ).toEqual([
      [0, "ab", 4, WORD],
      [0, "cd", 4, WORD],
      [1, "ef", 5, WORD], // the lift after f is stripped, the one between e and f is inside
      [1, "g", 2, WORD],
    ]);
    // Joined letters ("ab", "cd") are not lone letters; lifted ones are, without their lift.
    expect([...bank.letters.keys()].sort()).toEqual(["e", "f", "g"]);
    expect(bank.letters.get("e")?.[0].piece).toMatchObject({ n: 2, unit: LETTER });
    expect(bank.byChar.get("c")).toEqual([1]);
  });

  it("tags a piece's rows with its own places in its characters, and the model's ids", () => {
    const bank = bankOf([line("ab cd")], INDEX);
    const cd = bank.words[1].piece;
    expect([...cd.cid]).toEqual([INDEX.get("c"), INDEX.get("c"), INDEX.get("d"), INDEX.get("d")]);
    expect([...cd.k]).toEqual([0, 1, 0, 1]);
    expect([...cd.d]).toEqual([2, 2, 2, 2]);
    expect(cd.x[0]).toBe(3); // the rows of "cd", not of the line's start
  });

  it("leaves out a word longer than WORD_MAX rows", () => {
    const long = "abcdefghijklmnop"; // 32 rows
    expect(2 * long.length).toBeGreaterThan(WORD_MAX);
    expect(bankOf([line(long)], INDEX).words).toHaveLength(0);
  });
});

describe("mixedReference", () => {
  const bank = bankOf(
    [line("ab cd"), line("ef gh"), line("kj ij", true), line("mn op"), line("qr st")],
    INDEX,
  );
  const opts = { size: 256, letters: 0, otherCase: false };

  it("starts with a whole line, then pieces after separators, each row tagged with its place, piece and kind", () => {
    const ref = mixedReference(bank, "ab", uniform(1), opts);
    expect(ref).not.toBeNull();
    if (!ref) return;
    expect(ref.unit[0]).toBe(LINE);
    expect(ref.seg[0]).toBe(0);
    for (let i = 0; i < ref.n; i++) {
      if (ref.sep[i]) {
        expect(ref.pos[i]).toBe(0);
        expect(ref.cid[i]).toBe(0);
        expect(ref.x[i * ROW + ROW - 1]).toBe(1);
        expect(ref.seg[i]).toBe(ref.seg[i - 1] + 1);
      } else if (i > 0 && !ref.sep[i - 1] && ref.seg[i] === ref.seg[i - 1]) {
        // a separator and its piece's first row are both at place 0, as inkref.mixed_reference counts
        expect(ref.pos[i]).toBe(ref.pos[i - 1] + 1);
      }
    }
    expect(Math.max(...ref.seg)).toBeGreaterThan(0);
  });

  it("shows a piece holding each character the text needs and the line lacks", () => {
    for (let seed = 0; seed < 20; seed++) {
      const ref = mixedReference(bank, "ab ef qr", uniform(seed), opts);
      const shown = new Set([...(ref?.cid ?? [])].map((id) => CHARS[id]));
      for (const c of "abefqr") expect(shown.has(c)).toBe(true);
    }
  });

  it("looks for a capital the writer never wrote in the other case, only when asked", () => {
    const has = (o: typeof opts, seed: number): boolean =>
      [...(mixedReference(bank, "J", uniform(seed), o)?.cid ?? [])].includes(INDEX.get("j") ?? -1);
    // Without other case, j is shown only when a random fill-in word happens to hold it.
    const seeds = Array.from({ length: 20 }, (_, i) => i);
    expect(seeds.every((s) => has({ ...opts, otherCase: true }, s))).toBe(true);
  });

  it("with letters 1, shows the lone letter rather than a word when the writer has one", () => {
    const ref = mixedReference(bank, "i", uniform(3), { ...opts, letters: 1 });
    expect(ref && [...ref.unit].includes(LETTER)).toBe(true);
  });

  it("is cut at its size and repeats for a seed", () => {
    const a = mixedReference(bank, "ab ef", uniform(7), { ...opts, size: 12 });
    const b = mixedReference(bank, "ab ef", uniform(7), { ...opts, size: 12 });
    expect(a?.n).toBeLessThanOrEqual(12);
    expect(a).toEqual(b);
  });

  it("is null with nothing to show", () => {
    expect(mixedReference(bankOf([], INDEX), "a", uniform(1), opts)).toBeNull();
  });
});

describe("assemble", () => {
  it("puts a separator before each piece after the first", () => {
    const bank = bankOf([line("ab cd")], INDEX);
    const ref = assemble([bank.lines[0], bank.words[0].piece], 100);
    expect(ref.n).toBe(9 + 1 + 4);
    expect([...ref.sep].indexOf(1)).toBe(9);
    expect(ref.unit[10]).toBe(WORD);
  });
});

describe("uniform", () => {
  it("stays in [0, 1) with a mean near a half", () => {
    const r = uniform(5);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(Math.abs(sum / 10000 - 0.5)).toBeLessThan(0.02);
  });
});

describe("Dostoyev 2.0 (C2) through its manifest", () => {
  const text = readFileSync(join(__dirname, "fixtures", "dostoyev-2.0.json"), "utf8");
  const parsed = parseManifest(JSON.parse(text), new Set(["dual", "pieces"]));
  if ("problem" in parsed) throw new Error(JSON.stringify(parsed.problem));
  const m: WriterManifest = parsed.manifest;

  it("is run by the pieces kind, at guidance 1, best of 2, lone letters and the other case", () => {
    expect(kindFor(m)).toEqual({ kind: PIECES_KIND });
    expect(m.sampling).toMatchObject({ guidance: 1, tries: 2 });
    expect(m.reference).toMatchObject({ letters: 0.5, otherCase: true });
  });

  it("refuses a lone-letter share outside 0 to 1", () => {
    const json = JSON.parse(text) as { reference: { letters: number } };
    json.reference.letters = 2;
    const p = parseManifest(json, new Set(["pieces"]));
    if ("problem" in p) throw new Error("parsed");
    expect(kindFor(p.manifest)).toEqual({
      problem: { kind: "invalid", detail: "reference letters" },
    });
  });

  it("passes each graph its inputs in the manifest's order and types", async () => {
    const seen: Record<string, string[]> = {};
    const graphs = piecesGraphs((role, inputs) => {
      seen[role] = inputs.map((t) => t.type);
      expect(inputs.map((t) => t.type)).toEqual(m.graphs[role].inputs.map((s) => s.type));
      const out = (
        data: Tensorish["data"],
        dims: number[],
        type: Tensorish["type"],
      ): Tensorish => ({ type, data, dims });
      if (role === "encode")
        return Promise.resolve([
          out(new Float32Array(4), [1, 1, 4], "float32"),
          out(new Uint8Array(1), [1, 1], "bool"),
          out(new Float32Array(4), [1, 4], "float32"),
        ]);
      if (role === "durations")
        return Promise.resolve([out(new Float32Array(14), [1, 1, 14], "float32")]);
      return Promise.resolve([out(new Float32Array(ROW), [1, 1, ROW], "float32")]);
    });
    const ref = mixedReference(bankOf([line("ab cd")], INDEX), "ab", uniform(1), {
      size: 256,
      letters: 0.5,
      otherCase: true,
    });
    if (!ref) throw new Error("no reference");
    const enc = await graphs.encode(ref, false);
    await graphs.durations(Int32Array.from([1]), enc.g);
    await graphs.velocity(
      new Float32Array(ROW),
      0,
      Int32Array.from([1]),
      Int32Array.from([0]),
      Int32Array.from([1]),
      enc,
    );
    expect(Object.keys(seen).sort()).toEqual(["durations", "encode", "velocity"]);
  });
});

describe("neatness", () => {
  it("maps the slider to 1.2, 1 and 0.75 times the model's guidance at its ends and middle", () => {
    expect(guidanceAt(0, 1)).toBeCloseTo(1.2);
    expect(guidanceAt(0.5, 1)).toBeCloseTo(1);
    expect(guidanceAt(1, 1)).toBeCloseTo(0.75);
    expect(guidanceAt(0.75, 1)).toBeCloseTo(0.875);
    expect(guidanceAt(0.25, 1.5)).toBeCloseTo(1.65);
  });

  it("reads a missing or broken setting as the middle, and holds it to 0..1", () => {
    expect(neatnessOf(undefined)).toBe(0.5);
    expect(neatnessOf(Number.NaN)).toBe(0.5);
    expect(neatnessOf(-1)).toBe(0);
    expect(neatnessOf(3)).toBe(1);
  });
});
