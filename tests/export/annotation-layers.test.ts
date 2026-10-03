import { describe, expect, it } from "vitest";
import { annotationLayers } from "../../src/export/annotation-layers";
import { blankPage, type Stroke } from "../../src/model/document";
const stroke = (id: string, tool: Stroke["tool"]): Stroke => ({
  id,
  tool,
  color: "#ff0",
  size: 4,
  pts: [10, 20, 0.5, 30, 40, 0.5],
});
describe("PDF annotation layers", () => {
  it("keeps pictures and text under ink, with separate multiply layers in stroke order", () => {
    const page = blankPage("p1");
    page.images.push({ id: "i1", path: "image.png", x: 0, y: 0, w: 10, h: 10 });
    page.textBoxes.push({
      id: "t1",
      x: 0,
      y: 0,
      w: 100,
      text: "Text",
      color: "#000",
      fontSize: 16,
    });
    page.strokes = [
      stroke("s1", "pen"),
      stroke("s2", "pen"),
      stroke("s3", "highlighter"),
      stroke("s4", "highlighter"),
      stroke("s5", "pen"),
    ];
    const before = JSON.stringify(page);
    const layers = [...annotationLayers(page)];
    expect(layers.map((layer) => layer.multiply)).toEqual([false, false, true, false]);
    expect(layers.map((layer) => layer.page.strokes.map((stroke) => stroke.id))).toEqual([
      [],
      ["s1", "s2"],
      ["s3", "s4"],
      ["s5"],
    ]);
    expect(layers[0].page.images).toEqual(page.images);
    expect(layers[0].page.textBoxes).toEqual(page.textBoxes);
    expect(
      layers
        .slice(1)
        .every((layer) => layer.page.images.length === 0 && layer.page.textBoxes.length === 0),
    ).toBe(true);
    expect(JSON.stringify(page)).toBe(before);
  });
  it("omits empty layers and leaves a plain PDF page with no raster overlay", () => {
    expect([...annotationLayers(blankPage("p1"))]).toEqual([]);
    const page = blankPage("p1");
    page.strokes.push(stroke("s1", "highlighter"));
    expect([...annotationLayers(page)].map((layer) => layer.multiply)).toEqual([true]);
  });
});

describe("SVG layering", () => {
  it.each([true, false])("keeps mixed image order and optional text (%s)", (text) => {
    const page = blankPage();
    page.images = ["a.png", "b.SVG", "c.jpg"].map((path, i) => ({
      id: String(i),
      path,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    }));
    if (text)
      page.textBoxes.push({ id: "t", x: 0, y: 0, w: 10, text: "top", color: "#000", fontSize: 12 });
    page.strokes.push(stroke("ink", "highlighter"));
    const before = JSON.stringify(page);
    const layers = [...annotationLayers(page)];
    expect(layers.slice(0, 3).map((l) => l.page.images[0].path)).toEqual([
      "a.png",
      "b.SVG",
      "c.jpg",
    ]);
    expect(
      layers.slice(0, 3).every((l) => l.page.textBoxes.length === 0 && l.page.strokes.length === 0),
    ).toBe(true);
    expect(layers.at(-1)!.multiply).toBe(true);
    expect(layers).toHaveLength(text ? 5 : 4);
    expect(JSON.stringify(page)).toBe(before);
  });
});
