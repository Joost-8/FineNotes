import { describe, expect, it } from "vitest";
import { BULLET, continueList, listKindOf, toggleList } from "../../src/model/text-list";

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
