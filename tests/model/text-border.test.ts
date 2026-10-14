/**
 * A text box's border and rounded corners: the `border` and `radius` style
 * keys in `src/model/text-style.ts`, how the loader keeps them
 * (`serialize.ts`), the style command's undo (`text-commands.ts`) and the
 * lasso resize (`selection-commands.ts`).
 *
 * The rules under test: absent means none and nothing else is ever stored
 * for "none"; an out-of-range stored value is dropped, never clamped onto a
 * meaningful boundary; and every value the menu offers reopens unchanged.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type TextBoxElement, emptyDocument } from "../../src/model/document";
import { ScaleElements, textScaleRange } from "../../src/model/selection-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { SetTextBoxStyle } from "../../src/model/text-commands";
import {
  MAX_BORDER_WIDTH,
  MAX_CORNER_RADIUS,
  TEXT_BORDER_WIDTHS,
  TEXT_CORNER_RADIUS,
  type TextStyle,
  applyTextStyle,
  changesTextStyle,
  isBorderWidth,
  isCornerRadius,
  normalizeBorder,
  resetTextStylePatch,
  sanitizeTextStyle,
  textStyleKey,
  textStyleOf,
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

/** The box as it comes back from a save and a load. */
function reloaded(box: TextBoxElement): TextBoxElement {
  return decodeDocument(encodeDocument(docWith(box))).pages[0].textBoxes[0];
}

describe("border and corner validators", () => {
  it("keeps widths and radii above 0 up to their maximum, and nothing else", () => {
    for (const ok of [0.25, 1, 4, MAX_BORDER_WIDTH]) expect(isBorderWidth(ok)).toBe(true);
    for (const bad of [0, -1, MAX_BORDER_WIDTH + 0.1, NaN, Infinity, "2", null]) {
      expect(isBorderWidth(bad)).toBe(false);
    }
    for (const ok of [0.5, TEXT_CORNER_RADIUS, MAX_CORNER_RADIUS]) {
      expect(isCornerRadius(ok)).toBe(true);
    }
    for (const bad of [0, -3, MAX_CORNER_RADIUS + 1, NaN, "12", undefined]) {
      expect(isCornerRadius(bad)).toBe(false);
    }
  });

  it("drops a whole border when either half is bad, rather than inventing it", () => {
    expect(normalizeBorder({ width: 2, color: "#ff0000" })).toEqual({ width: 2, color: "#ff0000" });
    expect(normalizeBorder({ width: 2 })).toBeUndefined();
    expect(normalizeBorder({ width: 0, color: "#ff0000" })).toBeUndefined();
    expect(normalizeBorder({ width: 2, color: "red; background:url(x)" })).toBeUndefined();
    expect(normalizeBorder("2px solid red")).toBeUndefined();
    expect(normalizeBorder(null)).toBeUndefined();
  });

  it("offers only values inside the loader's range", () => {
    for (const { width } of TEXT_BORDER_WIDTHS) expect(isBorderWidth(width)).toBe(true);
    expect(isCornerRadius(TEXT_CORNER_RADIUS)).toBe(true);
  });
});

describe("applyTextStyle: border and corners", () => {
  it("gives a box a border in its text colour when only a width is picked", () => {
    const style: TextStyle = { color: "#e03131", fontSize: 22 };
    applyTextStyle(style, { borderWidth: 2 });
    expect(style.border).toEqual({ width: 2, color: "#e03131" });
  });

  it("gives a box a thin border when only a colour is picked", () => {
    const style: TextStyle = { color: "#000000", fontSize: 22 };
    applyTextStyle(style, { borderColor: "#1971c2" });
    expect(style.border).toEqual({ width: TEXT_BORDER_WIDTHS[0].width, color: "#1971c2" });
  });

  it("changes one half of an existing border and keeps the other", () => {
    const style: TextStyle = {
      color: "#000",
      fontSize: 22,
      border: { width: 4, color: "#2f9e44" },
    };
    const before = style.border;
    applyTextStyle(style, { borderColor: "#e03131" });
    expect(style.border).toEqual({ width: 4, color: "#e03131" });
    applyTextStyle(style, { borderWidth: 1 });
    expect(style.border).toEqual({ width: 1, color: "#e03131" });
    // Replaced, not edited: whoever held the old object still sees the old border.
    expect(before).toEqual({ width: 4, color: "#2f9e44" });
  });

  it("removes the border and the corners with null, leaving no key", () => {
    const style: TextStyle = {
      color: "#000",
      fontSize: 22,
      border: { width: 2, color: "#000000" },
      radius: 12,
    };
    applyTextStyle(style, { borderWidth: null, radius: null });
    expect(Object.keys(style)).toEqual(["color", "fontSize"]);
  });

  it("ignores invalid widths, colours and radii instead of clamping them", () => {
    const style: TextStyle = {
      color: "#000",
      fontSize: 22,
      border: { width: 2, color: "#2f9e44" },
      radius: 12,
    };
    applyTextStyle(style, { borderWidth: 0, radius: -4 });
    applyTextStyle(style, { borderWidth: MAX_BORDER_WIDTH + 1, radius: MAX_CORNER_RADIUS * 2 });
    applyTextStyle(style, { borderColor: "url(x)" });
    expect(style.border).toEqual({ width: 2, color: "#2f9e44" });
    expect(style.radius).toBe(12);
    const bare: TextStyle = { color: "#000", fontSize: 22 };
    applyTextStyle(bare, { borderWidth: NaN, borderColor: "nope" });
    expect("border" in bare).toBe(false);
  });

  it("puts border and corners in the style's fingerprint and copy", () => {
    const base: TextStyle = { color: "#000", fontSize: 22 };
    expect(changesTextStyle(base, { borderWidth: 2 })).toBe(true);
    expect(changesTextStyle(base, { radius: TEXT_CORNER_RADIUS })).toBe(true);
    expect(changesTextStyle(base, { borderWidth: null, radius: null })).toBe(false);
    const styled: TextStyle = { ...base, border: { width: 2, color: "#000000" }, radius: 12 };
    expect(textStyleKey(styled)).not.toBe(textStyleKey({ ...styled, radius: 4 }));
    expect(textStyleKey(styled)).not.toBe(
      textStyleKey({ ...styled, border: { width: 2, color: "#ffffff" } }),
    );
    const copy = textStyleOf(styled);
    expect(copy).toEqual(styled);
    expect(copy.border).not.toBe(styled.border);
  });

  it("is reset with everything else", () => {
    const style: TextStyle = {
      color: "#000",
      fontSize: 22,
      border: { width: 2, color: "#000000" },
      radius: 12,
    };
    applyTextStyle(style, resetTextStylePatch());
    expect("border" in style).toBe(false);
    expect("radius" in style).toBe(false);
  });

  it("is read back from plugin settings, malformed parts dropped", () => {
    expect(
      sanitizeTextStyle({ color: "#000000", fontSize: 22, border: { width: 4, color: "#e03131" } }),
    ).toMatchObject({ border: { width: 4, color: "#e03131" } });
    expect(sanitizeTextStyle({ radius: 12 }).radius).toBe(12);
    const bad = sanitizeTextStyle({ border: { width: -1, color: "#e03131" }, radius: "12" });
    expect("border" in bad).toBe(false);
    expect("radius" in bad).toBe(false);
  });
});

describe("loading a box's border and corners", () => {
  it("round-trips every width and colour the menu offers, and its radius, unchanged", () => {
    for (const { width } of TEXT_BORDER_WIDTHS) {
      const box = plainBox({ border: { width, color: "#e03131" }, radius: TEXT_CORNER_RADIUS });
      expect(reloaded(box)).toEqual(box);
    }
  });

  it("keeps the fractional widths and radii an import or a resize leaves", () => {
    const box = plainBox({ border: { width: 0.75, color: "#000000ff" }, radius: 7.33 });
    expect(reloaded(box)).toEqual(box);
  });

  it("drops an out-of-range or malformed border or radius instead of clamping it", () => {
    const doc = docWith(plainBox());
    const stored = doc.pages[0].textBoxes;
    const raw = (extra: Record<string, unknown>): TextBoxElement =>
      ({ ...plainBox(), ...extra }) as unknown as TextBoxElement;
    stored.splice(
      0,
      1,
      raw({ id: "a", border: { width: 0, color: "#000000" } }),
      raw({ id: "b", border: { width: MAX_BORDER_WIDTH + 1, color: "#000000" } }),
      raw({ id: "c", border: { width: 2, color: "black" } }),
      raw({ id: "d", border: true }),
      raw({ id: "e", radius: 0 }),
      raw({ id: "f", radius: -5 }),
      raw({ id: "g", radius: MAX_CORNER_RADIUS + 1 }),
      raw({ id: "h", radius: "12" }),
    );
    const loaded = decodeDocument(encodeDocument(doc)).pages[0].textBoxes;
    expect(loaded).toHaveLength(8);
    for (const box of loaded) {
      expect("border" in box, box.id).toBe(false);
      expect("radius" in box, box.id).toBe(false);
    }
  });

  it("loads a box from before borders unchanged", () => {
    expect(reloaded(plainBox())).toEqual(plainBox());
  });
});

describe("SetTextBoxStyle: border and corners", () => {
  function roundTrip(doc: InkDocument, cmd: SetTextBoxStyle): void {
    const before = JSON.stringify(doc);
    cmd.apply(doc);
    const after = JSON.stringify(doc);
    cmd.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
    cmd.apply(doc);
    expect(JSON.stringify(doc)).toBe(after);
    cmd.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  }

  it("adds and undoes a border and corners on a plain box, leaving no key", () => {
    const doc = docWith(plainBox());
    roundTrip(doc, new SetTextBoxStyle("p1", "t1", { borderWidth: 2, radius: 12 }));
    expect(Object.keys(doc.pages[0].textBoxes[0])).not.toContain("border");
    expect(Object.keys(doc.pages[0].textBoxes[0])).not.toContain("radius");
  });

  it("restores a changed border's old width, colour and key order", () => {
    const doc = docWith(
      plainBox({ border: { width: 4, color: "#2f9e44" }, radius: 6, fill: "#fff3b0" }),
    );
    roundTrip(doc, new SetTextBoxStyle("p1", "t1", { borderColor: "#e03131", radius: 12 }));
    roundTrip(doc, new SetTextBoxStyle("p1", "t1", { borderWidth: null, radius: null }));
  });
});

describe("resizing a bordered box with the lasso", () => {
  it("scales the border and corners with the box, and undo restores them", () => {
    const box = plainBox({ border: { width: 2, color: "#e03131" }, radius: 12 });
    const doc = docWith(box);
    const before = JSON.stringify(doc);
    const cmd = new ScaleElements("p1", { strokes: [], images: [], textBoxes: [box] }, 0, 0, 1.5);
    cmd.apply(doc);
    expect(box.border).toEqual({ width: 3, color: "#e03131" });
    expect(box.radius).toBe(18);
    cmd.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("stops a resize before a border or corner passes what the loader keeps", () => {
    const thick = plainBox({ border: { width: 25, color: "#000000" } });
    expect(textScaleRange([thick]).max).toBe(MAX_BORDER_WIDTH / 25);
    const round = plainBox({ radius: 250 });
    expect(textScaleRange([round]).max).toBe(MAX_CORNER_RADIUS / 250);
  });
});
