/**
 * `src/model/attachment-folders.ts` — where a note saves its new pictures and
 * recordings. Stored as `meta.folders`; every command undoes to a
 * `JSON.stringify`-identical document (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import {
  SetAttachmentFolder,
  attachmentFolder,
  cleanFolder,
  normalizeAttachmentFolders,
  suggestFolders,
} from "../../src/model/attachment-folders";
import { type InkDocument, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

describe("cleanFolder", () => {
  it("canonicalises a folder path", () => {
    expect(cleanFolder("/Notes//Physics/ ")).toBe("Notes/Physics");
    expect(cleanFolder("Notes\\Audio")).toBe("Notes/Audio");
  });

  it("treats the root, blanks and non-strings as not set", () => {
    for (const value of ["", "/", " ", ".", undefined, null, 3, {}, ["a"]]) {
      expect(cleanFolder(value)).toBeUndefined();
    }
  });

  it("refuses a dot-folder anywhere in the path, which Obsidian does not index", () => {
    expect(cleanFolder(".attachments")).toBeUndefined();
    expect(cleanFolder("Notes/.hidden/Audio")).toBeUndefined();
    expect(cleanFolder("Notes/v1.2")).toBe("Notes/v1.2");
  });
});

describe("normalizeAttachmentFolders", () => {
  it("keeps the known kinds and drops everything else", () => {
    expect(
      normalizeAttachmentFolders({
        images: "A/Img",
        audio: "/B/",
        exports: "C/PDF/",
        video: "C",
        toString: "x",
      }),
    ).toEqual({ images: "A/Img", audio: "B", exports: "C/PDF" });
  });

  it("is undefined when nothing usable is set", () => {
    for (const raw of [undefined, null, "A", [], {}, { images: "" }, { audio: ".x" }]) {
      expect(normalizeAttachmentFolders(raw)).toBeUndefined();
    }
  });

  it("does not resolve inherited members", () => {
    expect(normalizeAttachmentFolders(Object.create({ images: "Inherited" }))).toBeUndefined();
  });
});

describe("attachmentFolder", () => {
  it("reads one kind, and nothing from no document", () => {
    const doc = emptyDocument();
    expect(attachmentFolder(doc, "images")).toBeUndefined();
    doc.folders = { audio: "Rec" };
    expect(attachmentFolder(doc, "audio")).toBe("Rec");
    expect(attachmentFolder(doc, "images")).toBeUndefined();
    expect(attachmentFolder(null, "audio")).toBeUndefined();
  });
});

describe("SetAttachmentFolder", () => {
  it("sets a folder and undo removes the key it added", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = new SetAttachmentFolder("images", "/Pictures/");
    expect(command.label).toBe("Set image folder");
    command.apply(doc);
    expect(doc.folders).toEqual({ images: "Pictures" });
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
    expect("folders" in doc).toBe(false);
  });

  it("keeps the other kind when setting or clearing one", () => {
    const doc = emptyDocument();
    doc.folders = { images: "Img", audio: "Rec" };
    const before = snapshot(doc);
    const clear = new SetAttachmentFolder("audio", undefined);
    expect(clear.label).toBe("Set recording folder");
    expect(new SetAttachmentFolder("exports", "PDF").label).toBe("Set export folder");
    clear.apply(doc);
    expect(doc.folders).toEqual({ images: "Img" });
    clear.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("clearing the last folder deletes the key, and undo puts it back in place", () => {
    const doc = emptyDocument();
    doc.folders = { images: "Img" };
    // A key written after `folders`: re-adding `folders` would append it.
    doc.recordings = [{ id: "r1", path: "a.m4a", start: 1, duration: 2 }];
    const before = snapshot(doc);
    const command = new SetAttachmentFolder("images", "");
    command.apply(doc);
    expect("folders" in doc).toBe(false);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("a refused folder clears rather than storing it", () => {
    const doc = emptyDocument();
    doc.folders = { audio: "Rec" };
    new SetAttachmentFolder("audio", ".trash").apply(doc);
    expect("folders" in doc).toBe(false);
  });
});

describe("meta.folders on disk", () => {
  it("round-trips, and is absent when nothing is set", () => {
    const doc = emptyDocument();
    expect("folders" in decodeDocument(encodeDocument(doc))).toBe(false);
    doc.folders = { images: "Notes/Img", audio: "Notes/Rec", exports: "Notes/PDF" };
    expect(decodeDocument(encodeDocument(doc)).folders).toEqual({
      images: "Notes/Img",
      audio: "Notes/Rec",
      exports: "Notes/PDF",
    });
  });

  it("drops junk written by hand or by a future build", () => {
    const doc = emptyDocument();
    doc.folders = { images: ".hidden" } as InkDocument["folders"];
    expect("folders" in decodeDocument(encodeDocument(doc))).toBe(false);
  });
});

describe("suggestFolders", () => {
  const paths = [
    "Computer Science",
    "Computer Science/Algebra for security",
    "Computer Science/Network",
    "Maths/Computer algebra",
    ".obsidian",
    "Attachments",
  ];

  it("offers prefix matches before matches further in, case-insensitively", () => {
    expect(suggestFolders(paths, "comp")).toEqual([
      "Computer Science",
      "Computer Science/Algebra for security",
      "Computer Science/Network",
      "Maths/Computer algebra",
    ]);
    expect(suggestFolders(paths, "ALGEBRA")).toEqual([
      "Computer Science/Algebra for security",
      "Maths/Computer algebra",
    ]);
  });

  it("leaves out the folder already typed in full, and dot-folders", () => {
    expect(suggestFolders(paths, "computer science/network")).toEqual([]);
    expect(suggestFolders(paths, "obsidian")).toEqual([]);
  });

  it("offers the first few for an empty field, and honours the limit", () => {
    expect(suggestFolders(paths, "  ", 2)).toEqual([
      "Computer Science",
      "Computer Science/Algebra for security",
    ]);
    expect(suggestFolders(paths, "c", 1)).toEqual(["Computer Science"]);
  });
});
