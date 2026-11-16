import { describe, expect, it } from "vitest";
import { KEY_LOG_MAX, KeyLog, keyName } from "../../src/model/key-log";

describe("keyName (FineNotes#226)", () => {
  it("names letters, digits and named keys, never other text", () => {
    expect(keyName("P", "KeyP", false)).toBe("p");
    expect(keyName("7", "Digit7", false)).toBe("7");
    expect(keyName(" ", "Space", false)).toBe("Space");
    expect(keyName("Escape", "Escape", false)).toBe("Escape");
    expect(keyName("é", "KeyE", false)).toBe("sym");
    expect(keyName("ح", "KeyP", false)).toBe("sym");
  });

  it("names an iPad key with no key by its code, and marks a repeat", () => {
    expect(keyName("Unidentified", "KeyL", false)).toBe("?KeyL");
    expect(keyName("Process", "", false)).toBe("?-");
    expect(keyName("l", "KeyL", true)).toBe("l*");
  });
});

describe("KeyLog (FineNotes#226)", () => {
  it("counts each verdict and lists the keys in order", () => {
    const log = new KeyLog();
    log.note("p", "taken");
    log.note("l", "unheard");
    log.note("p", "taken");
    expect(log.report()).toEqual({
      seen: 3,
      verdicts: { taken: 2, unheard: 1 },
      recent: ["p:taken", "l:unheard", "p:taken"],
    });
  });

  it("never keeps a key typed into a field", () => {
    const log = new KeyLog();
    log.note("a", "field");
    log.note("b", "composing");
    expect(log.report().recent).toEqual([":field", ":composing"]);
    expect(log.report().verdicts).toEqual({ field: 1, composing: 1 });
  });

  it("keeps only the latest keys but counts them all", () => {
    const log = new KeyLog();
    for (let i = 0; i < KEY_LOG_MAX + 5; i++) log.note(String(i % 10), "unbound");
    const report = log.report();
    expect(report.seen).toBe(KEY_LOG_MAX + 5);
    expect(report.recent).toHaveLength(KEY_LOG_MAX);
    expect(report.recent[0]).toBe("5:unbound");
  });

  it("puts the counts and the last keys on one HUD line", () => {
    const log = new KeyLog();
    expect(log.hudLine()).toBe("keys 0");
    log.note("h", "taken");
    log.note("l", "modal");
    expect(log.hudLine()).toBe("keys 2 taken=1 modal=1 | h:taken l:modal");
  });

  it("hands out copies", () => {
    const log = new KeyLog();
    log.note("p", "taken");
    const report = log.report();
    report.recent.push("x");
    report.verdicts.taken = 9;
    expect(log.report()).toEqual({ seen: 1, verdicts: { taken: 1 }, recent: ["p:taken"] });
  });
});
