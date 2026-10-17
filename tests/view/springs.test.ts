/**
 * `src/view/springs.ts`: Apple's spring model traced as CSS `linear()`, and
 * styles.css's spring tokens kept equal to what it generates.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EASE_OUT_FALLBACK,
  POPOVER_IN,
  POPOVER_OUT,
  SPRING_FALLBACK,
  TOOL_INDICATOR,
  settleTime,
  springAt,
  springEasing,
  springMs,
} from "../../src/view/springs";

/** The numbers in a `linear()` string. */
function stops(easing: string): number[] {
  const inner = /^linear\((.*)\)$/.exec(easing)?.[1] ?? "";
  return inner.split(",").map((value) => Number(value.trim()));
}

describe("the spring model", () => {
  it("starts at rest and ends at its target", () => {
    for (const spring of [POPOVER_IN, TOOL_INDICATOR, { duration: 0.5, bounce: 0.3 }]) {
      expect(springAt(spring, 0)).toBe(0);
      expect(springAt(spring, -1)).toBe(0);
      expect(springAt(spring, spring.duration * 6)).toBeCloseTo(1, 4);
    }
  });

  it("never overshoots without bounce, and overshoots with it", () => {
    const peak = (spring: { duration: number; bounce: number }): number => {
      let max = 0;
      for (let t = 0; t < spring.duration * 4; t += 0.001) max = Math.max(max, springAt(spring, t));
      return max;
    };
    expect(peak(POPOVER_IN)).toBeLessThanOrEqual(1);
    expect(peak({ duration: 0.4, bounce: 0.3 })).toBeGreaterThan(1.03);
    // Apple's 0.1 is a breath of bounce, no more.
    expect(peak(TOOL_INDICATOR)).toBeGreaterThan(1);
    expect(peak(TOOL_INDICATOR)).toBeLessThan(1.01);
  });

  it("matches Apple's damping: ratio 1 - bounce, stiffness (2π/duration)²", () => {
    // Critically damped at bounce 0: x = 1 - (1 + ωt)e^(-ωt).
    const omega = (2 * Math.PI) / 0.3;
    const t = 0.1;
    expect(springAt(POPOVER_IN, t)).toBeCloseTo(1 - (1 + omega * t) * Math.exp(-omega * t), 10);
  });

  it("settles a little after its perceived duration, and a quicker spring sooner", () => {
    expect(settleTime(POPOVER_IN)).toBeGreaterThan(POPOVER_IN.duration);
    expect(settleTime(POPOVER_IN)).toBeLessThan(POPOVER_IN.duration * 1.5);
    expect(springMs(POPOVER_OUT)).toBeLessThan(springMs(POPOVER_IN));
    expect(Number.isInteger(springMs(TOOL_INDICATOR))).toBe(true);
  });

  it("keeps a nonsense bounce inside what settles", () => {
    expect(springAt({ duration: 0.3, bounce: Number.NaN }, 0.1)).toBe(springAt(POPOVER_IN, 0.1));
    expect(Number.isFinite(settleTime({ duration: 0.3, bounce: 4 }))).toBe(true);
  });
});

describe("the linear() easing", () => {
  it("runs from 0 to exactly 1, a stop a frame", () => {
    for (const spring of [POPOVER_IN, POPOVER_OUT, TOOL_INDICATOR]) {
      const values = stops(springEasing(spring));
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBe(1);
      expect(values.length).toBe(Math.ceil(settleTime(spring) * 60) + 1);
      expect(values.every(Number.isFinite)).toBe(true);
    }
  });

  it("rises steadily for a spring without bounce", () => {
    const values = stops(springEasing(POPOVER_IN));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  });
});

describe("styles.css's spring tokens", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  /** Every value `name` is given, whitespace collapsed (a long one may be wrapped). */
  const values = (name: string): string[] =>
    Array.from(css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g")), (m) =>
      m[1].replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim(),
    );
  const token = (name: string): string | undefined =>
    values(name).find((value) => value.startsWith("linear(")) ?? values(name)[0];

  it("are the generator's strings and lengths", () => {
    expect(token("--gob-spring-popover-in")).toBe(springEasing(POPOVER_IN));
    expect(token("--gob-spring-popover-out")).toBe(springEasing(POPOVER_OUT));
    expect(token("--gob-spring-tool")).toBe(springEasing(TOOL_INDICATOR));
    expect(token("--gob-t-popover-in")).toBe(`${springMs(POPOVER_IN)}ms`);
    expect(token("--gob-t-popover-out")).toBe(`${springMs(POPOVER_OUT)}ms`);
    expect(token("--gob-t-tool")).toBe(`${springMs(TOOL_INDICATOR)}ms`);
  });

  it("fall back to the old cubic-bézier tokens", () => {
    expect(token("--gob-ease-out")).toBe(EASE_OUT_FALLBACK);
    expect(token("--gob-spring")).toBe(SPRING_FALLBACK);
    expect(values("--gob-spring-popover-in")).toContain("var(--gob-ease-out)");
    expect(values("--gob-spring-popover-out")).toContain("var(--gob-ease-out)");
    expect(values("--gob-spring-tool")).toContain("var(--gob-spring)");
  });
});
