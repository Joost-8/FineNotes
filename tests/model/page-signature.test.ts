import { describe, expect, it } from "vitest";
import { blankPage } from "../../src/model/document";
import type { Page, Stroke } from "../../src/model/document";
import { pageSignature } from "../../src/model/page-signature";

function withStroke(page: Page, pts: number[], id = "s1"): Page {
  return {
    ...page,
    strokes: [...page.strokes, { ...strokeLike(id), pts }],
  };
}

function strokeLike(id: string): Stroke {
  return { id, tool: "pen", color: "#000000", size: 2, pts: [] };
}

describe("pageSignature", () => {
  it("is the same for the same page", () => {
    const page = withStroke(blankPage("p1"), [1, 2, 0.5, 3, 4, 0.5]);
    expect(pageSignature(page)).toBe(pageSignature(structuredClone(page)));
  });

  it("moves when ink is added, moved or cut short", () => {
    const base = withStroke(blankPage("p1"), [1, 2, 0.5, 3, 4, 0.5]);
    const before = pageSignature(base);
    expect(pageSignature(withStroke(base, [5, 5, 0.5], "s2"))).not.toBe(before);
    expect(pageSignature(withStroke(blankPage("p1"), [2, 2, 0.5, 3, 4, 0.5]))).not.toBe(before);
    expect(pageSignature(withStroke(blankPage("p1"), [1, 2, 0.5]))).not.toBe(before);
  });

  it("moves when the paper or the page size changes", () => {
    const page = blankPage("p1");
    const before = pageSignature(page);
    expect(pageSignature({ ...page, backdrop: { kind: "grid" } as Page["backdrop"] })).not.toBe(
      before,
    );
    expect(
      pageSignature({ ...page, geometry: { ...page.geometry, height: page.geometry.height + 1 } }),
    ).not.toBe(before);
  });

  it("moves when a picture moves", () => {
    const image = { id: "i1", path: "a.png", x: 0, y: 0, w: 10, h: 10 };
    const page = { ...blankPage("p1"), images: [image] } as Page;
    const moved = { ...page, images: [{ ...image, x: 5 }] } as Page;
    expect(pageSignature(moved)).not.toBe(pageSignature(page));
  });
});
