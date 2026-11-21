/**
 * `src/input/air-button.ts`: the S Pen's side button on a WebView that
 * sends no hovering moves (discussion #209). The sequences are the ones a
 * tester logged on a Tab S10 Ultra (Android 16, WebView 157): 44 s of the
 * button held in the air with no hovering move reaching the page, one
 * `contextmenu`, and only real touches; and, for contrast, the Tab S9 FE of
 * FineNotes#149, whose hovering moves carry the button.
 */

import { describe, expect, it } from "vitest";
import { HOVER_RECENT_MS, HoverWitness } from "../../src/input/air-button";

describe("a WebView that sends no hovering moves (Tab S10 Ultra)", () => {
  for (const pointerType of ["pen", "mouse", ""]) {
    it(`takes the lone contextmenu (pointerType "${pointerType}") for the button in the air`, () => {
      const w = new HoverWitness();
      // The pen wrote a word: presses with pressure, as the tester saw.
      w.down();
      // Then 44 s of the button held, hovering: nothing reaches the page but this.
      expect(w.menu({ pointerType, timeStamp: 50_000, pressing: false })).toBe(true);
      expect(w.summary()).toEqual({
        hoverMoves: 0,
        barrelHoverMoves: 0,
        penDowns: 1,
        menus: 1,
        airMenus: 1,
        bridgeStrokes: 0,
        hover: "none",
      });
    });
  }

  it("never takes a finger's contextmenu, nor one with a press under way", () => {
    const w = new HoverWitness();
    expect(w.menu({ pointerType: "touch", timeStamp: 10, pressing: false })).toBe(false);
    // Chromium's long press, while the pen writes.
    expect(w.menu({ pointerType: "pen", timeStamp: 20, pressing: true })).toBe(false);
    expect(w.summary()).toMatchObject({ menus: 1, airMenus: 0 });
  });

  it("counts the strokes the selection bridge read", () => {
    const w = new HoverWitness();
    w.menu({ pointerType: "pen", timeStamp: 10, pressing: false });
    w.bridgeStroke();
    expect(w.summary()).toMatchObject({ airMenus: 1, bridgeStrokes: 1 });
  });
});

describe("a WebView that does send hovering moves (Tab S9 FE, FineNotes#149)", () => {
  it("leaves the contextmenu of touching down with the button held to the hovering moves", () => {
    const w = new HoverWitness();
    // Hovering, then the button down: its bit in the moves, no pressure.
    w.hover(0, false);
    w.hover(16, true);
    w.hover(32, true);
    // Touching down with it held: a contextmenu alone, just after the moves.
    expect(w.menu({ pointerType: "pen", timeStamp: 60, pressing: false })).toBe(false);
    expect(w.summary()).toMatchObject({
      hoverMoves: 3,
      barrelHoverMoves: 2,
      airMenus: 0,
      hover: "seen",
    });
  });

  it("takes a contextmenu long after the last hovering move for the button in the air", () => {
    const w = new HoverWitness();
    w.hover(0, false);
    expect(w.menu({ pointerType: "pen", timeStamp: HOVER_RECENT_MS - 1, pressing: false })).toBe(
      false,
    );
    expect(w.menu({ pointerType: "pen", timeStamp: HOVER_RECENT_MS + 1, pressing: false })).toBe(
      true,
    );
  });
});
