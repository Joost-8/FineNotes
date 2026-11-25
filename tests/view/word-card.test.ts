/**
 * The word card's answers and what each records (word-check.ts `ask`):
 * Grape's misreads teach it; a word the writer wrote wrong ("Should be …")
 * fixes the text, and the ink keeps its reading as label (RESEARCH-LOG 2026-11-25).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

interface Content {
  read: string;
  chips: readonly string[];
  onChip: (word: string) => void;
  rows: readonly { icon: string; label: string; sub?: string; run: () => void }[];
}
const shown: Content[] = [];
vi.mock("../../src/view/word-popover", () => ({
  WordPopover: class {
    constructor(_at: unknown, content: Content) {
      shown.push(content);
    }
  },
}));

const { WordCheck } = await import("../../src/view/word-check");
const { parseCorrections, strokeKey } = await import("../../src/recognition/hwr/corrections");

const FILE = "FineNotes assets/Handwriting sheets/corrections.json";

function setup() {
  const store = new Map<string, string>();
  const app = {
    vault: {
      adapter: {
        exists: async (path: string) => store.has(path),
        read: async (path: string) => store.get(path) ?? "",
        write: async (path: string, text: string) => void store.set(path, text),
        remove: async (path: string) => void store.delete(path),
        mkdir: async () => undefined,
      },
    },
  };
  const check = new WordCheck(
    app as never,
    () => "plug",
    () => Promise.resolve(null),
  );
  return { check, store };
}

const word = (suggestion: { margin: number; words: string[] } | null) => ({
  note: "Notes/Week 3.notebook.md",
  pageId: "p1",
  word: { text: "recieve", strokeIds: ["s1", "s2"] },
  strokes: [
    { id: "s1", pts: [0, 0, 0.5, 5, 5, 0.5], t0: 0 },
    { id: "s2", pts: [9, 0, 0.5], t0: 40 },
  ] as never,
  suggestion: suggestion && { ...suggestion, candidates: suggestion.words.length },
});

function open(
  check: InstanceType<typeof WordCheck>,
  suggestion: { margin: number; words: string[] } | null,
  asked = false,
  hand?: { offer: (t: string) => void; write: (t: string) => void; writes: (t: string) => boolean },
): Content {
  shown.length = 0;
  check.ask(
    word(suggestion),
    { x: 0, y: 0 },
    () => {},
    () => {},
    asked,
    hand,
  );
  return shown[0];
}

async function saved(store: Map<string, string>) {
  await vi.waitFor(() => expect(store.has(FILE)).toBe(true));
  return parseCorrections(store.get(FILE) ?? null).corrections;
}

describe("the word card", () => {
  it("offers the close list word as what the writer meant when the ink says the reading", () => {
    const { check } = setup();
    const card = open(check, { margin: 2.4, words: ["receive", "relieve"] });
    expect(card.chips).toEqual([]);
    expect(card.rows.map((r) => r.label)).toEqual([
      "It says “recieve”",
      "Should be “receive”",
      "Add to dictionary",
      "Type what it says…",
    ]);
  });

  it("Should be: the text says the meant word, the label stays the reading, and the ink is written in the hand", async () => {
    const { check, store } = setup();
    const hand = { offer: vi.fn(), write: vi.fn(), writes: () => true };
    const card = open(check, { margin: 2.4, words: ["receive"] }, false, hand);
    const row = card.rows.find((r) => r.label.startsWith("Should be"));
    expect(row?.sub).toBe("In your handwriting too");
    row?.run();
    const [answer] = await saved(store);
    expect(answer).toMatchObject({
      kind: "mistake",
      read: "recieve",
      text: "recieve",
      meant: "receive",
    });
    await vi.waitFor(() => expect(hand.write).toHaveBeenCalledWith("receive"));
    expect(hand.offer).not.toHaveBeenCalled();
    expect(check.answeredAt).toHaveLength(1);
    expect([...check.shownOn("Notes/Week 3.notebook.md", "p1")]).toEqual([
      [strokeKey(["s1", "s2"]), "receive"],
    ]);
  });

  it("Should be without the writer: the text alone, and no line about the hand", async () => {
    const { check, store } = setup();
    const card = open(check, { margin: 2.4, words: ["receive"] });
    const row = card.rows.find((r) => r.label.startsWith("Should be"));
    expect(row?.sub).toBeUndefined();
    row?.run();
    expect((await saved(store))[0].meant).toBe("receive");
  });

  it("keeps the misread card as it was: chips first, no Should be, and a chip teaches", async () => {
    const { check, store } = setup();
    const card = open(check, { margin: 0.3, words: ["receive", "recline"] });
    expect(card.chips).toEqual(["receive", "recline"]);
    expect(card.rows.map((r) => r.label)).toEqual([
      "Type what it says…",
      "It says “recieve”",
      "Add to dictionary",
    ]);
    card.onChip("receive");
    const [answer] = await saved(store);
    expect(answer).toMatchObject({ kind: "misread", text: "receive" });
    expect(answer.meant).toBeUndefined();
    expect(check.answeredAt).toHaveLength(1);
  });

  it("It says: the reading is what the ink says, and it is learned", async () => {
    const { check, store } = setup();
    const card = open(check, { margin: 2.4, words: ["receive"] });
    card.rows[0].run();
    const [answer] = await saved(store);
    expect(answer).toMatchObject({ kind: "mistake", text: "recieve" });
    expect(answer.meant).toBeUndefined();
    expect(check.answeredAt).toHaveLength(1);
  });

  it("Correct on a word whose ink says the reading: Type first, then It says and Should be", () => {
    const { check } = setup();
    const card = open(check, { margin: 2.4, words: ["receive"] }, true);
    expect(card.rows.map((r) => r.label)).toEqual([
      "Type what it says…",
      "It says “recieve”",
      "Should be “receive”",
      "Add to dictionary",
    ]);
  });

  it("no close word: no Should be", () => {
    const { check } = setup();
    expect(open(check, null).rows.map((r) => r.label)).toEqual([
      "It says “recieve”",
      "Add to dictionary",
      "Type what it says…",
    ]);
  });
});

describe("underlines on a page in another language", () => {
  const read = (text: string, id: string) => ({ text, strokeIds: [id] });
  const words = [read("tentamen", "a"), read("rekenmashine", "b"), read("exam", "c")];
  const make = (pack: { words: string[]; underline: boolean } | null) =>
    new WordCheck(
      {
        vault: {
          adapter: { exists: async () => false, read: async () => "", write: async () => {} },
        },
      } as never,
      () => "plug",
      () => Promise.resolve("exam\ntentamen\n"),
      async (language) =>
        language === "nl" && pack
          ? { words: new Set(pack.words), underline: pack.underline }
          : null,
    );

  it("checks a Dutch page against the Dutch pack's list when it may underline", async () => {
    const check = make({ words: ["tentamen", "exam"], underline: true });
    const flagged = await check.flags("n.notebook.md", "p1", words, "nl");
    expect(flagged.map((w) => w.text)).toEqual(["rekenmashine"]);
  });

  it("underlines nothing there when the pack may not, or is not here", async () => {
    expect(await make({ words: ["exam"], underline: false }).flags("n", "p1", words, "nl")).toEqual(
      [],
    );
    expect(await make(null).flags("n", "p1", words, "nl")).toEqual([]);
  });

  it("still checks an English page against the English list", async () => {
    const flagged = await make(null).flags("n", "p1", words, "en");
    expect(flagged.map((w) => w.text)).toEqual(["rekenmashine"]);
  });
});
