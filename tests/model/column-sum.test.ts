/**
 * `src/model/column-sum.ts` (discussion #228): the line under a column, the
 * rows and their amounts, signs and labels, amounts in the Austrian/German
 * and English conventions, and the totals single and double lines close.
 * Synthetic ink with hand tremor, at two sizes.
 */

import { describe, expect, it } from "vitest";
import {
  type Column,
  type RowValue,
  addAmounts,
  columnAbove,
  columnTotal,
  formatAmount,
  guessConvention,
  isUpstrokeOne,
  marksSettled,
  parseAmount,
  parseTypedColumn,
  rowText,
  ruleAtEnd,
  summarizeColumn,
} from "../../src/model/column-sum";
import { parseLatex } from "../../src/model/latex";
import type { Stroke } from "../../src/model/document";

let nextId = 0;
let seed = 11;
function random(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

/** A polyline through `pts`, sampled every 1.4 px, with tremor of about `amp` px. */
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

/** A digit-like stroke `h` tall with its foot on `baseline`. */
function digit(x: number, baseline: number, h: number): Stroke {
  const w = h * 0.55;
  return stroke([
    [x + w, baseline - h],
    [x, baseline - h * 0.6],
    [x + w * 0.9, baseline - h * 0.4],
    [x + w * 0.2, baseline],
  ]);
}

/** `n` digits from `x`, a digit and a bit apart; returns the strokes and the right edge. */
function number(x: number, baseline: number, h: number, n: number): Stroke[] {
  return Array.from({ length: n }, (_, i) => digit(x + i * h * 0.75, baseline, h));
}

/** A word: `n` small letters, x-height 0.6 of `h`. */
function word(x: number, baseline: number, h: number, n: number): Stroke[] {
  return Array.from({ length: n }, (_, i) => digit(x + i * h * 0.5, baseline, h * 0.6));
}

function dash(x: number, y: number, w: number): Stroke {
  return stroke([
    [x, y],
    [x + w, y + 0.5],
  ]);
}

/**
 * A ledger: each row a name on the left and an amount (right-aligned at
 * `right`), rows `pitch` apart, then a line under the amounts.
 */
function ledger(
  h: number,
  amounts: number[],
  opts: { minus?: number[]; names?: boolean } = {},
): { strokes: Stroke[]; rows: Stroke[][]; right: number; below: number } {
  const pitch = h * 1.8;
  const right = 40 + h * 12;
  const strokes: Stroke[] = [];
  const rows: Stroke[][] = [];
  amounts.forEach((n, i) => {
    const baseline = 60 + i * pitch;
    if (opts.names !== false) strokes.push(...word(40, baseline, h, 5));
    const x = right - n * h * 0.75;
    if (opts.minus?.includes(i)) strokes.push(dash(x - h * 0.9, baseline - h * 0.45, h * 0.5));
    const amount = number(x, baseline, h, n);
    rows.push(amount);
    strokes.push(...amount);
  });
  const below = 60 + (amounts.length - 1) * pitch + h * 0.5;
  return { strokes, rows, right, below };
}

for (const h of [22, 40]) {
  describe(`a column at digit height ${h}`, () => {
    it("a line under the amounts closes a subtotal of every row, names left out", () => {
      const { strokes, rows, right, below } = ledger(h, [3, 4, 2]);
      const line = dash(right - h * 3.5, below, h * 3.6);
      const all = [...strokes, line];
      const rule = ruleAtEnd(all);
      expect(rule?.kind).toBe("subtotal");
      const column = columnAbove(all, rule!);
      expect(column).not.toBeNull();
      expect(column!.rows).toHaveLength(3);
      column!.rows.forEach((row, i) => {
        expect(new Set(row.amount.map((s) => s.id))).toEqual(new Set(rows[i].map((s) => s.id)));
        expect(row.label).toHaveLength(5);
        expect(row.sign).toBe(1);
      });
    });

    it("a double line is a total", () => {
      const { strokes, right, below } = ledger(h, [3, 3]);
      const a = dash(right - h * 3, below, h * 3.2);
      const b = dash(right - h * 3, below + h * 0.25, h * 3.2);
      const rule = ruleAtEnd([...strokes, a, b]);
      expect(rule?.kind).toBe("total");
      expect(rule?.strokes).toHaveLength(2);
      expect(columnAbove([...strokes, a, b], rule!)?.rows).toHaveLength(2);
    });

    it("a short dash in the margin makes the row a minus", () => {
      const { strokes, right, below } = ledger(h, [3, 2, 3], { minus: [1] });
      const line = dash(right - h * 3, below, h * 3.2);
      const column = columnAbove([...strokes, line], ruleAtEnd([...strokes, line])!)!;
      expect(column.rows.map((r) => r.sign)).toEqual([1, -1, 1]);
      expect(column.rows[1].signStrokes).toHaveLength(1);
      expect(column.rows[1].label).toHaveLength(5);
    });

    it("a comma below the baseline and a dash after it stay in their amount's row", () => {
      const { strokes, rows, right, below } = ledger(h, [4, 3, 4], { names: false });
      // "12,50": a comma hanging under the baseline between the digits; "120,-": a dash at the end.
      const extra: Stroke[] = [];
      rows.forEach((row, i) => {
        const base = 60 + i * h * 1.8;
        const x = right - 2 * h * 0.75 - h * 0.1;
        const comma = stroke([
          [x, base - h * 0.08],
          [x - h * 0.08, base + h * 0.3],
        ]);
        extra.push(comma);
        row.push(comma);
      });
      const tail = dash(right + h * 0.1, 60 + h * 1.8 - h * 0.45, h * 0.4);
      extra.push(tail);
      rows[1].push(tail);
      const line = dash(right - h * 4, below + h * 0.3, h * 4.6);
      const all = [...strokes, ...extra, line];
      const column = columnAbove(all, ruleAtEnd(all)!);
      expect(column?.rows).toHaveLength(3);
      column!.rows.forEach((row, i) => {
        expect(new Set(row.amount.map((s) => s.id))).toEqual(new Set(rows[i].map((s) => s.id)));
      });
    });

    it("a t's bar in a name is not taken for an earlier line", () => {
      const { strokes, right, below } = ledger(h, [3, 3, 3]);
      // A wide flat bar in the middle row's name, level with the top of its letters.
      const bar = dash(40, 60 + h * 1.8 - h * 0.5, h * 1.2);
      const line = dash(right - h * 3, below, h * 3.2);
      const all = [...strokes, bar, line];
      const column = columnAbove(all, ruleAtEnd(all)!);
      expect(column?.rows).toHaveLength(3);
      expect(column!.rows.every((row) => row.rule === null)).toBe(true);
    });

    it("an amount column without names works the same", () => {
      const { strokes, right, below } = ledger(h, [2, 2, 2], { names: false });
      const line = dash(right - h * 2, below, h * 2.2);
      expect(columnAbove([...strokes, line], ruleAtEnd([...strokes, line])!)?.rows).toHaveLength(3);
    });

    it("an underline under one word, a strikethrough and an '=' are no column", () => {
      // One row only.
      const { strokes, right, below } = ledger(h, [3]);
      const under = dash(right - h * 3, below, h * 3.2);
      const rule = ruleAtEnd([...strokes, under]);
      expect(rule === null || columnAbove([...strokes, under], rule) === null).toBe(true);
      // A line through the last row.
      const two = ledger(h, [3, 3]);
      const through = dash(two.right - h * 3, two.below - h, h * 3.2);
      const r2 = ruleAtEnd([...two.strokes, through]);
      expect(r2 === null || columnAbove([...two.strokes, through], r2) === null).toBe(true);
      // Ink level with the line, just to its left (a sum before an "=").
      const three = ledger(h, [3, 3]);
      const sum = number(three.right - h * 6.5, three.below + h * 0.4, h, 3);
      const line = dash(three.right - h * 3, three.below + h * 0.1, h * 3.2);
      const all = [...three.strokes, ...sum, line];
      const r3 = ruleAtEnd(all);
      expect(r3 === null || columnAbove(all, r3) === null).toBe(true);
    });

    it("a heading above the column ends it", () => {
      const { strokes, right, below } = ledger(h, [3, 3]);
      const heading = word(40, 60 - h * 1.8, h, 8);
      const line = dash(right - h * 3, below, h * 3.2);
      const all = [...heading, ...strokes, line];
      expect(columnAbove(all, ruleAtEnd(all)!)?.rows).toHaveLength(2);
    });

    it("an earlier line in the column is a row of its own", () => {
      const pitch = h * 1.8;
      const { strokes, right } = ledger(h, [3, 3, 3, 3], { names: false });
      // A subtotal line between the second and the third row.
      const mid = dash(right - h * 3, 60 + pitch + h * 0.55, h * 3.2);
      const end = dash(right - h * 3, 60 + 3 * pitch + h * 0.5, h * 3.2);
      // Shift rows 3 and 4 down to make room for the line.
      const all = [...strokes, mid, end];
      const column = columnAbove(all, ruleAtEnd(all)!);
      expect(column).not.toBeNull();
      expect(column!.rows.some((r) => r.rule !== null)).toBe(true);
    });
  });
}

describe("parseAmount", () => {
  it("reads the Austrian/German convention", () => {
    expect(parseAmount("1.234,50", "de")).toEqual({ units: 123450, scale: 2 });
    expect(parseAmount("12,5", "de")).toEqual({ units: 125, scale: 1 });
    expect(parseAmount("120,-", "de")).toEqual({ units: 120, scale: 0 });
    expect(parseAmount("120,--", "de")).toEqual({ units: 120, scale: 0 });
    expect(parseAmount("1.200,–", "de")).toEqual({ units: 1200, scale: 0 });
    expect(parseAmount("-45,00", "de")).toEqual({ units: -4500, scale: 2 });
    expect(parseAmount("1 234,50", "de")).toEqual({ units: 123450, scale: 2 });
    expect(parseAmount("1.234", "de")).toEqual({ units: 1234, scale: 0 });
  });

  it("reads the English convention", () => {
    expect(parseAmount("1,234.50", "en")).toEqual({ units: 123450, scale: 2 });
    expect(parseAmount("0.75", "en")).toEqual({ units: 75, scale: 2 });
    expect(parseAmount("1,234", "en")).toEqual({ units: 1234, scale: 0 });
  });

  it("refuses dates, document numbers, words and stray groups", () => {
    for (const t of [
      "12.03.2024",
      "12.3.24",
      "RE-2024",
      "x+2",
      "1.23,5",
      "1,2,3",
      ".",
      "",
      "12,34,56",
    ]) {
      expect(parseAmount(t, "de")).toBeNull();
    }
    for (const t of ["03/12/2024", "1.2.3", "1,23.5"]) expect(parseAmount(t, "en")).toBeNull();
  });
});

describe("guessConvention", () => {
  it("knows a decimal comma, a whole-amount dash and thousands dots", () => {
    expect(guessConvention(["12,50", "3"], "en")).toBe("de");
    expect(guessConvention(["120,-", "80"], "en")).toBe("de");
    expect(guessConvention(["1.234,5"], "en")).toBe("de");
    expect(guessConvention(["12.50", "3.20"], "de")).toBe("en");
    expect(guessConvention(["12", "30"], "de")).toBe("de");
  });
});

describe("formatAmount and addAmounts", () => {
  it("adds exactly, in cents", () => {
    let sum = { units: 0, scale: 0 };
    for (const t of ["0,10", "0,20", "0,30"]) sum = addAmounts(sum, parseAmount(t, "de")!);
    expect(formatAmount(sum, "de")).toBe("0,60");
  });

  it("writes as the column does", () => {
    expect(formatAmount({ units: 123450, scale: 2 }, "de")).toBe("1.234,50");
    expect(formatAmount({ units: 123450, scale: 2 }, "en")).toBe("1,234.50");
    expect(formatAmount({ units: -5, scale: 2 }, "de")).toBe("-0,05");
    expect(formatAmount({ units: 1200, scale: 0 }, "de", 2)).toBe("1.200,00");
    expect(formatAmount({ units: 1234567, scale: 0 }, "de")).toBe("1.234.567");
  });
});

describe("columnTotal", () => {
  const amountRow = (sign: 1 | -1 = 1) => ({
    amount: [digit(0, 0, 10)],
    sign,
    signStrokes: [],
    label: [],
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    rule: null,
  });
  const lineRow = (kind: "subtotal" | "total") => ({
    amount: [],
    sign: 1 as const,
    signStrokes: [],
    label: [],
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    rule: { kind, strokes: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
  });
  const col = (kind: "subtotal" | "total", rows: Column["rows"]): Column => ({
    rule: { kind, strokes: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
    rows,
    digit: 10,
  });
  const v = (t: string): RowValue => ({ text: t, value: parseAmount(t, "de") });

  it("adds the rows, minus rows taken away", () => {
    const c = col("subtotal", [amountRow(), amountRow(-1), amountRow()]);
    const r = columnTotal(c, [v("100,00"), v("20,50"), v("3")]);
    expect(formatAmount(r.total!, "de", r.scale)).toBe("82,50");
  });

  it("withholds the total while a row does not read as an amount", () => {
    const c = col("subtotal", [amountRow(), amountRow()]);
    const r = columnTotal(c, [v("100,00"), v("12.03.2024")]);
    expect(r.total).toBeNull();
    expect(r.unread).toEqual([1]);
  });

  it("a single line adds the rows since the line before it; a double line adds all", () => {
    // 10 + 20, line, its written result 30, then 5 + 7.
    const rows = [
      amountRow(),
      amountRow(),
      lineRow("subtotal"),
      amountRow(),
      amountRow(),
      amountRow(),
    ];
    const values = [v("10"), v("20"), null, v("30"), v("5"), v("7")];
    const sub = columnTotal(col("subtotal", rows), values);
    expect(sub.total).toEqual({ units: 12, scale: 0 });
    expect(sub.rows).toEqual([4, 5]);
    const total = columnTotal(col("total", rows), values);
    expect(total.total).toEqual({ units: 42, scale: 0 });
    expect(total.rows).toEqual([0, 1, 4, 5]);
  });

  it("a row under a line that is not its result is added", () => {
    const rows = [amountRow(), lineRow("subtotal"), amountRow(), amountRow()];
    const total = columnTotal(col("total", rows), [v("10"), null, v("4"), v("6")]);
    expect(total.total).toEqual({ units: 20, scale: 0 });
  });
});

describe("isUpstrokeOne", () => {
  const h = 30;
  it("knows a plain 1 and a 1 with its upstroke, drawn either way", () => {
    expect(
      isUpstrokeOne(
        [
          stroke([
            [10, 0],
            [11, h],
          ]),
        ],
        h,
      ),
    ).toBe(true);
    expect(
      isUpstrokeOne(
        [
          stroke([
            [2, h * 0.4],
            [10, 0],
            [11, h],
          ]),
        ],
        h,
      ),
    ).toBe(true);
    expect(
      isUpstrokeOne(
        [
          stroke([
            [11, h],
            [10, 0],
            [2, h * 0.4],
          ]),
        ],
        h,
      ),
    ).toBe(true);
    // Slanted, as written fast.
    expect(
      isUpstrokeOne(
        [
          stroke([
            [4, h * 0.35],
            [14, 0],
            [8, h],
          ]),
        ],
        h,
      ),
    ).toBe(true);
  });

  it("refuses a 7, a 4, a 9, a dot and two strokes", () => {
    // 7: flat top, then the diagonal.
    expect(
      isUpstrokeOne(
        [
          stroke([
            [0, 0],
            [16, 0],
            [5, h],
          ]),
        ],
        h,
      ),
    ).toBe(false);
    // 4 in one stroke: down, right, then up and down the stem.
    expect(
      isUpstrokeOne(
        [
          stroke([
            [8, 0],
            [0, h * 0.65],
            [18, h * 0.65],
          ]),
        ],
        h,
      ),
    ).toBe(false);
    // 9: a loop at the top, then the tail.
    expect(
      isUpstrokeOne(
        [
          stroke([
            [14, 4],
            [6, 0],
            [0, 6],
            [6, 13],
            [14, 8],
            [14, 4],
            [12, h],
          ]),
        ],
        h,
      ),
    ).toBe(false);
    expect(
      isUpstrokeOne(
        [
          stroke([
            [5, 5],
            [6, 6],
          ]),
        ],
        h,
      ),
    ).toBe(false);
    expect(
      isUpstrokeOne(
        [
          stroke([
            [10, 0],
            [11, h],
          ]),
          stroke([
            [5, h],
            [16, h],
          ]),
        ],
        h,
      ),
    ).toBe(false);
  });
});

describe("summarizeColumn", () => {
  const h = 30;
  function column(n: number, minus: number[] = []): Column {
    const { strokes, right, below } = ledger(h, Array(n).fill(3) as number[], { minus });
    const line = dash(right - h * 3, below, h * 3.2);
    const all = [...strokes, line];
    return columnAbove(all, ruleAtEnd(all)!)!;
  }

  it("adds the rows in the convention they are written in, lined up on the comma", () => {
    const c = column(3, [2]);
    const s = summarizeColumn(c, ["1.234,50", "20,-", "5"], "en");
    expect(s.convention).toBe("de");
    expect(s.totalText).toBe("1.249,50");
    expect(s.shown).toEqual([0, 1, 2]);
    expect(s.tex).toContain(String.raw`\mathrm{1.234,50}`);
    expect(s.tex).toContain(String.raw`\mathrm{20,00}`);
    expect(s.tex).toContain(String.raw`\underline{\mathrm{-5,00}}`);
    expect(s.expression).toBe("1.234,50 + 20,00 - 5,00");
    // The card's LaTeX parses: a matrix of three rows.
    expect(s.tex.split(String.raw` \\ `)).toHaveLength(3);
    expect(JSON.stringify(parseLatex(s.tex))).toContain('"matrix"');
  });

  it("withholds the total while a row does not read, and shows what it read", () => {
    const s = summarizeColumn(column(2), ["12", "4l"], "de");
    expect(s.totalText).toBeNull();
    expect(s.total.unread).toEqual([1]);
    expect(s.tex).toContain(String.raw`\text{4l}`);
  });

  it("a typed amount stands in for a row's reading, sign included", () => {
    const c = column(2, [1]);
    const typed = new Map([[1, { units: 300, scale: 2 }]]);
    const s = summarizeColumn(c, ["10", "4l"], "de", typed);
    // The ink minus is undone: the typed +3,00 is what counts.
    expect(s.totalText).toBe("13,00");
  });

  it("a double line gets a double underline", () => {
    const { strokes, right, below } = ledger(h, [3, 3]);
    const a = dash(right - h * 3, below, h * 3.2);
    const b = dash(right - h * 3, below + h * 0.25, h * 3.2);
    const all = [...strokes, a, b];
    const c = columnAbove(all, ruleAtEnd(all)!)!;
    const s = summarizeColumn(c, ["100", "250"], "en");
    expect(s.totalText).toBe("350");
    expect(s.tex).toContain(String.raw`\underline{\underline{\mathrm{250}}}`);
  });
});

describe("parseTypedColumn", () => {
  it("reads signed amounts, the whole-amount dash included", () => {
    expect(parseTypedColumn("1.234,50 + 20,- - 5", "de")).toEqual([
      { units: 123450, scale: 2 },
      { units: 20, scale: 0 },
      { units: -5, scale: 0 },
    ]);
    expect(parseTypedColumn("12.50-3", "en")).toEqual([
      { units: 1250, scale: 2 },
      { units: -3, scale: 0 },
    ]);
  });

  it("refuses a part that is not an amount", () => {
    expect(parseTypedColumn("12 + abc", "de")).toBeNull();
    expect(parseTypedColumn("", "de")).toBeNull();
  });
});

describe("rowText", () => {
  it("keeps a reading with a digit, and turns a lone upstroke 1 read as a dot into 1", () => {
    const one = stroke([
      [10, 30],
      [20, 10],
      [21, 60],
    ]);
    expect(rowText("17", [one], 50)).toBe("17");
    expect(rowText(".", [one], 50)).toBe("1");
    expect(rowText("a", [dash(0, 0, 40)], 50)).toBe("a");
  });
});

describe("marksSettled", () => {
  // "12,50" at digit height 40, baseline 100: four digits and a mark between 2 and 5.
  const d = (x: number): Stroke => digit(x, 100, 40);
  function reading(mark: Stroke, read: string) {
    const ink = [d(0), d(30), mark, d(70), d(100)];
    return {
      ink,
      piece: {
        text: `12${read}50`,
        confidence: 0.9,
        greedy: `12${read}50`,
        chars: ["1", "2", read, "5", "0"].map((char, i) => ({
          char,
          strokes: [i],
          confidence: 0.6,
          alternatives: [{ char: "," }],
        })),
      },
    };
  }

  it("a mark hanging below the baseline is a comma, whatever Grape read", () => {
    const comma = stroke([
      [58, 96],
      [55, 110],
    ]);
    for (const read of [".", "/"]) {
      const { ink, piece } = reading(comma, read);
      const out = marksSettled(piece, ink, 40);
      expect(out.text).toBe("12,50");
      expect(out.chars?.[2]).toMatchObject({ char: ",", confidence: 1 });
    }
  });

  it("settles the text even where only the language model changed the mark", () => {
    const comma = stroke([
      [58, 96],
      [55, 110],
    ]);
    const { ink, piece } = reading(comma, ",");
    const out = marksSettled({ ...piece, text: "12.50" }, ink, 40);
    expect(out.text).toBe("12,50");
  });

  it("a dot on the baseline is a full stop", () => {
    const dot = stroke([
      [57, 98],
      [58, 99.5],
    ]);
    const { ink, piece } = reading(dot, ",");
    expect(marksSettled(piece, ink, 40).text).toBe("12.50");
  });

  it("leaves digits and a minus at mid height alone", () => {
    const minus = dash(50, 80, 12);
    const { ink, piece } = reading(minus, "-");
    expect(marksSettled(piece, ink, 40).text).toBe("12-50");
  });
});
