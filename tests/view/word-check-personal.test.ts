/**
 * `WordCheck` with the writer's own words (personal-words.ts): answers in
 * the corrections file join the list the reader, the underlines and
 * Beautify use, those already there when it loads included.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { WordCheck } = await import("../../src/view/word-check");

const CORRECTIONS = "FineNotes assets/Handwriting sheets/corrections.json";

function setUp(files: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(files));
  const adapter = {
    exists: async (path: string) =>
      store.has(path) || [...store.keys()].some((k) => k.startsWith(`${path}/`)),
    read: async (path: string) => store.get(path) ?? "",
    write: async (path: string, text: string) => void store.set(path, text),
    remove: async (path: string) => void store.delete(path),
    mkdir: async () => undefined,
  };
  const app = { vault: { adapter } };
  return new WordCheck(
    app as never,
    () => "plug",
    () => Promise.resolve("the\nprime\n"),
  );
}

function word(text: string, id: string) {
  return {
    note: "Notes.notebook.md",
    pageId: "p1",
    word: { text, strokeIds: [id] },
    strokes: [{ id, pts: new Float32Array([0, 0, 0.5, 9, 9, 0.5]), t0: 0 }] as never,
  };
}

describe("WordCheck's list with the writer's words", () => {
  it("takes in the answers already saved, the first time it loads", async () => {
    const old = {
      version: 1,
      corrections: [
        {
          kind: "misread",
          read: "coptime",
          text: "coprime",
          note: "Old.notebook.md",
          page: "p9",
          strokes: [{ id: "x", pts: [0, 0, 0.5], t0: null }],
          at: 1,
        },
      ],
    };
    const check = setUp({ [CORRECTIONS]: JSON.stringify(old) });
    await check.load();
    const list = check.lexicon();
    expect(list?.words()).toContain("coprime");
    expect([...(list?.answered() ?? [])]).toEqual(["coprime"]);
    // Read right on another page later, it is not underlined.
    const flags = await check.flags("Notes.notebook.md", "p1", [
      { text: "coprime", strokeIds: ["t1"] },
    ]);
    expect(flags).toEqual([]);
  });

  it("adds an answer at once, and tells the reader the list changed", async () => {
    const check = setUp();
    await check.load();
    const before = check.lexicon();
    expect(before?.words()).not.toContain("resit");
    await check.record(word("Debit", "s1"), "misread", "Resit");
    const after = check.lexicon();
    expect(after?.words()).toContain("resit");
    expect(after?.version).not.toBe(before?.version);
    // The same word answered again changes nothing, so the reader is not sent it twice.
    await check.record(word("Resit", "s2"), "mistake", "Resit");
    expect(check.lexicon()?.version).toBe(after?.version);
  });
});
