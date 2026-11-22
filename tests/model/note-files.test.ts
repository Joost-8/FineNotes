import { describe, expect, it } from "vitest";
import {
  followNoteRename,
  holdsNoteFiles,
  isTextNotePath,
  latestTranscriptPath,
  movedPath,
  noteFilesFolder,
  noteFilesSubfolder,
  relinkNotePaths,
} from "../../src/model/note-files";
import { textBlock, type TextNote } from "../../src/model/text-note";

describe("where a note keeps its files", () => {
  it("is a folder beside the note, named as a notebook's own folders are", () => {
    expect(noteFilesFolder("Uni/Physics.note.md")).toBe("Uni/Physics");
    expect(noteFilesFolder("Physics.note.md")).toBe("Physics");
    expect(noteFilesSubfolder("Uni/Physics.note.md", "images")).toBe("Uni/Physics/Images");
    expect(noteFilesSubfolder("Uni/Physics.note.md", "audio")).toBe("Uni/Physics/Recordings");
    expect(noteFilesSubfolder("Uni/Physics.note.md", "transcripts")).toBe(
      "Uni/Physics/Transcripts",
    );
    expect(noteFilesSubfolder("Uni/Physics.note.md", "chats")).toBe("Uni/Physics/AI chats");
  });

  it("is nothing for a file that is no text note", () => {
    expect(isTextNotePath("Uni/Physics.notebook.md")).toBe(false);
    expect(isTextNotePath(".note.md")).toBe(false);
    expect(isTextNotePath("A.NOTE.MD")).toBe(true);
    expect(noteFilesFolder("Uni/Physics.notebook.md")).toBe("");
    expect(noteFilesSubfolder("x.md", "images")).toBe("");
  });

  it("is told from the user's own folder of that name by what is in it", () => {
    expect(holdsNoteFiles(["Images", "x.md"])).toBe(true);
    expect(holdsNoteFiles(["recordings"])).toBe(true);
    expect(holdsNoteFiles(["Drafts", "x.md"])).toBe(false);
    expect(holdsNoteFiles([])).toBe(false);
  });
});

describe("a note's files follow it", () => {
  const ours = new Set(["Uni/Physics", "Physics"]);
  const isOurs = (path: string): boolean => ours.has(path);
  const none = (): boolean => false;

  it("when it is renamed or moved", () => {
    expect(followNoteRename("Uni/Physics.note.md", "Uni/Mechanics.note.md", isOurs, none)).toEqual({
      from: "Uni/Physics",
      to: "Uni/Mechanics",
    });
    expect(followNoteRename("Uni/Physics.note.md", "Old/Physics.note.md", isOurs, none)).toEqual({
      from: "Uni/Physics",
      to: "Old/Physics",
    });
    expect(followNoteRename("Physics.note.md", "Uni/Physics.note.md", isOurs, none)).toEqual({
      from: "Physics",
      to: "Uni/Physics",
    });
  });

  it("only when the case changes, even though the new name looks taken", () => {
    expect(
      followNoteRename("Uni/Physics.note.md", "Uni/physics.note.md", isOurs, () => true),
    ).toEqual({ from: "Uni/Physics", to: "Uni/physics" });
  });

  it("not when its folder is the user's, the name is taken, or it is no note", () => {
    expect(followNoteRename("Uni/Physics.note.md", "Uni/M.note.md", none, none)).toBeUndefined();
    expect(
      followNoteRename("Uni/Physics.note.md", "Uni/M.note.md", isOurs, () => true),
    ).toBeUndefined();
    expect(followNoteRename("Uni/Physics.note.md", "Uni/Physics.md", isOurs, none)).toBeUndefined();
    expect(
      followNoteRename("Uni/Physics.note.md", "Uni/Physics.note.md", isOurs, none),
    ).toBeUndefined();
    expect(
      followNoteRename("Uni/Physics.note.md", "Uni/physics.note.md", none, () => true),
    ).toBeUndefined();
  });

  it("and the paths inside a moved folder move with it", () => {
    expect(movedPath("Uni/Physics/Images/a.png", "Uni/Physics", "Uni/M")).toBe(
      "Uni/M/Images/a.png",
    );
    expect(movedPath("Uni/Physics", "Uni/Physics", "Uni/M")).toBe("Uni/M");
    expect(movedPath("Uni/Physics2/a.png", "Uni/Physics", "Uni/M")).toBeUndefined();
    expect(movedPath("a.png", "", "x")).toBeUndefined();
    expect(movedPath("a.png", "a.png", "a.png")).toBeUndefined();
  });

  it("the note's pictures and recordings are pointed at the new paths", () => {
    const note: TextNote = {
      blocks: [
        textBlock("t", "body", [{ text: "Uni/Physics/Images/a.png", marks: 0 }]),
        { type: "image", id: "i", path: "Uni/Physics/Images/a.png", width: 300 },
        { type: "audio", id: "a", path: "Uni/Physics/Recordings/r.m4a", duration: 5000 },
        { type: "image", id: "j", path: "Elsewhere/b.png" },
      ],
    };
    const next = relinkNotePaths(note, (path) => movedPath(path, "Uni/Physics", "Uni/M"));
    expect(next?.blocks[0]).toBe(note.blocks[0]);
    expect(next?.blocks[1]).toEqual({
      type: "image",
      id: "i",
      path: "Uni/M/Images/a.png",
      width: 300,
    });
    expect(next?.blocks[2]).toEqual({
      type: "audio",
      id: "a",
      path: "Uni/M/Recordings/r.m4a",
      duration: 5000,
    });
    expect(next?.blocks[3]).toBe(note.blocks[3]);
    expect(relinkNotePaths(note, () => undefined)).toBeNull();
    expect(relinkNotePaths(note, (path) => path)).toBeNull();
  });
});

describe("a recording's transcript", () => {
  it("is the newest of the names transcripts take", () => {
    const files = new Set([
      "N/Transcripts/Rec 1 transcript.md",
      "N/Transcripts/Rec 1 transcript 1.md",
      "N/Transcripts/Rec 1 transcript 2.md",
    ]);
    const exists = (path: string): boolean => files.has(path);
    expect(latestTranscriptPath("N/Recordings/Rec 1.m4a", "N/Transcripts", exists)).toBe(
      "N/Transcripts/Rec 1 transcript 2.md",
    );
    expect(latestTranscriptPath("N/Recordings/Rec 2.m4a", "N/Transcripts", exists)).toBeUndefined();
    // With no folder, beside the recording.
    expect(
      latestTranscriptPath(
        "N/Recordings/Rec 1.m4a",
        undefined,
        (p) => p === "N/Recordings/Rec 1 transcript.md",
      ),
    ).toBe("N/Recordings/Rec 1 transcript.md");
  });
});
