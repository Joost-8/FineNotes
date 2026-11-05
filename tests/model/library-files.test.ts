import { describe, expect, it } from "vitest";
import {
  duplicatePlan,
  notebookOwnedFiles,
  notebookUnit,
  trashPlan,
  trashQuestion,
} from "../../src/model/library-files";

const isNotebook = (path: string) => /\.(notebook|page|ink)\.md$/i.test(path);

/** A notebook made with the "own folder" setting: the note and its five folders' files. */
function ownFolder(dir: string, title: string, extra: string[] = []): string[] {
  const folder = dir ? `${dir}/${title}` : title;
  return [
    `${folder}/${title}.notebook.md`,
    `${folder}/Images/photo.png`,
    `${folder}/Recordings/lecture.webm`,
    `${folder}/Transcripts/lecture transcript.md`,
    `${folder}/AI chats/chat.md`,
    `${folder}/Exports/${title}.pdf`,
    ...extra.map((name) => `${folder}/${name}`),
  ];
}

describe("notebookUnit", () => {
  it("is the own folder of a notebook in one", () => {
    const files = ownFolder("Uni", "Physics");
    expect(notebookUnit("Uni/Physics/Physics.notebook.md", files, isNotebook)).toBe("Uni/Physics");
    expect(notebookUnit("Physics/Physics.page.md", ["Physics/Physics.page.md"], isNotebook)).toBe(
      "Physics",
    );
  });

  it("is the note itself when it has no folder of its own", () => {
    expect(notebookUnit("Uni/Physics.notebook.md", ["Uni/Physics.notebook.md"], isNotebook)).toBe(
      "Uni/Physics.notebook.md",
    );
  });

  it("is the note when its namesake folder holds other notebooks too", () => {
    const files = ["Physics/Physics.notebook.md", "Physics/Week 2/Optics.notebook.md"];
    expect(notebookUnit("Physics/Physics.notebook.md", files, isNotebook)).toBe(
      "Physics/Physics.notebook.md",
    );
  });
});

describe("notebookOwnedFiles", () => {
  it("holds what a notebook's own folder holds for it, not the notebook", () => {
    const files = ownFolder("Uni", "Physics", ["Physics.transcript.md"]);
    const owned = notebookOwnedFiles(files, isNotebook);
    expect([...owned].sort()).toEqual(
      files.filter((p) => p !== "Uni/Physics/Physics.notebook.md").sort(),
    );
  });

  it("leaves the user's own files in that folder, and every file elsewhere", () => {
    const files = [
      ...ownFolder("Uni", "Physics", ["Syllabus.pdf", "Week 1/notes.md"]),
      "Uni/Images/diagram.png",
      "Uni/Algebra.notebook.md",
    ];
    const owned = notebookOwnedFiles(files, isNotebook);
    expect(owned.has("Uni/Physics/Images/photo.png")).toBe(true);
    expect(owned.has("Uni/Physics/Syllabus.pdf")).toBe(false);
    expect(owned.has("Uni/Physics/Week 1/notes.md")).toBe(false);
    expect(owned.has("Uni/Images/diagram.png")).toBe(false);
  });

  it("owns nothing for a namesake folder that holds other notebooks too", () => {
    const files = [
      "Physics/Physics.notebook.md",
      "Physics/Images/photo.png",
      "Physics/Week 2/Optics.notebook.md",
    ];
    expect(notebookOwnedFiles(files, isNotebook).size).toBe(0);
  });
});

describe("trashPlan", () => {
  it("takes a notebook's own folder whole", () => {
    const files = [...ownFolder("Uni", "Physics"), "Uni/Algebra.notebook.md"];
    const plan = trashPlan(
      [{ path: "Uni/Physics/Physics.notebook.md", folder: false }],
      files,
      isNotebook,
    );
    expect(plan).toEqual({
      trash: ["Uni/Physics"],
      notebooks: ["Uni/Physics/Physics.notebook.md"],
      files: [],
      kept: 0,
    });
  });

  it("leaves the user's own notes in a notebook's folder, and the folder with them", () => {
    const files = ownFolder("", "Physics", ["Physics.transcript.md", "My notes.md"]);
    const plan = trashPlan(
      [{ path: "Physics/Physics.notebook.md", folder: false }],
      files,
      isNotebook,
    );
    expect(plan.trash.sort()).toEqual([
      "Physics/AI chats",
      "Physics/Exports",
      "Physics/Images",
      "Physics/Physics.notebook.md",
      "Physics/Physics.transcript.md",
      "Physics/Recordings",
      "Physics/Transcripts",
    ]);
    expect(plan.kept).toBe(1);
  });

  it("takes a plain notebook alone", () => {
    const plan = trashPlan(
      [{ path: "Uni/Algebra.notebook.md", folder: false }],
      ["Uni/Algebra.notebook.md", "Uni/Syllabus.md"],
      isNotebook,
    );
    expect(plan).toEqual({
      trash: ["Uni/Algebra.notebook.md"],
      notebooks: ["Uni/Algebra.notebook.md"],
      files: [],
      kept: 0,
    });
  });

  it("takes a folder of notebooks whole", () => {
    const files = [...ownFolder("Uni", "Physics"), "Uni/Algebra.notebook.md"];
    const plan = trashPlan([{ path: "Uni", folder: true }], files, isNotebook);
    expect(plan.trash).toEqual(["Uni"]);
    expect(plan.notebooks.sort()).toEqual([
      "Uni/Algebra.notebook.md",
      "Uni/Physics/Physics.notebook.md",
    ]);
  });

  it("takes only the notebooks from a folder that holds other files, and says how many stay", () => {
    const files = [
      ...ownFolder("Uni", "Physics"),
      "Uni/Algebra.notebook.md",
      "Uni/Syllabus.md",
      "Uni/Week 1/Reading.pdf",
      "Uni/Week 1/Chem.notebook.md",
    ];
    const plan = trashPlan([{ path: "Uni", folder: true }], files, isNotebook);
    expect(plan.trash.sort()).toEqual([
      "Uni/Algebra.notebook.md",
      "Uni/Physics",
      "Uni/Week 1/Chem.notebook.md",
    ]);
    expect(plan.kept).toBe(2);
  });

  it("takes an empty folder", () => {
    expect(trashPlan([{ path: "Later", folder: true }], ["Notes.md"], isNotebook).trash).toEqual([
      "Later",
    ]);
  });

  it("lists a picked notebook inside a picked folder once", () => {
    const files = ["Uni/Algebra.notebook.md", "Uni/Chem.notebook.md"];
    const plan = trashPlan(
      [
        { path: "Uni/Algebra.notebook.md", folder: false },
        { path: "Uni", folder: true },
      ],
      files,
      isNotebook,
    );
    expect(plan.trash).toEqual(["Uni"]);
    expect(plan.notebooks).toHaveLength(2);
  });

  it("takes a file of the user's that was picked, and nothing beside it", () => {
    const files = ["Uni/Notes.md", "Uni/Slides.pdf", "Uni/A.notebook.md"];
    expect(trashPlan([{ path: "Uni/Slides.pdf", folder: false }], files, isNotebook)).toEqual({
      trash: ["Uni/Slides.pdf"],
      notebooks: [],
      files: ["Uni/Slides.pdf"],
      kept: 0,
    });
  });

  it("takes nothing that is not in the vault", () => {
    expect(trashPlan([{ path: "Gone.md", folder: false }], [], isNotebook).trash).toEqual([]);
  });

  it("still keeps the user's files in a picked folder unless they were picked too", () => {
    const files = ["F/A.notebook.md", "F/Notes.md", "F/Slides.pdf"];
    const plan = trashPlan(
      [
        { path: "F", folder: true },
        { path: "F/Slides.pdf", folder: false },
      ],
      files,
      isNotebook,
    );
    expect(plan.trash.sort()).toEqual(["F/A.notebook.md", "F/Slides.pdf"]);
    expect(plan.kept).toBe(1);
  });
});

describe("trashQuestion", () => {
  it("names one notebook", () => {
    const q = trashQuestion({
      trash: ["Uni/Physics"],
      notebooks: ["Uni/Physics/Physics.notebook.md"],
      files: [],
      kept: 0,
    });
    expect(q.title).toBe('Delete "Physics"?');
    expect(q.message).toBe('"Physics" will be deleted, with its files.');
  });

  it("names several, and what stays", () => {
    const q = trashQuestion({
      trash: ["Uni/A.notebook.md", "Uni/B.notebook.md"],
      notebooks: ["Uni/A.notebook.md", "Uni/B.notebook.md"],
      files: [],
      kept: 3,
    });
    expect(q.title).toBe("Delete 2 notebooks?");
    expect(q.message).toBe(
      '"A" and "B" will be deleted, with their files. 3 other files stay where they are.',
    );
  });

  it("shortens a long list, A to Z", () => {
    const notebooks = ["F", "B", "C", "D", "E", "A"].map((n) => `${n}.notebook.md`);
    const q = trashQuestion({ trash: notebooks, notebooks, files: [], kept: 1 });
    expect(q.message).toBe(
      '"A", "B", "C" and 3 more will be deleted, with their files. 1 other file stays where it is.',
    );
  });

  it("names a file without promising files of its own", () => {
    const q = trashQuestion({
      trash: ["Uni/Slides.pdf"],
      notebooks: [],
      files: ["Uni/Slides.pdf"],
      kept: 0,
    });
    expect(q.title).toBe('Delete "Slides.pdf"?');
    expect(q.message).toBe('"Slides.pdf" will be deleted.');
  });

  it("counts items, not notebooks, when files are among them", () => {
    const q = trashQuestion({
      trash: ["A.notebook.md", "Notes.md"],
      notebooks: ["A.notebook.md"],
      files: ["Notes.md"],
      kept: 0,
    });
    expect(q.title).toBe("Delete 2 items?");
    expect(q.message).toBe('"A" and "Notes.md" will be deleted, with their files.');
  });

  it("names an empty folder", () => {
    const q = trashQuestion({ trash: ["Later"], notebooks: [], files: [], kept: 0 });
    expect(q.title).toBe('Delete the folder "Later"?');
  });
});

describe("duplicatePlan", () => {
  const taken = (paths: string[]) => (p: string) => paths.includes(p);

  it("copies a plain notebook beside it, keeping its kind", () => {
    expect(duplicatePlan("Uni/Sketch.page.md", "Uni/Sketch.page.md", taken([]))).toEqual({
      folders: [],
      note: "Uni/Sketch copy.page.md",
    });
    expect(
      duplicatePlan("A.notebook.md", "A.notebook.md", taken(["A copy.notebook.md"])).note,
    ).toBe("A copy 2.notebook.md");
  });

  it("gives a copy of an own-folder notebook an own folder beside the original's", () => {
    expect(duplicatePlan("Uni/Physics/Physics.notebook.md", "Uni/Physics", taken([]))).toEqual({
      folders: [
        "Uni/Physics copy",
        "Uni/Physics copy/Images",
        "Uni/Physics copy/Recordings",
        "Uni/Physics copy/Transcripts",
        "Uni/Physics copy/AI chats",
        "Uni/Physics copy/Exports",
      ],
      note: "Uni/Physics copy/Physics copy.notebook.md",
    });
    expect(
      duplicatePlan("Physics/Physics.notebook.md", "Physics", taken(["Physics copy"])).note,
    ).toBe("Physics copy 2/Physics copy 2.notebook.md");
  });
});
