import { describe, expect, it } from "vitest";
import { defaultFolderSidebarData, folderSidebarDataOf } from "../../src/model/folder-sidebar-data";

describe("the sidebar's defaults", () => {
  it("are the standalone plugin's", () => {
    expect(defaultFolderSidebarData()).toEqual({
      folderColors: {},
      expanded: {},
      showFilesInSidebar: false,
      hideAttachmentFolders: true,
      librarySort: "created",
      librarySortDescending: true,
      libraryViewMode: "grid",
      pinned: [],
      recent: [],
      showCounts: true,
      showPinned: true,
      showRecent: true,
      autoColorNewFolders: false,
      seenIntro: false,
      recentColors: [],
      searchInNotes: true,
    });
  });

  it("are a new object each time", () => {
    const a = defaultFolderSidebarData();
    a.pinned.push("x");
    a.folderColors.x = "red";
    expect(defaultFolderSidebarData().pinned).toEqual([]);
    expect(defaultFolderSidebarData().folderColors).toEqual({});
  });
});

describe("loading the sidebar's data", () => {
  it("takes the defaults for nothing, or for something that is not an object", () => {
    for (const raw of [undefined, null, 5, "text", [], true]) {
      expect(folderSidebarDataOf(raw), String(raw)).toEqual(defaultFolderSidebarData());
    }
  });

  it("keeps what was stored, and defaults what is missing", () => {
    const loaded = folderSidebarDataOf({
      showCounts: false,
      librarySort: "name",
      librarySortDescending: false,
      libraryViewMode: "list",
      pinned: ["A", "B"],
      folderColors: { A: "#c4566f" },
      expanded: { A: true },
      seenIntro: true,
      recentColors: ["#123456"],
    });
    expect(loaded).toEqual({
      ...defaultFolderSidebarData(),
      showCounts: false,
      librarySort: "name",
      librarySortDescending: false,
      libraryViewMode: "list",
      pinned: ["A", "B"],
      folderColors: { A: "#c4566f" },
      expanded: { A: true },
      seenIntro: true,
      recentColors: ["#123456"],
    });
  });

  it("replaces a value of the wrong kind with the default", () => {
    const loaded = folderSidebarDataOf({
      showCounts: "yes",
      showPinned: 0,
      librarySort: "size",
      libraryViewMode: "tiles",
      pinned: "A",
      recent: { 0: "A" },
      folderColors: ["x"],
      expanded: "A",
      recentColors: null,
    });
    expect(loaded).toEqual(defaultFolderSidebarData());
  });

  it("drops list entries and map values that are not what they should be", () => {
    const loaded = folderSidebarDataOf({
      pinned: ["A", 3, null, "B"],
      recent: ["R", {}],
      recentColors: ["#fff", 1],
      folderColors: { A: "#fff", B: 4, C: null },
      expanded: { A: true, B: false, C: "yes", D: 1 },
    });
    expect(loaded.pinned).toEqual(["A", "B"]);
    expect(loaded.recent).toEqual(["R"]);
    expect(loaded.recentColors).toEqual(["#fff"]);
    expect(loaded.folderColors).toEqual({ A: "#fff" });
    expect(loaded.expanded).toEqual({ A: true });
  });

  it("drops keys it does not know, such as the old colour migration flag", () => {
    const loaded = folderSidebarDataOf({
      colorsMigrated: true,
      somethingNew: 1,
      showCounts: false,
    });
    expect(loaded).not.toHaveProperty("colorsMigrated");
    expect(loaded).not.toHaveProperty("somethingNew");
    expect(loaded.showCounts).toBe(false);
  });

  it("keeps the old colours as they are (no migration)", () => {
    expect(folderSidebarDataOf({ folderColors: { A: "#4278ff" } }).folderColors).toEqual({
      A: "#4278ff",
    });
  });

  it("shares no list or map with what it was given", () => {
    const stored = {
      pinned: ["A"],
      recent: ["A"],
      recentColors: ["#fff"],
      folderColors: { A: "#fff" },
      expanded: { A: true },
    };
    const loaded = folderSidebarDataOf(stored);
    loaded.pinned.push("B");
    loaded.recent.push("B");
    loaded.recentColors.push("#000");
    loaded.folderColors.B = "#000";
    loaded.expanded.B = true;
    expect(stored).toEqual({
      pinned: ["A"],
      recent: ["A"],
      recentColors: ["#fff"],
      folderColors: { A: "#fff" },
      expanded: { A: true },
    });
  });
});
