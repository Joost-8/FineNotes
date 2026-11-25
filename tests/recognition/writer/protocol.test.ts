import { describe, expect, it } from "vitest";

import { isOutOfMemory } from "../../../src/recognition/writer/protocol";

describe("isOutOfMemory", () => {
  it("knows ONNX Runtime failing to start for memory, as the iPad reported it", () => {
    expect(
      isOutOfMemory(new Error("no available backend found. ERR: [wasm] RangeError: Out of memory")),
    ).toBe(true);
    expect(isOutOfMemory("RangeError: Out of memory")).toBe(true);
  });

  it("leaves every other error alone", () => {
    expect(isOutOfMemory(new Error("the writer's worker did not answer"))).toBe(false);
    expect(isOutOfMemory(new Error("the writer has no letter for this text"))).toBe(false);
  });
});
