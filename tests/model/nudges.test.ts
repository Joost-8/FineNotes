import { describe, expect, it } from "vitest";
import { EN } from "../../src/i18n/en";
import { featureById } from "../../src/model/feature-index";
import {
  NUDGE_RULES,
  type NudgeEvent,
  type NudgeState,
  dayOf,
  dueNudge,
  emptyNudges,
  markShown,
  parseNudges,
  recordUse,
} from "../../src/model/nudges";

const english: Record<string, string> = EN;
const touch = { day: "2026-11-12", touch: true };

function after(times: number, event: NudgeEvent, from: NudgeState = emptyNudges()): NudgeState {
  let state = from;
  for (let i = 0; i < times; i += 1) state = recordUse(state, event);
  return state;
}

describe("nudge rules", () => {
  it("each open a tip that exists and say a line that exists", () => {
    for (const rule of NUDGE_RULES) {
      expect(featureById(rule.id)?.tip, rule.id).toBeTruthy();
      expect(english[rule.text], rule.id).toBeTruthy();
    }
    expect(new Set(NUDGE_RULES.map((rule) => rule.id)).size).toBe(NUDGE_RULES.length);
  });
});

describe("dueNudge", () => {
  it("waits for the slow way to be used often enough", () => {
    expect(dueNudge(after(4, "undo.button"), "undo.button", touch)).toBeNull();
    expect(dueNudge(after(5, "undo.button"), "undo.button", touch)?.id).toBe("undo");
  });

  it("never tells someone who has used the fast way", () => {
    const state = recordUse(after(9, "undo.button"), "undo.gesture");
    expect(dueNudge(state, "undo.button", touch)).toBeNull();
  });

  it("shows a hint once, ever", () => {
    const rule = NUDGE_RULES[0];
    const state = markShown(after(5, "undo.button"), rule, "2026-11-01");
    expect(dueNudge(after(5, "undo.button", state), "undo.button", touch)).toBeNull();
  });

  it("shows at most one hint a day", () => {
    const rule = NUDGE_RULES[0];
    const today = markShown(after(3, "erase.lasso"), rule, touch.day);
    expect(dueNudge(today, "erase.lasso", touch)).toBeNull();
    const tomorrow = { ...touch, day: "2026-11-13" };
    expect(dueNudge(today, "erase.lasso", tomorrow)?.id).toBe("scribble");
  });

  it("keeps finger gestures to touch screens", () => {
    const mouse = { day: touch.day, touch: false };
    expect(dueNudge(after(5, "undo.button"), "undo.button", mouse)).toBeNull();
    // Scribbling works with a mouse too.
    expect(dueNudge(after(3, "erase.lasso"), "erase.lasso", mouse)?.id).toBe("scribble");
  });

  it("only speaks right after the slow way it is about", () => {
    expect(dueNudge(after(5, "undo.button"), "page.button", touch)).toBeNull();
    expect(dueNudge(after(5, "undo.button"), "undo.gesture", touch)).toBeNull();
  });
});

describe("the stored state", () => {
  it("survives a round trip through JSON", () => {
    const state = markShown(after(5, "undo.button"), NUDGE_RULES[0], "2026-11-12");
    expect(parseNudges(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("reads anything else as empty, and drops what it does not know", () => {
    expect(parseNudges(null)).toEqual(emptyNudges());
    expect(parseNudges("x")).toEqual(emptyNudges());
    expect(
      parseNudges({
        counts: { "undo.button": 2.7, toString: 4, "redo.button": -1 },
        shown: [1, "a"],
      }),
    ).toEqual({ counts: { "undo.button": 2 }, shown: ["a"], lastDay: "" });
  });

  it("stops counting at a cap", () => {
    expect(after(500, "undo.button").counts["undo.button"]).toBe(99);
  });

  it("names a local day", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
