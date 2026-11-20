import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { NotebookPages, notebookStatOf } = await import("../../src/view/library-pages");
const { blankPage, emptyDocument } = await import("../../src/model/document");
const { buildInkFile, inkFileText, splitDocument } = await import("../../src/model/serialize");
const { pageFileNames, pageFileText } = await import("../../src/model/page-files");

const NOTEBOOK = "Physics/Physics.notebook.md";

/** A file with a given change time and size. */
function fileAt(path: string, mtime: number, size: number): TFile {
  const file = new TFile(path, size);
  file.stat.mtime = mtime;
  return file;
}

/** A vault of `texts` by path; a `Pages/` folder lists the files under it. */
function vaultOf(texts: Map<string, string>, stamps = new Map<string, number>()) {
  const files = new Map<string, TFile>();
  for (const [path, text] of texts)
    files.set(path, fileAt(path, stamps.get(path) ?? 1, text.length));
  const folders = new Map<string, TFolder & { children: TFile[] }>();
  for (const file of files.values()) {
    const folder = file.path.slice(0, file.path.lastIndexOf("/"));
    if (!folder.endsWith("/Pages")) continue;
    const entry = folders.get(folder) ?? Object.assign(new TFolder(folder), { children: [] });
    entry.children.push(file);
    folders.set(folder, entry);
  }
  return {
    files,
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path) ?? null,
        read: (file: TFile) => Promise.resolve(texts.get(file.path) ?? ""),
        cachedRead: (file: TFile) => Promise.resolve(texts.get(file.path) ?? ""),
      },
    },
  };
}

/** A notebook of three pages, kept as one file per page; page 2 has ink. */
function pageFilesNotebook(): Map<string, string> {
  const doc = emptyDocument(1024);
  doc.pages = [blankPage("p1"), blankPage("p2"), blankPage("p3")];
  doc.pages[1].strokes.push({
    id: "s1",
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pts: [10, 20, 0.5, 30, 40, 0.5],
  } as never);
  doc.pages[2].title = "Waves";
  const split = splitDocument(doc, pageFileNames(doc.pages));
  const texts = new Map([[NOTEBOOK, inkFileText("# Physics", split.manifest)]]);
  for (const { ref, payload } of split.pages)
    texts.set(`Physics/${ref.file}`, pageFileText(payload));
  return texts;
}

describe("Home reading a notebook kept as one file per page (#274)", () => {
  it("counts its pages and reads its text from the page files", async () => {
    const { app, files } = vaultOf(pageFilesNotebook());
    const pages = new NotebookPages(app as never, () => null as never);
    const { entry, text } = await pages.readEntry(files.get(NOTEBOOK) as never, 5);
    expect(entry.pages).toBe(3);
    expect(entry.path).toBe(NOTEBOOK);
    expect(text?.length).toBe(3);
  });

  it("still reads a one-file notebook that sits beside a folder named Pages", async () => {
    const doc = emptyDocument(1024);
    doc.pages.push(blankPage("p2"));
    const texts = new Map([
      [NOTEBOOK, buildInkFile("# Physics", doc)],
      ["Physics/Pages/Someone's note.md", "Hello"],
    ]);
    const { app, files } = vaultOf(texts);
    const pages = new NotebookPages(app as never, () => null as never);
    const { entry } = await pages.readEntry(files.get(NOTEBOOK) as never, 5);
    expect(entry.pages).toBe(2);
  });

  it("sees a page saved without the notebook file changing", () => {
    const texts = pageFilesNotebook();
    const before = vaultOf(texts, new Map([[NOTEBOOK, 10]]));
    const after = vaultOf(
      texts,
      new Map([
        [NOTEBOOK, 10],
        ["Physics/Pages/p2.md", 20],
      ]),
    );
    const was = notebookStatOf(before.app as never, before.files.get(NOTEBOOK) as never);
    const now = notebookStatOf(after.app as never, after.files.get(NOTEBOOK) as never);
    expect(now.mtime).toBe(20);
    expect(now.mtime).not.toBe(was.mtime);
    // A notebook without page files keeps its own file's stat.
    const plain = vaultOf(new Map([["Other.notebook.md", "x"]]));
    const file = plain.files.get("Other.notebook.md") as TFile;
    expect(notebookStatOf(plain.app as never, file as never)).toBe(file.stat);
  });
});
