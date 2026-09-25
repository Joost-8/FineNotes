import { describe, expect, it } from "vitest";
import {
  type Notebook,
  buildNotebook,
  newNotebook,
  nextPageId,
  pageFileFromId,
  pageIdFromFile,
  parseNotebook,
  reorderPage,
} from "../../src/model/notebook";

const MANIFEST = `---
goodobsidian-notebook: true
title: Analysis
cover: p-001
pages:
  - p-001.ink.md
  - p-002.ink.md
  - p-003.ink.md
---

Free-text notes about this notebook.
`;

describe("parseNotebook", () => {
  it("reads title, cover and ordered pages", () => {
    const nb = parseNotebook(MANIFEST);
    expect(nb).not.toBeNull();
    expect(nb?.title).toBe("Analysis");
    expect(nb?.cover).toBe("p-001");
    expect(nb?.pages.map((p) => p.id)).toEqual(["p-001", "p-002", "p-003"]);
    expect(nb?.pages[0].file).toBe("p-001.ink.md");
  });

  it("returns null for a file that is not a notebook manifest", () => {
    expect(parseNotebook("# Just a note\n\nno frontmatter")).toBeNull();
    expect(parseNotebook("---\ntitle: Analysis\n---\n")).toBeNull();
    expect(parseNotebook("---\ngoodobsidian-notebook: false\ntitle: X\n---\n")).toBeNull();
  });

  it("survives a hand-edited manifest instead of throwing", () => {
    // Joost can open this file. A typo in it must never cost him a notebook.
    const messy = `---
goodobsidian-notebook: true
title:
unknown-key: whatever
pages:
  - p-001.ink.md
  -
  - "p-002.ink.md"
---
`;
    const nb = parseNotebook(messy);
    expect(nb?.title).toBe("");
    expect(nb?.pages.map((p) => p.id)).toEqual(["p-001", "p-002"]);
  });

  it("drops a cover that names a page the notebook does not contain", () => {
    const dangling = `---
goodobsidian-notebook: true
title: X
cover: p-099
pages:
  - p-001.ink.md
---
`;
    expect(parseNotebook(dangling)?.cover).toBeUndefined();
  });

  it("ignores a duplicated page id, which would make reorder ambiguous", () => {
    const dupes = `---
goodobsidian-notebook: true
title: X
pages:
  - p-001.ink.md
  - p-001.ink.md
  - p-002.ink.md
---
`;
    expect(parseNotebook(dupes)?.pages.map((p) => p.id)).toEqual(["p-001", "p-002"]);
  });

  it("accepts a page listed without its suffix and normalises the filename", () => {
    const bare = `---
goodobsidian-notebook: true
title: X
pages:
  - p-001
---
`;
    expect(parseNotebook(bare)?.pages[0]).toEqual({ id: "p-001", file: "p-001.ink.md" });
  });

  it("handles CRLF line endings", () => {
    const nb = parseNotebook(MANIFEST.replace(/\n/g, "\r\n"));
    expect(nb?.pages).toHaveLength(3);
    expect(nb?.title).toBe("Analysis");
  });
});

describe("buildNotebook", () => {
  it("round-trips through parseNotebook", () => {
    const nb = parseNotebook(MANIFEST) as Notebook;
    const again = parseNotebook(buildNotebook(nb));
    expect(again).toEqual(nb);
  });

  it("omits an absent cover", () => {
    const out = buildNotebook({ title: "X", pages: [] });
    expect(out).not.toContain("cover:");
    expect(parseNotebook(out)).toEqual({ title: "X", pages: [] });
  });
});

describe("page ids", () => {
  it("converts between id and filename, idempotently", () => {
    expect(pageIdFromFile("p-007.ink.md")).toBe("p-007");
    expect(pageFileFromId("p-007")).toBe("p-007.ink.md");
    expect(pageFileFromId(pageFileFromId("p-007"))).toBe("p-007.ink.md");
  });

  it("newNotebook starts with one page that is also the cover", () => {
    const nb = newNotebook("Linear Algebra");
    expect(nb.pages).toHaveLength(1);
    expect(nb.cover).toBe("p-001");
  });

  it("nextPageId is max+1, so a deleted page's id is never reused", () => {
    // Reusing an id would let a stale thumbnail or [[link]] silently resolve
    // to a different page.
    const nb: Notebook = {
      title: "X",
      pages: [
        { id: "p-001", file: "p-001.ink.md" },
        { id: "p-009", file: "p-009.ink.md" },
      ],
    };
    expect(nextPageId(nb)).toBe("p-010");
    expect(nextPageId({ title: "X", pages: [] })).toBe("p-001");
  });

  it("nextPageId ignores ids that are not p-NNN", () => {
    const nb: Notebook = {
      title: "X",
      pages: [{ id: "cover-sketch", file: "cover-sketch.ink.md" }],
    };
    expect(nextPageId(nb)).toBe("p-001");
  });
});

describe("reorderPage", () => {
  const nb = parseNotebook(MANIFEST) as Notebook;

  it("moves a page and leaves the input untouched", () => {
    const out = reorderPage(nb, 2, 0);
    expect(out.pages.map((p) => p.id)).toEqual(["p-003", "p-001", "p-002"]);
    expect(nb.pages.map((p) => p.id)).toEqual(["p-001", "p-002", "p-003"]);
  });

  it("clamps out-of-range indices instead of corrupting the order", () => {
    expect(reorderPage(nb, 0, 99).pages.map((p) => p.id)).toEqual(["p-002", "p-003", "p-001"]);
    expect(reorderPage(nb, -5, 1).pages.map((p) => p.id)).toEqual(["p-002", "p-001", "p-003"]);
  });

  it("is a no-op for an unchanged position or an empty notebook", () => {
    expect(reorderPage(nb, 1, 1)).toBe(nb);
    const empty: Notebook = { title: "X", pages: [] };
    expect(reorderPage(empty, 0, 1)).toBe(empty);
  });
});
