/**
 * FineNotes templates (`src/import/template-package.ts`): a notebook and
 * its pictures packed into one `.finetemplate` file, opened again through
 * the importer as a new notebook, and a gallery index read.
 */

import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { importNotebooks, isImportFileName } from "../../src/import/import-notebook";
import {
  TEMPLATE_EXTENSION,
  buildTemplatePackage,
  DEFAULT_GALLERY_URL,
  formatDownloads,
  galleryKindOf,
  galleryMatches,
  readGalleryIndex,
  sortGallery,
  readManifest,
  templateId,
} from "../../src/import/template-package";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import { PALETTES, SetNotebookPalette } from "../../src/model/palette";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function notebook(): InkDocument {
  const doc = emptyDocument();
  doc.pages = [
    {
      ...blankPage("p1", { width: 400, height: 500 }),
      backdrop: { kind: "ruled-wide", paperColor: "#fbf8ed", spacing: 50 },
      strokes: [
        {
          id: "s",
          color: "#1971c2",
          size: 2,
          tool: "pen",
          shape: "rect",
          fill: "#1971c24d",
          pts: [0, 0, 0.5, 10, 0, 0.5, 10, 10, 0.5, 0, 0, 0.5],
        },
      ],
      images: [
        { id: "i1", path: "Art/sticker star.png", x: 10, y: 10, w: 50, h: 50, front: true },
        { id: "i2", path: "Art/gone.png", x: 70, y: 10, w: 50, h: 50 },
      ],
      textBoxes: [
        {
          id: "t",
          x: 0,
          y: 100,
          w: 200,
          text: "Week 1",
          color: "#1a1a1a",
          fontSize: 30,
          caps: true,
        },
      ],
    },
    { ...blankPage("p2", { width: 400, height: 500 }) },
  ];
  doc.recordings = [{ id: "r", path: "Audio/x.m4a", started: 1, duration: 2 } as never];
  doc.folders = { images: "Mine/Images" };
  new SetNotebookPalette(PALETTES[1], false).apply(doc);
  return doc;
}

function pack(doc = notebook()): { bytes: Uint8Array; missing: string[] } {
  return buildTemplatePackage({
    doc,
    name: "Weekly Planner",
    author: "Joost",
    description: "A week a page.",
    licence: "cc-by",
    files: new Map([["Art/sticker star.png", PNG]]),
    preview: PNG,
    created: "2026-10-17T00:00:00.000Z",
  });
}

describe("a template file", () => {
  it("holds a manifest, the notebook, a preview and the pictures it uses", () => {
    const { bytes, missing } = pack();
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      "assets/sticker star.png",
      "manifest.json",
      "notebook.fn",
      "preview.png",
    ]);
    expect(missing).toEqual(["Art/gone.png"]);
    const manifest = readManifest(JSON.parse(new TextDecoder().decode(files["manifest.json"])));
    expect(manifest).toMatchObject({
      id: "weekly-planner",
      name: "Weekly Planner",
      author: "Joost",
      licence: "cc-by",
      pages: 2,
      version: "1",
    });
  });

  it("is the same bytes every time it is made from the same notebook", () => {
    expect(pack().bytes).toEqual(pack().bytes);
  });

  it("never carries personal fields: recordings, its folders", () => {
    const files = unzipSync(pack().bytes);
    const payload = new TextDecoder().decode(files["notebook.fn"]);
    expect(payload.startsWith("v")).toBe(true);
    expect(payload).not.toContain("Mine/Images");
  });
});

describe("opening a template", () => {
  it("is offered by the importer, and gives the notebook back with its picture and style", async () => {
    expect(isImportFileName(`Weekly.${TEMPLATE_EXTENSION}`)).toBe(true);
    const batch = await importNotebooks(pack().bytes, `Weekly.${TEMPLATE_EXTENSION}`);
    expect(batch.failures).toEqual([]);
    const [result] = batch.results;
    expect(result.source).toBe("template");
    expect(result.title).toBe("Weekly Planner");
    expect(result.doc.pages).toHaveLength(2);
    const [page] = result.doc.pages;
    expect(page.backdrop).toEqual({ kind: "ruled-wide", paperColor: "#fbf8ed", spacing: 50 });
    expect(page.images).toHaveLength(1);
    expect(page.images[0]).toMatchObject({ path: "assets/sticker star.png", front: true });
    expect(page.strokes[0].fill).toBe("#1971c24d");
    expect(page.textBoxes[0].caps).toBe(true);
    expect(result.doc.palette?.id).toBe("ocean");
    expect(result.doc.recordings).toBeUndefined();
    expect(result.attachments.map((a) => [a.name, a.mime])).toEqual([
      ["assets/sticker star.png", "image/png"],
    ]);
  });

  it("warns when a template is for personal use only", async () => {
    const { bytes } = buildTemplatePackage({
      doc: notebook(),
      name: "Mine",
      licence: "personal",
      files: new Map(),
    });
    const [result] = (await importNotebooks(bytes, "Mine.finetemplate")).results;
    expect(result.warnings.join(" ")).toContain("personal use only");
  });

  it("reports a template whose manifest is broken", async () => {
    const bytes = zipSync({ "manifest.json": strToU8("{"), "notebook.fn": strToU8("v2:") });
    const batch = await importNotebooks(bytes, "Broken.finetemplate");
    expect(batch.results).toEqual([]);
    expect(batch.failures).toHaveLength(1);
  });
});

describe("manifests and ids", () => {
  it("make ids from names, and refuse what is not a manifest", () => {
    expect(templateId("Ça va — Planner 2027!")).toBe("ca-va-planner-2027");
    expect(templateId("!!!")).toBe("template");
    expect(readManifest({ format: 1 })).toBeNull();
    expect(readManifest({ format: 99, name: "Future" })).toBeNull();
    expect(readManifest({ format: 1, name: "X", licence: "whatever" })?.licence).toBe("personal");
  });
});

describe("a gallery index", () => {
  it("keeps usable entries in name order, flags retired ones, drops the rest", () => {
    const entries = readGalleryIndex({
      format: 1,
      templates: [
        {
          name: "Zen journal",
          download: "https://x.org/zen.finetemplate",
          licence: "cc0",
          pages: 30,
        },
        { name: "Old planner", download: "https://x.org/old.finetemplate", retired: true },
        { name: "Insecure", download: "http://x.org/a.finetemplate" },
        { download: "https://x.org/noname.finetemplate" },
        {
          name: "Bad preview",
          download: "https://x.org/b.finetemplate",
          preview: "javascript:alert(1)",
        },
        "junk",
      ],
    });
    expect(entries.map((e) => [e.name, e.retired])).toEqual([
      ["Bad preview", false],
      ["Old planner", true],
      ["Zen journal", false],
    ]);
    expect(entries[0].preview).toBe("");
    expect(entries[2]).toMatchObject({ id: "zen-journal", licence: "cc0", pages: 30 });
    expect(readGalleryIndex(null)).toEqual([]);
    expect(readGalleryIndex({ templates: "no" })).toEqual([]);
  });

  it("says what each entry installs, and offers only safe file types", () => {
    const entries = readGalleryIndex({
      templates: [
        { name: "A planner", download: "https://x.org/t/planner.pdf?raw=1", category: "planner" },
        { name: "B grid", download: "https://x.org/t/grid.PNG", tags: ["Grid", " dots ", 4] },
        { name: "C notebook", download: "https://x.org/t/c.finetemplate" },
        { name: "D vector", download: "https://x.org/t/d.svg" },
        { name: "E archive", download: "https://x.org/t/e.zip" },
        { name: "F sold", shop: "https://shop.example/f", category: "journal" },
        { name: "G odd", download: "https://x.org/g.jpg", category: "spaceships" },
      ],
    });
    expect(entries.map((e) => [e.name, e.kind, e.category])).toEqual([
      ["A planner", "paper", "planner"],
      ["B grid", "paper", "other"],
      ["C notebook", "notebook", "other"],
      ["F sold", "paper", "journal"],
      ["G odd", "paper", "other"],
    ]);
    expect(entries[1].tags).toEqual(["grid", "dots"]);
    // A shop-only entry has nothing to download, only the creator's shop.
    expect(entries[3]).toMatchObject({ download: "", shop: "https://shop.example/f" });
  });

  it("keeps a picture of every page, safe addresses only, in order", () => {
    const [entry] = readGalleryIndex({
      templates: [
        {
          name: "Planner",
          download: "https://x.org/p.pdf",
          previews: [
            "https://x.org/p/page-1.png",
            "javascript:alert(1)",
            42,
            "https://x.org/p/page-2.png",
          ],
        },
      ],
    });
    expect(entry.previews).toEqual(["https://x.org/p/page-1.png", "https://x.org/p/page-2.png"]);
    const [bare] = readGalleryIndex({
      templates: [{ name: "B", download: "https://x.org/b.pdf" }],
    });
    expect(bare.previews).toEqual([]);
  });

  it("finds entries by every word typed, in name, author, description or tags", () => {
    const [entry] = readGalleryIndex({
      templates: [
        {
          name: "Weekly planner",
          author: "Ana",
          description: "Monday start",
          tags: ["hyperlinked"],
          download: "https://x.org/w.pdf",
        },
      ],
    });
    expect(galleryMatches(entry, "")).toBe(true);
    expect(galleryMatches(entry, "weekly ana")).toBe(true);
    expect(galleryMatches(entry, "HYPERLINKED monday")).toBe(true);
    expect(galleryMatches(entry, "weekly daily")).toBe(false);
  });

  it("has FineNotes' own gallery as the default: an https index on GitHub", () => {
    expect(DEFAULT_GALLERY_URL).toBe(
      "https://raw.githubusercontent.com/Joost-8/FineNotes-templates/main/index.json",
    );
  });

  it("reads download counts and dates, ignoring nonsense", () => {
    const entries = readGalleryIndex({
      templates: [
        {
          name: "A",
          download: "https://x.org/a.pdf",
          downloads: 41.7,
          added: "2026-10-01T10:00:00Z",
        },
        { name: "B", download: "https://x.org/b.pdf", downloads: -3, added: "yesterday" },
        { name: "C", download: "https://x.org/c.pdf", downloads: "many" },
      ],
    });
    expect(entries.map((e) => [e.downloads, e.added])).toEqual([
      [41, "2026-10-01T10:00:00Z"],
      [0, ""],
      [0, ""],
    ]);
  });

  it("sorts by downloads, by newest, or by name, ties by name", () => {
    const entries = readGalleryIndex({
      templates: [
        { name: "Cornell", download: "https://x.org/c.pdf", downloads: 5, added: "2026-09-01" },
        { name: "Planner", download: "https://x.org/p.pdf", downloads: 90, added: "2026-08-01" },
        { name: "Dots", download: "https://x.org/d.pdf", downloads: 5, added: "2026-10-10" },
        { name: "Grid", download: "https://x.org/g.pdf" },
      ],
    });
    const names = (sort: Parameters<typeof sortGallery>[1]) =>
      sortGallery(entries, sort).map((e) => e.name);
    expect(names("popular")).toEqual(["Planner", "Cornell", "Dots", "Grid"]);
    expect(names("new")).toEqual(["Dots", "Cornell", "Planner", "Grid"]);
    expect(names("name")).toEqual(["Cornell", "Dots", "Grid", "Planner"]);
    // A copy: the list it was given keeps its order.
    expect(entries.map((e) => e.name)).toEqual(["Cornell", "Dots", "Grid", "Planner"]);
  });

  it("shortens big download counts", () => {
    expect(formatDownloads(0)).toBe("0");
    expect(formatDownloads(980)).toBe("980");
    expect(formatDownloads(1234)).toBe("1.2k");
    expect(formatDownloads(9999)).toBe("9.9k");
    expect(formatDownloads(12_345)).toBe("12k");
    expect(formatDownloads(1_450_000)).toBe("1.4M");
    expect(formatDownloads(-5)).toBe("0");
  });

  it("reads a download's kind from its extension only", () => {
    expect(galleryKindOf("https://a.b/x.jpeg")).toBe("paper");
    expect(galleryKindOf("https://a.b/x.pdf#page=2")).toBe("paper");
    expect(galleryKindOf("https://a.b/x.finetemplate")).toBe("notebook");
    expect(galleryKindOf("https://a.b/x.pdf.exe")).toBeNull();
    expect(galleryKindOf("https://a.b/x")).toBeNull();
  });
});
