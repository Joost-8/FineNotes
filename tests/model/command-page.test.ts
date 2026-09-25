/**
 * `Command.pageId`: the page a command changes, which undo and redo use to
 * glide an off-screen change into view. A command must name its page, a
 * document-wide one must name none, and a composite names a page only when
 * every part that names one agrees.
 */

import { describe, expect, it } from "vitest";
import { AddPage, type Command, RemovePage, SetBackdrop } from "../../src/model/commands";
import { type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import {
  AddStrokeToPage,
  ClearPage,
  CompositeCommand,
  RemoveStrokesFromPage,
  SetPageBookmark,
} from "../../src/model/page-commands";
import { SetPageEpoch, addStrokesTimed } from "../../src/model/recording-commands";
import { SetSingle } from "../../src/model/notebook-commands";
import { History } from "../../src/model/history";

function stroke(id: string): Stroke {
  return { id, color: "#1a1a1a", size: 3, tool: "pen", pts: [1, 2, 0.5, 3, 4, 0.5] };
}

describe("Command.pageId", () => {
  it("page-addressed commands name their page", () => {
    expect(new AddStrokeToPage("p2", stroke("a")).pageId).toBe("p2");
    expect(new RemoveStrokesFromPage("p3", new Set(["a"])).pageId).toBe("p3");
    expect(new ClearPage("p4").pageId).toBe("p4");
    expect(new SetBackdrop("p5", { kind: "blank" }).pageId).toBe("p5");
  });

  it("commands holding a page object name that page", () => {
    const page = blankPage("cover");
    expect(new AddPage(0, page).pageId).toBe("cover");
    expect(new SetPageBookmark(page, true).pageId).toBe("cover");
    expect(new SetPageEpoch(page, 1000).pageId).toBe("cover");
  });

  it("document-wide commands name none", () => {
    const removal: Command = new RemovePage(0);
    const single: Command = new SetSingle(true);
    expect(removal.pageId).toBeUndefined();
    expect(single.pageId).toBeUndefined();
  });

  it("a composite names the page its parts agree on", () => {
    const same = new CompositeCommand("Two strokes", [
      new AddStrokeToPage("p2", stroke("a")),
      new AddStrokeToPage("p2", stroke("b")),
    ]);
    expect(same.pageId).toBe("p2");
  });

  it("a composite of different pages, or of none, names none", () => {
    const split = new CompositeCommand("Across pages", [
      new AddStrokeToPage("p2", stroke("a")),
      new AddStrokeToPage("p3", stroke("b")),
    ]);
    expect(split.pageId).toBeUndefined();
    expect(new CompositeCommand("Nothing", []).pageId).toBeUndefined();
    expect(new CompositeCommand("Document", [new SetSingle(false)]).pageId).toBeUndefined();
  });

  it("a part without a page does not break the agreement", () => {
    const mixed = new CompositeCommand("Mixed", [
      new SetSingle(false),
      new AddStrokeToPage("p2", stroke("a")),
    ]);
    expect(mixed.pageId).toBe("p2");
  });

  it("the timed stroke a surface pushes names its page, epoch and all", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const command = addStrokesTimed(page, [stroke("a"), stroke("b")], 5000);
    expect(command.pageId).toBe(page.id);
  });
});

describe("History.onChange", () => {
  function recorder(history: History): string[] {
    const seen: string[] = [];
    history.onChange = () => seen.push(`${history.canUndo()}/${history.canRedo()}`);
    return seen;
  }

  it("fires after push, undo, redo and clear, with the new availability", () => {
    const doc = emptyDocument();
    const history = new History();
    const seen = recorder(history);
    history.push(doc, new AddStrokeToPage(doc.pages[0].id, stroke("a")));
    history.undo(doc);
    history.redo(doc);
    history.clear();
    expect(seen).toEqual(["true/false", "false/true", "true/false", "false/false"]);
  });

  it("stays quiet when nothing changed", () => {
    const doc = emptyDocument();
    const history = new History();
    const seen = recorder(history);
    expect(history.undo(doc)).toBeNull();
    expect(history.redo(doc)).toBeNull();
    const command = new AddStrokeToPage(doc.pages[0].id, stroke("a"));
    expect(history.withdraw(doc, command)).toBe(false);
    expect(history.withdrawTail(doc, [command])).toBe(false);
    expect(seen).toEqual([]);
  });

  it("fires when a withdrawal takes commands back", () => {
    const doc = emptyDocument();
    const history = new History();
    const first = new AddStrokeToPage(doc.pages[0].id, stroke("a"));
    const second = new AddStrokeToPage(doc.pages[0].id, stroke("b"));
    history.push(doc, first);
    history.push(doc, second);
    const seen = recorder(history);
    expect(history.withdraw(doc, second)).toBe(true);
    expect(history.withdrawTail(doc, [first])).toBe(true);
    expect(seen).toEqual(["true/false", "false/false"]);
  });
});
