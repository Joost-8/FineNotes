import { describe, expect, it } from "vitest";
import {
  LAST_PAGES_MAX,
  type LastPages,
  forgetInLastPages,
  lastPageIndex,
  parseLastPages,
  rememberPage,
  renameInLastPages,
} from "../../src/model/last-page";

const pages = (...ids: string[]): Array<{ id: string }> => ids.map((id) => ({ id }));

describe("last page", () => {
  it("reopens on the page by id, wherever it has moved to", () => {
    const map = rememberPage({}, "Notes/Physics.ink.md", "p7", 3, 1000);
    expect(lastPageIndex(map, "Notes/Physics.ink.md", pages("p1", "p2", "p3", "p7"))).toBe(3);
    // Two pages were added in front of it on another device.
    expect(
      lastPageIndex(map, "Notes/Physics.ink.md", pages("a", "b", "p1", "p2", "p3", "p7")),
    ).toBe(5);
  });

  it("falls back to the index when the page is gone, and to nothing past the end", () => {
    const map = rememberPage({}, "n.ink.md", "gone", 2, 1000);
    expect(lastPageIndex(map, "n.ink.md", pages("p1", "p2", "p3"))).toBe(2);
    expect(lastPageIndex(map, "n.ink.md", pages("p1", "p2"))).toBeNull();
  });

  it("knows nothing of a notebook never read, even one named like Object's members", () => {
    expect(lastPageIndex({}, "n.ink.md", pages("p1"))).toBeNull();
    expect(lastPageIndex({}, "constructor", pages("p1"))).toBeNull();
    expect(lastPageIndex(parseLastPages({}), "toString", pages("p1"))).toBeNull();
  });

  it("does not mutate the map it was given", () => {
    const before: LastPages = rememberPage({}, "a", "p1", 0, 1);
    const snapshot = JSON.stringify(before);
    rememberPage(before, "b", "p2", 1, 2);
    renameInLastPages(before, "a", "c");
    forgetInLastPages(before, "a");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("ignores a nonsense record instead of storing it", () => {
    const map = rememberPage({}, "a", "p1", -1, 1);
    expect(lastPageIndex(map, "a", pages("p1"))).toBeNull();
    expect(Object.keys(rememberPage({}, "", "p1", 0, 1))).toEqual([]);
  });

  it("forgets the longest unread beyond the limit", () => {
    let map: LastPages = {};
    for (let i = 0; i <= LAST_PAGES_MAX; i++) map = rememberPage(map, `n${i}`, "p", 0, i);
    expect(Object.keys(map)).toHaveLength(LAST_PAGES_MAX);
    expect(lastPageIndex(map, "n0", pages("p"))).toBeNull();
    expect(lastPageIndex(map, `n${LAST_PAGES_MAX}`, pages("p"))).toBe(0);
  });

  it("follows a rename, and forgets a deleted notebook", () => {
    const map = rememberPage({}, "old.ink.md", "p2", 1, 5);
    const renamed = renameInLastPages(map, "old.ink.md", "Folder/new.ink.md");
    expect(lastPageIndex(renamed, "Folder/new.ink.md", pages("p1", "p2"))).toBe(1);
    expect(lastPageIndex(renamed, "old.ink.md", pages("p1", "p2"))).toBeNull();
    expect(renameInLastPages(map, "missing", "x")).toBe(map);
    expect(
      lastPageIndex(
        forgetInLastPages(renamed, "Folder/new.ink.md"),
        "Folder/new.ink.md",
        pages("p2"),
      ),
    ).toBeNull();
  });

  it("parses only well-formed entries", () => {
    const map = parseLastPages({
      good: { page: "p1", index: 0, at: 1 },
      noPage: { index: 0, at: 1 },
      fraction: { page: "p1", index: 0.5, at: 1 },
      negative: { page: "p1", index: -2, at: 1 },
      badTime: { page: "p1", index: 0, at: "yesterday" },
      notObject: 7,
    });
    expect(Object.keys(map)).toEqual(["good"]);
    expect(parseLastPages(null)).toEqual({});
    expect(parseLastPages([1, 2])).toEqual({});
    expect(parseLastPages("text")).toEqual({});
  });
});
