import { describe, expect, it } from "vitest";
import {
  type PreviewPage,
  previewCaption,
  previewPageIndexes,
} from "../../src/model/preview-pages";

const LIMIT = 9;
/** The pages a preview shows, 1-based as people count them. */
const shown = (pages: PreviewPage[], limit = LIMIT): number[] =>
  previewPageIndexes(pages, limit).map((i) => i + 1);
/** `n` pages with nothing in the contents. */
const blank = (n: number): PreviewPage[] => Array.from({ length: n }, () => ({}));
/** `n` pages with `marks` laid on (index: page fields). */
const book = (n: number, marks: Record<number, PreviewPage>): PreviewPage[] =>
  blank(n).map((page, i) => marks[i] ?? page);

describe("previewPageIndexes", () => {
  it("shows every page while there are at most the limit", () => {
    expect(shown(blank(3))).toEqual([1, 2, 3]);
    expect(shown(blank(1))).toEqual([1]);
    expect(shown(blank(LIMIT))).toHaveLength(LIMIT);
    expect(shown([])).toEqual([]);
  });

  it("shows the first pages of a long notebook with no contents or bookmarks", () => {
    expect(shown(blank(400))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("shows the first page, then the pages the contents and bookmarks point to", () => {
    const pages = book(400, {
      30: { title: "Waves" },
      120: { bookmarked: true },
      250: { sections: [{ title: "Optics" }] },
    });
    expect(shown(pages)).toEqual([1, 31, 121, 251]);
  });

  it("puts chapters before bookmarks, and bookmarks before deeper entries", () => {
    const marks: Record<number, PreviewPage> = {};
    // 6 chapters, 4 bookmarks, 5 sections: 8 places after the first page.
    for (const i of [10, 20, 30, 40, 50, 60]) marks[i] = { title: `Ch ${i}` };
    for (const i of [15, 25, 35, 45]) marks[i] = { bookmarked: true };
    for (const i of [12, 22, 32, 42, 52]) marks[i] = { title: `S ${i}`, titleLevel: 2 };
    const picked = shown(book(100, marks));
    expect(picked).toHaveLength(LIMIT);
    expect(picked[0]).toBe(1);
    for (const i of [10, 20, 30, 40, 50, 60]) expect(picked).toContain(i + 1);
    expect(picked.filter((n) => [16, 26, 36, 46].includes(n))).toHaveLength(2);
    expect(picked.filter((n) => [13, 23, 33, 43, 53].includes(n))).toHaveLength(0);
  });

  it("keeps two places for bookmarks however many chapters there are", () => {
    const chaptered = (bookmarks: number[]): number[] => {
      const marks: Record<number, PreviewPage> = {};
      for (let i = 10; i < 200; i += 10) marks[i] = { title: `Chapter ${i}` };
      for (const i of bookmarks) marks[i] = { bookmarked: true };
      return shown(book(200, marks));
    };
    const isChapter = (n: number): boolean => (n - 1) % 10 === 0 && n > 1;
    // 19 chapters and 3 bookmarks: 6 chapters, 2 bookmarks.
    const three = chaptered([55, 125, 185]);
    expect(three).toHaveLength(LIMIT);
    expect(three.filter(isChapter)).toHaveLength(6);
    expect(three.filter((n) => [56, 126, 186].includes(n))).toHaveLength(2);
    // One bookmark keeps one place; the other goes back to the chapters.
    const one = chaptered([55]);
    expect(one).toContain(56);
    expect(one.filter(isChapter)).toHaveLength(7);
    // None: every place is a chapter's.
    expect(chaptered([]).filter(isChapter)).toHaveLength(8);
  });

  it("spreads too many chapters evenly through the notebook, in page order", () => {
    const marks: Record<number, PreviewPage> = {};
    for (let i = 1; i < 400; i += 2) marks[i] = { title: `Chapter ${i}` };
    const picked = shown(book(400, marks));
    expect(picked).toHaveLength(LIMIT);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    // The first chapter is kept, and the picks reach the last quarter of the book.
    expect(picked[1]).toBe(2);
    expect(picked[picked.length - 1]).toBeGreaterThan(300);
  });

  it("reads a heading on an untitled page as a chapter, and one under a title as a section", () => {
    const heading = { title: "H" };
    const pages = book(50, {
      10: { sections: [heading] },
      20: { title: "Chapter", sections: [heading] },
      30: { title: "Part", titleLevel: 3 },
      40: { sections: [{ title: "H", level: 2 }] },
    });
    // Two chapters fit; with a limit of 3 the sections are left out.
    expect(shown(pages, 3)).toEqual([1, 11, 21]);
  });

  it("counts the page a name-only chapter stands before as a chapter's", () => {
    const pages = book(50, {
      12: { chapters: [{ title: "Part II" }] },
      30: { chapters: [{ title: "Appendix", after: true }] },
      40: { chapters: [{ title: "Aside", level: 2 }], bookmarked: true },
    });
    // A limit of 3: the chapter, then the bookmark; the `after` chapter starts nothing.
    expect(shown(pages, 3)).toEqual([1, 13, 41]);
    expect(previewCaption(pages[12])).toBe("Part II");
    expect(previewCaption(pages[30])).toBeUndefined();
  });

  it("never shows more than the limit, however many pages are marked", () => {
    const pages = book(1000, {});
    for (let i = 0; i < 1000; i++) pages[i] = { title: `T${i}`, bookmarked: true };
    expect(shown(pages)).toHaveLength(LIMIT);
    expect(shown(pages, 12)).toHaveLength(12);
  });
});

describe("previewCaption", () => {
  it("names a page by its highest entry in the contents", () => {
    expect(previewCaption({ title: "Waves" })).toBe("Waves");
    expect(
      previewCaption({
        title: "Part",
        titleLevel: 2,
        sections: [{ title: "Chapter 4", level: 1 }],
      }),
    ).toBe("Chapter 4");
    expect(previewCaption({ sections: [{ title: "A" }, { title: "B" }] })).toBe("A");
  });

  it("has nothing for a page the contents does not list", () => {
    expect(previewCaption({})).toBeUndefined();
    expect(previewCaption({ bookmarked: true })).toBeUndefined();
  });
});
