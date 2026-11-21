import { describe, expect, it } from "vitest";
import {
  ASK_TOOLS,
  parseToolCall,
  searchResultText,
  toolStatus,
  toolUsesOf,
} from "../../src/recognition/ask-tools";

describe("ask tools", () => {
  it("defines each tool once, with a closed input schema", () => {
    const names = ASK_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of ASK_TOOLS) {
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("reads the tool calls out of a reply, skipping everything else", () => {
    const reply = {
      content: [
        { type: "thinking", thinking: "", signature: "s" },
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "t1", name: "read_pages", input: { pages: [2] } },
        { type: "tool_use", id: 7, name: "bad" },
      ],
    };
    expect(toolUsesOf(reply)).toEqual([{ id: "t1", name: "read_pages", input: { pages: [2] } }]);
    expect(toolUsesOf(null)).toEqual([]);
  });

  it("checks pages against the notebook", () => {
    expect(parseToolCall("read_pages", { pages: [5, 2, 2, 99] }, 9)).toEqual({
      tool: "read_pages",
      pages: [2, 5],
    });
    expect(parseToolCall("read_pages", { pages: [] }, 9)).toMatchObject({
      error: expect.any(String),
    });
    expect(
      parseToolCall("read_pages", { pages: Array.from({ length: 11 }, (_, i) => i + 1) }, 20),
    ).toMatchObject({ error: expect.stringMatching(/At most 10/) });
    expect(parseToolCall("go_to_page", { page: 10 }, 9)).toEqual({
      error: "There is no page 10: the notebook has 9 pages.",
    });
    expect(parseToolCall("go_to_page", { page: "2" }, 9)).toMatchObject({
      error: expect.any(String),
    });
    expect(parseToolCall("add_page", { after: 3 }, 9)).toEqual({ tool: "add_page", after: 3 });
  });

  it("checks text boxes, searches and drawings", () => {
    expect(parseToolCall("add_text_box", { page: 1, text: "  Hello  " }, 1)).toEqual({
      tool: "add_text_box",
      page: 1,
      text: "Hello",
    });
    expect(parseToolCall("add_text_box", { page: 1, text: " " }, 1)).toMatchObject({
      error: expect.any(String),
    });
    expect(parseToolCall("add_text_box", { page: 1, text: "x".repeat(5000) }, 1)).toMatchObject({
      error: expect.stringMatching(/too long/),
    });
    expect(parseToolCall("search_notebook", { query: " ATP " }, 3)).toEqual({
      tool: "search_notebook",
      query: "ATP",
    });
    expect(
      parseToolCall("insert_drawing", { page: 2, svg: '<svg viewBox="0 0 10 10"></svg>' }, 3),
    ).toEqual({
      tool: "insert_drawing",
      page: 2,
      svg: '<svg viewBox="0 0 10 10"></svg>',
      title: "Drawing",
    });
    expect(parseToolCall("insert_drawing", { page: 2, svg: "<div/>" }, 3)).toMatchObject({
      error: expect.stringMatching(/SVG/),
    });
    expect(parseToolCall("delete_everything", {}, 3)).toEqual({
      error: "There is no tool called delete_everything.",
    });
  });

  it("checks the organising tools", () => {
    expect(parseToolCall("set_page_title", { page: 2, title: "  Groups " }, 3)).toEqual({
      tool: "set_page_title",
      page: 2,
      title: "Groups",
    });
    expect(parseToolCall("set_page_title", { page: 2, title: "" }, 3)).toMatchObject({ title: "" });
    expect(parseToolCall("add_section", { page: 1, title: "Rings", y: 0.5 }, 3)).toEqual({
      tool: "add_section",
      page: 1,
      title: "Rings",
      y: 0.5,
    });
    expect(parseToolCall("add_section", { page: 1, title: "Rings", y: 3 }, 3)).toMatchObject({
      error: expect.stringMatching(/0 to 1/),
    });
    expect(parseToolCall("bookmark_page", { page: 1, bookmarked: "yes" }, 3)).toMatchObject({
      error: expect.any(String),
    });
    expect(parseToolCall("move_page", { page: 2, to: 2 }, 3)).toMatchObject({
      error: "Page 2 is already there.",
    });
    expect(parseToolCall("move_page", { page: 3, to: 1 }, 3)).toEqual({
      tool: "move_page",
      page: 3,
      to: 1,
    });
  });

  it("checks tables, practice pages, marks and comments", () => {
    expect(
      parseToolCall("add_table", { page: 1, rows: [["a", "b"], ["c"]], header: true, x: 0.1 }, 1),
    ).toEqual({
      tool: "add_table",
      page: 1,
      cells: [
        ["a", "b"],
        ["c", ""],
      ],
      header: true,
      x: 0.1,
      y: undefined,
      width: undefined,
    });
    expect(parseToolCall("add_table", { page: 1, rows: [] }, 1)).toMatchObject({
      error: expect.any(String),
    });
    expect(
      parseToolCall("add_table", { page: 1, rows: [Array.from({ length: 9 }, () => "x")] }, 1),
    ).toMatchObject({ error: expect.stringMatching(/columns/) });
    expect(
      parseToolCall("add_practice_page", { after: 1, questions: [" Q1 ", "", 3, "Q2"] }, 1),
    ).toEqual({ tool: "add_practice_page", after: 1, title: "", questions: ["Q1", "Q2"] });
    // A little past the edge is let in, at the edge; the area is kept on the page.
    expect(
      parseToolCall(
        "mark_area",
        { page: 1, x: 0.9, y: -0.02, width: 0.5, height: 0.1, shape: "circle", comment: " Why? " },
        1,
      ),
    ).toEqual({
      tool: "mark_area",
      page: 1,
      x: 0.9,
      y: 0,
      width: expect.closeTo(0.1, 6),
      height: 0.1,
      shape: "circle",
      comment: "Why?",
    });
    expect(
      parseToolCall("mark_area", { page: 1, x: 0, y: 0, width: 0, height: 0.1, shape: "box" }, 1),
    ).toMatchObject({ error: expect.stringMatching(/empty/) });
    expect(
      parseToolCall("mark_area", { page: 1, x: 0, y: 0, width: 1, height: 1, shape: "star" }, 1),
    ).toMatchObject({ error: expect.stringMatching(/shape/) });
    expect(parseToolCall("add_comment", { page: 1, x: 0.5, y: 0.5, text: "Check" }, 1)).toEqual({
      tool: "add_comment",
      page: 1,
      x: 0.5,
      y: 0.5,
      text: "Check",
    });
    expect(parseToolCall("add_comment", { page: 1, x: 2, y: 0.5, text: "x" }, 1)).toMatchObject({
      error: expect.any(String),
    });
  });

  it("says what is happening, and how search results read", () => {
    expect(toolStatus({ tool: "read_pages", pages: [2, 3] })).toBe("Reading pages 2 and 3…");
    expect(toolStatus({ tool: "add_text_box", page: 4, text: "x" })).toBe("Writing on page 4…");
    expect(searchResultText("ATP", [])).toMatch(/Nothing/);
    expect(searchResultText("ATP", [{ page: 3, snippets: ["makes ATP here"] }])).toBe(
      "Page 3:\n- …makes ATP here…",
    );
  });
});

describe("outline and undo tools", () => {
  it("reads the outline with no input", () => {
    expect(parseToolCall("read_outline", {}, 3)).toEqual({ tool: "read_outline" });
    expect(toolStatus({ tool: "read_outline" })).toBe("Reading the outline…");
  });

  it("checks every outline entry, saying all that is wrong at once", () => {
    expect(
      parseToolCall(
        "set_outline",
        {
          entries: [
            { page: 1, title: " Lecture 1 " },
            { page: 12, title: "Lecture 4", level: 2, y: 0.3 },
          ],
          replace: true,
        },
        20,
      ),
    ).toEqual({
      tool: "set_outline",
      entries: [
        { page: 1, title: "Lecture 1", level: 1 },
        { page: 12, title: "Lecture 4", level: 2, y: 0.3 },
      ],
      replace: true,
    });
    const wrong = parseToolCall(
      "set_outline",
      {
        entries: [
          { page: 30, title: "x" },
          { page: 1, title: "" },
          { page: 1, title: "x", level: 4 },
          { page: 1, title: "x", y: 3 },
          "nonsense",
        ],
      },
      20,
    );
    expect("error" in wrong && wrong.error.split("\n")).toEqual([
      'Entry 1: "page" must be a page from 1 to 20.',
      'Entry 2: "title" is empty.',
      'Entry 3: "level" must be 1, 2 or 3.',
      'Entry 4: "y" must be a number from 0 to 1.',
      'Entry 5: "page" must be a page from 1 to 20.',
    ]);
    expect(parseToolCall("set_outline", { entries: "x" }, 2)).toHaveProperty("error");
    expect(parseToolCall("set_outline", { entries: [] }, 2)).toHaveProperty("error");
    expect(parseToolCall("set_outline", { entries: [], replace: true }, 2)).toEqual({
      tool: "set_outline",
      entries: [],
      replace: true,
    });
    const many = Array.from({ length: 201 }, () => ({ page: 1, title: "x" }));
    expect(parseToolCall("set_outline", { entries: many }, 2)).toHaveProperty("error");
    expect(toolStatus({ tool: "set_outline", entries: [], replace: false })).toBe(
      "Writing the outline…",
    );
  });

  it("takes back changes by number, or the latest answer's", () => {
    expect(parseToolCall("undo_changes", {}, 2)).toEqual({ tool: "undo_changes", changes: [] });
    expect(parseToolCall("undo_changes", { changes: [3, 1, 3] }, 2)).toEqual({
      tool: "undo_changes",
      changes: [1, 3],
    });
    expect(parseToolCall("undo_changes", { changes: [0] }, 2)).toHaveProperty("error");
    expect(parseToolCall("undo_changes", { changes: ["2"] }, 2)).toHaveProperty("error");
    expect(parseToolCall("undo_changes", { changes: "all" }, 2)).toHaveProperty("error");
    expect(toolStatus({ tool: "undo_changes", changes: [] })).toBe("Taking back changes…");
  });
});
