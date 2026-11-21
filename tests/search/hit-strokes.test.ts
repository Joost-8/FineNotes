/**
 * `src/search/hit-strokes.ts`: what a search lights up on a page.
 */

import { describe, expect, it } from "vitest";
import {
  lineHits,
  pageHits,
  preferReading,
  searchMatchTarget,
  transcriptMatchInk,
  withFocusInk,
  writtenLettersOf,
} from "../../src/search/hit-strokes";

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
  it("takes the ink of a word", () => {
    const lines = [{ text: "Input port functions", words: [["g0"], ["g1"], ["g2"]] }];
    expect(lineHits("port", lines)).toEqual([["g1"]]);
  });

  it("takes each word's own ink, however many strokes it has, and lights nothing without it", () => {
    // "Routing" was written in two pieces: its word still holds both.
    const lines = [{ text: "Routing determines paths", words: [["g0", "g1"], ["g2"], ["g3"]] }];
    expect(lineHits("routing", lines)).toEqual([["g0", "g1"]]);
    expect(lineHits("paths", lines)).toEqual([["g3"]]);
    // Words and ink that do not pair one for one are never guessed at.
    expect(lineHits("paths", [{ text: "Routing paths", words: [["g0"], ["g1"], ["g2"]] }])).toEqual(
      [],
    );
  });

  it("takes a misread word when nothing holds the query exactly", () => {
    const lines = [{ text: "Fowarding: move packets", words: [["g0"], ["g1"], ["g2"]] }];
    expect(lineHits("forwarding", lines)).toEqual([["g0"]]);
    // A title "CRT" read as "CRI" (Joost's Algebra notebook, page 14) is found.
    expect(lineHits("crt", [{ text: "CRI", words: [["g0"]] }])).toEqual([["g0"]]);
    // Two letters are never guessed at, nor is a word two letters off.
    expect(lineHits("ab", [{ text: "ac", words: [["g0"]] }])).toEqual([]);
    expect(lineHits("crt", [{ text: "CIA", words: [["g0"]] }])).toEqual([]);
  });

  it("lights a phrase in the reading as one, with the words between", () => {
    const lines = [
      { text: "Recipe for defining subnets", words: [["g0"], ["g1"], ["g2"], ["g3"]] },
    ];
    expect(lineHits("recipe for defining", lines, "", true)).toEqual([["g0", "g1", "g2"]]);
    // Without the phrase, every word on its own.
    expect(lineHits("recipe for defining", lines)).toHaveLength(3);
  });

  it("prefers exact hits over near ones", () => {
    const lines = [{ text: "packet packets", words: [["g0"], ["g1"]] }];
    expect(lineHits("packets", lines)).toEqual([["g1"]]);
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
      expect(lineHits("plus", lines, transcript)).toEqual([["g9"]]);
      expect(lineHits("software", lines, transcript)).toEqual([["g0", "g1"]]);
    });

    it("lights a word the reading and the transcript both hold once", () => {
      expect(lineHits("flag", lines, transcript)).toEqual([["g8"]]);
    });

    it("lights every place the transcript holds it, besides the reading's own", () => {
      const twice = [{ text: "order of the ordet", words: [["g0"], ["g1"], ["g2"], ["g3"]] }];
      expect(lineHits("order", twice, "order of the order")).toEqual([["g0"], ["g3"]]);
    });

    it("lights a phrase as one, across lines, where the transcript says it is", () => {
      const ink = lineHits("assignment sign is", lines, transcript, true);
      expect(ink).toEqual([["g2", "g3", "g4"]]);
    });

    it("lights a phrase's words one by one when the phrase cannot be placed", () => {
      const other = [{ text: "flag zzzz plus", words: [["g0"], ["g1"], ["g2"]] }];
      expect(lineHits("flag plus", other, "", true)).toEqual([["g0"], ["g2"]]);
    });

    it("lights nothing where the reading has nothing like the transcript", () => {
      const other = [{ text: "zzzz qqqq", words: [["g0"], ["g1"]] }];
      expect(lineHits("plus", other, "a flag plus")).toEqual([]);
    });
  });
});

describe("a page with two transcripts (Joost's Algebra notebook, page 14)", () => {
  // The device read the title "CRT Exercises" as "(R)", "- F", "exercise".
  const lines = [
    { text: "(R)", words: [["g0"]] },
    { text: "- F", words: [["g1"], ["g2"]] },
    { text: "exercise 5", words: [["g3"], ["g4"]] },
    { text: "gcd(m, n) = d = 1", words: [["g5"], ["g6"], ["g7"], ["g8"], ["g9"], ["g10"]] },
    { text: "sol exists", words: [["g11"], ["g12"]] },
  ];
  // The note's own entry (an older device reading), then the AI's transcript.
  const own = "gcd(m, n) = d = 1\nxercises\nsol exists\nA.";
  const ai = "CRT Exercises\n\n$\\gcd(m,n) = d = 1$\nsol exists";

  it("lights a word at the start of the second, each lined up on its own", () => {
    expect(lineHits("crt", lines, [own, ai], true)).toEqual([["g0", "g2"]]);
    // Joined, the first one's last letters were the word's context, and it was lost.
    expect(lineHits("crt", lines, `${own}\n${ai}`, true)).toEqual([]);
  });

  it("gives each match its own ink, in the results list's order, empty where unplaced", () => {
    const each = transcriptMatchInk("sol", lines, [{ text: own }, { text: ai }], true);
    expect(each).toEqual([["g11"], ["g11"]]);
    const none = transcriptMatchInk("zzz", lines, [{ text: "zzz qqq" }], true);
    expect(none).toEqual([[]]);
    expect(transcriptMatchInk("", lines, [{ text: ai }])).toEqual([]);
  });
});

describe("writtenLettersOf", () => {
  it("leaves out LaTeX command names and the AI's own notes, not what was written", () => {
    const { text } = writtenLettersOf(
      String.raw`$27 \equiv 2 \bmod 5$ [placed picture not shown] \gcd(a,n) [0, 1] [[page 2]]`,
    );
    expect(text).toBe("272mod5gcdan01page2");
  });

  it("says where each letter came from", () => {
    expect(writtenLettersOf(String.raw`a \cdot b`)).toEqual({ text: "ab", at: [0, 8] });
  });
});

describe("withFocusInk", () => {
  it("finds the lit group that is the match's ink, in any order", () => {
    const words = [["g0"], ["g2", "g1"]];
    const { words: out, focus } = withFocusInk(words, ["g1", "g2"]);
    expect(out).toEqual(words);
    expect(focus).toBe(out[1]);
  });

  it("takes the lit group sharing most strokes when none is the same", () => {
    const words = [
      ["g0", "g9"],
      ["g1", "g2", "g3"],
    ];
    const { focus } = withFocusInk(words, ["g1", "g2"]);
    expect(focus).toBe(words[1]);
  });

  it("never makes ink current that is not lit", () => {
    const { words: out, focus } = withFocusInk([["g0"]], ["g1", "g2"]);
    expect(out).toEqual([["g0"]]);
    expect(focus).toBeNull();
    expect(withFocusInk([["g0"]], []).focus).toBeNull();
  });
});

describe("when the reading and the transcript disagree (Network lecture notes, page 20)", () => {
  // Grape read "5 flags" right; the AI wrote "… plus congestion notification) ← flags",
  // so lined up, the transcript's "flags" fell on the "pint" ink at the end of the
  // header line.
  const lines = [
    { text: ".", words: [["d0"]] },
    { text: "/(p", words: [["d1"]] },
    { text: ",", words: [["d2"]] },
    { text: "5 flags", words: [["f0"], ["f1"]] },
    { text: "Header: (STNFT)-N, RST, Ack, pint", words: [["h0"], ["h1"], ["h2"], ["h3"], ["h4"]] },
    {
      text: "Sequence number, Ack * harder length,",
      words: [["q0"], ["q1"], ["q2"], ["q3"], ["q4"], ["q5"]],
    },
  ];
  const ai =
    "TCP:\n\nHeader: (SYN, FIN, RST, ACK, plus congestion notification) ← flags\n" +
    "Sequence number, ACK #, header length,";

  it("lights the reading's exact match alone", () => {
    expect(transcriptMatchInk("flags", lines, [{ text: ai }])).toEqual([["h4"]]);
    expect(lineHits("flags", lines, [ai])).toEqual([["f1"]]);
  });

  it("keeps both when they share ink, and the transcript's when the reading has none", () => {
    expect(preferReading([["a", "b"]], [["b", "c"], ["d"]])).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["d"],
    ]);
    expect(preferReading([], [["d"]])).toEqual([["d"]]);
    expect(preferReading([["a"]], [["d"]])).toEqual([["a"]]);
    expect(preferReading([["a"]], [])).toEqual([["a"]]);
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
