import { describe, expect, it } from "vitest";
import {
  MAX_HITS,
  MAX_PAGE_TEXT,
  SearchPostings,
  type StoredDocument,
  lowerBound,
  mergeOcrPages,
  parseOcrSidecar,
  snippetOf,
  tokenize,
} from "../../src/model/folder-search";
import {
  cacheFolder,
  cachePath,
  emptyCache,
  serializeCache,
  withPage,
} from "../../src/recognition/ocr/ocr-cache";

describe("tokenize", () => {
  it("lower-cases, folds accents, and splits on anything that is not a letter or digit", () => {
    expect(tokenize("Café Münster, Straße 12!")).toEqual(["cafe", "munster", "straße", "12"]);
  });

  it("keeps words of 2 to 32 characters", () => {
    expect(tokenize("a bb ccc")).toEqual(["bb", "ccc"]);
    expect(tokenize("x".repeat(33))).toEqual([]);
    expect(tokenize("x".repeat(32))).toEqual(["x".repeat(32)]);
  });

  it("reads other scripts", () => {
    expect(tokenize("日本語 テスト")).toEqual(["日本語", "テスト"]);
  });
});

describe("lowerBound", () => {
  it("finds where a prefix would start in a sorted list", () => {
    const list = ["apple", "apply", "banana", "cherry"];
    expect(lowerBound(list, "app")).toBe(0);
    expect(lowerBound(list, "b")).toBe(2);
    expect(lowerBound(list, "zzz")).toBe(4);
    expect(lowerBound([], "a")).toBe(0);
  });
});

describe("snippetOf", () => {
  const text = `${"lorem ipsum ".repeat(30)}needle in a haystack ${"dolor sit ".repeat(30)}`;

  it("shows the text around the first word found, cut with ellipses", () => {
    const snippet = snippetOf(text, ["needle"]);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("needle in a haystack");
    expect(snippet.length).toBeLessThanOrEqual(152);
  });

  it("takes the earliest of several words", () => {
    expect(snippetOf("alpha beta gamma", ["gamma", "beta"])).toBe("alpha beta gamma");
  });

  it("starts at the beginning, with no ellipsis, when the word is near it", () => {
    expect(snippetOf("needle first then more text", ["needle"])).toBe(
      "needle first then more text",
    );
  });

  it("gives the start of the page when no word is found", () => {
    expect(snippetOf("x".repeat(300), ["needle"])).toBe("x".repeat(140));
  });

  it("flattens white space", () => {
    expect(snippetOf("a\n\n  b\tc", ["b"])).toBe("a b c");
  });
});

describe("FineNotes' OCR cache", () => {
  const word = (text: string) => ({
    text,
    box: [0, 0, 10, 10] as [number, number, number, number],
    conf: 0.9,
    min: 0.8,
  });
  const page = (lines: string[][]) => ({
    imageWidth: 100,
    imageHeight: 100,
    pageWidth: 100,
    pageHeight: 100,
    lines: lines.map((words) => ({ conf: 0.9, words: words.map(word) })),
  });

  it("is where FineNotes writes it: <plugin folder>/ocr/<sha-256>.json", () => {
    const hash = "a".repeat(64);
    expect(cacheFolder("plugins/finenotes")).toBe("plugins/finenotes/ocr");
    expect(cachePath("plugins/finenotes", hash)).toBe(`plugins/finenotes/ocr/${hash}.json`);
  });

  it("is read as FineNotes writes it: pages by zero-based number, lines of words", () => {
    let file = emptyCache();
    file = withPage(
      file,
      0,
      page([
        ["Hello", "world"],
        ["second", "line"],
      ]),
    );
    file = withPage(file, 4, page([["Fifth", "page"]]));
    expect(parseOcrSidecar(serializeCache(file))).toEqual([
      { p: 0, t: "Hello world second line" },
      { p: 4, t: "Fifth page" },
    ]);
  });

  it("leaves out pages with no words and keys that are not page numbers", () => {
    const text = JSON.stringify({
      format: 2,
      pages: {
        "0": { lines: [] },
        "1": { lines: [{ words: [] }] },
        "-1": { lines: [{ words: ["x"] }] },
        two: { lines: [{ words: ["x"] }] },
        "2": { lines: [{ words: ["kept", { text: "also" }, { text: 5 }, 7] }] },
        "3": { notLines: true },
      },
    });
    expect(parseOcrSidecar(text)).toEqual([{ p: 2, t: "kept also" }]);
  });

  it("gives nothing for a file without pages, and throws for text that is not JSON", () => {
    expect(parseOcrSidecar("{}")).toEqual([]);
    expect(parseOcrSidecar("null")).toEqual([]);
    expect(parseOcrSidecar('{"pages": 3}')).toEqual([]);
    expect(() => parseOcrSidecar("not json")).toThrow();
  });

  it("keeps no more than a page's share of text", () => {
    const long = "word ".repeat(5000);
    const text = JSON.stringify({ pages: { "0": { lines: [{ words: [long] }] } } });
    expect(parseOcrSidecar(text)[0]?.t.length).toBe(MAX_PAGE_TEXT);
  });

  it("fills pages that have too little text of their own, and adds the pages a PDF lacks", () => {
    const own = [
      { p: 0, t: "tiny" },
      { p: 1, t: "this page has plenty of text of its own" },
    ];
    const merged = mergeOcrPages(own, [
      {
        p: 1,
        t: "ocr text that is even longer than the text this page has of its own, but ignored",
      },
      { p: 0, t: "a longer reading by the OCR" },
      { p: 3, t: "a page the PDF gave no text for" },
    ]);
    expect(merged).toEqual([
      { p: 0, t: "a longer reading by the OCR" },
      { p: 1, t: "this page has plenty of text of its own" },
      { p: 3, t: "a page the PDF gave no text for" },
    ]);
    expect(mergeOcrPages([{ p: 0, t: "x" }], [])).toEqual([{ p: 0, t: "x" }]);
  });
});

function doc(
  over: Partial<StoredDocument> & Pick<StoredDocument, "path" | "kind">,
): StoredDocument {
  return { sig: "1:1", title: over.path.replace(/\.[^.]+$/, ""), pages: [], ...over };
}

describe("SearchPostings", () => {
  function index(): SearchPostings {
    const postings = new SearchPostings();
    postings.addDoc(
      doc({
        path: "Notes/Cells.md",
        kind: "note",
        title: "Cells",
        pages: [{ p: 0, t: "Mitochondria are the powerhouse of the cell" }],
      }),
    );
    postings.addDoc(
      doc({
        path: "School/Biology.notebook.md",
        kind: "notebook",
        title: "Biology",
        pages: [
          { p: 0, t: "Cell membrane and mitochondria" },
          { p: 2, t: "Photosynthesis in chloroplasts" },
        ],
      }),
    );
    postings.addDoc(
      doc({
        path: "Books/Atlas.pdf",
        kind: "pdf",
        title: "Atlas",
        pages: [{ p: 0, t: "Mountains and rivers" }],
      }),
    );
    postings.rebuildRefs();
    return postings;
  }

  it("finds the notes that hold every word, best first", () => {
    const found = index().match("mitochondria");
    expect(found.tooShort).toBe(false);
    expect(found.groups.map((g) => g.group.path)).toEqual([
      "School/Biology.notebook.md",
      "Notes/Cells.md",
    ]);
    expect(
      index()
        .match("mitochondria cell")
        .groups.map((g) => g.group.path),
    ).toEqual(["School/Biology.notebook.md", "Notes/Cells.md"]);
    expect(index().match("mitochondria photosynthesis").groups).toEqual([]);
  });

  it("matches a word of three letters or more as a prefix, a shorter one only whole", () => {
    expect(index().match("mitoch").groups).toHaveLength(2);
    expect(
      index()
        .match("photo")
        .groups.map((g) => g.group.path),
    ).toEqual(["School/Biology.notebook.md"]);
    // "ce" alone is too short to search; with a long word it must be a whole word.
    expect(index().match("ce").tooShort).toBe(true);
    expect(
      index()
        .match("mitochondria of")
        .groups.map((g) => g.group.path),
    ).toEqual(["Notes/Cells.md"]);
  });

  it("says a query with no word of three letters is too short", () => {
    expect(index().match("").tooShort).toBe(true);
    expect(index().match("a b").tooShort).toBe(true);
    expect(index().match("of in").groups).toEqual([]);
  });

  it("numbers pages from one, and counts every page that matched", () => {
    const found = index().match("photosynthesis");
    expect([...(found.groups[0]?.group.pages ?? [])]).toEqual([3]);
    const both = index().match("cell");
    expect([
      ...(both.groups.find((g) => g.group.path.startsWith("School"))?.group.pages ?? []),
    ]).toEqual([1]);
  });

  it("ranks a title match above a body match", () => {
    const found = index().match("cells");
    expect(found.groups[0]?.group.path).toBe("Notes/Cells.md");
    expect(found.groups[0]?.group.titleMatch).toBe(true);
  });

  it("finds a note by its title even where no page holds the word", () => {
    const found = index().match("biology");
    expect(found.groups.map((g) => g.group.path)).toEqual(["School/Biology.notebook.md"]);
    expect(found.groups[0]?.group.sources).toEqual([]);
  });

  it("credits a PDF's text to the notebooks that show its page", () => {
    const postings = new SearchPostings();
    postings.addDoc(
      doc({
        path: "Book.pdf",
        kind: "pdf",
        pages: [
          { p: 0, t: "Chapter one on thermodynamics" },
          { p: 1, t: "Chapter two on optics" },
        ],
      }),
    );
    postings.addDoc(
      doc({
        path: "Physics.notebook.md",
        kind: "notebook",
        title: "Physics",
        pages: [],
        refs: [{ pdf: "Book.pdf", pdfPage: 0, nbPage: 4 }],
      }),
    );
    postings.rebuildRefs();
    const found = postings.match("thermodynamics");
    expect(found.groups.map((g) => [g.group.path, g.group.kind, [...g.group.pages]])).toEqual([
      ["Physics.notebook.md", "notebook", [5]],
    ]);
    // A page of the PDF no notebook shows is the PDF's own hit.
    expect(postings.match("optics").groups.map((g) => g.group.path)).toEqual(["Book.pdf"]);
  });

  it("forgets a removed document and keeps counting its dead pages", () => {
    const postings = index();
    postings.removeDoc("Notes/Cells.md");
    expect(postings.match("powerhouse").groups).toEqual([]);
    expect(postings.dead.size).toBe(1);
    expect(postings.docs.has("Notes/Cells.md")).toBe(false);
    postings.removeDoc("Notes/Cells.md");
    expect(postings.dead.size).toBe(1);
  });

  it("indexes a document again when it changes", () => {
    const postings = index();
    postings.addDoc(
      doc({
        path: "Notes/Cells.md",
        kind: "note",
        title: "Cells",
        pages: [{ p: 0, t: "Ribosomes only" }],
      }),
    );
    expect(postings.match("powerhouse").groups).toEqual([]);
    expect(postings.match("ribosomes").groups.map((g) => g.group.path)).toEqual(["Notes/Cells.md"]);
  });

  it("counts what it holds", () => {
    const postings = index();
    postings.addDoc(doc({ path: "Big.pdf", kind: "pdf", skipped: "too-large" }));
    postings.addDoc(doc({ path: "Scan.pdf", kind: "pdf", scanned: true }));
    postings.addDoc(doc({ path: "Scan2.pdf", kind: "pdf", scanned: true, ocrSig: "5" }));
    postings.addDoc(doc({ path: "Broken.pdf", kind: "pdf", skipped: "failed" }));
    expect(postings.counts()).toEqual({
      docs: 7,
      notebooks: 1,
      pdfs: 5,
      unsearchablePdfs: 2,
      tooLargePdfs: 1,
    });
  });

  it("lists no more than the best 40, and says there were more", () => {
    const postings = new SearchPostings();
    for (let i = 0; i < MAX_HITS + 5; i++) {
      postings.addDoc(
        doc({ path: `n${i}.md`, kind: "note", pages: [{ p: 0, t: "shared keyword" }] }),
      );
    }
    const found = postings.match("keyword");
    expect(found.groups).toHaveLength(MAX_HITS);
    expect(found.truncated).toBe(true);
  });

  it("asks for a fresh start only when many pages are dead", () => {
    const postings = new SearchPostings();
    expect(postings.needsCompaction()).toBe(false);
    for (let i = 0; i < 20000; i++) postings.dead.add(i);
    // 20000 dead of 100000 pages is a fifth: not yet.
    for (let i = 0; i < 100000; i++) postings.pageDoc.push("x");
    expect(postings.needsCompaction()).toBe(false);
    // 20000 of 80000 is a quarter: now.
    postings.pageDoc.length = 80000;
    expect(postings.needsCompaction()).toBe(true);
    // A quarter of a small index is too few to bother.
    postings.dead.clear();
    for (let i = 0; i < 5000; i++) postings.dead.add(i);
    postings.pageDoc.length = 10000;
    expect(postings.needsCompaction()).toBe(false);
    postings.clear();
    expect(postings.needsCompaction()).toBe(false);
    expect(postings.docs.size).toBe(0);
  });
});
