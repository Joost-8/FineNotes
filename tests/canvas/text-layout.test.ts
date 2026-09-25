/**
 * `src/canvas/text-layout.ts` — line layout for text boxes, stated once so
 * the canvas thumbnail wraps where the DOM textarea does.
 *
 * `measure` is a fake monospace: every character is 10 px wide, so every
 * expected break below can be checked by counting characters.
 */

import { describe, expect, it } from "vitest";
import {
  TEXT_FIT_SLACK,
  TEXT_PAD_X,
  TEXT_PAD_Y,
  alignLines,
  baselineOffset,
  canvasFont,
  decorationMetrics,
  fitTextWidth,
  layoutTextBox,
  textDecorationOf,
  wrapText,
} from "../../src/canvas/text-layout";
import { TEXT_FONT_STACKS } from "../../src/model/document";

const mono = (text: string): number => text.length * 10;
const texts = (lines: Array<{ text: string }>): string[] => lines.map((l) => l.text);

describe("wrapText", () => {
  it("breaks at spaces, greedily", () => {
    expect(texts(wrapText("the quick brown fox", 100, mono))).toEqual(["the quick ", "brown fox"]);
  });

  it("lets trailing spaces hang past the edge instead of forcing a break", () => {
    // "abcd efgh" is 90 px; the space after "abcd" must not push "efgh" down.
    expect(texts(wrapText("abcd efgh", 90, mono))).toEqual(["abcd efgh"]);
    expect(texts(wrapText("abcd     efgh", 40, mono))).toEqual(["abcd     ", "efgh"]);
  });

  it("keeps explicit newlines, empty lines and a trailing newline", () => {
    const lines = wrapText("one\n\ntwo\n", 200, mono);
    expect(texts(lines)).toEqual(["one", "", "two", ""]);
    expect(lines.map((l) => l.last)).toEqual([true, true, true, true]);
  });

  it("marks only the end of a paragraph as its last line", () => {
    const lines = wrapText("aa bb cc dd", 50, mono);
    expect(texts(lines)).toEqual(["aa bb ", "cc dd"]);
    expect(lines.map((l) => l.last)).toEqual([false, true]);
  });

  it("breaks inside a word only when it alone is wider than the line", () => {
    expect(texts(wrapText("abcdefghij", 40, mono))).toEqual(["abcd", "efgh", "ij"]);
    expect(texts(wrapText("ab abcdefgh cd", 40, mono))).toEqual(["ab ", "abcd", "efgh ", "cd"]);
  });

  it("keeps leading spaces (indentation) as content", () => {
    expect(texts(wrapText("  indented", 200, mono))).toEqual(["  indented"]);
  });

  it("puts at least one character on each line of a box narrower than a glyph", () => {
    expect(texts(wrapText("abc", 5, mono))).toEqual(["a", "b", "c"]);
    expect(texts(wrapText("ab", -10, mono))).toEqual(["a", "b"]);
  });

  it("never splits a surrogate pair", () => {
    const lines = wrapText("😀😀😀", 10, mono);
    expect(lines.every((l) => l.text.length === 2 || l.text === "")).toBe(true);
  });

  it("returns one empty line for empty text", () => {
    expect(wrapText("", 100, mono)).toEqual([{ text: "", last: true }]);
  });
});

describe("alignLines", () => {
  const one = [{ text: "abc ", last: true }];

  it("offsets by alignment, ignoring hanging spaces", () => {
    expect(alignLines(one, 100, "left", mono)[0]).toEqual({
      runs: [{ text: "abc", x: 0 }],
      left: 0,
      right: 30,
    });
    expect(alignLines(one, 100, "center", mono)[0].runs[0].x).toBe(35);
    expect(alignLines(one, 100, "right", mono)[0].runs[0].x).toBe(70);
  });

  it("start-aligns content wider than the line, whatever the alignment", () => {
    const wide = [{ text: "abcdefghijkl", last: true }];
    expect(alignLines(wide, 100, "right", mono)[0].runs[0].x).toBe(0);
    expect(alignLines(wide, 100, "center", mono)[0].runs[0].x).toBe(0);
  });

  it("justifies by spreading the spare width over the word gaps", () => {
    const [line] = alignLines([{ text: "aa bb cc ", last: false }], 100, "justify", mono);
    // 80 px used, 20 spare over 2 gaps: +10 each.
    expect(line.runs).toEqual([
      { text: "aa", x: 0 },
      { text: "bb", x: 40 },
      { text: "cc", x: 80 },
    ]);
    expect(line.left).toBe(0);
    expect(line.right).toBe(100);
  });

  it("leaves the last line of a paragraph and single words left-aligned under justify", () => {
    expect(alignLines([{ text: "aa bb", last: true }], 100, "justify", mono)[0].runs).toEqual([
      { text: "aa bb", x: 0 },
    ]);
    expect(alignLines([{ text: "word", last: false }], 100, "justify", mono)[0].runs).toEqual([
      { text: "word", x: 0 },
    ]);
  });

  it("gives an empty line no runs", () => {
    expect(alignLines([{ text: "", last: true }], 100, "center", mono)[0].runs).toEqual([]);
  });
});

describe("layoutTextBox", () => {
  const box = { x: 10, y: 20, w: 108, text: "aa bb cc dd", color: "#000", fontSize: 20 };

  it("wraps inside the padding and grows an auto-height box to its lines", () => {
    const layout = layoutTextBox(box, mono);
    expect(layout.x).toBe(10 + TEXT_PAD_X);
    expect(layout.y).toBe(20 + TEXT_PAD_Y);
    expect(layout.width).toBe(100);
    expect(layout.lineBox).toBe(25); // 20 px at the default 1.25
    expect(layout.lines.map((l) => l.runs.map((r) => r.text).join(""))).toEqual(["aa bb cc", "dd"]);
    expect(layout.height).toBe(2 * TEXT_PAD_Y + 2 * 25);
  });

  it("is at least one line tall when empty, and keeps a fixed height as is", () => {
    expect(layoutTextBox({ ...box, text: "" }, mono).height).toBe(2 * TEXT_PAD_Y + 25);
    expect(layoutTextBox({ ...box, h: 400 }, mono).height).toBe(400);
  });

  it("uses the box's line height and alignment", () => {
    const layout = layoutTextBox({ ...box, text: "ab", lineHeight: 2, align: "right" }, mono);
    expect(layout.lineBox).toBe(40);
    expect(layout.lines[0].runs[0].x).toBe(80);
  });
});

describe("drawing helpers", () => {
  it("centres the glyph box in the line box, as CSS half-leading does", () => {
    expect(baselineOffset(30, 16, 4)).toBe(21);
    expect(baselineOffset(20, 16, 4)).toBe(16);
  });

  it("builds a canvas font shorthand from real families", () => {
    expect(canvasFont({ color: "#000", fontSize: 22 }, 22)).toBe(`22px ${TEXT_FONT_STACKS.sans}`);
    expect(
      canvasFont({ color: "#000", fontSize: 22, bold: true, italic: true, font: "serif" }, 30),
    ).toBe(`italic bold 30px ${TEXT_FONT_STACKS.serif}`);
    expect(canvasFont({ color: "#000", fontSize: 22, font: "times" }, 22)).not.toContain("var(");
  });

  it("maps underline and strikethrough to a CSS text-decoration", () => {
    const base = { color: "#000", fontSize: 22 };
    expect(textDecorationOf(base)).toBe("none");
    expect(textDecorationOf({ ...base, underline: true })).toBe("underline");
    expect(textDecorationOf({ ...base, strike: true })).toBe("line-through");
    expect(textDecorationOf({ ...base, underline: true, strike: true })).toBe(
      "underline line-through",
    );
  });

  it("places underline below and strikethrough above the baseline", () => {
    const m = decorationMetrics(20);
    expect(m.underline).toBeGreaterThan(0);
    expect(m.strike).toBeLessThan(0);
    expect(decorationMetrics(4).thickness).toBe(1);
  });
});

describe("fitTextWidth", () => {
  const pad = 2 * TEXT_PAD_X + TEXT_FIT_SLACK;

  it("is as wide as the widest paragraph, padding and slack included", () => {
    expect(fitTextWidth("abc", 0, 1000, mono)).toBe(30 + pad);
    expect(fitTextWidth("ab\nabcdef\nabcd", 0, 1000, mono)).toBe(60 + pad);
  });

  it("never goes under the minimum: an empty box still has room for the caret", () => {
    expect(fitTextWidth("", 40, 1000, mono)).toBe(40);
    expect(fitTextWidth("a", 40, 1000, mono)).toBe(40);
  });

  it("stops at the maximum, where the page ends", () => {
    expect(fitTextWidth("a".repeat(200), 40, 300, mono)).toBe(300);
  });

  it("keeps the minimum when the page leaves less room than that", () => {
    expect(fitTextWidth("abcdef", 40, 10, mono)).toBe(40);
  });

  it("lets trailing spaces hang instead of widening the box", () => {
    expect(fitTextWidth("abc   ", 0, 1000, mono)).toBe(fitTextWidth("abc", 0, 1000, mono));
  });

  it("gives a width the layout does not wrap at", () => {
    const text = "the quick brown\nfox";
    const w = fitTextWidth(text, 0, 1000, mono);
    const layout = layoutTextBox({ x: 0, y: 0, w, text, color: "#000", fontSize: 20 }, mono);
    expect(layout.lines).toHaveLength(2);
  });
});
