import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rangeFillPercent, rangeValueAt, syncRangeFill } from "../../src/view/range-fill";

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

describe("rangeValueAt", () => {
  // A 216 px bar from x = 100 with a 16 px knob: the knob's centre runs 108-308.
  const at = (x: number, min = 0, max = 100, step = 1): number =>
    rangeValueAt(x, 100, 216, min, max, step, 16);

  it("puts the knob's centre under the finger", () => {
    expect(at(108)).toBe(0);
    expect(at(208)).toBe(50);
    expect(at(308)).toBe(100);
    expect(at(158)).toBe(25);
  });

  it("takes the end for a press past either end of the bar", () => {
    expect(at(0)).toBe(0);
    expect(at(101)).toBe(0);
    expect(at(315)).toBe(100);
    expect(at(900)).toBe(100);
  });

  it("lands on a step counted from min", () => {
    expect(at(208, 10, 100, 5)).toBe(55);
    expect(at(150, 10, 100, 5)).toBe(30);
    expect(at(208, 0, 1, 0.1)).toBe(0.5);
    expect(at(171, 0, 1, 0.1)).toBe(0.3);
  });

  it("keeps a value on the last whole step below max, as the browser does", () => {
    expect(at(308, 0, 10, 3)).toBe(9);
  });

  it('takes any value for step 0 ("any")', () => {
    expect(at(158, 0, 2, 0)).toBeCloseTo(0.5, 9);
  });

  it("answers min for an empty range and a bar no wider than its knob", () => {
    expect(at(208, 0, 0)).toBe(0);
    expect(rangeValueAt(104, 100, 10, 0, 10, 1, 16)).toBe(0);
    expect(rangeValueAt(105, 100, 10, 0, 10, 1, 16)).toBe(10);
  });
});

describe("every slider", () => {
  // A slider left to WebKit ignores a drag that starts off its knob, or after
  // the finger rested (FineNotes discussion #107): each one gets dragRange.
  it("is dragged by dragRange", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk("src");
    const missing: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      const sliders = (text.match(/type(?::|\s*=)\s*"range"/g) ?? []).length;
      const dragged = (text.match(/dragRange\(/g) ?? []).length;
      if (sliders > dragged) missing.push(`${path}: ${sliders} sliders, ${dragged} dragRange`);
    }
    expect(missing).toEqual([]);
  });
});
