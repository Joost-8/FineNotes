/**
 * Handwriting made checklist items (`src/model/tasks.ts`): making, ticking
 * and undoing them, and what an erase, a page copy or a move does to them.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import { ReplaceStrokesOnPage } from "../../src/model/erase-commands";
import { CompositeCommand, duplicatePageAfter } from "../../src/model/page-commands";
import {
  MAX_TASK_TEXT,
  makeTask,
  nextTaskId,
  normalizeTaskText,
  tasksOf,
  tickTask,
} from "../../src/model/tasks";

function stroke(id: string): Stroke {
  return { id, color: "#000", size: 2, tool: "pen", pts: [0, 0, 0.5, 10, 0, 0.5] };
}

function notebook(): InkDocument {
  const doc = emptyDocument();
  doc.pages[0].strokes = ["s1", "s2", "s3"].map(stroke);
  return doc;
}

describe("makeTask", () => {
  it("makes the strokes one task, and undo takes it away again", () => {
    const doc = notebook();
    const page = doc.pages[0];
    const make = new CompositeCommand("Task", makeTask(doc, page, ["s1", "s2"], " Buy\nmilk "));
    make.apply(doc);
    expect(page.tasks).toEqual([{ id: "ck1", strokes: ["s1", "s2"], text: "Buy milk" }]);
    make.invert(doc);
    expect(page.tasks).toBeUndefined();
  });

  it("takes strokes from a task that held them, and drops a task left with none", () => {
    const doc = notebook();
    const page = doc.pages[0];
    new CompositeCommand("Task", makeTask(doc, page, ["s1"], "a")).apply(doc);
    new CompositeCommand("Task", makeTask(doc, page, ["s1", "s2"], "b")).apply(doc);
    expect(page.tasks).toEqual([{ id: "ck2", strokes: ["s1", "s2"], text: "b" }]);
    expect(tasksOf(page, ["s2"]).map((t) => t.id)).toEqual(["ck2"]);
  });

  it("makes nothing of no strokes", () => {
    const doc = notebook();
    expect(makeTask(doc, doc.pages[0], [], "a")).toEqual([]);
  });
});

describe("tickTask", () => {
  it("ticks and unticks, one undo step each", () => {
    const doc = notebook();
    const page = doc.pages[0];
    new CompositeCommand("Task", makeTask(doc, page, ["s1"], "a")).apply(doc);
    const tick = tickTask(page, page.tasks![0], true);
    tick.apply(doc);
    expect(page.tasks![0].done).toBe(true);
    const untick = tickTask(page, page.tasks![0], false);
    untick.apply(doc);
    expect(page.tasks![0].done).toBeUndefined();
    untick.invert(doc);
    expect(page.tasks![0].done).toBe(true);
    tick.invert(doc);
    expect(page.tasks![0].done).toBeUndefined();
  });
});

describe("ids and text", () => {
  it("numbers ids past the highest in the notebook", () => {
    const doc = notebook();
    doc.pages[0].tasks = [{ id: "ck7", strokes: ["s1"], text: "" }];
    expect(nextTaskId(doc)).toBe("ck8");
  });

  it("keeps a task's text to one bounded line", () => {
    expect(normalizeTaskText("  a\n\tb  ")).toBe("a b");
    expect(normalizeTaskText(5)).toBe("");
    expect(normalizeTaskText("x".repeat(MAX_TASK_TEXT + 9))).toHaveLength(MAX_TASK_TEXT);
  });
});

describe("other edits", () => {
  it("an erase that cuts a task's stroke keeps the pieces in the task; undo puts it back", () => {
    const doc = notebook();
    const page = doc.pages[0];
    page.tasks = [{ id: "ck1", strokes: ["s1", "s2"], text: "a" }];
    const erase = new ReplaceStrokesOnPage(page.id, [
      { original: page.strokes[0], pieces: [stroke("s1a"), stroke("s1b")] },
      { original: page.strokes[1], pieces: [] },
    ]);
    erase.apply(doc);
    expect(page.tasks).toEqual([{ id: "ck1", strokes: ["s1a", "s1b"], text: "a" }]);
    erase.invert(doc);
    expect(page.tasks).toEqual([{ id: "ck1", strokes: ["s1", "s2"], text: "a" }]);
  });

  it("a duplicated page starts without the original's tasks", () => {
    const doc = notebook();
    doc.pages[0].tasks = [{ id: "ck1", strokes: ["s1"], text: "a" }];
    expect(duplicatePageAfter(doc, 0)?.page.tasks).toBeUndefined();
  });
});
