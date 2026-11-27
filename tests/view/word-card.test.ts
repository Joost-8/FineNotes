/**
 * The word card's answers and what each records (word-check.ts `ask`):
 * Grape's misreads teach it; a word the writer wrote wrong (a spelling fix)
 * fixes the text, and the ink keeps its reading as label (RESEARCH-LOG 2026-11-25).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

interface Content {
  read: string;
  spelling?: boolean;
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

async function setup() {
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
    () => Promise.resolve(["receive", "relieve", "recline", "revive"].join("\n")),
  );
  await check.load();
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
  it("asks a spelling question when the ink says the reading and a list word is close", async () => {
    const { check } = await setup();
    const card = open(check, { margin: 2.4, words: ["receive", "relieve"] });
    expect(card.spelling).toBe(true);
    expect(card.read).toBe("recieve");
    expect(card.chips).toEqual(["receive", "relieve"]);
    expect(card.rows.map((r) => r.label)).toEqual(["Grape misread it…", "Add to dictionary"]);
  });

  it("a spelling fix: the text says the meant word, the label stays the ink's, and that word is written in the hand", async () => {
    const { check, store } = await setup();
    const hand = { offer: vi.fn(), write: vi.fn(), writes: () => true };
    const card = open(check, { margin: 2.4, words: ["receive"] }, false, hand);
    card.onChip("receive");
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

  it("a spelling fix without the writer: the text alone", async () => {
    const { check, store } = await setup();
    open(check, { margin: 2.4, words: ["receive"] }).onChip("receive");
    expect((await saved(store))[0].meant).toBe("receive");
  });

  it("a spelling fix the model cannot write yet: the hand is asked to write, which starts its setup", async () => {
    const { check } = await setup();
    const hand = { offer: vi.fn(), write: vi.fn(), writes: () => true };
    open(check, { margin: 2.4, words: ["receive"] }, false, hand).onChip("receive");
    await vi.waitFor(() => expect(hand.write).toHaveBeenCalledWith("receive"));
  });

  it("asks a reading question when the ink fits list words as well: chips first, and a chip teaches", async () => {
    const { check, store } = await setup();
    const card = open(check, { margin: 0.3, words: ["receive", "recline"] });
    expect(card.spelling).toBeFalsy();
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
  });

  it("It says: the reading is what the ink says, and it is learned", async () => {
    const { check, store } = await setup();
    const card = open(check, null);
    expect(card.rows.map((r) => r.label)).toEqual([
      "It says “recieve”",
      "Add to dictionary",
      "Type what it says…",
    ]);
    card.rows[0].run();
    const [answer] = await saved(store);
    expect(answer).toMatchObject({ kind: "mistake", text: "recieve" });
    expect(answer.meant).toBeUndefined();
  });

  it("Correct on a misspelt word asks the spelling question too", async () => {
    const { check } = await setup();
    expect(open(check, { margin: 2.4, words: ["receive"] }, true).spelling).toBe(true);
  });
});

describe("a word Grape's second look changed (recive read as revive, Joost 2026-11-27)", () => {
  const changed = (check: InstanceType<typeof WordCheck>) => {
    shown.length = 0;
    check.ask(
      {
        ...word({ margin: 0.2, words: ["revive", "receive", "recite"] }),
        word: { text: "revive", wrote: "recive", strokeIds: ["s1", "s2"] },
      },
      { x: 0, y: 0 },
      () => {},
    );
    return shown[0];
  };

  it("shows what the ink spells, and the words it may have been meant as", async () => {
    const { check } = await setup();
    const card = changed(check);
    expect(card.spelling).toBe(true);
    expect(card.read).toBe("recive");
    expect(card.chips).toEqual(["revive", "receive", "recite"]);
  });

  it("picking Grape's own reading labels the ink as read: the second look was right", async () => {
    const { check, store } = await setup();
    changed(check).onChip("revive");
    const [answer] = await saved(store);
    expect(answer).toMatchObject({ kind: "mistake", read: "revive", text: "revive" });
    expect(answer.meant).toBeUndefined();
  });

  it("Beautify's card asks about the reading, not about the letters before the second look", async () => {
    const { check } = await setup();
    shown.length = 0;
    check.ask(
      {
        ...word({ margin: 0.2, words: ["revive", "receive", "recite"] }),
        word: { text: "revive", wrote: "recive", strokeIds: ["s1", "s2"] },
      },
      { x: 0, y: 0 },
      () => {},
      () => {},
      true,
    );
    expect(shown[0].spelling).toBeFalsy();
    expect(shown[0].read).toBe("revive");
  });

  it("a fix labels the ink as written and shows the meant word", async () => {
    const { check, store } = await setup();
    changed(check).onChip("receive");
    const [answer] = await saved(store);
    expect(answer).toMatchObject({
      kind: "mistake",
      read: "revive",
      text: "recive",
      meant: "receive",
    });
  });

  it("Add to dictionary keeps the word as written, and the text shows it", async () => {
    const { check, store } = await setup();
    changed(check)
      .rows.find((r) => r.label === "Add to dictionary")
      ?.run();
    const [answer] = await saved(store);
    expect(answer).toMatchObject({ kind: "ignore", read: "revive", text: "recive" });
    expect([...check.shownOn("Notes/Week 3.notebook.md", "p1")]).toEqual([
      [strokeKey(["s1", "s2"]), "recive"],
    ]);
  });

  it("is not underlined: the second look mostly puts Grape's own misreads right", async () => {
    const { check } = await setup();
    const w = { text: "revive", wrote: "recive", strokeIds: ["s1", "s2"] };
    expect(await check.flags("n.notebook.md", "p1", [w])).toHaveLength(0);
  });
});

describe("a spelling question only for a word its list lacks (Joost's iPad test, 2026-11-25)", () => {
  const list = "on\nat\nin\ntuesday\nthursday\nroom\nsoon\nreceive\nprovincie\n";
  const card = (text: string, suggested: string, language?: "en" | "nl") => {
    shown.length = 0;
    const check = new WordCheck(
      {
        vault: {
          adapter: { exists: async () => false, read: async () => "", write: async () => {} },
        },
      } as never,
      () => "plug",
      () => Promise.resolve(list),
      async (l) => (l === "nl" ? { words: new Set(["provincie"]), underline: false } : null),
    );
    return {
      check,
      show: () => {
        shown.length = 0;
        check.ask(
          {
            note: "n.notebook.md",
            pageId: "p1",
            word: { text, strokeIds: ["s1"] },
            strokes: [{ id: "s1", pts: [0, 0, 0.5], t0: 0 }] as never,
            suggestion: { margin: 2.4, words: [suggested], candidates: 1 },
            language,
          },
          { x: 0, y: 0 },
          () => {},
        );
        return shown[0];
      },
    };
  };

  it("asks none for a listed word, a short one, a number, a code or maths", async () => {
    for (const [text, suggested] of [
      ["Tuesday", "Thursday"],
      ["room", "soon"],
      ["on", "an"],
      ["at", "as"],
      ["B-214", "Be-234"],
      ["O(log", "clog"],
      ["n)", "no"],
      ["10:30", "10:00"],
    ]) {
      const { check, show } = card(text, suggested);
      await check.load();
      expect(show().spelling, text).toBeFalsy();
    }
  });

  it("still asks one for a plain word the list lacks", async () => {
    const { check, show } = card("recieve", "receive");
    await check.load();
    expect(show().chips).toEqual(["receive"]);
  });

  it("on another language's page, judges by that language's pack, and asks none without it", async () => {
    const dutch = card("provincie", "province", "nl");
    await dutch.check.flags("n.notebook.md", "p1", [], "nl");
    expect(dutch.show().spelling).toBeFalsy();
    const unknown = card("bestrigdt", "bestrijdt", "nl");
    await unknown.check.load();
    // The pack's list was never read: nothing to judge by.
    expect(unknown.show().spelling).toBeFalsy();
    await unknown.check.flags("n.notebook.md", "p1", [], "nl");
    expect(unknown.show().chips).toEqual(["bestrijdt"]);
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
