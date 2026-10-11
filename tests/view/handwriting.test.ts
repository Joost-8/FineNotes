/**
 * `src/view/handwriting.ts`: which ink the on-device reader reads, and which
 * of what it reads counts as writing.
 */

import { describe, expect, it, vi } from "vitest";
import type { Stroke } from "../../src/model/document";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { inkForReading, readingText } = await import("../../src/view/handwriting");

const stroke = (id: string, over: Partial<Stroke> = {}): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen",
  pts: [0, 0, 0.5, 5, 5, 0.5],
  ...over,
});

describe("inkForReading", () => {
  it("reads pen ink only: not highlighter, snapped shapes or tables", () => {
    const ink = inkForReading([
      stroke("pen", { t0: 120 }),
      stroke("marker", { tool: "highlighter" }),
      stroke("box", { shape: "rect" }),
      stroke("table", { shape: "table" as Stroke["shape"] }),
    ]);
    expect(ink).toEqual([
      { id: "pen", tool: "pen", shape: null, t0: 120, pts: [0, 0, 0.5, 5, 5, 0.5] },
    ]);
  });
});

describe("readingText", () => {
  const line = (text: string) => ({ text }) as never;

  it("keeps lines of writing, one per line, trimmed", () => {
    expect(readingText({ lines: [line(" Fourier series "), line("x = 42")] } as never)).toBe(
      "Fourier series\nx = 42",
    );
  });

  it("leaves out drawings read as text: no two letters or digits in a row", () => {
    expect(readingText({ lines: [line("."), line("J-0-0"), line(""), line("ok")] } as never)).toBe(
      "ok",
    );
  });
});
