import { describe, expect, it } from "vitest";
import {
  EMBED_CODES,
  EMBED_FORMS,
  EMBED_PICTURE_BOX,
  embedPicture,
} from "../../src/view/embed-pictures";
import type { ArtShape } from "../../src/view/settings-art";

function flat(shapes: ArtShape[]): ArtShape[] {
  return shapes.flatMap((s) => [s, ...flat(s.kids ?? [])]);
}

describe("the pictures of the ways to embed a notebook (PR #312)", () => {
  it("draws one for each form, in theme classes only (no colour of its own)", () => {
    for (const form of EMBED_FORMS) {
      const shapes = flat(embedPicture(form));
      expect(shapes.length, form).toBeGreaterThan(5);
      for (const shape of shapes) {
        expect(shape.cls, form).toMatch(/^ga-/);
        expect(Object.keys(shape.attrs ?? {}), form).not.toContain("fill");
        expect(Object.keys(shape.attrs ?? {}), form).not.toContain("stroke");
      }
    }
  });

  it("keeps every rectangle inside the picture", () => {
    for (const form of EMBED_FORMS) {
      for (const shape of flat(embedPicture(form))) {
        if (shape.tag !== "rect") continue;
        const { x, y, width, height } = shape.attrs as Record<string, number>;
        expect(x, form).toBeGreaterThanOrEqual(0);
        expect(y, form).toBeGreaterThanOrEqual(0);
        expect(x + width, form).toBeLessThanOrEqual(EMBED_PICTURE_BOX.width);
        expect(y + height, form).toBeLessThanOrEqual(EMBED_PICTURE_BOX.height);
      }
    }
  });

  it("shows something different for each form; the Markdown link shows a page, as the wikilink does", () => {
    const key = (form: (typeof EMBED_FORMS)[number]) => JSON.stringify(embedPicture(form));
    const distinct = new Set(["whole", "page", "region", "sketch"].map((f) => key(f as never)));
    expect(distinct.size).toBe(4);
    expect(key("markdown")).toBe(key("page"));
    // A region is marked by a dashed box; a sketch has no page around it.
    expect(key("region")).toContain("stroke-dasharray");
    expect(key("sketch")).not.toContain("ga-paper");
  });

  it("gives each form its link as typed", () => {
    expect(EMBED_FORMS.map((f) => EMBED_CODES[f])).toEqual([
      "![[Notebook]]",
      "![[Notebook#page=3]]",
      "![[Notebook#Region name]]",
      "![[Notebook#id=hw-…]]",
      "![](Notebook.notebook.md#page=3)",
    ]);
  });
});
