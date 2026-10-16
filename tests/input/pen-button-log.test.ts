/** `src/input/pen-button-log.ts` — what a pen's buttons send, for the HUD and the export. */

import { describe, expect, it } from "vitest";
import { type ButtonEventInput, PenButtonLog, entryText } from "../../src/input/pen-button-log";

function pen(type: string, button: number, buttons: number, timeStamp = 0): ButtonEventInput {
  return { type, pointerType: "pen", button, buttons, timeStamp };
}

describe("PenButtonLog", () => {
  it("shows a dash before any pen event", () => {
    expect(new PenButtonLog().line()).toBe("btn -");
    expect(new PenButtonLog().entries()).toEqual([]);
  });

  it("runs alike moves together and starts a new entry when the buttons change", () => {
    const log = new PenButtonLog();
    log.record(pen("pointermove", -1, 0, 1));
    log.record(pen("pointermove", -1, 0, 2));
    // The barrel pressed while hovering: a pointerdown with button 2.
    log.record(pen("pointerdown", 2, 2, 3));
    log.record(pen("pointermove", -1, 2, 4));
    // The pen touches with the barrel held: a move with the contact bit added.
    log.record(pen("pointermove", -1, 3, 5));
    log.record(pen("pointermove", -1, 3, 6));
    log.record(pen("pointermove", -1, 3, 7));
    log.record(pen("pointerup", 2, 0, 8));
    expect(log.line()).toBe(
      "btn hv b-1 bs0 ×2 · dn b2 bs2 · hv b-1 bs2 · mv b-1 bs3 ×3 · up b2 bs0",
    );
    expect(log.entries()[0]).toEqual({ ev: "hv", b: -1, bs: 0, pt: "pen", n: 2, t: 1 });
  });

  it("keeps every down and up, alike or not", () => {
    const log = new PenButtonLog();
    log.record(pen("pointerdown", 0, 1));
    log.record(pen("pointerdown", 0, 1));
    expect(log.entries().map((e) => e.n)).toEqual([1, 1]);
  });

  it("keeps a pen's comings and goings, and its cancels", () => {
    const log = new PenButtonLog();
    for (const type of [
      "pointerover",
      "pointerenter",
      "pointercancel",
      "pointerout",
      "pointerleave",
    ])
      log.record(pen(type, -1, 0));
    expect(log.entries().map((e) => e.ev)).toEqual(["in", "in", "cx", "out", "out"]);
  });

  it("leaves out fingers, mice and events it does not know", () => {
    const log = new PenButtonLog();
    log.record({ ...pen("pointerdown", 0, 1), pointerType: "touch" });
    log.record({ ...pen("pointerdown", 2, 2), pointerType: "mouse" });
    log.record(pen("gotpointercapture", 0, 1));
    expect(log.entries()).toEqual([]);
  });

  it("keeps a right-click menu from any pointer, since a driver may send the barrel as one", () => {
    const log = new PenButtonLog();
    log.record({ type: "contextmenu", pointerType: "", button: 2, buttons: 0, timeStamp: 0 });
    log.record({ type: "auxclick", pointerType: "mouse", button: 1, buttons: 0, timeStamp: 0 });
    expect(log.line()).toBe("btn menu b2 bs0 · aux b1 bs0");
    expect(log.entries().map((e) => e.pt)).toEqual(["", "mouse"]);
  });

  it("keeps keys, since some pens send their buttons as key presses", () => {
    const log = new PenButtonLog();
    log.key({ type: "keydown", key: "PageDown", code: "PageDown", timeStamp: 5 });
    log.key({ type: "keyup", key: "PageDown", code: "PageDown", timeStamp: 6 });
    expect(log.line()).toBe("btn key PageDown/PageDown · keyup PageDown/PageDown");
    // A key never swallows the move after it.
    log.record(pen("pointermove", -1, 0));
    log.record(pen("pointermove", -1, 0));
    expect(log.entries().slice(-1)[0]).toMatchObject({ ev: "hv", n: 2 });
  });

  it("shows only the latest six on the HUD, keeps forty, and empties on restart", () => {
    const log = new PenButtonLog();
    for (let i = 0; i < 50; i++) log.record(pen("pointerdown", 0, 1, i));
    expect(log.entries()).toHaveLength(40);
    expect(log.entries()[0]!.t).toBe(10);
    expect(log.line().split(" · ")).toHaveLength(6);
    log.restart();
    expect(log.line()).toBe("btn -");
  });

  it("hands out copies, so the export cannot change the log", () => {
    const log = new PenButtonLog();
    log.record(pen("pointermove", -1, 0));
    log.entries()[0]!.n = 99;
    expect(log.entries()[0]!.n).toBe(1);
  });
});

describe("entryText", () => {
  it("names an entry, with its count when there is more than one", () => {
    expect(entryText({ ev: "dn", b: 2, bs: 3, n: 1, t: 0 })).toBe("dn b2 bs3");
    expect(entryText({ ev: "hv", b: -1, bs: 4, n: 14, t: 0 })).toBe("hv b-1 bs4 ×14");
  });
});
