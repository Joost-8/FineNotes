import { describe, expect, it } from "vitest";
import { type Page, blankPage } from "../../src/model/document";
import {
  hasAskableContent,
  hasTranscribableContent,
  pageContentHash,
  pageKeys,
  parsePageTranscripts,
  transcriptHashes,
  updatePageTranscripts,
} from "../../src/recognition/page-transcripts";
import { readTextSection, writeTextSection } from "../../src/recognition/text-layer";

function page(id: string, extra: Partial<Page> = {}): Page {
  return { ...blankPage(id), ...extra };
}

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
      "### Page 1\n<!--goodobsidian-page p1 a1-->\nfirst\n\n" +
        "### Page 3\n<!--goodobsidian-page p3 c3-->\nthird",
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
      { key: "p1", hash: "h1", text: "one" },
      { key: "p2", hash: "h9", text: "two, again" },
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
      "### Page 1\n<!--goodobsidian-page p3 h3-->\nthree\n\n" +
        "### Page 2\n<!--goodobsidian-page p2 h2-->\ntwo",
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
      { key: "p2", hash: "h2", text: "two" },
    ]);
    // …so page 1 counts as changed, and the next run replaces it.
    expect(transcriptHashes(out).get("p1")).toBe("");
  });

  it("keeps text written inside the section before the first page", () => {
    const section = "My own summary.\n\n### Page 1\n<!--goodobsidian-page p1 h1-->\none";
    const out = updatePageTranscripts(section, ["p1"], [{ key: "p1", text: "uno", hash: "h2" }]);
    expect(out).toBe("My own summary.\n\n### Page 1\n<!--goodobsidian-page p1 h2-->\nuno");
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
