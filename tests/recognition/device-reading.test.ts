/**
 * `src/recognition/device-reading.ts`: which page the on-device recogniser
 * reads next for search and the text layer.
 */

import { describe, expect, it } from "vitest";
import { type Page, type Stroke, blankPage } from "../../src/model/document";
import {
  type DeviceReadingState,
  hasReadableInk,
  nextDeviceStep,
} from "../../src/recognition/device-reading";

const ink = (id: string, tool: Stroke["tool"] = "pen"): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool,
  pts: [0, 0, 0.5, 10, 10, 0.5],
});

function pages(): Page[] {
  const list = [blankPage("p1"), blankPage("p2"), blankPage("p3")];
  list[0].strokes = [ink("a")];
  list[1].strokes = [ink("b")];
  list[2].strokes = [ink("h", "highlighter")];
  return list;
}

function state(over: Partial<DeviceReadingState> = {}): DeviceReadingState {
  const list = over.pages ?? pages();
  return {
    pages: list,
    keys: list.map((p) => p.id),
    entries: new Map(),
    hashOf: (page) => `h-${page.id}-${page.strokes.length}`,
    read: new Map(),
    current: 0,
    ...over,
  };
}

const step = (s: DeviceReadingState) => {
  const next = nextDeviceStep(s);
  return next ? `${next.kind}:${next.key}` : null;
};

describe("hasReadableInk", () => {
  it("counts pen ink and shapes, not highlighter", () => {
    const [a, , h] = pages();
    expect(hasReadableInk(a)).toBe(true);
    expect(hasReadableInk(h)).toBe(false);
    expect(hasReadableInk(blankPage("x"))).toBe(false);
  });
});

describe("nextDeviceStep", () => {
  it("reads the page being read first, then the rest in order", () => {
    expect(step(state({ current: 1 }))).toBe("read:p2");
    expect(step(state())).toBe("read:p1");
  });

  it("skips a page it was told to, until the page changes", () => {
    const skip = new Map([["p1", "h-p1-1"]]);
    expect(step(state({ skip }))).toBe("read:p2");
    expect(step(state({ skip: new Map([["p1", "earlier"]]) }))).toBe("read:p1");
  });

  it("leaves a transcribed page alone, current or not", () => {
    const entries = new Map([
      ["p1", { hash: "old", device: false }],
      ["p2", { hash: "h-p2-1", device: false }],
    ]);
    expect(step(state({ entries }))).toBeNull();
  });

  it("reads a page again when its device reading is out of date", () => {
    const entries = new Map([
      ["p1", { hash: "h-p1-1", device: true }],
      ["p2", { hash: "before", device: true }],
    ]);
    expect(step(state({ entries }))).toBe("read:p2");
  });

  it("skips a page read already at this hash, even when the reading was empty", () => {
    const read = new Map([
      ["p1", "h-p1-1"],
      ["p2", "h-p2-1"],
    ]);
    expect(step(state({ read }))).toBeNull();
  });

  it("clears a device reading whose ink has gone, and ignores empty pages otherwise", () => {
    const entries = new Map([["p3", { hash: "x", device: true }]]);
    const read = new Map([
      ["p1", "h-p1-1"],
      ["p2", "h-p2-1"],
    ]);
    expect(step(state({ entries, read }))).toBe("clear:p3");
    expect(step(state({ read }))).toBeNull();
  });

  it("hands back the page, its key and its hash", () => {
    const next = nextDeviceStep(state());
    expect(next).toMatchObject({ kind: "read", key: "p1", hash: "h-p1-1" });
  });
});

describe("drawings", () => {
  it("a page with only snapped shapes has nothing to read", () => {
    const page = blankPage("p9");
    page.strokes = [{ ...ink("box"), shape: "rect" }];
    expect(hasReadableInk(page)).toBe(false);
  });
});
