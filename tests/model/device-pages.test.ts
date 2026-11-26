import { describe, expect, it } from "vitest";
import { stressNotebook } from "../bench/scale-fixtures";
import {
  decodeDocument,
  encodeDocument,
  encodeDocumentWith,
  inkFileText,
  parseInkFile,
} from "../../src/model/serialize";
import {
  devicePagesFolderOf,
  devicePagesFolderOfFile,
  isDevicePagesPayload,
  metaFileText,
  metaPayloadOf,
  notebookIdOf,
  notebookIdOfText,
  notebookStat,
  pageFileText,
  pagesFolderMove,
  pagePayloadOf,
  payloadHash,
  readDeviceFileName,
  readDevicePagesNotebook,
  readMetaFile,
  readPageFile,
} from "../../src/model/device-pages";
import { joinDevicePages, orderKeyAt } from "../../src/model/device-pages-union";
import { deflateToBase64 } from "../../src/model/compress";
import { distrust } from "../../src/view/load-guard";
import { needsNewerReader } from "../../src/model/format-features";
import { blankPage, emptyDocument, type InkDocument } from "../../src/model/document";

const A = "aaaa1111";
const B = "bbbb2222";

/** A stroke as stored, made on `device` as its `n`th change. */
function stroke(id: string, d?: string): Record<string, unknown> {
  return {
    id,
    ...(d ? { d } : {}),
    color: "#1a1a1a",
    size: 3,
    tool: "pen",
    pts: [1000, 2000, 128, 3000, 4000, 128],
  };
}

/** A labelled payload of `json`. */
function payloadOf(json: unknown, label = "v2"): string {
  return `${label}:${deflateToBase64(JSON.stringify(json))}`;
}

/** A page file's text, as a writer would make it. */
function pageFile(json: Record<string, unknown>): string {
  return pageFileText(payloadOf(json));
}

/** A meta's text, its page files' hashes taken from `files`. */
function metaFile(
  device: string,
  json: Record<string, unknown>,
  files: Record<string, string> = {},
): string {
  const hashes: Record<string, { rev: number; hash: string }> = {};
  for (const [page, text] of Object.entries(files)) {
    const payload = pagePayloadOf(text) ?? "";
    const rev = (readPageFile(text, device) as { rev: number }).rev;
    hashes[page] = { rev, hash: payloadHash(payload) };
  }
  return metaFileText(payloadOf({ dev: device, files: hashes, ...json }));
}

/** A notebook of `doc` moved to the layout: its payload kept as the legacy source. */
function legacyOf(doc: InkDocument): string {
  return encodeDocumentWith(doc, ["device-pages"]);
}

/** A two-page legacy notebook, one stroke `s1` on p1. */
function twoPages(): InkDocument {
  const doc = emptyDocument(1024);
  doc.pages = [blankPage("p1"), blankPage("p2")];
  doc.pages[0].strokes.push({
    id: "s1",
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pts: [10, 20, 0.5, 30, 40, 0.5],
  } as never);
  return doc;
}

const read = (legacy: InkDocument, files: Record<string, string>) =>
  readDevicePagesNotebook(legacyOf(legacy), new Map(Object.entries(files)));
const strokeIds = (doc: InkDocument, page = 0) => doc.pages[page].strokes.map((s) => s.id);

describe("the notebook file of the layout (#274)", () => {
  it("is never decoded as a whole notebook, so no save puts the old pages back", () => {
    const text = inkFileText("Prose.", legacyOf(twoPages()));
    const parsed = parseInkFile(text);
    expect(parsed.doc).toBeNull();
    expect(parsed.payload?.startsWith("v2+device-pages:")).toBe(true);
    expect(isDevicePagesPayload(parsed.payload ?? "")).toBe(true);
    expect(() => decodeDocument(parsed.payload ?? "")).toThrow(/files of their own/);
    // Held read-only, as a cut-off sync is; and this build knows the label.
    expect(distrust({ text, bytesOnDisk: text.length, decoded: false })).toBe("unreadable-ink");
    expect(needsNewerReader(parsed.payload ?? "")).toBe(false);
    expect(isDevicePagesPayload(encodeDocument(twoPages()))).toBe(false);
  });

  it("names its id in its label, and nothing unsafe passes as one", () => {
    expect(notebookIdOf("v2+device-pages=n7k2q9ab:abc")).toBe("n7k2q9ab");
    expect(notebookIdOf("v2+boards+device-pages=n7k2:abc")).toBe("n7k2");
    // Twice (Sync's merge applying one edit twice): the first.
    expect(notebookIdOf("v2+device-pages=n7k2+device-pages=n7k2:abc")).toBe("n7k2");
    expect(notebookIdOf("v2+device-pages:abc")).toBeNull();
    expect(notebookIdOf("v2:abc")).toBeNull();
    for (const bad of ["../x", "a/b", "", "a b"]) {
      expect(notebookIdOf(`v2+device-pages=${bad}:abc`)).toBeNull();
    }
    // A value on any other feature is a label this build cannot read.
    expect(isDevicePagesPayload("v2+boards=x:abc")).toBe(false);
    expect(needsNewerReader("v2+boards=x:abc")).toBe(true);
    const file = inkFileText("---\ntags: [x]\n---\nProse.", "v2+device-pages=n7k2q9ab:abc");
    expect(notebookIdOfText(file)).toBe("n7k2q9ab");
    expect(notebookIdOfText("No block here.")).toBeNull();
  });
});

describe("the page folder (#274)", () => {
  it("is named by the notebook's id, so two notebooks in one folder never meet", () => {
    expect(devicePagesFolderOf("Physics/Physics.notebook.md", "n7k2")).toBe("Physics/Pages/n7k2");
    expect(devicePagesFolderOf("Physics/Waves.notebook.md", "q3x9")).toBe("Physics/Pages/q3x9");
    expect(devicePagesFolderOf("Loose.notebook.md", "n7k2")).toBe("Pages/n7k2");
  });

  it("holds page files and metas, told apart by name", () => {
    expect(readDeviceFileName(`p1.${A}.md`)).toEqual({ kind: "page", device: A });
    expect(readDeviceFileName(`${A}.7.${B}.md`)).toEqual({ kind: "page", device: B });
    expect(readDeviceFileName(`_meta.${A}.md`)).toEqual({ kind: "meta", device: A });
    for (const bad of ["p1.md", `p1.${A}.json`, `.${A}.md`, "p1.A B.md", `x/p1.${A}.md`]) {
      expect(readDeviceFileName(bad)).toBeNull();
    }
  });

  it("leads a file back to its folder", () => {
    expect(devicePagesFolderOfFile(`Physics/Pages/n7k2/p1.${A}.md`)).toBe("Physics/Pages/n7k2");
    expect(devicePagesFolderOfFile(`Pages/n7k2/_meta.${A}.md`)).toBe("Pages/n7k2");
    expect(devicePagesFolderOfFile(`Physics/Images/n7k2/p1.${A}.md`)).toBeNull();
    expect(devicePagesFolderOfFile(`Physics/Pages/p1.${A}.md`)).toBeNull();
    expect(devicePagesFolderOfFile("Physics/Pages/n7k2/notes.md")).toBeNull();
  });
});

describe("a notebook moved (#274)", () => {
  it("takes exactly its own page folder along, and never another's", () => {
    const there = new Set(["Uni/Pages/n7k2", "Uni/Pages/q3x9", "Old/Pages/n7k2"]);
    const exists = (path: string) => there.has(path);
    expect(pagesFolderMove("Uni/A.notebook.md", "Course/A.notebook.md", "n7k2", exists)).toEqual({
      from: "Uni/Pages/n7k2",
      to: "Course/Pages/n7k2",
    });
    // Renamed in its folder, or its own folder moved with it: nothing to move.
    expect(pagesFolderMove("Uni/A.notebook.md", "Uni/B.notebook.md", "n7k2", exists)).toBeNull();
    expect(pagesFolderMove("X/A.notebook.md", "Y/A.notebook.md", "n7k2", exists)).toBeNull();
    // Something already at the new place (a copy with this id): left alone.
    expect(pagesFolderMove("Uni/A.notebook.md", "Old/A.notebook.md", "n7k2", exists)).toBeNull();
    // Not its folder, even with pages beside it.
    expect(pagesFolderMove("Uni/A.notebook.md", "Course/A.notebook.md", "zz99", exists)).toBeNull();
  });
});

describe("page and meta files (#274)", () => {
  it("hold one block each, read with either line ending", () => {
    expect(pagePayloadOf(pageFileText("v2:abc").replace(/\n/g, "\r\n"))).toBe("v2:abc");
    expect(metaPayloadOf(metaFileText("v2:abc"))).toBe("v2:abc");
    expect(pagePayloadOf(metaFileText("v2:abc"))).toBeNull();
    expect(readPageFile("Just a note.", A)).toBe("not-a-file");
  });

  it("are hashed with FNV-1a 64 of the payload", () => {
    expect(payloadHash("")).toBe("cbf29ce484222325");
    expect(payloadHash("a")).toBe("af63dc4c8601ec8c");
    expect(payloadHash("foobar")).toBe("85944171f73967e8");
    expect(payloadHash(" a\n")).toBe(payloadHash("a"));
  });

  it("are read only as the device their name says wrote them", () => {
    const text = pageFile({ dev: A, page: "p1", rev: 3, vv: { [A]: 4 }, strokes: [stroke("x")] });
    const page = readPageFile(text, A);
    expect(page).toMatchObject({ device: A, page: "p1", rev: 3, vv: { [A]: 4 } });
    expect(readPageFile(text, B)).toBe("unreadable");
    expect(readPageFile(pageFile({ dev: A, rev: 1 }), A)).toBe("unreadable");
    expect(readPageFile(pageFileText(payloadOf({}, "v2+hovercraft")), A)).toBe("newer");
    expect(readPageFile(pageFileText("v2:@@@"), A)).toBe("unreadable");
  });

  it("skip meta entries that cannot be read, and a page named twice", () => {
    const meta = readMetaFile(
      metaFileText(
        payloadOf({
          dev: A,
          vv: { [A]: 2 },
          settings: { c: 3, view: { width: 800 }, pages: ["ignored"] },
          pages: [
            { id: "p1", key: "a", c: 1, title: "One", strokes: ["not a field"] },
            { id: "p1", key: "b", c: 9 },
            { id: "p2", key: 3, c: 1 },
            { id: "p3", key: "c", c: 2, gone: true },
          ],
          files: { p1: { rev: 2, hash: "h" }, p2: { rev: "x" } },
        }),
      ),
      A,
    );
    expect(meta).toEqual({
      device: A,
      vv: { [A]: 2 },
      settings: { c: 3, head: { view: { width: 800 } } },
      pages: [
        { id: "p1", key: "a", c: 1, gone: false, fields: { title: "One" } },
        { id: "p3", key: "c", c: 2, gone: true, fields: {} },
      ],
      files: { p1: { rev: 2, hash: "h" } },
    });
    expect(readMetaFile(metaFileText(payloadOf({ dev: B })), A)).toBe("unreadable");
  });
});

describe("a notebook joined from its devices' files (#274)", () => {
  it("is the legacy notebook while no device has written", () => {
    const doc = decodeDocument(encodeDocument(stressNotebook(4, { density: "typical" })));
    doc.pages[1].title = "Waves";
    const back = readDevicePagesNotebook(legacyOf(doc), new Map());
    expect(encodeDocument(back.doc)).toBe(encodeDocument(doc));
    expect(back.syncing).toBe(false);
  });

  it("is the union of every device's ink on a page, legacy first, then devices by id", () => {
    const files = {
      [`p1.${B}.md`]: pageFile({
        dev: B,
        page: "p1",
        rev: 1,
        strokes: [stroke(`${B}.1`, `${B}.1`)],
      }),
      [`p1.${A}.md`]: pageFile({
        dev: A,
        page: "p1",
        rev: 1,
        strokes: [stroke(`${A}.1`, `${A}.1`)],
      }),
      [`p2.${A}.md`]: pageFile({
        dev: A,
        page: "p2",
        rev: 1,
        strokes: [stroke(`${A}.2`, `${A}.2`)],
      }),
    };
    const { doc } = read(twoPages(), files);
    expect(strokeIds(doc, 0)).toEqual(["s1", `${A}.1`, `${B}.1`]);
    expect(strokeIds(doc, 1)).toEqual([`${A}.2`]);
  });

  it("drops an element only through a tombstone that saw that version", () => {
    const files = {
      // B erased legacy s1 and A's stroke, having seen A up to 1.
      [`p1.${B}.md`]: pageFile({
        dev: B,
        page: "p1",
        rev: 1,
        vv: { [A]: 1, [B]: 1 },
        tomb: [{ id: "s1" }, { id: `${A}.1`, d: `${A}.1` }, { id: `${A}.2`, d: `${A}.2` }],
      }),
      // Meanwhile A moved its stroke a.1 (now d = a.3), and has a.2 still.
      [`p1.${A}.md`]: pageFile({
        dev: A,
        page: "p1",
        rev: 2,
        vv: { [A]: 3 },
        strokes: [stroke(`${A}.1`, `${A}.3`), stroke(`${A}.2`, `${A}.2`)],
      }),
    };
    const { doc } = read(twoPages(), files);
    // s1 erased; a.1's move beats the erase; a.2's tombstone names its version: erased.
    expect(strokeIds(doc)).toEqual([`${A}.1`]);
  });

  it("never reads absence as an erase: a stale or missing file only hides ink for a while", () => {
    const fresh = pageFile({
      dev: A,
      page: "p1",
      rev: 2,
      vv: { [A]: 2 },
      strokes: [stroke(`${A}.1`, `${A}.1`), stroke(`${A}.2`, `${A}.2`)],
    });
    const old = pageFile({
      dev: A,
      page: "p1",
      rev: 1,
      vv: { [A]: 1 },
      strokes: [stroke(`${A}.1`, `${A}.1`)],
    });
    const meta = metaFile(A, { vv: { [A]: 2 } }, { p1: fresh });
    // The meta arrived, the page file is still the old one.
    const stale = read(twoPages(), { [`_meta.${A}.md`]: meta, [`p1.${A}.md`]: old });
    expect(strokeIds(stale.doc)).toEqual(["s1", `${A}.1`]);
    expect(stale.stale).toEqual(["p1"]);
    expect(stale.syncing).toBe(true);
    // No file at all yet: the legacy ink stays, and the page is marked.
    const gone = read(twoPages(), { [`_meta.${A}.md`]: meta });
    expect(strokeIds(gone.doc)).toEqual(["s1"]);
    expect(gone.missing).toEqual(["p1"]);
    // The same rev with other content is out of step too.
    const other = read(twoPages(), {
      [`_meta.${A}.md`]: meta,
      [`p1.${A}.md`]: pageFile({ dev: A, page: "p1", rev: 2, strokes: [] }),
    });
    expect(other.stale).toEqual(["p1"]);
    // Up to date: no mark.
    const now = read(twoPages(), { [`_meta.${A}.md`]: meta, [`p1.${A}.md`]: fresh });
    expect(now.syncing).toBe(false);
    expect(strokeIds(now.doc)).toEqual(["s1", `${A}.1`, `${A}.2`]);
    // A page file ahead of its meta (the meta is late) is shown as it is.
    const late = read(twoPages(), {
      [`_meta.${A}.md`]: metaFile(A, {}, { p1: old }),
      [`p1.${A}.md`]: fresh,
    });
    expect(late.syncing).toBe(false);
  });

  it("orders pages by key, takes each page's newest entry, and leaves out a gone page", () => {
    const files = {
      [`_meta.${A}.md`]: metaFile(A, {
        pages: [
          { id: `${A}.5`, key: `${orderKeyAt(0)}V`, c: 4, title: "Added between" },
          { id: "p2", key: orderKeyAt(1), c: 2, title: "A's title" },
        ],
      }),
      [`_meta.${B}.md`]: metaFile(B, {
        pages: [
          { id: "p2", key: orderKeyAt(1), c: 2, title: "B's title" },
          { id: "p1", key: orderKeyAt(0), c: 1, gone: true },
        ],
      }),
    };
    const { doc } = read(twoPages(), files);
    expect(doc.pages.map((page) => page.id)).toEqual([`${A}.5`, "p2"]);
    // Same clock: the higher device id wins.
    expect(doc.pages[1].title).toBe("B's title");
    expect(doc.pages[0].title).toBe("Added between");
  });

  it("shows a page known only from its file after the rest, marked", () => {
    const files = {
      [`${B}.9.${B}.md`]: pageFile({ dev: B, page: `${B}.9`, rev: 1, strokes: [stroke(`${B}.8`)] }),
    };
    const back = read(twoPages(), files);
    expect(back.doc.pages.map((page) => page.id)).toEqual(["p1", "p2", `${B}.9`]);
    expect(back.unlisted).toEqual([`${B}.9`]);
    expect(back.syncing).toBe(true);
  });

  it("takes the settings with the newest clock", () => {
    const legacy = twoPages();
    legacy.joined = true;
    const files = {
      [`_meta.${A}.md`]: metaFile(A, {
        settings: { c: 2, version: 2, view: legacy.view, meta: { scroll: "horizontal" } },
      }),
      [`_meta.${B}.md`]: metaFile(B, {
        settings: { c: 1, version: 2, view: legacy.view, meta: { readOnly: true } },
      }),
    };
    const { doc } = read(legacy, files);
    expect(doc.scroll).toBe("horizontal");
    expect(doc.joined).toBeUndefined();
    expect(doc.readOnly).toBeUndefined();
    expect(read(legacy, {}).doc.joined).toBe(true);
  });

  it("lists files it cannot read, and those from a newer FineNotes, without dropping ink", () => {
    const back = read(twoPages(), {
      [`p1.${A}.md`]: pageFileText("v2:@@@"),
      [`p1.${B}.md`]: pageFileText(payloadOf({}, "v2+hovercraft")),
      "notes.md": "Not one of ours",
    });
    expect(back.unreadable).toEqual([`p1.${A}.md`]);
    expect(back.newer).toEqual([`p1.${B}.md`]);
    expect(strokeIds(back.doc)).toEqual(["s1"]);
    expect(back.syncing).toBe(true);
  });

  it("joins the same id met twice to the version the other did not see", () => {
    const union = joinDevicePages({
      legacy: null,
      metas: [],
      pages: [
        {
          device: A,
          page: "p1",
          rev: 1,
          vv: { [A]: 1 },
          hash: "",
          lists: { strokes: [{ ...stroke("x", `${A}.1`), color: "#old" }] },
          tomb: [],
        },
        {
          device: B,
          page: "p1",
          rev: 1,
          vv: { [A]: 1, [B]: 2 },
          hash: "",
          lists: { strokes: [{ ...stroke("x", `${B}.2`), color: "#new" }] },
          tomb: [],
        },
      ],
    });
    const pages = union.stored.pages as { strokes: { color: string }[] }[];
    expect(pages[0].strokes.map((s) => s.color)).toEqual(["#new"]);
    expect(union.vv).toEqual({ [A]: 1, [B]: 2 });
  });

  it("keeps the element's own device's edit when two were made at once", () => {
    const page = (device: string, color: string, d: string) => ({
      device,
      page: "p1",
      rev: 1,
      vv: { [device]: 5 },
      hash: "",
      lists: { strokes: [{ ...stroke(`${B}.1`, d), color }] },
      tomb: [],
    });
    for (const order of [
      [page(A, "#a", `${A}.5`), page(B, "#b", `${B}.5`)],
      [page(B, "#b", `${B}.5`), page(A, "#a", `${A}.5`)],
    ]) {
      const union = joinDevicePages({ legacy: null, metas: [], pages: order });
      const pages = union.stored.pages as { strokes: { color: string }[] }[];
      expect(pages[0].strokes.map((s) => s.color)).toEqual(["#b"]);
    }
  });
});

describe("a notebook's stat with its page files (#274)", () => {
  it("is the file's own without them, and changes with any of them", () => {
    const file = { mtime: 10, size: 100 };
    expect(notebookStat(file, [])).toEqual(file);
    expect(
      notebookStat(file, [
        { mtime: 5, size: 50 },
        { mtime: 12, size: 70 },
      ]),
    ).toEqual({
      mtime: 12,
      size: 220,
    });
  });
});
