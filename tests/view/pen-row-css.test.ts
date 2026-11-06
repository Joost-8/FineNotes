/**
 * styles.css — the pen types' row (FineNotes#164): every pen shows while
 * the pill has the room, across or upright; only a narrow pane makes it
 * give way, down to two pens, and scroll.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** The declarations of every rule whose selector list ends in `.goodobsidian-pen-types`. */
function penRowRules(): string[] {
  const rules: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((s) => s.trim());
    if (selectors.some((s) => /\.goodobsidian-pen-types$/.test(s))) rules.push(match[2]);
  }
  return rules;
}

describe("the pen row (FineNotes#164)", () => {
  it("has no cap on how many pens show, across or upright", () => {
    const rules = penRowRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) {
      expect(body).not.toMatch(/max-width:\s*calc/);
      expect(body).not.toMatch(/max-height:\s*calc/);
    }
  });

  it("still gives way down to two pens, and scrolls", () => {
    const body = penRowRules().join("\n");
    expect(body).toMatch(/min-width:\s*calc\(var\(--gob-pen-type, 42px\) \* 2 \+ 4px\)/);
    expect(body).toMatch(/min-height:\s*calc\(var\(--gob-pen-type, 42px\) \* 2 \+ 4px\)/);
    expect(body).toMatch(/overflow-x:\s*auto/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });
});
