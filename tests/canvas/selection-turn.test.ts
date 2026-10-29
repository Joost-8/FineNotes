/**
 * `src/canvas/selection-turn.ts` — two fingers turn a lasso selection about
 * its middle (Joost's rule on PR #59: the two-finger gesture only turns),
 * previewed as one motion and committed as one undo step.
 */

import { describe, expect, it } from "vitest";
import {
  TURN_ENGAGE_DEG,
  type TurnMotion,
  fingerTurnMotion,
  fingersOnSelection,
  isStill,
  startFingerTurn,
  stepFingerTurn,
  turnCommand,
  turnFrame,
  turnPoint,
} from "../../src/canvas/selection-turn";
import { TurnSnap } from "../../src/canvas/turn-snap";
import {
  type InkDocument,
  type Stroke,
  type TextBoxElement,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import type { Pt } from "../../src/canvas/lasso";

const DEG = Math.PI / 180;
const free = (raw: number): number => raw;

function expectPoint(actual: Pt, expected: Pt): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe("two fingers turning a selection", () => {
  it("turns it about its middle, and only turns it", () => {
    const t = stepFingerTurn(startFingerTurn({ x: 100, y: 100 }), 30 * DEG);
    const m = fingerTurnMotion(t, free);
    expect(m).toMatchObject({ angle: 30 * DEG, dx: 0, dy: 0 });
    // The middle stays; a point beside it goes round it, at the same distance.
    expectPoint(turnPoint(m, { x: 100, y: 100 }), { x: 100, y: 100 });
    const p = turnPoint(m, { x: 200, y: 100 });
    expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(100, 9);
    expectPoint(p, { x: 100 + 100 * Math.cos(30 * DEG), y: 100 + 100 * Math.sin(30 * DEG) });
  });

  it("keeps the move a finger made before the second one landed", () => {
    const t = stepFingerTurn(startFingerTurn({ x: 0, y: 0 }, { x: 40, y: -10 }), 90 * DEG);
    const m = fingerTurnMotion(t, free);
    // Turned about the middle, then carried where the finger had it.
    expectPoint(turnPoint(m, { x: 10, y: 0 }), { x: 40, y: 0 });
    // Not engaged yet, the move alone.
    expect(fingerTurnMotion(startFingerTurn({ x: 0, y: 0 }, { x: 5, y: 6 }), free)).toMatchObject({
      angle: 0,
      dx: 5,
      dy: 6,
    });
  });

  it("turns nothing until the fingers have turned a few degrees, then stays engaged", () => {
    const start = startFingerTurn({ x: 0, y: 0 });
    const jitter = stepFingerTurn(stepFingerTurn(start, 2 * DEG), 2 * DEG);
    expect(jitter.engaged).toBe(false);
    expect(isStill(fingerTurnMotion(jitter, free))).toBe(true);
    const on = stepFingerTurn(jitter, (TURN_ENGAGE_DEG - 3) * DEG);
    expect(on.engaged).toBe(true);
    expect(stepFingerTurn(on, -10 * DEG).engaged).toBe(true);
    // Not a number: ignored.
    expect(stepFingerTurn(on, NaN)).toBe(on);
  });

  it("is drawn toward the page's 45° steps as the knob is, and lands on them", () => {
    // A shape 2° off level on the page, fingers turned 47°: it lands on 45°.
    const snap = new TurnSnap(100, 2 * DEG);
    const t = stepFingerTurn(startFingerTurn({ x: 0, y: 0 }), 47 * DEG);
    // Shown while turning, it is drawn toward the step; on the lift it lands on it.
    const shown = fingerTurnMotion(t, (raw) => snap.turn(raw));
    expect(shown.angle / DEG).toBeGreaterThan(43);
    expect(shown.angle / DEG).toBeLessThan(47);
    const m = fingerTurnMotion(t, () => snap.settled());
    expect(m.angle / DEG).toBeCloseTo(43, 9);
    expect(snap.pageAngle(m.angle) / DEG).toBeCloseTo(45, 9);
  });

  it("frames the turned selection by its bounds moved, turned about their own middle", () => {
    const bounds = { minX: 100, minY: 100, maxX: 300, maxY: 200 };
    const m: TurnMotion = { anchor: { x: 200, y: 150 }, angle: 40 * DEG, dx: 30, dy: -10 };
    const frame = turnFrame(bounds, m);
    expect(frame).toEqual({ minX: 130, minY: 90, maxX: 330, maxY: 190 });
    // Its corner, turned about its middle, is where the bounds' corner goes.
    const mid = { x: 230, y: 140 };
    const c = Math.cos(m.angle);
    const s = Math.sin(m.angle);
    const x = frame.minX - mid.x;
    const y = frame.minY - mid.y;
    expectPoint(
      { x: mid.x + x * c - y * s, y: mid.y + x * s + y * c },
      turnPoint(m, { x: 100, y: 100 }),
    );
  });

  it("takes fingers that meet over the selection, or near it, and leaves the rest to the page", () => {
    const frame = { minX: 100, minY: 100, maxX: 140, maxY: 120 };
    expect(fingersOnSelection(frame, { x: 120, y: 110 }, 0)).toBe(true);
    expect(fingersOnSelection(frame, { x: 150, y: 110 }, 0)).toBe(false);
    expect(fingersOnSelection(frame, { x: 150, y: 110 }, 12)).toBe(true);
    expect(fingersOnSelection(frame, { x: 120, y: 140 }, 12)).toBe(false);
  });
});

describe("committing a turn", () => {
  function doc(): { d: InkDocument; stroke: Stroke; box: TextBoxElement } {
    const d = emptyDocument();
    const page = blankPage("p1");
    const stroke: Stroke = {
      id: "s1",
      color: "#000",
      size: 2,
      tool: "pen",
      pts: [100.1, 100.3, 0.5, 200.7, 150.9, 0.6, 180.2, 220.4, 0.7],
    };
    const box: TextBoxElement = {
      id: "t1",
      x: 300,
      y: 100,
      w: 100,
      h: 40,
      text: "hi",
      color: "#000",
      fontSize: 20,
    };
    page.strokes.push(stroke);
    page.textBoxes.push(box);
    d.pages = [page];
    return { d, stroke, box };
  }

  it("puts every point where the preview drew it, and undo restores the file exactly", () => {
    const { d, stroke, box } = doc();
    const before = JSON.stringify(d);
    const pts = stroke.pts;
    const m: TurnMotion = { anchor: { x: 150, y: 160 }, angle: 35 * DEG, dx: 40, dy: -25 };
    const command = turnCommand("p1", { strokes: [stroke], images: [], textBoxes: [box] }, m);
    expect(command?.label).toBe("Rotate selection");
    command?.apply(d);
    // A fresh array: the path cache keys on its identity.
    expect(stroke.pts).not.toBe(pts);
    for (let i = 0; i < pts.length; i += 3) {
      expectPoint(
        { x: stroke.pts[i], y: stroke.pts[i + 1] },
        turnPoint(m, { x: pts[i], y: pts[i + 1] }),
      );
      expect(stroke.pts[i + 2]).toBe(pts[i + 2]);
    }
    // Size and font kept; a text box stays upright and only its middle goes round.
    expect(stroke.size).toBe(2);
    expect(box.fontSize).toBe(20);
    expectPoint(
      { x: box.x + box.w / 2, y: box.y + (box.h ?? 0) / 2 },
      turnPoint(m, { x: 350, y: 120 }),
    );
    command?.invert(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("is only the parts used, and nothing for a turn that did nothing", () => {
    const { stroke } = doc();
    const sel = { strokes: [stroke], images: [], textBoxes: [] };
    const at = { x: 0, y: 0 };
    expect(turnCommand("p1", sel, { anchor: at, angle: 0, dx: 0, dy: 0 })).toBeNull();
    expect(turnCommand("p1", sel, { anchor: at, angle: 0, dx: 3, dy: 0 })?.label).toBe(
      "Move selection",
    );
    expect(turnCommand("p1", sel, { anchor: at, angle: 1, dx: 0, dy: 0 })?.label).toBe(
      "Rotate selection",
    );
  });
});
