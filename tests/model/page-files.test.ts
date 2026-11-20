import { describe, expect, it } from "vitest";
import { stressNotebook } from "../bench/scale-fixtures";
import {
  decodeDocument,
  encodeDocument,
  inkFileText,
  isPageFilesPayload,
  parseInkFile,
  readPageFilesManifest,
  splitDocument,
} from "../../src/model/serialize";
import {
  notebookFolderOfPage,
  notebookStat,
  pageFileNames,
  pageFileText,
  pagePayloadOf,
  pagesFolderOf,
  readPageFilesNotebook,
  resolvePageFile,
} from "../../src/model/page-files";
import { distrust } from "../../src/view/load-guard";
import { needsNewerReader } from "../../src/model/format-features";
import { deflateToBase64 } from "../../src/model/compress";
import type { InkDocument } from "../../src/model/document";

const NOTEBOOK = "Physics/Physics.notebook.md";
const BODY = "---\ntags: [physics]\n---\nMy own prose.";

/** The notebook's file and its page files, as a save would write them. */
function written(doc: InkDocument): { notebook: string; files: Map<string, string> } {
  const split = splitDocument(doc, pageFileNames(doc.pages));
  const files = new Map<string, string>();
  for (const { ref, payload } of split.pages) {
    files.set(resolvePageFile(NOTEBOOK, ref.file) ?? "", pageFileText(payload));
  }
  return { notebook: inkFileText(BODY, split.manifest), files };
}

/** The notebook read back from those files. */
function read(notebook: string, files: Map<string, string>) {
  const parsed = parseInkFile(notebook);
  const manifest = readPageFilesManifest(parsed.payload ?? "");
  if (!manifest) throw new Error("not a page-files notebook");
  return { parsed, ...readPageFilesNotebook(NOTEBOOK, manifest, (path) => files.get(path)) };
}

describe("a notebook kept as one file per page (#274)", () => {
  it("reads back exactly the notebook it was split from", () => {
    const original = decodeDocument(encodeDocument(stressNotebook(6, { density: "typical" })));
    original.pages[2].title = "Waves";
    original.pages[3].bookmarked = true;
    original.recordings = [];
    original.joined = true;
    const { notebook, files } = written(original);
    expect(files.size).toBe(6);
    const back = read(notebook, files);
    expect(back.missing).toEqual([]);
    expect(encodeDocument(back.doc)).toBe(encodeDocument(original));
    expect(back.parsed.body).toBe(BODY);
  });

  it("costs nothing in size: the pages compress about as small apart as together", () => {
    const doc = stressNotebook(10, { density: "typical" });
    const whole = encodeDocument(doc).length;
    const split = splitDocument(doc, pageFileNames(doc.pages));
    const apart = split.pages.reduce((sum, page) => sum + page.payload.length, 0);
    expect(apart / whole).toBeLessThan(1.02);
    // What a save of one page writes, against the whole notebook today.
    expect(split.pages[0].payload.length / whole).toBeLessThan(0.12);
  });

  it("is never decoded as a whole notebook, so no reader saves its empty pages", () => {
    const doc = stressNotebook(2, { density: "light" });
    const { notebook } = written(doc);
    const parsed = parseInkFile(notebook);
    expect(parsed.doc).toBeNull();
    expect(parsed.payload && isPageFilesPayload(parsed.payload)).toBe(true);
    // The view's protected load holds it, as it holds a cut-off sync.
    expect(distrust({ text: notebook, bytesOnDisk: notebook.length, decoded: false })).toBe(
      "unreadable-ink",
    );
    // This build knows the label: it is not a notebook from a newer FineNotes.
    expect(needsNewerReader(parsed.payload ?? "")).toBe(false);
    // A build from before it refuses the label, as it refuses every feature it lacks.
    expect(parsed.payload?.startsWith("v2+page-files:")).toBe(true);
  });

  it("names the features each page uses in its own label", () => {
    const doc = stressNotebook(2, { density: "light" });
    doc.pages[1].board = true;
    const split = splitDocument(doc, pageFileNames(doc.pages));
    expect(split.pages[0].payload.startsWith("v2:")).toBe(true);
    expect(split.pages[1].payload.startsWith("v2+boards:")).toBe(true);
    expect(split.manifest.startsWith("v2+boards+page-files:")).toBe(true);
  });

  it("gives back a page whose file has not arrived as a blank page, and says so", () => {
    const doc = stressNotebook(3, { density: "light" });
    const { notebook, files } = written(doc);
    files.delete("Physics/Pages/p2.md");
    files.set("Physics/Pages/p3.md", "Just a note someone wrote.");
    const back = read(notebook, files);
    expect(back.missing.map((ref) => ref.id)).toEqual(["p2", "p3"]);
    expect(back.doc.pages.map((page) => page.id)).toEqual(["p1", "p2", "p3"]);
    expect(back.doc.pages[1].strokes).toEqual([]);
    expect(back.doc.pages[0].strokes.length).toBeGreaterThan(0);
  });

  it("treats a page from a newer FineNotes as missing", () => {
    const doc = stressNotebook(1, { density: "light" });
    const { notebook, files } = written(doc);
    files.set("Physics/Pages/p1.md", pageFileText(`v2+hovercraft:${deflateToBase64("{}")}`));
    expect(read(notebook, files).missing.map((ref) => ref.id)).toEqual(["p1"]);
  });

  it("takes each page's id from the manifest, and skips a page named twice", () => {
    const doc = stressNotebook(2, { density: "light" });
    const split = splitDocument(doc, ["Pages/a.md", "Pages/b.md"]);
    const manifest = readPageFilesManifest(split.manifest);
    expect(manifest?.refs).toEqual([
      { id: "p1", file: "Pages/a.md" },
      { id: "p2", file: "Pages/b.md" },
    ]);
    const twice = splitDocument({ ...doc, pages: [doc.pages[0], { ...doc.pages[1], id: "p1" }] }, [
      "Pages/a.md",
      "Pages/b.md",
    ]);
    expect(readPageFilesManifest(twice.manifest)?.refs).toEqual([{ id: "p1", file: "Pages/a.md" }]);
    expect(() => splitDocument(doc, ["Pages/a.md"])).toThrow();
  });

  it("is not a manifest when the label does not say so", () => {
    const payload = encodeDocument(stressNotebook(1, { density: "light" }));
    expect(isPageFilesPayload(payload)).toBe(false);
    expect(readPageFilesManifest(payload)).toBeNull();
    expect(isPageFilesPayload("no label")).toBe(false);
    expect(() => readPageFilesManifest("v2+page-files:@@@")).toThrow();
  });
});

describe("page files", () => {
  it("hold one block, read back with either line ending", () => {
    const text = pageFileText("v2:abc");
    expect(text).toBe("%%finenotes-page\nv2:abc\n%%\n");
    expect(pagePayloadOf(text)).toBe("v2:abc");
    expect(pagePayloadOf(text.replace(/\n/g, "\r\n"))).toBe("v2:abc");
    expect(pagePayloadOf("%%goodobsidian\nv2:abc\n%%\n")).toBeNull();
  });

  it("are named by page id, unique ignoring case, and by place when an id is unsafe", () => {
    expect(
      pageFileNames([{ id: "p1" }, { id: "P1" }, { id: "p1" }, { id: "../x" }, { id: "" }]),
    ).toEqual([
      "Pages/p1.md",
      "Pages/P1-2.md",
      "Pages/p1-3.md",
      "Pages/page-4.md",
      "Pages/page-5.md",
    ]);
  });

  it("resolve below the notebook's folder and nowhere else", () => {
    expect(resolvePageFile(NOTEBOOK, "Pages/p1.md")).toBe("Physics/Pages/p1.md");
    expect(resolvePageFile("Loose.notebook.md", "Pages/p1.md")).toBe("Pages/p1.md");
    for (const bad of ["../p1.md", "Pages/../../p1.md", "/p1.md", "Pages\\p1.md", "Pages//p1.md"]) {
      expect(resolvePageFile(NOTEBOOK, bad)).toBeNull();
    }
    expect(resolvePageFile(NOTEBOOK, "Pages/p1.json")).toBeNull();
    expect(pagesFolderOf(NOTEBOOK)).toBe("Physics/Pages");
    expect(pagesFolderOf("Loose.notebook.md")).toBe("Pages");
  });

  it("lead back to their notebook's folder", () => {
    expect(notebookFolderOfPage("Physics/Pages/p1.md")).toBe("Physics");
    expect(notebookFolderOfPage("Pages/p1.md")).toBe("");
    expect(notebookFolderOfPage("Physics/Images/p1.md")).toBeNull();
    expect(notebookFolderOfPage("Physics/Pages/p1.png")).toBeNull();
  });
});

describe("a notebook's stat", () => {
  it("is the file's own without page files, and changes with any page", () => {
    const file = { mtime: 10, size: 100 };
    expect(notebookStat(file, [])).toEqual(file);
    const pages = [
      { mtime: 5, size: 50 },
      { mtime: 7, size: 70 },
    ];
    expect(notebookStat(file, pages)).toEqual({ mtime: 10, size: 220 });
    // A page saved later than the notebook file: newer.
    expect(notebookStat(file, [pages[0], { mtime: 12, size: 70 }])).toEqual({
      mtime: 12,
      size: 220,
    });
    // A page rewritten bigger, or one gone: another size.
    expect(notebookStat(file, [pages[0], { mtime: 7, size: 71 }]).size).toBe(221);
    expect(notebookStat(file, [pages[0]]).size).toBe(150);
  });
});
