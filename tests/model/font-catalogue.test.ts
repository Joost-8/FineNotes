/**
 * `src/model/font-catalogue.ts` — the fonts FineNotes can fetch for a text
 * box whose family a device lacks: the family itself when it is open-licence,
 * a width-scaled stand-in for Apple's, and where each file comes from and goes.
 */

import { describe, expect, it } from "vitest";
import { emptyDocument } from "../../src/model/document";
import {
  FONT_CATALOGUE,
  FONT_COMMIT,
  FONT_FOLDER,
  STAND_INS,
  downloadLabel,
  downloadSize,
  familiesIn,
  fontPath,
  fontSourceFor,
  fontUrl,
  licencePath,
  standInFace,
  standInFaceOf,
} from "../../src/model/font-catalogue";
import { DEVICE_FONT_CANDIDATES, cleanFamily } from "../../src/model/text-family";
import { fontFamilyOf } from "../../src/model/text-style";

describe("FONT_CATALOGUE", () => {
  it("names each family once, with a licence file and a regular face", () => {
    const names = FONT_CATALOGUE.map((font) => font.family.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const font of FONT_CATALOGUE) {
      expect(cleanFamily(font.family)).toBe(font.family);
      expect(font.licence.name).toMatch(/^(OFL|LICENSE)\.txt$/);
      expect(font.dir).toMatch(/^(ofl|apache)\/[a-z0-9]+$/);
      expect(
        font.files.some((file) => file.style === "normal" && /\b400\b/.test(file.weight)),
      ).toBe(true);
    }
  });

  it("pins every file by size and SHA-256, none over 1 MB", () => {
    for (const font of FONT_CATALOGUE) {
      for (const file of [font.licence, ...font.files]) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.bytes).toBeLessThanOrEqual(1_000_000);
      }
    }
  });

  it("keeps only the faces a text box uses: 400 and 700, upright and italic", () => {
    for (const font of FONT_CATALOGUE) {
      const faces = font.files.map((file) => `${file.weight}/${file.style}`);
      expect(new Set(faces).size).toBe(faces.length);
      for (const file of font.files) {
        expect(file.name).toMatch(/\.ttf$/);
        expect(["400", "700", "400 700"]).toContain(file.weight);
        // A variable font is one file for every weight.
        expect(file.weight === "400 700").toBe(/\[.*wght.*\]\.ttf$/.test(file.name));
      }
    }
  });

  it("covers the families note-takers install that the probe looks for", () => {
    const installed = DEVICE_FONT_CANDIDATES.slice(
      DEVICE_FONT_CANDIDATES.indexOf("Architects Daughter"),
    );
    const covered = installed.filter((family) => fontSourceFor(family));
    expect(covered).toContain("Caveat");
    expect(covered).toContain("Patrick Hand");
    expect(covered.length).toBeGreaterThanOrEqual(20);
  });
});

describe("STAND_INS", () => {
  it("each names a catalogued font, with a scale near 1", () => {
    for (const [family, standIn] of Object.entries(STAND_INS)) {
      expect(family).toBe(family.toLowerCase());
      expect(FONT_CATALOGUE.some((font) => font.family === standIn.family)).toBe(true);
      expect(standIn.sizeAdjust).toBeGreaterThan(0.75);
      expect(standIn.sizeAdjust).toBeLessThan(1.25);
    }
  });
});

describe("fontSourceFor", () => {
  it("fetches an open-licence family as itself, under its own name", () => {
    const source = fontSourceFor("caveat");
    expect(source?.font.family).toBe("Caveat");
    expect(source?.face).toBe("Caveat");
    expect(source?.sizeAdjust).toBeUndefined();
  });

  it("gives Chalkboard SE a stand-in under a name of its own", () => {
    const source = fontSourceFor("Chalkboard SE");
    expect(source?.font.family).toBe("Comic Relief");
    expect(source?.face).toBe("Comic Relief for Chalkboard SE");
    expect(source?.sizeAdjust).toBe(STAND_INS["chalkboard se"].sizeAdjust);
  });

  it("has nothing for an Apple font without a stand-in, or no family", () => {
    expect(fontSourceFor("Helvetica Neue")).toBeUndefined();
    expect(fontSourceFor("American Typewriter")).toBeUndefined();
    expect(fontSourceFor(undefined)).toBeUndefined();
    expect(fontSourceFor("serif")).toBeUndefined();
  });
});

describe("standInFaceOf and the font stack", () => {
  it("lists the stand-in after the family and before the typeface", () => {
    expect(standInFace("Chalkboard SE", "Comic Relief")).toBe("Comic Relief for Chalkboard SE");
    expect(standInFaceOf("Chalkboard SE")).toBe("Comic Relief for Chalkboard SE");
    expect(fontFamilyOf({ family: "Chalkboard SE" })).toBe(
      '"Chalkboard SE", "Comic Relief for Chalkboard SE", Arial, Helvetica, sans-serif',
    );
  });

  it("adds nothing for a family fetched as itself, or none", () => {
    expect(standInFaceOf("Caveat")).toBeUndefined();
    expect(fontFamilyOf({ family: "Caveat" })).toBe('"Caveat", Arial, Helvetica, sans-serif');
    expect(fontFamilyOf({ font: "serif" })).toBe("Georgia, serif");
  });
});

describe("files", () => {
  const relief = fontSourceFor("Comic Relief")!.font;

  it("downloads from the pinned commit, the name encoded", () => {
    expect(fontUrl(relief, relief.files[0])).toBe(
      `https://raw.githubusercontent.com/google/fonts/${FONT_COMMIT}/ofl/comicrelief/${relief.files[0].name}`,
    );
    const caveat = fontSourceFor("Caveat")!.font;
    expect(fontUrl(caveat, caveat.files[0])).toMatch(/\/ofl\/caveat\/Caveat%5Bwght%5D\.ttf$/);
  });

  it("keeps fonts under their published names, licences under their family's", () => {
    expect(FONT_FOLDER).toBe("FineNotes assets/Fonts");
    expect(fontPath(relief.files[0])).toBe(`FineNotes assets/Fonts/${relief.files[0].name}`);
    expect(licencePath(relief)).toBe("FineNotes assets/Fonts/Comic Relief OFL.txt");
    expect(licencePath(relief, "Elsewhere")).toBe("Elsewhere/Comic Relief OFL.txt");
  });

  it("counts every file in the download", () => {
    const sum = relief.files.reduce((n, file) => n + file.bytes, relief.licence.bytes);
    expect(downloadSize(relief)).toBe(sum);
  });
});

describe("downloadLabel", () => {
  it("names the font and its size, and says when it is a stand-in", () => {
    expect(downloadLabel(fontSourceFor("Chalkboard SE")!)).toBe(
      "Get a close open font (Comic Relief, 179 KB)",
    );
    expect(downloadLabel(fontSourceFor("Caveat")!)).toBe("Get Caveat (408 KB)");
  });
});

describe("familiesIn", () => {
  it("lists each family the text boxes name once, in name order", () => {
    const doc = emptyDocument();
    const box = (family?: string) => ({ id: "t", x: 0, y: 0, w: 10, text: "", family });
    const pages = [
      { ...doc.pages[0], textBoxes: [box("Chalkboard SE"), box(), box("caveat")] },
      { ...doc.pages[0], textBoxes: [box("chalkboard se"), box('"serif"')] },
      { ...doc.pages[0], textBoxes: undefined },
    ];
    expect(familiesIn(pages)).toEqual(["caveat", "Chalkboard SE"]);
  });
});
