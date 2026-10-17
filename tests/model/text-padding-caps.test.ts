/**
 * Text boxes with padding and in capitals, and the named text styles
 * (`src/model/text-style.ts`): applied, undone, saved, measured and drawn the
 * same way on the page and on canvas.
 */

import { describe, expect, it } from "vitest";
import { paintTextBox } from "../../src/canvas/renderer";
import { textInset } from "../../src/canvas/text-layout";
import { type TextBoxElement, blankPage, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { SetTextBoxStyle } from "../../src/model/text-commands";
import {
  DEFAULT_TEXT_STYLE,
  MAX_TEXT_PADDING,
  TEXT_PRESETS,
  applyTextStyle,
  isTextPadding,
  presetOf,
  resetTextStylePatch,
  sanitizeTextStyle,
  shownCase,
  textStyleKey,
  withTextStyle,
} from "../../src/model/text-style";

const box = (extra: Partial<TextBoxElement> = {}): TextBoxElement => ({
  id: "t1",
  x: 20,
  y: 20,
  w: 200,
  text: "Hello",
  color: "#1a1a1a",
  fontSize: 22,
  ...extra,
});

describe("padding", () => {
  it("is kept only when it is a real amount up to the maximum", () => {
    expect(isTextPadding(10)).toBe(true);
    expect(isTextPadding(0)).toBe(false);
    expect(isTextPadding(-2)).toBe(false);
    expect(isTextPadding(MAX_TEXT_PADDING + 1)).toBe(false);
    expect(isTextPadding(Number.NaN)).toBe(false);
  });

  it("is applied, and 0 or null takes it away", () => {
    const style = { ...DEFAULT_TEXT_STYLE };
    applyTextStyle(style, { padding: 10 });
    expect(style.padding).toBe(10);
    applyTextStyle(style, { padding: 0 });
    expect("padding" in style).toBe(false);
    applyTextStyle(style, { padding: 500 });
    expect("padding" in style).toBe(false);
  });

  it("moves the text in from the edge on canvas and in the live box alike", () => {
    expect(textInset({ padding: 10 })).toEqual({
      x: textInset({}).x + 10,
      y: textInset({}).y + 10,
    });
    expect(textInset({ padding: 10, border: { width: 4, color: "#000000" } }).x).toBe(
      textInset({}).x + 14,
    );
  });
});

describe("capitals", () => {
  it("show the text in capitals and leave the typed text as it was", () => {
    expect(shownCase("Notes à faire", { caps: true })).toBe("NOTES À FAIRE");
    expect(shownCase("Notes", {})).toBe("Notes");
    const style = withTextStyle(DEFAULT_TEXT_STYLE, { caps: true });
    expect(style.caps).toBe(true);
    expect(withTextStyle(style, { caps: false }).caps).toBeUndefined();
  });

  it("are drawn in capitals on canvas", () => {
    const drawn: string[] = [];
    const ctx = new Proxy(
      {
        measureText: (s: string) => ({ width: s.length * 10 }),
        fillText: (s: string) => void drawn.push(s),
      } as Record<string, unknown>,
      {
        get: (target, key) => (key in target ? target[key as string] : () => undefined),
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    paintTextBox(ctx, box({ caps: true }));
    expect(drawn.join(" ")).toBe("HELLO");
  });
});

describe("the style's fingerprint, reset and sanitising", () => {
  it("tells styles apart by padding and case", () => {
    const plain = textStyleKey(DEFAULT_TEXT_STYLE);
    expect(textStyleKey(withTextStyle(DEFAULT_TEXT_STYLE, { padding: 4 }))).not.toBe(plain);
    expect(textStyleKey(withTextStyle(DEFAULT_TEXT_STYLE, { caps: true }))).not.toBe(plain);
  });

  it("resets both, and reads both back from settings", () => {
    const styled = withTextStyle(DEFAULT_TEXT_STYLE, { padding: 4, caps: true });
    const reset = withTextStyle(styled, resetTextStylePatch());
    expect(reset.padding).toBeUndefined();
    expect(reset.caps).toBeUndefined();
    expect(sanitizeTextStyle({ ...DEFAULT_TEXT_STYLE, padding: 18, caps: true })).toMatchObject({
      padding: 18,
      caps: true,
    });
    expect(sanitizeTextStyle({ padding: "x", caps: "yes" })).toEqual(DEFAULT_TEXT_STYLE);
  });
});

describe("named styles", () => {
  it("have unique ids and each is recognised after being applied", () => {
    expect(new Set(TEXT_PRESETS.map((p) => p.id)).size).toBe(TEXT_PRESETS.length);
    for (const preset of TEXT_PRESETS) {
      const style = withTextStyle({ ...DEFAULT_TEXT_STYLE, color: "#e03131" }, preset.patch);
      expect(presetOf(style)?.id, preset.id).toBe(preset.id);
      // A preset leaves the colour alone.
      expect(style.color).toBe("#e03131");
    }
  });

  it("recognise no preset in a style that matches none", () => {
    expect(presetOf(withTextStyle(DEFAULT_TEXT_STYLE, { fontSize: 99 }))).toBeUndefined();
  });
});

describe("a padded box in capitals, saved and undone", () => {
  it("keeps padding and capitals through a save, and drops junk", () => {
    const doc = emptyDocument();
    doc.pages = [
      {
        ...blankPage("p1", { width: 400, height: 400 }),
        textBoxes: [box({ padding: 10, caps: true }), box({ id: "t2", padding: -1 })],
      },
    ];
    const [a, b] = decodeDocument(encodeDocument(doc)).pages[0].textBoxes;
    expect(a).toMatchObject({ padding: 10, caps: true });
    expect("padding" in b).toBe(false);
  });

  it("undoes a style change to padding and capitals exactly", () => {
    const doc = emptyDocument();
    const target = box();
    doc.pages = [{ ...blankPage("p1", { width: 400, height: 400 }), textBoxes: [target] }];
    const before = JSON.stringify(target);
    const command = new SetTextBoxStyle("p1", "t1", { padding: 10, caps: true });
    command.apply(doc);
    expect(target).toMatchObject({ padding: 10, caps: true });
    command.invert(doc);
    expect(JSON.stringify(target)).toBe(before);
  });
});
