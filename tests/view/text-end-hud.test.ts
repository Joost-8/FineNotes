/** `src/view/text-end-hud.ts` — the HUD line that says why a text box stopped being edited. */

import { describe, expect, it } from "vitest";
import { type TextEndRecord, describeElement, textEndLine } from "../../src/view/text-end-hud";

function record(partial: Partial<TextEndRecord> = {}): TextEndRecord {
  return {
    by: "",
    ms: 0,
    to: null,
    keyboard: 0,
    surfaceH: 700,
    boxTop: 100,
    boxBottom: 140,
    tool: "text",
    hidden: false,
    removed: false,
    ...partial,
  };
}

describe("describeElement", () => {
  it("names the tag and the first class, without the plugin's prefix", () => {
    expect(
      describeElement({ tagName: "TEXTAREA", className: "goodobsidian-page-textbox-input x" }),
    ).toBe("textarea.page-textbox-input");
    expect(describeElement({ tagName: "BUTTON", className: "clickable-icon" })).toBe(
      "button.clickable-icon",
    );
  });

  it("is the tag alone without classes, and a dash without an element", () => {
    expect(describeElement({ tagName: "BODY", className: "" })).toBe("body");
    // An SVG element's className is an object, not a string.
    expect(describeElement({ tagName: "svg", className: {} })).toBe("svg");
    expect(describeElement(null)).toBe("-");
  });
});

describe("textEndLine", () => {
  it("names a blur the surface made, and the box it removed", () => {
    expect(
      textEndLine(
        record({ by: "out-of-sight", ms: 840.4, removed: true, keyboard: 402, surfaceH: 0 }),
        { tagName: "BODY", className: "is-mobile" },
      ),
    ).toBe(
      "text end: by=out-of-sight after=840ms removed to=- active=body.is-mobile\n" +
        "  kb=402 surf=0 box=100..140 tool=text",
    );
  });

  it("calls a blur no path of the surface made the browser's, with where the focus went", () => {
    expect(
      textEndLine(
        record({ ms: 1200, to: { tagName: "BUTTON", className: "clickable-icon" }, hidden: true }),
        null,
      ),
    ).toBe(
      "text end: by=browser after=1200ms to=button.clickable-icon active=- hidden\n" +
        "  kb=0 surf=700 box=100..140 tool=text",
    );
  });
});
