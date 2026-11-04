import { describe, expect, it } from "vitest";
import { layoutText, pdfToPage } from "../../../src/canvas/pdf-text";
import {
  correction,
  correctLines,
  needsNormalising,
  normaliseLines,
  normaliseWord,
  weightedDistance,
  wordsOfLayout,
} from "../../../src/recognition/ocr/ocr-text";
import {
  OCR_TUNING,
  type OcrPage,
  type OcrWord,
  mergedItems,
  readableLines,
  wordItems,
} from "../../../src/recognition/ocr/ocr-words";
import { layoutPlainText } from "../../../src/search/pdf-hits";

const word = (text: string, x0: number, x1: number, extra: Partial<OcrWord> = {}): OcrWord => ({
  text,
  box: [x0, 100, x1, 112],
  conf: 0.97,
  min: 0.9,
  ...extra,
});

describe("normalising what OCR read", () => {
  it("leaves an ordinary word as it is", () => {
    const w = word("Bladder", 10, 60);
    expect(needsNormalising(w.text)).toBe(false);
    expect(normaliseWord(w)).toEqual([w]);
    expect(normaliseWord(w)[0]).toBe(w);
  });

  it("turns a circled number glued to a word into its own token, cut where the recogniser put it", () => {
    // "①Before": the symbol runs 10 to 22, the word 22 to 70.
    const w = word("①Before", 10, 70, { cuts: [22, 30, 36, 42, 48, 58] });
    const out = normaliseWord(w);
    expect(out.map((o) => o.text)).toEqual(["1", "Before"]);
    expect(out[0].box).toEqual([10, 100, 22, 112]);
    expect(out[1].box).toEqual([22, 100, 70, 112]);
    expect(out.map((o) => o.raw)).toEqual(["①Before", "①Before"]);
    expect(out[0].conf).toBe(0.97);
  });

  it("cuts in proportion to the characters when the word was stored without positions", () => {
    const out = normaliseWord(word("②Bladder", 10, 10 + 1.6 * 10 + 7 * 10));
    expect(out.map((o) => o.text)).toEqual(["2", "Bladder"]);
    expect(out[0].box[2]).toBeCloseTo(26, 6);
    expect(out[1].box[0]).toBeCloseTo(26, 6);
  });

  it("splits a symbol in the middle of a word, and expands one that has several digits", () => {
    const out = normaliseWord(word("Step③Next", 0, 90, { cuts: [8, 16, 24, 30, 45, 55, 65, 75] }));
    expect(out.map((o) => o.text)).toEqual(["Step", "3", "Next"]);
    expect(out.map((o) => o.box[0])).toEqual([0, 30, 45]);
    expect(out.map((o) => o.box[2])).toEqual([30, 45, 90]);
    expect(normaliseWord(word("⑩Ten", 0, 40))[0].text).toBe("10");
  });

  it("normalises ligatures and fullwidth forms in place, keeping the box", () => {
    expect(normaliseWord(word("ﬁnal", 5, 40))).toMatchObject([
      { text: "final", box: [5, 100, 40, 112] },
    ]);
    expect(normaliseWord(word("ＡＢｃ１", 5, 40)).map((o) => o.text)).toEqual(["ABc1"]);
    // An ideographic space is a space.
    expect(normaliseWord(word("a　b", 0, 30)).map((o) => o.text)).toEqual(["a", "b"]);
  });

  it("keeps the boxes in order and inside the word, whatever the cuts say", () => {
    const out = normaliseWord(word("①A②B", 0, 40, { cuts: [30, 20, 100] }));
    expect(out.map((o) => o.text)).toEqual(["1", "A", "2", "B"]);
    for (let i = 0; i < out.length; i++) {
      expect(out[i].box[0]).toBeLessThanOrEqual(out[i].box[2]);
      expect(out[i].box[2]).toBeLessThanOrEqual(40);
      if (i > 0) expect(out[i].box[0]).toBeGreaterThanOrEqual(out[i - 1].box[0]);
    }
  });

  it("makes search text '1 Before' from a line, with the space where the split is", () => {
    const lines = normaliseLines([
      [word("①Before", 10, 70, { cuts: [22, 30, 36, 42, 48, 58] }), word("surgery", 74, 120)],
    ]);
    const viewport = [1, 0, 0, -1, 0, 200] as const;
    const items = wordItems(lines, viewport);
    const text = layoutPlainText(
      layoutText(
        items,
        pdfToPage(viewport, { width: 300, height: 200 }, { width: 300, height: 200 }),
      ),
    );
    expect(text).toBe("1 Before surgery");
  });
});

describe("the distance between a reading and a word", () => {
  it("counts the classic confusions as cheap and other edits as 1", () => {
    const t = OCR_TUNING;
    expect(weightedDistance("Extemal", "external", t)).toBeCloseTo(0.4, 6);
    expect(weightedDistance("clown", "down", t)).toBeCloseTo(0.4, 6);
    expect(weightedDistance("vvater", "water", t)).toBeCloseTo(0.4, 6);
    expect(weightedDistance("lime", "hme", t)).toBeCloseTo(0.4, 6);
    expect(weightedDistance("BIadder", "bladder", t)).toBeCloseTo(0.4, 6);
    expect(weightedDistance("0range", "orange", t)).toBeCloseTo(0.4, 6);
    expect(weightedDistance("bladdder", "bladder", t)).toBeCloseTo(0.5, 6);
    expect(weightedDistance("blader", "bladder", t)).toBeCloseTo(0.5, 6);
    expect(weightedDistance("Augumentation", "augmentation", t)).toBe(1);
    expect(weightedDistance("kidney", "kidney", t)).toBe(0);
    expect(weightedDistance("bladder", "ureter", t)).toBeGreaterThan(2);
  });
});

describe("correcting a word to the PDF's own vocabulary", () => {
  const vocabulary = new Set([
    "external",
    "augmentation",
    "bladder",
    "sphincter",
    "sling",
    "pubic",
  ]);
  const lexicon = new Set(["maternal", "cloud", "modern"]);
  const dictionary = { vocabulary, lexicon };
  const t = OCR_TUNING;

  it("corrects a word one cheap edit from exactly one word of the PDF", () => {
    expect(correction("Extemal", dictionary, t)).toBe("External");
    expect(correction("Augumentation", dictionary, t)).toBe("Augmentation");
    expect(correction("BIadder", dictionary, t)).toBe("Bladder");
  });

  it("keeps the case style it was read in", () => {
    expect(correction("extemal", dictionary, t)).toBe("external");
    expect(correction("EXTEMAL", dictionary, t)).toBe("EXTERNAL");
    expect(correction("Extemal", dictionary, t)).toBe("External");
    // No style to keep: left alone.
    expect(correction("ExTemal", dictionary, t)).toBeNull();
  });

  it("does nothing when two words are equally near", () => {
    const two = { vocabulary: new Set(["matter", "mutter"]), lexicon: new Set<string>() };
    expect(correction("mxtter", two, t)).toBeNull();
    expect(correction("matter", two, t)).toBeNull();
  });

  it("leaves short words, words of the PDF, English words and non-words alone", () => {
    expect(correction("rnap", { vocabulary: new Set(["map"]), lexicon: new Set() }, t)).toBeNull();
    expect(correction("blad", dictionary, t)).toBeNull();
    expect(correction("bladder", dictionary, t)).toBeNull();
    // In the English list: a word, whatever the PDF says.
    expect(correction("cloud", { vocabulary: new Set(["dloud"]), lexicon }, t)).toBeNull();
    expect(correction("kidney2", dictionary, t)).toBeNull();
    expect(correction("12345", dictionary, t)).toBeNull();
  });

  it("is not a different ending: a plural or a stem is another word", () => {
    expect(correction("slings", dictionary, t)).toBeNull();
    expect(correction("bladders", dictionary, t)).toBeNull();
    expect(correction("sphinctered", dictionary, t)).toBeNull();
    // Nor a different last letter: "cystoscope" is a word, "cystoscopy" another.
    const scopy = { vocabulary: new Set(["cystoscopy"]), lexicon: new Set<string>() };
    expect(correction("Cystoscope", scopy, t)).toBeNull();
    expect(correction("Cystoscopy", scopy, t)).toBeNull();
  });

  it("allows two edits only for words of nine letters or more", () => {
    const v = { vocabulary: new Set(["catheterizable"]), lexicon: new Set<string>() };
    expect(correction("catheterizabie", v, t)).toBe("catheterizable");
    expect(correction("cathetexizabke", v, t)).toBe("catheterizable");
    expect(correction("cathetexizabkx", v, t)).toBeNull();
    const short = { vocabulary: new Set(["bladder"]), lexicon: new Set<string>() };
    expect(correction("bloddar", short, t)).toBeNull();
  });

  it("corrects lines, keeping punctuation and the raw word", () => {
    const out = correctLines(
      [[word("Extemal,", 0, 40), word("sphincter", 44, 90), word("(Augumentation)", 94, 160)]],
      dictionary,
      t,
    );
    expect(out[0].map((w) => w.text)).toEqual(["External,", "sphincter", "(Augmentation)"]);
    expect(out[0].map((w) => w.raw)).toEqual(["Extemal,", undefined, "(Augumentation)"]);
  });

  it("reads the words of a laid-out page, four letters or more, lower case", () => {
    const viewport = [1, 0, 0, -1, 0, 100] as const;
    const items = [
      {
        str: "The External sphincter, and a bladder.",
        transform: [10, 0, 0, 10, 0, 50],
        width: 190,
        height: 10,
      },
    ];
    const layout = layoutText(
      items,
      pdfToPage(viewport, { width: 300, height: 100 }, { width: 300, height: 100 }),
    );
    expect(wordsOfLayout(layout)).toEqual(["external", "sphincter", "bladder"]);
  });
});

describe("what a page reads as", () => {
  const page: OcrPage = {
    imageWidth: 100,
    imageHeight: 100,
    pageWidth: 300,
    pageHeight: 200,
    condition: "TEXT_WITH_FIGURES",
    regions: [{ x0: 0, y0: 0, x1: 300, y1: 200, dpi: null }],
    lines: [
      {
        conf: 0.98,
        words: [
          word("①Extemal", 10, 80, { cuts: [22, 30, 36, 42, 48, 58, 64] }),
          word("sphincter", 84, 130),
        ],
      },
    ],
  };
  const dictionary = { vocabulary: new Set(["external"]), lexicon: new Set<string>() };

  it("normalises, then corrects, and keeps the raw words out of the page's text", () => {
    const lines = readableLines(page, [], OCR_TUNING, dictionary);
    expect(lines[0].map((w) => w.text)).toEqual(["1", "External", "sphincter"]);
    expect(lines[0].map((w) => w.raw)).toEqual(["①Extemal", "①Extemal", undefined]);
    const items = mergedItems(
      [],
      page,
      [1, 0, 0, -1, 0, 200],
      { width: 300, height: 200 },
      OCR_TUNING,
      true,
      dictionary,
    );
    expect(items.map((i) => i.str)).toEqual(["1", "External", "sphincter"]);
    // Without a dictionary only the normalising happens.
    expect(readableLines(page, [], OCR_TUNING)[0].map((w) => w.text)).toEqual([
      "1",
      "Extemal",
      "sphincter",
    ]);
    // The stored page is untouched.
    expect(page.lines[0].words[0].text).toBe("①Extemal");
  });
});
