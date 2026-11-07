/**
 * `src/model/calc-layout.ts` (FineNotes#178): a raised dot is times, a dot on
 * the baseline stays a decimal point, and a fraction is read side by side.
 * Synthetic ink with low-frequency tremor, at three sizes; the end-to-end
 * cases run through `calc-ink.ts` and `calc-note.ts` as the view does.
 */

import { describe, expect, it } from "vitest";
import { writingLines } from "../../src/canvas/backdrop";
import { answerPlace, equalsAtEnd, sumStrokes } from "../../src/model/calc-ink";
import {
  type SumPiece,
  hasLayout,
  inkPieces,
  layoutSum,
  markId,
  misreadMarks,
  numberOfLookalikes,
  readLaidOut,
  readWhole,
  withPick,
  sumText,
} from "../../src/model/calc-layout";
import { evaluateSum, sumOfLine } from "../../src/model/calc-note";
import { formatValue } from "../../src/model/calculator";
import type { Stroke } from "../../src/model/document";
import realDots from "../ink/fixtures/real-calc-dots-ipad.json";
import realPage from "../ink/fixtures/real-calc-page-ipad.json";

const A4 = { width: 1024, height: 1448 };
const RULED = writingLines({ kind: "ruled-wide" }, A4);

let nextId = 0;
let seed = 11;
function random(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

/** A polyline through `pts`, sampled every 1.4 px (finer for tiny marks), with tremor. */
function stroke(pts: Array<[number, number]>, amp = 0.5): Stroke {
  const phases = [random(), random(), random()].map((p) => p * Math.PI * 2);
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / 1.4));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      s += len / n;
      const wobble =
        amp *
        (0.5 * Math.sin(s / 9 + phases[0]) +
          0.3 * Math.sin(s / 4 + phases[1]) +
          0.2 * Math.sin(s / 17 + phases[2]));
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + wobble, 0.5);
    }
  }
  const [lx, ly] = pts[pts.length - 1];
  out.push(lx, ly, 0.5);
  return { id: `s${++nextId}`, color: "#000", size: 2, tool: "pen", pts: out };
}

/** A digit-like stroke `h` tall with its foot on `baseline`, from `x`. */
function digit(x: number, baseline: number, h: number): Stroke {
  const w = h * 0.55;
  return stroke([
    [x + w, baseline - h],
    [x, baseline - h * 0.6],
    [x + w * 0.9, baseline - h * 0.4],
    [x + w * 0.2, baseline],
  ]);
}

/** A dot: a tap that wobbles a pixel or two, centred on (x, y). */
function dot(x: number, y: number, h: number): Stroke {
  const r = Math.max(0.6, h * 0.04);
  return {
    id: `s${++nextId}`,
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [x - r, y, 0.5, x, y - r, 0.5, x + r, y, 0.5, x, y + r, 0.5],
  };
}

/** A level dash from x0 to x1 at y. */
function dash(x0: number, x1: number, y: number): Stroke {
  return stroke([
    [x0, y],
    [x1, y + 0.3],
  ]);
}

/** An "×" as two crossing strokes, `h` the digits' height. */
function cross(x: number, baseline: number, h: number): Stroke[] {
  const s = h * 0.5;
  const top = baseline - h * 0.7;
  return [
    stroke([
      [x, top],
      [x + s, top + s],
    ]),
    stroke([
      [x + s, top],
      [x, top + s],
    ]),
  ];
}

/** An "=" `h` tall digits beside it, centred on `cy`. */
function equals(x: number, cy: number, h: number): Stroke[] {
  const w = h * 0.55;
  return [dash(x, x + w, cy - h * 0.15), dash(x + 1, x + w + 1, cy + h * 0.15)];
}

const kinds = (pieces: readonly SumPiece[]): string[] => pieces.map((p) => p.kind);

/** Read every ink piece as `readings` gives it, and work the sum out. */
function answerOf(pieces: SumPiece[], readings: string[]): string | null {
  const text = sumText(pieces, readings);
  if (text === null) return null;
  const sum = sumOfLine(`${text} =`);
  if (!sum) return null;
  const result = evaluateSum(sum);
  return result.ok ? formatValue(result.value, { fractions: true }) : null;
}

describe("raised dots", () => {
  it("reads a dot halfway up the digits as times, at any size", () => {
    for (const h of [10, 24, 60]) {
      const step = h * 0.8;
      const a = digit(100, 300, h);
      const d = dot(100 + step * 1.1, 300 - h * 0.45, h);
      const b = digit(100 + step * 1.5, 300, h);
      const pieces = layoutSum([a, d, b]);
      expect(kinds(pieces), `h ${h}`).toEqual(["ink", "times", "ink"]);
      expect(inkPieces(pieces)).toEqual([[a], [b]]);
      expect(answerOf(pieces, ["3", "3"])).toBe("9");
    }
  });

  it("leaves a dot on the baseline to the digits: a decimal point", () => {
    for (const h of [10, 24, 60]) {
      const step = h * 0.8;
      const pieces = layoutSum([
        digit(100, 300, h),
        dot(100 + step * 1.1, 300 - h * 0.05, h),
        digit(100 + step * 1.5, 300, h),
      ]);
      expect(kinds(pieces), `h ${h}`).toEqual(["ink"]);
      expect(hasLayout(pieces)).toBe(false);
    }
  });

  it("leaves a colon, a dotted i and a dot at the end alone", () => {
    const h = 24;
    // 6:2, two dots one over the other.
    const colon = layoutSum([
      digit(100, 300, h),
      dot(122, 300 - h * 0.25, h),
      dot(122, 300 - h * 0.7, h),
      digit(132, 300, h),
    ]);
    expect(hasLayout(colon)).toBe(false);
    // The dot of an i, over its stem, between letters.
    const stem = stroke([
      [130, 300 - h * 0.6],
      [130, 300],
    ]);
    const word = layoutSum([
      digit(100, 300, h),
      stem,
      dot(130, 300 - h * 0.45, h),
      digit(140, 300, h),
    ]);
    expect(hasLayout(word)).toBe(false);
    // A full stop after the last digit: nothing to its right.
    const end = layoutSum([digit(100, 300, h), digit(120, 300, h), dot(140, 300 - h * 0.45, h)]);
    expect(hasLayout(end)).toBe(false);
  });

  it("handles two raised dots in one sum", () => {
    const h = 24;
    const pieces = layoutSum([
      digit(100, 300, h),
      dot(122, 300 - h * 0.5, h),
      digit(132, 300, h),
      dot(154, 300 - h * 0.5, h),
      digit(164, 300, h),
    ]);
    expect(kinds(pieces)).toEqual(["ink", "times", "ink", "times", "ink"]);
    expect(answerOf(pieces, ["2", "3", "4"])).toBe("24");
  });
});

describe("fractions", () => {
  it("reads 3×2 over 7 as a fraction, not as 3×2 (the screenshot in #178)", () => {
    for (const h of [10, 24, 60]) {
      const num = [
        digit(100, 300, h),
        ...cross(100 + h * 0.7, 300, h),
        digit(100 + h * 1.4, 300, h),
      ];
      const bar = dash(96, 100 + h * 2.1, 300 + h * 0.25);
      const den = digit(100 + h * 0.75, 300 + h * 1.4, h);
      const pieces = layoutSum([...num, bar, den]);
      expect(kinds(pieces), `h ${h}`).toEqual(["fraction"]);
      const frac = pieces[0] as Extract<SumPiece, { kind: "fraction" }>;
      expect(frac.bar).toBe(bar);
      expect(inkPieces(pieces)).toEqual([num, [den]]);
      expect(sumText(pieces, ["3x2", "7"])).toBe("(3x2)/7");
      expect(answerOf(pieces, ["3x2", "7"])).toBe("6/7");
    }
  });

  it("brackets a fraction that stands beside more of the sum", () => {
    const h = 24;
    const one = digit(100, 300, h);
    const plus = [
      dash(120, 132, 300 - h * 0.45),
      stroke([
        [126, 300 - h * 0.7],
        [126, 300 - h * 0.2],
      ]),
    ];
    const num = digit(146, 300 - h * 0.55, h * 0.8);
    const bar = dash(140, 162, 300 - h * 0.45);
    const den = digit(146, 300 + h * 0.6, h * 0.8);
    const pieces = layoutSum([one, ...plus, num, bar, den]);
    expect(kinds(pieces)).toEqual(["ink", "fraction"]);
    expect(sumText(pieces, ["1 +", "3", "4"])).toBe("1 + (3/4)");
    expect(answerOf(pieces, ["1 +", "3", "4"])).toBe("7/4");
  });

  it("reads a fraction inside a fraction", () => {
    const h = 20;
    // (1/2) over 3: the inner bar is shorter and sits above the outer one.
    const n1 = digit(104, 240, h);
    const innerBar = dash(100, 118, 246);
    const n2 = digit(104, 274, h);
    const outerBar = dash(94, 126, 282);
    const d = digit(104, 310, h);
    const pieces = layoutSum([n1, innerBar, n2, outerBar, d]);
    expect(kinds(pieces)).toEqual(["fraction"]);
    const outer = pieces[0] as Extract<SumPiece, { kind: "fraction" }>;
    expect(outer.bar).toBe(outerBar);
    expect(kinds(outer.over)).toEqual(["fraction"]);
    expect(answerOf(pieces, ["1", "2", "3"])).toBe("1/6");
  });

  it("reads a dash with a dot over and under it as divided by", () => {
    const h = 24;
    const pieces = layoutSum([
      digit(100, 300, h),
      dash(120, 134, 300 - h * 0.45),
      dot(127, 300 - h * 0.8, h),
      dot(127, 300 - h * 0.1, h),
      digit(142, 300, h),
    ]);
    expect(kinds(pieces)).toEqual(["ink", "divide", "ink"]);
    expect(answerOf(pieces, ["8", "2"])).toBe("4");
  });

  it("leaves a minus alone", () => {
    const h = 24;
    const pieces = layoutSum([
      digit(100, 300, h),
      digit(118, 300, h),
      dash(138, 152, 300 - h * 0.45),
      digit(160, 300, h),
    ]);
    expect(hasLayout(pieces)).toBe(false);
  });

  it("gives no text when a side of a fraction read as nothing", () => {
    const h = 24;
    const pieces = layoutSum([digit(100, 300, h), dash(94, 120, 306), digit(100, 334, h)]);
    expect(kinds(pieces)).toEqual(["fraction"]);
    expect(sumText(pieces, ["3", " "])).toBeNull();
  });
});

describe("the whole fraction reaches the sum", () => {
  it("takes the denominator from under the writing line on ruled paper", () => {
    const h = 24;
    // Numerator on the line whose rule is y = 320, the bar on the rule, the
    // denominator below it, the "=" level with the bar.
    const num = [digit(100, 316, h), ...cross(118, 316, h), digit(134, 316, h)];
    const bar = dash(96, 152, 321);
    const den = digit(118, 348, h);
    const eqInk = equals(170, 321, h);
    const page = [...num, bar, den, ...eqInk];
    const eq = equalsAtEnd(page)!;
    expect(eq).not.toBeNull();
    const got = sumStrokes(page, eq, RULED);
    expect(new Set(got.map((s) => s.id))).toEqual(new Set(page.map((s) => s.id)));
    const pieces = layoutSum(got.slice(0, -2));
    expect(kinds(pieces)).toEqual(["fraction"]);
  });

  it("takes both sides on blank paper when only the bar is in the band around the =", () => {
    // As drawn in the real-Obsidian rig: tall digits, a short "=" level with
    // the bar, numerator and denominator both beyond the band.
    const h = 86;
    const num = [digit(150, 589, h), ...cross(216, 575, 70), digit(273, 589, h)];
    const bar = dash(135, 338, 617);
    const den = digit(216, 721, h);
    const eqInk = [dash(370, 419, 607), dash(370, 419, 629)];
    const page = [...num, bar, den, ...eqInk];
    const eq = equalsAtEnd(page)!;
    const got = sumStrokes(page, eq, []);
    expect(new Set(got.map((s) => s.id))).toEqual(new Set(page.map((s) => s.id)));
    expect(kinds(layoutSum(got.slice(0, -2)))).toEqual(["fraction"]);
  });

  it("takes nothing from the line below for a minus", () => {
    const h = 24;
    const line = [
      digit(100, 316, h),
      digit(118, 316, h),
      dash(138, 152, 316 - h * 0.45),
      digit(160, 316, h),
    ];
    const below = [digit(140, 356, h)];
    const eqInk = equals(182, 316 - h * 0.45, h);
    const page = [...line, ...below, ...eqInk];
    const eq = equalsAtEnd(page)!;
    const got = sumStrokes(page, eq, RULED).map((s) => s.id);
    expect(got).not.toContain(below[0].id);
  });

  it("puts the answer level with the = after a fraction", () => {
    const h = 24;
    const num = [digit(100, 300, h), digit(118, 300, h)];
    const bar = dash(96, 136, 306);
    const den = [digit(108, 336, h)];
    const eqInk = equals(150, 306, h);
    const page = [...num, bar, ...den, ...eqInk];
    const eq = equalsAtEnd(page)!;
    const place = answerPlace(sumStrokes(page, eq, []), eq);
    const cy = (eq.bounds.minY + eq.bounds.maxY) / 2;
    // The answer's middle within a fifth of a digit of the "=".
    expect(Math.abs(place.baseline - place.height / 2 - cy)).toBeLessThan(h * 0.2);
  });
});

describe("reading again when a mark was taken wrongly", () => {
  const h = 24;
  /** 3, a raised dot, 3: the sum in #178's screenshot. */
  function threeDotThree(): Stroke[] {
    return [digit(100, 300, h), dot(124, 300 - h * 0.45, h), digit(136, 300, h)];
  }

  it("reads 3·3 as 3 * 3 when both sides read as numbers", async () => {
    const reads: string[][] = [];
    const got = await readLaidOut(threeDotThree(), async (groups) => {
      reads.push(groups.map((g) => g.map((s) => s.id).join(",")));
      return groups.map(() => ({ text: "3", confidence: 0.97 }));
    });
    expect(got).toMatchObject({ text: "3 * 3 =", dot: true, fraction: false, doubts: [] });
    expect(got?.pieces.map((p) => p.text)).toEqual(["3", "3"]);
    expect(reads).toHaveLength(1);
  });

  it("marks a whole piece as a doubt when Grape gave no characters", async () => {
    const ink = threeDotThree();
    const got = await readLaidOut(ink, async (groups) =>
      groups.map((_, i) => ({ text: "3", confidence: i === 1 ? 0.8 : 0.95 })),
    );
    expect(got?.doubts).toEqual([
      { strokes: [ink[2].id], char: "3", alternatives: [], piece: 1, at: -1 },
    ]);
    // A whole line: its doubt is the whole line, only when unsure.
    expect(readWhole(ink, { text: "3.3 =", confidence: 0.7 }).doubts[0].strokes).toEqual(
      ink.map((s) => s.id),
    );
    expect(readWhole(ink, { text: "3.3 =", confidence: 0.95 }).doubts).toEqual([]);
  });

  it("marks only the doubtful character, with its runner-ups, and a pick works the sum out again", async () => {
    // "12" over a bar over "7", read with characters: the 2 is a close call.
    const top = [digit(100, 300, h), digit(118, 300, h)];
    const bar = dash(94, 142, 306);
    const bottom = digit(110, 336, h);
    const chars = (text: string, low: number, alts: string[]) =>
      Array.from(text).map((char, i) => ({
        char,
        strokes: [i],
        confidence: i === low ? 0.55 : 0.97,
        alternatives: i === low ? alts.map((a) => ({ char: a })) : [],
      }));
    const got = await readLaidOut([...top, bar, bottom], async (groups) =>
      groups.map((g) =>
        g.length === 2
          ? { text: "12", greedy: "12", confidence: 0.8, chars: chars("12", 1, ["z", "7", " "]) }
          : { text: "7", greedy: "7", confidence: 0.99, chars: chars("7", -1, []) },
      ),
    );
    expect(got?.text).toBe("12/7 =");
    expect(got?.doubts).toEqual([
      { strokes: [top[1].id], char: "2", alternatives: ["z", "7"], piece: 0, at: 1 },
    ]);
    const picked = withPick(got!, got!.doubts[0], "7");
    expect(picked?.text).toBe("17/7 =");
    expect(picked?.doubts).toEqual([]);
    expect(picked?.pieces[0]).toEqual({ strokes: top.map((s) => s.id), read: "12", text: "17" });
    // Grape wrote "1z" and the language model made it "12": the changed
    // character is a doubt even though Grape was sure, offering what Grape wrote.
    const sure = (text: string) =>
      Array.from(text).map((char, i) => ({
        char,
        strokes: [i],
        confidence: 0.95,
        alternatives: [{ char: "2" }],
      }));
    const lm = await readLaidOut([...top, bar, bottom], async (groups) =>
      groups.map((g) =>
        g.length === 2
          ? { text: "12", greedy: "1z", confidence: 0.95, chars: sure("1z") }
          : { text: "7", confidence: 0.99 },
      ),
    );
    expect(lm?.doubts).toEqual([
      { strokes: [top[1].id], char: "2", alternatives: ["z"], piece: 0, at: 1 },
    ]);
    // Without characters and unsure: the whole piece, and its answer replaces it.
    const whole = await readLaidOut([...top, bar, bottom], async (groups) =>
      groups.map((g) =>
        g.length === 2 ? { text: "12", confidence: 0.7 } : { text: "7", confidence: 0.99 },
      ),
    );
    expect(whole?.doubts.map((d) => d.at)).toEqual([-1]);
    expect(withPick(whole!, whole!.doubts[0], "13")?.text).toBe("13/7 =");
  });

  it("falls back to the plain reading when a word stands beside the dot", async () => {
    // The same ink, read as letters: the dot of an i between "Eu" and "lid".
    const ink = threeDotThree();
    const readings = ["Eu", "lid"];
    const pieces = layoutSum(ink);
    const bad = misreadMarks(pieces, readings);
    expect([...bad]).toEqual([markId(pieces[1])]);
    expect(hasLayout(layoutSum(ink, bad))).toBe(false);
    const text = await readLaidOut(ink, async (groups) =>
      (groups.length === 2 ? readings : groups.map(() => "Euclid")).map((r) => ({
        text: r,
        confidence: 0.95,
      })),
    );
    expect(text).toBeNull();
  });

  it("keeps a dot beside one letter (a variable) and a bracket", () => {
    const pieces = layoutSum(threeDotThree());
    expect(misreadMarks(pieces, ["2", "a"]).size).toBe(0);
    expect(misreadMarks(pieces, ["(1+2)", "(3)"]).size).toBe(0);
    expect(misreadMarks(pieces, ["ab", "3"]).size).toBe(1);
  });

  it("drops a fraction whose side read as no letter or digit (an arrow's barbs)", () => {
    const pieces = layoutSum([digit(100, 300, h), dash(94, 120, 306), digit(100, 334, h)]);
    expect(misreadMarks(pieces, ["3", "7"]).size).toBe(0);
    expect(misreadMarks(pieces, [".", "7"])).toEqual(new Set([markId(pieces[0])]));
  });

  it("refuses an = and an arrow as fraction bars", () => {
    // An "=" between digits: the other dash is flat.
    const eqLike = layoutSum([
      digit(100, 300, h),
      dash(120, 136, 300 - h * 0.6),
      dash(120, 136, 300 - h * 0.3),
      digit(144, 300, h),
    ]);
    expect(eqLike.some((p) => p.kind === "fraction")).toBe(false);
    // An arrow: a shaft with its barbs at the end, over and under it.
    const arrow = layoutSum([
      digit(100, 300, h),
      dash(120, 160, 300 - h * 0.45),
      stroke([
        [152, 300 - h * 0.7],
        [160, 300 - h * 0.45],
      ]),
      stroke([
        [160, 300 - h * 0.45],
        [152, 300 - h * 0.2],
      ]),
      digit(168, 300, h),
    ]);
    expect(arrow.some((p) => p.kind === "fraction")).toBe(false);
  });
});

describe("powers by position (FineNotes#178)", () => {
  /** A small digit with its foot `up` digits above `baseline`, `h` the digits' height. */
  const small = (x: number, baseline: number, h: number, up = 0.55) =>
    digit(x, baseline - h * up, h * 0.55);

  it("reads a small digit raised after a number as its power, at any size", () => {
    for (const h of [10, 24, 60]) {
      const five = digit(100, 300, h);
      const two = small(100 + h * 0.7, 300, h);
      const pieces = layoutSum([five, two]);
      expect(kinds(pieces), `h ${h}`).toEqual(["ink", "power"]);
      expect(inkPieces(pieces)).toEqual([[five], [two]]);
      expect(sumText(pieces, ["5", "2"])).toBe("5^(2)");
      expect(answerOf(pieces, ["5", "2"])).toBe("25");
    }
  });

  it("reads 9² + 1 with the plus on the line", () => {
    const h = 24;
    const pieces = layoutSum([
      digit(100, 300, h),
      small(117, 300, h),
      dash(134, 148, 300 - h * 0.45),
      stroke([
        [141, 300 - h * 0.7],
        [141, 300 - h * 0.2],
      ]),
      digit(156, 300, h),
    ]);
    expect(kinds(pieces)).toEqual(["ink", "power", "ink"]);
    expect(answerOf(pieces, ["9", "2", "+ 1"])).toBe("82");
  });

  it("leaves digits on the line, signs at mid height and a lone raised mark alone", () => {
    const h = 24;
    // 52: both on the baseline.
    expect(hasLayout(layoutSum([digit(100, 300, h), digit(118, 300, h)]))).toBe(false);
    // 5 − 2: the minus sits at mid height.
    expect(
      hasLayout(
        layoutSum([digit(100, 300, h), dash(120, 134, 300 - h * 0.45), digit(140, 300, h)]),
      ),
    ).toBe(false);
    // A small raised mark with no base before it.
    expect(hasLayout(layoutSum([small(100, 300, h), digit(130, 300, h)]))).toBe(false);
  });

  it("drops a power whose exponent reads as no digit or letter", () => {
    const h = 24;
    const pieces = layoutSum([digit(100, 300, h), small(117, 300, h)]);
    expect(misreadMarks(pieces, ["5", "'"])).toEqual(new Set([markId(pieces[1])]));
    expect(misreadMarks(pieces, ["5", "2"]).size).toBe(0);
  });
});

describe("powers on real ink (Joost's iPad, FineNotes#178)", () => {
  // Brackets, the "g" of log and a base written low all reach below the
  // line: judged against a line-wide baseline, the digits after them looked
  // raised, and "(x+7)(x+4)" and "log₂(727)" each grew a false power.
  const strokes: Stroke[] = realPage.strokes.map((s) => ({
    id: s.id,
    color: "#000",
    size: 2,
    tool: "pen",
    t0: s.t0 ?? undefined,
    pts: s.pts,
  }));
  const sums = (): Array<{ at: number[]; kinds: string[] }> => {
    const out: Array<{ at: number[]; kinds: string[] }> = [];
    for (let i = 1; i < strokes.length; i++) {
      const eq = equalsAtEnd([strokes[i - 1], strokes[i]]);
      if (!eq) continue;
      const sum = sumStrokes(strokes.slice(0, i + 1), eq, []);
      const ids = new Set(eq.strokes.map((s) => s.id));
      out.push({
        at: [Math.round(eq.bounds.minX), Math.round(eq.bounds.minY)],
        kinds: kinds(layoutSum(sum.filter((s) => !ids.has(s.id)))),
      });
    }
    return out;
  };

  it("finds no power in a product of brackets or a log with its base low", () => {
    const found = sums();
    expect(found.length).toBe(8);
    // Only "log₂ ²⁷", whose 27 really is written raised, has a power.
    const powered = found.filter((f) => f.kinds.includes("power"));
    expect(powered.map((f) => f.at)).toEqual([[861, 485]]);
  });
});

describe("raised dots on Joost's iPad page (FineNotes#178)", () => {
  const strokes: Stroke[] = realDots.strokes.map((s) => ({
    id: s.id,
    color: "#000",
    size: 2,
    tool: "pen",
    t0: s.t0 ?? undefined,
    pts: s.pts,
  }));
  const found: Array<{ y: number; kinds: string[] }> = [];
  for (let i = 1; i < strokes.length; i++) {
    const eq = equalsAtEnd([strokes[i - 1], strokes[i]]);
    if (!eq) continue;
    const sum = sumStrokes(strokes.slice(0, i + 1), eq, []);
    const ids = new Set(eq.strokes.map((s) => s.id));
    found.push({
      y: Math.round(eq.bounds.minY),
      kinds: kinds(layoutSum(sum.filter((s) => !ids.has(s.id)))),
    });
  }

  it("takes the dot between two crossed 7s for times (the left 7's bar reaches past it)", () => {
    expect(found.map((f) => f.y)).toEqual([377, 433, 492, 543, 602, 653]);
    for (const y of [377, 492, 653]) {
      expect(found.find((f) => f.y === y)?.kinds, String(y)).toContain("times");
    }
  });

  it("does not take the first stroke of a × after a small 0 for its power", () => {
    for (const y of [543, 602]) {
      const f = found.find((x) => x.y === y);
      expect(f?.kinds, String(y)).not.toContain("power");
      expect(f?.kinds, String(y)).not.toContain("times");
    }
  });
});

describe("numberOfLookalikes", () => {
  it("reads a number Grape spelled in look-alike letters, and leaves a lone letter", () => {
    expect(numberOfLookalikes("Zo")).toBe("20");
    expect(numberOfLookalikes("l5")).toBe("15");
    expect(numberOfLookalikes("z")).toBe("z");
    expect(numberOfLookalikes("ab")).toBe("ab");
    expect(numberOfLookalikes("so x")).toBe("so x");
  });
});
