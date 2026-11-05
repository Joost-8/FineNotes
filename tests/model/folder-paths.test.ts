import { describe, expect, it } from "vitest";
import {
  baseName,
  childPath,
  folderKey,
  freePath,
  hasPathSeparator,
  isAttachmentFolderName,
  isHiddenName,
  isInside,
  isRootPath,
  isValidMove,
  openAncestors,
  parentPath,
  remapKeys,
  remapPath,
  remapPathList,
  sameList,
} from "../../src/model/folder-paths";

describe("the vault's root", () => {
  it("is '' or '/', and a folder key is '' for it", () => {
    expect(isRootPath("")).toBe(true);
    expect(isRootPath("/")).toBe(true);
    expect(isRootPath(null)).toBe(true);
    expect(isRootPath(undefined)).toBe(true);
    expect(isRootPath("School")).toBe(false);
    expect(folderKey("/")).toBe("");
    expect(folderKey(undefined)).toBe("");
    expect(folderKey("School/Maths")).toBe("School/Maths");
  });
});

describe("path parts", () => {
  it("finds the parent, the name and a child's path", () => {
    expect(parentPath("School/Maths/Week 1")).toBe("School/Maths");
    expect(parentPath("School")).toBe("");
    expect(baseName("School/Maths")).toBe("Maths");
    expect(baseName("School")).toBe("School");
    expect(childPath("School", "Maths")).toBe("School/Maths");
    expect(childPath("", "Maths")).toBe("Maths");
  });

  it("knows what is inside what", () => {
    expect(isInside("School", "School")).toBe(true);
    expect(isInside("School/Maths", "School")).toBe(true);
    expect(isInside("School2/Maths", "School")).toBe(false);
  });

  it("hides dot names, and Attachments in any case", () => {
    expect(isHiddenName(".obsidian")).toBe(true);
    expect(isHiddenName("notes")).toBe(false);
    expect(isAttachmentFolderName("Attachments")).toBe(true);
    expect(isAttachmentFolderName("attachments")).toBe(true);
    expect(isAttachmentFolderName("Attachments 2")).toBe(false);
  });

  it("refuses folder names with a slash or a backslash", () => {
    expect(hasPathSeparator("a/b")).toBe(true);
    expect(hasPathSeparator("a\\b")).toBe(true);
    expect(hasPathSeparator("a b")).toBe(false);
  });
});

describe("remapKeys (colours and open folders after a rename or a delete)", () => {
  it("moves the folder and everything under it to the new path", () => {
    const colors = {
      School: "red",
      "School/Maths": "blue",
      "School/Maths/Week 1": "green",
      Other: "x",
    };
    expect(remapKeys(colors, "School", "Uni")).toBe(true);
    expect(colors).toEqual({
      Other: "x",
      Uni: "red",
      "Uni/Maths": "blue",
      "Uni/Maths/Week 1": "green",
    });
  });

  it("does not take a folder whose name only starts the same", () => {
    const colors = { School: "red", School2: "blue" };
    remapKeys(colors, "School", "Uni");
    expect(colors).toEqual({ School2: "blue", Uni: "red" });
  });

  it("drops them on a delete", () => {
    const open = { A: true, "A/B": true, C: true };
    expect(remapKeys(open, "A", null)).toBe(true);
    expect(open).toEqual({ C: true });
  });

  it("says nothing changed when nothing matched", () => {
    const open = { A: true };
    expect(remapKeys(open, "Z", "Y")).toBe(false);
    expect(open).toEqual({ A: true });
  });
});

describe("remapPath (the folder the library shows)", () => {
  it("follows a rename of the folder or of one above it", () => {
    expect(remapPath("School/Maths", "School", "Uni")).toBe("Uni/Maths");
    expect(remapPath("School", "School", "Uni")).toBe("Uni");
    expect(remapPath("Other", "School", "Uni")).toBe("Other");
  });

  it("falls back to the folder the deleted one was in", () => {
    expect(remapPath("School/Maths/Week 1", "School/Maths", null)).toBe("School");
    expect(remapPath("School", "School", null)).toBe("");
    expect(remapPath("Other", "School", null)).toBe("Other");
  });
});

describe("remapPathList (pinned and recent folders)", () => {
  it("renames entries in place, keeping the order", () => {
    expect(remapPathList(["A", "B/C", "B", "D"], "B", "E")).toEqual(["A", "E/C", "E", "D"]);
  });

  it("drops the deleted folder and what was in it", () => {
    expect(remapPathList(["A", "B/C", "B", "D"], "B", null)).toEqual(["A", "D"]);
  });

  it("leaves the list it was given alone", () => {
    const list = ["B"];
    remapPathList(list, "B", "C");
    expect(list).toEqual(["B"]);
  });

  it("compares lists", () => {
    expect(sameList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameList(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameList(["a"], ["a", "b"])).toBe(false);
  });
});

describe("isValidMove", () => {
  it("allows a move into another folder, or to the root from a folder", () => {
    expect(isValidMove("School/Maths", "")).toBe(true);
    expect(isValidMove("School/Maths", "Other")).toBe(true);
    expect(isValidMove("Note.md", "School")).toBe(true);
  });

  it("refuses the root itself, the folder it is already in, itself and its own insides", () => {
    expect(isValidMove("", "School")).toBe(false);
    expect(isValidMove("/", "School")).toBe(false);
    expect(isValidMove("School/Maths", "School")).toBe(false);
    expect(isValidMove("Note.md", "")).toBe(false);
    expect(isValidMove("School", "School")).toBe(false);
    expect(isValidMove("School", "School/Maths")).toBe(false);
  });

  it("allows a folder whose name only starts like the source's", () => {
    expect(isValidMove("School", "School2")).toBe(true);
  });

  it("takes '/' for the root", () => {
    expect(isValidMove("School/Maths", "/")).toBe(true);
    expect(isValidMove("Note.md", "/")).toBe(false);
  });
});

describe("openAncestors", () => {
  it("opens every folder above a path, and says whether it opened any", () => {
    const open: Record<string, boolean> = { A: true };
    expect(openAncestors(open, "A/B/C/Note.md")).toBe(true);
    expect(open).toEqual({ A: true, "A/B": true, "A/B/C": true });
    expect(openAncestors(open, "A/B/C/Note.md")).toBe(false);
    expect(openAncestors(open, "Note.md")).toBe(false);
  });
});

describe("freePath", () => {
  it("numbers a name until it is free", () => {
    const taken = new Set(["Untitled.md", "Untitled 1.md", "A/Untitled.md"]);
    const used = (path: string) => taken.has(path);
    expect(freePath("", "Untitled", ".md", used)).toBe("Untitled 2.md");
    expect(freePath("A", "Untitled", ".md", used)).toBe("A/Untitled 1.md");
    expect(freePath("/", "Free", ".pdf", used)).toBe("Free.pdf");
  });
});
