import { describe, expect, it } from "vitest";
import { droppedText, htmlToText, outsideDropEffect, takesDrag } from "../../src/view/drop-text";

const drop = (over: Partial<Parameters<typeof droppedText>[0]>) =>
  droppedText({ types: ["text/plain"], plain: "", html: "", vaultFile: false, ...over });

describe("text dropped on a page (discussion #288)", () => {
  it("takes the plain text, cleaned as a paste is", () => {
    expect(drop({ plain: "\r\n  First paragraph.\r\n\r\nSecond\tone.  \r\n" })).toBe(
      "  First paragraph.\n\nSecond    one.",
    );
  });

  it("prefers plain text over the HTML beside it", () => {
    expect(drop({ types: ["text/plain", "text/html"], plain: "plain", html: "<b>html</b>" })).toBe(
      "plain",
    );
  });

  it("reduces HTML to text when there is no plain text", () => {
    expect(drop({ types: ["text/html"], html: "<p>One &amp; <i>two</i></p><p>Three</p>" })).toBe(
      "One & two\n\nThree",
    );
  });

  it("falls back to the HTML when the plain text is blank", () => {
    expect(drop({ types: ["text/plain", "text/html"], plain: " \n ", html: "<p>x</p>" })).toBe("x");
  });

  it("leaves a file drop whose text is only its name or address", () => {
    expect(drop({ types: ["Files", "text/plain"], plain: "photo.png" })).toBe("");
    expect(drop({ types: ["Files", "text/plain"], plain: "My essay.docx" })).toBe("");
    expect(drop({ types: ["Files", "text/uri-list"], plain: "file:///var/a b.txt" })).toBe("");
    expect(drop({ types: ["Files"] })).toBe("");
  });

  it("takes prose a native app offers beside a file", () => {
    expect(drop({ types: ["Files", "text/plain"], plain: "Two words." })).toBe("Two words.");
    expect(drop({ types: ["Files", "text/plain"], plain: "line one\nnotes.md" })).toBe(
      "line one\nnotes.md",
    );
  });

  it("leaves a vault file's drag and link to the file handling", () => {
    expect(drop({ plain: "[[Lecture.pdf]]", vaultFile: true })).toBe("");
  });

  it("is empty when the drop carries no text", () => {
    expect(drop({ types: [] })).toBe("");
    expect(drop({ types: ["text/html"], html: "<img src=x><br>" })).toBe("");
  });

  it("keeps a web link as text", () => {
    expect(
      drop({ types: ["text/uri-list", "text/plain"], plain: "https://example.com/paper" }),
    ).toBe("https://example.com/paper");
  });
});

describe("drags over a page", () => {
  it("takes files, text and links, nothing else", () => {
    expect(takesDrag(["Files"])).toBe(true);
    expect(takesDrag(["text/plain"])).toBe(true);
    expect(takesDrag(["text/html"])).toBe(true);
    expect(takesDrag(["text/uri-list"])).toBe(true);
    expect(takesDrag(["application/x-moz-file"])).toBe(false);
    expect(takesDrag([])).toBe(false);
  });

  it.each([
    ["copy", "copy"],
    ["copyMove", "copy"],
    ["copyLink", "copy"],
    ["all", "copy"],
    ["uninitialized", "copy"],
    ["ALL", "copy"],
    ["move", null],
    ["link", null],
    ["linkMove", null],
    ["none", null],
  ])("a drag allowing %s drops as %s", (allowed, effect) =>
    expect(outsideDropEffect(allowed)).toBe(effect),
  );
});

describe("htmlToText", () => {
  it("is empty for no HTML", () => expect(htmlToText("")).toBe(""));

  it("collapses source whitespace as a browser does", () => {
    expect(htmlToText("<span>A   long\n   line</span>")).toBe("A long line");
  });

  it("breaks lines at <br> and blocks", () => {
    expect(htmlToText("a<br>b<br/>c<div>d</div><div>e</div>")).toBe("a\nb\ncd\ne");
  });

  it("separates paragraphs and headings by a blank line", () => {
    expect(htmlToText("<h2>Title</h2><p>Body</p>")).toBe("Title\n\nBody");
  });

  it("writes list items as dashes, one a line", () => {
    expect(htmlToText("<p>List:</p><ul><li>a</li><li>b</li></ul>")).toBe("List:\n\n- a\n- b");
  });

  it("keeps table cells apart and rows on lines", () => {
    expect(htmlToText("<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>")).toBe(
      "1\t2\n3",
    );
  });

  it("drops comments, scripts and styles", () => {
    expect(
      htmlToText(
        "<!-- StartFragment --><style>p{}</style><script>x()</script>Text<!--EndFragment-->",
      ),
    ).toBe("Text");
  });

  it("decodes named and numeric references", () => {
    expect(htmlToText("&lt;a&gt; &quot;q&quot; &#39;s&#39; &#x2014; &AMP; &nbsp;x&hellip;")).toBe(
      "<a> \"q\" 's' — &  x…",
    );
  });

  it("leaves unknown and impossible references as written", () => {
    expect(htmlToText("&bogus; &#0; &#xD800; &#x110000;")).toBe("&bogus; &#0; &#xD800; &#x110000;");
  });

  it("reads a non-breaking space by number as a space", () => {
    expect(htmlToText("a&#160;b&shy;c")).toBe("a bc");
  });
});
