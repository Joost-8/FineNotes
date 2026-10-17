import { describe, expect, it } from "vitest";
import { pairFilesFolders } from "../../src/model/files-folder-order";

/** "name/" is a folder; anything else a file. */
const entry = (item: string) => ({ name: item.replace(/\/$/, ""), folder: item.endsWith("/") });
const order = (items: string[]) => pairFilesFolders(items, entry);

describe("pairFilesFolders", () => {
  it("moves a files folder from among the folders to just after its notebook", () => {
    expect(
      order([
        "Archive/",
        "Maths files/",
        "Physics files/",
        "Lecture.md",
        "Maths.notebook.md",
        "Physics.page.md",
        "Zoo.md",
      ]),
    ).toEqual([
      "Archive/",
      "Lecture.md",
      "Maths.notebook.md",
      "Maths files/",
      "Physics.page.md",
      "Physics files/",
      "Zoo.md",
    ]);
  });

  it("pairs the legacy .ink.md, and any case", () => {
    expect(order(["old FILES/", "Old.ink.md"])).toEqual(["Old.ink.md", "old FILES/"]);
  });

  it("leaves a files folder without its notebook, and every other item, where it was", () => {
    const items = ["Gone files/", "files/", "Notes/", "Physics files.md", "Physics.notebook.md"];
    expect(order(items)).toEqual(items);
  });

  it("gives a shared name's folder to the first notebook, and keeps every item once", () => {
    const out = order(["X files/", "X.notebook.md", "X.page.md"]);
    expect(out).toEqual(["X.notebook.md", "X files/", "X.page.md"]);
  });

  it("never mutates its input", () => {
    const items = ["A files/", "A.notebook.md"];
    order(items);
    expect(items).toEqual(["A files/", "A.notebook.md"]);
    expect(order([])).toEqual([]);
  });
});
