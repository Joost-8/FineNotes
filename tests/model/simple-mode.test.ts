import { describe, expect, it } from "vitest";
import {
  ALL_SIMPLE_CLASSES,
  ALL_SIMPLE_PARTS,
  simpleClasses,
  simplePartsOf,
} from "../../src/model/simple-mode";

describe("simplePartsOf", () => {
  it("is every piece when nothing was saved, and keeps only known ones otherwise", () => {
    expect(simplePartsOf(undefined)).toEqual([...ALL_SIMPLE_PARTS]);
    expect(simplePartsOf(["tabs", "nope", "tabs"])).toEqual(["tabs"]);
    expect(simplePartsOf([])).toEqual([]);
  });
});

describe("simpleClasses", () => {
  it("is nothing while the look is off", () => {
    expect(simpleClasses(false, ALL_SIMPLE_PARTS)).toEqual([]);
  });

  it("names one class per hidden piece, all of them known", () => {
    const classes = simpleClasses(true, ["tabs", "status"]);
    expect(classes).toEqual(["goodobsidian-simple-tabs", "goodobsidian-simple-status"]);
    for (const name of classes) expect(ALL_SIMPLE_CLASSES).toContain(name);
  });
});
