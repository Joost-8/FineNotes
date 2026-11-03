import { describe, expect, it } from "vitest";
import {
  LAST_PAGES_MAX,
  type LastPages,
  anchoredSpot,
  forgetInLastPages,
  lastBoardSpot,
  lastPageIndex,
  parseLastPages,
  rememberPage,
  renameInLastPages,
  spotAnchor,
} from "../../src/model/last-page";
import { BOARD_BLOCK, GrowBoard } from "../../src/model/board";
import { DEFAULT_NOTEBOOK_CHOICES, buildNewDocument } from "../../src/model/new-notebook";

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

describe("where a board was left", () => {
  it("keeps the point in the middle of the view and the zoom, through a reload", () => {
    const map = rememberPage({}, "Boards/Map.notebook.md", "p1", 0, 1000, {
      x: 3100,
      y: 2400.5,
      zoom: 0.5,
    });
    const back = parseLastPages(JSON.parse(JSON.stringify(map)));
    expect(lastBoardSpot(back, "Boards/Map.notebook.md")).toEqual({
      x: 3100,
      y: 2400.5,
      zoom: 0.5,
    });
    // A notebook keeps no spot, and an unknown file has none.
    expect(
      lastBoardSpot(rememberPage(back, "N.notebook.md", "p2", 1, 2000), "N.notebook.md"),
    ).toBeNull();
    expect(lastBoardSpot(back, "constructor")).toBeNull();
  });

  it("drops a spot that is not a whole one", () => {
    for (const spot of [
      { x: 1, y: 2 },
      { x: 1, y: 2, zoom: 0 },
      { x: NaN, y: 2, zoom: 1 },
      "here",
    ]) {
      const map = parseLastPages({ "B.notebook.md": { page: "p1", index: 0, at: 1, spot } });
      expect(map["B.notebook.md"]).toEqual({ page: "p1", index: 0, at: 1 });
    }
  });
});

describe("a board's spot after it grew left or up", () => {
  function board() {
    const doc = buildNewDocument({ ...DEFAULT_NOTEBOOK_CHOICES, type: "endless" }, "Map");
    doc.pages[0].strokes.push({
      id: "s1",
      color: "#000000",
      size: 4,
      tool: "pen",
      pts: [3000, 2500, 0.5, 3100, 2600, 0.5],
    });
    return doc;
  }

  it("follows the drawing when the board grew left and up on another device", () => {
    const doc = board();
    const page = doc.pages[0];
    const kept = { x: 3050, y: 2550, zoom: 1, anchor: spotAnchor(page) };
    expect(kept.anchor).toEqual({ kind: "stroke", id: "s1", x: 3000, y: 2500 });
    // Stored, synced elsewhere, read back here.
    const map = rememberPage({}, "Map.notebook.md", page.id, 0, 1, kept);
    const back = lastBoardSpot(parseLastPages(JSON.parse(JSON.stringify(map))), "Map.notebook.md")!;
    new GrowBoard(page.id, { left: 1, top: 2, right: 0, bottom: 0 }).apply(doc);
    expect(anchoredSpot(back, page)).toMatchObject({
      x: 3050 + BOARD_BLOCK,
      y: 2550 + 2 * BOARD_BLOCK,
      zoom: 1,
    });
  });

  it("stays put when the board grew right or down, or not at all", () => {
    const doc = board();
    const page = doc.pages[0];
    const kept = { x: 3050, y: 2550, zoom: 1, anchor: spotAnchor(page) };
    expect(anchoredSpot(kept, page)).toEqual(kept);
    new GrowBoard(page.id, { left: 0, top: 0, right: 2, bottom: 1 }).apply(doc);
    expect(anchoredSpot(kept, page)).toEqual(kept);
  });

  it("stays put when its anchor was moved by hand, or is gone", () => {
    const doc = board();
    const page = doc.pages[0];
    const kept = { x: 3050, y: 2550, zoom: 1, anchor: spotAnchor(page) };
    page.strokes[0].pts[0] += 37;
    expect(anchoredSpot(kept, page)).toEqual(kept);
    page.strokes = [];
    expect(anchoredSpot(kept, page)).toEqual(kept);
  });

  it("reads a spot kept before anchors as it was, and drops a broken anchor", () => {
    const doc = board();
    const old = { x: 3050, y: 2550, zoom: 1 };
    expect(anchoredSpot(old, doc.pages[0])).toEqual(old);
    const map = parseLastPages({
      "B.notebook.md": { page: "p1", index: 0, at: 1, spot: { ...old, anchor: { kind: "x" } } },
    });
    expect(lastBoardSpot(map, "B.notebook.md")).toEqual(old);
  });

  it("anchors to a picture or a text box when nothing is inked, and to nothing on an empty board", () => {
    const doc = buildNewDocument({ ...DEFAULT_NOTEBOOK_CHOICES, type: "endless" }, "Map");
    const page = doc.pages[0];
    expect(spotAnchor(page)).toBeUndefined();
    page.textBoxes.push({
      id: "t1",
      x: 40,
      y: 50,
      w: 100,
      text: "Hi",
      color: "#000",
      fontSize: 20,
    });
    expect(spotAnchor(page)).toEqual({ kind: "text", id: "t1", x: 40, y: 50 });
    page.images.push({ id: "i1", path: "a.png", x: 10, y: 20, w: 5, h: 5 });
    expect(spotAnchor(page)).toEqual({ kind: "image", id: "i1", x: 10, y: 20 });
  });
});
