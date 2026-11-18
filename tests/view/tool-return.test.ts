import { describe, expect, it } from "vitest";
import type { ActiveTool } from "../../src/view/toolbar";
import { REJOIN_MS, REJOIN_PX } from "../../src/input/pen-rejoin";
import {
  continuesUse,
  drawingToolOf,
  eraserClickStep,
  optionsAfterSwitch,
  selectedTool,
  keyPenTarget,
  shortcutPenType,
  toolAfterUse,
  PEN_OPTIONS_RETURN_MS,
  penOptionsOnWriteOf,
  returnsAfterLift,
  tucksOnWrite,
  type ToolUse,
} from "../../src/view/tool-return";

const tools: ActiveTool[] = ["pen", "highlighter", "eraser", "select", "text", "shape"];
describe("optional tool return", () => {
  it.each(tools)("preserves %s by default and never toggles pen types", (tool) => {
    expect(selectedTool(tool, tool, false)).toBe(tool);
    expect(selectedTool("pen", tool, true)).toBe(tool);
    expect(selectedTool(tool, tool, true)).toBe(
      ["pen", "highlighter"].includes(tool) ? tool : "pen",
    );
  });
  it.each(tools)("returns %s only when its full use finishes", (tool) => {
    for (const use of ["gesture", "text", "selection"] as ToolUse[]) {
      expect(toolAfterUse(tool, use, false)).toBe(tool);
      const done =
        (use === "gesture" && ["eraser", "shape"].includes(tool)) ||
        (use === "text" && tool === "text") ||
        (use === "selection" && tool === "select");
      expect(toolAfterUse(tool, use, true)).toBe(done ? "pen" : tool);
    }
  });
  it("waits for a pen-down that lands soon and close to the lift, and only that", () => {
    const lift = { t: 1000, x: 200, y: 300 };
    expect(continuesUse(lift, 1020, 202, 301, REJOIN_PX)).toBe(true);
    expect(continuesUse(lift, 1000 + REJOIN_MS, 200 + REJOIN_PX, 300, REJOIN_PX)).toBe(true);
    expect(continuesUse(lift, 1001 + REJOIN_MS, 200, 300, REJOIN_PX)).toBe(false);
    expect(continuesUse(lift, 1020, 200 + REJOIN_PX + 1, 300, REJOIN_PX)).toBe(false);
    // A clock that ran backwards, or a cancel with no position, never continues.
    expect(continuesUse(lift, 990, 200, 300, REJOIN_PX)).toBe(false);
    expect(continuesUse({ t: 1000, x: NaN, y: NaN }, 1010, 200, 300, REJOIN_PX)).toBe(false);
  });
  it("goes back to the highlighter when that was the drawing tool before", () => {
    expect(drawingToolOf("pen", "highlighter")).toBe("highlighter");
    expect(drawingToolOf("highlighter", "eraser")).toBe("highlighter");
    expect(drawingToolOf("highlighter", "pen")).toBe("pen");
    // Only a pen or the highlighter is ever gone back to.
    expect(drawingToolOf("eraser", "text")).toBe("pen");
    expect(selectedTool("eraser", "eraser", true, "highlighter")).toBe("highlighter");
    expect(selectedTool("eraser", "eraser", false, "highlighter")).toBe("eraser");
    expect(selectedTool("eraser", "shape", true, "highlighter")).toBe("shape");
    expect(toolAfterUse("shape", "gesture", true, "highlighter")).toBe("highlighter");
    expect(toolAfterUse("text", "text", true, "highlighter")).toBe("highlighter");
    expect(toolAfterUse("select", "selection", true, "select")).toBe("pen");
    expect(toolAfterUse("pen", "gesture", true, "highlighter")).toBe("pen");
  });
});

describe("the side button's click set to the eraser", () => {
  it("takes the eraser and remembers the tool it left", () => {
    expect(eraserClickStep("pen", null, "pen")).toEqual({ tool: "eraser", back: "pen" });
    expect(eraserClickStep("select", null, "pen")).toEqual({ tool: "eraser", back: "select" });
  });

  it("goes back to that tool on the next click", () => {
    expect(eraserClickStep("eraser", "select", "pen")).toEqual({ tool: "select", back: null });
  });

  it("goes back to the drawing tool from an eraser picked by hand", () => {
    expect(eraserClickStep("eraser", null, "highlighter")).toEqual({
      tool: "highlighter",
      back: null,
    });
    expect(eraserClickStep("eraser", null, "select")).toEqual({ tool: "pen", back: null });
  });
});

describe("first tap selects, second tap opens options", () => {
  it("never opens a pill on a tool switch", () => {
    expect(optionsAfterSwitch(false, true, false)).toBe(false);
    expect(optionsAfterSwitch(false, false, false)).toBe(false);
  });
  it("keeps a showing pill showing, unless the next tool was left tucked", () => {
    expect(optionsAfterSwitch(true, true, false)).toBe(true);
    expect(optionsAfterSwitch(true, false, false)).toBe(false);
  });
  it("shows the remembered pill when the second tap returns to the pen", () => {
    expect(optionsAfterSwitch(false, true, true)).toBe(true);
    expect(optionsAfterSwitch(false, false, true)).toBe(false);
  });
});

describe("hide pen options while writing", () => {
  it("tucks the pill when the pen or the highlighter starts writing", () => {
    expect(tucksOnWrite(true, "pen", false)).toBe(true);
    expect(tucksOnWrite(true, "highlighter", false)).toBe(true);
  });
  it("leaves every other tool's pill alone", () => {
    for (const tool of ["eraser", "select", "text", "shape", "laser"] as ActiveTool[]) {
      expect(tucksOnWrite(true, tool, false)).toBe(false);
    }
  });
  it("leaves it alone for a tool the stylus button or a key lent", () => {
    expect(tucksOnWrite(true, "eraser", true)).toBe(false);
    expect(tucksOnWrite(true, "select", true)).toBe(false);
    expect(tucksOnWrite(true, "pen", true)).toBe(false);
  });
  it("does nothing while the setting is off, or holds something it does not know", () => {
    for (const off of ["off", false, undefined, null, "true", 1, "until-forever"]) {
      expect(tucksOnWrite(off, "pen", false)).toBe(false);
    }
  });
  it("tucks for both of its hiding choices", () => {
    expect(tucksOnWrite("until-tap", "pen", false)).toBe(true);
    expect(tucksOnWrite("until-lift", "highlighter", false)).toBe(true);
  });
  it("reads the switch it was before as until tapped", () => {
    expect(penOptionsOnWriteOf(true)).toBe("until-tap");
    expect(penOptionsOnWriteOf(false)).toBe("off");
    expect(penOptionsOnWriteOf("until-lift")).toBe("until-lift");
    expect(penOptionsOnWriteOf("UNTIL-LIFT")).toBe("off");
  });
  it("brings the options back after the pen rests only with until the pen lifts", () => {
    expect(returnsAfterLift("until-lift")).toBe(true);
    for (const mode of ["until-tap", "off", true, undefined]) {
      expect(returnsAfterLift(mode)).toBe(false);
    }
    // Longer than the gap between written words, short enough to feel prompt.
    expect(PEN_OPTIONS_RETURN_MS).toBe(1000);
  });
});

describe("shortcutPenType (FineNotes#226)", () => {
  const order = ["fountain", "ball", "brush", "calligraphy", "highlighter"] as const;

  it("H is always the highlighter", () => {
    expect(shortcutPenType("highlighter", "ball", [], order)).toBe("highlighter");
    expect(shortcutPenType("highlighter", "highlighter", ["ball"], order)).toBe("highlighter");
  });

  it("P keeps the pen in hand", () => {
    expect(shortcutPenType("pen", "ball", ["highlighter"], order)).toBe("ball");
    expect(shortcutPenType("pen", "brush", [], order)).toBe("brush");
  });

  it("P from the highlighter is the pen used last, not the highlighter again", () => {
    expect(shortcutPenType("pen", "highlighter", ["highlighter", "ball", "fountain"], order)).toBe(
      "ball",
    );
  });

  it("P from the highlighter with no pen used yet is the row's first pen", () => {
    expect(shortcutPenType("pen", "highlighter", [], ["highlighter", "brush", "fountain"])).toBe(
      "brush",
    );
    expect(shortcutPenType("pen", "highlighter", [], ["highlighter"])).toBe("fountain");
  });
});

describe("keyPenTarget: a pen key presses the button its pen has (FineNotes#226, #211)", () => {
  const bar = ["saved:red", "pen:highlighter"] as const;
  const none: readonly never[] = [];

  it("a saved pen's key presses its own button when it is pinned", () => {
    expect(keyPenTarget({ saved: "red" }, "eraser", bar, null, "main")).toBe("saved:red");
    expect(keyPenTarget({ saved: "red" }, "pen", bar, null, "main")).toBe("saved:red");
  });

  it("a saved pen's key changes nothing while its button holds the pen in hand", () => {
    expect(keyPenTarget({ saved: "red" }, "pen", bar, "saved:red", "saved:red")).toBeNull();
    // After another tool its button no longer holds the pen in hand.
    expect(keyPenTarget({ saved: "red" }, "eraser", bar, null, "saved:red")).toBe("saved:red");
  });

  it("a saved pen with no button of its own goes on the pen's button", () => {
    expect(keyPenTarget({ saved: "blue" }, "pen", bar, "saved:red", "saved:red")).toBe("main");
    expect(keyPenTarget({ saved: null }, "pen", bar, null, "main")).toBe("main");
  });

  it("H presses a pinned highlighter, else the pen's button", () => {
    expect(keyPenTarget("highlighter", "pen", bar, "saved:red", "saved:red")).toBe(
      "pen:highlighter",
    );
    expect(keyPenTarget("highlighter", "pen", none, null, "main")).toBe("main");
    expect(keyPenTarget("highlighter", "highlighter", bar, "pen:highlighter", "main")).toBeNull();
  });

  it("P goes back to the button of the pen last written with", () => {
    expect(keyPenTarget("pen", "highlighter", bar, "pen:highlighter", "saved:red")).toBe(
      "saved:red",
    );
    expect(keyPenTarget("pen", "eraser", bar, null, "main")).toBe("main");
    expect(keyPenTarget("pen", "laser", bar, null, null)).toBe("main");
  });

  it("P keeps a pen in hand, and forgets a button taken off the bar", () => {
    expect(keyPenTarget("pen", "pen", bar, "saved:red", "saved:red")).toBeNull();
    expect(keyPenTarget("pen", "highlighter", none, null, "saved:red")).toBe("main");
  });
});
