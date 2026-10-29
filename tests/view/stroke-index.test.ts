/** `src/view/stroke-index.ts` — strokes by page position and by id. */

import { describe, expect, it } from "vitest";
import { type Page, type Stroke, blankPage } from "../../src/model/document";
import { StrokeIndex } from "../../src/view/stroke-index";

/** A horizontal stroke from (x0, y) to (x1, y). */
function line(id: string, x0: number, x1: number, y: number): Stroke {
  return { id, color: "#000", size: 2, tool: "pen", pts: [x0, y, 0.5, x1, y, 0.5] };
}

function page(id: string, strokes: Stroke[]): Page {
  const p = blankPage(id);
  p.strokes = strokes;
  return p;
}

function twoPages(): Page[] {
  return [
    page("p1", [line("s1", 0, 100, 10), line("s2", 0, 100, 600)]),
    // The same coordinates on another page are another place.
    page("p2", [line("s3", 0, 100, 10)]),
  ];
}

describe("StrokeIndex", () => {
  it("finds strokes near a point on their own page only", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    expect([...index.near("p1", 50, 10, 2)]).toEqual(["s1"]);
    expect([...index.near("p2", 50, 10, 2)]).toEqual(["s3"]);
    expect([...index.near("p1", 50, 600, 2)]).toEqual(["s2"]);
  });

  it("visits the strokes near a point on their own page, as strokes", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    const seen: string[] = [];
    index.forEachNear("p1", 50, 10, 2, (stroke) => seen.push(stroke.id));
    expect(seen).toEqual(["s1"]);
    index.forEachNear("nowhere", 50, 10, 2, (stroke) => seen.push(stroke.id));
    expect(seen).toEqual(["s1"]);
  });

  it("finds strokes whose bounds meet a box", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    const all = index.within("p1", { minX: -10, minY: -10, maxX: 200, maxY: 700 });
    expect([...all].sort()).toEqual(["s1", "s2"]);
  });

  it("answers an unknown page with nothing", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    expect(index.near("p9", 50, 10, 5).size).toBe(0);
    expect(index.within("p9", { minX: 0, minY: 0, maxX: 1e4, maxY: 1e4 }).size).toBe(0);
  });

  it("resolves an id to its stroke and its page", () => {
    const pages = twoPages();
    const index = new StrokeIndex();
    index.rebuild(pages);
    expect(index.get("s3")).toBe(pages[1].strokes[0]);
    expect(index.pageOf("s3")).toBe("p2");
    expect(index.get("s9")).toBeUndefined();
    expect(index.pageOf("s9")).toBeUndefined();
  });

  it("takes a stroke added later", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    const added = line("s4", 0, 100, 300);
    index.add("p2", added);
    expect([...index.near("p2", 50, 300, 1)]).toEqual(["s4"]);
    expect(index.get("s4")).toBe(added);
    // A page the index had never seen gets a grid of its own.
    index.add("p3", line("s5", 0, 10, 0));
    expect([...index.near("p3", 5, 0, 1)]).toEqual(["s5"]);
  });

  it("forgets a removed stroke, from the page it knew it on or the one named", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    index.remove("s1");
    expect(index.near("p1", 50, 10, 2).size).toBe(0);
    expect(index.get("s1")).toBeUndefined();
    index.remove("s3", "p2");
    expect(index.near("p2", 50, 10, 2).size).toBe(0);
    expect(index.pageOf("s3")).toBeUndefined();
    // Removing what is not there changes nothing.
    index.remove("s9");
    expect(index.get("s2")).toBeDefined();
  });

  it("clears one page and leaves the others", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    index.clearPage("p1");
    expect(index.near("p1", 50, 10, 2).size).toBe(0);
    expect(index.get("s1")).toBeUndefined();
    expect(index.get("s2")).toBeUndefined();
    expect(index.get("s3")).toBeDefined();
    expect(index.near("p2", 50, 10, 2).size).toBe(1);
  });

  it("drops everything it knew on a rebuild", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    index.rebuild([page("p1", [line("s8", 0, 10, 0)])]);
    expect(index.get("s1")).toBeUndefined();
    expect(index.near("p2", 50, 10, 2).size).toBe(0);
    expect(index.get("s8")).toBeDefined();
  });

  it("groups ids by page, pages in first-seen order, and leaves out unknown ids", () => {
    const index = new StrokeIndex();
    index.rebuild(twoPages());
    const grouped = index.byPage(["s3", "s1", "s9", "s2"]);
    expect([...grouped.keys()]).toEqual(["p2", "p1"]);
    expect([...(grouped.get("p1") ?? [])]).toEqual(["s1", "s2"]);
    expect([...(grouped.get("p2") ?? [])]).toEqual(["s3"]);
  });

  it("leaves out ids on a page that has no id", () => {
    const index = new StrokeIndex();
    index.rebuild([page("", [line("s1", 0, 10, 0)])]);
    expect(index.byPage(["s1"]).size).toBe(0);
  });

  it("keeps a repeated id on the last page that holds it", () => {
    const index = new StrokeIndex();
    index.rebuild([page("p1", [line("s1", 0, 10, 0)]), page("p2", [line("s1", 0, 10, 50)])]);
    expect(index.pageOf("s1")).toBe("p2");
  });

  describe("refreshPages", () => {
    /** Everything the index answers about `pages`, to compare two indexes. */
    function answers(index: StrokeIndex, pages: Page[]): unknown {
      const box = { minX: -1000, minY: -1000, maxX: 5000, maxY: 5000 };
      const ids = pages.flatMap((p) => p.strokes.map((s) => s.id)).concat(["s1", "s2", "s3"]);
      return {
        within: pages.map((p) => [...index.within(p.id, box)].sort()),
        near: pages.map((p) => [...index.near(p.id, 50, 10, 2)].sort()),
        where: ids.map((id) => [id, index.pageOf(id), index.get(id)?.pts[0]]),
      };
    }

    function rebuilt(pages: Page[]): StrokeIndex {
      const index = new StrokeIndex();
      index.rebuild(pages);
      return index;
    }

    it("answers as a rebuild does after strokes on one page are erased, added and moved", () => {
      const pages = twoPages();
      const index = rebuilt(pages);
      pages[0].strokes.splice(0, 1);
      pages[0].strokes.push(line("s4", 300, 400, 900));
      // MoveStrokesOnPage moves points in place.
      pages[0].strokes[0].pts[1] += 500;
      pages[0].strokes[0].pts[4] += 500;
      index.refreshPages(pages, ["p1"]);
      expect(answers(index, pages)).toEqual(answers(rebuilt(pages), pages));
      expect(index.get("s1")).toBeUndefined();
      expect([...index.near("p1", 50, 1100, 2)]).toEqual(["s2"]);
    });

    it("leaves the other pages as they were indexed", () => {
      const pages = twoPages();
      const index = rebuilt(pages);
      // Not reported, and not refreshed: the index still has p2 as it was.
      pages[1].strokes = [];
      index.refreshPages(pages, ["p1"]);
      expect([...index.near("p2", 50, 10, 2)]).toEqual(["s3"]);
    });

    it("drops a page that is gone, and ignores an empty list", () => {
      const pages = twoPages();
      const index = rebuilt(pages);
      index.refreshPages(pages, []);
      expect(index.get("s3")).toBeDefined();
      index.refreshPages([pages[0]], ["p2"]);
      expect(index.get("s3")).toBeUndefined();
      expect(index.near("p2", 50, 10, 2).size).toBe(0);
      expect(index.get("s1")).toBeDefined();
    });

    it("reads every page that shares a refreshed id", () => {
      const pages = [page("p1", [line("s1", 0, 10, 0)]), page("p1", [line("s2", 0, 10, 50)])];
      const index = rebuilt(pages);
      pages[1].strokes.push(line("s3", 0, 10, 90));
      index.refreshPages(pages, ["p1"]);
      expect(answers(index, pages)).toEqual(answers(rebuilt(pages), pages));
    });
  });
});
