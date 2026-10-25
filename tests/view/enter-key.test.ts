/**
 * `src/view/enter-key.ts`: Return in a dialog's field confirms it once,
 * whether the iPad reports it as a keydown or only as the line break it
 * would type over the selected reading (FineNotes#42).
 */

import { describe, expect, it } from "vitest";
import { onEnterKey } from "../../src/view/enter-key";

/** A field that records cancelled events, driven by hand (no DOM here). */
function field() {
  const target = new EventTarget();
  const cancelled: string[] = [];
  const send = (type: string, props: Record<string, unknown>): void => {
    const event = Object.assign(new Event(type), props, {
      preventDefault: () => cancelled.push(`${type}:${String(props.key ?? props.inputType)}`),
    });
    target.dispatchEvent(event);
  };
  const key = (key: string, more: Record<string, unknown> = {}) =>
    send("keydown", { key, shiftKey: false, isComposing: false, ...more });
  const input = (inputType: string) => send("beforeinput", { inputType });
  return { target, cancelled, key, input };
}

describe("onEnterKey", () => {
  it("confirms on a plain Return and keeps its line break out", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++);
    f.key("Enter");
    // A browser that still sends the line break: cancelled, not a second confirm.
    f.input("insertLineBreak");
    expect(confirmed).toBe(1);
    expect(f.cancelled).toEqual(["keydown:Enter", "beforeinput:insertLineBreak"]);
  });

  it("confirms on the line break of a Return the keyboard reported as composing", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++);
    f.key("Enter", { isComposing: true });
    f.input("insertParagraph");
    expect(confirmed).toBe(1);
    // The line break never replaces the selected text.
    expect(f.cancelled).toEqual(["beforeinput:insertParagraph"]);
  });

  it("confirms on a line break that came with no keydown at all", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++);
    f.input("insertLineBreak");
    expect(confirmed).toBe(1);
  });

  it("leaves typing and an input method's own Return alone", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++);
    f.key("a");
    f.input("insertText");
    f.key("Enter", { isComposing: true });
    f.input("insertCompositionText");
    expect(confirmed).toBe(0);
    expect(f.cancelled).toEqual([]);
  });

  it("types a line break on Shift+Return in a field of several lines", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++, { shiftNewline: true });
    f.key("Enter", { shiftKey: true });
    f.input("insertLineBreak");
    expect(confirmed).toBe(0);
    expect(f.cancelled).toEqual([]);
    // Without Shift it confirms again.
    f.key("Enter");
    expect(confirmed).toBe(1);
  });

  it("leaves a plain Return to a keymap that handles it, and takes the line break", () => {
    const f = field();
    let confirmed = 0;
    onEnterKey(f.target, () => confirmed++, { keydownHandled: true });
    f.key("Enter");
    f.input("insertLineBreak");
    expect(confirmed).toBe(0);
    expect(f.cancelled).toEqual(["beforeinput:insertLineBreak"]);
    f.key("Enter", { isComposing: true });
    f.input("insertLineBreak");
    expect(confirmed).toBe(1);
  });
});
