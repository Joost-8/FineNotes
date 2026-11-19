import { describe, expect, it } from "vitest";
import { type Page, blankPage } from "../../src/model/document";
import {
  AI_CROP_MARGIN,
  AUTO_TRANSCRIBE_MAX_PAGES,
  autoTranscriptionBatch,
  hasAskableContent,
  hasTranscribableContent,
  pageContentHash,
  pageKeys,
  pageTranscriptViews,
  choosePageTranscript,
  isPersonsTranscript,
  transcriptTextHash,
  parsePageTranscripts,
  transcriptionCropHeight,
  transcriptHashes,
  updatePageTranscripts,
} from "../../src/recognition/page-transcripts";
import { readTextSection, writeTextSection } from "../../src/recognition/text-layer";

function page(id: string, extra: Partial<Page> = {}): Page {
  return { ...blankPage(id), ...extra };
}

/** The line a machine-written entry carries under its marker: its text's hash. */
const meta = (text: string) => `<!--goodobsidian-meta t=${transcriptTextHash(text)}-->\n`;

const stroke = (id: string, pts = [10, 20, 0.5, 30, 40, 0.5]) => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen" as const,
  pts,
});

describe("pageKeys", () => {
  it("is the page id, with repeats told apart", () => {
    expect(pageKeys([page("p1"), page("p2"), page("p1"), page("p1")])).toEqual([
      "p1",
      "p2",
      "p1~2",
      "p1~3",
    ]);
  });
});

describe("updatePageTranscripts", () => {
  it("writes one headed entry per page, in page order", () => {
    const out = updatePageTranscripts(
      null,
      ["p1", "p2", "p3"],
      [
        { key: "p3", text: "third", hash: "c3" },
        { key: "p1", text: " first ", hash: "a1" },
      ],
    );
    expect(out).toBe(
      `### Page 1\n<!--goodobsidian-page p1 a1-->\n${meta("first")}first\n\n` +
        `### Page 3\n<!--goodobsidian-page p3 c3-->\n${meta("third")}third`,
    );
  });

  it("replaces one page and leaves the others alone", () => {
    const first = updatePageTranscripts(
      null,
      ["p1", "p2"],
      [
        { key: "p1", text: "one", hash: "h1" },
        { key: "p2", text: "two", hash: "h2" },
      ],
    );
    const next = updatePageTranscripts(
      first,
      ["p1", "p2"],
      [{ key: "p2", text: "two, again", hash: "h9" }],
    );
    expect(parsePageTranscripts(next).entries).toEqual([
      { key: "p1", hash: "h1", text: "one", textHash: transcriptTextHash("one") },
      { key: "p2", hash: "h9", text: "two, again", textHash: transcriptTextHash("two, again") },
    ]);
  });

  it("renumbers headings when pages move, and drops pages that are gone", () => {
    const section = updatePageTranscripts(
      null,
      ["p1", "p2", "p3"],
      [
        { key: "p1", text: "one", hash: "h1" },
        { key: "p2", text: "two", hash: "h2" },
        { key: "p3", text: "three", hash: "h3" },
      ],
    );
    // p1 deleted, p3 moved to the front.
    const out = updatePageTranscripts(section, ["p3", "p2"], []);
    expect(out).toBe(
      `### Page 1\n<!--goodobsidian-page p3 h3-->\n${meta("three")}three\n\n` +
        `### Page 2\n<!--goodobsidian-page p2 h2-->\n${meta("two")}two`,
    );
  });

  it("removes an entry on blank text, and returns '' when nothing is left", () => {
    const section = updatePageTranscripts(null, ["p1"], [{ key: "p1", text: "one", hash: "h" }]);
    expect(updatePageTranscripts(section, ["p1"], [{ key: "p1", text: "  ", hash: "" }])).toBe("");
  });

  it("adopts a pre-0.5 section as page 1's transcription, with no hash", () => {
    const legacy = "# Notes\nWritten on page one.";
    const parsed = parsePageTranscripts(legacy);
    expect(parsed.legacy).toBe(true);
    expect(parsed.entries).toEqual([]);
    const out = updatePageTranscripts(
      legacy,
      ["p1", "p2"],
      [{ key: "p2", text: "two", hash: "h2" }],
    );
    expect(parsePageTranscripts(out).entries).toEqual([
      { key: "p1", hash: "", text: "# Notes\nWritten on page one." },
      { key: "p2", hash: "h2", text: "two", textHash: transcriptTextHash("two") },
    ]);
    // …so page 1 counts as changed, and the next run replaces it.
    expect(transcriptHashes(out).get("p1")).toBe("");
  });

  it("keeps text written inside the section before the first page", () => {
    const section = "My own summary.\n\n### Page 1\n<!--goodobsidian-page p1 h1-->\none";
    const out = updatePageTranscripts(section, ["p1"], [{ key: "p1", text: "uno", hash: "h2" }]);
    expect(out).toBe(
      `My own summary.\n\n### Page 1\n<!--goodobsidian-page p1 h2-->\n${meta("uno")}uno`,
    );
  });

  it("merges an entry a hand edit duplicated instead of losing one copy", () => {
    const section =
      "<!--goodobsidian-page p1 h1-->\nalpha\n\n### Page 1\n<!--goodobsidian-page p1 h1-->\nbeta";
    const out = updatePageTranscripts(section, ["p1"], []);
    expect(parsePageTranscripts(out).entries[0].text).toBe("alpha\n\nbeta");
  });

  it("round-trips keys that need escaping", () => {
    const out = updatePageTranscripts(
      null,
      ["page one", "p1~2"],
      [
        { key: "page one", text: "x", hash: "h" },
        { key: "p1~2", text: "y", hash: "k" },
      ],
    );
    expect(out).toContain("<!--goodobsidian-page page%20one h-->");
    expect(out).toContain("<!--goodobsidian-page p1~2 k-->");
    expect(transcriptHashes(out)).toEqual(
      new Map([
        ["page one", "h"],
        ["p1~2", "k"],
      ]),
    );
  });

  it("survives the text layer's own markers and CRLF line endings", () => {
    const inner = updatePageTranscripts(
      null,
      ["p1", "p2"],
      [
        { key: "p1", text: "one", hash: "h1" },
        { key: "p2", text: "two", hash: "h2" },
      ],
    );
    const body = writeTextSection("# Title\n\nMy prose.", inner);
    expect(body.startsWith("# Title\n\nMy prose.")).toBe(true);
    const read = readTextSection(body);
    expect(read).toBe(inner);
    const crlf = (read ?? "").replace(/\n/g, "\r\n");
    expect(parsePageTranscripts(crlf).entries.map((e) => e.text)).toEqual(["one", "two"]);
  });
});

describe("a person's transcription (FineNotes#265)", () => {
  const keys = ["p1", "p2"];
  const machine = () =>
    updatePageTranscripts(null, keys, [
      { key: "p1", text: "machine one", hash: "h1" },
      { key: "p2", text: "machine two", hash: "h2" },
    ]);
  const entry = (section: string, key: string) =>
    parsePageTranscripts(section).entries.find((e) => e.key === key);

  it("is the machine's until a person edits it", () => {
    const section = machine();
    expect(isPersonsTranscript(entry(section, "p1")!)).toBe(false);
    const edited = section.replace("machine one", "machine one, corrected");
    expect(isPersonsTranscript(entry(edited, "p1")!)).toBe(true);
    // Text from before 2.11 has no hash: the machine's, as it always was.
    expect(isPersonsTranscript({ key: "p1", hash: "h", text: "old" })).toBe(false);
  });

  it("is replaced by a new transcription while it is the machine's", () => {
    const next = updatePageTranscripts(machine(), keys, [{ key: "p1", text: "newer", hash: "h9" }]);
    expect(entry(next, "p1")).toMatchObject({ text: "newer", hash: "h9" });
    expect(entry(next, "p1")?.pending).toBeUndefined();
  });

  it("keeps an edited page's text, and puts the new transcription beside it", () => {
    const edited = machine().replace("machine one", "my fixed text");
    const next = updatePageTranscripts(edited, keys, [{ key: "p1", text: "newer", hash: "h9" }]);
    expect(entry(next, "p1")).toMatchObject({
      text: "my fixed text",
      hash: "h9",
      pending: { hash: "h9", text: "newer" },
    });
    // The hash moved on: the page is not sent again.
    expect(transcriptHashes(next).get("p1")).toBe("h9");
    // A new transcription that says the same leaves nothing to compare.
    const same = updatePageTranscripts(edited, keys, [
      { key: "p1", text: "my fixed text", hash: "h9" },
    ]);
    expect(entry(same, "p1")?.pending).toBeUndefined();
  });

  it("never lets a reading on the device touch a person's text", () => {
    const typed = updatePageTranscripts(null, keys, [
      { key: "p1", text: "typed by me", hash: "h1", typed: true },
    ]);
    const next = updatePageTranscripts(typed, keys, [
      { key: "p1", text: "grape read", hash: "h2", device: true },
    ]);
    expect(entry(next, "p1")).toMatchObject({ text: "typed by me", typed: true, hash: "h1" });
    expect(entry(next, "p1")?.pending).toBeUndefined();
  });

  it("is replaced by what a person types, whatever was there", () => {
    const edited = machine().replace("machine one", "my fixed text");
    const waiting = updatePageTranscripts(edited, keys, [{ key: "p1", text: "newer", hash: "h9" }]);
    const typed = updatePageTranscripts(waiting, keys, [
      { key: "p1", text: "typed now", hash: "h9", typed: true },
    ]);
    expect(entry(typed, "p1")).toMatchObject({ text: "typed now", typed: true });
    expect(entry(typed, "p1")?.pending).toBeUndefined();
  });

  it("survives a write, a reread and the other pages' updates, waiting version and all", () => {
    const edited = machine().replace("machine one", "mine");
    const waiting = updatePageTranscripts(edited, keys, [
      { key: "p1", text: "new: with --> and\nlines", hash: "h9" },
    ]);
    const again = updatePageTranscripts(waiting, keys, [{ key: "p2", text: "two b", hash: "h3" }]);
    expect(entry(again, "p1")).toMatchObject({
      text: "mine",
      pending: { text: "new: with --> and\nlines" },
    });
    // The waiting text never shows as the page's own.
    expect(again).not.toContain("new: with -->");
  });

  it("is settled by choosing: mine drops the new one, new replaces mine", () => {
    const edited = machine().replace("machine one", "mine");
    const waiting = updatePageTranscripts(edited, keys, [{ key: "p1", text: "newer", hash: "h9" }]);
    const kept = choosePageTranscript(waiting, keys, "p1", "mine");
    expect(entry(kept, "p1")).toMatchObject({ text: "mine", hash: "h9" });
    expect(entry(kept, "p1")?.pending).toBeUndefined();
    const taken = choosePageTranscript(waiting, keys, "p1", "new");
    expect(entry(taken, "p1")).toMatchObject({ text: "newer", hash: "h9" });
    expect(isPersonsTranscript(entry(taken, "p1")!)).toBe(false);
    // The other page is untouched either way.
    expect(entry(taken, "p2")?.text).toBe("machine two");
    // Nothing waiting: nothing changes.
    expect(choosePageTranscript(machine(), keys, "p1", "new")).toBe(machine());
  });

  it("lists every page's transcription for the Files tab, saying where it came from", () => {
    const section = updatePageTranscripts(
      null,
      ["p1", "p2", "p3", "p4"],
      [
        { key: "p1", text: "ai", hash: "a" },
        { key: "p2", text: "grape", hash: "b", device: true },
        { key: "p3", text: "typed", hash: "c", typed: true },
        { key: "p4", text: "ai four", hash: "d" },
      ],
    );
    const edited = section.replace("ai four", "fixed four");
    const waiting = updatePageTranscripts(
      edited,
      ["p1", "p2", "p3", "p4"],
      [{ key: "p4", text: "ai four again", hash: "e" }],
    );
    expect(pageTranscriptViews(waiting, ["p1", "p2", "p3", "p4"])).toEqual([
      { key: "p1", page: 0, text: "ai", source: "ai" },
      { key: "p2", page: 1, text: "grape", source: "device" },
      { key: "p3", page: 2, text: "typed", source: "typed" },
      { key: "p4", page: 3, text: "fixed four", source: "edited", pending: "ai four again" },
    ]);
  });

  it("reads an entry an older FineNotes left without the meta line", () => {
    const old = "### Page 1\n<!--goodobsidian-page p1 h1-->\nold text";
    expect(pageTranscriptViews(old, ["p1"])).toEqual([
      { key: "p1", page: 0, text: "old text", source: "ai" },
    ]);
  });
});

describe("parsePageTranscripts", () => {
  it("is empty for no section", () => {
    expect(parsePageTranscripts(null)).toEqual({ preamble: "", entries: [], legacy: false });
    expect(parsePageTranscripts("  \n ")).toEqual({ preamble: "", entries: [], legacy: false });
  });

  it("tolerates a missing heading and a decode failure", () => {
    const parsed = parsePageTranscripts("<!--goodobsidian-page %E0%A4%A p1-->\ntext");
    expect(parsed.entries).toEqual([{ key: "%E0%A4%A", hash: "p1", text: "text" }]);
  });
});

describe("pageContentHash", () => {
  it("is stable, base 36, and moves with ink, typed text and paper", () => {
    const a = page("p1", { strokes: [stroke("s1")] });
    const h = pageContentHash(a);
    expect(h).toMatch(/^[0-9a-z]+$/);
    expect(pageContentHash(page("p1", { strokes: [stroke("s1")] }))).toBe(h);

    expect(
      pageContentHash(page("p1", { strokes: [stroke("s1", [10, 21, 0.5, 30, 40, 0.5])] })),
    ).not.toBe(h);
    expect(pageContentHash(page("p1", { strokes: [stroke("s2")] }))).not.toBe(h);
    const withText = page("p1", {
      strokes: [stroke("s1")],
      textBoxes: [{ id: "t1", x: 0, y: 0, w: 100, text: "hi", color: "#000", fontSize: 22 }],
    });
    expect(pageContentHash(withText)).not.toBe(h);
    const ruled = page("p1", { strokes: [stroke("s1")], backdrop: { kind: "ruled-wide" } });
    expect(pageContentHash(ruled)).not.toBe(h);
  });
});

describe("pageContentHash and what else a page shows (FineNotes#265 review)", () => {
  const inked = () =>
    page("p1", {
      strokes: [stroke("s1")],
      textBoxes: [{ id: "t1", x: 0, y: 0, w: 100, text: "hi", color: "#000", fontSize: 22 }],
    });

  it("keeps the hash a page was recorded with before tables and pictures counted", () => {
    // Computed with the hash as it was in 2.10.0: such a page is not sent again.
    expect(pageContentHash(inked())).toBe("12qs1ou");
    expect(pageContentHash({ ...inked(), tables: [], graphs: [], equations: [] })).toBe("12qs1ou");
  });

  it("moves when a table's text, an equation, a graph or a picture changes", () => {
    const table = {
      id: "g1",
      x: 0,
      y: 0,
      cols: [80, 80],
      rows: [30],
      cells: [["a", "b"]],
      color: "#000",
      size: 1,
      textColor: "#000",
      fontSize: 16,
    };
    const withTable = { ...inked(), tables: [table] } as unknown as Page;
    const edited = { ...inked(), tables: [{ ...table, cells: [["a", "c"]] }] } as unknown as Page;
    const h = pageContentHash(withTable);
    expect(h).not.toBe(pageContentHash(inked()));
    expect(pageContentHash(edited)).not.toBe(h);
    const equation = { id: "e1", x: 0, y: 0, latex: "x^2" };
    const withEquation = { ...inked(), equations: [equation] } as unknown as Page;
    const otherEquation = {
      ...inked(),
      equations: [{ ...equation, latex: "x^3" }],
    } as unknown as Page;
    expect(pageContentHash(withEquation)).not.toBe(pageContentHash(otherEquation));
    const picture = { id: "i1", path: "a.png", x: 0, y: 0, w: 10, h: 10 };
    const withPicture = { ...inked(), images: [picture] } as unknown as Page;
    expect(pageContentHash(withPicture)).not.toBe(pageContentHash(inked()));
    const graph = { id: "q1", x: 0, y: 0, expr: "sin(x)" };
    const withGraph = { ...inked(), graphs: [graph] } as unknown as Page;
    expect(pageContentHash(withGraph)).not.toBe(pageContentHash(inked()));
  });
});

describe("transcriptionCropHeight", () => {
  const at = (y: number) => stroke("s1", [100, y - 10, 0.5, 300, y, 0.5]);

  it("cuts a page below its lowest writing, with a margin", () => {
    const top = page("p1", { strokes: [at(400)] });
    const { height } = top.geometry;
    const keep = transcriptionCropHeight(top);
    expect(keep).toBe(Math.ceil(400 + 1 + AI_CROP_MARGIN));
    expect(keep).toBeLessThan(height / 2);
  });

  it("counts text boxes, and leaves a full page whole", () => {
    const withText = page("p1", {
      strokes: [at(100)],
      textBoxes: [
        { id: "t1", x: 0, y: 600, w: 100, h: 40, text: "hi", color: "#000", fontSize: 22 },
      ],
    });
    expect(transcriptionCropHeight(withText)).toBe(600 + 40 + AI_CROP_MARGIN);
    const full = page("p1");
    full.strokes.push(at(full.geometry.height - 100));
    expect(transcriptionCropHeight(full)).toBeNull();
  });

  it("never cuts a PDF page or an empty one", () => {
    const pdf = page("p1", {
      strokes: [at(100)],
      backdrop: { kind: "pdf", path: "a.pdf", page: 1 } as unknown as Page["backdrop"],
    });
    expect(transcriptionCropHeight(pdf)).toBeNull();
    expect(transcriptionCropHeight(page("p1"))).toBeNull();
  });
});

describe("autoTranscriptionBatch", () => {
  it("reads the pages written on, in page order, not the page in view", () => {
    const batch = autoTranscriptionBatch(new Set(["p3", "p1"]), ["p1", "p2", "p3", "p4"]);
    expect(batch).toEqual({ now: ["p1", "p3"], later: [] });
  });

  it("drops a page deleted meanwhile", () => {
    expect(autoTranscriptionBatch(new Set(["gone", "p2"]), ["p1", "p2"])).toEqual({
      now: ["p2"],
      later: [],
    });
    expect(autoTranscriptionBatch(new Set(), ["p1"])).toEqual({ now: [], later: [] });
  });

  it("sends at most a few at once; the rest wait for the next quiet moment", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const batch = autoTranscriptionBatch(new Set(ids), ids);
    expect(batch.now).toHaveLength(AUTO_TRANSCRIBE_MAX_PAGES);
    expect(batch).toEqual({ now: ["p1", "p2", "p3"], later: ["p4", "p5"] });
    expect(autoTranscriptionBatch(new Set(ids), ids, 1)).toEqual({
      now: ["p1"],
      later: ["p2", "p3", "p4", "p5"],
    });
  });
});

describe("content predicates", () => {
  it("counts ink and typed text as transcribable; a PDF slide or picture as askable", () => {
    expect(hasTranscribableContent(page("p1"))).toBe(false);
    expect(hasTranscribableContent(page("p1", { strokes: [stroke("s1")] }))).toBe(true);
    const blankBox = { id: "t1", x: 0, y: 0, w: 1, text: "  ", color: "#000", fontSize: 22 };
    expect(hasTranscribableContent(page("p1", { textBoxes: [blankBox] }))).toBe(false);
    expect(hasTranscribableContent(page("p1", { textBoxes: [{ ...blankBox, text: "x" }] }))).toBe(
      true,
    );

    expect(hasAskableContent(page("p1"))).toBe(false);
    expect(
      hasAskableContent(page("p1", { backdrop: { kind: "pdf", path: "a.pdf", page: 0 } })),
    ).toBe(true);
    expect(
      hasAskableContent(
        page("p1", { images: [{ id: "i1", path: "a.png", x: 0, y: 0, w: 1, h: 1 }] }),
      ),
    ).toBe(true);
  });
});
