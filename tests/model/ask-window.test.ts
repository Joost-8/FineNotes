import { describe, expect, it } from "vitest";
import {
  ASK_WINDOW_MIN,
  defaultAskWindowPlace,
  parseAskWindowPlace,
} from "../../src/model/ask-window";

describe("the Ask AI window", () => {
  it("first opens along the right, under the bar", () => {
    expect(defaultAskWindowPlace({ w: 1366, h: 1024 })).toEqual({ x: 910, y: 72, w: 440, h: 640 });
  });

  it("fits a narrow view, never under its smallest size", () => {
    const place = defaultAskWindowPlace({ w: 320, h: 400 });
    expect(place.w).toBe(ASK_WINDOW_MIN.w);
    expect(place.h).toBe(ASK_WINDOW_MIN.h);
    expect(place.x).toBeGreaterThanOrEqual(0);
  });

  it("reads back the place it kept", () => {
    const place = { x: 10, y: 20, w: 400, h: 500 };
    expect(parseAskWindowPlace(JSON.stringify(place))).toEqual(place);
    expect(parseAskWindowPlace(JSON.stringify({ ...place, minimised: true }))).toEqual(place);
  });

  it("refuses anything else", () => {
    expect(parseAskWindowPlace(null)).toBeNull();
    expect(parseAskWindowPlace(42)).toBeNull();
    expect(parseAskWindowPlace("{")).toBeNull();
    expect(parseAskWindowPlace("null")).toBeNull();
    expect(parseAskWindowPlace(JSON.stringify({ x: 1, y: 2, w: 0, h: 5 }))).toBeNull();
    expect(parseAskWindowPlace(JSON.stringify({ x: 1, y: 2, w: 5, h: -1 }))).toBeNull();
    expect(parseAskWindowPlace(JSON.stringify({ x: "1", y: 2, w: 5, h: 5 }))).toBeNull();
  });
});
