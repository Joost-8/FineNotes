/**
 * The corrected words moving from the plugin's folder to FineNotes
 * handwriting sheets (word-check.ts `moveLegacy`), and the count each saved
 * answer reports for the reminder to learn again.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { WordCheck } = await import("../../src/view/word-check");
const { addCorrection, emptyCorrections, parseCorrections, serializeCorrections } =
  await import("../../src/recognition/hwr/corrections");

const OLD = "plug/handwriting/corrections.json";
const NEW = "FineNotes assets/Handwriting sheets/corrections.json";

function correction(page: string, text: string) {
  return {
    kind: "misread" as const,
    read: "x",
    text,
    note: "n.notebook.md",
    page,
    strokes: [{ id: "s1", pts: [0, 0, 0.5], t0: null }],
    at: 1,
  };
}

function fileOf(...items: ReturnType<typeof correction>[]): string {
  return serializeCorrections(items.reduce(addCorrection, emptyCorrections()));
}

function fakeApp(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const app = {
    vault: {
      adapter: {
        exists: async (path: string) =>
          store.has(path) || [...store.keys()].some((k) => k.startsWith(`${path}/`)),
        read: async (path: string) => store.get(path) ?? "",
        write: async (path: string, text: string) => void store.set(path, text),
        remove: async (path: string) => void store.delete(path),
        mkdir: async () => undefined,
      },
    },
  };
  return { app: app as never, store };
}

const noList = () => Promise.resolve(null);

describe("moving the corrections out of the plugin's folder", () => {
  it("merges the old file into the vault's and removes it", async () => {
    const { app, store } = fakeApp({
      [OLD]: fileOf(correction("p1", "old"), correction("p2", "monic")),
      [NEW]: fileOf(correction("p1", "newer")),
    });
    const check = new WordCheck(app, () => "plug", noList);
    await check.load();
    expect(store.has(OLD)).toBe(false);
    const moved = parseCorrections(store.get(NEW) ?? null).corrections.map((c) => c.text);
    expect(moved).toEqual(["monic", "newer"]);
    expect(check.count).toBe(2);
  });

  it("leaves an old file that is not JSON where it is", async () => {
    const { app, store } = fakeApp({ [OLD]: "{ half synced" });
    await new WordCheck(app, () => "plug", noList).load();
    expect(store.get(OLD)).toBe("{ half synced");
    expect(store.has(NEW)).toBe(false);
  });

  it("tells how many answers there are after each one is saved", async () => {
    const { app, store } = fakeApp({});
    const check = new WordCheck(app, () => "plug", noList);
    const counts: number[] = [];
    check.answered = (count) => counts.push(count);
    const word = {
      note: "n.notebook.md",
      pageId: "p1",
      word: { text: "integets", strokeIds: ["s1"] },
      strokes: [{ id: "s1", pts: new Float32Array([0, 0, 0.5]), t0: 0 }] as never,
    };
    await check.record(word, "misread", "integers");
    await check.record({ ...word, pageId: "p2" }, "ignore", "integets");
    expect(counts).toEqual([1, 2]);
    expect(parseCorrections(store.get(NEW) ?? null).corrections).toHaveLength(2);
  });
});
