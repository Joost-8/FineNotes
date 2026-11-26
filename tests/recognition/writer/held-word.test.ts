import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  heldWordAt,
  inkToBeautify,
  placeWord,
  wordAround,
  wordEdit,
} from "../../../src/recognition/writer/held-word";
import { writtenLine } from "./fixture";

const xs = (pts: ArrayLike<number>): number[] => Array.from(pts).filter((_, i) => i % 3 === 0);
const ys = (pts: ArrayLike<number>): number[] => Array.from(pts).filter((_, i) => i % 3 === 1);

// "testing the new beautify", Joost's own line (24 November, his iPad).
const real = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "joost-line-alone.json"), "utf8"),
) as { strokes: { id: string; t0: number; pts: number[] }[]; words: string[][] };
const strokes = real.strokes.map((s) => ({ ...s, tool: "pen", shape: null }));
const byId = new Map(strokes.map((s) => [s.id, s]));
const spanOf = (ids: readonly string[], move = (_: string) => 0): [number, number] => {
  const all = ids.flatMap((id) => xs(byId.get(id)?.pts ?? []).map((x) => x + move(id)));
  return [Math.min(...all), Math.max(...all)];
};
const bottomOf = (ids: readonly string[]): number =>
  Math.max(...ids.flatMap((id) => ys(byId.get(id)?.pts ?? [])));

describe("heldWordAt", () => {
  it("finds the line and word that hold a stroke", () => {
    const lines = [{ words: [["a"], ["b", "c"]] }, { words: [["d"]] }];
    expect(heldWordAt(lines, "c")).toEqual({ line: 0, word: 1 });
    expect(heldWordAt(lines, "d")).toEqual({ line: 1, word: 0 });
    expect(heldWordAt(lines, "z")).toBeNull();
  });
});

describe("placeWord on Joost's line: only the held word changes", () => {
  const held = real.words[1]; // "the"
  const place = (pageWidth?: number) =>
    placeWord({
      line: strokes,
      word: held,
      written: writtenLine(1, 3),
      xHeight: { ink: 12, written: 0.389, least: 3 },
      foot: { ink: null, written: null },
      pageWidth,
    });
  const placed = place();
  if (!placed) throw new Error("not placed");
  const move = (id: string): number => placed.kept.get(id)?.dx ?? 0;

  it("takes away the held word's strokes only, and moves nothing up or down", () => {
    expect(new Set(placed.removed)).toEqual(new Set(held));
    for (const word of [real.words[0], real.words[2], real.words[3]])
      for (const id of word) expect(placed.kept.get(id)?.dy).toBe(0);
  });

  it("writes it where the old word began, standing where it stood, at his x-height", () => {
    const added = placed.added.flatMap((s) => xs(s.pts));
    expect(Math.min(...added)).toBeCloseTo(spanOf(held)[0], 6);
    const bottom = Math.max(...placed.added.flatMap((s) => ys(s.pts)));
    expect(bottom).toBeCloseTo(bottomOf(held), 6);
    // Three zig-zag letters of the model's x-height, written at his 12 px.
    const top = Math.min(...placed.added.flatMap((s) => ys(s.pts)));
    expect(bottom - top).toBeCloseTo(12, 1);
  });

  it("leaves the word before it alone and moves the words after it by the change in width", () => {
    for (const id of real.words[0]) expect(move(id)).toBe(0);
    const added = placed.added.flatMap((s) => xs(s.pts));
    const grew = Math.max(...added) - spanOf(held)[1];
    for (const id of [...real.words[2], ...real.words[3]]) expect(move(id)).toBeCloseTo(grew, 6);
    // The gap after the word is the one he left.
    const gap = spanOf(real.words[2])[0] - spanOf(held)[1];
    expect(spanOf(real.words[2], move)[0] - Math.max(...added)).toBeCloseTo(gap, 6);
  });

  it("is not placed when it would push his words past the page's edge", () => {
    const right = spanOf(real.words[3])[1];
    const wider = placeWord({
      line: strokes,
      word: held,
      written: writtenLine(1, 8),
      xHeight: { ink: 12, written: 0.389, least: 3 },
      foot: { ink: null, written: null },
      pageWidth: right + 1,
    });
    expect(wider).toBeNull();
  });

  it("stands the letters on the writer's foot when both feet are known", () => {
    const footed = placeWord({
      line: strokes,
      word: held,
      written: writtenLine(1, 3),
      xHeight: { ink: 12, written: 0.389, least: 3 },
      foot: { ink: 500, written: 0 },
    });
    const bottom = Math.max(...(footed?.added ?? []).flatMap((s) => ys(s.pts)));
    expect(bottom).toBeCloseTo(500, 6);
  });

  it("makes an edit that moves only the words after it, with no Tidy", () => {
    const edit = wordEdit(strokes, placed);
    expect(new Set(edit.removed)).toEqual(new Set(held));
    expect(new Set(edit.moved.keys())).toEqual(
      new Set([...real.words[2], ...real.words[3]].filter((id) => move(id) !== 0)),
    );
    const id = real.words[3][0];
    const before = byId.get(id)?.pts ?? [];
    const after = edit.moved.get(id) ?? [];
    expect(after[0] - before[0]).toBeCloseTo(move(id), 6);
    expect(after[1]).toBe(before[1]);
  });
});

describe("wordAround: a word alone", () => {
  it("gathers the word's own strokes and nothing a line away or far along", () => {
    const word = real.words[0]; // "testing", alone on the page
    const alone = strokes.filter((s) => word.includes(s.id));
    const below = alone.map((s) => ({
      ...s,
      id: `${s.id}-below`,
      pts: s.pts.map((v, i) => (i % 3 === 1 ? v + 60 : v)),
    }));
    const far = alone.map((s) => ({
      ...s,
      id: `${s.id}-far`,
      pts: s.pts.map((v, i) => (i % 3 === 0 ? v + 400 : v)),
    }));
    const page = [...alone, ...below, ...far];
    const got = wordAround(page, word[0], 0.9 * 12).map((s) => s.id);
    expect(new Set(got)).toEqual(new Set(word));
  });

  it("is empty for a stroke that is not a pen stroke on the page", () => {
    expect(wordAround(strokes, "nope", 10)).toEqual([]);
  });
});

describe("inkToBeautify", () => {
  it("reads a word alone by its own ink, where no line of running text holds it", () => {
    const word = real.words[0];
    const alone = strokes.filter((s) => word.includes(s.id));
    const got = inkToBeautify(alone, word[2]).map((s) => s.id);
    expect(new Set(got)).toEqual(new Set(word));
  });

  it("reads a held word of a line with the whole line", () => {
    const got = inkToBeautify(strokes, real.words[1][0]).map((s) => s.id);
    expect(new Set(got)).toEqual(new Set(real.words.flat()));
  });
});
