import { describe, expect, it } from "vitest";
import { byLineStart } from "../../src/canvas/lasso";

const nowhere = { onText: false, freeSpace: false, inMargin: false, onLine: false };

describe("byLineStart", () => {
  it("selects PDF text where the pen lands on it", () => {
    expect(byLineStart({ ...nowhere, onText: true })).toBe("text");
  });

  it("lets text win over everything else the spot could mean", () => {
    expect(byLineStart({ onText: true, freeSpace: true, inMargin: true, onLine: true })).toBe(
      "text",
    );
  });

  it("inserts space freely on a board or unlined paper", () => {
    expect(byLineStart({ ...nowhere, freeSpace: true, inMargin: true, onLine: true })).toBe(
      "free-space",
    );
  });

  it("inserts lines from the margin, ahead of the line beside it", () => {
    expect(byLineStart({ ...nowhere, inMargin: true, onLine: true })).toBe("space");
  });

  it("selects ink by line on a line, and drags a rectangle anywhere else", () => {
    expect(byLineStart({ ...nowhere, onLine: true })).toBe("lines");
    expect(byLineStart(nowhere)).toBe("rect");
  });
});
