import { describe, expect, it } from "vitest";
import { hiddenBy, hide, isHidden, shownItems, unhide } from "../../src/model/library-hidden";

describe("hiddenBy / isHidden", () => {
  const hidden = ["Archive", "Maths/Old.notebook.md", "Archive/2024"];

  it("finds the item itself", () => {
    expect(hiddenBy(hidden, "Maths/Old.notebook.md")).toBe("Maths/Old.notebook.md");
  });

  it("hides what a hidden folder holds, by its nearest hidden folder", () => {
    expect(hiddenBy(hidden, "Archive/a.notebook.md")).toBe("Archive");
    expect(hiddenBy(hidden, "Archive/2024/b.notebook.md")).toBe("Archive/2024");
    expect(isHidden(hidden, "Archive")).toBe(true);
  });

  it("does not take a name that only starts the same", () => {
    expect(isHidden(hidden, "Archives/c.notebook.md")).toBe(false);
    expect(isHidden(hidden, "Maths/Old.notebook.md.bak")).toBe(false);
    expect(hiddenBy([], "Anything")).toBeNull();
  });
});

describe("hide / unhide", () => {
  it("hides once", () => {
    expect(hide(["a"], "a")).toEqual(["a"]);
    expect(hide(["a"], "b")).toEqual(["a", "b"]);
  });

  it("shows an item again", () => {
    expect(unhide(["a", "b"], "a")).toEqual(["b"]);
  });

  it("shows an item hidden by its folder by showing the folder, with all below it", () => {
    expect(unhide(["Archive", "Archive/2024", "Other"], "Archive/2024/x.notebook.md")).toEqual([
      "Archive",
      "Other",
    ]);
    expect(unhide(["Archive", "Archive/2024", "Other"], "Archive/x.notebook.md")).toEqual([
      "Other",
    ]);
  });

  it("leaves the list as it is for an item that was not hidden", () => {
    expect(unhide(["a"], "b")).toEqual(["a"]);
  });
});

describe("shownItems", () => {
  const items = [{ p: "a" }, { p: "Archive/b" }, { p: "c" }];
  const pathOf = (i: { p: string }): string => i.p;

  it("leaves hidden items out", () => {
    expect(shownItems(items, ["Archive"], pathOf, false).map(pathOf)).toEqual(["a", "c"]);
  });

  it("keeps them all while hidden items are shown", () => {
    expect(shownItems(items, ["Archive"], pathOf, true)).toHaveLength(3);
  });

  it("returns a copy when nothing is hidden", () => {
    const out = shownItems(items, [], pathOf, false);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });
});
