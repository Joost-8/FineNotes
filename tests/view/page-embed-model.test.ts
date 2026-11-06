import { describe, expect, it } from "vitest";
import {
  EMBED_CANVAS_BUDGET,
  EMBED_WIDTH_STEP,
  MAX_EMBED_DEVICE_WIDTH,
  PRINT_DPR,
  PRINT_FALLBACK_WIDTH,
  SharedNotebooks,
  embedInsertion,
  embedPageLabel,
  embedPageLink,
  embedPageNumbers,
  printPaintSize,
  embedPaintSize,
  embedLabel,
  embedTarget,
  embedWidth,
  embeddedPageNumber,
  embedsToRelease,
  pageLinkLabel,
} from "../../src/view/page-embed-model";

describe("embeddedPageNumber", () => {
  it.each([
    ["#page=3", 3],
    ["page=3", 3],
    ["#Page 3", 3],
    ["#p3", 3],
    ["#P12", 12],
    ["  #page = 7 ", 7],
    ["#page=1", 1],
  ])("reads %j as page %i", (subpath, page) => {
    expect(embeddedPageNumber(subpath)).toBe(page);
  });

  it("reads a page past any notebook's end, so the embed can say it is missing", () => {
    expect(embeddedPageNumber("#page=900")).toBe(900);
  });

  it.each([[""], ["#"], ["#Introduction"], ["#^block"], ["#page=0"], ["#page=-2"], ["#page3x"]])(
    "leaves %j to Obsidian",
    (subpath) => {
      expect(embeddedPageNumber(subpath)).toBeNull();
    },
  );
});

describe("embedTarget", () => {
  it("shows page 1 of a notebook embedded whole", () => {
    expect(embedTarget("")).toEqual({ page: 1, whole: true });
    expect(embedTarget("#")).toEqual({ page: 1, whole: true });
    expect(embedTarget("  ")).toEqual({ page: 1, whole: true });
  });

  it("shows the page a subpath names, past the end too", () => {
    expect(embedTarget("#page=1")).toEqual({ page: 1, whole: false });
    expect(embedTarget("#Page 3")).toEqual({ page: 3, whole: false });
    expect(embedTarget("#p40")).toEqual({ page: 40, whole: false });
  });

  it("leaves a heading or a block to Obsidian", () => {
    expect(embedTarget("#Introduction")).toBeNull();
    expect(embedTarget("#^block")).toBeNull();
    expect(embedTarget("#page=0")).toBeNull();
  });
});

describe("embedLabel", () => {
  it("names the whole notebook, or the page", () => {
    expect(embedLabel("Physics.notebook", { page: 1, whole: true })).toBe("Physics");
    expect(embedLabel("Physics.notebook", { page: 3, whole: false })).toBe("Physics, page 3");
  });
});

describe("pageLinkLabel", () => {
  it("names the notebook without its suffix", () => {
    expect(pageLinkLabel("Physics.notebook", 3)).toBe("Physics, page 3");
    expect(pageLinkLabel("Sketch.page", 1)).toBe("Sketch, page 1");
    expect(pageLinkLabel("Plain", 2)).toBe("Plain, page 2");
  });
});

describe("embedWidth", () => {
  it("takes live preview's width attribute first", () => {
    expect(embedWidth("320", "500")).toBe(320);
  });

  it("reads the size syntax from the alt text", () => {
    expect(embedWidth(null, "300")).toBe(300);
    expect(embedWidth(null, "300x200")).toBe(300);
    expect(embedWidth(null, " 250 X 100 ")).toBe(250);
    expect(embedWidth(null, "400x")).toBe(400);
  });

  it("ignores an alias, a zero and nothing", () => {
    expect(embedWidth(null, "Physics, page 3")).toBeNull();
    expect(embedWidth("0", "0")).toBeNull();
    expect(embedWidth(null, null)).toBeNull();
    expect(embedWidth("", "")).toBeNull();
    expect(embedWidth(null, "x200")).toBeNull();
  });
});

describe("embedPaintSize", () => {
  it("rounds the width up to the next step", () => {
    expect(embedPaintSize(700, 1)).toEqual({ cssWidth: 704, dpr: 1 });
    expect(embedPaintSize(EMBED_WIDTH_STEP, 2)).toEqual({ cssWidth: EMBED_WIDTH_STEP, dpr: 2 });
    expect(embedPaintSize(1, 2)).toEqual({ cssWidth: EMBED_WIDTH_STEP, dpr: 2 });
  });

  it("gives the same size for widths within one step, so a resize does not repaint", () => {
    expect(embedPaintSize(641, 2)).toEqual(embedPaintSize(700, 2));
  });

  it("caps the canvas width in device px", () => {
    const size = embedPaintSize(1600, 3);
    expect(size?.cssWidth).toBe(1600);
    expect((size?.cssWidth ?? 0) * (size?.dpr ?? 0)).toBeLessThanOrEqual(MAX_EMBED_DEVICE_WIDTH);
    expect(embedPaintSize(700, 2)).toEqual({ cssWidth: 704, dpr: 2 });
  });

  it("has no size for a box with no width, and a pixel ratio of 1 for a broken one", () => {
    expect(embedPaintSize(0, 2)).toBeNull();
    expect(embedPaintSize(Number.NaN, 2)).toBeNull();
    expect(embedPaintSize(100, 0)).toEqual({ cssWidth: 128, dpr: 1 });
    expect(embedPaintSize(100, Number.POSITIVE_INFINITY)).toEqual({ cssWidth: 128, dpr: 1 });
  });
});

describe("embedsToRelease", () => {
  const mb = 1024 * 1024;

  it("releases nothing under budget", () => {
    const painted = [
      { key: "a", bytes: 10 * mb, visible: false, lastSeen: 1 },
      { key: "b", bytes: 10 * mb, visible: true, lastSeen: 2 },
    ];
    expect(embedsToRelease(painted, EMBED_CANVAS_BUDGET)).toEqual([]);
  });

  it("releases the embeds off screen longest first until the rest fit", () => {
    const painted = [
      { key: "seen-late", bytes: 30 * mb, visible: false, lastSeen: 30 },
      { key: "on-screen", bytes: 30 * mb, visible: true, lastSeen: 40 },
      { key: "seen-early", bytes: 30 * mb, visible: false, lastSeen: 10 },
      { key: "seen-mid", bytes: 30 * mb, visible: false, lastSeen: 20 },
    ];
    expect(embedsToRelease(painted, 64 * mb)).toEqual(["seen-early", "seen-mid"]);
  });

  it("never releases one on screen, even over budget", () => {
    const painted = [
      { key: 1, bytes: 50 * mb, visible: true, lastSeen: 1 },
      { key: 2, bytes: 50 * mb, visible: true, lastSeen: 2 },
      { key: 3, bytes: 5 * mb, visible: false, lastSeen: 3 },
    ];
    expect(embedsToRelease(painted, 64 * mb)).toEqual([3]);
  });
});

describe("SharedNotebooks", () => {
  it("loads a notebook once for every embed of it", async () => {
    const shared = new SharedNotebooks<string>();
    let loads = 0;
    const load = (): Promise<string> => Promise.resolve(`doc${++loads}`);
    const [a, b] = await Promise.all([shared.get("P.md", 1, load), shared.get("P.md", 1, load)]);
    expect(a).toBe("doc1");
    expect(b).toBe("doc1");
    expect(loads).toBe(1);
  });

  it("loads again when the file's version moves, or it was forgotten", async () => {
    const shared = new SharedNotebooks<number>();
    let loads = 0;
    const load = (): Promise<number> => Promise.resolve(++loads);
    expect(await shared.get("P.md", 1, load)).toBe(1);
    expect(await shared.get("P.md", 2, load)).toBe(2);
    expect(await shared.get("P.md", 2, load)).toBe(2);
    expect(shared.forget("P.md")).toBe(true);
    expect(shared.forget("P.md")).toBe(false);
    expect(await shared.get("P.md", 2, load)).toBe(3);
  });

  it("keeps only the most recently asked for", async () => {
    const shared = new SharedNotebooks<string>(2);
    let loads = 0;
    const load = (name: string) => (): Promise<string> => {
      loads++;
      return Promise.resolve(name);
    };
    await shared.get("a", 1, load("a"));
    await shared.get("b", 1, load("b"));
    await shared.get("a", 1, load("a"));
    await shared.get("c", 1, load("c"));
    expect(shared.size).toBe(2);
    expect(loads).toBe(3);
    // "b" was the least recent, so it went; "a" is still held.
    await shared.get("a", 1, load("a"));
    expect(loads).toBe(3);
    await shared.get("b", 1, load("b"));
    expect(loads).toBe(4);
    shared.clear();
    expect(shared.size).toBe(0);
  });

  it("does not keep a load that failed", async () => {
    const shared = new SharedNotebooks<string>();
    await expect(shared.get("P.md", 1, () => Promise.reject(new Error("gone")))).rejects.toThrow(
      "gone",
    );
    // Let the cache's own rejection handler run.
    await Promise.resolve();
    expect(shared.size).toBe(0);
    expect(await shared.get("P.md", 1, () => Promise.resolve("back"))).toBe("back");
  });
});

describe("embedPageNumbers", () => {
  const whole = { page: 1, whole: true };

  it("shows every page of a notebook embedded whole, in order", () => {
    expect(embedPageNumbers(whole, 3)).toEqual([1, 2, 3]);
    expect(embedPageNumbers(whole, 1)).toEqual([1]);
  });

  it("shows nothing of a notebook with no pages, or a broken count", () => {
    expect(embedPageNumbers(whole, 0)).toEqual([]);
    expect(embedPageNumbers(whole, Number.NaN)).toEqual([]);
    expect(embedPageNumbers(whole, -2)).toEqual([]);
  });

  it("shows the one page a subpath names, whether or not the notebook has it", () => {
    expect(embedPageNumbers({ page: 4, whole: false }, 9)).toEqual([4]);
    expect(embedPageNumbers({ page: 40, whole: false }, 2)).toEqual([40]);
  });
});

describe("embedPageLink", () => {
  it("opens the page clicked in a notebook embedded whole", () => {
    const whole = { page: 1, whole: true };
    expect(embedPageLink("Physics.notebook", whole, 3)).toBe("Physics.notebook#page=3");
    expect(embedPageLink("Courses/Physics.notebook.md", whole, 1)).toBe(
      "Courses/Physics.notebook.md#page=1",
    );
    expect(embedPageLink("Physics.notebook#", whole, 2)).toBe("Physics.notebook#page=2");
  });

  it("keeps a page embed's own link", () => {
    expect(embedPageLink("Physics.notebook#p3", { page: 3, whole: false }, 3)).toBe(
      "Physics.notebook#p3",
    );
  });
});

describe("embedPageLabel", () => {
  it("names each page of a notebook embedded whole, and the notebook when it has one page", () => {
    const whole = { page: 1, whole: true };
    expect(embedPageLabel("Physics.notebook", whole, 2, 5)).toBe("Physics, page 2");
    expect(embedPageLabel("Physics.notebook", whole, 1, 1)).toBe("Physics");
    expect(embedPageLabel("Physics.notebook", { page: 3, whole: false }, 3, 1)).toBe(
      "Physics, page 3",
    );
  });
});

describe("printPaintSize", () => {
  it("paints at the box's width, sharp for paper", () => {
    expect(printPaintSize(640)).toEqual({ cssWidth: 640, dpr: PRINT_DPR });
  });

  it("falls back to a text column's width when the layout gives none", () => {
    expect(printPaintSize(0).cssWidth).toBeGreaterThanOrEqual(PRINT_FALLBACK_WIDTH);
    expect(printPaintSize(Number.NaN).cssWidth).toBeGreaterThanOrEqual(PRINT_FALLBACK_WIDTH);
  });

  it("stays within the device-px cap", () => {
    const size = printPaintSize(1800);
    expect(size.cssWidth * size.dpr).toBeLessThanOrEqual(MAX_EMBED_DEVICE_WIDTH);
  });
});

describe("embedInsertion", () => {
  it("makes the link an embed", () => {
    expect(embedInsertion("[[Physics.notebook]]", "", "")).toBe("![[Physics.notebook]]");
    expect(embedInsertion("[Physics](Physics.notebook.md)", "", "")).toBe(
      "![Physics](Physics.notebook.md)",
    );
    expect(embedInsertion("![[Physics.notebook]]", "", "")).toBe("![[Physics.notebook]]");
  });

  it("makes it a paragraph of its own when the cursor is inside text", () => {
    expect(embedInsertion("[[A.notebook]]", "Vectors:", "")).toBe("\n\n![[A.notebook]]");
    expect(embedInsertion("[[A.notebook]]", "", " more")).toBe("![[A.notebook]]\n\n");
    expect(embedInsertion("[[A.notebook]]", "a", "b")).toBe("\n\n![[A.notebook]]\n\n");
    expect(embedInsertion("[[A.notebook]]", "   ", "\t")).toBe("![[A.notebook]]");
  });

  it("keeps a blank line from text on the lines around an empty one", () => {
    // An empty line between "Some text" and "### Vectors".
    expect(embedInsertion("[[A.notebook]]", "", "", "Some text", "### Vectors")).toBe(
      "\n![[A.notebook]]\n",
    );
    expect(embedInsertion("[[A.notebook]]", "", "", "", "")).toBe("![[A.notebook]]");
    expect(embedInsertion("[[A.notebook]]", "", "", "Text", "  ")).toBe("\n![[A.notebook]]");
  });
});
