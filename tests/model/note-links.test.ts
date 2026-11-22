import { describe, expect, it } from "vitest";
import { findMarks, marksKey, openLinkAt, rankNames } from "../../src/model/note-links";

describe("links and tags in a line", () => {
  it("finds links with aliases and headings, and tags", () => {
    const marks = findMarks(
      "See [[Trip]] and [[Huts#Puez|the hut]] #travel/italy, not a#b or #2026",
    );
    expect(marks.map((m) => [m.kind, m.target])).toEqual([
      ["link", "Trip"],
      ["link", "Huts"],
      ["tag", "#travel/italy"],
    ]);
    expect(marks[0]).toMatchObject({ from: 4, to: 12 });
  });

  it("finds a tag at the line's start, and none inside a link", () => {
    expect(findMarks("#todo now").map((m) => m.target)).toEqual(["#todo"]);
    expect(findMarks("[[Note #1]]").map((m) => m.kind)).toEqual(["link"]);
  });

  it("keys a line's marks by kind and place", () => {
    expect(marksKey(findMarks("[[a]] #b"))).toBe("l0-5,t6-8");
    expect(marksKey(findMarks("plain"))).toBe("");
  });
});

describe("the link being typed", () => {
  it("is the [[ before the caret with no ]] yet", () => {
    expect(openLinkAt("go to [[Tri", 11)).toEqual({ from: 6, query: "Tri" });
    expect(openLinkAt("go to [[", 8)).toEqual({ from: 6, query: "" });
    expect(openLinkAt("[[Done]] and", 12)).toBeNull();
    expect(openLinkAt("no link", 7)).toBeNull();
  });

  it("ranks names: start of name, start of a word, anywhere", () => {
    const names = ["Trip to the Dolomites", "Old trips", "Patrick", "Tripod notes", "Huts"];
    expect(rankNames(names, "trip")).toEqual([
      "Tripod notes",
      "Trip to the Dolomites",
      "Old trips",
    ]);
    expect(rankNames(names, "", 2)).toEqual(["Huts", "Patrick"]);
  });
});
