import { describe, expect, it } from "vitest";
import { rangeFillPercent, syncRangeFill } from "../../src/view/range-fill";

describe("syncRangeFill", () => {
  it("writes the fill from the input's value, min and max", () => {
    const props: Record<string, string> = {};
    const range = {
      value: "30",
      min: "0",
      max: "120",
      setCssProps: (p: Record<string, string>) => Object.assign(props, p),
    } as unknown as HTMLInputElement;
    syncRangeFill(range);
    expect(props["--gob-range-fill"]).toBe("25%");
  });

  it("reads an unset min and max as the browser does: 0 and 100", () => {
    const props: Record<string, string> = {};
    const range = {
      value: "40",
      min: "",
      max: "",
      setCssProps: (p: Record<string, string>) => Object.assign(props, p),
    } as unknown as HTMLInputElement;
    syncRangeFill(range);
    expect(props["--gob-range-fill"]).toBe("40%");
  });
});

describe("rangeFillPercent", () => {
  it("places a value along its track", () => {
    expect(rangeFillPercent(0, 0, 48)).toBe("0%");
    expect(rangeFillPercent(18, 0, 48)).toBe("37.5%");
    expect(rangeFillPercent(48, 0, 48)).toBe("100%");
    expect(rangeFillPercent(15, 10, 20)).toBe("50%");
  });

  it("keeps the fill on the track", () => {
    expect(rangeFillPercent(-5, 0, 10)).toBe("0%");
    expect(rangeFillPercent(50, 0, 10)).toBe("100%");
  });

  it("rounds to two decimals, so the style does not churn on float noise", () => {
    expect(rangeFillPercent(1, 0, 3)).toBe("33.33%");
  });

  it("shows no fill for an empty or nonsense range", () => {
    // An audio player before the recording's length is known: max 0.
    expect(rangeFillPercent(0, 0, 0)).toBe("0%");
    expect(rangeFillPercent(5, 10, 10)).toBe("0%");
    expect(rangeFillPercent(Number.NaN, 0, 10)).toBe("0%");
    expect(rangeFillPercent(5, 0, Infinity)).toBe("0%");
  });
});
