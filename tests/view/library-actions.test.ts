/**
 * The library's Move, Duplicate and Delete (library-actions.ts) against a
 * vault in memory: a notebook with a folder of its own moves, copies and
 * goes with that folder, and a folder's other files are never deleted.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { notices, resetFakes } = await import("./fake-obsidian");
const { LibraryActions } = await import("../../src/view/library-actions");
const { memoryVault } = await import("./memory-vault");

const isNotebook = (path: string) => /\.(notebook|page|ink)\.md$/i.test(path);

/** `Physics` made with the "own folder" setting, in `dir`. */
function physics(dir: string): string[] {
  const at = dir ? `${dir}/Physics` : "Physics";
  return [
    `${at}/Physics.notebook.md`,
    `${at}/Images/photo.png`,
    `${at}/Recordings/`,
    `${at}/Transcripts/`,
    `${at}/AI chats/`,
    `${at}/Exports/`,
  ];
}

function setUp(paths: string[], answer = true) {
  resetFakes();
  const vault = memoryVault(paths);
  const asked: { title: string; message: string }[] = [];
  const actions = new LibraryActions(vault.app as never, isNotebook, async (question) => {
    asked.push(question);
    return answer;
  });
  return { ...vault, actions, asked };
}

describe("Move (menu, drag and drop, several at once)", () => {
  it("moves a notebook's own folder with it", async () => {
    const { actions, files } = setUp([...physics(""), "Uni/"]);
    expect(actions.unit("Physics/Physics.notebook.md")).toBe("Physics");
    expect(await actions.move("Physics/Physics.notebook.md", "Uni")).toBe(true);
    expect(files()).toEqual(["Uni/Physics/Images/photo.png", "Uni/Physics/Physics.notebook.md"]);
  });

  it("moves a plain notebook alone", async () => {
    const { actions, files } = setUp(["Uni/Algebra.notebook.md", "Uni/Syllabus.md", "Old/"]);
    expect(await actions.move("Uni/Algebra.notebook.md", "Old")).toBe(true);
    expect(files()).toEqual(["Old/Algebra.notebook.md", "Uni/Syllabus.md"]);
  });

  it("moves a notebook out of a folder it is shown above (the library hoists lone notebooks)", async () => {
    const { actions, files } = setUp(["A/B/Algebra.notebook.md"]);
    expect(await actions.move("A/B/Algebra.notebook.md", "A")).toBe(true);
    expect(files()).toEqual(["A/Algebra.notebook.md"]);
  });

  it("does nothing where it already is, and refuses a folder into itself or a taken name", async () => {
    const { actions, files } = setUp([...physics("Uni"), "Uni/Sub/", "Physics/"]);
    expect(await actions.move("Uni/Physics/Physics.notebook.md", "Uni")).toBe(false);
    expect(await actions.move("Uni", "Uni/Sub")).toBe(false);
    expect(notices.at(-1)?.message).toBe("A folder cannot go inside itself.");
    expect(await actions.move("Uni/Physics/Physics.notebook.md", "")).toBe(false);
    expect(notices.at(-1)?.message).toBe('"Physics" already exists there.');
    expect(files()).toEqual(["Uni/Physics/Images/photo.png", "Uni/Physics/Physics.notebook.md"]);
  });

  it("lets a drag drop the own folder anywhere but where it is and inside itself", () => {
    expect(LibraryActions.canMove("Uni/Physics", "Uni")).toBe(false);
    expect(LibraryActions.canMove("Uni/Physics", "Uni/Physics/Images")).toBe(false);
    expect(LibraryActions.canMove("Uni/Physics", "Uni/Physics")).toBe(false);
    expect(LibraryActions.canMove("Uni/Physics", "")).toBe(true);
    expect(LibraryActions.canMove("Uni/Physics", "Uni/Physics copy")).toBe(true);
  });
});

describe("Duplicate", () => {
  it("copies an own-folder notebook into an own folder of its own, so it stays a notebook", async () => {
    const { actions, files, folders } = setUp(physics("Uni"));
    expect(await actions.duplicate("Uni/Physics/Physics.notebook.md")).toBe(
      "Uni/Physics copy/Physics copy.notebook.md",
    );
    expect(files()).toContain("Uni/Physics copy/Physics copy.notebook.md");
    expect(folders()).toEqual(
      expect.arrayContaining(["Uni/Physics copy/Images", "Uni/Physics copy/Exports"]),
    );
    // The original's folder still holds one notebook.
    expect(files().filter((p) => p.startsWith("Uni/Physics/") && isNotebook(p))).toEqual([
      "Uni/Physics/Physics.notebook.md",
    ]);
  });

  it("copies a plain notebook beside it", async () => {
    const { actions, files } = setUp(["Sketch.page.md"]);
    await actions.duplicate("Sketch.page.md");
    expect(files()).toEqual(["Sketch copy.page.md", "Sketch.page.md"]);
  });
});

describe("Delete", () => {
  it("asks once, then trashes a notebook's own folder whole", async () => {
    const { actions, files, trashed, asked } = setUp([...physics(""), "Notes.md"]);
    expect(await actions.trash([{ path: "Physics/Physics.notebook.md", folder: false }])).toBe(
      true,
    );
    expect(asked).toEqual([
      { title: 'Delete "Physics"?', message: '"Physics" will be deleted, with its files.' },
    ]);
    expect(trashed).toEqual(["Physics"]);
    expect(files()).toEqual(["Notes.md"]);
  });

  it("trashes nothing when the answer is no", async () => {
    const { actions, files } = setUp(physics(""), false);
    expect(await actions.trash([{ path: "Physics/Physics.notebook.md", folder: false }])).toBe(
      false,
    );
    expect(files()).toHaveLength(2);
  });
});

describe("Delete on a folder tile, and of several at once", () => {
  it("trashes a folder of notebooks whole", async () => {
    const { actions, files, trashed } = setUp([...physics("Uni"), "Uni/Algebra.notebook.md"]);
    expect(await actions.trash([{ path: "Uni", folder: true }])).toBe(true);
    expect(trashed).toEqual(["Uni"]);
    expect(files()).toEqual([]);
  });

  it("trashes only the notebooks of a folder that holds the user's other notes, and says so", async () => {
    const { actions, files, asked } = setUp([
      ...physics("Uni"),
      "Uni/Algebra.notebook.md",
      "Uni/Syllabus.md",
      "Uni/Week 1/Reading.pdf",
    ]);
    expect(await actions.trash([{ path: "Uni", folder: true }])).toBe(true);
    expect(files()).toEqual(["Uni/Syllabus.md", "Uni/Week 1/Reading.pdf"]);
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toContain("2 other files stay where they are.");
  });

  it("asks one question for several picked items, naming them", async () => {
    const { actions, files, asked } = setUp([
      ...physics(""),
      "Algebra.notebook.md",
      "Chem.page.md",
      "Notes.md",
    ]);
    await actions.trash([
      { path: "Physics/Physics.notebook.md", folder: false },
      { path: "Algebra.notebook.md", folder: false },
      { path: "Chem.page.md", folder: false },
    ]);
    expect(asked).toEqual([
      {
        title: "Delete 3 notebooks?",
        message: '"Algebra", "Chem" and "Physics" will be deleted, with their files.',
      },
    ]);
    expect(files()).toEqual(["Notes.md"]);
  });
});
