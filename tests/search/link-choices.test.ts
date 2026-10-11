/**
 * `src/search/link-choices.ts`: what the "Link to…" picker offers.
 */

import { describe, expect, it } from "vitest";
import { type LinkableNote, linkChoices } from "../../src/search/link-choices";

const note = (path: string, headings: string[] = []): LinkableNote => {
  const basename = path.split("/").pop()!.replace(/\.md$/, "");
  return { path, basename, linktext: basename, headings };
};

const NOTES = [
  note("Courses/Signals.md", ["FIR filters", "IIR filters", "Sampling"]),
  note("Courses/Systems and signals.md"),
  note("Signals archive/Old.md"),
  note("Physics.notebook.md", []),
];

describe("linkChoices", () => {
  it("offers a web address alone when one is typed", () => {
    expect(linkChoices(" https://en.wikipedia.org/wiki/FIR ", NOTES)).toEqual([
      { kind: "url", target: "https://en.wikipedia.org/wiki/FIR" },
    ]);
    expect(linkChoices("www.styluslabs.com", NOTES)[0].kind).toBe("url");
  });

  it("lists notes by name start, then name, then path", () => {
    const targets = linkChoices("signals", NOTES).map((c) => c.target);
    // "signals" names the note Signals, whatever the case: no new note offered.
    expect(targets).toEqual(["Signals", "Systems and signals", "Old"]);
  });

  it("offers the typed text as a new note unless it names one exactly", () => {
    expect(linkChoices("Signals", NOTES).some((c) => c.kind === "new")).toBe(false);
    expect(linkChoices("Signal", NOTES).at(-1)).toEqual({ kind: "new", target: "Signal" });
    expect(linkChoices("Fourier", NOTES)).toEqual([{ kind: "new", target: "Fourier" }]);
  });

  it("lists a note's headings after a #", () => {
    const choices = linkChoices("signals#filt", NOTES);
    expect(choices.map((c) => c.target)).toEqual([
      "Signals#FIR filters",
      "Signals#IIR filters",
      "signals#filt",
    ]);
    expect(choices[0]).toMatchObject({ kind: "heading", heading: "FIR filters" });
    // A page of a notebook has no heading to pick: the typed link is offered.
    expect(linkChoices("Physics.notebook#page=3", NOTES)).toEqual([
      { kind: "new", target: "Physics.notebook#page=3" },
    ]);
  });

  it("lists every note for nothing typed, and stops at the limit", () => {
    expect(linkChoices("", NOTES).map((c) => c.target)).toEqual(NOTES.map((n) => n.linktext));
    const many = Array.from({ length: 80 }, (_, i) => note(`n${i}.md`, ["h"]));
    expect(linkChoices("", many)).toHaveLength(50);
    expect(linkChoices("#h", many).filter((c) => c.kind === "heading")).toHaveLength(50);
  });
});
