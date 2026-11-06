import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, isDoubleTap, railFolders } from "../../src/model/library-rail";
import { placeholderEntry } from "../../src/model/library";

const at = (path: string) => placeholderEntry(path, 0);
const vault = [
  at("Personal/Journal.notebook.md"),
  at("Personal/Recipes.notebook.md"),
  at("University/Calculus.notebook.md"),
  at("University/Algebra/Linear.notebook.md"),
  at("University/Networks/Nets.notebook.md"),
  at("University/Networks/Lectures/L1.notebook.md"),
  at("Loose.notebook.md"),
];

describe("railFolders", () => {
  it("lists only the root's folders when nothing is open, with recursive counts", () => {
    const rows = railFolders(vault, "");
    expect(rows.map((r) => [r.path, r.count, r.depth, r.hasChildren])).toEqual([
      ["Personal", 2, 0, false],
      ["University", 4, 0, true],
    ]);
    expect(rows.some((r) => r.current)).toBe(false);
  });

  it("unfolds the path to the open folder and its own subfolders", () => {
    const rows = railFolders(vault, "University/Networks");
    expect(rows.map((r) => r.path)).toEqual([
      "Personal",
      "University",
      "University/Algebra",
      "University/Networks",
      "University/Networks/Lectures",
    ]);
    const open = rows.find((r) => r.current);
    expect(open?.path).toBe("University/Networks");
    expect(open?.depth).toBe(1);
    expect(rows.find((r) => r.path === "University/Networks/Lectures")?.name).toBe("Lectures");
  });

  it("lists empty folders made in the library", () => {
    const rows = railFolders(vault, "", ["Projects", "University/Empty"]);
    expect(rows.map((r) => [r.path, r.count])).toEqual([
      ["Personal", 2],
      ["Projects", 0],
      ["University", 4],
    ]);
    expect(railFolders(vault, "University", ["University/Empty"]).map((r) => r.path)).toContain(
      "University/Empty",
    );
  });

  it("sorts names naturally", () => {
    const rows = railFolders([at("W10/a.notebook.md"), at("W2/a.notebook.md")], "");
    expect(rows.map((r) => r.name)).toEqual(["W2", "W10"]);
  });
});

describe("isDoubleTap", () => {
  it("needs the same item within the window", () => {
    const first = { key: "a", at: 1000 };
    expect(isDoubleTap(null, "a", 1100)).toBe(false);
    expect(isDoubleTap(first, "a", 1000 + DOUBLE_TAP_MS)).toBe(true);
    expect(isDoubleTap(first, "a", 1001 + DOUBLE_TAP_MS)).toBe(false);
    expect(isDoubleTap(first, "b", 1100)).toBe(false);
    expect(isDoubleTap(first, "a", 900)).toBe(false);
  });
});
