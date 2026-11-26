import { describe, expect, it } from "vitest";
import type { TextBoxElement } from "../../src/model/document";
import { selectionText } from "../../src/model/selection-text";

const box: TextBoxElement = {
  id: "text",
  x: 0,
  y: 0,
  w: 160,
  text: "First",
  color: "#112233",
  fontSize: 18,
};
const elements = { strokes: [], images: [], textBoxes: [box] };

describe("lasso clipboard format", () => {
  it("copies only text boxes in reading order with a plain and a styled representation", () => {
    const result = selectionText({
      ...elements,
      textBoxes: [
        { ...box, y: 30, text: "Last <literal>" },
        { ...box, bold: true, italic: true, underline: true },
      ],
    });
    expect(result?.text).toBe("First\n\nLast <literal>");
    expect(result?.html).toContain("font-weight:bold;font-style:italic");
    expect(result?.html).toContain("text-decoration:underline;color:#112233");
    expect(result?.html).toContain("<u><em><strong>First</strong></em></u>");
    expect(result?.html).toContain("Last &lt;literal&gt;");
  });

  it("keeps rendered Markdown formatting, links, and readable list markers", () => {
    const result = selectionText({
      ...elements,
      textBoxes: [
        {
          ...box,
          markdown: true,
          text: "# Title\n- **bold** and [link](https://example.org)\n- [x] done",
        },
      ],
    });
    expect(result?.text).toBe("Title\n• bold and link\n☑ done");
    expect(result?.html).toContain("<h1>Title</h1>");
    expect(result?.html).toContain(
      '<strong>bold</strong> and <a href="https://example.org">link</a>',
    );
  });

  it("uses the image path as soon as a pen stroke or shape is present", () => {
    expect(
      selectionText({
        ...elements,
        strokes: [{ id: "s1", tool: "pen", color: "#000000", size: 2, pts: [0, 0, 0.5] }],
      }),
    ).toBeNull();
    expect(selectionText({ ...elements, textBoxes: [] })).toBeNull();
  });
});
