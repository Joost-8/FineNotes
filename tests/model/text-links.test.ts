/**
 * `src/model/text-links.ts`: links typed inside a text box.
 */

import { describe, expect, it } from "vitest";
import {
  displayText,
  hasTextLinks,
  textLinkTargets,
  textSegments,
} from "../../src/model/text-links";

describe("textSegments", () => {
  it("leaves text without links as one plain run", () => {
    expect(textSegments("Just words, [brackets] and a.b")).toEqual([
      { text: "Just words, [brackets] and a.b" },
    ]);
    expect(textSegments("")).toEqual([]);
  });

  it("reads wikilinks, with a heading, and with shown text", () => {
    expect(textSegments("See [[Signals]] and [[Signals#FIR filters|the FIR part]].")).toEqual([
      { text: "See " },
      { text: "Signals", target: "Signals" },
      { text: " and " },
      { text: "the FIR part", target: "Signals#FIR filters" },
      { text: "." },
    ]);
    expect(textSegments("[[Physics.notebook#page=3]]")).toEqual([
      { text: "Physics.notebook#page=3", target: "Physics.notebook#page=3" },
    ]);
  });

  it("reads markdown links and bare addresses, leaving a sentence's punctuation out", () => {
    expect(textSegments("[Wikipedia](https://en.wikipedia.org/wiki/FIR) or www.x.org.")).toEqual([
      { text: "Wikipedia", target: "https://en.wikipedia.org/wiki/FIR" },
      { text: " or " },
      { text: "www.x.org", target: "www.x.org" },
      { text: "." },
    ]);
    expect(textSegments("(see https://x.org/a)")).toEqual([
      { text: "(see " },
      { text: "https://x.org/a", target: "https://x.org/a" },
      { text: ")" },
    ]);
    expect(textSegments("https://x.org/f(1)")[0]).toEqual({
      text: "https://x.org/f(1)",
      target: "https://x.org/f(1)",
    });
  });

  it("keeps an empty or unclosed wikilink as text", () => {
    expect(textSegments("[[ ]] and [[open")).toEqual([{ text: "[[ ]] and [[open" }]);
    expect(textSegments("[[|alias]]")).toEqual([{ text: "[[|alias]]" }]);
  });

  it("never runs a link across a line break", () => {
    expect(textSegments("[[one\ntwo]]")).toEqual([{ text: "[[one\ntwo]]" }]);
  });
});

describe("display, presence and targets", () => {
  it("shows links as their text", () => {
    expect(displayText("See [[Signals#FIR|FIR]] at www.x.org.")).toBe("See FIR at www.x.org.");
  });

  it("knows when a box has links, and where they lead, once each", () => {
    expect(hasTextLinks("plain")).toBe(false);
    expect(hasTextLinks("a [[B]]")).toBe(true);
    expect(textLinkTargets("[[A]] [[B|b]] [[A|again]] https://c.org")).toEqual([
      "A",
      "B",
      "https://c.org",
    ]);
  });
});
