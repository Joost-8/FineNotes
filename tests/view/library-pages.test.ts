import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { NotebookPages, notebookStatOf } = await import("../../src/view/library-pages");
const { rememberNotebookId } = await import("../../src/view/device-pages-files");
const { blankPage, emptyDocument } = await import("../../src/model/document");
const { buildInkFile, encodeDocumentWith, inkFileText } = await import("../../src/model/serialize");
const { pageFileText } = await import("../../src/model/device-pages");
const { deflateToBase64 } = await import("../../src/model/compress");

const NOTEBOOK = "Physics/Physics.notebook.md";
const FOLDER = "Physics/Pages/n7k2q9ab";

/** A file with a given change time and size. */
function fileAt(path: string, mtime: number, size: number): TFile {
  const file = new TFile(path, size);
  file.stat.mtime = mtime;
  return file;
}

/**
 * A vault of `texts` by path. The notebook's frontmatter id is what the
 * metadata cache reports, and its page folder lists the files under it.
 */
function vaultOf(texts: Map<string, string>, stamps = new Map<string, number>()) {
  const files = new Map<string, TFile>();
  for (const [path, text] of texts) {
    files.set(path, fileAt(path, stamps.get(path) ?? 1, text.length));
  }
  const children = [...files.values()].filter((file) => file.path.startsWith(`${FOLDER}/`));
  const folder = Object.assign(new TFolder(FOLDER), { children });
  return {
    files,
    app: {
      vault: {
        getAbstractFileByPath: (path: string) =>
          files.get(path) ?? (path === FOLDER && children.length > 0 ? folder : null),
        read: (file: TFile) => Promise.resolve(texts.get(file.path) ?? ""),
        cachedRead: (file: TFile) => Promise.resolve(texts.get(file.path) ?? ""),
      },
      metadataCache: { getFileCache: () => null },
    },
  };
}

/** A notebook of three pages moved to the layout; device a1 wrote on p2 and named p3. */
function devicePagesNotebook(): Map<string, string> {
  const doc = emptyDocument(1024);
  doc.pages = [blankPage("p1"), blankPage("p2"), blankPage("p3")];
  doc.pages[2].title = "Waves";
  const page = {
    dev: "a1",
    page: "p2",
    rev: 1,
    strokes: [{ id: "a1.1", tool: "pen", color: "#1a1a1a", size: 3, pts: [1, 2, 128] }],
  };
  const body = "# Physics";
  return new Map([
    [
      NOTEBOOK,
      inkFileText(
        body,
        encodeDocumentWith(doc, ["device-pages"]).replace(
          "+device-pages:",
          "+device-pages=n7k2q9ab:",
        ),
      ),
    ],
    [`${FOLDER}/p2.a1.md`, pageFileText(`v2:${deflateToBase64(JSON.stringify(page))}`)],
  ]);
}

describe("Home reading a notebook kept as one file per page per device (#274)", () => {
  it("counts its pages and reads its text from the files", async () => {
    const { app, files } = vaultOf(devicePagesNotebook());
    const pages = new NotebookPages(app as never, () => null as never);
    const { entry, text } = await pages.readEntry(files.get(NOTEBOOK) as never, 5);
    expect(entry.pages).toBe(3);
    expect(entry.path).toBe(NOTEBOOK);
    expect(text?.length).toBe(3);
  });

  it("still reads a one-file notebook with an id, beside a page folder", async () => {
    const doc = emptyDocument(1024);
    doc.pages.push(blankPage("p2"));
    const texts = new Map([
      [NOTEBOOK, buildInkFile("# Physics", doc)],
      [`${FOLDER}/Someone's note.md`, "Hello"],
    ]);
    const { app, files } = vaultOf(texts);
    const pages = new NotebookPages(app as never, () => null as never);
    const { entry } = await pages.readEntry(files.get(NOTEBOOK) as never, 5);
    expect(entry.pages).toBe(2);
  });

  it("sees a page file saved without the notebook file changing, once it has read it", async () => {
    const texts = devicePagesNotebook();
    const before = vaultOf(texts, new Map([[NOTEBOOK, 10]]));
    const after = vaultOf(
      texts,
      new Map([
        [NOTEBOOK, 10],
        [`${FOLDER}/p2.a1.md`, 20],
      ]),
    );
    // Before any read the id is unknown (it is in the file's label): the file's own stat.
    const file = after.files.get(NOTEBOOK) as TFile;
    rememberNotebookId(NOTEBOOK, null);
    expect(notebookStatOf(after.app as never, file as never)).toBe(file.stat);
    // Home reads it: from then on its page files count.
    const pages = new NotebookPages(before.app as never, () => null as never);
    await pages.readEntry(before.files.get(NOTEBOOK) as never, 5);
    const was = notebookStatOf(before.app as never, before.files.get(NOTEBOOK) as never);
    const now = notebookStatOf(after.app as never, file as never);
    expect(was.mtime).toBe(10);
    expect(now.mtime).toBe(20);
  });
});
