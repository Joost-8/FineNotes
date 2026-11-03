import { describe, expect, it } from "vitest";
import {
  folderNotebookName,
  followPairRename,
  isFolderNotebook,
  isNotebookOwnFolder,
  outsideNotebookFolder,
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

describe("outsideNotebookFolder", () => {
  const notebooks = new Set(["Untitled notebook", "MVKN90/MVKN90 - Föreläsningar"]);
  const isNotebook = (path: string) => notebooks.has(path);

  it("steps out of a notebook's own folder to the folder it lives in (#43)", () => {
    expect(outsideNotebookFolder("Untitled notebook", isNotebook)).toBe("");
    expect(outsideNotebookFolder("MVKN90/MVKN90 - Föreläsningar", isNotebook)).toBe("MVKN90");
  });

  it("steps out from inside one, such as its AI chats or Exports", () => {
    expect(outsideNotebookFolder("MVKN90/MVKN90 - Föreläsningar/AI chats", isNotebook)).toBe(
      "MVKN90",
    );
    expect(outsideNotebookFolder("Untitled notebook/Exports/Week 1", isNotebook)).toBe("");
  });

  it("leaves any other folder, and the root, as it is", () => {
    expect(outsideNotebookFolder("MVKN90", isNotebook)).toBe("MVKN90");
    expect(outsideNotebookFolder("Lectures/Week 1", isNotebook)).toBe("Lectures/Week 1");
    expect(outsideNotebookFolder("", isNotebook)).toBe("");
  });

  it("steps out of the deepest notebook folder only", () => {
    const nested = (path: string) => path === "Course" || path === "Course/Week";
    expect(outsideNotebookFolder("Course/Week/Images", nested)).toBe("Course");
  });
});

describe("outsideNotebookFolder in the user's own folders", () => {
  // The vault: "Uni" holds "Uni.page.md" and the plain folder "Math";
  // "Physics" is a notebook's own folder; "Old" holds a legacy "Old.ink.md".
  const notebooks = new Set(["Uni", "Physics", "Old"]);
  const isNotebook = (path: string) => notebooks.has(path);

  it("leaves a plain folder inside a folder that holds a notebook of its name", () => {
    expect(outsideNotebookFolder("Uni/Math", isNotebook)).toBe("Uni/Math");
    expect(outsideNotebookFolder("Uni/Math/Week 1", isNotebook)).toBe("Uni/Math/Week 1");
    expect(outsideNotebookFolder("Physics/Handouts", isNotebook)).toBe("Physics/Handouts");
    expect(outsideNotebookFolder("Old/Archive", isNotebook)).toBe("Old/Archive");
  });

  it("still steps out of the notebook's own folder and its folders for files", () => {
    expect(outsideNotebookFolder("Uni", isNotebook)).toBe("");
    expect(outsideNotebookFolder("Physics/Images", isNotebook)).toBe("");
    expect(outsideNotebookFolder("Physics/recordings", isNotebook)).toBe("");
    expect(outsideNotebookFolder("Old/Transcripts/2025", isNotebook)).toBe("");
  });

  it("does not take a folder for files of a folder that is no notebook's", () => {
    expect(outsideNotebookFolder("Lectures/Images", isNotebook)).toBe("Lectures/Images");
    expect(outsideNotebookFolder("Uni/Math/Exports", isNotebook)).toBe("Uni/Math/Exports");
  });
});

describe("isNotebookOwnFolder", () => {
  it("is a folder holding the notebook of its name and its files", () => {
    expect(isNotebookOwnFolder("Physics", [file("Physics.notebook.md"), dir("Images")])).toBe(true);
    expect(isNotebookOwnFolder("Uni", [file("Uni.page.md"), dir("Math")])).toBe(true);
    expect(isNotebookOwnFolder("Old", [file("Old.ink.md"), file("a.png")])).toBe(true);
  });

  it("is not a folder without that notebook", () => {
    expect(isNotebookOwnFolder("Lectures", [file("Week 1.notebook.md")])).toBe(false);
    expect(isNotebookOwnFolder("Notes", [file("Notes.md")])).toBe(false);
  });

  it("is not a folder that holds other notebooks too (made without folders of their own)", () => {
    const entries = [file("Uni.page.md"), file("Algebra.notebook.md"), dir("Images")];
    expect(isNotebookOwnFolder("Uni", entries)).toBe(false);
    expect(
      outsideNotebookFolder("Uni", (path) => path === "Uni" && isNotebookOwnFolder("Uni", entries)),
    ).toBe("Uni");
  });
});
