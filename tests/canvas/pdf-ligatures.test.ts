import { describe, expect, it } from "vitest";
import {
  LIGATURE_CANDIDATES,
  isPrivateUse,
  isPrivateUseRun,
  ligatureLexicon,
  repairLigatures,
} from "../../src/canvas/pdf-ligatures";
import { commonWords } from "../../src/translate/languages";

// Private-use codes built from code points: the file tools turn written
// escapes into the invisible characters themselves (CLAUDE.md ledger).
const A = String.fromCharCode(0xe000);
const B = String.fromCharCode(0xe001);
const C = String.fromCharCode(0xe002);
const repair = (texts: string[], fonts?: string[]): string[] =>
  repairLigatures(texts, fonts ?? texts.map(() => "f1"), commonWords());

describe("isPrivateUse", () => {
  it("is the private-use area only", () => {
    expect(isPrivateUse(A)).toBe(true);
    expect(isPrivateUse(String.fromCharCode(0xf8ff))).toBe(true);
    expect(isPrivateUse("f")).toBe(false);
    expect(isPrivateUse(String.fromCharCode(0xfb01))).toBe(false);
  });

  it("tells a whole private-use run from a ligature", () => {
    expect(isPrivateUseRun(`hee${A}t`)).toBe(false);
    expect(isPrivateUseRun(A + B + C + B + A)).toBe(true);
  });
});

describe("repairLigatures", () => {
  it("leaves a page with no codes as it is", () => {
    const texts = ["De fiets staat buiten.", "Koffie"];
    expect(repair(texts)).toEqual(texts);
  });

  // Lines of "De finale 2025" (a Dutch course book) as pdf.js reads them,
  // with each font's own ligature code in them.
  it("reads the ligatures of a Dutch course book", () => {
    const fonts = ["f1", "f1", "f2", "f2", "f3", "f4"];
    const out = repair(
      [
        `Ik ga met de ${B}ets naar school.`,
        `Je hebt ${B}nanciële problemen.`,
        `Hij hee${A}t een auto.`,
        `Zij hee${A}t geen tijd.`,
        `fossiele brandsto${A}en`,
        `Het e${C}ect is groot.`,
      ],
      fonts,
    );
    expect(out).toEqual([
      "Ik ga met de fiets naar school.",
      "Je hebt financiële problemen.",
      "Hij heeft een auto.",
      "Zij heeft geen tijd.",
      "fossiele brandstoffen",
      "Het effect is groot.",
    ]);
  });

  it("takes a code per font: the same code means another ligature in another font", () => {
    const out = repair([`de ${A}ets`, `${A}exibel werken`], ["f1", "f2"]);
    expect(out).toEqual(["de fiets", "flexibel werken"]);
  });

  it("puts back the space after a glyph that ended a word", () => {
    expect(repair([`Hij hee${A}een fiets.`])).toEqual(["Hij heeft een fiets."]);
  });

  it("learns from words elsewhere on the page", () => {
    const out = repair(["Het filmhuis draait een film.", `Kijk de ${A}lm.`]);
    expect(out[1]).toBe("Kijk de film.");
  });

  it("leaves a whole run of private-use text alone", () => {
    const run = A + B + C + B + A + C;
    expect(repair([run, `de ${A}ets`])).toEqual([run, "de fiets"]);
  });

  it("never leaves a code in text it repairs", () => {
    const out = repair([`x${A}y z${B}`]);
    for (const ch of out[0]) expect(isPrivateUse(ch)).toBe(false);
  });

  it("has a lexicon of f-pieces and candidates that all hold an f", () => {
    expect(ligatureLexicon().size).toBeGreaterThan(1000);
    expect(ligatureLexicon().has("^fiets")).toBe(true);
    for (const fill of LIGATURE_CANDIDATES) expect(fill.startsWith("f")).toBe(true);
  });
});
