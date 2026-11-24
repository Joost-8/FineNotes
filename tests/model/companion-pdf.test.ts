import { describe, expect, it, vi } from "vitest";
import { blankPage, emptyDocument } from "../../src/model/document";
import {
  CompanionController,
  companionContent,
  companionIdFromBody,
  companionMetaFromBody,
  companionPath,
  companionResources,
  defaultCompanionPath,
  isCompanionNotebookPath,
  parseCompanionStore,
  type CompanionEntry,
  type CompanionSnapshot,
  type CompanionStore,
} from "../../src/model/companion-pdf";

const ID = "a3f9211234567890";
const OTHER = "bbbbbbbbbbbbbbbb";

function setup(enabled = true) {
  const entry: CompanionEntry = {
    notebookPath: "School/Biology.notebook.md",
    pdfPath: defaultCompanionPath("School/Biology.notebook.md"),
    enabled,
    followName: true,
    dirty: true,
  };
  const store: CompanionStore = { version: 1, entries: { [ID]: entry } };
  const files = new Map<string, string>();
  const replace = vi.fn(async (record: CompanionEntry, _bytes: Uint8Array, id: string) => {
    files.set(record.pdfPath, id);
  });
  const rename = vi.fn(async (from: string, to: string) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  });
  const persist = vi.fn(async () => {});
  const controller = new CompanionController(store, {
    exists: (path) => files.has(path),
    pdfIdentity: async (path) => files.get(path) ?? null,
    pdfPaths: () => [...files.keys()],
    replace,
    rename,
    persist,
  });
  let fingerprint = "first";
  const render = vi.fn(async () => new Uint8Array([1]));
  const snapshot = vi.fn(async (): Promise<CompanionSnapshot> => ({
    fingerprint,
    resources: [],
    export: render,
  }));
  return {
    entry,
    store,
    files,
    replace,
    rename,
    persist,
    controller,
    snapshot,
    render,
    change: (next: string) => {
      fingerprint = next;
      controller.markChanged(ID);
    },
  };
}

describe("companion associations and lifecycle", () => {
  it("disabled notebooks never export or become dirty", async () => {
    const s = setup(false);
    s.entry.dirty = false;
    expect(s.controller.markChanged(ID)).toBe(false);
    await s.controller.update(ID, s.snapshot);
    expect(s.render).not.toHaveBeenCalled();
  });

  it("dirty close exports once; successful export makes a subsequent clean close a no-op", async () => {
    const s = setup();
    await s.controller.update(ID, s.snapshot);
    expect(s.render).toHaveBeenCalledOnce();
    expect(s.entry.dirty).toBe(false);
    expect(s.entry.lastFingerprint).toBe("first");
    await s.controller.update(ID, s.snapshot);
    expect(s.render).toHaveBeenCalledOnce();
  });

  it("failed export stays dirty and leaves the previous good PDF untouched", async () => {
    const s = setup();
    s.files.set(s.entry.pdfPath, ID);
    s.render.mockRejectedValueOnce(new Error("source unavailable"));
    await expect(s.controller.update(ID, s.snapshot)).rejects.toThrow("source unavailable");
    expect(s.entry.dirty).toBe(true);
    expect(s.entry.error).toBe("source unavailable");
    expect(s.replace).not.toHaveBeenCalled();
    expect(s.files.get(s.entry.pdfPath)).toBe(ID);
    await s.controller.update(ID, s.snapshot);
    expect(s.entry.dirty).toBe(false);
    expect(s.entry.error).toBeUndefined();
  });

  it("manual update can force a clean PDF to refresh", async () => {
    const s = setup();
    await s.controller.update(ID, s.snapshot);
    await s.controller.update(ID, s.snapshot, true);
    expect(s.render).toHaveBeenCalledTimes(2);
  });

  it("concurrent update requests coalesce without simultaneous or duplicate renders", async () => {
    const s = setup();
    let release = () => {};
    s.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Uint8Array([1]));
        }),
    );
    const first = s.controller.update(ID, s.snapshot, true);
    await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
    const second = s.controller.update(ID, s.snapshot, true);
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(s.render).toHaveBeenCalledOnce();
    expect(s.replace).toHaveBeenCalledOnce();
  });

  it("a second content change while exporting is not falsely marked current", async () => {
    const s = setup();
    let release = () => {};
    s.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Uint8Array([1]));
        }),
    );
    const first = s.controller.update(ID, s.snapshot);
    await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
    s.change("second");
    release();
    await first;
    expect(s.entry.dirty).toBe(true);
    expect(s.entry.lastFingerprint).toBe("first");
    await s.controller.update(ID, s.snapshot);
    expect(s.entry.lastFingerprint).toBe("second");
    expect(s.entry.dirty).toBe(false);
  });

  it("a close request during an older export finishes with the newest content", async () => {
    const s = setup();
    let release = () => {};
    s.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Uint8Array([1]));
        }),
    );
    const first = s.controller.update(ID, s.snapshot);
    await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
    s.change("newest");
    const close = s.controller.update(ID, s.snapshot);
    release();
    await Promise.all([first, close]);
    expect(s.render).toHaveBeenCalledTimes(2);
    expect(s.entry.lastFingerprint).toBe("newest");
    expect(s.entry.dirty).toBe(false);
  });

  it("recovery finds moved PDFs by Subject identity only after the known path fails", async () => {
    const s = setup();
    const recovered = "Archive/Biology.pdf";
    s.files.set(recovered, ID);
    await s.controller.update(ID, s.snapshot);
    expect(s.entry.pdfPath).toBe(recovered);
    expect(s.files.size).toBe(1);
    const paths = vi.fn(() => []);
    const other = new CompanionController(s.store, {
      exists: () => true,
      pdfIdentity: async () => ID,
      pdfPaths: paths,
      rename: s.rename,
      replace: s.replace,
      persist: s.persist,
    });
    await other.resolve(ID);
    expect(paths).not.toHaveBeenCalled();
  });

  it("rejects ambiguous recovered copies and unrelated target collisions", async () => {
    const s = setup();
    s.files.set("One.pdf", ID);
    s.files.set("Two.pdf", ID);
    await expect(s.controller.resolve(ID)).rejects.toThrow("Multiple PDFs");
    s.files.clear();
    s.files.set(s.entry.pdfPath, OTHER);
    await expect(s.controller.update(ID, s.snapshot)).rejects.toThrow("unrelated");
    expect(s.replace).not.toHaveBeenCalled();
  });

  it("target deletion recreates the same path even when content is clean", async () => {
    const s = setup();
    await s.controller.update(ID, s.snapshot);
    const target = s.entry.pdfPath;
    s.files.delete(target);
    await expect(s.controller.update(ID, s.snapshot)).rejects.toThrow("PDF missing");
    expect(s.render).toHaveBeenCalledOnce();
    await s.controller.update(ID, s.snapshot, true);
    expect(s.render).toHaveBeenCalledTimes(2);
    expect(s.entry.pdfPath).toBe(target);
    expect(s.files.size).toBe(1);
  });

  it("follows a notebook rename with a clean filename and keeps the existing PDF folder on move", async () => {
    const s = setup();
    s.files.set(s.entry.pdfPath, ID);
    await s.controller.followNotebookName(ID, "Elsewhere/Life.notebook.md");
    expect(s.entry.pdfPath).toBe("School/Life.pdf");
    expect(s.rename).toHaveBeenCalledOnce();
    await s.controller.followNotebookName(ID, "Another/Life.notebook.md");
    expect(s.rename).toHaveBeenCalledOnce();
    expect(s.entry.notebookPath).toBe("Another/Life.notebook.md");
  });

  it("custom names do not follow notebook renames; follow mode refuses collisions", async () => {
    const s = setup();
    s.entry.followName = false;
    s.files.set(s.entry.pdfPath, ID);
    await s.controller.followNotebookName(ID, "Other.notebook.md");
    expect(s.rename).not.toHaveBeenCalled();
    s.entry.followName = true;
    s.files.set("School/Collision.pdf", OTHER);
    await expect(s.controller.followNotebookName(ID, "Collision.notebook.md")).rejects.toThrow(
      "another file",
    );
    expect(s.rename).not.toHaveBeenCalled();
  });

  it("does not permit two notebooks to claim the same target", () => {
    const s = setup();
    s.store.entries[OTHER] = { ...s.entry, notebookPath: "Other.notebook.md" };
    expect(() => s.controller.claim(ID, s.entry.pdfPath)).toThrow("already owns");
  });

  it("generated PDF source references are rejected instead of becoming a self-export loop", async () => {
    const s = setup();
    await expect(
      s.controller.update(ID, async () => ({
        fingerprint: "x",
        resources: [s.entry.pdfPath],
        export: s.render,
      })),
    ).rejects.toThrow("imported PDF");
    expect(s.render).not.toHaveBeenCalled();
  });

  it("JSON restart retains paths, identity, selection mode and clean state", async () => {
    const s = setup();
    await s.controller.update(ID, s.snapshot);
    const reloaded = parseCompanionStore(JSON.parse(JSON.stringify(s.store)));
    expect(reloaded).toEqual(s.store);
    expect(parseCompanionStore(undefined)).toEqual({ version: 1, entries: {} });
  });
});

describe("names, portable frontmatter and exported-content tracking", () => {
  it("uses clean filenames without suffix tags and supports all ink extensions", () => {
    expect(defaultCompanionPath("School/Biology.notebook.md", "Exports")).toBe(
      "Exports/Biology.pdf",
    );
    expect(defaultCompanionPath("Biology.notebook.md")).toBe("Biology.pdf");
    expect(defaultCompanionPath("Scratch.page.md")).toBe("Scratch.pdf");
    expect(defaultCompanionPath("Legacy.ink.md")).toBe("Legacy.pdf");
    expect(companionPath(" School\\Custom.pdf ")).toBe("School/Custom.pdf");
    expect(isCompanionNotebookPath("A.notebook.md")).toBe(true);
    expect(isCompanionNotebookPath("A.page.md")).toBe(true);
    expect(isCompanionNotebookPath("A.ink.md")).toBe(true);
    expect(isCompanionNotebookPath("Plain.md")).toBe(false);
  });

  it.each(["../Outside.pdf", ".obsidian/Hidden.pdf", "Folder/file.md", "Folder/bad:name.pdf"])(
    "rejects unsafe target %s",
    (path) => expect(() => companionPath(path)).toThrow(),
  );

  it("reads portable companion metadata from leading frontmatter only", () => {
    const body = [
      "---",
      `finenotes-companion-id: '${ID}'`,
      'finenotes-companion-pdf: "School/HW 3.pdf"',
      "finenotes-companion-follow: false",
      "user: keep",
      "---",
      "Text",
    ].join("\n");
    expect(companionIdFromBody(body)).toBe(ID);
    expect(companionMetaFromBody(body)).toEqual({
      id: ID,
      pdfPath: "School/HW 3.pdf",
      followName: false,
    });
    expect(companionIdFromBody(`Text\nfinenotes-companion-id: ${ID}`)).toBeNull();
    expect(companionMetaFromBody(`Text\nfinenotes-companion-id: ${ID}`)).toBeNull();
  });

  it("ignores navigation, folders, audio, bookmarks and recognition metadata", () => {
    const doc = emptyDocument(1024);
    const options = { usePressure: false, highlighterAlpha: 0.4 };
    const before = companionContent(doc, options, []);
    doc.view.scrollY = 40;
    doc.scroll = "horizontal";
    doc.folders = { exports: "Elsewhere" };
    doc.pages[0].bookmarked = true;
    doc.pages[0].title = "Section";
    doc.recognizedHash = "new";
    expect(companionContent(doc, options, [])).toBe(before);
  });

  it("tracks every exported content category, export options, and page order", () => {
    const options = {
      usePressure: false,
      highlighterAlpha: 0.4,
      plainPaper: false,
      withoutTapes: false,
      margins: "all",
    };
    const doc0 = emptyDocument(1024);
    const base = companionContent(doc0, options, []);
    expect(companionContent(doc0, { ...options, plainPaper: true }, [])).not.toBe(base);
    expect(companionContent(doc0, { ...options, withoutTapes: true }, [])).not.toBe(base);
    expect(companionContent(doc0, { ...options, margins: "none" }, [])).not.toBe(base);

    const mutations = [
      (doc: ReturnType<typeof emptyDocument>) =>
        doc.pages[0].strokes.push({
          id: "s",
          color: "#000",
          size: 3,
          tool: "pen",
          pts: [1, 2, 0.5],
        }),
      (doc: ReturnType<typeof emptyDocument>) =>
        doc.pages[0].textBoxes.push({
          id: "t",
          text: "Hi",
          color: "#000",
          fontSize: 22,
          x: 1,
          y: 2,
          w: 200,
        }),
      (doc: ReturnType<typeof emptyDocument>) =>
        doc.pages[0].images.push({ id: "i", path: "Image.png", x: 1, y: 2, w: 20, h: 30 }),
      (doc: ReturnType<typeof emptyDocument>) => {
        doc.pages[0].backdrop = { kind: "pdf", path: "Source.pdf", page: 0 };
      },
      (doc: ReturnType<typeof emptyDocument>) => {
        doc.pages[0].backdrop = { kind: "lined", paperColor: "#ff0" };
      },
      (doc: ReturnType<typeof emptyDocument>) => {
        doc.pages[0].geometry.width = 800;
      },
      (doc: ReturnType<typeof emptyDocument>) => doc.pages.push(blankPage("p2")),
    ];
    for (const mutate of mutations) {
      const doc = emptyDocument(1024);
      const before = companionContent(doc, options, []);
      mutate(doc);
      expect(companionContent(doc, options, [])).not.toBe(before);
    }
    const doc = emptyDocument(1024);
    doc.pages.push({ ...blankPage("p2"), backdrop: { kind: "pdf", path: "Source.pdf", page: 0 } });
    const before = companionContent(doc, options, []);
    doc.pages.reverse();
    expect(companionContent(doc, options, [])).not.toBe(before);
    expect(companionResources(doc)).toEqual(["Source.pdf"]);
  });
});

it("simultaneous manual requests on a clean PDF retain one forced refresh", async () => {
  const s = setup();
  await s.controller.update(ID, s.snapshot);
  s.render.mockClear();
  await Promise.all([
    s.controller.update(ID, s.snapshot, true),
    s.controller.update(ID, s.snapshot, true),
  ]);
  expect(s.render).toHaveBeenCalledOnce();
});

it("fingerprints rendering metadata while excluding stroke identity and replay timing", () => {
  const doc = emptyDocument(1024),
    options = { usePressure: false, highlighterAlpha: 0.4 };
  doc.pages[0].strokes.push({
    id: "s",
    tool: "pen",
    color: "#000",
    size: 3,
    pts: [1, 2, 0.5, 4, 5, 0.5],
  });
  const before = companionContent(doc, options, []);
  doc.pages[0].strokes[0].id = "another";
  doc.pages[0].strokes[0].t0 = 250;
  expect(companionContent(doc, options, [])).toBe(before);
  doc.pages[0].strokes[0].shape = "line";
  expect(companionContent(doc, options, [])).not.toBe(before);
});

it("automatically fingerprints unknown future visual fields added to Page", () => {
  const doc = emptyDocument(1024);
  const options = { usePressure: false, highlighterAlpha: 0.4 };
  const before = companionContent(doc, options, []);
  (doc.pages[0] as unknown as Record<string, unknown>).futureDiagrams = [{ x: 10, y: 20 }];
  expect(companionContent(doc, options, [])).not.toBe(before);
});
