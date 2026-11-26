import { describe, expect, it } from "vitest";
import {
  type AskPdfTab,
  PDF_TAB_MAX_CHARS,
  PDF_TAB_MAX_IMAGES,
  PDF_TAB_MAX_TEXT_PAGES,
  findPdfTab,
  pagesToPicture,
  parseReadPdfTab,
  pdfTabRange,
  pdfTabText,
  pdfTabsPrompt,
  READING_TEXT_CHARS,
  questionKey,
  readingNote,
  unknownTabText,
  withReadingNotes,
} from "../../src/recognition/ask-pdf-tabs";
import type { ChatTurn } from "../../src/recognition/ai-chat";
import { ASK_TOOLS, parseToolCall, readsOnly, toolStatus } from "../../src/recognition/ask-tools";

describe("readsOnly: what Ask may do while a PDF's tab is shown", () => {
  it("reads anything, the tabs included, without leaving the tab", () => {
    expect(readsOnly({ tool: "read_pdf_tab", tab: "x", from: 1 })).toBe(true);
    expect(readsOnly({ tool: "read_pages", pages: [1] })).toBe(true);
    expect(readsOnly({ tool: "read_outline" })).toBe(true);
  });

  it("goes to the notes for anything that changes them", () => {
    expect(readsOnly({ tool: "add_text_box", page: 1, text: "x" })).toBe(false);
    expect(readsOnly({ tool: "go_to_page", page: 2 })).toBe(false);
    expect(readsOnly({ tool: "set_outline", entries: [], replace: false })).toBe(false);
  });
});

const tabs: AskPdfTab[] = [
  { label: "Lecture 4", path: "Biology/Lecture 4 - Mitochondria.pdf", pages: 30 },
  { label: "Lecture 5", path: "Biology/Lecture 5 - Photosynthesis.pdf", pages: 12 },
  { label: "Textbook", path: "Books/Campbell.pdf", pages: 0 },
];

describe("read_pdf_tab: the call", () => {
  it("is one of Ask's tools, and parses through parseToolCall", () => {
    expect(ASK_TOOLS.some((tool) => tool.name === "read_pdf_tab")).toBe(true);
    expect(parseToolCall("read_pdf_tab", { tab: " Lecture 4 ", from: 3, to: 5 }, 10)).toEqual({
      tool: "read_pdf_tab",
      tab: "Lecture 4",
      from: 3,
      to: 5,
    });
  });

  it("starts at page 1 by default and has no end of its own", () => {
    expect(parseReadPdfTab({ tab: "Lecture 4" })).toEqual({
      tool: "read_pdf_tab",
      tab: "Lecture 4",
      from: 1,
    });
  });

  it("says what is wrong with a bad call", () => {
    expect(parseReadPdfTab({})).toEqual({ error: '"tab" is empty.' });
    expect(parseReadPdfTab({ tab: "x", from: 0 })).toHaveProperty("error");
    expect(parseReadPdfTab({ tab: "x", from: 1.5 })).toHaveProperty("error");
    expect(parseReadPdfTab({ tab: "x", from: 4, to: 2 })).toEqual({
      error: '"to" comes before "from".',
    });
  });

  it("shows the tab's name while it runs", () => {
    expect(toolStatus({ tool: "read_pdf_tab", tab: "Lecture 4", from: 1 })).toContain("Lecture 4");
  });
});

describe("findPdfTab", () => {
  it("finds a tab by its label, path or file name, ignoring case", () => {
    expect(findPdfTab(tabs, "lecture 5")?.path).toBe(tabs[1]?.path);
    expect(findPdfTab(tabs, "Books/Campbell.pdf")?.label).toBe("Textbook");
    expect(findPdfTab(tabs, "lecture 4 - mitochondria.pdf")?.label).toBe("Lecture 4");
  });

  it("takes the start of a label only when one tab fits", () => {
    expect(findPdfTab(tabs, "Text")?.label).toBe("Textbook");
    expect(findPdfTab(tabs, "Lecture")).toBeNull();
    expect(findPdfTab(tabs, "")).toBeNull();
  });

  it("names the tabs when none fits", () => {
    expect(unknownTabText(tabs, "Slides")).toContain("“Lecture 4”, “Lecture 5”, “Textbook”");
    expect(unknownTabText([], "Slides")).toBe("This notebook has no PDF tabs.");
  });
});

describe("pdfTabRange", () => {
  it("reads at most a dozen pages and never past the end", () => {
    expect(pdfTabRange({ tool: "read_pdf_tab", tab: "x", from: 1 }, 30)).toEqual({
      from: 1,
      to: PDF_TAB_MAX_TEXT_PAGES,
    });
    expect(pdfTabRange({ tool: "read_pdf_tab", tab: "x", from: 10, to: 40 }, 12)).toEqual({
      from: 10,
      to: 12,
    });
    expect(pdfTabRange({ tool: "read_pdf_tab", tab: "x", from: 2, to: 3 }, 30)).toEqual({
      from: 2,
      to: 3,
    });
  });

  it("refuses a start past the last page", () => {
    expect(pdfTabRange({ tool: "read_pdf_tab", tab: "x", from: 13 }, 12)).toBeNull();
    expect(pdfTabRange({ tool: "read_pdf_tab", tab: "x", from: 1 }, 0)).toBeNull();
  });
});

describe("pagesToPicture", () => {
  it("pictures the pages with little text, a few at most", () => {
    const texts = [
      { page: 1, text: "A".repeat(500) },
      { page: 2, text: "Figure 3" },
      { page: 3, text: "" },
      { page: 4, text: "x " },
      { page: 5, text: "y" },
    ];
    expect(pagesToPicture(texts)).toEqual([2, 3, 4].slice(0, PDF_TAB_MAX_IMAGES));
  });
});

describe("pdfTabText", () => {
  const tab = tabs[0] as AskPdfTab;

  it("gives each page under its number and says what is left", () => {
    const text = pdfTabText(
      tab,
      [
        { page: 1, text: "Mitochondria" },
        { page: 2, text: "" },
      ],
      [2],
    );
    expect(text).toContain("--- Page 1 ---\nMitochondria");
    expect(text).toContain("--- Page 2 ---\n(no printed text on this page)");
    expect(text).toContain("Pages 3 to 30 are not read yet.");
    expect(text).toContain("Pictures of page 2 follow");
  });

  it("cuts at the length limit and says where to read on", () => {
    const long = "word ".repeat(PDF_TAB_MAX_CHARS / 10);
    const text = pdfTabText(
      tab,
      [1, 2, 3].map((page) => ({ page, text: long })),
      [],
    );
    expect(text.length).toBeLessThanOrEqual(PDF_TAB_MAX_CHARS + 200);
    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("read on with from: 2");
  });

  it("cuts even a first page longer than the limit", () => {
    const text = pdfTabText(tab, [{ page: 1, text: "a".repeat(PDF_TAB_MAX_CHARS * 2) }], []);
    expect(text.length).toBeLessThanOrEqual(PDF_TAB_MAX_CHARS + 200);
  });
});

describe("pdfTabsPrompt", () => {
  it("is empty for a notebook without tabs, so its prompt is unchanged", () => {
    expect(pdfTabsPrompt([])).toBe("");
  });

  it("lists the tabs, a missing one as missing, and nothing that changes per question", () => {
    const prompt = pdfTabsPrompt(tabs);
    expect(prompt).toContain("read_pdf_tab");
    expect(prompt).toContain("“Lecture 4” (30 pages)");
    expect(prompt).toContain("“Textbook” (missing from the vault)");
    expect(prompt).not.toContain("this slide");
  });

  it("gives the paths of two tabs with the same name, and finds each by its path", () => {
    const twins: AskPdfTab[] = [
      { label: "slides", path: "CourseA/slides.pdf", pages: 10 },
      { label: "slides", path: "CourseB/slides.pdf", pages: 8 },
    ];
    expect(pdfTabsPrompt(twins)).toContain("“slides” (CourseB/slides.pdf) (8 pages)");
    expect(findPdfTab(twins, "slides")).toBeNull();
    expect(unknownTabText(twins, "slides")).toContain("CourseA/slides.pdf");
    expect(findPdfTab(twins, "CourseB/slides.pdf")?.pages).toBe(8);
  });
});

describe("reading notes", () => {
  const slide = { label: "Lecture 5", path: "Biology/Lecture 5.pdf", page: 7 };

  it("says which page the user is reading, or read last", () => {
    expect(readingNote(slide, true)).toContain("is reading page 7 of the PDF tab “Lecture 5”");
    expect(readingNote(slide, false)).toContain("last read page 7");
  });

  it("carries the slide's own text, cut to a few thousand characters", () => {
    expect(readingNote(slide, true, "Light reactions\nCalvin cycle")).toContain(
      '"""\nLight reactions\nCalvin cycle\n"""',
    );
    const long = readingNote(slide, true, "x".repeat(READING_TEXT_CHARS * 3));
    expect(long.length).toBeLessThan(READING_TEXT_CHARS + 400);
  });

  it("points at read_pdf_tab for a slide with no printed text", () => {
    expect(readingNote(slide, true, "  ")).toContain("look at it with read_pdf_tab");
  });

  it("goes before the question it was sent with, and leaves the turns as they are", () => {
    const turns: ChatTurn[] = [
      { role: "user", text: "explain this slide" },
      { role: "assistant", text: "It shows…" },
      { role: "user", text: "and the next?" },
    ];
    const sent = withReadingNotes(turns, (turn) => (turn === turns[0] ? "[note]" : undefined));
    expect(sent[0]?.text).toBe("[note]\nexplain this slide");
    expect(sent[2]).toBe(turns[2]);
    expect(turns[0]?.text).toBe("explain this slide");
  });

  it("keeps the same question of another chat apart (a new chat takes its own slide)", () => {
    expect(questionKey(1, 0, "explain this slide")).not.toBe(
      questionKey(2, 0, "explain this slide"),
    );
    expect(questionKey(1, 0, "why?")).not.toBe(questionKey(1, 1, "why?"));
    expect(questionKey(1, 0, "why?")).toBe(questionKey(1, 0, "why?"));
  });

  it("never goes on an answer", () => {
    const turns: ChatTurn[] = [{ role: "assistant", text: "Hi" }];
    expect(withReadingNotes(turns, () => "[note]")[0]?.text).toBe("Hi");
  });
});
