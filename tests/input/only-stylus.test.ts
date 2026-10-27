import { describe, expect, it } from "vitest";
import { onlyStylusChromeOf } from "../../src/input/only-stylus";

describe("onlyStylusChromeOf", () => {
  it("is off on a fresh vault, with the button and both tools ready for when it is on", () => {
    expect(onlyStylusChromeOf({})).toEqual({
      mode: false,
      button: true,
      hand: true,
      zoom: true,
    });
  });

  it("follows each switch, and reads a missing switch as on", () => {
    expect(
      onlyStylusChromeOf({
        onlyStylusMode: true,
        onlyStylusToolbarButton: false,
        onlyStylusHandTool: false,
        onlyStylusZoomTool: false,
      }),
    ).toEqual({ mode: true, button: false, hand: false, zoom: false });
    expect(
      onlyStylusChromeOf({
        onlyStylusMode: true,
        onlyStylusToolbarButton: undefined,
        onlyStylusHandTool: undefined,
        onlyStylusZoomTool: undefined,
      }),
    ).toEqual({ mode: true, button: true, hand: true, zoom: true });
  });
});
