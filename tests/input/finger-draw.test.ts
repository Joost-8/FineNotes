import { describe, expect, it } from "vitest";
import {
  FINGER_JOIN_MS,
  endsFingerDrawing,
  fingerDrawRole,
  fingerWrites,
} from "../../src/input/finger-draw";

const none = { waiting: false, gesture: false, stroke: false };

describe("fingerDrawRole", () => {
  it("holds a lone finger back until it writes or a second joins", () => {
    expect(fingerDrawRole(none)).toBe("wait");
  });

  it("pairs a second finger with a waiting one: the two pan and pinch", () => {
    expect(fingerDrawRole({ ...none, waiting: true })).toBe("pair");
  });

  it("gives a finger to a pan or pinch already under way, never the pen's role", () => {
    expect(fingerDrawRole({ ...none, gesture: true })).toBe("finger");
  });

  it("leaves out a touch beside a finger that writes: the hand, or a palm", () => {
    expect(fingerDrawRole({ ...none, stroke: true })).toBe("ignore");
  });

  it("a palm landing alone writes, as any finger would: palm rejection is off", () => {
    // Nothing tells a palm from a finger; it waits and then writes like one.
    expect(fingerDrawRole(none)).toBe("wait");
    expect(fingerWrites(FINGER_JOIN_MS, false)).toBe(true);
  });
});

describe("fingerWrites", () => {
  it("waits while a second finger may still come", () => {
    expect(fingerWrites(0, false)).toBe(false);
    expect(fingerWrites(FINGER_JOIN_MS - 1, false)).toBe(false);
  });

  it("writes once the wait is over", () => {
    expect(fingerWrites(FINGER_JOIN_MS, false)).toBe(true);
    expect(fingerWrites(5000, false)).toBe(true);
  });

  it("writes at once when the finger lifts first: a tap", () => {
    expect(fingerWrites(0, true)).toBe(true);
  });
});

describe("endsFingerDrawing", () => {
  it("is ended by any pen event, and by nothing else", () => {
    expect(endsFingerDrawing("pen")).toBe(true);
    expect(endsFingerDrawing("touch")).toBe(false);
    expect(endsFingerDrawing("mouse")).toBe(false);
    expect(endsFingerDrawing("")).toBe(false);
  });
});
