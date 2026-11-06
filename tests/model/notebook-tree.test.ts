import { describe, expect, it } from "vitest";
import { type TreeFolder, notebookTree } from "../../src/model/notebook-tree";

const outline = (folder: TreeFolder, depth = 0): string[] => [
  ...folder.notebooks.map((n) => `${"  ".repeat(depth)}- ${n.title}`),
  ...folder.folders.flatMap((f) => [
    `${"  ".repeat(depth)}${f.name}/ (${f.count})`,
    ...outline(f, depth + 1),
  ]),
];

describe("notebookTree", () => {
  it("files a notebook in its own folder as the notebook, in the folder above", () => {
    const tree = notebookTree([
      "Computer Science/Courses/Network/Network lecture notes/Network lecture notes.notebook.md",
      "Computer Science/Courses/Software/Software.notebook.md",
      "Miscellaneous/Test.notebook.md",
      "Miscellaneous/CopySheet.page.md",
      "Test 2.0/Test 2.0.notebook.md",
    ]);
    expect(outline(tree)).toEqual([
      "- Test 2.0",
      "Computer Science/ (2)",
      "  Courses/ (2)",
      "    - Software",
      "    Network/ (1)",
      "      - Network lecture notes",
      "Miscellaneous/ (2)",
      "  - CopySheet",
      "  - Test",
    ]);
    expect(tree.count).toBe(5);
  });

  it("keeps a folder named after a notebook when it holds others too", () => {
    const tree = notebookTree(["A/A.notebook.md", "A/B.notebook.md"]);
    expect(outline(tree)).toEqual(["A/ (2)", "  - A", "  - B"]);
  });

  it("sorts naturally and lists nothing for an empty vault", () => {
    expect(outline(notebookTree(["W10/x.notebook.md", "W2/x.notebook.md"]))).toEqual([
      "W2/ (1)",
      "  - x",
      "W10/ (1)",
      "  - x",
    ]);
    expect(notebookTree([]).folders).toEqual([]);
  });
});
