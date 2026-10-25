/**
 * `src/view/enter-key.ts`: Return in a dialog's field confirms it once,
 * whether the iPad reports it as a keydown, only as the line break it would
 * type over the selected reading, or not until that line break is typed
 * (FineNotes#42).
 */

import { describe, expect, it, vi } from "vitest";
import { onEnterKey } from "../../src/view/enter-key";

/** A field that records cancelled events, driven by hand (no DOM here). */
function field(value = "") {
  const target = Object.assign(new EventTarget(), { value });
  const cancelled: string[] = [];
  const send = (type: string, props: Record<string, unknown>): void => {
    const event = Object.assign(new Event(type), props, {
      preventDefault: () => cancelled.push(`${type}:${String(props.key ?? props.inputType)}`),
    });
    target.dispatchEvent(event);
  };
  const key = (key: string, more: Record<string, unknown> = {}) =>
    send("keydown", { key, shiftKey: false, isComposing: false, ...more });
  const beforeinput = (inputType: string, data: string | null = null) =>
    send("beforeinput", { inputType, data });
  /** The browser changed the text: `to`, reported as `inputType` (none: a script's own event). */
  const input = (to: string, inputType?: string, data: string | null = null) => {
    target.value = to;
    send("input", inputType === undefined ? {} : { inputType, data });
  };
  return { target, cancelled, key, beforeinput, input };
}

describe("onEnterKey", () => {
  it("confirms on a plain Return and keeps its line break out", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++);
    f.key("Enter");
    // A browser that still sends the line break: cancelled, not a second confirm.
    f.beforeinput("insertLineBreak");
    expect(confirmed).toBe(1);
    expect(f.cancelled).toEqual(["keydown:Enter", "beforeinput:insertLineBreak"]);
  });

  it("confirms on the line break of a Return the keyboard reported as composing", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++);
    f.key("Enter", { isComposing: true });
    f.beforeinput("insertParagraph");
    expect(confirmed).toBe(1);
    // The line break never replaces the selected text.
    expect(f.cancelled).toEqual(["beforeinput:insertParagraph"]);
  });

  it("confirms on a line break that came with no keydown at all, or as typed text", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++);
    f.beforeinput("insertLineBreak");
    expect(confirmed).toBe(1);
    const g = field();
    onEnterKey(g.target, () => confirmed++);
    g.beforeinput("insertText", "\n");
    expect(confirmed).toBe(2);
    expect(g.cancelled).toEqual(["beforeinput:insertText"]);
  });

  it("takes back a line break typed anyway over the selected reading, and confirms once", () => {
    // The ✓ in Turn into text (Joost, iPad): the reading selected, then replaced by a line break.
    const f = field();
    let confirmed: string[] = [];
    onEnterKey(f.target, () => confirmed.push(f.target.value), { shiftNewline: true });
    f.input("Buy milk\nand eggs");
    f.key("Enter", { isComposing: true });
    // A beforeinput that could not be cancelled, then the line break in the text.
    f.beforeinput("insertLineBreak");
    f.input("\n", "insertLineBreak");
    expect(confirmed).toEqual(["Buy milk\nand eggs"]);
    expect(f.target.value).toBe("Buy milk\nand eggs");

    // No beforeinput at all, and an input that does not say what it typed.
    const g = field();
    confirmed = [];
    onEnterKey(g.target, () => confirmed.push(g.target.value), { shiftNewline: true });
    g.input("one line");
    g.input("one line\n", "insertText");
    expect(confirmed).toEqual(["one line"]);
    expect(g.target.value).toBe("one line");
  });

  it("brings back the selected word iOS removed before typing the line break (Joost's recording)", () => {
    // "What" selected, iOS offering Wat / Wrat; the ✓ removes it, then types "\n".
    const f = field();
    const confirmed: string[] = [];
    onEnterKey(f.target, () => confirmed.push(f.target.value), { shiftNewline: true });
    f.input("What");
    f.beforeinput("deleteContentBackward");
    f.input("", "deleteContentBackward");
    f.beforeinput("insertLineBreak");
    f.input("\n", "insertLineBreak");
    expect(confirmed).toEqual(["What"]);
    expect(f.target.value).toBe("What");

    // The same with the Return reported as composing first, and the break cancelled.
    const g = field();
    const got: string[] = [];
    onEnterKey(g.target, () => got.push(g.target.value), { shiftNewline: true });
    g.input("What");
    g.key("Enter", { isComposing: true });
    g.input("", "insertReplacementText", "");
    g.beforeinput("insertLineBreak");
    expect(got).toEqual(["What"]);
    expect(g.target.value).toBe("What");
  });

  it("keeps a deletion the user made before pressing Return", () => {
    const f = field();
    const confirmed: string[] = [];
    let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    onEnterKey(f.target, () => confirmed.push(f.target.value));
    f.input("Buy milk", "insertText", "k");
    f.key("Backspace");
    f.input("Buy mil", "deleteContentBackward");
    now += 900;
    f.beforeinput("insertLineBreak");
    expect(confirmed).toEqual(["Buy mil"]);
    clock.mockRestore();
  });

  it("leaves typing, pasted lines, a script's own text and an input method's Return alone", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++, { shiftNewline: true });
    f.key("a");
    f.beforeinput("insertText", "a");
    f.input("a", "insertText", "a");
    f.beforeinput("insertFromPaste");
    f.input("a\nb\nc", "insertFromPaste");
    // The reading filled in by the dialog itself.
    f.input("Buy milk\nand eggs");
    f.key("Enter", { isComposing: true });
    f.beforeinput("insertCompositionText", "é");
    f.input("Buy milk\nand eggsé", "insertCompositionText", "é");
    expect(confirmed).toBe(0);
    expect(f.cancelled).toEqual([]);
    expect(f.target.value).toBe("Buy milk\nand eggsé");
  });

  it("types a line break on Shift+Return in a field of several lines", () => {
    const f = field("one");
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++, { shiftNewline: true });
    f.key("Enter", { shiftKey: true });
    f.beforeinput("insertLineBreak");
    f.input("one\n", "insertLineBreak");
    expect(confirmed).toBe(0);
    expect(f.cancelled).toEqual([]);
    expect(f.target.value).toBe("one\n");
    // Without Shift it confirms again.
    f.key("Enter");
    expect(confirmed).toBe(1);
  });

  it("confirms a second Return in a field that stays open, once typing came between", () => {
    const f = field("2");
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++);
    f.key("Enter");
    f.input("2.5", "insertText", ".5");
    f.beforeinput("insertLineBreak");
    expect(confirmed).toBe(2);
  });

  it("leaves a plain Return to a keymap that handles it, and takes the line break", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++, { keydownHandled: true });
    f.key("Enter");
    f.beforeinput("insertLineBreak");
    expect(confirmed).toBe(0);
    expect(f.cancelled).toEqual(["beforeinput:insertLineBreak"]);
    f.key("Enter", { isComposing: true });
    f.beforeinput("insertLineBreak");
    expect(confirmed).toBe(1);
  });
});
