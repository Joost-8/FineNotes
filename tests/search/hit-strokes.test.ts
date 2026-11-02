/**
 * `src/search/hit-strokes.ts`: what a search lights up on a page.
 */

import { describe, expect, it } from "vitest";
import { lineHits, pageHits, searchMatchTarget } from "../../src/search/hit-strokes";

const words = [
  { text: "Mitochondria", strokeIds: ["s1", "s2"] },
  { text: "make", strokeIds: ["s3"] },
  { text: "ATP,", strokeIds: ["s4"] },
  { text: "ghost", strokeIds: [] },
];

describe("pageHits", () => {
  it("finds the words holding any word of the query, by their strokes, in order", () => {
    expect(pageHits("atp mitochondria", words, []).words).toEqual([["s1", "s2"], ["s4"]]);
  });

  it("folds case and accents as the search does, and matches inside a word", () => {
    expect(pageHits("MITO", words, []).words).toEqual([["s1", "s2"]]);
    expect(pageHits("mäke", [{ text: "Make", strokeIds: ["x"] }], []).words).toEqual([["x"]]);
  });

  it("finds text boxes too, and skips a word with no ink", () => {
    const boxes = [
      { id: "t1", text: "The cristae fold" },
      { id: "t2", text: "Ghost" },
    ];
    expect(pageHits("ghost", words, boxes)).toEqual({ words: [], boxes: ["t2"] });
  });

  it("finds the boxes holding the phrase, on a page that holds it", () => {
    const boxes = [
      { id: "t1", text: "A recipe for\ndefining subnets" },
      { id: "t2", text: "for defining; a recipe" },
    ];
    expect(pageHits("recipe for definin", [], boxes, true).boxes).toEqual(["t1"]);
    expect(pageHits("recipe for definin", [], boxes).boxes).toEqual(["t1", "t2"]);
  });

  it("finds nothing for an empty query", () => {
    expect(pageHits("  ", words, [{ id: "t1", text: "x" }])).toEqual({ words: [], boxes: [] });
  });
});

describe("lineHits", () => {
  // Each stroke id is a 40 px wide word group at x = its index × 50.
  const boundsOf = (ids: readonly string[]) => {
    const xs = ids.map((id) => Number(id.slice(1)) * 50);
    return { minX: Math.min(...xs), maxX: Math.max(...xs) + 40 };
  };

  it("takes the word group of a word when the line's counts agree", () => {
    const lines = [{ text: "Input port functions", words: [["g0"], ["g1"], ["g2"]] }];
    expect(lineHits("port", lines, boundsOf)).toEqual([["g1"]]);
  });

  it("places a word by its share of the line when the ink has more groups", () => {
    // "Routing" was written in two pieces: six groups for three words.
    const lines = [
      { text: "Routing determines paths", words: [["g0"], ["g1"], ["g2"], ["g3"], ["g4"], ["g5"]] },
    ];
    expect(lineHits("routing", lines, boundsOf)).toEqual([["g0", "g1"]]);
    expect(lineHits("determines", lines, boundsOf)).toEqual([["g2", "g3", "g4"]]);
    expect(lineHits("paths", lines, boundsOf)).toEqual([["g5"]]);
  });

  it("takes a misread word when nothing holds the query exactly", () => {
    const lines = [{ text: "Fowarding: move packets", words: [["g0"], ["g1"], ["g2"]] }];
    expect(lineHits("forwarding", lines, boundsOf)).toEqual([["g0"]]);
    // A title "CRT" read as "CRI" (Joost's Algebra notebook, page 14) is found.
    expect(lineHits("crt", [{ text: "CRI", words: [["g0"]] }], boundsOf)).toEqual([["g0"]]);
    // Two letters are never guessed at, nor is a word two letters off.
    expect(lineHits("ab", [{ text: "ac", words: [["g0"]] }], boundsOf)).toEqual([]);
    expect(lineHits("crt", [{ text: "CIA", words: [["g0"]] }], boundsOf)).toEqual([]);
  });

  it("lights a phrase in the reading as one, with the words between", () => {
    const lines = [
      { text: "Recipe for defining subnets", words: [["g0"], ["g1"], ["g2"], ["g3"]] },
    ];
    expect(lineHits("recipe for defining", lines, boundsOf, "", true)).toEqual([
      ["g0", "g1", "g2"],
    ]);
    // Without the phrase, every word on its own.
    expect(lineHits("recipe for defining", lines, boundsOf)).toHaveLength(3);
  });

  it("prefers exact hits over near ones", () => {
    const lines = [{ text: "packet packets", words: [["g0"], ["g1"]] }];
    expect(lineHits("packets", lines, boundsOf)).toEqual([["g1"]]);
  });

  describe("with the page's transcript", () => {
    // Readings and transcripts from Joost's Algebra notebook, page 6.
    const lines = [
      { text: "Soft ware assignment", words: [["g0"], ["g1"], ["g2"]] },
      {
        text: "Sign is stored as a flag PIVJ",
        words: [["g3"], ["g4"], ["g5"], ["g6"], ["g7"], ["g8"], ["g9"]],
      },
    ];
    const transcript = "Software assignment\nSign is stored as a flag plus";

    it("lights a word the device misread, where the transcript says it is", () => {
      expect(lineHits("plus", lines, boundsOf, transcript)).toEqual([["g9"]]);
      expect(lineHits("software", lines, boundsOf, transcript)).toEqual([["g0", "g1"]]);
    });

    it("lights a word the reading and the transcript both hold once", () => {
      expect(lineHits("flag", lines, boundsOf, transcript)).toEqual([["g8"]]);
    });

    it("lights every place the transcript holds it, besides the reading's own", () => {
      const twice = [{ text: "order of the ordet", words: [["g0"], ["g1"], ["g2"], ["g3"]] }];
      expect(lineHits("order", twice, boundsOf, "order of the order")).toEqual([["g0"], ["g3"]]);
    });

    it("lights a phrase as one, across lines, where the transcript says it is", () => {
      const ink = lineHits("assignment sign is", lines, boundsOf, transcript, true);
      expect(ink).toEqual([["g2", "g3", "g4"]]);
    });

    it("lights a phrase's words one by one when the phrase cannot be placed", () => {
      const other = [{ text: "flag zzzz plus", words: [["g0"], ["g1"], ["g2"]] }];
      expect(lineHits("flag plus", other, boundsOf, "", true)).toEqual([["g0"], ["g2"]]);
    });

    it("lights nothing where the reading has nothing like the transcript", () => {
      const other = [{ text: "zzzz qqqq", words: [["g0"], ["g1"]] }];
      expect(lineHits("plus", other, boundsOf, "a flag plus")).toEqual([]);
    });
  });
});

describe("searchMatchTarget", () => {
  const note = [
    "My own words about cells",
    "",
    "<!--goodobsidian-text-->",
    "### Page 1",
    "<!--goodobsidian-page p1 h-->",
    "Mitochondria make ATP",
    "",
    "### Page 4",
    "<!--goodobsidian-page p4 h-->",
    "Cristae fold inwards",
    "",
    "### Tasks",
    "<!--goodobsidian-tasks-->",
    "- [ ] Buy milk [[#Page 2]] ^ft-ck1",
    "<!--/goodobsidian-text-->",
  ].join("\n");
  const at = (word: string): [number, number] => {
    const start = note.indexOf(word);
    return [start, start + word.length];
  };

  it("lands on the page whose entry holds the match, with the words matched", () => {
    expect(searchMatchTarget(note, [at("Cristae")])).toEqual({ pageIndex: 3, query: "Cristae" });
    expect(searchMatchTarget(note, [at("ATP"), at("Cristae")])).toEqual({
      pageIndex: 0,
      query: "ATP",
    });
  });

  it("follows a task line's link to its page", () => {
    expect(searchMatchTarget(note, [at("milk")])).toEqual({ pageIndex: 1, query: "milk" });
  });

  it("lands nowhere for a match in the user's own prose, or a bad range", () => {
    expect(searchMatchTarget(note, [at("cells")])).toBeNull();
    expect(searchMatchTarget(note, [])).toBeNull();
    expect(searchMatchTarget(note, [[5, 2]])).toBeNull();
    expect(searchMatchTarget(note, [[0, note.length + 9]])).toBeNull();
  });
});
