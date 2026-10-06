/**
 * `src/model/moved-files.ts` — a note's PDF pages, pictures, recordings and
 * folders follow their files when they move in the vault (#14).
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import {
  MOVE_LOG_LIMIT,
  cleanMoveLog,
  followMoves,
  movedTarget,
  recordMove,
  relinkDocument,
} from "../../src/model/moved-files";

describe("recordMove", () => {
  it("appends a move", () => {
    expect(recordMove([], "a.pdf", "Courses/a.pdf")).toEqual([
      { from: "a.pdf", to: "Courses/a.pdf" },
    ]);
  });

  it("ignores a move onto itself and empty paths", () => {
    expect(recordMove([], "a.pdf", "a.pdf")).toEqual([]);
    expect(recordMove([], "", "b.pdf")).toEqual([]);
  });

  it("forgets earlier moves away from where something arrives now", () => {
    let log = recordMove([], "x.pdf", "old/x.pdf");
    log = recordMove(log, "Lectures/a.pdf", "Lectures/b.pdf");
    log = recordMove(log, "new.pdf", "x.pdf");
    expect(log).toEqual([
      { from: "Lectures/a.pdf", to: "Lectures/b.pdf" },
      { from: "new.pdf", to: "x.pdf" },
    ]);
    // A folder arriving covers the moves of everything that was inside it.
    expect(recordMove(log, "Elsewhere", "Lectures")).toEqual([
      { from: "new.pdf", to: "x.pdf" },
      { from: "Elsewhere", to: "Lectures" },
    ]);
  });

  it("keeps only the newest moves", () => {
    let log: ReturnType<typeof recordMove> = [];
    for (let i = 0; i <= MOVE_LOG_LIMIT; i++) log = recordMove(log, `f${i}.pdf`, `g${i}.pdf`);
    expect(log).toHaveLength(MOVE_LOG_LIMIT);
    expect(log[0]).toEqual({ from: "f1.pdf", to: "g1.pdf" });
  });

  it("drops entries that are not moves", () => {
    const stored: unknown[] = [
      null,
      3,
      { from: "a" },
      { from: "a", to: "a" },
      { from: "a", to: "b" },
    ];
    expect(recordMove(stored, "c", "d")).toEqual([
      { from: "a", to: "b" },
      { from: "c", to: "d" },
    ]);
    expect(cleanMoveLog("nope")).toEqual([]);
  });
});

describe("followMoves", () => {
  it("follows a file and the folder it is in", () => {
    const log = [
      { from: "Inbox", to: "Courses/2IL50" },
      { from: "Courses/2IL50/w1.pdf", to: "Courses/2IL50/Week 1.pdf" },
    ];
    expect(followMoves(log, "Inbox/w1.pdf")).toBe("Courses/2IL50/Week 1.pdf");
    expect(followMoves(log, "Inbox/w2.pdf")).toBe("Courses/2IL50/w2.pdf");
  });

  it("does not take a folder for a name it is only the start of", () => {
    expect(followMoves([{ from: "Inbox", to: "Done" }], "Inbox2/a.pdf")).toBe("Inbox2/a.pdf");
  });

  it("ends where a move and its move back end, without looping", () => {
    const log = [
      { from: "a.pdf", to: "b.pdf" },
      { from: "b.pdf", to: "a.pdf" },
    ];
    expect(followMoves(log, "a.pdf")).toBe("a.pdf");
  });

  it("ignores moves made before the file got there", () => {
    // `b.pdf` moved away first; only later did `a.pdf` become `b.pdf`.
    const log = [
      { from: "b.pdf", to: "gone.pdf" },
      { from: "a.pdf", to: "b.pdf" },
    ];
    expect(followMoves(log, "a.pdf")).toBe("b.pdf");
  });
});

describe("movedTarget", () => {
  const log = [{ from: "a.pdf", to: "Courses/a.pdf" }];

  it("relinks a missing file to where it moved", () => {
    const exists = (path: string) => path === "Courses/a.pdf";
    expect(movedTarget(log, exists, "a.pdf")).toBe("Courses/a.pdf");
  });

  it("leaves a path whose file is still there", () => {
    expect(movedTarget(log, () => true, "a.pdf")).toBeUndefined();
  });

  it("leaves a path when the move leads nowhere", () => {
    expect(movedTarget(log, () => false, "a.pdf")).toBeUndefined();
    expect(movedTarget(log, () => false, "other.pdf")).toBeUndefined();
    expect(movedTarget(log, () => false, "")).toBeUndefined();
  });
});

describe("relinkDocument", () => {
  function noteWithEverything(): InkDocument {
    const doc = emptyDocument();
    const pdf = blankPage("p2");
    pdf.backdrop = { kind: "pdf", path: "a.pdf", page: 3 };
    pdf.images.push({ id: "i1", path: "Pics/x.png", x: 0, y: 0, w: 10, h: 10 });
    doc.pages.push(pdf);
    doc.recordings = [
      { id: "r1", path: "Audio/r.m4a", start: 0, duration: 1, transcript: "Audio/r.md" },
      { id: "r2", path: "Audio/s.m4a", start: 0, duration: 1 },
    ];
    doc.folders = { images: "Pics", audio: "Audio" };
    return doc;
  }

  it("rewrites every path the note holds that has a new place", () => {
    const doc = noteWithEverything();
    const moves: Record<string, string> = {
      "a.pdf": "Courses/a.pdf",
      "Pics/x.png": "Images/x.png",
      "Audio/r.m4a": "Rec/r.m4a",
      "Audio/r.md": "Rec/r.md",
      Pics: "Images",
    };
    expect(relinkDocument(doc, (path) => moves[path])).toBe(5);
    expect(doc.pages[1].backdrop).toEqual({ kind: "pdf", path: "Courses/a.pdf", page: 3 });
    expect(doc.pages[1].images[0].path).toBe("Images/x.png");
    expect(doc.recordings?.[0]).toMatchObject({ path: "Rec/r.m4a", transcript: "Rec/r.md" });
    expect(doc.recordings?.[1].path).toBe("Audio/s.m4a");
    expect(doc.folders).toEqual({ images: "Images", audio: "Audio" });
  });

  it("keeps the objects, so commands holding them see the new path", () => {
    const doc = noteWithEverything();
    const image = doc.pages[1].images[0];
    const backdrop = doc.pages[1].backdrop;
    relinkDocument(doc, (path) => `moved/${path}`);
    expect(doc.pages[1].images[0]).toBe(image);
    expect(doc.pages[1].backdrop).toBe(backdrop);
    expect(image.path).toBe("moved/Pics/x.png");
  });

  it("changes nothing when nothing moved", () => {
    const doc = noteWithEverything();
    const before = JSON.stringify(doc);
    expect(relinkDocument(doc, () => undefined)).toBe(0);
    expect(relinkDocument(doc, (path) => path)).toBe(0);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
