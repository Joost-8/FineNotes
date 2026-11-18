/**
 * `src/canvas/markdown-layout.ts`: where a Markdown box's lines and marks go.
 */

import { describe, expect, it } from "vitest";
import {
  HEADING_SCALE,
  LIST_INDENT_EM,
  type MarkdownBox,
  type MdMeasure,
  fitMarkdownWidth,
  layoutMarkdownBox,
  markdownLinkRects,
  taskBoxSize,
} from "../../src/canvas/markdown-layout";
import { TEXT_PAD_X, TEXT_PAD_Y } from "../../src/canvas/text-layout";

/** Every character half its font size wide; monospace a little wider. */
const measure: MdMeasure = (text, font) => text.length * font.size * (font.mono ? 0.6 : 0.5);

function box(text: string, extra: Partial<MarkdownBox> = {}): MarkdownBox {
  return { x: 10, y: 20, w: 400, text, color: "#111111", fontSize: 20, ...extra };
}

const shown = (layout: ReturnType<typeof layoutMarkdownBox>): string[] =>
  layout.lines.map((l) => l.runs.map((r) => r.text).join(""));

describe("layoutMarkdownBox", () => {
  it("places the content box inside the padding, one line per plain line", () => {
    const layout = layoutMarkdownBox(box("one\ntwo"), measure);
    expect(layout.x).toBe(10 + TEXT_PAD_X);
    expect(layout.y).toBe(20 + TEXT_PAD_Y);
    expect(shown(layout)).toEqual(["one", "two"]);
    expect(layout.lines.map((l) => l.top)).toEqual([0, 25]);
    expect(layout.height).toBe(50 + 2 * TEXT_PAD_Y);
  });

  it("is one line tall when empty, and keeps a fixed box's height", () => {
    expect(layoutMarkdownBox(box(""), measure).height).toBe(25 + 2 * TEXT_PAD_Y);
    expect(layoutMarkdownBox(box("a\nb\nc", { h: 30 }), measure).height).toBe(30);
  });

  it("draws headings larger and bold, their lines taller", () => {
    const layout = layoutMarkdownBox(box("# Big\n## Less\nbody"), measure);
    const [h1, h2, body] = layout.lines;
    expect(h1.size).toBeCloseTo(20 * HEADING_SCALE[0]);
    expect(h1.runs[0].font.bold).toBe(true);
    expect(h2.size).toBeCloseTo(20 * HEADING_SCALE[1]);
    expect(body.top).toBeCloseTo((h1.size + h2.size) * 1.25);
    expect(body.runs[0].font.bold).toBe(false);
  });

  it("styles runs by their spans and the box's own flags", () => {
    const layout = layoutMarkdownBox(
      box("a **b** `c` ~~d~~ ==e== [[f]]", { italic: true, underline: true }),
      measure,
    );
    const runs = layout.lines[0].runs;
    const byText = (t: string) => runs.find((r) => r.text.trim() === t);
    expect(byText("b")?.font).toEqual({ size: 20, bold: true, italic: true, mono: false });
    expect(byText("c")?.font.mono).toBe(true);
    expect(byText("c")?.code).toBe(true);
    expect(byText("d")?.strike).toBe(true);
    expect(byText("e")?.mark).toBe(true);
    expect(byText("f")?.target).toBe("f");
    expect(runs.every((r) => r.underline)).toBe(true);
  });

  it("joins neighbouring pieces in one look into one run", () => {
    const runs = layoutMarkdownBox(box("plain words here"), measure).lines[0].runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: "plain words here", x: 0, w: 160 });
  });

  it("wraps at spaces, and inside a word only when it alone is too wide", () => {
    // 10 px a character, a 100 px line: ten characters.
    const narrow = box("aaaa bbbb cccc", { w: 100 + 2 * TEXT_PAD_X });
    expect(shown(layoutMarkdownBox(narrow, measure))).toEqual(["aaaa bbbb ", "cccc"]);
    const long = box("abcdefghijklmno", { w: 100 + 2 * TEXT_PAD_X });
    expect(shown(layoutMarkdownBox(long, measure))).toEqual(["abcdefghij", "klmno"]);
  });

  it("lets trailing spaces hang past the edge", () => {
    const exact = box("aaaaa bbbbb", { w: 50 + 2 * TEXT_PAD_X });
    expect(shown(layoutMarkdownBox(exact, measure))).toEqual(["aaaaa ", "bbbbb"]);
  });

  it("keeps a word split across spans together", () => {
    const layout = layoutMarkdownBox(box("aaaaaa **bb**cc", { w: 100 + 2 * TEXT_PAD_X }), measure);
    expect(shown(layout)).toEqual(["aaaaaa ", "bbcc"]);
  });

  it("indents lists by depth, with their markers in a column", () => {
    const layout = layoutMarkdownBox(box("- a\n  - b\n1. c\n- [x] d"), measure);
    const column = 20 * LIST_INDENT_EM;
    expect(layout.lines.map((l) => l.runs[0].x)).toEqual([column, 2 * column, column, column]);
    expect(layout.marks).toEqual([
      { kind: "bullet", x: 0, y: 0, size: 20, depth: 0 },
      { kind: "bullet", x: column, y: 25, size: 20, depth: 1 },
      { kind: "number", x: 0, y: 50, size: 20, text: "1." },
      { kind: "task", x: 0, y: 75, size: 20, done: true, line: 3 },
    ]);
    // A ticked task's words are faint and struck through.
    expect(layout.lines[3].runs[0]).toMatchObject({ muted: true, strike: true });
  });

  it("moves a long number's text over", () => {
    const layout = layoutMarkdownBox(box("1000000. x"), measure);
    expect(layout.lines[0].runs[0].x).toBeCloseTo(80 + 6);
  });

  it("hangs wrapped list lines under the item's text", () => {
    const layout = layoutMarkdownBox(box("- aaaa bbbb", { w: 30 + 40 + 2 * TEXT_PAD_X }), measure);
    expect(layout.lines.map((l) => [l.runs[0].x, l.runs[0].text])).toEqual([
      [30, "aaaa "],
      [30, "bbbb"],
    ]);
  });

  it("indents quotes and draws a bar per level", () => {
    const layout = layoutMarkdownBox(box("> > deep"), measure);
    expect(layout.lines[0].runs[0].x).toBe(40);
    expect(layout.marks.filter((m) => m.kind === "quote")).toEqual([
      { kind: "quote", x: 0, y: 0, w: 2.4, h: 25 },
      { kind: "quote", x: 20, y: 0, w: 2.4, h: 25 },
    ]);
  });

  it("tints code blocks and draws rules across the box", () => {
    const layout = layoutMarkdownBox(box("```\nx = 1\n```\n---"), measure);
    expect(layout.lines[0].runs[0]).toMatchObject({ x: 10, font: { mono: true } });
    const width = 400 - 2 * TEXT_PAD_X;
    expect(layout.marks).toEqual([
      { kind: "code", x: 0, y: 0, w: width, h: 25 },
      { kind: "rule", x: 0, y: 25 + (25 - 1.25) / 2, w: width, h: 1.25 },
    ]);
  });

  it("aligns paragraphs and headings, never lists", () => {
    const layout = layoutMarkdownBox(
      box("ab\n- ab", { align: "right", w: 100 + 2 * TEXT_PAD_X }),
      measure,
    );
    expect(layout.lines[0].runs[0].x).toBe(80);
    expect(layout.lines[1].runs[0].x).toBe(30);
    const centred = layoutMarkdownBox(
      box("ab", { align: "center", w: 100 + 2 * TEXT_PAD_X }),
      measure,
    );
    expect(centred.lines[0].runs[0].x).toBe(40);
  });

  it("shows capitals without touching a link's target", () => {
    const layout = layoutMarkdownBox(box("see [[Note]]", { caps: true }), measure);
    expect(layout.lines[0].runs.map((r) => [r.text, r.target])).toEqual([
      ["SEE ", undefined],
      ["NOTE", "Note"],
    ]);
  });
});

describe("fitMarkdownWidth", () => {
  it("is the widest line unwrapped, headings at their size", () => {
    // "# ab": 2 characters at 1.802 × 20 × 0.5.
    const width = fitMarkdownWidth(box("# ab\nabc"), 8, 1000, measure, 3);
    expect(width).toBe(Math.ceil(2 * 20 * HEADING_SCALE[0] * 0.5 + 2 * TEXT_PAD_X + 3));
  });

  it("stays between its bounds", () => {
    expect(fitMarkdownWidth(box(""), 50, 1000, measure, 3)).toBe(50);
    expect(fitMarkdownWidth(box("a".repeat(500)), 8, 300, measure, 3)).toBe(300);
  });
});

describe("markdownLinkRects", () => {
  it("gives each link's rectangle in page px", () => {
    const layout = layoutMarkdownBox(box("go [here](https://a.b)"), measure);
    expect(markdownLinkRects(layout)).toEqual([
      { x: 10 + TEXT_PAD_X + 30, y: 20 + TEXT_PAD_Y, w: 40, h: 25, target: "https://a.b" },
    ]);
  });
});

describe("taskBoxSize", () => {
  it("is a little under the font size", () => {
    expect(taskBoxSize(20)).toBeCloseTo(15.6);
  });
});
