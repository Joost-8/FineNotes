import { describe, expect, it } from "vitest";
import { SIMPLE_CLASS, simpleClasses } from "../../src/model/simple-mode";

describe("simpleClasses", () => {
  it("wears one class while the look is on, and none while it is off", () => {
    expect(simpleClasses(true)).toEqual([SIMPLE_CLASS]);
    expect(simpleClasses(false)).toEqual([]);
  });
});
