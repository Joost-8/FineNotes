import { describe, expect, it } from "vitest";
import type { Page } from "../../src/model/document";
import {
  collectPageText,
  fold,
  hasTranscripts,
  pageFromSubpath,
  queryTerms,
  searchPages,
  transcriptSidecarPath,
  transcriptsByKey,
} from "../../src/search/notebook-search";
import { updatePageTranscripts } from "../../src/recognition/page-transcripts";

function page(id: string, boxes: string[] = []): Page {
  return {
    id,
    kind: "page",
    geometry: { width: 1024, height: 1448 },
    backdrop: { kind: "blank" },
    strokes: [],
    images: [],
    textBoxes: boxes.map((text, i) => ({
      id: `${id}-t${i}`,
      x: 0,
      y: 0,
      w: 400,
      h: 40,
      text,
      fontSize: 20,
      color: "#000",
    })),
  } as unknown as Page;
}

/** The transcript server's file, as `buildTranscript` in GoodObsidian-transcripts writes it. */
const SIDECAR = [
  "---",
  "goodobsidian-transcript: true",
  'source: "[[Test.ink]]"',
  "---",
  "# Test — transcript",
  "",
  "_Written by the GoodObsidian transcript server from your handwriting. A page's entry is replaced when that page changes._",
  "",
  "## Page 1 · [[Test.ink|open]]",
  "<!--goodobsidian-page p1 abc-->",
  "Test",
  "",
  "## Page 2 · [[Test.ink|open]]",
  "<!--goodobsidian-page p2 def-->",
  "[sketch: a rectangle outline]",
  "",
  "What is the best way to transcribe my handwriting. It's pretty ugly, so I guess it can be hard to decypher.",
  "",
].join("\n");

describe("transcriptsByKey", () => {
  it("reads the sidecar without leaking the next page's heading into a page", () => {
    const map = transcriptsByKey(SIDECAR);
    expect(map.get("p1")).toBe("Test");
    expect(map.get("p2")).toMatch(/^\[sketch: a rectangle outline\]\n\nWhat is the best way/);
    expect(map.get("p2")).not.toContain("## Page");
  });

  it("reads the note's own text layer", () => {
    const section = updatePageTranscripts(
      null,
      ["a", "b"],
      [{ key: "b", text: "mitochondria is the powerhouse", hash: "h" }],
    );
    expect(transcriptsByKey(section).get("b")).toBe("mitochondria is the powerhouse");
  });

  it("is empty for nothing", () => {
    expect(transcriptsByKey(null).size).toBe(0);
    expect(transcriptsByKey("just prose, no markers").size).toBe(0);
  });
});

describe("searchPages", () => {
  const pages = [page("p1"), page("p2"), page("p3", ["Lab report: Éclair ﬁgures", "second box"])];
  const index = collectPageText(pages, null, SIDECAR);

  it("finds a word in the sidecar transcript and names its page", () => {
    const hits = searchPages(index, "decypher");
    expect(hits.map((h) => h.pageIndex)).toEqual([1]);
    expect(hits[0].snippets[0]).toMatchObject({ kind: "handwriting", match: "decypher" });
    expect(hits[0].snippets[0].before).toMatch(/hard to $/);
  });

  it("finds typed text boxes, ignoring case, accents and ligatures", () => {
    const hits = searchPages(index, "eclair FIGURES");
    expect(hits.map((h) => h.pageIndex)).toEqual([2]);
    // Snippets show the original spelling.
    expect(hits[0].snippets.map((s) => s.match)).toEqual(["Éclair", "ﬁgures"]);
    expect(hits[0].snippets[0].kind).toBe("text");
  });

  it("needs every word on the page, in any order", () => {
    expect(searchPages(index, "ugly handwriting").map((h) => h.pageIndex)).toEqual([1]);
    expect(searchPages(index, "ugly eclair")).toEqual([]);
  });

  it("lists pages in order and counts every occurrence", () => {
    const hits = searchPages(index, "test");
    expect(hits.map((h) => h.pageIndex)).toEqual([0]);
    expect(searchPages(index, "the")[0].count).toBeGreaterThanOrEqual(1);
  });

  it("caps snippets but not the count", () => {
    const busy = collectPageText([page("x", ["a a a a a"])], null, null);
    const [hit] = searchPages(busy, "a");
    expect(hit.count).toBe(5);
    expect(hit.snippets).toHaveLength(3);
  });

  it("returns nothing for a blank query", () => {
    expect(searchPages(index, "   ")).toEqual([]);
  });

  it("trims long context at word boundaries and marks the cut", () => {
    const long =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo";
    const [hit] = searchPages(collectPageText([page("x", [long])], null, null), "hotel");
    const s = hit.snippets[0];
    expect(s.before.startsWith("…")).toBe(true);
    expect(s.after.endsWith("…")).toBe(true);
    expect(s.before).not.toMatch(/…\S*[a-z]$/); // no half word at the cut
    expect(`${s.before}${s.match}${s.after}`).toContain("golf hotel india");
  });
});

describe("collectPageText", () => {
  it("takes the text layer and the sidecar, once each when they agree", () => {
    const layer = updatePageTranscripts(
      null,
      ["p1", "p2"],
      [
        { key: "p1", text: "Test", hash: "h" },
        { key: "p2", text: "only in the note", hash: "h" },
      ],
    );
    const index = collectPageText([page("p1"), page("p2")], layer, SIDECAR);
    expect(index[0].sources).toHaveLength(1);
    expect(index[1].sources.map((s) => s.text.slice(0, 10))).toEqual(["only in th", "[sketch: a"]);
    expect(hasTranscripts(index)).toBe(true);
    expect(hasTranscripts(collectPageText([page("p1", ["typed"])], null, null))).toBe(false);
  });
});

describe("transcriptSidecarPath", () => {
  it("sits beside the note, named after it", () => {
    expect(transcriptSidecarPath("Test.ink.md")).toBe("Test.transcript.md");
    expect(transcriptSidecarPath("School/Bio.notebook.md")).toBe("School/Bio.transcript.md");
    expect(transcriptSidecarPath("School/Q.page.md")).toBe("School/Q.transcript.md");
    expect(transcriptSidecarPath("Bio/_notebook.md")).toBe("Bio/_transcript.md");
  });

  it("is null for a file that is not a handwritten note", () => {
    expect(transcriptSidecarPath("notes/plain.md")).toBeNull();
  });
});

describe("pageFromSubpath", () => {
  it("reads the forms a link may use", () => {
    expect(pageFromSubpath("#Page 3", 5)).toBe(2);
    expect(pageFromSubpath("#page=3", 5)).toBe(2);
    expect(pageFromSubpath("#p3", 5)).toBe(2);
    expect(pageFromSubpath("Page 1", 5)).toBe(0);
  });

  it("refuses other headings and pages that do not exist", () => {
    expect(pageFromSubpath("#Introduction", 5)).toBeNull();
    expect(pageFromSubpath("#Page 6", 5)).toBeNull();
    expect(pageFromSubpath("#Page 0", 5)).toBeNull();
    expect(pageFromSubpath("", 5)).toBeNull();
  });
});

describe("fold", () => {
  it("maps every folded character back to the original", () => {
    const { text, map } = fold("Aﬁé");
    expect(text).toBe("afie");
    expect(map).toEqual([0, 1, 1, 2]);
    expect(queryTerms("  Café  cafe ")).toEqual(["cafe"]);
  });
});
