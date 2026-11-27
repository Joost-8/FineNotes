import { describe, expect, it } from "vitest";
import { BAR_EDGE_HOLD_PX, holdsBarEdge } from "../../src/view/bar-hold-edge";

/** An upright bar 62 px wide down the left of the view, as `.is-upright` draws it. */
const bar = { left: 0, right: 62, top: 40, bottom: 800 };

describe("a finger holds an upright bar by its sides", () => {
  it("within the strip on either long side, over a button's rim or not", () => {
    expect(holdsBarEdge(3, 300, bar, true, "touch")).toBe(true);
    expect(holdsBarEdge(BAR_EDGE_HOLD_PX - 1, 300, bar, true, "touch")).toBe(true);
    expect(holdsBarEdge(62 - 4, 300, bar, true, "touch")).toBe(true);
  });

  it("not on a button's middle: that still drags the tool", () => {
    expect(holdsBarEdge(31, 300, bar, true, "touch")).toBe(false);
    expect(holdsBarEdge(BAR_EDGE_HOLD_PX + 1, 300, bar, true, "touch")).toBe(false);
  });

  it("only for a finger, only upright, only on the bar", () => {
    expect(holdsBarEdge(3, 300, bar, true, "mouse")).toBe(false);
    expect(holdsBarEdge(3, 300, bar, true, "pen")).toBe(false);
    expect(holdsBarEdge(3, 300, bar, false, "touch")).toBe(false);
    expect(holdsBarEdge(3, 900, bar, true, "touch")).toBe(false);
    expect(holdsBarEdge(70, 300, bar, true, "touch")).toBe(false);
  });

  it("never on a bar too narrow to leave its buttons a middle", () => {
    expect(holdsBarEdge(3, 300, { ...bar, right: 20 }, true, "touch")).toBe(false);
  });
});
