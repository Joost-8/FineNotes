/**
 * `src/model/text-style.ts` and `src/model/text-commands.ts` — the 0.5 text
 * tool's whole-box style and its one command.
 *
 * The rule under test everywhere here is contracts/api.md §3/§6: a style key
 * is a real non-default value or absent. `false` is never stored, a default
 * deletes the key, and an inverse restores an absent key as absent — so a
 * round trip is `JSON.stringify`-identical.
 */

import { describe, expect, it } from "vitest";
import type { Command } from "../../src/model/commands";
import {
  type InkDocument,
  type TextBoxElement,
  TEXT_FONT_STACKS,
  emptyDocument,
} from "../../src/model/document";
import { History } from "../../src/model/history";
import { AddTextBoxToPage, SetTextBoxFrame } from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { SetTextBoxStyle } from "../../src/model/text-commands";
import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXT_STYLE,
  LINE_HEIGHTS,
  MIN_TEXT_SIZE,
  TEXT_FILLS,
  TEXT_SIZES,
  type TextStyle,
  applyTextStyle,
  changesTextStyle,
  fontFamilyOf,
  fontOf,
  isHexColor,
  lineHeightOf,
  resetTextStylePatch,
  sanitizeTextStyle,
  textStyleKey,
  textStyleOf,
  withTextStyle,
} from "../../src/model/text-style";

function plainBox(overrides: Partial<TextBoxElement> = {}): TextBoxElement {
  return {
    id: "t1",
    x: 10,
    y: 20,
    w: 300,
    text: "Hello",
    color: "#1a1a1a",
    fontSize: 22,
    ...overrides,
  };
}

function docWith(box: TextBoxElement): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].textBoxes.push(box);
  return doc;
}

function assertRoundTrip(doc: InkDocument, cmd: Command): void {
  const before = JSON.stringify(doc);
  cmd.apply(doc);
  const after = JSON.stringify(doc);
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: undo`).toBe(before);
  cmd.apply(doc);
  expect(JSON.stringify(doc), `${cmd.label}: redo`).toBe(after);
  cmd.invert(doc);
  expect(JSON.stringify(doc), `${cmd.label}: undo after redo`).toBe(before);
}

describe("applyTextStyle", () => {
  it("stores real values and deletes defaults instead of storing them", () => {
    const style: TextStyle = { color: "#000", fontSize: 22 };
    applyTextStyle(style, {
      font: "serif",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      align: "center",
      lineHeight: 1.5,
      fill: "#fff3b0",
    });
    expect(style).toEqual({
      color: "#000",
      fontSize: 22,
      font: "serif",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      align: "center",
      lineHeight: 1.5,
      fill: "#fff3b0",
    });
    applyTextStyle(style, {
      font: "sans",
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      align: "left",
      lineHeight: DEFAULT_LINE_HEIGHT,
      fill: null,
    });
    expect(style).toEqual({ color: "#000", fontSize: 22 });
    expect(Object.keys(style)).toEqual(["color", "fontSize"]);
  });

  it("ignores invalid values rather than clamping them onto valid ones", () => {
    const style: TextStyle = { color: "#123456", fontSize: 24, lineHeight: 1.5, fill: "#fff" };
    applyTextStyle(style, {
      color: "red; background:url(x)",
      fontSize: 8,
      font: "comic" as never,
      align: "middle" as never,
      lineHeight: 12,
      fill: "url(x)",
    });
    expect(style).toEqual({ color: "#123456", fontSize: 24, lineHeight: 1.5, fill: "#fff" });
    applyTextStyle(style, { fontSize: Number.NaN, lineHeight: Number.POSITIVE_INFINITY });
    expect(style.fontSize).toBe(24);
    expect(style.lineHeight).toBe(1.5);
  });

  it("leaves keys the patch does not mention alone", () => {
    const style: TextStyle = { color: "#000", fontSize: 30, bold: true, font: "mono" };
    applyTextStyle(style, { italic: true });
    expect(style).toEqual({ color: "#000", fontSize: 30, bold: true, font: "mono", italic: true });
  });

  it("accepts every size, line height and fill the pill offers", () => {
    for (const fontSize of TEXT_SIZES) {
      expect(withTextStyle(DEFAULT_TEXT_STYLE, { fontSize }).fontSize).toBe(fontSize);
    }
    for (const lineHeight of LINE_HEIGHTS) {
      expect(lineHeightOf(withTextStyle(DEFAULT_TEXT_STYLE, { lineHeight }))).toBe(lineHeight);
    }
    for (const fill of TEXT_FILLS) {
      expect(isHexColor(fill)).toBe(true);
      expect(withTextStyle(DEFAULT_TEXT_STYLE, { fill }).fill).toBe(fill);
    }
  });

  it("offers no size the loader would raise on the next open", () => {
    // serialize.ts floors fontSize at 12; a 10 would silently come back as 12.
    expect(Math.min(...TEXT_SIZES)).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
    const doc = docWith(plainBox({ fontSize: Math.min(...TEXT_SIZES) }));
    const back = decodeDocument(encodeDocument(doc)).pages[0].textBoxes[0];
    expect(back.fontSize).toBe(Math.min(...TEXT_SIZES));
  });
});

describe("style helpers", () => {
  it("textStyleOf copies only style keys and drops stray false flags", () => {
    const box = plainBox({ bold: false, italic: true, fill: "#eee" });
    expect(textStyleOf(box)).toEqual({
      color: "#1a1a1a",
      fontSize: 22,
      italic: true,
      fill: "#eee",
    });
  });

  it("withTextStyle returns a copy and leaves its input alone", () => {
    const style: TextStyle = { color: "#000", fontSize: 22 };
    const next = withTextStyle(style, { bold: true });
    expect(next.bold).toBe(true);
    expect(style.bold).toBeUndefined();
  });

  it("changesTextStyle is false for a patch that restates the current look", () => {
    const style: TextStyle = { color: "#000", fontSize: 22, bold: true };
    expect(changesTextStyle(style, { bold: true, align: "left", font: "sans" })).toBe(false);
    expect(changesTextStyle(style, { bold: false })).toBe(true);
    expect(changesTextStyle(style, { fontSize: 5 })).toBe(false);
  });

  it("textStyleKey treats an explicit default and an absent key as the same look", () => {
    expect(textStyleKey({ color: "#000", fontSize: 22, lineHeight: 1.25, font: "sans" })).toBe(
      textStyleKey({ color: "#000", fontSize: 22 }),
    );
  });

  it("resetTextStylePatch takes any style back to the default", () => {
    const styled: TextStyle = {
      color: "#e03131",
      fontSize: 48,
      font: "times",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      align: "justify",
      lineHeight: 2,
      fill: "#d6ecff",
    };
    expect(withTextStyle(styled, resetTextStylePatch())).toEqual(DEFAULT_TEXT_STYLE);
  });

  it("resolves the font family, and falls back for an unknown or inherited key", () => {
    expect(fontFamilyOf({})).toBe(TEXT_FONT_STACKS.sans);
    expect(fontFamilyOf({ font: "mono" })).toBe(TEXT_FONT_STACKS.mono);
    expect(fontOf({ font: "toString" as never })).toBe("sans");
    expect(fontFamilyOf({ font: "constructor" as never })).toBe(TEXT_FONT_STACKS.sans);
    for (const family of Object.values(TEXT_FONT_STACKS)) expect(family).not.toContain("var(");
  });

  it("reads the line height, defaulting when absent or out of range", () => {
    expect(lineHeightOf({})).toBe(DEFAULT_LINE_HEIGHT);
    expect(lineHeightOf({ lineHeight: 2 })).toBe(2);
    expect(lineHeightOf({ lineHeight: 40 })).toBe(DEFAULT_LINE_HEIGHT);
  });
});

describe("sanitizeTextStyle (plugin settings)", () => {
  it("falls back to the default for anything that is not an object", () => {
    for (const raw of [null, undefined, 3, "bold", []]) {
      expect(sanitizeTextStyle(raw)).toEqual(DEFAULT_TEXT_STYLE);
    }
  });

  it("keeps valid keys and drops malformed ones", () => {
    const raw = {
      color: "#e03131",
      fontSize: 36,
      font: "verdana",
      bold: true,
      italic: "yes",
      underline: false,
      align: "right",
      lineHeight: "2",
      fill: "#fff3b0",
      extra: 1,
    };
    expect(sanitizeTextStyle(raw)).toEqual({
      color: "#e03131",
      fontSize: 36,
      font: "verdana",
      bold: true,
      align: "right",
      fill: "#fff3b0",
    });
    expect(sanitizeTextStyle({ color: 3, fontSize: "big", font: 7, align: 1 })).toEqual(
      DEFAULT_TEXT_STYLE,
    );
  });

  it("never hands out the shared default object", () => {
    const style = sanitizeTextStyle(null);
    style.bold = true;
    expect(DEFAULT_TEXT_STYLE.bold).toBeUndefined();
  });
});

describe("SetTextBoxStyle", () => {
  it("round-trips exactly, restoring absent keys as absent", () => {
    const doc = docWith(plainBox());
    assertRoundTrip(
      doc,
      new SetTextBoxStyle("p1", "t1", {
        bold: true,
        font: "serif",
        align: "center",
        lineHeight: 2,
        fill: "#fff3b0",
        color: "#e03131",
        fontSize: 36,
      }),
    );
    expect(Object.keys(doc.pages[0].textBoxes[0])).toEqual([
      "id",
      "x",
      "y",
      "w",
      "text",
      "color",
      "fontSize",
    ]);
  });

  it("round-trips a change back to the defaults on a styled box", () => {
    const doc = docWith(plainBox({ bold: true, italic: true, align: "right", fill: "#eee" }));
    const cmd = new SetTextBoxStyle("p1", "t1", { bold: false, align: "left", fill: null });
    assertRoundTrip(doc, cmd);
    cmd.apply(doc);
    expect(doc.pages[0].textBoxes[0]).toEqual(plainBox({ italic: true }));
    expect("bold" in doc.pages[0].textBoxes[0]).toBe(false);
  });

  it("undoes only the style: text typed and a height set since are kept", () => {
    const doc = docWith(plainBox({ italic: true }));
    const cmd = new SetTextBoxStyle("p1", "t1", { bold: true, italic: false });
    cmd.apply(doc);
    const box = doc.pages[0].textBoxes[0];
    box.text = "Hello, world";
    box.h = 120;
    cmd.invert(doc);
    expect(box).toEqual(plainBox({ italic: true, text: "Hello, world", h: 120 }));
    expect("bold" in box).toBe(false);
  });

  it("serializes a styled-then-reset box identically to one never styled", () => {
    const doc = docWith(plainBox());
    const plain = encodeDocument(doc);
    new SetTextBoxStyle("p1", "t1", { underline: true, font: "mono" }).apply(doc);
    new SetTextBoxStyle("p1", "t1", { underline: false, font: "sans" }).apply(doc);
    expect(encodeDocument(doc)).toBe(plain);
  });

  it("undoes onto the box it changed even when another box shares its id", () => {
    const doc = docWith(plainBox());
    const twin = plainBox({ x: 500 });
    const cmd = new SetTextBoxStyle("p1", "t1", { bold: true });
    cmd.apply(doc);
    doc.pages[0].textBoxes.unshift(twin);
    cmd.invert(doc);
    expect(doc.pages[0].textBoxes.every((box) => box.bold === undefined)).toBe(true);
    cmd.apply(doc);
    expect(twin.bold).toBeUndefined();
    expect(doc.pages[0].textBoxes[1].bold).toBe(true);
  });

  it("is a no-op for an unknown page or box", () => {
    const doc = docWith(plainBox());
    const before = JSON.stringify(doc);
    for (const cmd of [
      new SetTextBoxStyle("nope", "t1", { bold: true }),
      new SetTextBoxStyle("p1", "nope", { bold: true }),
    ]) {
      cmd.apply(doc);
      cmd.invert(doc);
    }
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("undoes step by step through History, one step per change", () => {
    const doc = docWith(plainBox());
    const history = new History();
    history.push(doc, new SetTextBoxStyle("p1", "t1", { bold: true }));
    history.push(doc, new SetTextBoxStyle("p1", "t1", { fontSize: 48 }));
    expect(doc.pages[0].textBoxes[0]).toMatchObject({ bold: true, fontSize: 48 });
    history.undo(doc);
    expect(doc.pages[0].textBoxes[0]).toMatchObject({ bold: true, fontSize: 22 });
    history.undo(doc);
    expect(doc.pages[0].textBoxes[0]).toEqual(plainBox());
  });
});

describe("History.withdrawTail", () => {
  it("takes back a new box together with the changes made to it, leaving no trace", () => {
    const doc = emptyDocument();
    const history = new History();
    const add = new AddTextBoxToPage("p1", plainBox({ text: "" }));
    const style = new SetTextBoxStyle("p1", "t1", { bold: true });
    const frame = new SetTextBoxFrame("p1", "t1", { x: 50, y: 60, w: 200 });
    history.push(doc, add);
    history.push(doc, style);
    history.push(doc, frame);
    expect(history.withdrawTail(doc, [add, style, frame])).toBe(true);
    expect(doc.pages[0].textBoxes).toEqual([]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("changes nothing when anything else sits among or after them", () => {
    const doc = emptyDocument();
    const history = new History();
    const add = new AddTextBoxToPage("p1", plainBox({ text: "" }));
    const style = new SetTextBoxStyle("p1", "t1", { bold: true });
    const other = new SetTextBoxStyle("p1", "t1", { italic: true });
    history.push(doc, add);
    history.push(doc, other);
    history.push(doc, style);
    const before = JSON.stringify(doc);
    expect(history.withdrawTail(doc, [add, style])).toBe(false);
    expect(history.withdrawTail(doc, [])).toBe(false);
    expect(history.withdrawTail(doc, [add, other, style, style])).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
    expect(history.withdrawTail(doc, [add, other, style])).toBe(true);
    expect(doc.pages[0].textBoxes).toEqual([]);
  });
});
