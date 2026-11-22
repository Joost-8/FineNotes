/**
 * `src/view/note-ink-maths.ts`: a handwritten sum in a text note's section
 * shows its answer after its "=", and a tap writes the answer as ink. The
 * reader is a stand-in returning a fixed reading; the ink is synthetic with
 * hand tremor (ledger "Synthetic test ink must model tremor").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { InkMaths } = await import("../../src/view/note-ink-maths");
import type { InkAnswer } from "../../src/view/note-ink-maths";
import type { Stroke } from "../../src/model/document";
import type { InkBlock } from "../../src/model/text-note";
import { CALC_DELAY_MS } from "../../src/view/calc-notes";

let nextId = 0;
let seed = 11;
function random(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

function stroke(pts: Array<[number, number]>, amp = 0.6): Stroke {
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
  return { id: `s${++nextId}`, color: "#123456", size: 2, tool: "pen", pts: out };
}

function digit(x: number, baseline: number, h: number): Stroke {
  const w = h * 0.55;
  return stroke([
    [x + w, baseline - h],
    [x, baseline - h * 0.6],
    [x + w * 0.9, baseline - h * 0.4],
    [x + w * 0.2, baseline],
  ]);
}

function plus(x: number, baseline: number, h: number): Stroke[] {
  const cy = baseline - h * 0.45;
  return [
    stroke([
      [x, cy],
      [x + h * 0.5, cy],
    ]),
    stroke([
      [x + h * 0.25, cy - h * 0.25],
      [x + h * 0.25, cy + h * 0.25],
    ]),
  ];
}

function equals(x: number, baseline: number, h: number): Stroke[] {
  const w = h * 0.5;
  return [
    stroke([
      [x, baseline - h * 0.6],
      [x + w, baseline - h * 0.62],
    ]),
    stroke([
      [x + 1, baseline - h * 0.3],
      [x + w + 1, baseline - h * 0.28],
    ]),
  ];
}

/** "2+3=" at 40 px, on a section's second line. */
function sumBlock(): InkBlock {
  const h = 40;
  const base = 120;
  return {
    type: "ink",
    id: "ink1",
    height: 260,
    strokes: [
      digit(40, base, h),
      ...plus(80, base, h),
      digit(120, base, h),
      ...equals(165, base, h),
    ],
  };
}

/** Three amounts of 3, 4 and 2 digits, right-aligned, and a line under them. */
function columnBlock(): InkBlock {
  const h = 30;
  const right = 400;
  const strokes: Stroke[] = [];
  [3, 4, 2].forEach((n, i) => {
    const baseline = 60 + i * h * 1.8;
    for (let k = 0; k < n; k++) strokes.push(digit(right - (n - k) * h * 0.75, baseline, h));
  });
  const below = 60 + 2 * h * 1.8 + h * 0.5;
  strokes.push(
    stroke([
      [right - h * 3.5, below],
      [right + h * 0.1, below + 0.5],
    ]),
  );
  return { type: "ink", id: "ink1", height: 400, strokes };
}

function setup(
  reading: string | string[],
  enabled = true,
  start: () => InkBlock = sumBlock,
  columns = false,
) {
  let block = start();
  const shown: Array<InkAnswer | null> = [];
  const commits: InkBlock[] = [];
  const reader = {
    model: vi.fn(async () => ({}) as never),
    readGroups: vi.fn(async (groups: readonly unknown[]) =>
      groups.map((_g, i) => {
        const text = Array.isArray(reading) ? reading[i] : reading;
        return { text, confidence: 0.9, greedy: text, chars: [] };
      }),
    ) as never,
    readPage: vi.fn(async () => ({ lines: [] })) as never,
  };
  let ids = 0;
  const maths = new InkMaths(
    { enabled: () => enabled, columns: () => columns, reader, glyphs: async () => null },
    {
      block: (id) => (id === block.id ? block : null),
      show: (_id, answer) => shown.push(answer),
      newStrokeId: () => `new${++ids}`,
      commit: (_id, next) => {
        block = next;
        commits.push(next);
      },
    },
    {
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (h: number) => clearTimeout(h),
    } as unknown as Window,
  );
  return {
    maths,
    shown,
    commits,
    reader,
    get block() {
      return block;
    },
  };
}

describe("handwritten sums in a text note", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows what was read and its answer after the pen rests, and a tap writes it as ink", async () => {
    const t = setup("2+3=");
    t.maths.strokeDrawn("ink1");
    expect(t.shown).toEqual([]);
    await vi.advanceTimersByTimeAsync(CALC_DELAY_MS + 10);
    const answer = t.shown.at(-1);
    expect(answer?.label).toMatch(/= 5$/);
    // After the "=", at the digits' height.
    expect(answer!.x).toBeGreaterThan(185);
    expect(answer!.height).toBeGreaterThan(20);
    const before = t.block.strokes.length;
    answer!.write();
    await vi.runAllTimersAsync();
    expect(t.commits).toHaveLength(1);
    const added = t.block.strokes.slice(before);
    expect(added.length).toBeGreaterThan(0);
    // In the "="'s pen.
    expect(added.every((s) => s.color === "#123456" && s.id.startsWith("new"))).toBe(true);
    expect(t.shown.at(-1)).toBeNull();
  });

  it("writing on before the reading comes back drops it", async () => {
    const t = setup("2+3=");
    t.maths.strokeDrawn("ink1");
    t.maths.penDown();
    await vi.advanceTimersByTimeAsync(CALC_DELAY_MS + 10);
    expect(t.shown.filter((a) => a !== null)).toEqual([]);
  });

  it("does nothing while calculation notes are off", async () => {
    const t = setup("2+3=", false);
    t.maths.strokeDrawn("ink1");
    await vi.advanceTimersByTimeAsync(CALC_DELAY_MS + 10);
    expect(t.reader.model).not.toHaveBeenCalled();
    expect(t.shown).toEqual([]);
  });

  it("shows nothing for a line that is not a sum", async () => {
    const t = setup("hello=");
    t.maths.strokeDrawn("ink1");
    await vi.advanceTimersByTimeAsync(CALC_DELAY_MS + 10);
    expect(t.shown.filter((a) => a !== null)).toEqual([]);
  });

  it("a line under a column of amounts shows its total under the line, and a tap writes it", async () => {
    const t = setup(["123", "4000", "56"], true, columnBlock, true);
    const rule = t.block.strokes.at(-1)!;
    t.maths.strokeDrawn("ink1");
    await vi.advanceTimersByTimeAsync(CALC_DELAY_MS + 10);
    const answer = t.shown.at(-1);
    expect(answer?.label).toMatch(/4\D?179$/);
    // Under the line.
    const ruleY = rule.pts[1];
    expect(answer!.baseline).toBeGreaterThan(ruleY);
    const before = t.block.strokes.length;
    answer!.write();
    await vi.runAllTimersAsync();
    const added = t.block.strokes.slice(before);
    expect(added.length).toBeGreaterThan(0);
    // Right-aligned with the amounts (their right edge is at 400 or just short of it).
    const right = Math.max(...added.flatMap((s) => s.pts.filter((_v, i) => i % 3 === 0)));
    expect(right).toBeGreaterThan(360);
    expect(right).toBeLessThan(420);
  });

  it("columns stay off without the setting", async () => {
    const t = setup(["123", "4000", "56"], true, columnBlock, false);
    t.maths.strokeDrawn("ink1");
    await vi.advanceTimersByTimeAsync(CALC_DELAY_MS + 10);
    expect(t.shown.filter((a) => a !== null)).toEqual([]);
  });
});
