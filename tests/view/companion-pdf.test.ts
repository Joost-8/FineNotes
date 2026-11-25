import { PDFDocument } from "pdf-lib";
import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { companionPdfMeta, companionPdfSubject } from "../../src/export/companion-metadata";
import { type CompanionSnapshot, type CompanionStore } from "../../src/model/companion-pdf";
import { blankPage, emptyDocument } from "../../src/model/document";
import { DocumentEncoder } from "../../src/model/serialize";
import {
  CompanionPdfManager,
  companionDocument,
  companionFurniture,
  fingerprintCompanionDoc,
} from "../../src/view/companion-pdf";

vi.mock("obsidian", () => ({ Notice: vi.fn() }));
vi.mock("../../src/view/image-cache", () => ({}));
vi.mock("../../src/view/pdf-backdrop", () => ({}));
vi.mock("../../src/view/pdf-export", () => ({}));

const ID = "a3f9211234567890";
const OLD = "Notes/Notebook.pdf";
const MOVED = "Archive/Renamed.pdf";
const FIRST_HASH = "1111111111111111";
const SECOND_HASH = "2222222222222222";
const KEYS = {
  id: "finenotes-companion-id",
  pdf: "finenotes-companion-pdf",
  follow: "finenotes-companion-follow",
};

const options = { usePressure: true, highlighterAlpha: 0.4 };
const snapshot = async (): Promise<CompanionSnapshot> => ({
  fingerprint: "local-fingerprint",
  contentHash: SECOND_HASH,
  resources: [],
  export: vi.fn(async () => new Uint8Array()),
});

async function pdf(hash?: string, id = ID): Promise<ArrayBuffer> {
  const out = await PDFDocument.create();
  out.addPage();
  out.setSubject(companionPdfSubject(id, hash));
  return (await out.save()).buffer as ArrayBuffer;
}

function setup() {
  const note = { path: "Notes/Notebook.notebook.md", basename: "Notebook.notebook" } as TFile;
  const files = new Map<string, TFile>([[note.path, note]]);
  const bytes = new Map<TFile, ArrayBuffer>();
  const frontmatter: Record<string, unknown> = {
    [KEYS.id]: ID,
    [KEYS.pdf]: OLD,
    [KEYS.follow]: true,
  };
  const body = () =>
    "---\n" +
    Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${String(value)}\n`)
      .join("") +
    "---\n";
  const app = {
    vault: {
      read: vi.fn(async () => body()),
      cachedRead: vi.fn(async () => body()),
      getFileByPath: (path: string) => files.get(path) ?? null,
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getFiles: () => [...files.values()],
      readBinary: vi.fn(async (file: TFile) => bytes.get(file)!),
      modifyBinary: vi.fn(async (file: TFile, data: ArrayBuffer) => {
        bytes.set(file, data);
      }),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (_: TFile, edit: (data: Record<string, unknown>) => void) => {
        edit(frontmatter);
      }),
    },
  };
  let saved: CompanionStore | undefined;
  const persist = async (store: CompanionStore) => {
    saved = structuredClone(store);
  };
  const newManager = () => new CompanionPdfManager(app as unknown as App, persist);
  const manager = newManager();
  const put = (path: string, data: ArrayBuffer, mtime = 10) => {
    const file = {
      path,
      extension: path.split(".").pop(),
      stat: { mtime, size: data.byteLength },
    } as TFile;
    files.set(path, file);
    bytes.set(file, data);
    return file;
  };
  return {
    app,
    note,
    files,
    bytes,
    frontmatter,
    body,
    manager,
    put,
    newManager,
    saved: () => saved,
  };
}

function vaultTimers(): void {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("portable companion associations", () => {
  it("waits for an authoritative new path even while an owned copy remains at the old one", async () => {
    const s = setup();
    s.put(OLD, await pdf(FIRST_HASH));
    s.manager.hydrateFromBody(s.note, s.body());
    s.frontmatter[KEYS.pdf] = MOVED;
    const render = vi.fn(snapshot);
    await expect(s.manager.update(ID, s.note, render, false)).rejects.toThrow("PDF missing");
    expect(s.manager.entry(ID)?.pdfPath).toBe(MOVED);
    expect(s.app.vault.readBinary).not.toHaveBeenCalled();
  });

  it("honors synced disabled frontmatter while the old PDF is still present", async () => {
    const s = setup();
    s.put(OLD, await pdf(FIRST_HASH));
    s.manager.hydrateFromBody(s.note, s.body());
    delete s.frontmatter[KEYS.pdf];
    const render = vi.fn(snapshot);
    await s.manager.update(ID, s.note, render, false);
    expect(s.manager.entry(ID)?.enabled).toBe(false);
    expect(render).not.toHaveBeenCalled();
  });

  it("blocks recreation and distinguishes a delete-first synced move by rereading the notebook", async () => {
    vaultTimers();
    const s = setup();
    s.manager.hydrateFromBody(s.note, s.body());
    s.manager.deleted(OLD);
    const render = vi.fn(snapshot);
    await s.manager.update(ID, s.note, render, true);
    expect(render).not.toHaveBeenCalled();
    s.frontmatter[KEYS.pdf] = MOVED;
    await vi.runAllTimersAsync();
    expect(s.manager.entry(ID)).toMatchObject({ pdfPath: MOVED, enabled: true });
    expect(s.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(Notice).not.toHaveBeenCalled();
  });

  it("recognizes an owned PDF arriving at its new path before the notebook update", async () => {
    const movedPdf = await pdf(FIRST_HASH);
    vaultTimers();
    const s = setup();
    s.manager.hydrateFromBody(s.note, s.body());
    s.manager.deleted(OLD);
    s.put(MOVED, movedPdf);
    s.manager.modified(MOVED);
    await vi.runAllTimersAsync();
    expect(s.manager.entry(ID)).toMatchObject({ pdfPath: MOVED, enabled: true });
    expect(s.frontmatter[KEYS.pdf]).toBe(MOVED);
    expect(Notice).not.toHaveBeenCalled();
  });

  it("persists the pending deletion across restart and disables a confirmed deletion", async () => {
    vaultTimers();
    const s = setup();
    s.manager.hydrateFromBody(s.note, s.body());
    s.manager.deleted(OLD);
    s.manager.destroy();
    const restarted = s.newManager();
    restarted.load(s.saved());
    await vi.runAllTimersAsync();
    expect(restarted.entry(ID)).toMatchObject({ enabled: false, dirty: false });
    expect(restarted.entry(ID)?.deletedAt).toBeUndefined();
    expect(s.frontmatter).toEqual({ [KEYS.id]: ID });
    expect(Notice).toHaveBeenCalledOnce();
  });

  it("does not clear a companion when a sync replacement arrives at the same path", async () => {
    const replacement = await pdf(FIRST_HASH);
    vaultTimers();
    const s = setup();
    s.manager.hydrateFromBody(s.note, s.body());
    s.manager.deleted(OLD);
    s.put(OLD, replacement);
    await vi.runAllTimersAsync();
    expect(s.manager.entry(ID)?.enabled).toBe(true);
    expect(s.frontmatter[KEYS.pdf]).toBe(OLD);
    expect(Notice).not.toHaveBeenCalled();
  });
});

describe("companion export freshness", () => {
  it("hashes attachment bytes, caches reads locally, and invalidates cached values on vault events", async () => {
    const doc = emptyDocument(1024);
    doc.pages[0].backdrop = { kind: "pdf", path: "Source.pdf", page: 0 };
    const a = setup();
    const b = setup();
    const same = new Uint8Array([1, 2, 3]).buffer;
    const original = a.put("Source.pdf", same, 100);
    b.put("Source.pdf", same, 200);
    const read = (s: ReturnType<typeof setup>) =>
      fingerprintCompanionDoc(s.app as unknown as App, doc, "Notebook", options);
    const first = await read(a);
    expect((await read(b)).contentHash).toBe(first.contentHash);
    expect((await read(a)).contentHash).toBe(first.contentHash);
    expect(a.app.vault.readBinary).toHaveBeenCalledOnce();
    a.bytes.set(original, new Uint8Array([9, 2, 3]).buffer);
    a.manager.modified("Source.pdf");
    expect((await read(a)).contentHash).not.toBe(first.contentHash);
  });

  it("reassesses cached companion metadata and marks an arriving legacy PDF stale", async () => {
    const s = setup();
    const file = s.put(OLD, await pdf(SECOND_HASH));
    s.manager.hydrateFromBody(s.note, s.body());
    await s.manager.assess(ID, s.note, snapshot);
    expect(s.manager.entry(ID)?.dirty).toBe(false);
    s.bytes.set(file, await pdf(FIRST_HASH));
    s.manager.modified(OLD);
    await s.manager.assess(ID, s.note, snapshot);
    expect(s.manager.entry(ID)?.dirty).toBe(true);
    s.put(OLD, await pdf());
    s.manager.modified(OLD);
    await s.manager.assess(ID, s.note, snapshot);
    expect(s.manager.entry(ID)?.dirty).toBe(true);
  });

  it("stamps the hash from the saved export and detects when the notebook has since changed", async () => {
    const s = setup();
    delete s.frontmatter[KEYS.pdf];
    const plain = await PDFDocument.create();
    plain.addPage();
    const exported = (await plain.save()).buffer as ArrayBuffer;
    const file = s.put(OLD, exported);
    await s.manager.adoptExportedPdf(
      s.note,
      OLD,
      {
        fingerprint: "old-fingerprint",
        contentHash: FIRST_HASH,
        resources: [],
      },
      exported,
    );
    expect(await companionPdfMeta(s.bytes.get(file)!)).toEqual({ id: ID, contentHash: FIRST_HASH });
    await s.manager.assess(ID, s.note, snapshot);
    expect(s.manager.entry(ID)?.dirty).toBe(true);
  });

  it("snapshots saved pages and resolves furniture on a transformed page", () => {
    const doc = emptyDocument(1024);
    doc.pages.push(blankPage("new-page"));
    doc.furniture = { header: "{title} {page} of {pages}", numbers: "right" };
    const snapshot = new DocumentEncoder().snapshot(doc);
    doc.pages.reverse();
    doc.furniture.header = "Other";
    const captured = companionDocument(snapshot, 1024);
    expect(companionFurniture(captured, "Notebook")({ ...captured.pages[0] })).toEqual({
      header: "Notebook 1 of 2",
      footer: "1",
      align: "right",
    });
  });
});
