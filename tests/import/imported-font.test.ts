/**
 * `importedFont` and `familyOfPostScript` in `src/import/import-types.ts`:
 * the font another app names for a text box, kept as its `family` over the
 * nearest FineNotes typeface (discussion #107). Names as real exports carry
 * them: Goodnotes a family ("Helvetica Neue", "Arial Hebrew"), Notability a
 * PostScript font ("HelveticaNeue", "AmericanTypewriter-Condensed").
 */

import { describe, expect, it } from "vitest";
import { familyOfPostScript, fontFor, importedFont } from "../../src/import/import-types";
import { DEVICE_FONT_CANDIDATES, cleanFamily } from "../../src/model/text-family";

describe("familyOfPostScript", () => {
  it("names the family iPadOS gives the font, whatever its style", () => {
    const cases: Array<[string, string]> = [
      ["HelveticaNeue", "Helvetica Neue"],
      ["HelveticaNeue-BoldItalic", "Helvetica Neue"],
      ["AmericanTypewriter-Condensed", "American Typewriter"],
      ["TimesNewRomanPSMT", "Times New Roman"],
      ["CourierNewPS-BoldMT", "Courier New"],
      ["ArialMT", "Arial"],
      ["Arial-BoldMT", "Arial"],
      ["TrebuchetMS-Italic", "Trebuchet MS"],
      ["ChalkboardSE-Regular", "Chalkboard SE"],
      ["AppleSDGothicNeo-Medium", "Apple SD Gothic Neo"],
      ["EuphemiaUCAS", "Euphemia UCAS"],
      ["DINAlternate-Bold", "DIN Alternate"],
      ["STIXTwoText-Italic", "STIX Two Text"],
      ["AvenirNextCondensed-DemiBold", "Avenir Next Condensed"],
      ["MarkerFelt-Thin", "Marker Felt"],
      ["Noteworthy-Light", "Noteworthy"],
      ["Futura-Medium", "Futura"],
      ["BodoniSvtyTwoOSITCTT-Book", "Bodoni 72 Oldstyle"],
      ["BradleyHandITCTT-Bold", "Bradley Hand"],
      ["PingFangSC-Regular", "PingFang SC"],
      ["ArialRoundedMTBold", "Arial Rounded MT Bold"],
      ["SavoyeLetPlain", "Savoye LET"],
    ];
    for (const [ps, family] of cases) expect(familyOfPostScript(ps), ps).toBe(family);
  });
});

describe("importedFont", () => {
  it("keeps the family over the nearest typeface", () => {
    expect(importedFont("Helvetica Neue")).toEqual({ family: "Helvetica Neue" });
    expect(importedFont("HelveticaNeue")).toEqual({ family: "Helvetica Neue" });
    expect(importedFont("Arial Hebrew")).toEqual({ family: "Arial Hebrew" });
    expect(importedFont("AmericanTypewriter-Condensed")).toEqual({
      font: "mono",
      family: "American Typewriter",
    });
    expect(importedFont("Didot-Italic")).toEqual({ font: "serif", family: "Didot" });
    expect(importedFont("Hoefler Text")).toEqual({ font: "serif", family: "Hoefler Text" });
    expect(importedFont("Menlo-Regular")).toEqual({ font: "mono", family: "Menlo" });
  });

  it("needs no family where the typeface is that font already", () => {
    expect(importedFont("ArialMT")).toEqual({});
    expect(importedFont("Georgia-Bold")).toEqual({ font: "serif" });
    expect(importedFont("TimesNewRomanPSMT")).toEqual({ font: "times" });
    expect(importedFont("CourierNewPSMT")).toEqual({ font: "mono" });
    expect(importedFont("Verdana")).toEqual({ font: "verdana" });
    expect(importedFont("Trebuchet MS")).toEqual({ font: "trebuchet" });
  });

  it("gives the system font and no name nothing: the box is Sans", () => {
    for (const name of [
      undefined,
      "",
      "  ",
      ".SFUI-Regular",
      ".AppleSystemUIFont",
      "SFProText-Regular",
      "System",
    ]) {
      expect(importedFont(name), String(name)).toEqual({});
    }
  });

  it("drops a name no family has, keeping the typeface it suggests", () => {
    expect(importedFont('Evil"; x')).toEqual({});
    expect(importedFont("Serif Pro, x")).toEqual({ font: "serif" });
  });

  it("maps every probed family to a name the box keeps, and back to itself", () => {
    for (const family of DEVICE_FONT_CANDIDATES) {
      const out = importedFont(family);
      expect(out.family ?? family, family).toBe(cleanFamily(family));
    }
  });
});

describe("fontFor", () => {
  it("picks the nearest typeface for the families Goodnotes users write in", () => {
    expect(fontFor("Bodoni 72")).toBe("serif");
    expect(fontFor("Charter")).toBe("serif");
    expect(fontFor("Monaco")).toBe("mono");
    expect(fontFor("Gill Sans")).toBe("sans");
    expect(fontFor("PT Sans")).toBe("sans");
    expect(fontFor("PT Serif")).toBe("serif");
  });
});
