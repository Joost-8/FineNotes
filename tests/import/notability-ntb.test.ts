import fs, { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import {
  IMPORT_EXTENSIONS,
  importNotebooks,
  isImportFileName,
} from "../../src/import/import-notebook";
import {
  decodeInkPath,
  f16ToF32,
  FlatBuffer,
  deletedIds,
  isNotabilityNtb,
  notabilityNtbPdfFiles,
  pageLayout,
  readNotabilityNtb,
} from "../../src/import/notability-ntb";
import {
  boldEvent,
  boundary,
  createPageEvent,
  deleteEvent,
  documentEvent,
  insertCharEvent,
  insertStringEvent,
  lineEvent,
  movePositionEvent,
  noteBundle,
  removeCharEvent,
  removeCharsEvent,
  resizeBlockEvent,
  stickyEvent,
  textBoxEvent,
} from "./ntb-builders";

/** A FlatBuffers note with no events: a root table whose field 6 is an empty vector. */
function emptyBundle(): Uint8Array {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 24, true); // root table
  view.setUint16(4, 18, true); // vtable: length, table length, seven fields
  view.setUint16(6, 8, true);
  view.setUint16(4 + 6 * 2 + 4, 4, true); // field 6 at table + 4
  view.setInt32(24, 20, true); // table minus vtable
  view.setUint32(28, 32 - 28, true); // field 6 holds an offset to the vector
  view.setUint32(32, 0, true); // vector length 0
  return bytes;
}

/** A tiny table: a root offset, a vtable, and one float32 field (1.5). */
function tinyTable(): Uint8Array {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 12, true);
  view.setUint16(4, 6, true); // vtable length
  view.setUint16(6, 8, true); // table length
  view.setUint16(8, 4, true); // field 0 at table + 4
  view.setInt32(12, 8, true); // table minus vtable
  view.setFloat32(16, 1.5, true);
  return bytes;
}

const ntbFiles = (extra: Record<string, Uint8Array> = {}): Map<string, Uint8Array> =>
  new Map<string, Uint8Array>(
    Object.entries({ noteBundle: emptyBundle(), version: new Uint8Array([1]), ...extra }),
  );

describe("f16ToF32", () => {
  it("decodes half-precision values", () => {
    expect(f16ToF32(0x0000)).toBe(0);
    expect(f16ToF32(0x3c00)).toBe(1);
    expect(f16ToF32(0xc000)).toBe(-2);
  });
});

describe("FlatBuffer", () => {
  it("reads a field of a table", () => {
    const flat = new FlatBuffer(tinyTable());
    const root = flat.rootTable();
    expect(root).toBe(12);
    const field = root === null ? null : flat.field(root, 0);
    expect(field).toBe(16);
    expect(field === null ? null : flat.f32(field)).toBe(1.5);
  });

  it("reports a field the table does not have as absent", () => {
    const flat = new FlatBuffer(tinyTable());
    expect(flat.field(12, 1)).toBeNull();
    expect(flat.u32(100)).toBeNull();
    expect(flat.slice(16, 8)).toBeNull();
  });
});

describe("decodeInkPath", () => {
  it("scales relative linear coordinates by the ink's scale", () => {
    const encoded = new Uint8Array([0, 2, 0, 7, 0, 0, 0, 0, 6, 0x00, 0x3c, 0x00, 0x40]);
    const decoded = decodeInkPath(encoded, [10, 20], [0.5, 2]);
    expect(decoded).toHaveLength(1);
    expect(decoded?.[0].points).toEqual([
      [10, 20],
      [10.5, 24],
    ]);
  });

  it("refuses bytes that are too short", () => {
    expect(decodeInkPath(new Uint8Array(4), [0, 0], [1, 1])).toBeNull();
  });
});

describe("isNotabilityNtb", () => {
  it("recognises a note at the top of the zip and one folder down", () => {
    expect(isNotabilityNtb(ntbFiles())).toBe(true);
    const folder = new Map([
      ["Lecture/noteBundle", emptyBundle()],
      ["Lecture/version", new Uint8Array([1])],
    ]);
    expect(isNotabilityNtb(folder)).toBe(true);
  });

  it("does not take a backup of notes for one note", () => {
    const backup = new Map([
      ["Lecture.ntb/noteBundle", emptyBundle()],
      ["Lecture.ntb/version", new Uint8Array([1])],
      ["Lecture.ntb", new Uint8Array([1])],
    ]);
    expect(isNotabilityNtb(backup)).toBe(false);
  });

  it("needs a version entry as well as the bundle", () => {
    expect(isNotabilityNtb(new Map([["noteBundle", emptyBundle()]]))).toBe(false);
  });

  it("is not a `.note` (Session.plist) either", () => {
    expect(isNotabilityNtb(new Map([["Session.plist", new Uint8Array([1])]]))).toBe(false);
  });
});

describe("notabilityNtbPdfFiles", () => {
  it("lists the note's PDFs by their path under the note", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const files = ntbFiles({ "assets/abc.pdf": pdf, "assets/def.png": new Uint8Array([1]) });
    expect(notabilityNtbPdfFiles(files)).toEqual([{ name: "assets/abc.pdf", bytes: pdf }]);
  });
});

describe("readNotabilityNtb", () => {
  it("reads a note with nothing on it as one blank page, and says so", () => {
    const result = readNotabilityNtb(ntbFiles(), "Empty");
    expect(result.source).toBe("notability");
    expect(result.title).toBe("Empty");
    expect(result.doc.pages).toHaveLength(1);
    expect(result.doc.pages[0].strokes).toEqual([]);
    expect(result.warnings).toContain("No handwriting was found in this note.");
  });

  it("refuses a folder that is not a note", () => {
    expect(() => readNotabilityNtb(new Map(), "Nothing")).toThrow();
  });
});

/** A note with `events`, and one PDF of the given page sizes. */
function noteWith(events: Parameters<typeof noteBundle>[0], pdf = true): Map<string, Uint8Array> {
  return ntbFiles({
    noteBundle: noteBundle(events),
    ...(pdf ? { [`assets/${"a".repeat(128)}.pdf`]: new Uint8Array([0x25, 0x50, 0x44, 0x46]) } : {}),
  });
}

describe("pageLayout", () => {
  const paper = { width: 612, height: 792 };

  it("scales the paper's width to the page and keeps the paper's height without a PDF", () => {
    expect(pageLayout(paper, 1224, null)).toEqual({ width: 1224, height: 1584, scale: 2 });
  });

  it("makes a PDF page as tall as the PDF is at the paper's width", () => {
    // A landscape slide on portrait paper: not stretched to the paper's shape.
    const layout = pageLayout(paper, 1224, { width: 893.04, height: 841.92 });
    expect(layout.width).toBe(1224);
    expect(layout.height).toBe(Math.round((1224 * 841.92) / 893.04));
    expect(layout.scale).toBe(2);
  });

  it("leaves the ink and the PDF on one scale so a highlight keeps its words", () => {
    const pdf = { width: 893.04, height: 841.92 };
    const { height, scale } = pageLayout(paper, 1053, pdf);
    // FineNotes draws the PDF as large as fits: width-bound here, so its scale is 1053 / 893.04,
    // while the ink is placed at 1053 / 612; one doc unit is 893.04 / 612 PDF points either way.
    const pdfScale = Math.min(1053 / pdf.width, height / pdf.height);
    expect(pdfScale * (pdf.width / paper.width)).toBeCloseTo(scale, 3);
    expect(pdfScale * pdf.height).toBeCloseTo(height, 0);
  });

  it("falls back to the paper for a PDF page with no size", () => {
    expect(pageLayout(paper, 612, { width: 0, height: 10 }).height).toBe(792);
  });
});

describe("a note's deleted things", () => {
  const events = [
    documentEvent(612, 792),
    createPageEvent(2, 893, 842),
    stickyEvent(10, 0, [213, 493], [240, 22]),
    stickyEvent(11, 0, [100, 100], [200, 100]),
    lineEvent(12, 0, [40, 211], [98, 211], 2, 4),
    lineEvent(13, 0, [10, 300], [90, 300], 2, 4),
    deleteEvent(20, [10, 13]),
  ];

  it("names the ids a DeleteEntities event deletes", () => {
    const flat = new FlatBuffer(noteBundle(events));
    const root = flat.rootTable();
    const list = root === null ? null : flat.tableVector(root, 6);
    expect([...deletedIds(flat, list ?? [])].sort()).toEqual(["0:10", "0:13"]);
  });

  it("leaves a deleted sticky note out, which the converter draws as a solid yellow box", () => {
    const result = readNotabilityNtb(noteWith(events), "Deleted");
    const page = result.doc.pages[0];
    const stickies = page.images.filter((image) => image.sticky);
    expect(stickies).toHaveLength(1);
    // The one that is left is the second, at (100, 100) of 612 wide, on a 1053 wide page.
    const k = 1053 / 612;
    expect(stickies[0].w).toBeCloseTo(200 * k, 1);
    expect(stickies[0].h).toBeCloseTo(100 * k, 1);
  });

  it("leaves a deleted highlighter line out and keeps the others", () => {
    const result = readNotabilityNtb(noteWith(events), "Deleted");
    const strokes = result.doc.pages[0].strokes;
    expect(strokes).toHaveLength(1);
    expect(strokes[0].tool).toBe("highlighter");
  });

  it("does not take a text box's colourless paper for a yellow sticky note", () => {
    const result = readNotabilityNtb(
      noteWith([...events.slice(0, -1), textBoxEvent(14, 0, [340, 128], [240, 22])]),
      "Text box",
    );
    const page = result.doc.pages[0];
    expect(page.images.filter((image) => image.sticky)).toHaveLength(2);
  });

  it("keeps everything when nothing was deleted", () => {
    const result = readNotabilityNtb(noteWith(events.slice(0, -1)), "Kept");
    const page = result.doc.pages[0];
    expect(page.images.filter((image) => image.sticky)).toHaveLength(2);
    expect(page.strokes).toHaveLength(2);
  });
});

describe("a note's typed text", () => {
  const k = 1053 / 612;
  const base = [documentEvent(612, 792), createPageEvent(2, 893, 842)];
  const box = textBoxEvent(10, 0, [340, 128], [240, 22]);
  const boxesOf = (events: Parameters<typeof noteBundle>[0]) =>
    readNotabilityNtb(noteWith([...base, ...events]), "Typed").doc.pages[0].textBoxes;

  it("puts typed characters into their text box, at the box's place", () => {
    const [placed, ...rest] = boxesOf([
      box,
      insertCharEvent(11, "H", null, 10),
      insertCharEvent(12, "i", [11, 0], 10),
      insertCharEvent(13, "!", [12, 0], 10),
    ]);
    expect(rest).toHaveLength(0);
    expect(placed.text).toBe("Hi!");
    expect(placed.x).toBeCloseTo(340 * k, 1);
    expect(placed.y).toBeCloseTo(128 * k, 1);
  });

  it("leaves out a character that was removed, and takes back one that was revived", () => {
    const typed = [
      box,
      insertCharEvent(11, "c", null, 10),
      insertCharEvent(12, "a", [11, 0], 10),
      insertCharEvent(13, "t", [12, 0], 10),
    ];
    expect(boxesOf([...typed, removeCharEvent(14, [13, 0])])[0].text).toBe("ca");
    // Typed again after the removed one: the new character goes where the old one was.
    expect(
      boxesOf([...typed, removeCharEvent(14, [13, 0]), insertCharEvent(15, "r", [12, 0], 10)])[0]
        .text,
    ).toBe("car");
    expect(
      boxesOf([
        ...typed,
        removeCharsEvent(14, [
          [12, 0],
          [13, 0],
        ]),
      ])[0].text,
    ).toBe("c");
    expect(
      boxesOf([
        ...typed,
        removeCharsEvent(14, [
          [12, 0],
          [13, 0],
        ]),
        removeCharsEvent(
          15,
          [
            [12, 0],
            [13, 0],
          ],
          true,
        ),
      ])[0].text,
    ).toBe("cat");
  });

  it("places a character after the third character of a string", () => {
    const text = boxesOf([
      box,
      insertStringEvent(20, "abcdef", null, 10),
      insertCharEvent(21, "X", [20, 2], 10),
    ])[0].text;
    expect(text).toBe("abcXdef");
  });

  it("puts what is typed later at the same place before what was typed there", () => {
    const text = boxesOf([
      box,
      insertCharEvent(11, "y", null, 10),
      insertCharEvent(12, "z", null, 10),
    ])[0].text;
    expect(text).toBe("zy");
  });

  it("keeps the text of two boxes apart and drops the text of a deleted one", () => {
    const events = [
      box,
      textBoxEvent(30, 0, [100, 300], [200, 22]),
      insertCharEvent(11, "A", null, 10),
      insertCharEvent(31, "B", null, 30),
      deleteEvent(40, [30]),
    ];
    expect(boxesOf(events).map((b) => b.text)).toEqual(["A"]);
    expect(
      boxesOf([...events.slice(0, -1), deleteEvent(40, [30], [30])]).map((b) => b.text),
    ).toEqual(["A", "B"]);
  });

  it("moves a box where a later ModifyPositions event puts it, and resizes it with ModifyBlock", () => {
    const [moved] = boxesOf([
      box,
      insertCharEvent(11, "A", null, 10),
      movePositionEvent(20, 10, 0, [200, 300]),
      resizeBlockEvent(21, 10, [100, 50]),
    ]);
    expect(moved.x).toBeCloseTo(200 * k, 1);
    expect(moved.y).toBeCloseTo(300 * k, 1);
    expect(moved.w).toBeCloseTo(100 * k, 1);
  });

  it("moves a drawn line with a ModifyPositions event too", () => {
    const [stroke] = readNotabilityNtb(
      noteWith([
        ...base,
        lineEvent(12, 0, [40, 211], [98, 211], 2, 4),
        movePositionEvent(20, 12, 0, [50, 300]),
      ]),
      "Moved",
    ).doc.pages[0].strokes;
    expect(stroke.pts[0]).toBeCloseTo(50 * k, 1);
    expect(stroke.pts[1]).toBeCloseTo(300 * k, 1);
  });

  it("styles a range between two characters, in the text that is left", () => {
    const [styled] = boxesOf([
      box,
      insertStringEvent(11, "abcd", null, 10),
      removeCharEvent(12, [11, 1]),
      // Bold from "a" to the end of the text, over the removed "b".
      boldEvent(13, boundary(11, 0, 0), boundary(0, 0, 3)),
    ]);
    expect(styled.text).toBe("acd");
    expect(styled.bold).toBe(true);
  });

  it("flows text typed into the document as the note's body, and counts text with no box", () => {
    const typed = [insertCharEvent(11, "H", null, 1), insertCharEvent(12, "i", [11, 0], null)];
    const body = readNotabilityNtb(noteWith([...base, ...typed]), "Body");
    expect(body.doc.pages[0].textBoxes.map((b) => b.text)).toEqual(["Hi"]);
    const orphan = readNotabilityNtb(
      noteWith([...base, insertStringEvent(11, "lost", null, 50)]),
      "Orphan",
    );
    expect(orphan.warnings.join(" ")).toContain("4 characters of typed text could not be placed");
  });
});

describe("a note's PDF pages", () => {
  const sizes = new Map([[`assets/${"a".repeat(128)}.pdf`, [{ width: 893.04, height: 841.92 }]]]);
  const events = [
    documentEvent(612, 792),
    createPageEvent(2, 894, 842),
    lineEvent(12, 0, [40, 211], [98, 211], 2, 4),
  ];

  it("makes the page as tall as the PDF page, not the paper", () => {
    const { pages } = readNotabilityNtb(noteWith(events), "Slide", sizes).doc;
    expect(pages).toHaveLength(1);
    expect(pages[0].backdrop.kind).toBe("pdf");
    expect(pages[0].geometry.width).toBe(1053);
    expect(pages[0].geometry.height).toBe(Math.round((1053 * 841.92) / 893.04));
  });

  it("puts a highlight where the paper's units say, from the page's top-left", () => {
    const { pages } = readNotabilityNtb(noteWith(events), "Slide", sizes).doc;
    const [stroke] = pages[0].strokes;
    // The file stores x from the page's edge; the reader measures it from the content's
    // left edge and the inset is added back, so a position keeps its place on the page.
    const k = 1053 / 612;
    expect(stroke.pts[0]).toBeCloseTo(40 * k, 1);
    expect(stroke.pts[1]).toBeCloseTo(211 * k, 1);
    expect(stroke.pts[3]).toBeCloseTo(98 * k, 1);
  });

  it("takes the size from the page's own event when the PDF could not be measured", () => {
    const { doc, warnings } = readNotabilityNtb(noteWith(events), "Slide");
    expect(doc.pages[0].geometry.height).toBe(Math.round((1053 * 842) / 894));
    expect(warnings).not.toContain(
      "The PDF's page sizes could not be read, so its pages are taken as the note's paper size.",
    );
  });
});

describe("importing .ntb files", () => {
  it("registers the extension for the picker and drag-and-drop", () => {
    expect(IMPORT_EXTENSIONS).toContain("ntb");
    expect(isImportFileName("Lecture 3.ntb")).toBe(true);
    expect(isImportFileName("Lecture 3.NTB")).toBe(true);
  });

  it("converts a single .ntb file, a zip of it, and a backup holding it", async () => {
    const note = zipSync({ noteBundle: emptyBundle(), version: new Uint8Array([1]) });

    const single = await importNotebooks(note, "Empty.ntb");
    expect(single.failures).toEqual([]);
    expect(single.results.map((r) => r.title)).toEqual(["Empty"]);

    const backup = zipSync({ "Course/Empty.ntb": note, "Course/Other.ntb": note });
    const packed = await importNotebooks(backup, "Backup.zip");
    expect(packed.failures).toEqual([]);
    expect(packed.results.map((r) => r.title)).toEqual(["Empty", "Other"]);

    const folders = zipSync({
      "Course/Folder.ntb/noteBundle": emptyBundle(),
      "Course/Folder.ntb/version": new Uint8Array([1]),
    });
    const unpacked = await importNotebooks(folders, "Folders.zip");
    expect(unpacked.failures).toEqual([]);
    expect(unpacked.results.map((r) => r.title)).toEqual(["Folder"]);
  });
});

/** Every `.ntb` file under `dir`, recursively. */
function ntbFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ntbFilesUnder(path);
    return name.toLowerCase().endsWith(".ntb") ? [path] : [];
  });
}

/** The PDF page sizes a note's PDFs have, as the plugin measures them. */
async function measure(bytes: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPages().map((page) => page.getSize());
}

/**
 * Real notes, when `NTB_SAMPLES` names a folder of `.ntb` files. They are
 * private: nothing read from them is written to the repository.
 */
describe.skipIf(!process.env.NTB_SAMPLES)("real .ntb notes (NTB_SAMPLES)", () => {
  it("imports every .ntb file under the folder with no failures", async () => {
    const paths = ntbFilesUnder(process.env.NTB_SAMPLES ?? "");
    expect(paths.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const path of paths) {
      const bytes = new Uint8Array(readFileSync(path));
      const batch = await importNotebooks(bytes, path.split(/[\\/]/).pop() ?? path, {
        measurePdf: measure,
      });
      if (batch.failures.length > 0) {
        failures.push(...batch.failures.map((f) => `${path}: ${f.reason}`));
        continue;
      }
      expect(batch.results.length, path).toBeGreaterThanOrEqual(1);
      for (const result of batch.results) {
        const pages = result.doc.pages;
        expect(pages.length, path).toBeGreaterThanOrEqual(1);
        const content = pages.reduce(
          (n, p) =>
            n +
            p.strokes.length +
            p.textBoxes.length +
            p.images.length +
            (p.backdrop.kind === "pdf" ? 1 : 0),
          0,
        );
        expect(content, path).toBeGreaterThan(0);
      }
    }
    expect(failures).toEqual([]);
  }, 1_800_000);
});

/**
 * A whole export zip, when `NTB_ZIP` names one. The report goes to the file
 * `NTB_REPORT` names (one line a note, then the failures and the warnings
 * counted by kind); it is private, so it is never written into the repository.
 */
describe.skipIf(!process.env.NTB_ZIP)("a whole .ntb export (NTB_ZIP)", () => {
  it("imports every note in the zip", async () => {
    const bytes = new Uint8Array(readFileSync(process.env.NTB_ZIP ?? ""));
    const batch = await importNotebooks(bytes, "export.zip", { measurePdf: measure });
    const lines: string[] = [];
    // Every notebook keeps the folder it had in the export: the folders holding its .ntb file.
    const sources = new Set<string>();
    unzipSync(bytes, {
      filter: (file) => {
        const match = /^(.*?)\/?[^/]*\.ntb(?:\/|$)/i.exec(file.name);
        if (match) sources.add(match[1]);
        return false;
      },
    });
    const folders = new Map<string, number>();
    for (const r of batch.results) {
      folders.set(r.folder ?? "", (folders.get(r.folder ?? "") ?? 0) + 1);
    }
    expect(batch.results.every((r) => !!r.folder && sources.has(r.folder))).toBe(true);
    lines.push(`folders: ${folders.size} distinct`);
    for (const [folder, n] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`FOLDER ${n} ${folder}`);
    }
    console.log(
      lines.filter((line) => line.startsWith("folders") || line.startsWith("FOLDER")).join("\n"),
    );
    for (const r of batch.results) {
      const pages = r.doc.pages;
      const strokes = pages.reduce((n, p) => n + p.strokes.length, 0);
      const boxes = pages.reduce((n, p) => n + p.textBoxes.length, 0);
      const pdfs = pages.filter((p) => p.backdrop.kind === "pdf").length;
      const size = pages[0] ? `${pages[0].geometry.width}x${pages[0].geometry.height}` : "-";
      // Ink points that fall off their page: a geometry check, not a precise count.
      let outside = 0;
      for (const page of pages) {
        const { width, height } = page.geometry;
        for (const stroke of page.strokes) {
          for (let i = 0; i < stroke.pts.length; i += 3) {
            const x = stroke.pts[i];
            const y = stroke.pts[i + 1];
            if (x < -2 || x > width + 2 || y < -2 || y > height + 2) outside++;
          }
        }
      }
      const images = pages.reduce((n, p) => n + p.images.length, 0);
      lines.push(
        `OK ${r.title} | pages ${pages.length} | page0 ${size} | strokes ${strokes} | outside ${outside} | boxes ${boxes} | pdfPages ${pdfs} | images ${images}`,
      );
    }
    for (const f of batch.failures) lines.push(`FAILED ${f.name}: ${f.reason}`);
    const counts = new Map<string, number>();
    for (const r of batch.results)
      for (const w of r.warnings) {
        const key = w.replace(/d+/g, "N");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    lines.push(`imported ${batch.results.length}, failed ${batch.failures.length}`);
    for (const [w, n] of counts) lines.push(`${n} x ${w}`);
    if (process.env.NTB_REPORT) fs.writeFileSync(process.env.NTB_REPORT, `${lines.join("\n")}\n`);
    expect(batch.failures).toEqual([]);
  }, 1_800_000);
});
