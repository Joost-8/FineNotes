/**
 * `paintTextBox` in `src/canvas/renderer.ts` — how a text box looks in a page
 * thumbnail. It must paint every whole-box style the pill sets (font, weight,
 * alignment, line height, fill, underline, strikethrough), and a box written
 * before 0.5, with none of them, must paint as plain text and nothing else.
 *
 * The context is a recording stub whose `measureText` is monospace: every
 * character is half the font size wide.
 */

import { describe, expect, it } from "vitest";
import { paintTextBox } from "../../src/canvas/renderer";
import { TEXT_PAD_X, TEXT_PAD_Y } from "../../src/canvas/text-layout";
import { TEXT_FONT_STACKS, type TextBoxElement } from "../../src/model/document";

interface Painted {
  fillRects: Array<{ x: number; y: number; w: number; h: number; style: string }>;
  texts: Array<{ text: string; x: number; y: number; font: string; style: string }>;
  clips: number;
}

function recorder(): { ctx: CanvasRenderingContext2D; painted: Painted } {
  const painted: Painted = { fillRects: [], texts: [], clips: 0 };
  const state = { font: "10px sans-serif", fillStyle: "#000", textBaseline: "alphabetic" };
  const stack: Array<typeof state> = [];
  const px = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10);
  const ctx = {
    get font() {
      return state.font;
    },
    set font(value: string) {
      state.font = value;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(value: string) {
      state.textBaseline = value;
    },
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => {
      painted.clips++;
    },
    fillRect: (x: number, y: number, w: number, h: number) =>
      painted.fillRects.push({ x, y, w, h, style: state.fillStyle }),
    fillText: (text: string, x: number, y: number) =>
      painted.texts.push({ text, x, y, font: state.font, style: state.fillStyle }),
    measureText: (text: string) => ({
      width: text.length * px() * 0.5,
      fontBoundingBoxAscent: px() * 0.8,
      fontBoundingBoxDescent: px() * 0.2,
    }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, painted };
}

function box(overrides: Partial<TextBoxElement> = {}): TextBoxElement {
  return {
    id: "t1",
    x: 100,
    y: 50,
    w: 208,
    text: "Hello",
    color: "#1a1a1a",
    fontSize: 20,
    ...overrides,
  };
}

describe("paintTextBox", () => {
  it("paints a pre-0.5 box as plain left-aligned text in the default face, and nothing else", () => {
    const { ctx, painted } = recorder();
    paintTextBox(ctx, box());
    expect(painted.fillRects).toEqual([]);
    expect(painted.texts).toHaveLength(1);
    const [text] = painted.texts;
    expect(text.text).toBe("Hello");
    expect(text.x).toBe(100 + TEXT_PAD_X);
    expect(text.font).toBe(`20px ${TEXT_FONT_STACKS.sans}`);
    expect(text.style).toBe("#1a1a1a");
    // Default line height 1.25: a 25 px line box, glyphs (16 + 4) centred in it.
    expect(text.y).toBeCloseTo(50 + TEXT_PAD_Y + 2.5 + 16);
  });

  it("uses the box's font, weight and slant, never a CSS variable", () => {
    const { ctx, painted } = recorder();
    paintTextBox(ctx, box({ font: "serif", bold: true, italic: true }));
    expect(painted.texts[0].font).toBe(`italic bold 20px ${TEXT_FONT_STACKS.serif}`);
    expect(painted.texts[0].font).not.toContain("var(");
  });

  it("fills the whole box under the text, grown to its lines when auto-height", () => {
    const { ctx, painted } = recorder();
    // 200 px of content at 10 px per character: 10 + 1 + 19 characters wrap once.
    paintTextBox(ctx, box({ text: "aaaaaaaaaa bbbbbbbbbbbbbbbbbbb", fill: "#fff3b0" }));
    expect(painted.fillRects[0]).toEqual({
      x: 100,
      y: 50,
      w: 208,
      h: 2 * TEXT_PAD_Y + 2 * 25,
      style: "#fff3b0",
    });
    expect(painted.texts.map((t) => t.text)).toEqual(["aaaaaaaaaa", "bbbbbbbbbbbbbbbbbbb"]);
    expect(painted.texts[1].y - painted.texts[0].y).toBeCloseTo(25);
  });

  it("paints a fill alone for an empty filled box, and nothing for an empty plain one", () => {
    const filled = recorder();
    paintTextBox(filled.ctx, box({ text: "", fill: "#d6ecff", h: 80 }));
    expect(filled.painted.fillRects).toEqual([{ x: 100, y: 50, w: 208, h: 80, style: "#d6ecff" }]);
    expect(filled.painted.texts).toEqual([]);
    const plain = recorder();
    paintTextBox(plain.ctx, box({ text: "" }));
    expect(plain.painted.fillRects).toEqual([]);
  });

  it("aligns right and centre within the padding", () => {
    const right = recorder();
    paintTextBox(right.ctx, box({ align: "right" }));
    // "Hello" is 50 px in a 200 px content box.
    expect(right.painted.texts[0].x).toBe(100 + TEXT_PAD_X + 150);
    const centre = recorder();
    paintTextBox(centre.ctx, box({ align: "center" }));
    expect(centre.painted.texts[0].x).toBe(100 + TEXT_PAD_X + 75);
  });

  it("justifies word by word except on a paragraph's last line", () => {
    const { ctx, painted } = recorder();
    paintTextBox(ctx, box({ text: "aaa bbb ccccccccccccccccccc", align: "justify" }));
    // Line 1 "aaa bbb" (70 px) is spread over 200 px; line 2 is left as is.
    expect(painted.texts.map((t) => [t.text, t.x - 100 - TEXT_PAD_X])).toEqual([
      ["aaa", 0],
      ["bbb", 170],
      ["ccccccccccccccccccc", 0],
    ]);
  });

  it("follows the line height", () => {
    const { ctx, painted } = recorder();
    paintTextBox(ctx, box({ text: "a\nb", lineHeight: 2 }));
    expect(painted.texts[1].y - painted.texts[0].y).toBeCloseTo(40);
  });

  it("draws underline below and strikethrough through each line, in the text colour", () => {
    const { ctx, painted } = recorder();
    paintTextBox(ctx, box({ underline: true, strike: true, color: "#e03131" }));
    const baseline = painted.texts[0].y;
    const [under, strike] = painted.fillRects;
    expect(under.w).toBe(50);
    expect(under.y).toBeGreaterThan(baseline);
    expect(strike.y).toBeLessThan(baseline);
    expect(under.style).toBe("#e03131");
    expect(strike.style).toBe("#e03131");
  });

  it("clips the text of a fixed-height box to the box", () => {
    const { ctx, painted } = recorder();
    paintTextBox(ctx, box({ h: 30 }));
    expect(painted.clips).toBe(1);
  });
});
