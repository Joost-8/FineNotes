import { describe, expect, it } from "vitest";
import type { InkDocument, Page } from "../../src/model/document";
import {
  fileName,
  folderRows,
  notebookImages,
  pagesDetail,
  parseFileKind,
  recordingTranscripts,
} from "../../src/model/notebook-files";

function page(id: string, images: string[] = [], pdf?: string): Page {
  return {
    id,
    kind: "ink",
    geometry: { width: 100, height: 140 },
    backdrop: pdf ? { kind: "pdf", path: pdf, page: 0 } : { kind: "plain" },
    strokes: [],
    images: images.map((path, i) => ({ id: `${id}-i${i}`, path, x: 0, y: 0, w: 10, h: 10 })),
    textBoxes: [],
  } as unknown as Page;
}

function doc(pages: Page[], recordings: unknown[] = []): InkDocument {
  return {
    version: 3,
    view: { scrollY: 0, width: 100, scale: 1 },
    pages,
    recordings,
  } as unknown as InkDocument;
}

describe("notebookImages", () => {
  it("lists each picture and PDF once, in order, with its pages", () => {
    const rows = notebookImages(
      doc([
        page("p1", ["A/board.jpg"], "A/slides.pdf"),
        page("p2", ["A/board.jpg", "A/board.jpg"], "A/slides.pdf"),
        page("p3", ["A/photo.png"]),
      ]),
    );
    expect(rows).toEqual([
      { path: "A/slides.pdf", detail: "Pages 1, 2", page: 0 },
      { path: "A/board.jpg", detail: "Pages 1, 2", page: 0 },
      { path: "A/photo.png", detail: "Page 3", page: 2 },
    ]);
    expect(notebookImages(doc([page("p1")]))).toEqual([]);
  });
});

describe("recordingTranscripts", () => {
  it("lists the transcripts of recordings, newest first, each once", () => {
    const rows = recordingTranscripts(
      doc(
        [page("p1")],
        [
          { id: "r1", path: "R/1.m4a", transcript: "T/1 transcript.md" },
          { id: "r2", path: "R/2.m4a" },
          { id: "r3", path: "R/3.m4a", transcript: "T/3 transcript.md" },
        ],
      ),
    );
    expect(rows.map((row) => row.path)).toEqual(["T/3 transcript.md", "T/1 transcript.md"]);
    expect(recordingTranscripts({ ...doc([]), recordings: undefined })).toEqual([]);
  });
});

describe("folderRows", () => {
  it("keeps the asked extensions, newest first", () => {
    const rows = folderRows(
      [
        { path: "E/old.pdf", extension: "pdf", mtime: 1 },
        { path: "E/notes.md", extension: "md", mtime: 3 },
        { path: "E/new.PDF", extension: "PDF", mtime: 2 },
      ],
      ["pdf"],
      (mtime) => `t${mtime}`,
    );
    expect(rows).toEqual([
      { path: "E/new.PDF", detail: "t2" },
      { path: "E/old.pdf", detail: "t1" },
    ]);
  });
});

describe("the small parts", () => {
  it("names pages, files and kinds", () => {
    expect(pagesDetail([])).toBe("");
    expect(pagesDetail([0, 1, 2, 3, 4])).toBe("Pages 1, 2, 3 and 2 more");
    expect(fileName("A/B/c.png")).toBe("c.png");
    expect(fileName("c.png")).toBe("c.png");
    expect(parseFileKind("chats")).toBe("chats");
    expect(parseFileKind("audio")).toBe("recordings");
    expect(parseFileKind(undefined)).toBe("recordings");
  });
});
