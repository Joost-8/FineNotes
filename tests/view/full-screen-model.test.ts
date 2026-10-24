import { describe, expect, it } from "vitest";
import {
  fullScreenGroups,
  parseFullScreen,
  storedFullScreen,
} from "../../src/view/full-screen-model";

describe("fullScreenGroups", () => {
  it("takes the groups whose tab in front is a notebook", () => {
    const groups = fullScreenGroups(true, [
      { group: "left", shown: true },
      { group: "right", shown: false },
    ]);
    expect([...groups]).toEqual(["left"]);
  });

  it("keeps a group once when two notebooks share it", () => {
    const groups = fullScreenGroups(true, [
      { group: "main", shown: false },
      { group: "main", shown: true },
    ]);
    expect([...groups]).toEqual(["main"]);
  });

  it("takes nothing while full screen is off", () => {
    expect(fullScreenGroups(false, [{ group: "main", shown: true }]).size).toBe(0);
  });

  it("takes nothing without a notebook in front", () => {
    expect(fullScreenGroups(true, []).size).toBe(0);
    expect(fullScreenGroups(true, [{ group: "main", shown: false }]).size).toBe(0);
  });
});

describe("stored full screen", () => {
  it("round-trips", () => {
    expect(parseFullScreen(storedFullScreen(true))).toBe(true);
    expect(parseFullScreen(storedFullScreen(false))).toBe(false);
  });

  it("is off for anything it did not write", () => {
    for (const raw of [null, undefined, "", "true", 1, true, "0"]) {
      expect(parseFullScreen(raw)).toBe(false);
    }
  });
});
