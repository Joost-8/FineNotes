import { describe, expect, it } from "vitest";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import { nextElementId, textBoxFrame } from "../../src/recognition/ai-placement";

const page = { width: 1000, height: 1400 };

describe("textBoxFrame", () => {
  it("puts an answer near the top of the view, centred, in a readable column", () => {
    const frame = textBoxFrame(page, { x: 0, y: 600, w: 1000, h: 700 });
    expect(frame.w).toBe(520);
    expect(frame.x).toBeCloseTo(240);
    expect(frame.y).toBeCloseTo(648);
  });

  it("falls back to the top of the page and narrows on a small page", () => {
    const small = { width: 400, height: 500 };
    const frame = textBoxFrame(small, null);
    expect(frame.w).toBeCloseTo(320);
    expect(frame.x).toBeCloseTo(40);
    expect(frame.y).toBeCloseTo(48);
  });
});

describe("ids", () => {
  function doc(): InkDocument {
    const d = emptyDocument();
    d.pages.push(blankPage("p2"));
    d.pages[0].images.push({ id: "i3", path: "a.png", x: 0, y: 0, w: 1, h: 1 });
    d.pages[1].images.push({ id: "photo", path: "b.png", x: 0, y: 0, w: 1, h: 1 });
    d.pages[1].textBoxes.push({
      id: "t7",
      x: 0,
      y: 0,
      w: 1,
      text: "",
      color: "#000",
      fontSize: 22,
    });
    return d;
  }

  it("mints the next id above every page's maximum", () => {
    expect(nextElementId(doc(), "i")).toBe("i4");
    expect(nextElementId(doc(), "t")).toBe("t8");
    expect(nextElementId(emptyDocument(), "i")).toBe("i1");
  });
});
