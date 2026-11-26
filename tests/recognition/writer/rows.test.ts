import { describe, expect, it } from "vitest";

import {
  ROW,
  calm,
  levelledStrokes,
  median,
  pickLines,
  referenceOf,
  runsOf,
  shareBlanks,
  wordsOf,
  type Rows,
  type TaggedLine,
} from "../../../src/recognition/writer/rows";

/** One row: end move, straight-line arms, pen-up flag. */
function row(ex: number, ey: number, up: boolean): number[] {
  return [ex, ey, ex / 3, ey / 3, -ex / 3, -ey / 3, 0, 0, 0, up ? 1 : 0];
}

function rowsOf(list: number[][]): Rows {
  return { x: Float32Array.from(list.flat()), n: list.length };
}

describe("runsOf", () => {
  it("gives each row its place in its character and the character's row count", () => {
    const { k, d } = runsOf([0, 0, 0, 1, 2, 2]);
    expect([...k]).toEqual([0, 1, 2, 0, 0, 1]);
    expect([...d]).toEqual([3, 3, 3, 1, 2, 2]);
  });

  it("copes with no rows", () => {
    const { k, d } = runsOf([]);
    expect(k.length).toBe(0);
    expect(d.length).toBe(0);
  });
});

describe("shareBlanks", () => {
  it("gives the first half (rounded up) of a run of blanks to the left label, the rest to the right", () => {
    expect([...shareBlanks([0, -1, -1, -1, 1])]).toEqual([0, 0, 0, 1, 1]);
    expect([...shareBlanks([0, -1, -1, -1, -1, 1])]).toEqual([0, 0, 0, 1, 1, 1]);
    expect([...shareBlanks([0, -1, 1])]).toEqual([0, 0, 1]);
  });

  it("gives leading blanks to the right label and trailing blanks to the left", () => {
    expect([...shareBlanks([-1, -1, 0, 1, -1, -1, -1])]).toEqual([0, 0, 0, 1, 1, 1, 1]);
  });

  it("leaves no blank behind", () => {
    const out = shareBlanks([-1, 0, -1, -1, 1, -1]);
    expect(out.every((v) => v >= 0)).toBe(true);
  });

  it("keeps all-blank input as it is", () => {
    expect([...shareBlanks([-1, -1])]).toEqual([-1, -1]);
  });
});

describe("calm", () => {
  it("scales a long pen-up move to the limit, keeping its direction, with arms at a third", () => {
    const r = rowsOf([row(3, 4, true)]);
    const out = calm(r, 2.5);
    expect(out).not.toBe(r);
    const x = Array.from(out.x);
    expect(x[0]).toBeCloseTo(1.5);
    expect(x[1]).toBeCloseTo(2);
    expect(x[2]).toBeCloseTo(0.5);
    expect(x[3]).toBeCloseTo(2 / 3);
    expect(x[4]).toBeCloseTo(-0.5);
    expect(x[5]).toBeCloseTo(-2 / 3);
    expect(x[9]).toBe(1);
    // The input is not changed.
    expect(r.x[0]).toBe(3);
  });

  it("returns the same object when no pen-up move is over the limit", () => {
    const r = rowsOf([row(1, 1, true), row(9, 9, false)]);
    expect(calm(r, 2)).toBe(r);
    expect(calm(r, 0)).toBe(r);
  });

  it("leaves pen-down rows and short pen-up rows untouched", () => {
    const r = rowsOf([row(30, 40, false), row(3, 4, true), row(0.5, 0, true)]);
    const out = calm(r, 2.5);
    expect(Array.from(out.x.subarray(0, ROW))).toEqual(Array.from(r.x.subarray(0, ROW)));
    expect(Array.from(out.x.subarray(2 * ROW, 3 * ROW))).toEqual(
      Array.from(r.x.subarray(2 * ROW, 3 * ROW)),
    );
    expect(out.n).toBe(3);
  });
});

describe("pickLines", () => {
  const pool = [
    { text: "zzz" },
    { text: "The Quick" },
    { text: "quick fox" },
    { text: "xyz" },
    { text: "QUICK" },
  ];

  it("puts the lines that share most lower-cased letters first, ties in pool order", () => {
    const out = pickLines("quick", pool, 5).map((l) => l.text);
    expect(out.slice(0, 3)).toEqual(["The Quick", "quick fox", "QUICK"]);
    expect(out.slice(3)).toEqual(["zzz", "xyz"]);
  });

  it("returns at most count lines", () => {
    expect(pickLines("quick", pool, 2)).toHaveLength(2);
    expect(pickLines("quick", pool, 0)).toHaveLength(0);
  });

  it("does not count the space as a shared letter", () => {
    const out = pickLines("a b", [{ text: "   " }, { text: "b" }], 2).map((l) => l.text);
    expect(out).toEqual(["b", "   "]);
  });
});

describe("referenceOf", () => {
  const index = new Map([
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);
  const tagged = (text: string, char: number[]): TaggedLine => {
    const r = rowsOf(char.map((_, i) => row(i + 1, 0, false)));
    return { ...r, text, char: Int32Array.from(char) };
  };

  it("is null for no lines", () => {
    expect(referenceOf([], 10, index)).toBeNull();
  });

  it("joins lines with a pen-up separator row and maps characters to ids", () => {
    const ref = referenceOf([tagged("ab", [0, 0, 1]), tagged("c", [0, 0])], 100, index);
    expect(ref).not.toBeNull();
    if (!ref) return;
    expect(ref.n).toBe(6);
    expect([...ref.cid]).toEqual([1, 1, 2, 0, 3, 3]);
    expect([...ref.k]).toEqual([0, 1, 0, 0, 0, 1]);
    expect([...ref.d]).toEqual([2, 2, 1, 0, 2, 2]);
    expect([...ref.sep]).toEqual([0, 0, 0, 1, 0, 0]);
    // The separator row: zeros, pen-up 1.
    const gap = Array.from(ref.x.subarray(3 * ROW, 4 * ROW));
    expect(gap).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    // The first line's rows are copied.
    expect(ref.x[0]).toBe(1);
    expect(ref.x[2 * ROW]).toBe(3);
  });

  it("is cut at size rows", () => {
    const ref = referenceOf([tagged("ab", [0, 0, 1]), tagged("c", [0, 0])], 4, index);
    expect(ref?.n).toBe(4);
    expect(ref?.x.length).toBe(4 * ROW);
    expect(ref?.sep[3]).toBe(1);
    const cut = referenceOf([tagged("ab", [0, 0, 1])], 2, index);
    expect(cut?.n).toBe(2);
  });

  it("gives an unknown character id 0", () => {
    const ref = referenceOf([tagged("z", [0])], 10, index);
    expect([...(ref?.cid ?? [])]).toEqual([0]);
  });
});

describe("median", () => {
  it("is the middle value, or the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5])).toBe(5);
  });

  it("is NaN for nothing", () => {
    expect(median([])).toBeNaN();
  });
});

describe("wordsOf", () => {
  it("makes a stroke of each run of pen-down rows, owned by the word most of its rows were written for", () => {
    // Text "ab cd": chars a0 b1 ' '2 c3 d4.
    const r = rowsOf([
      row(1, 0, false),
      row(1, 0, false),
      row(2, 0, true),
      row(1, 0, false),
      row(1, 0, false),
    ]);
    const { strokes, owner } = wordsOf(r, [0, 1, 2, 3, 4], "ab cd");
    expect(strokes.map((s) => [s.a, s.e])).toEqual([
      [0, 1],
      [3, 4],
    ]);
    expect(owner).toEqual([0, 1]);
    expect(strokes[0].lo).toBe(0);
    expect(strokes[0].hi).toBe(2);
  });

  it("lets the majority win", () => {
    const r = rowsOf([row(1, 0, false), row(1, 0, false), row(1, 0, false)]);
    // Rows written for chars 0 (word 0), 3 (word 1), 4 (word 1).
    expect(wordsOf(r, [0, 3, 4], "ab cd").owner).toEqual([1]);
  });

  it("does not let space characters vote, and gives a stroke with no vote the nearest word's", () => {
    const r = rowsOf([
      row(1, 0, false), // stroke 0: char 0
      row(1, 0, true), // up: char 1
      row(1, 0, false), // stroke 2: char 2 (space)
      row(3, 0, true), // up
      row(1, 0, false), // stroke 4: char 3
    ]);
    // Stroke 0 spans x 0..1, the space's 2..3, stroke 4 spans 6..7: the nearest is word 0.
    const { owner } = wordsOf(r, [0, 1, 2, 2, 3], "ab cd");
    expect(owner).toEqual([0, 0, 1]);
  });

  it("takes the right-hand word when it is nearer", () => {
    const r = rowsOf([
      row(1, 0, false),
      row(5, 0, true),
      row(1, 0, false),
      row(1, 0, true),
      row(1, 0, false),
    ]);
    // Strokes: 0..1, 6..7 (space only), 8..9 (char 3, word 1).
    const { owner } = wordsOf(r, [0, 1, 2, 2, 3], "ab cd");
    expect(owner).toEqual([0, 1, 1]);
  });

  it("gives -1 to all strokes when none has a word", () => {
    const r = rowsOf([row(1, 0, false)]);
    expect(wordsOf(r, [1], "a b").owner).toEqual([-1]);
  });
});

describe("levelledStrokes", () => {
  const minY = (pts: number[]): number => {
    let m = Infinity;
    for (let i = 1; i < pts.length; i += 2) m = Math.min(m, pts[i]);
    return m;
  };

  it("stands words with feet at different heights on one line", () => {
    // "a b": the second word is written half a unit lower.
    const r = rowsOf([row(1, 0, false), row(1, -0.5, true), row(1, 0, false)]);
    const out = levelledStrokes(r, [0, 1, 2], "a b");
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.word)).toEqual([0, 1]);
    expect(minY(out[0].pts)).toBeCloseTo(minY(out[1].pts));
  });

  it("gives eight points a curve and does not repeat shared end points", () => {
    const r = rowsOf([row(1, 0, false), row(1, 0, false), row(1, 0, true), row(1, 0, false)]);
    const out = levelledStrokes(r, [0, 0, 1, 2], "a b");
    // A two-row stroke: 8 + 7 points.
    expect(out[0].pts).toHaveLength((8 + 7) * 2);
    expect(out[1].pts).toHaveLength(8 * 2);
    // The first curve ends at x = 1 (its eighth point); the next point is already on the second curve.
    const p = out[0].pts;
    expect(p[14]).toBeCloseTo(1);
    expect(p[16]).toBeGreaterThan(1);
  });

  it("gives strokes back unmoved, with word -1, without an alignment", () => {
    const r = rowsOf([row(1, 0, false), row(1, -0.5, true), row(1, 0, false)]);
    const out = levelledStrokes(r, null, "a b");
    expect(out.map((s) => s.word)).toEqual([-1, -1]);
    expect(minY(out[0].pts)).toBeCloseTo(0);
    expect(minY(out[1].pts)).toBeCloseTo(-0.5);
    // An alignment of the wrong length is no alignment.
    expect(levelledStrokes(r, [0, 1], "a b").map((s) => s.word)).toEqual([-1, -1]);
  });

  it("is empty for a line with no ink", () => {
    expect(levelledStrokes(rowsOf([row(1, 0, true)]), [0], "a")).toEqual([]);
  });

  it("does not lift a word for an f that goes under the line", () => {
    // "of an": o, a and n stand on 0; the f of a joined hand goes half a unit under.
    const r = rowsOf([
      row(0.2, 0, false), // o
      row(0.2, 0, true),
      row(0, -0.5, false), // f, down to -0.5
      row(0.3, 0.5, true), // back up, to the next word
      row(0.2, 0, false), // a
      row(0.2, 0, true),
      row(0.2, 0, false), // n
    ]);
    const out = levelledStrokes(r, [0, 1, 1, 2, 3, 4, 4], "of an");
    expect(out.map((s) => s.word)).toEqual([0, 0, 1, 1]);
    // The o stays level with the a: the f's bottom did not count as the word's foot.
    expect(minY(out[0].pts)).toBeCloseTo(minY(out[2].pts));
    // A word of only an f still stands by it.
    const lone = rowsOf([row(0.2, 0, false), row(0.2, 0.3, true), row(0, -0.3, false)]);
    const two = levelledStrokes(lone, [0, 1, 2], "a f");
    expect(minY(two[0].pts)).toBeCloseTo(minY(two[1].pts));
  });
});
