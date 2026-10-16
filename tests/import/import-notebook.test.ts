import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
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
import { freenotes } from "./freenotes-builders";

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
  it("imports a single Goodnotes or Notability file", async () => {
    const a = await importNotebooks(goodnotes("Biology"), "Biology.goodnotes");
    expect(a.failures).toEqual([]);
    expect(a.results.map((r) => [r.source, r.title])).toEqual([["goodnotes", "Biology"]]);
    const b = await importNotebooks(notability(), "Maths.note");
    expect(b.results.map((r) => [r.source, r.title])).toEqual([["notability", "Maths"]]);
  });

  it("names a notebook without a title after its file", async () => {
    const result = await importNotebooks(goodnotes(), "Folder/Chemistry 101.goodnotes");
    expect(result.results[0].title).toBe("Chemistry 101");
  });

  it("opens a backup zip: packed files and unzipped package folders, in name order", async () => {
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
    const batch = await importNotebooks(backup, "Backup.zip");
    expect(batch.results.map((r) => r.title)).toEqual(["A", "B", "Maths", "Inner", "Unpacked"]);
    expect(batch.failures).toEqual([
      { name: "broken.goodnotes", reason: "It is not a notebook FineNotes can import." },
    ]);
  });

  it("reports files it cannot use instead of throwing", async () => {
    expect((await importNotebooks(new Uint8Array([1, 2, 3]), "x.goodnotes")).failures).toEqual([
      { name: "x.goodnotes", reason: "It is not a notebook FineNotes can import." },
    ]);
    expect(
      (await importNotebooks(zip({ "a.txt": new Uint8Array([1]) }), "a.zip")).failures,
    ).toEqual([{ name: "a.zip", reason: "No notebook FineNotes can import was found in it." }]);
    const noPages = zip(goodnotesFiles({ templates: [], pages: [] }));
    const failed = (await importNotebooks(noPages, "Empty.goodnotes")).failures[0];
    expect(failed.name).toBe("Empty.goodnotes");
    expect(failed.reason).toMatch(/^It could not be read \(.*no pages.*\)\.$/);
  });

  it("tells the formats apart by their bytes, alone or inside a backup", async () => {
    const sbn2 = note([
      { w: 1000, h: 1400, s: [{ p: [point(1, 1), point(5, 5)], c: 0xff000000 }] },
    ]);
    const singles: Record<string, Uint8Array> = {
      "Physics.xopp": xopp([{}], "Physics"),
      "Draft.sbn2": sbn2,
      "Page.rm": rmOld(5, []),
      "Diary.note": buildSupernote({ pages: [{}] }),
    };
    const sources: unknown[] = [];
    for (const [name, bytes] of Object.entries(singles)) {
      sources.push((await importNotebooks(bytes, name)).results[0]?.source);
    }
    expect(sources).toEqual(["xournal", "saber", "remarkable", "supernote"]);
    // The same extension, two apps: a Supernote .note and a Notability .note.
    expect((await importNotebooks(singles["Diary.note"], "a.note")).results[0].title).toBe("a");
    const mixed = await importNotebooks(zip({ ...singles, "x.pdf": PDF }), "Mixed.zip");
    expect(mixed.results.map((r) => r.source).sort()).toEqual([
      "remarkable",
      "saber",
      "supernote",
      "xournal",
    ]);
    expect(mixed.failures).toEqual([]);
    expect((await importNotebooks(zip({ "main.sbn2": sbn2 }), "Draft.sba")).results[0].source).toBe(
      "saber",
    );
  });

  it("stops opening zips inside zips after two levels", async () => {
    let nested = goodnotes("Deep");
    for (let i = 0; i < 3; i++) nested = zipSync({ [`level${i}.zip`]: nested }, { level: 0 });
    expect((await importNotebooks(nested, "deep.zip")).results).toEqual([]);
  });

  it("lists the extensions to pick", async () => {
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
      "freenotes",
    ]);
  });

  it("imports a FreeNotes notebook, alone, inside a backup, or unzipped in one", async () => {
    const ink = [
      {
        pattern: 5,
        items: [
          {
            points: [
              { x: 1, y: 1 },
              { x: 9, y: 9 },
            ],
          },
        ],
      },
    ];
    const book = freenotes({ title: "prob and stats", pages: ink });
    const alone = await importNotebooks(book, "prob and stats.freenotes");
    expect(alone.failures).toEqual([]);
    expect(alone.results.map((r) => [r.source, r.title, r.doc.pages[0].strokes.length])).toEqual([
      ["freenotes", "prob and stats", 1],
    ]);

    const unzipped = zipSync(
      Object.fromEntries(
        Object.entries(unzipSync(freenotes({ pages: ink, folder: "Maths.frnote/" }))).map(
          ([name, data]) => [`Backup/${name}`, data],
        ),
      ),
      { level: 0 },
    );
    const backup = await importNotebooks(
      zip({ "a.freenotes": book, "nested.zip": unzipped }),
      "Backup.zip",
    );
    expect(backup.failures).toEqual([]);
    expect(backup.results.map((r) => r.title).sort()).toEqual(["Maths", "prob and stats"]);

    const broken = await importNotebooks(
      zip({ "x.frnote/document.dat": new Uint8Array([0xff]), "x.frnote/layout.dat": EMPTY_FILE }),
      "x.freenotes",
    );
    expect(broken.failures[0].reason).toMatch(/could not be read \(.*page list.*\)/);
  });
});

const EMPTY_FILE = new Uint8Array();

describe("relinkAttachments", () => {
  it("swaps attachment names for vault paths", async () => {
    const { doc, attachments } = (await importNotebooks(goodnotes("Bio"), "Bio.goodnotes"))
      .results[0];
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
  it("tells file types apart", async () => {
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

  it("formats colours and widths", async () => {
    expect(hexColor(1, 0.5, 0)).toBe("#ff8000");
    expect(hexColor(NaN, 2, -1)).toBe("#00ff00");
    expect(pressureForWidth(1, 0)).toBe(0.5);
    expect(pressureForWidth(1, 1)).toBeCloseTo(0.5);
    expect(pressureForWidth(0, 1)).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(pageScale(1024, 210)).toBeCloseTo(1);
  });
});

describe("importNotebooks, one notebook at a time", () => {
  const backup = (): Uint8Array =>
    zip({
      "A.goodnotes": goodnotes("A"),
      "B.goodnotes": goodnotes("B"),
      "C.goodnotes": goodnotes("C"),
    });

  it("hands each notebook over before reading the next, then lets its files go", async () => {
    const seen: string[] = [];
    const batch = await importNotebooks(backup(), "Backup.zip", {
      onResult: async (result) => {
        expect(result.attachments.length).toBe(2);
        seen.push(`${result.title}:${batch_size()}`);
        await Promise.resolve();
      },
    });
    // How many results the batch held while each was handed over: none yet.
    function batch_size(): number {
      return seen.length;
    }
    expect(seen).toEqual(["A:0", "B:1", "C:2"]);
    expect(batch.results.map((r) => r.title)).toEqual(["A", "B", "C"]);
    expect(batch.results.every((r) => r.attachments.length === 0)).toBe(true);
  });

  it("reports a notebook that could not be saved, and goes on", async () => {
    const batch = await importNotebooks(backup(), "Backup.zip", {
      onResult: (result) =>
        result.title === "B" ? Promise.reject(new Error("disk full")) : Promise.resolve(),
    });
    expect(batch.results.map((r) => r.title)).toEqual(["A", "C"]);
    expect(batch.failures).toEqual([{ name: "B", reason: "It could not be saved (disk full)." }]);
  });

  it("stops when cancelled, without calling the backup empty", async () => {
    let stop = false;
    const batch = await importNotebooks(backup(), "Backup.zip", {
      onResult: () => {
        stop = true;
        return Promise.resolve();
      },
      cancelled: () => stop,
    });
    expect(batch.results.map((r) => r.title)).toEqual(["A"]);
    expect(batch.failures).toEqual([]);
    const none = await importNotebooks(goodnotes("A"), "A.goodnotes", { cancelled: () => true });
    expect(none).toEqual({ results: [], failures: [] });
  });

  it("measures a note's PDFs, and imports it unmeasured when that fails", async () => {
    const note = zip({
      "Slides/Session.plist": keyedArchive({
        $class: "NoteTakingSession",
        NBNoteTakingSessionDocumentPaperLayoutModelKey: {
          $class: "NoteDocumentPaperLayoutModel",
          pageLayoutArray: [
            {
              kPageLayoutPDFFileNameKey: "s.pdf",
              kPageLayoutPDFPageNumberKey: 1,
              kPageLayoutDocumentPageNumberKey: 1,
            },
          ],
        },
        richText: {},
      }),
      "Slides/PDFs/s.pdf": PDF,
    });
    const measured: number[] = [];
    const ok = await importNotebooks(note, "Slides.note", {
      measurePdf: (bytes) => {
        measured.push(bytes.length);
        return Promise.resolve([{ width: 960, height: 540 }]);
      },
    });
    expect(measured).toEqual([PDF.length]);
    expect(ok.results[0].warnings).toEqual([]);
    const page = ok.results[0].doc.pages[0];
    expect(page.geometry.height).toBe(Math.round((page.geometry.width * 540) / 960));

    const failed = await importNotebooks(note, "Slides.note", {
      measurePdf: () => Promise.reject(new Error("no pdf.js")),
    });
    expect(failed.results[0].warnings).toEqual([
      "The PDF's page sizes could not be read, so its pages may be out of place.",
    ]);
  });
});

describe("importNotebooks: PDFs placed as pictures", () => {
  const withPdfPicture = (): Uint8Array =>
    zip(
      goodnotesFiles({
        templates: [{ id: "T", size: [834.24, 1078.825], attachment: "A" }],
        pages: [
          {
            id: PAGE,
            template: "T",
            order: "a",
            images: [{ id: "I", attachment: "SHEET", frame: [10, 20, 100, 50] }],
          },
        ],
        attachments: { A: PDF, SHEET: PDF },
      }),
    );

  it("turns one into an image of its first page", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const batch = await importNotebooks(withPdfPicture(), "Bio.goodnotes", {
      rasterizePdf: () => Promise.resolve(png),
    });
    const [result] = batch.results;
    expect(result.doc.pages[0].images.map((i) => i.path)).toEqual(["Bio - picture 2.png"]);
    expect(result.attachments.map((a) => [a.name, a.mime])).toEqual([
      ["Bio - paper 1.pdf", "application/pdf"],
      ["Bio - picture 2.png", "image/png"],
    ]);
    expect(result.warnings).toEqual([
      "1 PDF placed as a picture came over as an image of its first page (page 1).",
    ]);
  });

  it("leaves a note where it was when no image can be made, and saves the PDF", async () => {
    for (const options of [{}, { rasterizePdf: () => Promise.reject(new Error("no pdf.js")) }]) {
      const [result] = (await importNotebooks(withPdfPicture(), "Bio.goodnotes", options)).results;
      const page = result.doc.pages[0];
      expect(page.images).toEqual([]);
      expect(page.textBoxes).toMatchObject([
        {
          id: "t1",
          text: "A PDF was placed here: Bio - picture 2.pdf, saved next to this notebook.",
        },
      ]);
      expect(result.attachments.map((a) => a.name)).toContain("Bio - picture 2.pdf");
      expect(result.warnings).toEqual([
        "1 PDF placed as a picture could not be shown; a note on the page says where it was saved (page 1).",
      ]);
    }
  });
});
