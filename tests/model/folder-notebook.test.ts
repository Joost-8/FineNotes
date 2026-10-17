import { describe, expect, it } from "vitest";
import {
  folderNotebookName,
  followPairRename,
  isFolderNotebook,
  ownFolderIcon,
} from "../../src/model/folder-notebook";

const file = (name: string) => ({ name, folder: false });
const dir = (name: string) => ({ name, folder: true });

describe("folderNotebookName", () => {
  it("finds the file named after its folder, a notebook before a page", () => {
    const entries = [dir("Images"), file("physics.page.md"), file("Physics.notebook.md")];
    expect(folderNotebookName("Physics", entries)).toBe("Physics.notebook.md");
    expect(folderNotebookName("Old", [file("old.ink.md")])).toBe("old.ink.md");
  });

  it("is undefined without one, and never takes a folder or a plain note", () => {
    expect(folderNotebookName("Physics", [dir("Physics.notebook.md"), file("Physics.md")])).toBe(
      undefined,
    );
    expect(folderNotebookName("", [file(".notebook.md")])).toBe(undefined);
  });
});

describe("isFolderNotebook", () => {
  it("is a notebook inside a folder of its name", () => {
    expect(isFolderNotebook("School/Physics/Physics.notebook.md")).toBe(true);
    expect(isFolderNotebook("physics/PHYSICS.page.md")).toBe(true);
    expect(isFolderNotebook("School/Physics.notebook.md")).toBe(false);
    expect(isFolderNotebook("Physics.notebook.md")).toBe(false);
    expect(isFolderNotebook("Physics/Physics.md")).toBe(false);
  });
});

describe("ownFolderIcon", () => {
  it("gives the notebook's own folders an icon, in any case, and nothing else one", () => {
    expect(ownFolderIcon("Images")).toBe("image");
    expect(ownFolderIcon("recordings")).toBe("mic");
    expect(ownFolderIcon("AI chats")).toBe("message-square");
    expect(ownFolderIcon("Homework")).toBeUndefined();
    expect(ownFolderIcon("toString")).toBeUndefined();
  });
});

describe("followPairRename", () => {
  it("renames the notebook after its renamed folder", () => {
    const entries = [file("Physics.notebook.md"), dir("Images")];
    expect(followPairRename("School/Physics", "School/Mechanics", true, entries)).toEqual({
      from: "School/Mechanics/Physics.notebook.md",
      to: "School/Mechanics/Mechanics.notebook.md",
    });
  });

  it("renames the folder after its renamed notebook", () => {
    const entries = [file("Mechanics.notebook.md"), dir("Images")];
    expect(
      followPairRename(
        "School/Physics/Physics.notebook.md",
        "School/Physics/Mechanics.notebook.md",
        false,
        entries,
      ),
    ).toEqual({ from: "School/Physics", to: "School/Mechanics" });
    expect(followPairRename("P/P.page.md", "P/Q.page.md", false, [])).toEqual({
      from: "P",
      to: "Q",
    });
  });

  it("does nothing for its own follow-up renames, so they never loop", () => {
    // After the folder rename, the notebook's rename already agrees.
    expect(
      followPairRename("M/Physics.notebook.md", "M/M.notebook.md", false, [file("M.notebook.md")]),
    ).toBeUndefined();
    // After the notebook rename, the folder holds a notebook of the new name.
    expect(
      followPairRename("School/Physics", "School/Mechanics", true, [file("Mechanics.notebook.md")]),
    ).toBeUndefined();
  });

  it("leaves moves, case changes, other notes and taken names alone", () => {
    const entries = [file("Physics.notebook.md")];
    expect(followPairRename("A/Physics", "B/Physics", true, entries)).toBeUndefined();
    expect(followPairRename("A/Physics", "A/physics", true, entries)).toBeUndefined();
    expect(
      followPairRename("P/P.notebook.md", "Q/P.notebook.md", false, [file("P.notebook.md")]),
    ).toBeUndefined();
    expect(followPairRename("P/Other.notebook.md", "P/New.notebook.md", false, [])).toBeUndefined();
    expect(followPairRename("P/P.notebook.md", "P/P.md", false, [])).toBeUndefined();
    expect(
      followPairRename("A/Physics", "A/Mechanics", true, [
        file("Physics.notebook.md"),
        file("Mechanics.notebook.md"),
      ]),
    ).toBeUndefined();
    expect(followPairRename("A/Physics", "A/Mechanics", true, [dir("Images")])).toBeUndefined();
  });
});
