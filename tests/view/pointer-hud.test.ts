/** `src/view/pointer-hud.ts` — the pointer lines of the diagnostics HUD. */

import { describe, expect, it } from "vitest";
import { type HudEvent, PointerHud } from "../../src/view/pointer-hud";

function event(partial: Partial<HudEvent>): HudEvent {
  return { type: "move", pointerType: "pen", pressure: 0, coalesced: 0, timeStamp: 0, ...partial };
}

/** A pen stroke: down, three moves 16.6 ms apart at most, up. */
function stroke(hud: PointerHud, t: number): void {
  hud.record(event({ type: "down", pressure: 0.3, timeStamp: t }));
  hud.record(event({ pressure: 0.5, coalesced: 3, timeStamp: t + 8 }));
  hud.record(event({ pressure: 0.8, coalesced: 2, timeStamp: t + 24.6 }));
  hud.record(event({ pressure: 0.6, coalesced: 1, timeStamp: t + 30 }));
  hud.record(event({ type: "up", pressure: 0, timeStamp: t + 40 }));
}

const lines = (hud: PointerHud, committed = 0): string[] => hud.summary(committed).split("\n");

describe("PointerHud", () => {
  it("renders three lines, each with its newline", () => {
    expect(new PointerHud().summary(4)).toBe(
      "\ncur mv=0 pts=0 gap=0ms maxP=0.00\nΣ dn=0 up=0 cx=0 commit=4\n",
    );
  });

  it("logs a stroke with its moves run together", () => {
    const hud = new PointerHud();
    stroke(hud, 100);
    expect(lines(hud, 7)).toEqual([
      "dn m·3 up",
      "cur mv=3 pts=6 gap=17ms maxP=0.80",
      "Σ dn=1 up=1 cx=0 commit=7",
      "",
    ]);
    expect(hud.pointer()).toBe("pen p=0.00");
  });

  it("starts the stroke's numbers afresh at each pen-down, and keeps the totals", () => {
    const hud = new PointerHud();
    stroke(hud, 0);
    hud.record(event({ type: "down", pointerType: "mouse", pressure: 0.5, timeStamp: 1000 }));
    hud.record(event({ type: "cancel", pointerType: "mouse", pressure: 0.25, timeStamp: 1001 }));
    expect(lines(hud)).toEqual([
      "dn m·3 up dn cx",
      "cur mv=0 pts=0 gap=0ms maxP=0.00",
      "Σ dn=2 up=1 cx=1 commit=0",
      "",
    ]);
    expect(hud.pointer()).toBe("mouse p=0.25");
  });

  it("measures the first gap from the pen-down", () => {
    const hud = new PointerHud();
    hud.record(event({ type: "down", timeStamp: 50 }));
    hud.record(event({ coalesced: 2, timeStamp: 90.4 }));
    expect(lines(hud)[1]).toBe("cur mv=1 pts=2 gap=40ms maxP=0.00");
  });

  it("keeps 30 entries", () => {
    const hud = new PointerHud();
    for (let i = 0; i < 11; i++) stroke(hud, i * 100);
    hud.mark("hold");
    const log = lines(hud)[0].split(" ");
    expect(log).toHaveLength(30);
    expect(log[log.length - 1]).toBe("hold");
    expect(log.slice(0, 2)).toEqual(["m·3", "up"]);
  });

  it("puts markers between runs of moves", () => {
    const hud = new PointerHud();
    hud.record(event({ type: "down" }));
    hud.record(event({ timeStamp: 1 }));
    hud.mark("hold");
    hud.record(event({ timeStamp: 2 }));
    hud.record(event({ timeStamp: 3 }));
    expect(lines(hud)[0]).toBe("dn m·1 hold m·2");
  });

  it("restarts the log and totals, not the stroke's numbers or the pointer", () => {
    const hud = new PointerHud();
    stroke(hud, 0);
    hud.restart();
    expect(lines(hud)).toEqual([
      "",
      "cur mv=3 pts=6 gap=17ms maxP=0.80",
      "Σ dn=0 up=0 cx=0 commit=0",
      "",
    ]);
    expect(hud.pointer()).toBe("pen p=0.00");
  });

  it("shows no pointer before any event", () => {
    expect(new PointerHud().pointer()).toBe("- p=0.00");
  });
});
