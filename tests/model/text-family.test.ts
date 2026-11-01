/**
 * `src/model/text-family.ts` — text box fonts by name (discussion #107): the
 * names a box keeps, the CSS they become, the probe's verdict, and the round
 * trip of `family` through the style, the undo step and the file.
 */

import { describe, expect, it } from "vitest";
import { type TextBoxElement, TEXT_FONT_STACKS, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { SetTextBoxStyle } from "../../src/model/text-commands";
import {
  DEVICE_FONT_CANDIDATES,
  MAX_FAMILY_LENGTH,
  cleanFamily,
  familyList,
  familyStack,
  measuresAsInstalled,
} from "../../src/model/text-family";
import {
  DEFAULT_TEXT_STYLE,
  TEXT_PRESETS,
  applyTextStyle,
  changesTextStyle,
  fontFamilyOf,
  presetOf,
  resetTextStylePatch,
  sanitizeTextStyle,
  textStyleKey,
  textStyleOf,
  withTextStyle,
} from "../../src/model/text-style";

function box(overrides: Partial<TextBoxElement> = {}): TextBoxElement {
  return {
    id: "t1",
    x: 10,
    y: 20,
    w: 300,
    text: "Hi",
    color: "#1a1a1a",
    fontSize: 22,
    ...overrides,
  };
}

describe("cleanFamily", () => {
  it("keeps a family's name, its spaces collapsed and one pair of quotes off", () => {
    expect(cleanFamily("Avenir Next")).toBe("Avenir Next");
    expect(cleanFamily("  Gill   Sans ")).toBe("Gill Sans");
    expect(cleanFamily('"Hoefler Text"')).toBe("Hoefler Text");
    expect(cleanFamily("'Futura'")).toBe("Futura");
    expect(cleanFamily("Noto Sans CJK 日本語")).toBe("Noto Sans CJK 日本語");
  });

  it("drops what is not one family's name, instead of altering it", () => {
    for (const bad of [
      undefined,
      42,
      "",
      "   ",
      '""',
      "Arial, sans-serif",
      'Evil"; color: red',
      "a\\b",
      "x{y}",
      "<b>",
      "bell\u0007here",
      "x".repeat(MAX_FAMILY_LENGTH + 1),
    ]) {
      expect(cleanFamily(bad), String(bad)).toBeUndefined();
    }
    expect(cleanFamily("x".repeat(MAX_FAMILY_LENGTH))).toHaveLength(MAX_FAMILY_LENGTH);
  });

  it("is no generic family or CSS keyword, which would name no font", () => {
    for (const generic of ["serif", "Sans-Serif", "monospace", "system-ui", "inherit", "emoji"]) {
      expect(cleanFamily(generic)).toBeUndefined();
    }
  });

  it("is idempotent", () => {
    for (const name of DEVICE_FONT_CANDIDATES) expect(cleanFamily(cleanFamily(name))).toBe(name);
  });
});

describe("familyStack", () => {
  it("puts the family first, quoted, before the fallback list", () => {
    expect(familyStack("Avenir Next", TEXT_FONT_STACKS.sans)).toBe(
      `"Avenir Next", ${TEXT_FONT_STACKS.sans}`,
    );
  });

  it("is the fallback alone without a family, or with one it would not keep", () => {
    expect(familyStack(undefined, TEXT_FONT_STACKS.serif)).toBe(TEXT_FONT_STACKS.serif);
    expect(familyStack('x", y', TEXT_FONT_STACKS.serif)).toBe(TEXT_FONT_STACKS.serif);
  });
});

describe("measuresAsInstalled", () => {
  it("says installed when any sample differs from its generic fallback", () => {
    expect(
      measuresAsInstalled([
        { withFamily: 100, generic: 100 },
        { withFamily: 98.5, generic: 101 },
      ]),
    ).toBe(true);
  });

  it("says missing when every sample measured as its fallback", () => {
    expect(
      measuresAsInstalled([
        { withFamily: 100, generic: 100 },
        { withFamily: 101.004, generic: 101 },
      ]),
    ).toBe(false);
    expect(measuresAsInstalled([])).toBe(false);
  });
});

describe("familyList", () => {
  it("cleans, keeps each family once whatever its case, and sorts by name", () => {
    expect(familyList(["futura", "Avenir", "Futura", "serif", "  Baskerville", "Zapfino"])).toEqual(
      ["Avenir", "Baskerville", "futura", "Zapfino"],
    );
  });

  it("has no candidate twice and none it would drop", () => {
    expect(familyList(DEVICE_FONT_CANDIDATES)).toHaveLength(DEVICE_FONT_CANDIDATES.length);
  });
});

describe("family in a text style", () => {
  it("is stored by name, and null takes it away", () => {
    const style = withTextStyle(DEFAULT_TEXT_STYLE, { font: "serif", family: " Didot " });
    expect(style).toMatchObject({ font: "serif", family: "Didot" });
    expect(fontFamilyOf(style)).toBe(`"Didot", ${TEXT_FONT_STACKS.serif}`);
    expect(withTextStyle(style, { family: null })).not.toHaveProperty("family");
  });

  it("ignores a name it would not keep, leaving the family as it was", () => {
    const style = withTextStyle(DEFAULT_TEXT_STYLE, { family: "Didot" });
    applyTextStyle(style, { family: "serif" });
    expect(style.family).toBe("Didot");
  });

  it("counts as a change of look, and survives textStyleOf and the settings", () => {
    const style = withTextStyle(DEFAULT_TEXT_STYLE, { family: "Futura" });
    expect(changesTextStyle(DEFAULT_TEXT_STYLE, { family: "Futura" })).toBe(true);
    expect(textStyleKey(style)).not.toBe(textStyleKey(DEFAULT_TEXT_STYLE));
    expect(textStyleOf(style).family).toBe("Futura");
    expect(sanitizeTextStyle(JSON.parse(JSON.stringify(style))).family).toBe("Futura");
    expect(sanitizeTextStyle({ ...style, family: "a;b" })).not.toHaveProperty("family");
  });

  it("is let go of by a preset and by Reset, which name their own typeface", () => {
    const named = withTextStyle(DEFAULT_TEXT_STYLE, { family: "Futura" });
    for (const preset of TEXT_PRESETS) {
      const styled = withTextStyle(named, preset.patch);
      expect(styled, preset.id).not.toHaveProperty("family");
      expect(presetOf(styled)?.id).toBe(preset.id);
    }
    expect(withTextStyle(named, resetTextStylePatch())).toEqual(DEFAULT_TEXT_STYLE);
  });
});

describe("family on a text box", () => {
  it("is one undo step, and undo leaves the box as it was", () => {
    const doc = emptyDocument();
    doc.pages[0].textBoxes.push(box({ font: "serif" }));
    const before = JSON.stringify(doc);
    const cmd = new SetTextBoxStyle(doc.pages[0].id, "t1", { family: "Baskerville" });
    cmd.apply(doc);
    expect(doc.pages[0].textBoxes[0].family).toBe("Baskerville");
    cmd.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("round-trips through the file, with the typeface it falls back to", () => {
    const doc = emptyDocument();
    doc.pages[0].textBoxes.push(box({ font: "serif", family: "Hoefler Text" }));
    const back = decodeDocument(encodeDocument(doc)).pages[0].textBoxes[0];
    expect(back).toMatchObject({ font: "serif", family: "Hoefler Text" });
  });

  it("is dropped on load when it is no family's name, keeping the typeface", () => {
    const doc = emptyDocument();
    doc.pages[0].textBoxes.push(box({ font: "mono" }));
    const raw = encodeDocument(doc);
    // A hand-edited or corrupt file: the loader sees whatever the JSON says.
    const decoded = decodeDocument(raw);
    const page = decoded.pages[0];
    (page.textBoxes[0] as unknown as Record<string, unknown>).family = 'Mono", red';
    const back = decodeDocument(encodeDocument(decoded)).pages[0].textBoxes[0];
    expect(back).not.toHaveProperty("family");
    expect(back.font).toBe("mono");
  });

  it("is not written for a box without one, so older files are unchanged", () => {
    const doc = emptyDocument();
    doc.pages[0].textBoxes.push(box());
    const back = decodeDocument(encodeDocument(doc)).pages[0].textBoxes[0];
    expect(back).not.toHaveProperty("family");
  });
});
