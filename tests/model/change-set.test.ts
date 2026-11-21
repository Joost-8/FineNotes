/**
 * Ask AI's changes, taken back later: what a change set records, where it
 * stands, and that taking it back never touches what the user did since.
 */

import { describe, expect, it } from "vitest";
import { emptyDocument, type InkDocument, type Page } from "../../src/model/document";
import { AddPage } from "../../src/model/commands";
import { SetPageTitle, SetSection } from "../../src/model/contents";
import {
  AddStrokeToPage,
  AddTextBoxToPage,
  MovePage,
  SetPageBookmark,
} from "../../src/model/page-commands";
import {
  type ChangeSet,
  changeState,
  diffPages,
  filterChange,
  isEmptyChange,
  pagesChangedSince,
  pagesOf,
  revertChange,
  same,
  snapshotPages,
} from "../../src/model/change-set";
import { ChangeLedger } from "../../src/model/change-ledger";
import type { Command } from "../../src/model/commands";
import { History } from "../../src/model/history";

function page(id: string): Page {
  return {
    id,
    kind: "ink",
    geometry: { width: 1000, height: 1400 },
    backdrop: { kind: "blank" } as Page["backdrop"],
    strokes: [],
    images: [],
    textBoxes: [],
  };
}

function notebook(n: number): InkDocument {
  const doc = emptyDocument();
  doc.pages = Array.from({ length: n }, (_, i) => page(`p${i + 1}`));
  return doc;
}

function box(id: string, text = id) {
  return { id, x: 10, y: 10, w: 200, text, color: "#000", fontSize: 20 };
}

function stroke(id: string) {
  return { id, color: "#000", size: 2, tool: "pen" as const, pts: [0, 0, 0.5, 10, 10, 0.5] };
}

/** Run `command` through `history` and record what it changed. */
function change(doc: InkDocument, history: History, command: Command): ChangeSet {
  const before = snapshotPages(doc);
  history.push(doc, command);
  return diffPages(before, doc);
}

function undo(doc: InkDocument, history: History, sets: ChangeSet[]) {
  const result = revertChange(doc, sets, "undo", "Undo AI");
  if (!("apply" in result)) return result;
  history.push(doc, result);
  return "done" as const;
}

describe("diffPages", () => {
  it("records nothing when nothing changed", () => {
    const doc = notebook(2);
    expect(isEmptyChange(diffPages(snapshotPages(doc), doc))).toBe(true);
  });

  it("records an added element, a changed field and a heading by id", () => {
    const doc = notebook(2);
    const history = new History();
    const p = doc.pages[1];
    const before = snapshotPages(doc);
    history.push(doc, new AddTextBoxToPage(p.id, box("t1")));
    history.push(doc, new SetPageTitle(p, "Week 1"));
    history.push(doc, new SetSection(p, "c1", { x: 80, y: 600, title: "Cells" }));
    const set = diffPages(before, doc);
    expect(set.order).toBeUndefined();
    expect(set.parts.map((part) => [part.kind, part.kind === "page" ? "" : part.key])).toEqual([
      ["element", "textBoxes"],
      ["field", "title"],
      ["element", "sections"],
    ]);
    expect(pagesOf(set, doc)).toEqual([2]);
  });

  it("records an added page and the new order", () => {
    const doc = notebook(2);
    const set = change(doc, new History(), new AddPage(1, page("new")));
    expect(set.parts).toHaveLength(1);
    expect(set.parts[0].kind).toBe("page");
    expect(set.order?.after.map((p) => p.id)).toEqual(["p1", "new", "p2"]);
  });

  it("keeps only what a filter picks", () => {
    const doc = notebook(1);
    const history = new History();
    const before = snapshotPages(doc);
    history.push(doc, new AddTextBoxToPage("p1", box("t1")));
    history.push(doc, new AddPage(1, page("new")));
    const set = filterChange(diffPages(before, doc), (part) => part.kind === "element");
    expect(set.parts).toHaveLength(1);
    expect(set.order).toBeUndefined();
  });
});

describe("taking a change back later", () => {
  it("undoes the AI's text box after the user wrote elsewhere, keeping the user's ink", () => {
    const doc = notebook(2);
    const history = new History();
    const ai = change(doc, history, new AddTextBoxToPage("p1", box("t1")));
    // The user writes on the same page, and on another.
    history.push(doc, new AddStrokeToPage("p1", stroke("s1")));
    history.push(doc, new AddStrokeToPage("p2", stroke("s2")));
    expect(changeState(doc, ai)).toBe("applied");
    expect(undo(doc, history, [ai])).toBe("done");
    expect(doc.pages[0].textBoxes).toEqual([]);
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual(["s1"]);
    expect(doc.pages[1].strokes.map((s) => s.id)).toEqual(["s2"]);
    expect(changeState(doc, ai)).toBe("undone");
    // And the normal undo takes the take-back back.
    history.undo(doc);
    expect(doc.pages[0].textBoxes.map((b) => b.id)).toEqual(["t1"]);
    expect(changeState(doc, ai)).toBe("applied");
  });

  it("refuses, changing nothing, when the user edited what the AI made", () => {
    const doc = notebook(2);
    const history = new History();
    const ai = change(doc, history, new SetPageTitle(doc.pages[1], "Lecture 4"));
    history.push(doc, new SetPageTitle(doc.pages[1], "Lecture four"));
    expect(changeState(doc, ai)).toBe("changed");
    expect(pagesChangedSince(doc, ai, "after")).toEqual([2]);
    expect(undo(doc, history, [ai])).toEqual({ reason: "changed", pages: [2] });
    expect(doc.pages[1].title).toBe("Lecture four");
  });

  it("refuses to take back a page the user has written on since", () => {
    const doc = notebook(1);
    const history = new History();
    const ai = change(doc, history, new AddPage(1, page("new")));
    history.push(doc, new AddStrokeToPage("new", stroke("s1")));
    expect(undo(doc, history, [ai])).toEqual({ reason: "changed", pages: [2] });
    expect(doc.pages).toHaveLength(2);
  });

  it("takes back an added page untouched since, and a move, when the order is as left", () => {
    const doc = notebook(3);
    const history = new History();
    const added = change(doc, history, new AddPage(3, page("new")));
    const moved = change(doc, history, new MovePage(0, 2));
    expect(doc.pages.map((p) => p.id)).toEqual(["p2", "p3", "p1", "new"]);
    expect(undo(doc, history, [added, moved])).toBe("done");
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("refuses a move once the user reordered the pages again", () => {
    const doc = notebook(3);
    const history = new History();
    const moved = change(doc, history, new MovePage(0, 2));
    history.push(doc, new MovePage(0, 1));
    expect(undo(doc, history, [moved])).toEqual({ reason: "changed", pages: [] });
  });

  it("takes back several changes to one heading newest first, all or nothing", () => {
    const doc = notebook(1);
    const history = new History();
    const p = doc.pages[0];
    const first = change(doc, history, new SetSection(p, "c1", { x: 80, y: 600, title: "Cells" }));
    const second = change(
      doc,
      history,
      new SetSection(p, "c1", { x: 80, y: 600, title: "Cell biology" }),
    );
    // The first alone reads as changed (the second came after it)…
    expect(changeState(doc, first)).toBe("changed");
    // …but the two together go back cleanly.
    expect(undo(doc, history, [first, second])).toBe("done");
    expect(p.sections).toBeUndefined();
  });

  it("redoes a change that was taken back, and says when there is nothing to do", () => {
    const doc = notebook(1);
    const history = new History();
    const ai = change(doc, history, new SetPageBookmark(doc.pages[0], true));
    expect(revertChange(doc, [ai], "redo", "Redo")).toEqual({ reason: "already" });
    expect(undo(doc, history, [ai])).toBe("done");
    expect(doc.pages[0].bookmarked).toBeUndefined();
    expect(revertChange(doc, [ai], "undo", "Undo")).toEqual({ reason: "already" });
    const redo = revertChange(doc, [ai], "redo", "Redo");
    expect("apply" in redo).toBe(true);
    history.push(doc, redo as Command);
    expect(doc.pages[0].bookmarked).toBe(true);
  });

  it("refuses once the page the change was on is gone", () => {
    const doc = notebook(2);
    const history = new History();
    const ai = change(doc, history, new SetPageTitle(doc.pages[1], "Gone soon"));
    doc.pages.splice(1, 1);
    expect(changeState(doc, ai)).toBe("changed");
    expect(undo(doc, history, [ai])).toEqual({ reason: "changed", pages: [] });
  });

  it("puts an element back where it stood when redone", () => {
    const doc = notebook(1);
    const history = new History();
    history.push(doc, new AddTextBoxToPage("p1", box("t0")));
    const ai = change(doc, history, new AddTextBoxToPage("p1", box("t1")));
    history.push(doc, new AddTextBoxToPage("p1", box("t2")));
    expect(undo(doc, history, [ai])).toBe("done");
    expect(doc.pages[0].textBoxes.map((b) => b.id)).toEqual(["t0", "t2"]);
    history.push(doc, revertChange(doc, [ai], "redo", "Redo") as Command);
    expect(doc.pages[0].textBoxes.map((b) => b.id)).toEqual(["t0", "t1", "t2"]);
  });
});

describe("same", () => {
  it("compares plain data deeply, typed arrays by value, absent keys as absent", () => {
    expect(same({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(same({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(same([1, 2], [1, 2, 3])).toBe(false);
    expect(same(new Float32Array([1, 2]), new Float32Array([1, 2]))).toBe(true);
    expect(same(new Float32Array([1, 2]), [1, 2])).toBe(false);
    expect(same([1], { 0: 1 })).toBe(false);
    expect(same(null, {})).toBe(false);
  });
});

describe("ChangeLedger", () => {
  it("numbers changes, finds the latest answer's, and refuses unknown ones", () => {
    const doc = notebook(2);
    const history = new History();
    const ledger = new ChangeLedger();
    const one = ledger.record(
      change(doc, history, new SetPageTitle(doc.pages[0], "A")),
      "Titled",
      1,
    );
    const two = ledger.record(
      change(doc, history, new SetPageTitle(doc.pages[1], "B")),
      "Titled",
      2,
    );
    const three = ledger.record(
      change(doc, history, new SetPageBookmark(doc.pages[1], true)),
      "Bookmarked",
      2,
    );
    expect([one, two, three]).toEqual([1, 2, 3]);
    expect(ledger.size).toBe(3);
    expect(ledger.entry(9)).toBeNull();
    expect(ledger.state(doc, 9)).toBeNull();
    expect(ledger.latestApplied(doc, 3)).toEqual([2, 3]);
    expect(ledger.latestApplied(doc, 2)).toEqual([1]);
    expect(ledger.revert(doc, [4], "undo", "Undo")).toEqual({ reason: "unknown", ids: [4] });
    const step = ledger.revert(doc, [3, 2], "undo", "Undo AI");
    history.push(doc, step as Command);
    expect(doc.pages[1].title).toBeUndefined();
    expect(ledger.state(doc, 2)).toBe("undone");
    // Answer 2 is all taken back: the latest with changes in place is answer 1.
    expect(ledger.latestApplied(doc, 3)).toEqual([1]);
  });
});
