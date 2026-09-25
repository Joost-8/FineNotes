/**
 * The undo stack, checked with commands that only write to a log: each
 * `apply` records `+name` and each `invert` records `-name`, so a test reads
 * exactly which steps ran, in which order, against which document.
 */

import { describe, expect, it } from "vitest";
import type { Command } from "../../src/model/commands";
import { type InkDocument, emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";

class Logged implements Command {
  readonly label: string;

  constructor(
    private readonly log: string[],
    readonly name: string,
    private readonly target?: InkDocument,
  ) {
    this.label = `step ${name}`;
  }

  apply(doc: InkDocument): void {
    if (this.target) expect(doc).toBe(this.target);
    this.log.push(`+${this.name}`);
  }

  invert(doc: InkDocument): void {
    if (this.target) expect(doc).toBe(this.target);
    this.log.push(`-${this.name}`);
  }
}

function setup(limit?: number): {
  doc: InkDocument;
  log: string[];
  history: History;
  changes: () => number;
  step: (name: string) => Logged;
} {
  const doc = emptyDocument();
  const log: string[] = [];
  const history = limit === undefined ? new History() : new History(limit);
  let changed = 0;
  history.onChange = () => {
    changed++;
  };
  return {
    doc,
    log,
    history,
    changes: () => changed,
    step: (name) => new Logged(log, name, doc),
  };
}

describe("History: push, undo, redo", () => {
  it("applies a pushed command straight away and makes it undoable", () => {
    const { doc, log, history, step } = setup();
    expect(history.canUndo()).toBe(false);
    history.push(doc, step("a"));
    expect(log).toEqual(["+a"]);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("undoes newest first and redoes in the order it undid", () => {
    const { doc, log, history, step } = setup();
    const a = step("a");
    const b = step("b");
    history.push(doc, a);
    history.push(doc, b);
    expect(history.undo(doc)).toBe(b);
    expect(history.undo(doc)).toBe(a);
    expect(history.redo(doc)).toBe(a);
    expect(history.redo(doc)).toBe(b);
    expect(log).toEqual(["+a", "+b", "-b", "-a", "+a", "+b"]);
  });

  it("returns null and does nothing when there is nothing to undo or redo", () => {
    const { doc, log, history, changes } = setup();
    expect(history.undo(doc)).toBeNull();
    expect(history.redo(doc)).toBeNull();
    expect(log).toEqual([]);
    expect(changes()).toBe(0);
  });

  it("forgets the redo steps once something new is pushed", () => {
    const { doc, log, history, step } = setup();
    history.push(doc, step("a"));
    history.undo(doc);
    expect(history.canRedo()).toBe(true);
    history.push(doc, step("b"));
    expect(history.canRedo()).toBe(false);
    expect(history.redo(doc)).toBeNull();
    expect(log).toEqual(["+a", "-a", "+b"]);
  });

  it("records nothing when a command throws while applying", () => {
    const { doc, history, changes } = setup();
    const broken: Command = {
      label: "broken",
      apply: () => {
        throw new Error("no");
      },
      invert: () => undefined,
    };
    expect(() => history.push(doc, broken)).toThrow("no");
    expect(history.canUndo()).toBe(false);
    expect(changes()).toBe(0);
  });
});

describe("History: the limit", () => {
  it("keeps the last 200 steps by default and makes older ones permanent", () => {
    const { doc, log, history, step } = setup();
    for (let i = 0; i < 201; i++) history.push(doc, step(String(i)));
    let undone = 0;
    while (history.undo(doc)) undone++;
    expect(undone).toBe(200);
    expect(log).not.toContain("-0");
    expect(log).toContain("-1");
  });

  it("honours a custom limit", () => {
    const { doc, log, history, step } = setup(2);
    for (const name of ["a", "b", "c"]) history.push(doc, step(name));
    history.undo(doc);
    history.undo(doc);
    expect(history.canUndo()).toBe(false);
    expect(log).toEqual(["+a", "+b", "+c", "-c", "-b"]);
  });

  it("with a limit of 0 applies commands but never offers to undo them", () => {
    const { doc, log, history, step } = setup(0);
    history.push(doc, step("a"));
    expect(log).toEqual(["+a"]);
    expect(history.canUndo()).toBe(false);
  });

  it("counts redo steps separately from the limit", () => {
    const { doc, history, step } = setup(2);
    history.push(doc, step("a"));
    history.push(doc, step("b"));
    history.undo(doc);
    history.undo(doc);
    history.redo(doc);
    history.redo(doc);
    expect(history.undo(doc)?.label).toBe("step b");
    expect(history.undo(doc)?.label).toBe("step a");
  });
});

describe("History: clear and change notifications", () => {
  it("clear empties both stacks without running anything", () => {
    const { doc, log, history, step } = setup();
    history.push(doc, step("a"));
    history.push(doc, step("b"));
    history.undo(doc);
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(log).toEqual(["+a", "+b", "-b"]);
  });

  it("tells the host after every push, undo, redo and clear", () => {
    const { doc, history, changes, step } = setup();
    history.push(doc, step("a"));
    expect(changes()).toBe(1);
    history.undo(doc);
    expect(changes()).toBe(2);
    history.redo(doc);
    expect(changes()).toBe(3);
    history.clear();
    expect(changes()).toBe(4);
    history.clear();
    expect(changes()).toBe(5);
  });

  it("works without a listener", () => {
    const history = new History();
    const doc = emptyDocument();
    const log: string[] = [];
    history.push(doc, new Logged(log, "a"));
    history.undo(doc);
    history.redo(doc);
    history.clear();
    expect(log).toEqual(["+a", "-a", "+a"]);
  });
});

describe("History: taking back the latest steps", () => {
  it("withdraw inverts only the newest command and leaves no redo step for it", () => {
    const { doc, log, history, changes, step } = setup();
    const a = step("a");
    const b = step("b");
    history.push(doc, a);
    history.push(doc, b);
    expect(history.withdraw(doc, a)).toBe(false);
    expect(changes()).toBe(2);
    expect(history.withdraw(doc, b)).toBe(true);
    expect(changes()).toBe(3);
    expect(history.canRedo()).toBe(false);
    expect(history.undo(doc)).toBe(a);
    expect(log).toEqual(["+a", "+b", "-b", "-a"]);
  });

  it("withdraw leaves existing redo steps where they are", () => {
    const { doc, log, history, step } = setup();
    const a = step("a");
    const b = step("b");
    const c = step("c");
    history.push(doc, a);
    history.push(doc, b);
    history.push(doc, c);
    history.undo(doc);
    expect(history.withdraw(doc, b)).toBe(true);
    expect(history.redo(doc)).toBe(c);
    expect(history.undo(doc)).toBe(c);
    expect(history.undo(doc)).toBe(a);
    expect(log).toEqual(["+a", "+b", "+c", "-c", "-b", "+c", "-c", "-a"]);
  });

  it("withdrawTail takes back several newest commands, newest first, or none", () => {
    const { doc, log, history, step } = setup();
    const a = step("a");
    const b = step("b");
    const c = step("c");
    history.push(doc, a);
    history.push(doc, b);
    history.push(doc, c);
    expect(history.withdrawTail(doc, [a, c])).toBe(false);
    expect(history.withdrawTail(doc, [])).toBe(false);
    expect(history.withdrawTail(doc, [a, b, c, step("d")])).toBe(false);
    expect(log).toEqual(["+a", "+b", "+c"]);
    expect(history.withdrawTail(doc, [b, c])).toBe(true);
    expect(log).toEqual(["+a", "+b", "+c", "-c", "-b"]);
    expect(history.isLatest(a)).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("isLatest names only the command withdraw would take back", () => {
    const { doc, history, step } = setup();
    const a = step("a");
    const b = step("b");
    expect(history.isLatest(a)).toBe(false);
    history.push(doc, a);
    expect(history.isLatest(a)).toBe(true);
    history.push(doc, b);
    expect(history.isLatest(a)).toBe(false);
    expect(history.isLatest(b)).toBe(true);
    history.undo(doc);
    expect(history.isLatest(b)).toBe(false);
    expect(history.isLatest(a)).toBe(true);
  });
});
