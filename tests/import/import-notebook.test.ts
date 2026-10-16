import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  IMPORT_EXTENSIONS,
  importNotebooks,
  relinkAttachments,
} from "../../src/import/import-notebook";
import {
  sniffFile,
  hexColor,
  pressureForWidth,
  median,
  pageScale,
} from "../../src/import/import-types";
import { goodnotesFiles, JPEG, keyedArchive, PDF, PNG, zip } from "./builders";
import { xopp } from "./xournal-builders";
import { note, point } from "./saber-builders";
import { rmOld } from "./remarkable-builders";
import { buildSupernote } from "./supernote-builders";

const PAGE = "11111111-0000-0000-0000-00000000000A";

const goodnotes = (title?: string): Uint8Array =>
  zip(
    goodnotesFiles({
      title,
      templates: [{ id: "T", size: [834.24, 1078.825], attachment: "A" }],
      pages: [
        {
          id: PAGE,
          template: "T",
          order: "a",
          images: [{ id: "I", attachment: "P", frame: [0, 0, 10, 10] }],
        },
      ],
      attachments: { A: PDF, P: JPEG },
    }),
  );

const notability = (): Uint8Array =>
  zip({
    "Maths/Session.plist": keyedArchive({
      $class: "NoteTakingSession",
      name: "Maths",
      richText: {},
    }),
  });

describe("importNotebooks", () => {
  it("imports a single Goodnotes or Notability file", () => {
    const a = importNotebooks(goodnotes("Biology"), "Biology.goodnotes");
    expect(a.failures).toEqual([]);
    expect(a.results.map((r) => [r.source, r.title])).toEqual([["goodnotes", "Biology"]]);
    const b = importNotebooks(notability(), "Maths.note");
    expect(b.results.map((r) => [r.source, r.title])).toEqual([["notability", "Maths"]]);
  });

  it("names a notebook without a title after its file", () => {
    const result = importNotebooks(goodnotes(), "Folder/Chemistry 101.goodnotes");
    expect(result.results[0].title).toBe("Chemistry 101");
  });

  it("opens a backup zip: packed files and unzipped package folders, in name order", () => {
    const inner = zipSync({ "Inner.goodnotes": goodnotes("Inner") }, { level: 0 });
    const unzippedNote: Record<string, Uint8Array> = {};
    unzippedNote["Unpacked.note/Unpacked/Session.plist"] = keyedArchive({
      $class: "NoteTakingSession",
      name: "Unpacked",
      richText: {},
    });
    const backup = zip({
      "Goodnotes/B.goodnotes": goodnotes("B"),
      "Goodnotes/A.goodnotes": goodnotes("A"),
      "Notability/Maths.note": notability(),
      "nested.zip": inner,
      "broken.goodnotes": new Uint8Array([1, 2, 3]),
      "empty.note": new Uint8Array(),
      "readme.txt": new TextEncoder().encode("hi"),
      ...unzippedNote,
    });
    const batch = importNotebooks(backup, "Backup.zip");
    expect(batch.results.map((r) => r.title)).toEqual(["A", "B", "Maths", "Inner", "Unpacked"]);
    expect(batch.failures).toEqual([
      { name: "broken.goodnotes", reason: "It is not a notebook FineNotes can import." },
    ]);
  });

  it("reports files it cannot use instead of throwing", () => {
    expect(importNotebooks(new Uint8Array([1, 2, 3]), "x.goodnotes").failures).toEqual([
      { name: "x.goodnotes", reason: "It is not a notebook FineNotes can import." },
    ]);
    expect(importNotebooks(zip({ "a.txt": new Uint8Array([1]) }), "a.zip").failures).toEqual([
      { name: "a.zip", reason: "No notebook FineNotes can import was found in it." },
    ]);
    const noPages = zip(goodnotesFiles({ templates: [], pages: [] }));
    const failed = importNotebooks(noPages, "Empty.goodnotes").failures[0];
    expect(failed.name).toBe("Empty.goodnotes");
    expect(failed.reason).toMatch(/^It could not be read \(.*no pages.*\)\.$/);
  });

  it("tells the formats apart by their bytes, alone or inside a backup", () => {
    const sbn2 = note([
      { w: 1000, h: 1400, s: [{ p: [point(1, 1), point(5, 5)], c: 0xff000000 }] },
    ]);
    const singles: Record<string, Uint8Array> = {
      "Physics.xopp": xopp([{}], "Physics"),
      "Draft.sbn2": sbn2,
      "Page.rm": rmOld(5, []),
      "Diary.note": buildSupernote({ pages: [{}] }),
    };
    const sources = Object.entries(singles).map(
      ([name, bytes]) => importNotebooks(bytes, name).results[0]?.source,
    );
    expect(sources).toEqual(["xournal", "saber", "remarkable", "supernote"]);
    // The same extension, two apps: a Supernote .note and a Notability .note.
    expect(importNotebooks(singles["Diary.note"], "a.note").results[0].title).toBe("a");
    const mixed = importNotebooks(zip({ ...singles, "x.pdf": PDF }), "Mixed.zip");
    expect(mixed.results.map((r) => r.source).sort()).toEqual([
      "remarkable",
      "saber",
      "supernote",
      "xournal",
    ]);
    expect(mixed.failures).toEqual([]);
    expect(importNotebooks(zip({ "main.sbn2": sbn2 }), "Draft.sba").results[0].source).toBe(
      "saber",
    );
  });

  it("stops opening zips inside zips after two levels", () => {
    let nested = goodnotes("Deep");
    for (let i = 0; i < 3; i++) nested = zipSync({ [`level${i}.zip`]: nested }, { level: 0 });
    expect(importNotebooks(nested, "deep.zip").results).toEqual([]);
  });

  it("lists the extensions to pick", () => {
    expect(IMPORT_EXTENSIONS).toEqual([
      "goodnotes",
      "note",
      "noteful",
      "zip",
      "pdf",
      "xopp",
      "xoj",
      "sbn2",
      "sbn",
      "sba",
      "rm",
      "rmdoc",
    ]);
  });
});

describe("relinkAttachments", () => {
  it("swaps attachment names for vault paths", () => {
    const { doc, attachments } = importNotebooks(goodnotes("Bio"), "Bio.goodnotes").results[0];
    doc.recordings = [{ id: "r1", path: "rec.m4a", start: 0, duration: 1 }];
    const paths = new Map(attachments.map((a) => [a.name, `Imports/${a.name}`]));
    relinkAttachments(doc, paths);
    const page = doc.pages[0];
    expect(page.backdrop).toEqual({ kind: "pdf", path: "Imports/Bio - paper 1.pdf", page: 0 });
    expect(page.images[0].path).toBe("Imports/Bio - picture 2.jpg");
    expect(doc.recordings[0].path).toBe("rec.m4a");
  });
});

describe("import helpers", () => {
  it("tells file types apart", () => {
    const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
    expect(sniffFile(JPEG).ext).toBe("jpg");
    expect(sniffFile(PNG).ext).toBe("png");
    expect(sniffFile(PDF).ext).toBe("pdf");
    expect(sniffFile(new Uint8Array(ascii("GIF89a"))).ext).toBe("gif");
    expect(sniffFile(new Uint8Array([0, 0, 0, 0, ...ascii("ftypheic")])).mime).toBe("image/heic");
    expect(sniffFile(new Uint8Array([0, 0, 0, 0, ...ascii("ftypM4A ")])).mime).toBe("audio/mp4");
    expect(sniffFile(new Uint8Array(ascii("RIFF\0\0\0\0WEBP"))).ext).toBe("webp");
    expect(sniffFile(new Uint8Array([1, 2, 3])).ext).toBe("bin");
  });

  it("formats colours and widths", () => {
    expect(hexColor(1, 0.5, 0)).toBe("#ff8000");
    expect(hexColor(NaN, 2, -1)).toBe("#00ff00");
    expect(pressureForWidth(1, 0)).toBe(0.5);
    expect(pressureForWidth(1, 1)).toBeCloseTo(0.5);
    expect(pressureForWidth(0, 1)).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(pageScale(1024, 210)).toBeCloseTo(1);
  });
});
