import { describe, expect, it } from "vitest";
import { formatFileSize, notebookName, renamePlan } from "../../src/model/notebook-info";

describe("formatFileSize", () => {
  it("reads as people read sizes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(812)).toBe("812 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(14 * 1024 + 300)).toBe("14 KB");
    expect(formatFileSize(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatFileSize(5 * 1024 ** 4)).toBe("5120 GB");
    expect(formatFileSize(-1)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
  });
});

describe("notebookName", () => {
  it("names the notebook without its suffix", () => {
    expect(notebookName("School/Physics/Physics.notebook.md")).toBe("Physics");
    expect(notebookName("Q.page.md")).toBe("Q");
  });
});

describe("renamePlan", () => {
  it("renames a notebook with its own folder by its folder", () => {
    expect(renamePlan("School/Physics/Physics.notebook.md", "Mechanics")).toEqual({
      from: "School/Physics",
      to: "School/Mechanics",
    });
    expect(renamePlan("Physics/Physics.notebook.md", "Mechanics")).toEqual({
      from: "Physics",
      to: "Mechanics",
    });
  });

  it("renames any other notebook's file, keeping its suffix", () => {
    expect(renamePlan("School/Physics.notebook.md", "Mechanics")).toEqual({
      from: "School/Physics.notebook.md",
      to: "School/Mechanics.notebook.md",
    });
    expect(renamePlan("Q.page.md", "R")).toEqual({ from: "Q.page.md", to: "R.page.md" });
  });

  it("cleans the name, and does nothing for an empty or unchanged one", () => {
    expect(renamePlan("A.notebook.md", "Lab: week 1/2")?.to).toBe("Lab week 1 2.notebook.md");
    expect(renamePlan("A.notebook.md", "  ")).toBeUndefined();
    expect(renamePlan("A.notebook.md", "A")).toBeUndefined();
    expect(renamePlan("plain.md", "B")).toBeUndefined();
  });
});
