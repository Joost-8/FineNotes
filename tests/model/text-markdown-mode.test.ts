/**
 * A text box's Markdown mode (discussion #107): stored, styled, undone and
 * drawn formatted on canvas, as thumbnails and exports draw it.
 */

import { describe, expect, it } from "vitest";
import { paintTextBox, paintedTextHeight } from "../../src/canvas/renderer";
import { type TextBoxElement, blankPage, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { SetTextBoxStyle } from "../../src/model/text-commands";
import {
  DEFAULT_TEXT_STYLE,
  resetTextStylePatch,
  sanitizeTextStyle,
  textStyleKey,
  textStyleOf,
  withTextStyle,
} from "../../src/model/text-style";

const box = (extra: Partial<TextBoxElement> = {}): TextBoxElement => ({
  id: "t1",
  x: 20,
  y: 20,
  w: 300,
  text: "# Title\n- **bold** item\n- [x] done",
  color: "#1a1a1a",
  fontSize: 20,
  ...extra,
});

/** A context that records what is written, and measures 10 px a character. */
function recorder(): { ctx: CanvasRenderingContext2D; drawn: string[]; fonts: string[] } {
  const drawn: string[] = [];
  const fonts: string[] = [];
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: (s: string) => {
      drawn.push(s);
      fonts.push(String(target.font));
    },
  };
  const ctx = new Proxy(target, {
    get: (t, key) => (key in t ? t[key as string] : () => undefined),
    set: (t, key, value) => {
      t[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, drawn, fonts };
}

describe("the markdown flag", () => {
  it("is kept through a save as true, and dropped as anything else", () => {
    const doc = emptyDocument();
    doc.pages = [
      {
        ...blankPage("p1", { width: 400, height: 400 }),
        textBoxes: [
          box({ markdown: true }),
          { ...box({ id: "t2" }), markdown: "yes" } as unknown as TextBoxElement,
        ],
      },
    ];
    const [a, b] = decodeDocument(encodeDocument(doc)).pages[0].textBoxes;
    expect(a.markdown).toBe(true);
    expect(a.text).toBe(box().text);
    expect("markdown" in b).toBe(false);
  });

  it("is a style key: in the fingerprint, copied, read from settings", () => {
    const on = withTextStyle(DEFAULT_TEXT_STYLE, { markdown: true });
    expect(on.markdown).toBe(true);
    expect(textStyleKey(on)).not.toBe(textStyleKey(DEFAULT_TEXT_STYLE));
    expect(textStyleOf(on).markdown).toBe(true);
    expect(withTextStyle(on, { markdown: false }).markdown).toBeUndefined();
    expect(sanitizeTextStyle({ ...DEFAULT_TEXT_STYLE, markdown: true }).markdown).toBe(true);
    expect(sanitizeTextStyle({ markdown: 1 })).toEqual(DEFAULT_TEXT_STYLE);
  });

  it("is a mode, not a look: resetting the style keeps it", () => {
    const on = withTextStyle(DEFAULT_TEXT_STYLE, { markdown: true, bold: true });
    const reset = withTextStyle(on, resetTextStylePatch());
    expect(reset.bold).toBeUndefined();
    expect(reset.markdown).toBe(true);
  });

  it("is switched on and undone exactly by the style command", () => {
    const doc = emptyDocument();
    const target = box();
    doc.pages = [{ ...blankPage("p1", { width: 400, height: 400 }), textBoxes: [target] }];
    const before = JSON.stringify(target);
    const command = new SetTextBoxStyle("p1", "t1", { markdown: true });
    command.apply(doc);
    expect(target.markdown).toBe(true);
    command.invert(doc);
    expect(JSON.stringify(target)).toBe(before);
  });
});

describe("painting a markdown box", () => {
  it("draws its words without the marks, headings large and bold", () => {
    const { ctx, drawn, fonts } = recorder();
    paintTextBox(ctx, box({ markdown: true }));
    expect(drawn).toEqual(["Title", "bold", " item", "done"]);
    expect(fonts[0]).toMatch(/^bold 36\.0\d*px /);
    expect(fonts[1]).toMatch(/^bold 20px /);
    expect(fonts[2]).toMatch(/^20px /);
  });

  it("draws the raw text when the mode is off", () => {
    const { ctx, drawn } = recorder();
    paintTextBox(ctx, box());
    expect(drawn).toEqual(["# Title", "- **bold** item", "- [x] done"]);
  });

  it("is as tall as its formatted lines", () => {
    const { ctx } = recorder();
    const plain = paintedTextHeight(ctx, box());
    const formatted = paintedTextHeight(ctx, box({ markdown: true }));
    // The heading's line is 1.802 lines tall; the other two are one each.
    expect(formatted - plain).toBeCloseTo(0.802 * 20 * 1.25);
    expect(paintedTextHeight(ctx, box({ markdown: true, h: 50 }))).toBe(50);
  });
});
