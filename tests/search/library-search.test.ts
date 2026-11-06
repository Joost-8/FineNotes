import { describe, expect, it } from "vitest";
import type { Page } from "../../src/model/document";
import { updatePageTranscripts } from "../../src/recognition/page-transcripts";
import { readTextSection, writeTextSection } from "../../src/recognition/text-layer";
import {
  type IndexedPage,
  type LibraryBook,
  MAX_NOTEBOOK_TEXT,
  assemblePages,
  nearAllowance,
  notebookText,
  plainTranscript,
  searchLibrary,
} from "../../src/search/library-search";
import type { PageText } from "../../src/search/notebook-search";

function page(id: string, boxes: string[] = [], pdf?: { path: string; page: number }): Page {
  return {
    id,
    kind: "page",
    geometry: { width: 1024, height: 1448 },
    backdrop: pdf ? { kind: "pdf", ...pdf } : { kind: "blank" },
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

function layerWith(transcripts: Record<string, string>): string | null {
  return readTextSection(noteWith(transcripts));
}

function noteWith(transcripts: Record<string, string>): string {
  const keys = Object.keys(transcripts);
  const section = updatePageTranscripts(
    null,
    keys,
    keys.map((key) => ({ key, hash: "h", text: transcripts[key] })),
  );
  return writeTextSection("Some prose of the user's own.\n", section);
}

function book(
  path: string,
  texts: string[][],
  guesses: Array<string | undefined> = [],
): LibraryBook {
  const pages: PageText[] = texts.map((sources, pageIndex) => ({
    pageIndex,
    sources: [
      ...sources.map((text) => ({ kind: "handwriting" as const, text })),
      ...(guesses[pageIndex]
        ? [{ kind: "handwriting" as const, text: guesses[pageIndex], guess: true as const }]
        : []),
    ],
  }));
  return { path, pages };
}

describe("notebookText", () => {
  it("keeps each page's transcription and text boxes, its key, hash and PDF page", () => {
    const pages = [page("a", ["Typed box"]), page("b", [], { path: "slides.pdf", page: 3 })];
    const text = notebookText(pages, readTextSection(noteWith({ a: "Eigenvalues of a matrix" })));
    expect(text.map((p) => p.key)).toEqual(["a", "b"]);
    expect(text[0].sources).toEqual([
      { kind: "handwriting", text: "Eigenvalues of a matrix" },
      { kind: "text", text: "Typed box" },
    ]);
    expect(text[1].pdf).toEqual({ path: "slides.pdf", page: 3 });
    expect(text[1].sources).toEqual([]);
    expect(typeof text[0].hash).toBe("string");
  });

  it("gives a repeated page id its own key, as transcriptions do", () => {
    const text = notebookText([page("a"), page("a")], null);
    expect(text.map((p) => p.key)).toEqual(["a", "a~2"]);
  });
});

describe("assemblePages", () => {
  const base: IndexedPage[] = [
    { id: "a", key: "a", hash: "1", sources: [{ kind: "text", text: "box" }] },
    {
      id: "b",
      key: "b",
      hash: "2",
      pdf: { path: "s.pdf", page: 1 },
      sources: [{ kind: "handwriting", text: "own" }],
    },
  ];

  it("adds the server's transcription, Grape's reading only where none exists, and PDF text", () => {
    const pages = assemblePages(base, {
      sidecar: new Map([
        ["a", "from server"],
        ["b", "own"],
      ]),
      reading: (p) => `grape ${p.id}`,
      printed: (pdf) => `printed ${pdf.path}`,
    });
    expect(pages[0].sources).toEqual([
      { kind: "handwriting", text: "from server" },
      { kind: "text", text: "box" },
    ]);
    expect(pages[1].sources).toEqual([
      { kind: "handwriting", text: "own" },
      { kind: "pdf", text: "printed s.pdf" },
    ]);
  });

  it("uses Grape's reading for a page nobody transcribed, marked as a guess", () => {
    const pages = assemblePages(base, { reading: () => "matnix" });
    expect(pages[0].sources).toContainEqual({ kind: "handwriting", text: "matnix", guess: true });
  });
});

describe("searchLibrary", () => {
  it("finds a word on any page of any notebook, phrases first", () => {
    const books = [
      book("A.notebook.md", [["nothing here"], ["defining a recipe for"]]),
      book("B.notebook.md", [["a recipe for defining things"]]),
    ];
    const hits = searchLibrary(books, "recipe for defining");
    expect(hits.map((h) => [h.path, h.pageIndex, h.phrase])).toEqual([
      ["B.notebook.md", 0, true],
      ["A.notebook.md", 1, false],
    ]);
    expect(hits[0].snippets[0].match).toBe("recipe for defining");
  });

  it("finds a word Grape read a letter off, after every exact hit", () => {
    const books = [
      book("A.notebook.md", [[]], ["the matnix inverse"]),
      book("B.notebook.md", [["matrix"]]),
    ];
    const hits = searchLibrary(books, "matrix");
    expect(hits.map((h) => [h.path, h.near])).toEqual([
      ["B.notebook.md", false],
      ["A.notebook.md", true],
    ]);
    expect(hits[1].snippets[0].match).toBe("matnix");
  });

  it("matches a word still being typed against the start of a misread one", () => {
    const hits = searchLibrary([book("A", [[]], ["eigenvalve"])], "eigenv");
    expect(hits).toHaveLength(1);
    const near = searchLibrary([book("A", [[]], ["eigcnvalue"])], "eigenv");
    expect(near).toHaveLength(1);
    expect(near[0].near).toBe(true);
  });

  it("never lets a short word be off, nor a transcription", () => {
    expect(searchLibrary([book("A", [[]], ["cat"])], "car")).toEqual([]);
    expect(searchLibrary([book("A", [["matnix"]])], "matrix")).toEqual([]);
  });

  it("needs every word, some exact and some near", () => {
    const books = [book("A", [[]], ["the matnix inverse"])];
    expect(searchLibrary(books, "inverse matrix")).toHaveLength(1);
    expect(searchLibrary(books, "inverse vector")).toEqual([]);
  });

  it("stops at max and finds nothing for an empty query", () => {
    const many = book(
      "A",
      Array.from({ length: 30 }, () => ["word"]),
    );
    expect(searchLibrary([many, many], "word", 40)).toHaveLength(40);
    expect(searchLibrary([many], "   ")).toEqual([]);
  });

  it("allows more letters off in a longer word", () => {
    expect([3, 4, 5, 8, 9, 14].map(nearAllowance)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe("plainTranscript", () => {
  it("drops Markdown and LaTeX marks and keeps every word", () => {
    expect(plainTranscript(String.raw`### Karatsuba $(x_1+x_0) \cdot y$`)).toBe(
      "Karatsuba (x_1+x_0) · y",
    );
    expect(plainTranscript("- [x] **check** the `ack`\n2. Binary and [[Hex|hexadecimal]]")).toBe(
      "check the ack\nBinary and hexadecimal",
    );
    expect(plainTranscript("> see [the slides](https://x.y) and [[Networks]]")).toBe(
      "see the slides and Networks",
    );
    expect(plainTranscript(String.raw`$$\frac{a}{b} \le \alpha$$`)).toBe("ab ≤ alpha");
  });

  it("is what Home searches and shows for a transcription", () => {
    const text = notebookText([page("a")], layerWith({ a: "## Heading **bold**" }));
    expect(text[0].sources[0].text).toBe("Heading bold");
  });
});

describe("the text budget", () => {
  it("keeps at most the budget for one notebook, then nothing more", () => {
    const pages = [page("a", ["x".repeat(30)]), page("b", ["y".repeat(30)]), page("c", ["z"])];
    const text = notebookText(pages, null, 40);
    expect(text.map((p) => p.sources.map((s) => s.text.length))).toEqual([[30], [10], []]);
    expect(MAX_NOTEBOOK_TEXT).toBeGreaterThan(100_000);
  });
});
