import { describe, expect, it } from "vitest";
import {
  GUIDE_SIZE,
  escapeHtml,
  pagesHtml,
  queryOf,
  resultsHtml,
} from "../../src/model/guide-site";
import { GUIDE } from "../../src/model/finenotes-guide";
import { GUIDE_PAGES } from "../../src/model/guide-markdown";

describe("the guide's search page", () => {
  it("answers #297's own title with the Simple look first", () => {
    const html = resultsHtml("Left Panel compeltely dissapers on latest release");
    const first = /<h2><a href="([^"]+)">([^<]+)<\/a><\/h2>/.exec(html);
    expect(first?.[2]).toMatch(/^Simple look/);
    expect(first?.[1]).toMatch(/guide\/0\d-[a-z-]+\.md#simple-look/);
  });

  it("ends every search in the way to report, with the words as its title", () => {
    const html = resultsHtml("flying unicorn mode");
    expect(html).toContain("The guide has nothing on that.");
    expect(html).toContain("issues/new?template=bug_report.yml&amp;title=flying%20unicorn%20mode");
  });

  it("shows the guide's pages when the box is empty", () => {
    expect(resultsHtml("  ")).toBe(pagesHtml());
    for (const page of GUIDE_PAGES) expect(pagesHtml()).toContain(page.file);
  });

  it("never lets typed text become markup", () => {
    const html = resultsHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("escapes what the guide itself says", () => {
    const entry = { ...GUIDE[0], title: "Zebra <b> & C", what: "x < y", where: "here" };
    const html = resultsHtml("zebra", [entry]);
    expect(html).toContain("Zebra &lt;b&gt; &amp; C");
    expect(html).toContain("x &lt; y");
  });

  it("reads a search from the link, and counts the guide", () => {
    expect(queryOf("?q=left+panel+gone")).toBe("left panel gone");
    expect(queryOf("")).toBe("");
    expect(GUIDE_SIZE).toBe(GUIDE.length);
  });
});
