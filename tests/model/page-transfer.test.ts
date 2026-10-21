/**
 * Pages sent to another notebook: renumbering against the destination,
 * the undoable command, and the destination picker's ordering.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import {
  ReceivePages,
  type TransferTarget,
  orderTargets,
  prepareTransfer,
  rememberTarget,
  removePagesById,
  transferNotice,
  transferRefusal,
} from "../../src/model/page-transfer";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";

function stroke(id: string): Stroke {
  return { id, color: "#1a1a1a", size: 3, tool: "pen", pts: [1, 2, 0.5, 3, 4, 0.5] };
}

/** A notebook of pages p1..pN, page i holding stroke s<i>. */
function notebook(n: number): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].strokes.push(stroke("s1"));
  for (let i = 2; i <= n; i++) {
    const page = blankPage(`p${i}`);
    page.strokes.push(stroke(`s${i}`));
    doc.pages.push(page);
  }
  return doc;
}

describe("prepareTransfer", () => {
  it("numbers pages and strokes above the destination's, in order", () => {
    const from = notebook(3);
    const to = notebook(2);
    const copies = prepareTransfer([from.pages[1], from.pages[2]], to);
    expect(copies.map((p) => p.id)).toEqual(["p3", "p4"]);
    expect(copies[0].strokes[0].id).toBe("s3");
    expect(copies[1].strokes[0].id).toBe("s4");
  });

  it("leaves the source pages and the destination alone", () => {
    const from = notebook(2);
    const to = notebook(1);
    const before = JSON.stringify([from, to]);
    prepareTransfer([from.pages[1]], to);
    expect(JSON.stringify([from, to])).toBe(before);
  });

  it("renumbers pictures, text boxes, tables, graphs and comments", () => {
    const from = notebook(1);
    const page = from.pages[0];
    page.images.push({ id: "i1", path: "a.png", x: 0, y: 0, w: 10, h: 10 });
    page.textBoxes.push({ id: "t1" } as never);
    page.tables = [{ id: "g1" } as never];
    page.graphs = [{ id: "f1" } as never];
    page.comments = [{ id: "cm1", x: 0, y: 0, text: "x", author: "you", created: 1 }];
    const to = notebook(1);
    to.pages[0].images.push({ id: "i7", path: "b.png", x: 0, y: 0, w: 10, h: 10 });
    to.pages[0].textBoxes.push({ id: "t4" } as never);
    const [copy] = prepareTransfer([page], to);
    expect(copy.images[0].id).toBe("i8");
    expect(copy.images[0].path).toBe("a.png");
    expect(copy.textBoxes[0].id).toBe("t5");
    expect(copy.tables?.[0].id).toBe("g1");
    expect(copy.graphs?.[0].id).toBe("f1");
    expect(copy.comments?.[0].id).toBe("cm1");
  });

  it("keeps a link on the renumbered strokes and drops one with none left", () => {
    const from = notebook(1);
    const page = from.pages[0];
    page.strokes.push(stroke("s2"));
    page.links = [
      { id: "l1", strokes: ["s1", "s2"], target: "Other" },
      { id: "l2", strokes: ["s99"], target: "Gone" },
    ];
    const to = notebook(3);
    const [copy] = prepareTransfer([page], to);
    expect(copy.strokes.map((s) => s.id)).toEqual(["s4", "s5"]);
    expect(copy.links).toEqual([{ id: "l1", strokes: ["s4", "s5"], target: "Other" }]);
  });

  it("keeps the bookmark, the contents title and the tab with the page", () => {
    const from = notebook(1);
    Object.assign(from.pages[0], { bookmarked: true, title: "Week 3", tab: "#ff0000" });
    const [copy] = prepareTransfer([from.pages[0]], notebook(1));
    expect(copy).toMatchObject({ bookmarked: true, title: "Week 3", tab: "#ff0000" });
  });
});

describe("ReceivePages", () => {
  it("adds copies at the end and takes the very same pages out on undo", () => {
    const from = notebook(2);
    const to = notebook(2);
    const history = new History();
    const command = new ReceivePages([from.pages[1]]);
    history.push(to, command);
    expect(to.pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(command.added).toHaveLength(1);
    history.undo(to);
    expect(to.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    history.redo(to);
    expect(to.pages[2]).toBe(command.added[0]);
  });

  it("round-trips through the file format", () => {
    const from = notebook(2);
    const to = notebook(1);
    new ReceivePages([from.pages[1]]).apply(to);
    const back = parseInkFile(buildInkFile("", to), 800).doc;
    expect(back?.pages.map((p) => p.strokes.map((s) => s.id))).toEqual([["s1"], ["s2"]]);
  });

  it("never empties the notebook", () => {
    const to = notebook(1);
    const command = new ReceivePages([notebook(1).pages[0]]);
    command.apply(to);
    command.invert(to);
    command.invert(to);
    expect(to.pages).toHaveLength(1);
  });
});

describe("removePagesById", () => {
  it("removes the named pages and keeps at least one", () => {
    const doc = notebook(3);
    expect(removePagesById(doc, ["p2", "p3"])).toBe(2);
    expect(doc.pages.map((p) => p.id)).toEqual(["p1"]);
    expect(removePagesById(doc, ["p1"])).toBe(0);
  });
});

describe("transferRefusal", () => {
  it("accepts a notebook and refuses a single page, a practice set and a read-only one", () => {
    expect(transferRefusal(notebook(1))).toBeNull();
    expect(transferRefusal({ ...notebook(1), single: true })).toMatch(/single page/);
    expect(transferRefusal({ ...notebook(1), readOnly: true })).toMatch(/read-only/);
    expect(transferRefusal({ ...notebook(1), practice: {} as never })).toMatch(/practice/);
  });
});

describe("orderTargets", () => {
  const t = (title: string, mtime: number, folder = ""): TransferTarget => ({
    path: `${folder}${title}.notebook.md`,
    title,
    mtime,
  });
  const targets = [t("Physics", 1), t("Maths", 3), t("Ideas", 2), t("Draft", 9, "Old/")];

  it("puts the last destinations first, then the newest edit", () => {
    const order = orderTargets(targets, ["Ideas.notebook.md"], "", "").map((x) => x.title);
    expect(order).toEqual(["Ideas", "Draft", "Maths", "Physics"]);
  });

  it("drops the notebook the pages are in", () => {
    const order = orderTargets(targets, [], "", "Maths.notebook.md").map((x) => x.title);
    expect(order).not.toContain("Maths");
  });

  it("matches every word of the query in the title or the folder", () => {
    expect(orderTargets(targets, [], "old dra", "").map((x) => x.title)).toEqual(["Draft"]);
    expect(orderTargets(targets, [], "PHYS", "").map((x) => x.title)).toEqual(["Physics"]);
    expect(orderTargets(targets, [], "zzz", "")).toEqual([]);
  });
});

describe("rememberTarget and transferNotice", () => {
  it("keeps a short list without repeats, newest first", () => {
    expect(rememberTarget(["b", "a"], "a")).toEqual(["a", "b"]);
    expect(rememberTarget(["1", "2", "3", "4", "5"], "6")).toEqual(["6", "1", "2", "3", "4"]);
  });

  it("says what happened", () => {
    expect(transferNotice(1, "Maths", false)).toBe("Moved 1 page to Maths.");
    expect(transferNotice(3, "Maths", true)).toBe("Copied 3 pages to Maths.");
  });
});
