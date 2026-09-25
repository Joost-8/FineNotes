import { describe, expect, it } from "vitest";
import { errorMessage } from "../../src/util/errors";

describe("errorMessage", () => {
  it("gives an Error's message", () => {
    expect(errorMessage(new Error("disk full"))).toBe("disk full");
    expect(errorMessage(new TypeError("not a function"))).toBe("not a function");
  });

  it("gives an empty message as it is, not the error's name", () => {
    expect(errorMessage(new Error())).toBe("");
    expect(errorMessage(new RangeError(""), "fallback")).toBe("");
  });

  it("turns any other thrown value into a string", () => {
    expect(errorMessage("offline")).toBe("offline");
    expect(errorMessage(404)).toBe("404");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage({ message: "not an Error" })).toBe("[object Object]");
  });

  it("uses the fallback, when given, for a value that is not an Error", () => {
    expect(errorMessage("offline", "")).toBe("");
    expect(errorMessage(undefined, "unknown error")).toBe("unknown error");
    expect(errorMessage(new Error("kept"), "unused")).toBe("kept");
  });
});
