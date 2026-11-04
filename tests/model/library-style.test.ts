import { describe, expect, it } from "vitest";
import {
  FOLDER_COLORS,
  dropPaths,
  dropStyles,
  cleanName,
  folderStylesOf,
  freeName,
  moveStyles,
  movedPath,
  withFolderStyle,
} from "../../src/model/library-style";

describe("folderStylesOf", () => {
  it("keeps known colours and icons and drops the rest", () => {
    const sky = FOLDER_COLORS[0].color;
    expect(
      folderStylesOf({
        a: { color: sky, icon: "code" },
        b: { color: "#123456", icon: "nope" },
        c: 4,
        "": { icon: "code" },
      }),
    ).toEqual({ a: { color: sky, icon: "code" } });
  });

  it("reads anything else as no looks", () => {
    for (const raw of [undefined, null, [], "x", 3]) expect(folderStylesOf(raw)).toEqual({});
  });
});

describe("withFolderStyle", () => {
  it("changes one thing and keeps the other", () => {
    const first = withFolderStyle({}, "Maths", { icon: "calculator" });
    const both = withFolderStyle(first, "Maths", { color: FOLDER_COLORS[3].color });
    expect(both.Maths).toEqual({ icon: "calculator", color: FOLDER_COLORS[3].color });
  });
});

describe("movedPath and moveStyles", () => {
  it("follows a folder and what lies in it, and nothing like it", () => {
    expect(movedPath("Maths", "Maths", "Uni/Maths")).toBe("Uni/Maths");
    expect(movedPath("Maths/A.notebook.md", "Maths", "Uni/Maths")).toBe("Uni/Maths/A.notebook.md");
    expect(movedPath("Mathsy", "Maths", "X")).toBe("Mathsy");
    expect(moveStyles({ Maths: { icon: "code" } }, "Maths", "Algebra")).toEqual({
      Algebra: { icon: "code" },
    });
  });
});

describe("names", () => {
  it("cleanName drops slashes and edge blanks", () => {
    expect(cleanName("  a/b:  c ")).toBe("a b c");
    expect(cleanName(" / ")).toBe("");
  });

  it("freeName counts up past taken names", () => {
    const taken = new Set(["A.md", "A 2.md"]);
    expect(freeName("A", ".md", (p) => taken.has(p))).toBe("A 3.md");
    expect(freeName("B", ".md", (p) => taken.has(p))).toBe("B.md");
  });
});

describe("dropPaths and dropStyles", () => {
  it("forget a deleted path and everything below it, and nothing else", () => {
    expect(dropPaths(["Uni", "Uni/A.notebook.md", "University", "B.notebook.md"], "Uni")).toEqual([
      "University",
      "B.notebook.md",
    ]);
    expect(
      dropStyles({ Uni: { color: "#4a7df0" }, "Uni/Week": {}, Unit: { icon: "code" } }, "Uni"),
    ).toEqual({ Unit: { icon: "code" } });
  });
});
