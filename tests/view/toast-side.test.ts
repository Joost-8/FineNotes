import { describe, expect, it } from "vitest";
import { toastSide } from "../../src/view/toast-side";

const area = { top: 60, bottom: 860 };

describe("toastSide", () => {
  it("takes the bottom with the bar above the page and nothing over it", () => {
    expect(toastSide(area, [{ top: 0, bottom: 56 }])).toBe("bottom");
    expect(toastSide(area, [])).toBe("bottom");
  });

  it("takes the bottom while the pill hangs under the bar", () => {
    expect(
      toastSide(area, [
        { top: 0, bottom: 56 },
        { top: 64, bottom: 108 },
      ]),
    ).toBe("bottom");
  });

  it("takes the top when the pill sits in the lower half", () => {
    expect(
      toastSide(area, [
        { top: 0, bottom: 56 },
        { top: 700, bottom: 744 },
      ]),
    ).toBe("top");
  });

  it("takes the top for a bar along the bottom of the page", () => {
    expect(toastSide(area, [{ top: 800, bottom: 860 }])).toBe("top");
  });

  it("ignores a hidden pill and chrome outside the area", () => {
    expect(
      toastSide(area, [
        { top: 0, bottom: 0 },
        { top: 900, bottom: 950 },
      ]),
    ).toBe("bottom");
  });

  it("follows the chrome nearest the middle when there is chrome at both ends", () => {
    expect(
      toastSide(area, [
        { top: 60, bottom: 100 },
        { top: 500, bottom: 540 },
      ]),
    ).toBe("top");
  });
});
