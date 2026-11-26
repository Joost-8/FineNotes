/**
 * The Companion PDF manager against a vault in memory: what is read, when,
 * and what is written. A notebook that has not changed costs nothing; this
 * device's own PDF is never read back; another device's PDF is read once,
 * by its Info; the vault is never searched; the notebook's frontmatter is
 * the truth on every device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));
/** The renderer is stood in for: a PDF that is only its Subject, as our composer writes it. */
const rendered = vi.fn(
  async (
    _pages: unknown[],
    _sources: unknown,
    options: { subject?: string; between?: () => Promise<void> },
  ) => {
    // One page: the export waits for the pen between pages.
    await options.between?.();
    return tinyPdf(options.subject ?? "");
  },
);

/** A PDF with only an Info dictionary and a classic cross-reference table, as our composer writes. */
function tinyPdf(subject: string): Uint8Array {
  let text = "%PDF-1.7\n";
  const at = text.length;
  text += `1 0 obj << /Subject (${subject}) >> endobj\n`;
  const xref = text.length;
  text += `xref\n1 1\n${String(at).padStart(10, "0")} 00000 n\r\n`;
  text += `trailer << /Size 2 /Info 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
vi.mock("../../src/view/pdf-export", () => ({ exportPagesToPdf: rendered }));
vi.mock("../../src/view/image-cache", () => ({
  VaultImageCache: class {
    destroy(): void {}
  },
}));
vi.mock("../../src/view/pdf-backdrop", () => ({
  PdfBackdropCache: class {
    destroy(): void {}
  },
}));

const { TFile, notices, resetFakes } = await import("./fake-obsidian");
const { CompanionPdfManager, captureHash } = await import("../../src/view/companion-pdf");
const { DocumentEncoder } = await import("../../src/model/serialize");
const { emptyDocument, blankPage } = await import("../../src/model/document");
const { companionMetaFromBody, withCompanionKeys } = await import("../../src/model/companion-pdf");
const { companionPdfSubject } = await import("../../src/export/companion-metadata");

type Capture = Parameters<InstanceType<typeof CompanionPdfManager>["requestExport"]>[2];

const NOTE = "School/Cell biology.notebook.md";
const PDF = "School/Exports/Cell biology.pdf";

/** Another device's PDF of this notebook, as it arrives by sync. */
const foreignPdf = (id: string, hash: string) => tinyPdf(companionPdfSubject(id, hash));

function vaultApp() {
  let clock = 1000;
  const files = new Map<string, InstanceType<typeof TFile>>();
  const bytes = new Map<string, Uint8Array>();
  const texts = new Map<string, string>();
  const storage = new Map<string, unknown>();
  const layoutReady: Array<() => void> = [];
  const leafChanged: Array<(leaf: unknown) => void> = [];
  const put = (path: string, data: Uint8Array | string) => {
    const file = files.get(path) ?? new TFile(path);
    files.set(path, file);
    if (typeof data === "string") texts.set(path, data);
    else bytes.set(path, data);
    file.stat.size = typeof data === "string" ? data.length : data.byteLength;
    file.stat.mtime = ++clock;
    return file;
  };
  const vault = {
    getFileByPath: (path: string) => files.get(path) ?? null,
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    getFolderByPath: (folder: string) => ({
      children: [...files.values()].filter(
        (f) => f.path.slice(0, Math.max(0, f.path.lastIndexOf("/"))) === folder,
      ),
    }),
    getRoot: () => ({ children: [...files.values()].filter((f) => !f.path.includes("/")) }),
    createFolder: vi.fn(async () => {}),
    getFiles: vi.fn(() => [...files.values()]),
    readBinary: vi.fn(
      async (file: InstanceType<typeof TFile>) => bytes.get(file.path)!.slice().buffer,
    ),
    createBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
      if (files.has(path)) throw new Error(`exists: ${path}`);
      return put(path, new Uint8Array(data));
    }),
    modifyBinary: vi.fn(async (file: InstanceType<typeof TFile>, data: ArrayBuffer) => {
      put(file.path, new Uint8Array(data));
    }),
    rename: vi.fn(async (file: InstanceType<typeof TFile>, to: string) => {
      if (files.has(to)) throw new Error(`exists: ${to}`);
      files.delete(file.path);
      const data = bytes.get(file.path) ?? texts.get(file.path)!;
      bytes.delete(file.path);
      texts.delete(file.path);
      const moved = new TFile(to);
      moved.stat.mtime = file.stat.mtime;
      moved.stat.size = file.stat.size;
      files.set(to, moved);
      if (typeof data === "string") texts.set(to, data);
      else bytes.set(to, data);
    }),
    adapter: {
      exists: async (path: string) => files.has(path),
      remove: vi.fn(async (path: string) => {
        files.delete(path);
        bytes.delete(path);
      }),
    },
    cachedRead: async (file: InstanceType<typeof TFile>) => texts.get(file.path) ?? "",
    read: async (file: InstanceType<typeof TFile>) => texts.get(file.path) ?? "",
    process: vi.fn(async (file: InstanceType<typeof TFile>, edit: (text: string) => string) => {
      put(file.path, edit(texts.get(file.path) ?? ""));
    }),
    on: () => ({}),
  };
  const app = {
    vault,
    fileManager: {
      renameFile: vi.fn((file: InstanceType<typeof TFile>, to: string) => vault.rename(file, to)),
      trashFile: vi.fn(async () => {}),
    },
    metadataCache: {
      getFileCache: (file: InstanceType<typeof TFile>) => ({
        frontmatter: companionMetaFromBody(texts.get(file.path) ?? "")
          ? { "finenotes-companion-id": companionMetaFromBody(texts.get(file.path) ?? "")!.id }
          : undefined,
      }),
    },
    workspace: {
      onLayoutReady: (run: () => void) => layoutReady.push(run),
      on: (name: string, listener: (leaf: unknown) => void) => {
        if (name === "active-leaf-change") leafChanged.push(listener);
        return {};
      },
    },
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: vi.fn((key: string, value: unknown) => void storage.set(key, value)),
  };
  return { app, vault, files, bytes, texts, storage, put, layoutReady, leafChanged };
}

/** The notebook's edit count as a capture made now would record it. */
let revisionNow = () => 0;

function capture(
  pages = 1,
  title = "Cell biology",
  over: Partial<ReturnType<Capture>> = {},
): Capture {
  const doc = emptyDocument();
  for (let i = 1; i < pages; i++) doc.pages.push(blankPage(`p${i}`));
  const snapshot = new DocumentEncoder().snapshot(doc);
  return () => ({
    revision: revisionNow(),
    optionsKey: "switches",
    ...over,
    title,
    snapshot,
    paperWidth: 1000,
    furniture: null,
    resources: [],
    options: { usePressure: true, highlighterAlpha: 0.4 },
    crop: (page) => page,
    ...over,
  });
}

function setup(body = "Notes\n") {
  const v = vaultApp();
  const note = v.put(NOTE, body);
  const manager = new CompanionPdfManager(v.app as never, "devA", { startDelay: 0 });
  return { ...v, note, manager };
}

/** The notebook with its companion on, the PDF made once. */
async function enabled() {
  const s = setup();
  const id = await s.manager.enable(s.note as never, s.texts.get(NOTE)!, "School/Exports");
  await s.manager.requestExport(id, s.note as never, capture(), true);
  rendered.mockClear();
  s.vault.readBinary.mockClear();
  revisionNow = () => s.manager.revisionOf(id);
  return { ...s, id };
}

beforeEach(() => {
  revisionNow = () => 0;
  resetFakes();
  rendered.mockClear();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});

afterEach(() => vi.unstubAllGlobals());

describe("turning it on", () => {
  it("names the PDF after the notebook, keeps the keys in its frontmatter, and the journal on this device", async () => {
    const s = await enabled();
    expect(companionMetaFromBody(s.texts.get(NOTE)!)).toEqual({
      id: s.id,
      pdfPath: PDF,
      followName: true,
    });
    expect(s.files.has(PDF)).toBe(true);
    expect(s.app.saveLocalStorage).toHaveBeenCalledWith(
      "finenotes-companion-journal",
      expect.any(String),
    );
    expect(s.manager.state(s.id).mark).toBe("current");
  });

  it("takes a free name beside a PDF exported by hand, never overwriting it", async () => {
    const s = setup();
    s.put(PDF, foreignPdf("bbbbbbbbbbbbbbbb", "0000000000000000"));
    const before = s.bytes.get(PDF);
    const id = await s.manager.enable(s.note as never, s.texts.get(NOTE)!, "School/Exports");
    expect(s.manager.entry(id)?.pdfPath).toBe("School/Exports/Cell biology 1.pdf");
    expect(s.manager.entry(id)?.followName).toBe(false);
    await s.manager.requestExport(id, s.note as never, capture(), true);
    expect(s.bytes.get(PDF)).toBe(before);
    expect(s.files.has("School/Exports/Cell biology 1.pdf")).toBe(true);
  });

  it("refuses frontmatter that is not YAML, in words", async () => {
    const s = setup("---\ntags: [a\n  oops\n---\nNotes\n");
    await expect(
      s.manager.enable(s.note as never, s.texts.get(NOTE)!, undefined),
    ).rejects.toMatchObject({
      code: "frontmatter",
    });
  });
});

describe("what a close costs", () => {
  it("nothing at all for a notebook that has not changed", async () => {
    const s = await enabled();
    const made = vi.fn(capture());
    await s.manager.requestExport(s.id, s.note as never, made, false);
    expect(made).not.toHaveBeenCalled();
    expect(s.vault.readBinary).not.toHaveBeenCalled();
    expect(rendered).not.toHaveBeenCalled();
  });

  it("one render for a changed notebook, its own PDF trusted without being read", async () => {
    const s = await enabled();
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, capture(2), false);
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(s.vault.readBinary).not.toHaveBeenCalled();
    expect(s.manager.state(s.id).mark).toBe("current");
    // Its scratch files go straight out, not to the trash, and carry this device's id.
    expect(s.app.fileManager.trashFile).not.toHaveBeenCalled();
    const removed = s.vault.adapter.remove.mock.calls.map(([path]) => path);
    expect(removed).toHaveLength(1);
    expect(removed[0].startsWith(`${PDF}.fn-${s.id}-devA-`)).toBe(true);
    expect(removed[0].endsWith("-backup.pdf")).toBe(true);
    expect([...s.files.keys()].sort()).toEqual([PDF, NOTE].sort());
  });

  it("no render when an edit was undone: the PDF already shows it", async () => {
    const s = await enabled();
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, capture(), false);
    expect(rendered).not.toHaveBeenCalled();
    expect(s.manager.entry(s.id)?.dirty).toBe(false);
  });

  it("never searches the vault for a PDF", async () => {
    const s = await enabled();
    s.files.delete(PDF);
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, capture(2), false);
    expect(s.vault.getFiles).not.toHaveBeenCalled();
    // Missing: said so, and not made again unless asked.
    expect(s.manager.state(s.id)).toMatchObject({ mark: "error", pdfExists: false });
    expect(rendered).not.toHaveBeenCalled();
    await s.manager.requestExport(s.id, s.note as never, capture(2), true);
    expect(s.files.has(PDF)).toBe(true);
  });
});

describe("another device's PDF", () => {
  it("is read once, by its Info, and taken as current when it shows this content", async () => {
    const s = await enabled();
    const hash = await captureHash(s.app as never, capture(2)());
    s.put(PDF, foreignPdf(s.id, hash));
    s.manager.changed(s.files.get(PDF) as never);
    expect(s.manager.entry(s.id)?.dirty).toBe(true);
    await s.manager.requestExport(s.id, s.note as never, capture(2), false);
    expect(s.vault.readBinary).toHaveBeenCalledTimes(1);
    expect(rendered).not.toHaveBeenCalled();
    expect(s.manager.entry(s.id)?.dirty).toBe(false);
    // Read once: asked again, it is known by its listing.
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, capture(2), false);
    expect(s.vault.readBinary).toHaveBeenCalledTimes(1);
  });

  it("an older one is replaced at the next close", async () => {
    const s = await enabled();
    s.put(PDF, foreignPdf(s.id, "0000000000000000"));
    s.manager.changed(s.files.get(PDF) as never);
    await s.manager.requestExport(s.id, s.note as never, capture(), false);
    expect(rendered).toHaveBeenCalledTimes(1);
  });

  it("a file that is not this notebook's is never replaced", async () => {
    const s = await enabled();
    s.put(PDF, foreignPdf("bbbbbbbbbbbbbbbb", "0000000000000000"));
    const theirs = s.bytes.get(PDF);
    s.manager.changed(s.files.get(PDF) as never);
    await s.manager.requestExport(s.id, s.note as never, capture(2), true);
    expect(s.bytes.get(PDF)).toBe(theirs);
    expect(s.manager.state(s.id).mark).toBe("error");
    expect(notices.at(-1)?.message).toContain("Another file is where the PDF goes");
  });
});

describe("the frontmatter is the truth on every device", () => {
  it("turned off elsewhere: nothing is exported here", async () => {
    const s = await enabled();
    s.put(NOTE, withCompanionKeys(s.texts.get(NOTE)!, { pdfPath: null, followName: null }));
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, capture(2), false);
    expect(rendered).not.toHaveBeenCalled();
    expect(s.manager.entry(s.id)?.enabled).toBe(false);
  });

  it("moved elsewhere: the new place is taken, and the PDF is awaited there", async () => {
    const s = await enabled();
    s.put(NOTE, withCompanionKeys(s.texts.get(NOTE)!, { pdfPath: "Archive/Cell biology.pdf" }));
    s.manager.hydrate(s.note as never, s.texts.get(NOTE)!);
    expect(s.manager.entry(s.id)?.pdfPath).toBe("Archive/Cell biology.pdf");
    expect(s.manager.state(s.id).mark).toBe("stale");
  });

  it("a copy carrying the same id writes nothing until it lets go of it", async () => {
    const s = await enabled();
    const copy = s.put("School/Copy.notebook.md", s.texts.get(NOTE)!);
    s.manager.hydrate(copy as never, s.texts.get("School/Copy.notebook.md")!);
    expect(s.manager.state(s.id).mark).toBe("error");
    await s.manager.disable(copy as never, s.id);
    expect(companionMetaFromBody(s.texts.get("School/Copy.notebook.md")!)).toBeNull();
    expect(companionMetaFromBody(s.texts.get(NOTE)!)?.pdfPath).toBe(PDF);
  });
});

describe("the vault's renames and deletes", () => {
  it("a PDF the user renames keeps its name, and the frontmatter follows it", async () => {
    const s = await enabled();
    await s.vault.rename(s.files.get(PDF)!, "School/Exports/Homework 3.pdf");
    await s.manager.renamed(s.files.get("School/Exports/Homework 3.pdf") as never, PDF);
    expect(companionMetaFromBody(s.texts.get(NOTE)!)).toMatchObject({
      pdfPath: "School/Exports/Homework 3.pdf",
      followName: false,
    });
    // Still its own write: not read back.
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, capture(), false);
    expect(s.vault.readBinary).not.toHaveBeenCalled();
  });

  it("a renamed notebook takes its PDF's name with it", async () => {
    const s = await enabled();
    await s.vault.rename(s.note, "School/Cells.notebook.md");
    await s.manager.renamed(s.files.get("School/Cells.notebook.md") as never, NOTE);
    expect(s.files.has("School/Exports/Cells.pdf")).toBe(true);
    expect(companionMetaFromBody(s.texts.get("School/Cells.notebook.md")!)?.pdfPath).toBe(
      "School/Exports/Cells.pdf",
    );
  });

  it("a deleted PDF is missing, not turned off: a sync may be moving it", async () => {
    const s = await enabled();
    const before = s.texts.get(NOTE);
    s.files.delete(PDF);
    s.manager.deleted(PDF);
    expect(s.texts.get(NOTE)).toBe(before);
    expect(s.manager.entry(s.id)?.enabled).toBe(true);
    expect(s.manager.state(s.id)).toMatchObject({
      mark: "error",
      error: expect.stringContaining("missing"),
    });
  });
});

describe("an interrupted write", () => {
  it("is finished once the vault is ready, from the journal in local storage", async () => {
    const s = await enabled();
    const entry = s.manager.entry(s.id)!;
    const stage = `${PDF}.fn-${s.id}-devA-1-pending.pdf`;
    const backup = `${PDF}.fn-${s.id}-devA-1-backup.pdf`;
    entry.transaction = { target: PDF, stage, backup, staged: true };
    await s.vault.rename(s.files.get(PDF)!, backup);
    s.put(stage, foreignPdf(s.id, "1111111111111111"));
    s.manager.markDirty(s.id);
    // A new session reads the journal from local storage.
    const next = new CompanionPdfManager(s.app as never, "devA", { startDelay: 0 });
    const plugin = { app: s.app, registerEvent: vi.fn(), register: vi.fn() };
    next.register(plugin as never, () => []);
    expect(s.files.has(PDF)).toBe(false);
    s.layoutReady.forEach((run) => run());
    await vi.waitFor(() => expect(next.entry(s.id)?.transaction).toBeUndefined());
    expect(s.files.has(PDF)).toBe(true);
    expect(s.files.has(stage) || s.files.has(backup)).toBe(false);
  });
});

describe("keys written through an open notebook", () => {
  it("go into the view's own text, so its next save keeps them", async () => {
    const s = setup();
    const view = {
      file: s.note,
      penDown: false,
      id: null,
      uses: () => false,
      writeKeys: vi.fn(async () => true),
    };
    s.manager.register({ app: s.app, registerEvent: vi.fn(), register: vi.fn() } as never, () => [
      view as never,
    ]);
    await s.manager.enable(s.note as never, s.texts.get(NOTE)!, undefined);
    expect(view.writeKeys).toHaveBeenCalledWith(
      expect.objectContaining({ pdfPath: "School/Cell biology.pdf" }),
    );
    expect(s.vault.process).not.toHaveBeenCalled();
  });
});

describe("another device's scratch files", () => {
  it("never block this device, and are left alone", async () => {
    const s = await enabled();
    const stray = `${PDF}.fn-${s.id}-devB-5-pending.pdf`;
    s.put(stray, foreignPdf(s.id, "0000000000000000"));
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, capture(3), false);
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(s.files.has(stray)).toBe(true);
    expect(s.manager.state(s.id).mark).toBe("current");
  });
});

describe("the review's cases", () => {
  /** A view link whose pen the test holds. */
  function penLink(s: Awaited<ReturnType<typeof enabled>>) {
    const link = {
      file: s.note,
      penDown: false,
      id: s.id,
      uses: () => false,
      activeLeafChanged: vi.fn(),
      writeKeys: vi.fn(async () => false),
    };
    s.manager.register({ app: s.app, registerEvent: vi.fn(), register: vi.fn() } as never, () => [
      link as never,
    ]);
    return link;
  }

  it("waits for the pen between pages, not only before an export", async () => {
    const s = await enabled();
    const link = penLink(s);
    s.manager.markDirty(s.id);
    let started = false;
    rendered.mockImplementationOnce(async (_p, _s, options) => {
      started = true;
      // The pen comes down as the first page renders.
      link.penDown = true;
      await options.between?.();
      return tinyPdf(options.subject ?? "");
    });
    const done = s.manager.requestExport(s.id, s.note as never, capture(2), false);
    await vi.waitFor(() => expect(started).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 900));
    // Still waiting: nothing written while the pen writes.
    expect(s.manager.entry(s.id)?.dirty).toBe(true);
    link.penDown = false;
    await done;
    expect(s.manager.entry(s.id)?.dirty).toBe(false);
  });

  it("an export that ended the app is not run again by itself (the crash guard)", async () => {
    const s = await enabled();
    s.manager.markDirty(s.id);
    // The app ends during the render: the journal says an export was running.
    rendered.mockImplementationOnce(async () => {
      expect(
        JSON.parse(s.storage.get("finenotes-companion-journal") as string).entries[s.id].exporting,
      ).toBe(true);
      throw new Error("the app ended here");
    });
    await s.manager.requestExport(s.id, s.note as never, capture(2), false);
    const journal = JSON.parse(s.storage.get("finenotes-companion-journal") as string);
    journal.entries[s.id].exporting = true;
    s.storage.set("finenotes-companion-journal", JSON.stringify(journal));
    const next = new CompanionPdfManager(s.app as never, "devA", { startDelay: 0 });
    expect(next.state(s.id).mark).toBe("error");
    rendered.mockClear();
    await next.requestExport(s.id, s.note as never, capture(2), false);
    expect(rendered).not.toHaveBeenCalled();
    // Update now runs it, and lifts the hold.
    await next.requestExport(s.id, s.note as never, capture(2), true);
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(next.entry(s.id)?.halted).toBeUndefined();
  });

  it("over big imported PDFs, only Update now exports", async () => {
    const s = await enabled();
    const slides = s.put("Slides.pdf", new Uint8Array(1));
    slides.stat.size = 70 * 1024 * 1024;
    s.manager.markDirty(s.id);
    await s.manager.requestExport(
      s.id,
      s.note as never,
      capture(2, "Cell biology", { resources: ["Slides.pdf"] }),
      false,
    );
    expect(rendered).not.toHaveBeenCalled();
    expect(s.manager.state(s.id).mark).toBe("stale");
    await s.manager.requestExport(
      s.id,
      s.note as never,
      capture(2, "Cell biology", { resources: ["Slides.pdf"] }),
      true,
    );
    expect(rendered).toHaveBeenCalledTimes(1);
  });

  it("an edit made after the capture (reopened while it waited) leaves the PDF behind", async () => {
    const s = await enabled();
    s.manager.markDirty(s.id);
    const made = capture(2)();
    // Written on again while the export waits in the queue.
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, () => made, false);
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(s.manager.entry(s.id)?.dirty).toBe(true);
  });

  it("writes nothing for a notebook deleted while it rendered", async () => {
    const s = await enabled();
    s.manager.markDirty(s.id);
    const before = s.bytes.get(PDF);
    rendered.mockImplementationOnce(async (_p, _s, options) => {
      s.files.delete(NOTE);
      s.manager.deleted(NOTE);
      return tinyPdf(options.subject ?? "");
    });
    await s.manager.requestExport(s.id, s.note as never, capture(2), false);
    expect(s.bytes.get(PDF)).toBe(before);
    expect([...s.files.keys()]).toEqual([PDF]);
  });

  it("a copy made outside FineNotes, turned on, gets an id and a PDF of its own", async () => {
    const s = await enabled();
    const copyPath = "School/Copy.notebook.md";
    const copy = s.put(copyPath, s.texts.get(NOTE)!);
    const id = await s.manager.enable(copy as never, s.texts.get(copyPath)!, "School/Exports");
    expect(id).not.toBe(s.id);
    expect(s.manager.entry(id)?.pdfPath).toBe("School/Exports/Copy.pdf");
    expect(s.manager.entry(s.id)?.notebookPath).toBe(NOTE);
    expect(companionMetaFromBody(s.texts.get(NOTE)!)?.pdfPath).toBe(PDF);
  });

  it("writes the id quoted, so YAML keeps it a string", async () => {
    const s = await enabled();
    expect(s.texts.get(NOTE)).toContain(`finenotes-companion-id: "${s.id}"`);
  });
});

describe("one name and one own file for the export and the companion (#318)", () => {
  const TYPED = "School/Exports/Biology hand-in.pdf";
  const NAME = "Biology hand-in";

  /** The manager on the Export dialog's record: a typed name, and the file it last wrote. */
  function typedSetup(file?: string) {
    const s = setup();
    const names = new Map<string, { name: string; file?: string }>([
      [NOTE, file ? { name: NAME, file } : { name: NAME }],
    ]);
    s.manager.register(
      { app: s.app, registerEvent: vi.fn(), register: vi.fn() } as never,
      () => [],
      {
        get: (path) => names.get(path),
        setFile: (path, written) => {
          const entry = names.get(path);
          if (entry) names.set(path, { name: entry.name, file: written });
        },
      },
    );
    return { ...s, names };
  }

  const stamp = async (_bytes: Uint8Array, id: string, hash: string) =>
    tinyPdf(companionPdfSubject(id, hash));

  it("a same-named file that is not this notebook's own gets a free name, never overwritten", async () => {
    const s = typedSetup();
    s.put(TYPED, foreignPdf("bbbbbbbbbbbbbbbb", "0000000000000000"));
    const theirs = s.bytes.get(TYPED);
    const id = await s.manager.enable(s.note as never, s.texts.get(NOTE)!, "School/Exports");
    expect(s.manager.entry(id)?.pdfPath).toBe("School/Exports/Biology hand-in 1.pdf");
    await s.manager.requestExport(id, s.note as never, capture(), true);
    expect(s.bytes.get(TYPED)).toBe(theirs);
    expect(s.files.has("School/Exports/Biology hand-in 1.pdf")).toBe(true);
    // The record now names the companion's file as the own one.
    expect(s.names.get(NOTE)?.file).toBe("School/Exports/Biology hand-in 1.pdf");
  });

  it("export, then companion: the file the export wrote is replaced in place", async () => {
    const s = typedSetup(TYPED);
    // A plain export under the typed name: no Subject.
    s.put(TYPED, new TextEncoder().encode("%PDF-1.7 an export"));
    const id = await s.manager.enable(s.note as never, s.texts.get(NOTE)!, "School/Exports");
    expect(s.manager.entry(id)?.pdfPath).toBe(TYPED);
    await s.manager.requestExport(id, s.note as never, capture(), true);
    expect(new TextDecoder().decode(s.bytes.get(TYPED))).toContain(id);
    expect(s.manager.state(id).mark).toBe("current");
  });

  it("companion, then export: the companion's write is the record's own file", async () => {
    const s = typedSetup();
    const id = await s.manager.enable(s.note as never, s.texts.get(NOTE)!, "School/Exports");
    await s.manager.requestExport(id, s.note as never, capture(), true);
    expect(s.manager.entry(id)?.pdfPath).toBe(TYPED);
    // What the Export dialog's own() reads: the companion's file.
    expect(s.names.get(NOTE)?.file).toBe(TYPED);
    // The export then writes it through the companion's writer: still the companion, up to date.
    const hash = await captureHash(s.app as never, capture()());
    await s.manager.writeExport(
      id,
      NOTE,
      TYPED,
      new Uint8Array(5),
      { hash, optionsKey: "switches" },
      stamp,
    );
    expect(new TextDecoder().decode(s.bytes.get(TYPED))).toContain(`${id} ${hash}`);
    expect(s.manager.state(id).mark).toBe("current");
  });

  it("a new typed name moves the companion's file there, never onto someone else's file", async () => {
    const s = await enabled();
    await s.manager.moveTo(s.note as never, s.id, TYPED);
    expect(s.app.fileManager.renameFile).toHaveBeenCalled();
    expect(s.files.has(TYPED) && !s.files.has(PDF)).toBe(true);
    expect(companionMetaFromBody(s.texts.get(NOTE)!)).toMatchObject({
      pdfPath: TYPED,
      followName: false,
    });
    const other = "School/Exports/Someone else's.pdf";
    s.put(other, foreignPdf("bbbbbbbbbbbbbbbb", "0000000000000000"));
    await s.manager.moveTo(s.note as never, s.id, other);
    expect(s.manager.entry(s.id)?.pdfPath).toBe(TYPED);
  });

  it("an export to the companion's file goes through its writer: Subject, hash, up to date", async () => {
    const s = await enabled();
    const hash = await captureHash(s.app as never, capture(2)());
    await s.manager.writeExport(
      s.id,
      NOTE,
      PDF,
      new Uint8Array(5),
      { hash, optionsKey: "switches" },
      stamp,
    );
    expect(new TextDecoder().decode(s.bytes.get(PDF))).toContain(`${s.id} ${hash}`);
    expect(s.manager.state(s.id).mark).toBe("current");
    // Known as this device's own write: the next close reads nothing.
    s.manager.markDirty(s.id);
    await s.manager.requestExport(s.id, s.note as never, capture(2), false);
    expect(s.vault.readBinary).not.toHaveBeenCalled();
    expect(rendered).not.toHaveBeenCalled();
    // Part of the notebook: written, and marked behind.
    await s.manager.writeExport(s.id, NOTE, PDF, new Uint8Array(5), null, stamp);
    expect(s.manager.state(s.id).mark).toBe("stale");
  });

  it("a notebook renamed keeps its typed PDF name", async () => {
    const s = typedSetup();
    const id = await s.manager.enable(s.note as never, s.texts.get(NOTE)!, "School/Exports");
    await s.manager.requestExport(id, s.note as never, capture(), true);
    s.names.set("School/Cells.notebook.md", s.names.get(NOTE)!);
    await s.vault.rename(s.note, "School/Cells.notebook.md");
    await s.manager.renamed(s.files.get("School/Cells.notebook.md") as never, NOTE);
    expect(s.manager.entry(id)?.pdfPath).toBe(TYPED);
    expect(s.files.has(TYPED)).toBe(true);
  });

  it("Keep updated after an export of a typed name links exactly that file", async () => {
    const s = typedSetup(TYPED);
    const bytes = new TextEncoder().encode("%PDF-1.7 an export");
    s.put(TYPED, bytes);
    await s.manager.adopt(
      s.note as never,
      s.texts.get(NOTE)!,
      TYPED,
      bytes,
      "1111111111111111",
      stamp,
    );
    const id = companionMetaFromBody(s.texts.get(NOTE)!)!.id;
    expect(s.manager.entry(id)?.pdfPath).toBe(TYPED);
    expect(s.manager.state(id).mark).toBe("current");
  });
});

describe("the reviewer's second pass", () => {
  const stamp = async (_bytes: Uint8Array, id: string, hash: string) =>
    tinyPdf(companionPdfSubject(id, hash));

  it("a copy carrying the original's id never writes or moves the original's PDF", async () => {
    const s = await enabled();
    const copyPath = "School/Copy.notebook.md";
    const copy = s.put(copyPath, s.texts.get(NOTE)!);
    s.manager.hydrate(copy as never, s.texts.get(copyPath)!);
    const before = s.bytes.get(PDF);
    await s.manager.writeExport(s.id, copyPath, PDF, new Uint8Array(5), null, stamp);
    await s.manager.moveTo(copy as never, s.id, "School/Exports/Copy.pdf");
    expect(s.bytes.get(PDF)).toBe(before);
    expect(s.manager.entry(s.id)?.pdfPath).toBe(PDF);
    expect(s.manager.mine(s.manager.entry(s.id), copyPath)).toBe(false);
  });

  it("records the own file only once a file of ours is there", async () => {
    const s = setup();
    const names = new Map<string, { name: string; file?: string }>([
      [NOTE, { name: "Cell biology" }],
    ]);
    s.manager.register(
      { app: s.app, registerEvent: vi.fn(), register: vi.fn() } as never,
      () => [],
      {
        get: (path) => names.get(path),
        setFile: (path, file) => names.set(path, { name: names.get(path)!.name, file }),
      },
    );
    const id = await s.manager.enable(s.note as never, s.texts.get(NOTE)!, "School/Exports");
    // Nothing written yet: nothing recorded.
    expect(names.get(NOTE)?.file).toBeUndefined();
    await s.manager.chooseFolder(s.note as never, id, "Archive");
    expect(names.get(NOTE)?.file).toBeUndefined();
    await s.manager.requestExport(id, s.note as never, capture(), true);
    expect(names.get(NOTE)?.file).toBe("Archive/Cell biology.pdf");
  });

  it("a turned-off notebook's old path does not make a shared name 'occupied'", async () => {
    const s = await enabled();
    // Another notebook, turned off, once kept its PDF at this same path.
    const other = "bbbbbbbbbbbbbbbb";
    const journal = JSON.parse(s.storage.get("finenotes-companion-journal") as string);
    // Listed first, so a check that takes the first entry with this path finds it.
    journal.entries = {
      [other]: {
        notebookPath: "School/Other.notebook.md",
        pdfPath: PDF,
        enabled: false,
        followName: true,
        dirty: false,
      },
      ...journal.entries,
    };
    s.storage.set("finenotes-companion-journal", JSON.stringify(journal));
    const next = new CompanionPdfManager(s.app as never, "devA", { startDelay: 0 });
    revisionNow = () => next.revisionOf(s.id);
    next.markDirty(s.id);
    await next.requestExport(s.id, s.note as never, capture(2), false);
    next.markDirty(s.id);
    await next.requestExport(s.id, s.note as never, capture(3), false);
    expect(next.state(s.id).mark).toBe("current");
  });

  it("over the size limit, the PDF is not even read", async () => {
    const s = await enabled();
    const slides = s.put("Slides.pdf", new Uint8Array(1));
    slides.stat.size = 70 * 1024 * 1024;
    s.put(PDF, foreignPdf(s.id, "0000000000000000"));
    s.manager.changed(s.files.get(PDF) as never);
    await s.manager.requestExport(
      s.id,
      s.note as never,
      capture(2, "Cell biology", { resources: ["Slides.pdf"] }),
      false,
    );
    expect(s.vault.readBinary).not.toHaveBeenCalled();
    expect(rendered).not.toHaveBeenCalled();
  });
});
