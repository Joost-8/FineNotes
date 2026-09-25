/**
 * The pen-type menu is the only way to the highlighter without a keyboard:
 * the toolbar has no highlighter button, as in GoodNotes, where the
 * highlighter is a pen type. From 0.1.2 to 1.0.0 the menu showed only the
 * three pens, and the highlighter could not be picked on an iPad.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { PEN_MENU_TYPES, penTypeFor } = await import("../../src/view/toolbar");

describe("the pen-type menu", () => {
  it("offers the highlighter as well as the three pens", () => {
    expect(PEN_MENU_TYPES.map((spec) => spec.id)).toEqual([
      "fountain",
      "ball",
      "brush",
      "highlighter",
    ]);
  });

  it("switches to the highlighter tool when the highlighter is chosen", () => {
    const highlighter = PEN_MENU_TYPES.find((spec) => spec.id === "highlighter");
    expect(highlighter).toMatchObject({ tool: "highlighter", label: "Highlighter" });
  });

  it("keeps the pen button's type in step with the highlighter tool", () => {
    expect(penTypeFor({ tool: "highlighter" } as never).id).toBe("highlighter");
    expect(penTypeFor({ tool: "pen" } as never).id).toBe("fountain");
  });
});
