/**
 * Earned hints: after something was done the slow way a few times by
 * someone who has never done it the fast way, one line says the fast way
 * exists. PURE.
 *
 * The rules that keep it from nagging: each hint is shown once, ever; at
 * most one hint a day; never once the fast way was used; and a gesture of
 * the fingers is only offered where there is a touch screen. What was used
 * is counted on this device alone and never sent anywhere; switching the
 * hints off forgets the counts.
 */

import type { TextKey } from "../i18n/translate";

/** Things counted: each slow way, and the fast way that replaces it. */
export const NUDGE_EVENTS = [
  "undo.button",
  "undo.gesture",
  "redo.button",
  "redo.gesture",
  "erase.lasso",
  "erase.scribble",
  "lasso.tool",
  "lasso.circle",
  "shape.tool",
  "shape.hold",
  "page.button",
  "page.pull",
] as const;

export type NudgeEvent = (typeof NUDGE_EVENTS)[number];

export interface NudgeRule {
  /** The tip it opens (a feature id in feature-index.ts); also what "shown" remembers. */
  id: string;
  slow: NudgeEvent;
  fast: NudgeEvent;
  /** How many times the slow way, before the hint. */
  after: number;
  /** A gesture of the fingers: only where there is a touch screen. */
  touch: boolean;
  text: TextKey;
}

export const NUDGE_RULES: readonly NudgeRule[] = [
  {
    id: "undo",
    slow: "undo.button",
    fast: "undo.gesture",
    after: 5,
    touch: true,
    text: "notebooks.nudge.undo",
  },
  {
    id: "redoThree",
    slow: "redo.button",
    fast: "redo.gesture",
    after: 3,
    touch: true,
    text: "notebooks.nudge.redoThree",
  },
  {
    id: "scribble",
    slow: "erase.lasso",
    fast: "erase.scribble",
    after: 3,
    touch: false,
    text: "notebooks.nudge.scribble",
  },
  {
    id: "circleLasso",
    slow: "lasso.tool",
    fast: "lasso.circle",
    after: 5,
    touch: false,
    text: "notebooks.nudge.circleLasso",
  },
  {
    id: "hold",
    slow: "shape.tool",
    fast: "shape.hold",
    after: 3,
    touch: false,
    text: "notebooks.nudge.hold",
  },
  {
    id: "pullPage",
    slow: "page.button",
    fast: "page.pull",
    after: 3,
    touch: true,
    text: "notebooks.nudge.pullPage",
  },
];

export interface NudgeState {
  counts: Partial<Record<NudgeEvent, number>>;
  /** Rules whose hint was shown. */
  shown: string[];
  /** The day (YYYY-MM-DD, local) a hint was last shown. */
  lastDay: string;
}

export function emptyNudges(): NudgeState {
  return { counts: {}, shown: [], lastDay: "" };
}

/** A count stops here: it only has to pass a rule's `after`. */
const COUNT_CAP = 99;

/** The state with one more `event`. */
export function recordUse(state: NudgeState, event: NudgeEvent): NudgeState {
  const count = Math.min(COUNT_CAP, (state.counts[event] ?? 0) + 1);
  return { ...state, counts: { ...state.counts, [event]: count } };
}

/**
 * The hint that `event` (just counted into `state`) has earned, or null.
 * Only the slow way of a rule earns its hint, so a hint always follows the
 * thing it is about.
 */
export function dueNudge(
  state: NudgeState,
  event: NudgeEvent,
  now: { day: string; touch: boolean },
  rules: readonly NudgeRule[] = NUDGE_RULES,
): NudgeRule | null {
  if (state.lastDay === now.day) return null;
  for (const rule of rules) {
    if (rule.slow !== event) continue;
    if (rule.touch && !now.touch) continue;
    if (state.shown.includes(rule.id)) continue;
    if ((state.counts[rule.fast] ?? 0) > 0) continue;
    if ((state.counts[rule.slow] ?? 0) >= rule.after) return rule;
  }
  return null;
}

/** The state after `rule`'s hint was shown on `day`. */
export function markShown(state: NudgeState, rule: NudgeRule, day: string): NudgeState {
  return { ...state, shown: [...state.shown, rule.id], lastDay: day };
}

/** A local day as the state keeps it. */
export function dayOf(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** What was stored, read back; anything else is an empty state. */
export function parseNudges(raw: unknown): NudgeState {
  if (typeof raw !== "object" || raw === null) return emptyNudges();
  const record = raw as Record<string, unknown>;
  const counts: Partial<Record<NudgeEvent, number>> = {};
  const stored = record.counts;
  if (typeof stored === "object" && stored !== null) {
    for (const event of NUDGE_EVENTS) {
      const value = (stored as Record<string, unknown>)[event];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        counts[event] = Math.min(COUNT_CAP, Math.floor(value));
      }
    }
  }
  const shown = Array.isArray(record.shown)
    ? record.shown.filter((id): id is string => typeof id === "string")
    : [];
  const lastDay = typeof record.lastDay === "string" ? record.lastDay : "";
  return { counts, shown, lastDay };
}
