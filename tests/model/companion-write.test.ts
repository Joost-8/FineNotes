/**
 * Replacing a Companion PDF: the good PDF is never truncated, this device's
 * own files are never read back, an unrelated file is never replaced, and
 * an interrupted write is finished from the journal alone.
 */
import { describe, expect, it, vi } from "vitest";
import { companionTransaction, type CompanionEntry } from "../../src/model/companion-pdf";
import {
  recoverCompanionWrite,
  replaceCompanionPdf,
  type CompanionWriteIO,
} from "../../src/model/companion-write";

const ID = "a3f9211234567890";
const TARGET = "Exports/Cell.pdf";
const tx = companionTransaction(TARGET, ID, "devA");

function setup(files: Record<string, string> = {}, ours = true) {
  const disk = new Map(Object.entries(files));
  const entry: CompanionEntry = {
    notebookPath: "Cell.notebook.md",
    pdfPath: TARGET,
    enabled: true,
    followName: true,
    dirty: true,
  };
  const journal: Array<CompanionEntry["transaction"]> = [];
  const io = {
    exists: (path: string) => disk.has(path),
    owned: vi.fn(async () => ours),
    create: vi.fn(async (path: string, bytes: Uint8Array) => {
      disk.set(path, new TextDecoder().decode(bytes));
    }),
    rename: vi.fn(async (from: string, to: string) => {
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    }),
    remove: vi.fn(async (path: string) => void disk.delete(path)),
    persist: vi.fn(() => journal.push(entry.transaction && { ...entry.transaction })),
  } satisfies CompanionWriteIO;
  return { disk, entry, io, journal };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("replacing the PDF", () => {
  it("stages, moves the old one aside, promotes, and cleans up, reading nothing back", async () => {
    const s = setup({ [TARGET]: "old" });
    await replaceCompanionPdf(s.entry, tx, bytes("new"), s.io);
    expect([...s.disk]).toEqual([[TARGET, "new"]]);
    // Only the PDF that was there is checked; the stage and the result are not read.
    expect(s.io.owned).toHaveBeenCalledTimes(1);
    expect(s.io.owned).toHaveBeenCalledWith(TARGET);
    expect(s.entry.transaction).toBeUndefined();
    // The journal held the paths before the first write.
    expect(s.journal[0]).toEqual(tx);
    expect(s.io.create.mock.invocationCallOrder[0]).toBeGreaterThan(
      s.io.persist.mock.invocationCallOrder[0],
    );
  });

  it("writes a first PDF without checking anything", async () => {
    const s = setup();
    await replaceCompanionPdf(s.entry, tx, bytes("new"), s.io);
    expect([...s.disk]).toEqual([[TARGET, "new"]]);
    expect(s.io.owned).not.toHaveBeenCalled();
  });

  it("refuses to replace a file that is not this notebook's", async () => {
    const s = setup({ [TARGET]: "someone else's" }, false);
    await expect(replaceCompanionPdf(s.entry, tx, bytes("new"), s.io)).rejects.toMatchObject({
      code: "occupied",
    });
    expect([...s.disk]).toEqual([[TARGET, "someone else's"]]);
    expect(s.io.create).not.toHaveBeenCalled();
  });

  it("keeps the good PDF when the new one cannot be written", async () => {
    const s = setup({ [TARGET]: "old" });
    s.io.create.mockRejectedValueOnce(new Error("disk full"));
    await expect(replaceCompanionPdf(s.entry, tx, bytes("new"), s.io)).rejects.toMatchObject({
      code: "write",
    });
    expect(s.disk.get(TARGET)).toBe("old");
    expect(s.entry.transaction).toBeUndefined();
  });

  it("puts the old PDF back when the new one cannot take its name", async () => {
    const s = setup({ [TARGET]: "old" });
    const rename = s.io.rename.getMockImplementation()!;
    s.io.rename.mockImplementation(async (from, to) => {
      if (from === tx.stage) throw new Error("locked");
      return rename(from, to);
    });
    await expect(replaceCompanionPdf(s.entry, tx, bytes("new"), s.io)).rejects.toMatchObject({
      code: "write",
    });
    expect(s.disk.get(TARGET)).toBe("old");
    expect(s.disk.has(tx.stage)).toBe(false);
    expect(s.disk.has(tx.backup)).toBe(false);
  });
});

describe("finishing an interrupted write at the next start", () => {
  it("puts the moved-aside PDF back when the new one never took its name", async () => {
    const s = setup({ [tx.backup]: "old", [tx.stage]: "new" });
    s.entry.transaction = { ...tx, staged: true };
    await recoverCompanionWrite(s.entry, s.io);
    expect([...s.disk]).toEqual([[TARGET, "old"]]);
    expect(s.entry.transaction).toBeUndefined();
  });

  it("promotes a complete stage when there was no PDF before", async () => {
    const s = setup({ [tx.stage]: "new" });
    s.entry.transaction = { ...tx, staged: true };
    await recoverCompanionWrite(s.entry, s.io);
    expect([...s.disk]).toEqual([[TARGET, "new"]]);
  });

  it("drops a stage that may be half written", async () => {
    const s = setup({ [TARGET]: "old", [tx.stage]: "ne" });
    s.entry.transaction = { ...tx };
    await recoverCompanionWrite(s.entry, s.io);
    expect([...s.disk]).toEqual([[TARGET, "old"]]);
  });

  it("removes a backup left after the new PDF took its name", async () => {
    const s = setup({ [TARGET]: "new", [tx.backup]: "old" });
    s.entry.transaction = { ...tx, staged: true };
    await recoverCompanionWrite(s.entry, s.io);
    expect([...s.disk]).toEqual([[TARGET, "new"]]);
    expect(s.io.owned).not.toHaveBeenCalled();
  });
});
