/**
 * The Folders sidebar's search index end to end, on a vault in memory: notes,
 * a notebook's text boxes, a PDF's text, and the text FineNotes' OCR wrote for
 * a scanned PDF (read from <this plugin's folder>/ocr/<sha-256>.json, in the
 * format FineNotes writes). IndexedDB and pdf.js are small stand-ins.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, resetFakes } from "./fake-obsidian";
import { installDomGlobals } from "./stub-dom";
import { deflateToBase64 } from "../../src/model/compress";
import {
  cachePath,
  emptyCache,
  serializeCache,
  withPage,
} from "../../src/recognition/ocr/ocr-cache";

const pdf = vi.hoisted(() => ({
  /** The text of each page of each PDF, by path. */
  pages: new Map<string, string[]>(),
}));

vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  loadPdfJs: () =>
    Promise.resolve({
      getDocument: ({ data }: { data: Uint8Array }) => ({
        promise: Promise.resolve({
          numPages: (pdf.pages.get(String(data[0])) ?? []).length,
          getPage: (number: number) =>
            Promise.resolve({
              getTextContent: () =>
                Promise.resolve({
                  items: [{ str: (pdf.pages.get(String(data[0])) ?? [])[number - 1] ?? "" }],
                }),
              cleanup: () => {},
            }),
          destroy: () => Promise.resolve(),
        }),
      }),
    }),
}));

const { FolderSearchIndex } = await import("../../src/view/folder-sidebar/search-index");

/** An IndexedDB with one object store, in memory. */
function fakeIndexedDb() {
  const data = new Map<string, Record<string, unknown>>();
  const request = (run: () => unknown) => {
    const made: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
    setTimeout(() => {
      made.result = run();
      made.onsuccess?.();
    }, 0);
    return made;
  };
  const store = {
    getAllKeys: () => request(() => [...data.keys()]),
    get: (key: string) => request(() => structuredClone(data.get(key))),
    put: (value: Record<string, unknown>) =>
      request(() => data.set(value.path as string, structuredClone(value))),
    delete: (key: string) => request(() => data.delete(key)),
    clear: () => request(() => data.clear()),
  };
  return {
    data,
    open: () => {
      const opened: {
        result: unknown;
        onupgradeneeded?: () => void;
        onsuccess?: () => void;
        onerror?: () => void;
      } = {
        result: {
          createObjectStore: () => {},
          transaction: () => ({ objectStore: () => store }),
          close: () => {},
        },
      };
      setTimeout(() => {
        opened.onupgradeneeded?.();
        opened.onsuccess?.();
      }, 0);
      return opened;
    },
  };
}

interface Disk {
  /** Vault files by path: their text, or their bytes. */
  text: Map<string, string>;
  bytes: Map<string, Uint8Array>;
  /** Plugin-folder files by path (the OCR cache). */
  plugin: Map<string, string>;
}

function setUp(disk: Disk) {
  const files = new Map<string, TFile>();
  for (const path of [...disk.text.keys(), ...disk.bytes.keys()]) {
    const file = new TFile(path, disk.bytes.get(path)?.length ?? disk.text.get(path)?.length ?? 1);
    Object.assign(file.stat, { mtime: 1000, ctime: 1000 });
    files.set(path, file);
  }
  const app = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: (file: TFile) => Promise.resolve(disk.text.get(file.path) ?? ""),
      adapter: {
        readBinary: (path: string) => {
          const bytes = disk.bytes.get(path);
          if (!bytes) return Promise.reject(new Error(`no ${path}`));
          return Promise.resolve(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
          );
        },
        exists: (path: string) =>
          Promise.resolve(
            [...disk.plugin.keys()].some((key) => key === path || key.startsWith(`${path}/`)),
          ),
        list: (folder: string) =>
          Promise.resolve({
            files: [...disk.plugin.keys()].filter(
              (key) => key.startsWith(`${folder}/`) && !key.slice(folder.length + 1).includes("/"),
            ),
            folders: [],
          }),
        read: (path: string) => Promise.resolve(disk.plugin.get(path) ?? ""),
        stat: () => Promise.resolve({ mtime: 5 }),
      },
    },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: (link: string) => files.get(link) ?? null,
    },
  };
  return { app, files };
}

const notebook = (pages: unknown[]) =>
  `# Biology\n\n%%goodobsidian\nv2:${deflateToBase64(JSON.stringify({ pages }))}\n%%\n`;

const word = (text: string) => ({
  text,
  box: [0, 0, 10, 10] as [number, number, number, number],
  conf: 0.9,
  min: 0.8,
});

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

let indexedDb: ReturnType<typeof fakeIndexedDb>;

beforeEach(() => {
  resetFakes();
  installDomGlobals(vi.stubGlobal.bind(vi));
  indexedDb = fakeIndexedDb();
  (globalThis as unknown as { activeWindow: Record<string, unknown> }).activeWindow.indexedDB =
    indexedDb;
  pdf.pages.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Wait until the index has nothing queued and is not running. */
async function settled(index: InstanceType<typeof FolderSearchIndex>): Promise<void> {
  await vi.waitFor(
    () => {
      const status = index.getStatus();
      expect(status.running || status.queued > 0).toBe(false);
    },
    { timeout: 4000, interval: 25 },
  );
  // The OCR pass runs after the queue is empty.
  await new Promise((resolve) => setTimeout(resolve, 150));
}

describe("the search index", () => {
  const PLUGIN = ".obsidian/plugins/finenotes";

  function vault(extra: Partial<Disk> = {}): Disk {
    return {
      text: new Map([
        [
          "Notes/Cells.md",
          "Mitochondria are the powerhouse of the cell.\n\n%%goodobsidian\nsecret\n%%",
        ],
        [
          "School/Biology.notebook.md",
          notebook([
            { textBoxes: [{ text: "Photosynthesis happens in chloroplasts" }] },
            { textBoxes: [{ text: "Ribosomes build proteins" }] },
          ]),
        ],
        [".hidden/Secret.md", "stay out"],
        [".obsidian/plugins/x/notes.md", "also out"],
      ]),
      bytes: new Map(),
      plugin: new Map(),
      ...extra,
    };
  }

  it("finds words in notes and in notebooks' text boxes, and not in hidden folders", async () => {
    const { app } = setUp(vault());
    const index = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    await index.start();
    await settled(index);
    expect(index.getStatus()).toMatchObject({ docs: 2, notebooks: 1, pdfs: 0, enabled: true });
    const cells = await index.search("mitochondria powerhouse");
    expect(cells.hits.map((hit) => [hit.path, hit.kind, hit.pages])).toEqual([
      ["Notes/Cells.md", "note", [1]],
    ]);
    expect(cells.hits[0]?.snippet).toContain("Mitochondria are the powerhouse");
    const bio = await index.search("ribosomes");
    expect(bio.hits.map((hit) => [hit.path, hit.kind, hit.pages, hit.title])).toEqual([
      ["School/Biology.notebook.md", "notebook", [2], "Biology"],
    ]);
    expect((await index.search("stay out")).hits).toEqual([]);
    // A note's ink block is not words.
    expect((await index.search("secret")).hits).toEqual([]);
    expect((await index.search("ab")).tooShort).toBe(true);
    index.stop();
  });

  it("reads a PDF's text, and keeps what it read on disk for the next start", async () => {
    const bytes = new Uint8Array([7, 1, 2, 3]);
    pdf.pages.set("7", [
      "Chapter one on thermodynamics and heat engines",
      "Chapter two on optics and lenses",
    ]);
    const { app } = setUp(vault({ bytes: new Map([["Books/Physics.pdf", bytes]]) }));
    const first = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    await first.start();
    await settled(first);
    expect(
      (await first.search("optics lenses")).hits.map((hit) => [hit.path, hit.kind, hit.pages]),
    ).toEqual([["Books/Physics.pdf", "pdf", [2]]]);
    first.stop();
    expect([...indexedDb.data.keys()].sort()).toEqual([
      "Books/Physics.pdf",
      "Notes/Cells.md",
      "School/Biology.notebook.md",
    ]);
    // The next start loads them from the store and reads nothing again.
    pdf.pages.clear();
    const second = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    await second.start();
    await settled(second);
    expect((await second.search("thermodynamics")).hits.map((hit) => hit.path)).toEqual([
      "Books/Physics.pdf",
    ]);
    second.stop();
  });

  it("finds a notebook's PDF text under the notebook that shows the PDF page", async () => {
    pdf.pages.set("9", ["Lecture notes on enzymes and catalysis"]);
    const { app } = setUp(
      vault({
        text: new Map([
          [
            "School/Bio.notebook.md",
            notebook([{ backdrop: { kind: "pdf", path: "Books/Enzymes.pdf", page: 0 } }]),
          ],
        ]),
        bytes: new Map([["Books/Enzymes.pdf", new Uint8Array([9, 9])]]),
      }),
    );
    const index = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    await index.start();
    await settled(index);
    const found = await index.search("catalysis");
    expect(found.hits.map((hit) => [hit.path, hit.kind, hit.pages])).toEqual([
      ["School/Bio.notebook.md", "notebook", [1]],
    ]);
    index.stop();
  });

  it("reads the text FineNotes' OCR found on a scanned PDF, from this plugin's own folder", async () => {
    const bytes = new Uint8Array([5, 6, 7, 8]);
    // A scanned PDF: pdf.js finds no text on its pages.
    pdf.pages.set("5", ["", ""]);
    let cache = emptyCache();
    cache = withPage(cache, 1, {
      imageWidth: 100,
      imageHeight: 100,
      pageWidth: 100,
      pageHeight: 100,
      lines: [{ conf: 0.9, words: [word("Cardiology"), word("murmurs")] }],
    });
    const hash = sha256(bytes);
    const plugin = new Map([[cachePath(PLUGIN, hash), serializeCache(cache)]]);
    const { app } = setUp(vault({ bytes: new Map([["Scans/Heart.pdf", bytes]]), plugin }));
    const index = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    await index.start();
    await settled(index);
    const found = await index.search("cardiology murmurs");
    expect(found.hits.map((hit) => [hit.path, hit.kind, hit.pages])).toEqual([
      ["Scans/Heart.pdf", "pdf", [2]],
    ]);
    expect(index.getStatus()).toMatchObject({ pdfs: 1, unsearchablePdfs: 0 });
    index.stop();
  });

  it("does not look in another plugin's folder for the OCR cache, and says the scan is unsearchable", async () => {
    const bytes = new Uint8Array([5, 6, 7, 8]);
    pdf.pages.set("5", ["", ""]);
    const cache = withPage(emptyCache(), 0, {
      imageWidth: 100,
      imageHeight: 100,
      pageWidth: 100,
      pageHeight: 100,
      lines: [{ conf: 0.9, words: [word("Cardiology")] }],
    });
    // The cache is in the folder of a plugin with another id.
    const plugin = new Map([
      [cachePath(".obsidian/plugins/finenotes-test", sha256(bytes)), serializeCache(cache)],
    ]);
    const { app } = setUp(vault({ bytes: new Map([["Scans/Heart.pdf", bytes]]), plugin }));
    const index = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    await index.start();
    await settled(index);
    expect((await index.search("cardiology")).hits).toEqual([]);
    expect(index.getStatus()).toMatchObject({ pdfs: 1, unsearchablePdfs: 1 });
    index.stop();
  });

  it("goes quiet when stopped and picks up again when started", async () => {
    const { app } = setUp(vault());
    const index = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    await index.start();
    await settled(index);
    index.stop();
    expect(index.getStatus().docs).toBe(0);
    await index.start();
    await settled(index);
    expect(index.getStatus().docs).toBe(2);
    expect((await index.search("ribosomes")).hits).toHaveLength(1);
    index.stop();
  });

  it("indexes nothing while Search inside notes is off, and reads once it is turned on", async () => {
    let on = false;
    const { app } = setUp(vault());
    const index = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => on);
    await index.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(index.getStatus()).toMatchObject({ docs: 0, enabled: false });
    on = true;
    index.enable();
    await settled(index);
    expect(index.getStatus().docs).toBe(2);
    on = false;
    index.disable();
    expect(index.getStatus().docs).toBe(0);
    index.stop();
  });

  it("follows the vault: a rename keeps the page text, a delete forgets it", async () => {
    const { app, files } = setUp(vault());
    const index = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    await index.start();
    await settled(index);
    const cells = files.get("Notes/Cells.md") as TFile;
    const moved = new TFile("Archive/Cells.md", cells.stat.size);
    Object.assign(moved.stat, cells.stat);
    files.set("Archive/Cells.md", moved);
    files.delete("Notes/Cells.md");
    await index.onRename(moved as never, "Notes/Cells.md");
    expect((await index.search("powerhouse")).hits.map((hit) => hit.path)).toEqual([
      "Archive/Cells.md",
    ]);
    index.onDelete("Archive");
    expect((await index.search("powerhouse")).hits).toEqual([]);
    index.stop();
  });

  it("tells its listeners the status changed, but not at once", async () => {
    const { app } = setUp(vault());
    const index = new FolderSearchIndex(app as never, `${PLUGIN}/ocr`, () => true);
    const listener = vi.fn();
    const stop = index.onChange(listener);
    await index.start();
    await settled(index);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled(), { timeout: 2000 });
    stop();
    const count = listener.mock.calls.length;
    await index.rebuild();
    await settled(index);
    expect(listener).toHaveBeenCalledTimes(count);
    index.stop();
  });
});
