import { describe, expect, it, vi } from "vitest";
import {
  replaceCompanionPdf,
  recoverCompanionWrite,
  type CompanionWriteIO,
} from "../../src/model/companion-write";
import type { CompanionEntry } from "../../src/model/companion-pdf";
const ID = "a3f9211234567890";
function setup() {
  const entry: CompanionEntry = {
    notebookPath: "Book.notebook.md",
    pdfPath: "Book.pdf",
    enabled: true,
    followName: true,
    dirty: true,
  };
  const files = new Map<string, string>([[entry.pdfPath, "old:" + ID]]);
  const io: CompanionWriteIO = {
    exists: (path) => files.has(path),
    create: vi.fn(async (path, bytes) => {
      files.set(path, new TextDecoder().decode(bytes));
    }),
    identity: async (path) => files.get(path)?.split(":")[1] ?? null,
    rename: vi.fn(async (from, to) => {
      if (!files.has(from) || files.has(to)) throw new Error("rename collision");
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    remove: vi.fn(async (path) => {
      files.delete(path);
    }),
    persist: vi.fn(async () => {}),
  };
  return { entry, files, io, bytes: new TextEncoder().encode("new:" + ID) };
}
describe("safe companion replacement journal", () => {
  it("validates staging before renaming the previous good PDF and leaves one target", async () => {
    const s = setup();
    await replaceCompanionPdf(s.entry, s.bytes, ID, s.io);
    expect(s.files).toEqual(new Map([["Book.pdf", "new:" + ID]]));
    expect(s.entry.transaction).toBeUndefined();
    expect(s.io.persist).toHaveBeenCalledTimes(2);
  });
  it("a failed stage write leaves the previous good PDF untouched", async () => {
    const s = setup();
    vi.mocked(s.io.create).mockRejectedValueOnce(new Error("write denied"));
    await expect(replaceCompanionPdf(s.entry, s.bytes, ID, s.io)).rejects.toThrow("write denied");
    expect(s.files.get("Book.pdf")).toBe("old:" + ID);
    await recoverCompanionWrite(s.entry, ID, s.io);
    await replaceCompanionPdf(s.entry, s.bytes, ID, s.io);
    expect(s.files.get("Book.pdf")).toBe("new:" + ID);
  });
  it("a failed promotion restores the old file by rename", async () => {
    const s = setup();
    const original = s.io.rename;
    s.io.rename = vi.fn(async (from, to) => {
      if (from.includes("pending")) throw new Error("promotion failed");
      await original(from, to);
    });
    await expect(replaceCompanionPdf(s.entry, s.bytes, ID, s.io)).rejects.toThrow(
      "promotion failed",
    );
    expect(s.files.get("Book.pdf")).toBe("old:" + ID);
    expect(s.entry.transaction).toBeDefined();
    await recoverCompanionWrite(s.entry, ID, s.io);
    expect(s.files.size).toBe(1);
    expect(s.entry.transaction).toBeUndefined();
  });
  it("restart between renames restores the retained good backup", async () => {
    const s = setup();
    const stage = `Book.pdf.fn-${ID}-pending.pdf`,
      backup = `Book.pdf.fn-${ID}-backup.pdf`;
    s.entry.transaction = { target: "Book.pdf", stage, backup };
    s.files.delete("Book.pdf");
    s.files.set(backup, "old:" + ID);
    s.files.set(stage, "new:" + ID);
    await recoverCompanionWrite(s.entry, ID, s.io);
    expect(s.files).toEqual(new Map([["Book.pdf", "old:" + ID]]));
  });
  it("restart after promotion cleans only journal artifacts", async () => {
    const s = setup();
    const stage = `Book.pdf.fn-${ID}-pending.pdf`,
      backup = `Book.pdf.fn-${ID}-backup.pdf`;
    s.entry.transaction = { target: "Book.pdf", stage, backup };
    s.files.set("Book.pdf", "new:" + ID);
    s.files.set(backup, "old:" + ID);
    await recoverCompanionWrite(s.entry, ID, s.io);
    expect(s.files).toEqual(new Map([["Book.pdf", "new:" + ID]]));
  });
  it("never overwrites an unrelated target or reserved-path collision", async () => {
    const s = setup();
    s.files.set("Book.pdf", "other:bbbbbbbbbbbbbbbb");
    await expect(replaceCompanionPdf(s.entry, s.bytes, ID, s.io)).rejects.toThrow("unrelated");
    expect(s.io.create).not.toHaveBeenCalled();
    s.files.set("Book.pdf", "old:" + ID);
    s.files.set(`Book.pdf.fn-${ID}-pending.pdf`, "unrelated");
    await expect(replaceCompanionPdf(s.entry, s.bytes, ID, s.io)).rejects.toThrow("occupied");
    expect(s.files.get("Book.pdf")).toBe("old:" + ID);
  });
  it("invalid/partial staging cannot become the target", async () => {
    const s = setup();
    await expect(replaceCompanionPdf(s.entry, new Uint8Array(), ID, s.io)).rejects.toThrow(
      "validate",
    );
    expect(s.files.get("Book.pdf")).toBe("old:" + ID);
    await recoverCompanionWrite(s.entry, ID, s.io);
    expect(s.files.size).toBe(1);
  });
  it("an unrelated target appearing during recovery is preserved along with the good backup", async () => {
    const s = setup();
    const stage = `Book.pdf.fn-${ID}-pending.pdf`,
      backup = `Book.pdf.fn-${ID}-backup.pdf`;
    s.entry.transaction = { target: "Book.pdf", stage, backup };
    s.files.set("Book.pdf", "other:bbbbbbbbbbbbbbbb");
    s.files.set(backup, "old:" + ID);
    await expect(recoverCompanionWrite(s.entry, ID, s.io)).rejects.toThrow("backup is preserved");
    expect(s.files.get("Book.pdf")).toBe("other:bbbbbbbbbbbbbbbb");
    expect(s.files.get(backup)).toBe("old:" + ID);
  });
});

it("a failed first export with no previous PDF can recover and retry", async () => {
  const s = setup();
  s.files.clear();
  vi.mocked(s.io.create).mockRejectedValueOnce(new Error("write denied"));
  await expect(replaceCompanionPdf(s.entry, s.bytes, ID, s.io)).rejects.toThrow("write denied");
  await recoverCompanionWrite(s.entry, ID, s.io);
  expect(s.entry.transaction).toBeUndefined();
  await replaceCompanionPdf(s.entry, s.bytes, ID, s.io);
  expect(s.files.get("Book.pdf")).toBe("new:" + ID);
});
