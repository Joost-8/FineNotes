import { describe, expect, it, vi } from "vitest";
import { LoadGuard, type NoteRead, distrust } from "../../src/view/load-guard";

function read(text: string, bytesOnDisk = 100, decoded = false): NoteRead {
  return { text, bytesOnDisk, decoded };
}

describe("distrust", () => {
  it("trusts a note that decoded", () => {
    expect(distrust(read("%%goodobsidian\nv2:abc\n%%\n", 100, true))).toBeNull();
  });

  it("trusts a note with no ink block at all", () => {
    expect(distrust(read("---\ngoodobsidian: true\n---\nProse.\n"))).toBeNull();
  });

  it("distrusts nothing but whitespace from a file with bytes", () => {
    for (const text of ["", " ", "\n\n", "\t \r\n", "﻿"]) {
      expect(distrust(read(text))).toBe("empty-read");
    }
  });

  it("trusts an empty read of an empty file, or of one whose size is unknown", () => {
    expect(distrust(read("", 0))).toBeNull();
    expect(distrust(read("  \n", 0))).toBeNull();
  });

  it("distrusts an ink block that did not decode, current or legacy", () => {
    expect(distrust(read("Prose\n%%goodobsidian\nv2:@@\n%%\n"))).toBe("unreadable-ink");
    expect(distrust(read("Prose\n%%inkedmark\nv2:@@\n%%\n"))).toBe("unreadable-ink");
    expect(distrust(read("%%goodobsidian\nv2:abc", 0))).toBe("unreadable-ink");
  });

  it("matches the block's opener exactly, as the parser does", () => {
    expect(distrust(read("%%GoodObsidian\n"))).toBeNull();
    expect(distrust(read("%% goodobsidian\n"))).toBeNull();
    expect(distrust(read("text %%goodobsidian-ish"))).toBe("unreadable-ink");
  });

  it("does not care about the size when the text is there", () => {
    expect(distrust(read("Prose.\n", 0))).toBeNull();
    expect(distrust(read("Prose.\n", 1_000_000))).toBeNull();
  });
});

describe("LoadGuard", () => {
  it("rebuilds the file while nothing is held", () => {
    const guard = new LoadGuard();
    expect(guard.locked).toBe(false);
    expect(guard.admit(read("Prose.\n"))).toBeNull();
    expect(guard.locked).toBe(false);
    expect(guard.contents(() => "rebuilt")).toBe("rebuilt");
  });

  it("echoes a held read without rebuilding", () => {
    const guard = new LoadGuard();
    expect(guard.admit(read(""))).toBe("empty-read");
    expect(guard.locked).toBe(true);
    const rebuild = vi.fn(() => "rebuilt");
    expect(guard.contents(rebuild)).toBe("");
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("keeps the held text byte for byte", () => {
    const guard = new LoadGuard();
    const text = "\r\nProse é\n%%inkedmark\nv2:@@\n";
    guard.admit(read(text));
    expect(guard.contents(() => "")).toBe(text);
  });

  it("releases on the next trusted read, and holds the newest untrusted one", () => {
    const guard = new LoadGuard();
    guard.admit(read(""));
    guard.admit(read("%%goodobsidian\nbroken"));
    expect(guard.contents(() => "rebuilt")).toBe("%%goodobsidian\nbroken");
    guard.admit(read("%%goodobsidian\nfine\n%%\n", 100, true));
    expect(guard.locked).toBe(false);
    expect(guard.contents(() => "rebuilt")).toBe("rebuilt");
  });
});
