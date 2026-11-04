import { describe, expect, it } from "vitest";
import { isStarred, starredFirst, starsOf, toggleStar } from "../../src/model/favorites";

describe("starsOf", () => {
  it("keeps strings, drops blanks, repeats and everything else", () => {
    expect(starsOf(["a", "a", " ", 3, null, "b"])).toEqual(["a", "b"]);
  });

  it("reads a missing or odd value as no stars", () => {
    for (const raw of [undefined, null, "a", 1, {}]) expect(starsOf(raw)).toEqual([]);
  });
});

describe("toggleStar", () => {
  it("adds a path, and takes it off again", () => {
    const once = toggleStar([], "Maths");
    expect(once).toEqual(["Maths"]);
    expect(isStarred(once, "Maths")).toBe(true);
    expect(toggleStar(once, "Maths")).toEqual([]);
  });

  it("leaves the list it was given alone", () => {
    const stars = ["a"];
    toggleStar(stars, "b");
    expect(stars).toEqual(["a"]);
  });
});

describe("starredFirst", () => {
  it("floats starred items up and keeps the order in both groups", () => {
    const items = ["a", "b", "c", "d"];
    expect(starredFirst(items, ["d", "b"], (s) => s)).toEqual(["b", "d", "a", "c"]);
  });
});
