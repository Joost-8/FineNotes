/**
 * The four reading fixes of EXP-PCONFIRM (research/handwriting-rig):
 * row order, late strokes (rule 3b), the page-word bias and the
 * out-of-list re-read, each on its own and through `readPage`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import { beamDecode, wordTrie } from "../../src/recognition/hwr/ctc";
import {
  type InkStroke,
  lateStrokeOrder,
  lineFeatures,
  writingOrder,
} from "../../src/recognition/hwr/features";
import { Lexicon, rereadOutOfList } from "../../src/recognition/hwr/lexicon";
import { type PageInk, rowOrder, segmentPage } from "../../src/recognition/hwr/lines";
import {
  pageEntries,
  pageWords,
  plainTranscript,
  wordsOf,
} from "../../src/recognition/hwr/page-words";
import { readLine, readPage } from "../../src/recognition/hwr/recognizer";

/** A stroke from (x, y) points, pressure 0.5. */
function stroke(points: [number, number][], t0: number | null, id = `s${t0}`): PageInk {
  return { id, tool: "pen", shape: null, t0, pts: points.flatMap(([x, y]) => [x, y, 0.5]) };
}

/** A small loop letter at `x` on a baseline at `y` (10 px tall). */
function letter(x: number, y: number, t0: number | null, id?: string): PageInk {
  return stroke(
    [
      [x, y],
      [x + 3, y - 10],
      [x + 6, y],
      [x + 3, y - 4],
    ],
    t0,
    id,
  );
}

/** A dot just above `x`. */
function dot(x: number, y: number, t0: number, id?: string): PageInk {
  return stroke(
    [
      [x, y - 14],
      [x + 0.5, y - 14.5],
    ],
    t0,
    id,
  );
}

describe("row order", () => {
  it("puts lines that share a row together, left to right, rows top to bottom", () => {
    const box = (x0: number, y0: number, x1: number, y1: number) => ({
      box: [x0, y0, x1, y1] as [number, number, number, number],
    });
    // A table: the right cell of row 1 was written last, after row 2.
    const lines = [box(0, 0, 50, 10), box(0, 30, 50, 40), box(100, 1, 150, 11)];
    expect(rowOrder(lines)).toEqual([0, 2, 1]);
    // Lines more than half a height apart are rows of their own.
    expect(rowOrder([box(0, 0, 50, 10), box(100, 6, 150, 16)])).toEqual([0, 1]);
    // Tiny lines count as at least 4 px tall.
    expect(rowOrder([box(10, 0, 20, 0), box(0, 1, 5, 1)])).toEqual([1, 0]);
    expect(rowOrder([])).toEqual([]);
  });

  it("orders a page's lines by row only when asked", () => {
    const ink: PageInk[] = [];
    let t = 0;
    for (let i = 0; i < 4; i++) ink.push(letter(10 * i, 100, t++, `a${i}`));
    for (let i = 0; i < 4; i++) ink.push(letter(10 * i, 200, t++, `b${i}`));
    for (let i = 0; i < 4; i++) ink.push(letter(400 + 10 * i, 100, t++, `c${i}`));
    const first = (lines: { words: { strokes: PageInk[] }[] }[]) =>
      lines.map((l) => l.words[0].strokes[0].id);
    const plain = segmentPage(ink).lines;
    const rows = segmentPage(ink, { rows: true }).lines;
    expect(new Set(first(plain))).toEqual(new Set(["a0", "b0", "c0"]));
    expect(first(rows)).toEqual(["a0", "c0", "b0"]);
  });
});

describe("late strokes (rule 3b)", () => {
  it("reads a late i-dot next to its letter, not after the line", () => {
    const a = letter(0, 100, 0, "a");
    const b = letter(12, 100, 1, "b");
    const c = letter(24, 100, 2, "c");
    const d = letter(36, 100, 3, "d");
    const late = dot(3, 100, 4, "dot");
    expect(writingOrder([a, b, c, d, late]).map((s) => s.id)).toEqual(["a", "b", "c", "d", "dot"]);
    expect(lateStrokeOrder([a, b, c, d, late]).map((s) => s.id)).toEqual([
      "a",
      "dot",
      "b",
      "c",
      "d",
    ]);
  });

  it("goes before every stroke when none starts left of it", () => {
    const a = letter(10, 100, 0, "a");
    const b = letter(22, 100, 1, "b");
    const c = letter(34, 100, 2, "c");
    const late = dot(2, 100, 3, "dot");
    expect(lateStrokeOrder([a, b, c, late]).map((s) => s.id)).toEqual(["dot", "a", "b", "c"]);
  });

  it("leaves strokes written left to right, and strokes without times, as they were", () => {
    const line = [letter(0, 100, 0), dot(3, 100, 1), letter(12, 100, 2), letter(24, 100, 3)];
    expect(lateStrokeOrder(line)).toEqual(writingOrder(line));
    const untimed = [letter(24, 100, null, "z"), letter(0, 100, null, "y"), dot(3, 100, 5)];
    expect(lateStrokeOrder(untimed)).toEqual(writingOrder(untimed));
    expect(lateStrokeOrder([])).toEqual([]);
  });

  it("gives the reference's frames, bit for bit, when it moves nothing", () => {
    const line: InkStroke[] = [letter(0, 100, 0), letter(12, 100, 300), letter(24, 100, 650)];
    const a = lineFeatures(line);
    const b = lineFeatures(line, undefined, { lateStrokes: true });
    expect(Array.from(b.features)).toEqual(Array.from(a.features));
    expect(b.frames).toBe(a.frames);
  });

  it("works row by row on a line that wraps", () => {
    // Row 1 then row 2; a dot for row 1's first letter comes last of all.
    const r1 = [letter(0, 100, 0, "a"), letter(12, 100, 1, "b"), letter(24, 100, 2, "c")];
    const r2 = [letter(0, 140, 3, "d"), letter(12, 140, 4, "e"), letter(24, 140, 5, "f")];
    const late = dot(3, 100, 6, "dot");
    const order = lateStrokeOrder([...r1, ...r2, late]).map((s) => s.id);
    expect(order).toEqual(["a", "dot", "b", "c", "d", "e", "f"]);
  });
});

// A CTC output over `alphabet`: one frame per entry, each a map of class → probability.
const ALPHABET = ["a", "c", "q", "t", "u", "b", " "];
function logits(frames: Record<string, number | undefined>[]): Float32Array {
  const C = ALPHABET.length + 1;
  const out = new Float32Array(frames.length * C);
  frames.forEach((f, t) => {
    for (let k = 0; k < C; k++) {
      const ch = k === 0 ? "_" : ALPHABET[k - 1];
      out[t * C + k] = Math.log(f[ch] ?? 1e-6);
    }
  });
  return out;
}
const BLANK = { _: 1 };

describe("page words in the beam", () => {
  const frames = [{ c: 1 }, BLANK, { a: 0.55, u: 0.45 }, BLANK, { t: 1 }];
  const logp = logits(frames);

  it("reads the same without a bias", () => {
    expect(beamDecode(logp, frames.length, ALPHABET, null)).toBe("cat");
    expect(beamDecode(logp, frames.length, ALPHABET, null, {}, null)).toBe("cat");
  });

  it("favours a page word the ink fits nearly as well", () => {
    const bias = { root: wordTrie(["Cut"]), weight: 1 };
    expect(beamDecode(logp, frames.length, ALPHABET, null, {}, bias)).toBe("cut");
  });

  it("takes the bonus back when the word does not finish as a list word", () => {
    // "cub" shares "cu" with what the ink could say, but the ink ends in t.
    const bias = { root: wordTrie(["cub"]), weight: 1 };
    expect(beamDecode(logp, frames.length, ALPHABET, null, {}, bias)).toBe("cat");
    // Mid-line too: a space ends the word.
    const two = [...frames, BLANK, { " ": 1 }, BLANK, { a: 1 }];
    expect(beamDecode(logits(two), two.length, ALPHABET, null, {}, bias)).toBe("cat a");
  });
});

describe("re-reading words not in the list", () => {
  const frames = [{ c: 1 }, BLANK, { q: 0.55, a: 0.45 }, BLANK, { t: 1 }];
  const line = { logp: logits(frames), frames: frames.length };
  const words = ["cat", "tub"];
  const list = { lexicon: new Lexicon(words), words: new Set(words) };

  it("replaces an out-of-list word by a near list word that scores within the margin", () => {
    expect(beamDecode(line.logp, line.frames, ALPHABET, null)).toBe("cqt");
    expect(rereadOutOfList(line, ALPHABET, null, 0.3, "cqt", list)).toBe("cat");
    // A margin the list word cannot meet keeps the reading.
    expect(rereadOutOfList(line, ALPHABET, null, 0.3, "cqt", list, 0)).toBe("cqt");
  });

  it("keeps words that are in the list, and readings it cannot align", () => {
    const inList = { lexicon: list.lexicon, words: new Set(["cqt"]) };
    expect(rereadOutOfList(line, ALPHABET, null, 0.3, "cqt", inList)).toBe("cqt");
    expect(rereadOutOfList(line, ALPHABET, null, 0.3, "cxt", list)).toBe("cxt");
    expect(rereadOutOfList(line, ALPHABET, null, 0.3, "", list)).toBe("");
  });
});

describe("the notebook's own words", () => {
  const body = [
    "Some prose.",
    "<!--goodobsidian-text-->",
    "### Page 1",
    "<!--goodobsidian-page p1 abc12 device-->",
    "Coprime numbers and $\\gcd$ of **Euclid**",
    "### Page 2",
    "<!--goodobsidian-page p2 9zz-->",
    "CSMA/CA probes [[Network|wireless]] [sketch: a drawing] \\text{interval}",
    "<!--/goodobsidian-text-->",
  ].join("\n");

  it("reads each page's entry as plain text", () => {
    const entries = pageEntries(body);
    expect([...entries.keys()]).toEqual(["p1", "p2"]);
    expect(entries.get("p1")).toBe("Coprime numbers and of Euclid");
    expect(entries.get("p2")).toBe("CSMA/CA probes wireless interval");
    expect(plainTranscript("a\n<!-- c -->\n\n  b   c")).toBe("a\nb c");
  });

  it("takes words of three letters or more, lower case, once", () => {
    expect(wordsOf(["The x2 and 3rd ABC abc a1b2"])).toEqual(["the", "and", "abc", "a1b2"]);
  });

  it("uses the title and the other pages, never the page being read", () => {
    const words = pageWords("Network lectures", [body], "p2");
    expect(words).toContain("network");
    expect(words).toContain("coprime");
    expect(words).not.toContain("probes");
    expect(pageWords("", [body], "p1")).toContain("csma");
  });
});

describe("readPage with the fixes", () => {
  const golden = JSON.parse(readFileSync("tests/recognition/fixtures/hwr-golden.json", "utf8")) as {
    bundle: string;
    pages: { strokes: PageInk[] }[];
  };
  const bundle = parseBundle(new Uint8Array(Buffer.from(golden.bundle, "base64")));
  const page = golden.pages.find((p) => p.strokes.every((s) => s.t0 != null)) ?? golden.pages[0];

  it("turns each fix off on its own", () => {
    const off = readPage(bundle, page.strokes, { rowOrder: false, lateStrokes: false });
    const plainLines = segmentPage(page.strokes).lines.map((l) => l.box);
    expect(off.lines.map((l) => l.box)).toEqual(plainLines);
    const on = readPage(bundle, page.strokes);
    const rowLines = segmentPage(page.strokes, { rows: true }).lines.map((l) => l.box);
    expect(on.lines.map((l) => l.box)).toEqual(rowLines);
  });

  it("reads as before with no page words and no word list", () => {
    const a = readPage(bundle, page.strokes);
    const b = readPage(bundle, page.strokes, { pageWords: [], rereadList: null });
    expect(b.lines.map((l) => l.text)).toEqual(a.lines.map((l) => l.text));
    const c = readPage(bundle, page.strokes, { pageWords: ["zzzz"], pageWordBias: false });
    expect(c.lines.map((l) => l.text)).toEqual(a.lines.map((l) => l.text));
  });

  it("re-reads only when asked and when a list is given", () => {
    const ink = page.strokes;
    const list = { lexicon: new Lexicon(["lll"]), words: new Set(["lll"]) };
    const off = readLine(bundle, ink, { reread: false, rereadList: list });
    const plain = readLine(bundle, ink);
    expect(off.text).toBe(plain.text);
    const on = readLine(bundle, ink, { rereadList: list });
    expect(typeof on.text).toBe("string");
  });
});

describe("a word written again later", () => {
  const line = (t: (i: number) => number) =>
    [0, 40, 80, 120].map((x, i) => ({
      id: `s${i}`,
      t0: t(i),
      pts: [x, 10, 0.5, x + 10, 20, 0.5, x + 20, 10, 0.5],
    }));

  const features = (t: (i: number) => number) =>
    Array.from(lineFeatures(line(t), undefined, { lateStrokes: true }).features);

  it("is read the same however much later it was written", () => {
    const soon = features((i) => (i === 2 ? 60000 : i * 400));
    expect(features((i) => (i === 2 ? 600000 : i * 400))).toEqual(soon);
  });

  it("makes a long pause on the line no different from a short walk", () => {
    const paused = features((i) => (i >= 2 ? i * 400 + 60000 : i * 400));
    expect(features((i) => (i >= 2 ? i * 400 + 90000 : i * 400))).toEqual(paused);
  });

  it("keeps the times of strokes written one after the other", () => {
    expect(features((i) => i * 200)).not.toEqual(features((i) => i * 900));
  });
});
