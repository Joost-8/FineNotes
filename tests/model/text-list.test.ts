import { describe, expect, it } from "vitest";
import {
  BULLET,
  TASK_DONE,
  TASK_OPEN,
  continueList,
  listKindOf,
  setTaskDone,
  taskLines,
  toggleList,
} from "../../src/model/text-list";

describe("listKindOf", () => {
  it("reads bullets and numbers, with or without an indent", () => {
    expect(listKindOf("• milk")).toBe("bullet");
    expect(listKindOf("  • milk")).toBe("bullet");
    expect(listKindOf("12. eggs")).toBe("number");
    expect(listKindOf("3) eggs")).toBe("number");
  });

  it("leaves plain lines plain", () => {
    expect(listKindOf("milk")).toBeNull();
    expect(listKindOf("•milk")).toBeNull();
    expect(listKindOf("2024 was a year")).toBeNull();
    expect(listKindOf("")).toBeNull();
  });
});

describe("toggleList", () => {
  it("bullets the caret's line and keeps the caret on its character", () => {
    // Caret after "mi" in "milk".
    const edit = toggleList("milk\neggs", 2, 2, "bullet");
    expect(edit.text).toBe(`${BULLET}milk\neggs`);
    expect(edit.selectionStart).toBe(4);
    expect(edit.selectionEnd).toBe(4);
  });

  it("puts the caret after the marker on an empty line", () => {
    expect(toggleList("", 0, 0, "bullet")).toEqual({
      text: BULLET,
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("numbers every selected line from 1", () => {
    const text = "milk\neggs\nbread";
    const edit = toggleList(text, 0, text.length, "number");
    expect(edit.text).toBe("1. milk\n2. eggs\n3. bread");
    expect(edit.selectionStart).toBe(0);
    expect(edit.selectionEnd).toBe(edit.text.length);
  });

  it("does not take a line the selection only touches at its start", () => {
    // Selection = "milk\n", ending at the start of "eggs".
    expect(toggleList("milk\neggs", 0, 5, "bullet").text).toBe(`${BULLET}milk\neggs`);
  });

  it("removes the list when every selected line already is one", () => {
    const text = "1. milk\n2. eggs";
    const edit = toggleList(text, 0, text.length, "number");
    expect(edit.text).toBe("milk\neggs");
    expect(edit.selectionEnd).toBe(edit.text.length);
  });

  it("switches one kind of list to the other", () => {
    const text = `${BULLET}milk\n${BULLET}eggs`;
    expect(toggleList(text, 0, text.length, "number").text).toBe("1. milk\n2. eggs");
    expect(toggleList("1. milk\n2. eggs", 0, 15, "bullet").text).toBe(
      `${BULLET}milk\n${BULLET}eggs`,
    );
  });

  it("keeps an indent", () => {
    expect(toggleList("  milk", 3, 3, "bullet").text).toBe(`  ${BULLET}milk`);
  });

  it("renumbers the run a new item joins", () => {
    // "tea" joins below "1. milk": it becomes 2.
    expect(toggleList("1. milk\ntea", 9, 9, "number").text).toBe("1. milk\n2. tea");
  });
});

describe("continueList", () => {
  it("leaves plain lines to Enter", () => {
    expect(continueList("milk", 4)).toBeNull();
  });

  it("continues a bullet", () => {
    expect(continueList(`${BULLET}milk`, 6)).toEqual({
      text: `${BULLET}milk\n${BULLET}`,
      selectionStart: 9,
      selectionEnd: 9,
    });
  });

  it("continues a number and renumbers the items after it", () => {
    const text = "1. milk\n2. eggs";
    // Enter at the end of "1. milk".
    const edit = continueList(text, 7);
    expect(edit?.text).toBe("1. milk\n2. \n3. eggs");
    expect(edit?.selectionStart).toBe(11);
  });

  it("splits an item at the caret", () => {
    expect(continueList(`${BULLET}milkeggs`, 6)?.text).toBe(`${BULLET}milk\n${BULLET}eggs`);
  });

  it("ends the list on an empty item", () => {
    expect(continueList(`${BULLET}milk\n${BULLET}`, 9)).toEqual({
      text: `${BULLET}milk\n`,
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it("keeps the indent when it continues or ends", () => {
    expect(continueList(`  ${BULLET}milk`, 8)?.text).toBe(`  ${BULLET}milk\n  ${BULLET}`);
    expect(continueList(`  ${BULLET}`, 4)?.text).toBe("  ");
  });

  it("does nothing special for Enter inside the marker", () => {
    expect(continueList("1. milk", 1)).toBeNull();
  });
});

describe("checklists", () => {
  it("reads both boxes as a checklist", () => {
    expect(listKindOf(`${TASK_OPEN}milk`)).toBe("task");
    expect(listKindOf(`  ${TASK_DONE}eggs`)).toBe("task");
    expect(listKindOf("☐milk")).toBeNull();
  });

  it("makes lines items to do, keeps a tick, and takes them off again", () => {
    const on = toggleList(`milk\n${TASK_DONE}eggs`, 0, 9, "task");
    expect(on.text).toBe(`${TASK_OPEN}milk\n${TASK_DONE}eggs`);
    expect(toggleList(on.text, 0, on.text.length, "task").text).toBe("milk\neggs");
  });

  it("turns a bulleted list into a checklist", () => {
    expect(toggleList(`${BULLET}milk\n${BULLET}eggs`, 0, 12, "task").text).toBe(
      `${TASK_OPEN}milk\n${TASK_OPEN}eggs`,
    );
  });

  it("continues with an unticked item, and ends on an empty one", () => {
    const text = `${TASK_DONE}milk`;
    const next = continueList(text, text.length);
    expect(next?.text).toBe(`${TASK_DONE}milk\n${TASK_OPEN}`);
    expect(continueList(next?.text ?? "", next?.selectionStart ?? 0)?.text).toBe(
      `${TASK_DONE}milk\n`,
    );
  });

  it("lists the items with their lines, ticks and words", () => {
    const text = `Shopping\n${TASK_OPEN}milk\n  ${TASK_DONE}eggs \n${BULLET}bread`;
    expect(taskLines(text)).toEqual([
      { line: 1, done: false, text: "milk" },
      { line: 2, done: true, text: "eggs " },
    ]);
  });

  it("ticks and unticks one item, and leaves anything else alone", () => {
    const text = `${TASK_OPEN}milk\n${BULLET}bread`;
    expect(setTaskDone(text, 0, true)).toBe(`${TASK_DONE}milk\n${BULLET}bread`);
    expect(setTaskDone(setTaskDone(text, 0, true), 0, false)).toBe(text);
    expect(setTaskDone(text, 1, true)).toBe(text);
    expect(setTaskDone(text, 7, true)).toBe(text);
  });
});
