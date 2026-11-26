/**
 * One notebook's companion session: a notebook left for another tab is
 * exported once it has waited, never while the app is in the background,
 * and this device's changed export switches make its PDF behind here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/view/pdf-export", () => ({ exportPagesToPdf: vi.fn() }));
vi.mock("../../src/view/image-cache", () => ({ VaultImageCache: class {} }));
vi.mock("../../src/view/pdf-backdrop", () => ({ PdfBackdropCache: class {} }));

const { TFile } = await import("./fake-obsidian");
const { CompanionSession, LEFT_EXPORT_MS } = await import("../../src/view/companion-session");
const { DocumentEncoder } = await import("../../src/model/serialize");
const { emptyDocument } = await import("../../src/model/document");

const ID = "a3f9211234567890";

function setup(entry: { enabled: boolean; dirty: boolean; optionsKey?: string }) {
  const file = new TFile("School/Cell.notebook.md");
  const doc = emptyDocument();
  const leaf = {};
  let hidden = false;
  let options = { usePressure: true, highlighterAlpha: 0.4 };
  const manager = {
    entry: () => entry,
    revisionOf: () => 3,
    markDirty: vi.fn(() => {
      entry.dirty = true;
    }),
    requestExport: vi.fn(async () => {}),
  };
  const saveNow = vi.fn(async () => {});
  const session = new CompanionSession(
    {
      app: {} as never,
      file: file as never,
      noteBody: `---\nfinenotes-companion-id: "${ID}"\n---\n`,
      doc,
      paperWidth: 1000,
      snapshot: () => new DocumentEncoder().snapshot(doc),
      options: () => options,
      crop: (page) => page,
      exportsFolder: () => undefined,
      saveNow,
      saveBody: async () => {},
      writable: () => true,
      penDown: () => false,
      uses: () => false,
      isLeaf: (other) => other === leaf,
      hidden: () => hidden,
    },
    manager as never,
  );
  return {
    session,
    manager,
    saveNow,
    leaf,
    file,
    hide: () => (hidden = true),
    switchOptions: () => (options = { usePressure: false, highlighterAlpha: 0.4 }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a notebook left for another tab", () => {
  it("is exported once it has been out of sight for a while, with the edit count it was captured at", async () => {
    const s = setup({ enabled: true, dirty: true });
    s.session.activeLeafChanged({});
    await vi.advanceTimersByTimeAsync(LEFT_EXPORT_MS - 1000);
    expect(s.manager.requestExport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.saveNow).toHaveBeenCalled();
    expect(s.manager.requestExport).toHaveBeenCalledTimes(1);
    const capture = (
      s.manager.requestExport.mock.calls[0] as unknown as [
        string,
        unknown,
        () => { revision: number },
      ]
    )[2];
    expect(capture().revision).toBe(3);
  });

  it("is not exported when it comes back in time, or has not changed", async () => {
    const s = setup({ enabled: true, dirty: true });
    s.session.activeLeafChanged({});
    await vi.advanceTimersByTimeAsync(10_000);
    s.session.activeLeafChanged(s.leaf);
    await vi.advanceTimersByTimeAsync(LEFT_EXPORT_MS);
    const clean = setup({ enabled: true, dirty: false });
    clean.session.activeLeafChanged({});
    await vi.advanceTimersByTimeAsync(LEFT_EXPORT_MS);
    expect(s.manager.requestExport).not.toHaveBeenCalled();
    expect(clean.manager.requestExport).not.toHaveBeenCalled();
  });

  it("is never exported while the app is in the background", async () => {
    const s = setup({ enabled: true, dirty: true });
    s.session.activeLeafChanged({});
    s.hide();
    await vi.advanceTimersByTimeAsync(LEFT_EXPORT_MS);
    expect(s.manager.requestExport).not.toHaveBeenCalled();
  });
});

describe("this device's export switches", () => {
  it("changed, the PDF is behind on this device and is made again at close", async () => {
    const s = setup({
      enabled: true,
      dirty: false,
      optionsKey: JSON.stringify({ usePressure: true, highlighterAlpha: 0.4 }),
    });
    await s.session.close(s.file as never);
    expect(s.manager.requestExport).not.toHaveBeenCalled();
    const t = setup({
      enabled: true,
      dirty: false,
      optionsKey: JSON.stringify({ usePressure: true, highlighterAlpha: 0.4 }),
    });
    t.switchOptions();
    await t.session.close(t.file as never);
    expect(t.manager.markDirty).toHaveBeenCalledWith(ID);
    expect(t.manager.requestExport).toHaveBeenCalledTimes(1);
  });
});
