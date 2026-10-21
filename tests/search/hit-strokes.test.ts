/**
 * `src/search/hit-strokes.ts`: what a search lights up on a page.
 */

import { describe, expect, it } from "vitest";
import { pageHits, searchMatchTarget } from "../../src/search/hit-strokes";

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

  it("finds nothing for an empty query", () => {
    expect(pageHits("  ", words, [{ id: "t1", text: "x" }])).toEqual({ words: [], boxes: [] });
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
