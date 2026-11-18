/**
 * `src/model/markdown-text.ts`: reading a Markdown box's text (discussion #107).
 */

import { describe, expect, it } from "vitest";
import {
  continueMarkdownList,
  markdownPlainText,
  parseInline,
  parseMarkdown,
  setMarkdownTaskDone,
} from "../../src/model/markdown-text";
import { linkAt } from "../../src/model/text-links";

describe("parseInline", () => {
  it("leaves plain text as one span", () => {
    expect(parseInline("Plain words, 3 * 4 = 12")).toEqual([{ text: "Plain words, 3 * 4 = 12" }]);
  });

  it("reads bold, italic, strike, highlight and code", () => {
    expect(parseInline("a **b** *c* ~~d~~ ==e== `f`")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", strike: true },
      { text: " " },
      { text: "e", mark: true },
      { text: " " },
      { text: "f", code: true },
    ]);
  });

  it("nests emphasis, and takes the last of an odd run", () => {
    expect(parseInline("***both***")).toEqual([{ text: "both", bold: true, italic: true }]);
    expect(parseInline("*a **b** c*")).toEqual([
      { text: "a ", italic: true },
      { text: "b", italic: true, bold: true },
      { text: " c", italic: true },
    ]);
    expect(parseInline("__strong__ and _soft_")).toEqual([
      { text: "strong", bold: true },
      { text: " and " },
      { text: "soft", italic: true },
    ]);
  });

  it("keeps markers that open nothing, and underscores inside words", () => {
    expect(parseInline("snake_case_name")).toEqual([{ text: "snake_case_name" }]);
    expect(parseInline("2 * 3 and 4 * 5")).toEqual([{ text: "2 * 3 and 4 * 5" }]);
    expect(parseInline("**open")).toEqual([{ text: "**open" }]);
    expect(parseInline("a ** b **")).toEqual([{ text: "a ** b **" }]);
  });

  it("reads escapes as the character", () => {
    expect(parseInline("\\*not\\* \\# \\\\")).toEqual([{ text: "*not* # \\" }]);
  });

  it("formats nothing inside code, and trims its padding", () => {
    expect(parseInline("`**x**` and `` a`b ``")).toEqual([
      { text: "**x**", code: true },
      { text: " and " },
      { text: "a`b", code: true },
    ]);
    expect(parseInline("`open")).toEqual([{ text: "`open" }]);
  });

  it("reads links, with a markdown link's label formatted", () => {
    expect(parseInline("See [[Note|the note]], [**bold** site](https://a.b) or www.c.d.")).toEqual([
      { text: "See " },
      { text: "the note", target: "Note" },
      { text: ", " },
      { text: "bold", bold: true, target: "https://a.b" },
      { text: " site", target: "https://a.b" },
      { text: " or " },
      { text: "www.c.d", target: "www.c.d" },
      { text: "." },
    ]);
  });

  it("does not read an address inside a word", () => {
    expect(parseInline("xhttps://a.b")).toEqual([{ text: "xhttps://a.b" }]);
  });

  it("formats inside a link-free emphasis, and keeps emphasis across a code span", () => {
    expect(parseInline("*a `*` b*")).toEqual([
      { text: "a ", italic: true },
      { text: "*", italic: true, code: true },
      { text: " b", italic: true },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings by level, and a hash without a space as text", () => {
    const blocks = parseMarkdown("# One\n### Three ##\n#tag\n####### seven");
    expect(blocks.map((b) => [b.kind, b.level, b.spans.map((s) => s.text).join("")])).toEqual([
      ["heading", 1, "One"],
      ["heading", 3, "Three"],
      ["paragraph", 0, "#tag"],
      ["paragraph", 0, "####### seven"],
    ]);
  });

  it("reads lists with their depth, number and tick", () => {
    const blocks = parseMarkdown(
      "- a\n  * b\n\t\t+ c\n3. d\n10) e\n- [ ] f\n- [x] g\n• h\n☑ i\n☐ j\n-not a list",
    );
    expect(blocks.map((b) => [b.kind, b.depth, b.marker, b.done])).toEqual([
      ["bullet", 0, "", false],
      ["bullet", 1, "", false],
      ["bullet", 2, "", false],
      ["number", 0, "3.", false],
      ["number", 0, "10)", false],
      ["task", 0, "", false],
      ["task", 0, "", true],
      ["bullet", 0, "", false],
      ["task", 0, "", true],
      ["task", 0, "", false],
      ["paragraph", 0, "", false],
    ]);
    expect(blocks[5].spans).toEqual([{ text: "f" }]);
  });

  it("reads quotes, nested, with what is inside them", () => {
    const blocks = parseMarkdown("> said\n> > - item\n>");
    expect(blocks.map((b) => [b.kind, b.quote])).toEqual([
      ["paragraph", 1],
      ["bullet", 2],
      ["paragraph", 1],
    ]);
  });

  it("reads rules, and fenced code without its fences", () => {
    const blocks = parseMarkdown("---\n* * *\n```js\nlet **a** = 1;\n\n```\nafter");
    expect(blocks.map((b) => [b.kind, b.line, b.spans])).toEqual([
      ["rule", 0, []],
      ["rule", 1, []],
      ["code", 3, [{ text: "let **a** = 1;", code: true }]],
      ["code", 4, []],
      ["paragraph", 6, [{ text: "after" }]],
    ]);
  });

  it("reads an unclosed fence as code to the end", () => {
    expect(parseMarkdown("~~~\n# not a heading").map((b) => b.kind)).toEqual(["code"]);
  });

  it("keeps one block per line, empty lines too", () => {
    expect(parseMarkdown("a\n\nb").map((b) => [b.line, b.kind])).toEqual([
      [0, "paragraph"],
      [1, "paragraph"],
      [2, "paragraph"],
    ]);
  });
});

describe("markdownPlainText", () => {
  it("drops the marks and keeps the words", () => {
    expect(markdownPlainText("# Title\n- **a** [[b|c]]\n---")).toBe("Title\na c\n");
  });
});

describe("setMarkdownTaskDone", () => {
  it("ticks and unticks a markdown task, in a quote too", () => {
    expect(setMarkdownTaskDone("x\n- [ ] milk", 1, true)).toBe("x\n- [x] milk");
    expect(setMarkdownTaskDone("> * [X] eggs", 0, false)).toBe("> * [ ] eggs");
  });

  it("leaves a task that already says so, or a line that is none", () => {
    expect(setMarkdownTaskDone("- [x] a", 0, true)).toBe("- [x] a");
    expect(setMarkdownTaskDone("plain", 0, true)).toBe("plain");
    expect(setMarkdownTaskDone("plain", 4, true)).toBe("plain");
  });

  it("ticks the text pill's checklist glyphs", () => {
    expect(setMarkdownTaskDone("☐ a", 0, true)).toBe("☑ a");
  });
});

describe("continueMarkdownList", () => {
  const at = (text: string) => continueMarkdownList(text, text.length);

  it("continues bullets, tasks, numbers and quotes", () => {
    expect(at("- a")?.text).toBe("- a\n- ");
    expect(at("  * [x] a")?.text).toBe("  * [x] a\n  * [ ] ");
    expect(at("9) a")?.text).toBe("9) a\n10) ");
    expect(at("> said")?.text).toBe("> said\n> ");
    expect(at("> - a")?.text).toBe("> - a\n> - ");
  });

  it("ends a list on an empty item, keeping its indent", () => {
    const edit = at("- a\n  - ");
    expect(edit).toEqual({ text: "- a\n  ", selectionStart: 6, selectionEnd: 6 });
    expect(at("> ")?.text).toBe("");
  });

  it("does nothing inside the marker, or on a plain line", () => {
    expect(continueMarkdownList("- a", 1)).toBeNull();
    expect(at("plain")).toBeNull();
  });

  it("continues the text pill's lists as they do", () => {
    expect(at("• a")?.text).toBe("• a\n• ");
  });
});

describe("linkAt", () => {
  it("reads a link only where it starts", () => {
    expect(linkAt("x [[A]]", 2)).toEqual({ length: 5, link: { text: "A", target: "A" } });
    expect(linkAt("x [[A]]", 0)).toBeNull();
    expect(linkAt("go https://a.b).", 3)).toEqual({
      length: 11,
      link: { text: "https://a.b", target: "https://a.b" },
    });
  });
});
