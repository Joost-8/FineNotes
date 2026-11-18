/**
 * Pasted text that is clearly Markdown switches a text box to Markdown
 * (discussion #107); prose, code and a stray `*` or `-` never do.
 */

import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "../../src/model/markdown-detect";

describe("looksLikeMarkdown", () => {
  it("takes a heading line", () => {
    expect(looksLikeMarkdown("# Shopping\nmilk and eggs")).toBe(true);
    expect(looksLikeMarkdown("Notes\n\n## Week 3\nRead chapter 4.")).toBe(true);
  });

  it("takes a list of two or more lines", () => {
    expect(looksLikeMarkdown("- milk\n- eggs")).toBe(true);
    expect(looksLikeMarkdown("* one\n* two\n* three")).toBe(true);
    expect(looksLikeMarkdown("1. Preheat\n2. Mix\n3. Bake")).toBe(true);
    expect(looksLikeMarkdown("To do:\n- [ ] call\n- [x] write")).toBe(true);
  });

  it("does not take one list-looking line", () => {
    expect(looksLikeMarkdown("- see above")).toBe(false);
    expect(looksLikeMarkdown("1. Introduction")).toBe(false);
  });

  it("takes two different constructs", () => {
    expect(looksLikeMarkdown("A **bold** claim, see [the source](https://example.com).")).toBe(
      true,
    );
    expect(looksLikeMarkdown("Run it:\n```\nnpm test\n```\nIt is **fast**.")).toBe(true);
    expect(looksLikeMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\nSee [docs](x.md).")).toBe(true);
  });

  it("does not take one construct alone", () => {
    expect(looksLikeMarkdown("This is **really** important.")).toBe(false);
    expect(looksLikeMarkdown("See [the docs](https://example.com) for more.")).toBe(false);
    expect(looksLikeMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(false);
    expect(looksLikeMarkdown("```\ncode\n```")).toBe(false);
  });

  it("never takes prose with a lone * or -", () => {
    expect(looksLikeMarkdown("Apples - and pears - are fruit.")).toBe(false);
    expect(looksLikeMarkdown("2 * 3 = 6, and 4 * 5 = 20")).toBe(false);
    expect(looksLikeMarkdown("I *think* so.\nMaybe -- maybe not.")).toBe(false);
    expect(looksLikeMarkdown("Plain text over\ntwo lines.")).toBe(false);
    expect(looksLikeMarkdown("")).toBe(false);
  });

  it("does not take a hashtag or a number sign", () => {
    expect(looksLikeMarkdown("#todo #school")).toBe(false);
    expect(looksLikeMarkdown("#1 priority")).toBe(false);
  });

  it("reads `# ` in code as a comment, not a heading", () => {
    const python = "# add two numbers\ndef add(a, b):\n    return a + b\nx = add(1, 2)";
    expect(looksLikeMarkdown(python)).toBe(false);
    const shell = "# install\nexport PATH=$PATH:/opt/bin\nnpm install;";
    expect(looksLikeMarkdown(shell)).toBe(false);
  });

  it("ignores what is inside a code fence", () => {
    // The `#` and `-` lines are code; the fence is one construct, alone.
    expect(looksLikeMarkdown("```\n# comment\n- a\n- b\n```")).toBe(false);
  });

  it("takes Windows line breaks", () => {
    expect(looksLikeMarkdown("- milk\r\n- eggs\r\n")).toBe(true);
  });
});
