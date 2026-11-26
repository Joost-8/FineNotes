import { describe, expect, it } from "vitest";

import { measureHand } from "../../../src/ink/tidy";
import { neatenEdit } from "../../../src/recognition/writer/apply";
import { placeLines } from "../../../src/recognition/writer/layout";
import { writerLine, writtenLine } from "./fixture";

const top = writerLine(40, 100);
const below = writerLine(40, 400);
const page = [...top.strokes, ...below.strokes];
const profile = (() => {
  const p = measureHand(page);
  if (!p) throw new Error("the fixture ink has no hand");
  return p;
})();

function place(rewrite: boolean[], written = writtenLine()) {
  return placeLines([{ strokes: top.strokes, words: top.words, rewrite, written }], profile);
}

describe("neatenEdit", () => {
  it("removes the strokes of the rewritten words and adds the new ones with their line and point count", () => {
    const placed = place([true, false, true, true]);
    const edit = neatenEdit(page, placed, profile, null);
    expect([...edit.removed].sort()).toEqual(
      [...top.words[0], ...top.words[2], ...top.words[3]].sort(),
    );
    expect(edit.added).toHaveLength(placed[0].added.length);
    edit.added.forEach((s, i) => {
      expect(s.line).toBe(0);
      expect(s.pts).toHaveLength(placed[0].added[i].pts.length);
    });
  });

  it("gives a stroke of each placed line its line's index", () => {
    const placed = placeLines(
      [
        {
          strokes: top.strokes,
          words: top.words,
          rewrite: [true, true, true, true],
          written: writtenLine(),
        },
        {
          strokes: below.strokes,
          words: below.words,
          rewrite: [true, true, true, true],
          written: writtenLine(),
        },
      ],
      profile,
    );
    const edit = neatenEdit(page, placed, profile, null);
    expect(new Set(edit.added.map((s) => s.line))).toEqual(new Set([0, 1]));
    expect(edit.added.filter((s) => s.line === 0)).toHaveLength(placed[0].added.length);
    expect(edit.added.filter((s) => s.line === 1)).toHaveLength(placed[1].added.length);
  });

  it("moves the kept words of a neatened line, with the point count they had", () => {
    const placed = place([true, false, true, true]);
    const edit = neatenEdit(page, placed, profile, null);
    for (const id of top.words[1]) {
      const was = top.strokes.find((s) => s.id === id)?.pts ?? [];
      // A kept word placeLines did not move is no longer moved by Tidy (a placed line is not
      // tidied on plain paper); when it is moved, its points keep their count.
      const pts = edit.moved.get(id);
      if (pts) expect(pts).toHaveLength(was.length);
    }
    const shifted = top.words.flat().filter((id) => placed[0].kept.get(id)?.dx);
    for (const id of shifted) expect(edit.moved.has(id)).toBe(true);
    expect(edit.moved.has(top.words[0][0])).toBe(false);
  });

  it("does not move the strokes of other lines on the page", () => {
    const placed = place([true, false, true, true]);
    const edit = neatenEdit(page, placed, profile, null);
    for (const s of below.strokes) {
      const moved = edit.moved.get(s.id);
      if (moved) expect(moved).toEqual(Array.from(s.pts));
      expect(edit.removed).not.toContain(s.id);
    }
  });

  it("gives an empty edit when nothing is added", () => {
    const placed = place([false, false, false, false]);
    const edit = neatenEdit(page, placed, profile, null);
    expect(edit.removed).toEqual([]);
    expect(edit.added).toEqual([]);
    expect(edit.moved.size).toBe(0);
  });
});
