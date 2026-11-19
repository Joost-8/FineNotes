import { describe, expect, it } from "vitest";
import {
  SIMPLE_CLASS,
  SIMPLE_PARTS,
  allSimpleClasses,
  simpleClasses,
  simplePartClass,
  simplePartsOf,
  toggleSimplePart,
} from "../../src/model/simple-mode";

describe("simpleClasses", () => {
  it("wears one class while the look is on, and none while it is off", () => {
    expect(simpleClasses(true)).toEqual([SIMPLE_CLASS]);
    expect(simpleClasses(false)).toEqual([]);
  });
});

describe("the parts the simple look can show again", () => {
  it("are all hidden by default", () => {
    expect(simpleClasses(true, [])).toEqual([SIMPLE_CLASS]);
    expect(simplePartsOf(undefined)).toEqual([]);
  });

  it("wear one class each, only while the look is on", () => {
    expect(simpleClasses(true, ["rightSidebar"])).toEqual([
      SIMPLE_CLASS,
      simplePartClass("rightSidebar"),
    ]);
    expect(simpleClasses(false, ["rightSidebar"])).toEqual([]);
  });

  it("are cleaned when read: known parts, once, in the offered order", () => {
    expect(simplePartsOf(["statusBar", "x", "leftSidebar", "statusBar", 3])).toEqual([
      "leftSidebar",
      "statusBar",
    ]);
    expect(simplePartsOf("leftSidebar")).toEqual([]);
  });

  it("toggle on and off", () => {
    const on = toggleSimplePart(["ribbon"], "leftSidebar");
    expect(on).toEqual(["leftSidebar", "ribbon"]);
    expect(toggleSimplePart(on, "ribbon")).toEqual(["leftSidebar"]);
  });

  it("list every class to take off", () => {
    expect(allSimpleClasses()).toHaveLength(SIMPLE_PARTS.length + 1);
  });
});
