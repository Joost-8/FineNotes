/**
 * A notebook's palette (`src/model/palette.ts`): read from disk, offered,
 * and swapped for another, recolouring the notebook in one undoable step.
 */

import { describe, expect, it } from "vitest";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_SIZE,
  SetNotebookPalette,
  paletteOf,
  readPalette,
  swapColor,
} from "../../src/model/palette";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const [classic, ocean] = PALETTES;

function notebook(): InkDocument {
  const doc = emptyDocument();
  doc.pages = [
    {
      ...blankPage("p1", { width: 400, height: 400 }),
      strokes: [
        { id: "a", color: classic.colors[0], size: 2, tool: "pen", pts: [0, 0, 0.5] },
        {
          id: "b",
          color: classic.colors[1],
          size: 2,
          tool: "pen",
          shape: "rect",
          fill: `${classic.colors[2]}4d`,
          pts: [0, 0, 0.5],
        },
        { id: "c", color: "#123456", size: 2, tool: "pen", pts: [0, 0, 0.5] },
      ],
      textBoxes: [
        {
          id: "t",
          x: 0,
          y: 0,
          w: 100,
          text: "Hi",
          color: classic.colors[0],
          fontSize: 22,
          fill: classic.colors[4],
          border: { width: 2, color: classic.colors[3] },
        },
      ],
    },
  ];
  return doc;
}

describe("the curated palettes", () => {
  it("each have six distinct colours, ink first, and unique ids", () => {
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    for (const palette of PALETTES) {
      expect(palette.colors).toHaveLength(PALETTE_SIZE);
      expect(new Set(palette.colors).size, palette.id).toBe(PALETTE_SIZE);
      expect(readPalette(palette), palette.id).toEqual(palette);
    }
    expect(DEFAULT_PALETTE.id).toBe("classic");
  });
});

describe("readPalette", () => {
  it("keeps only six #rrggbb colours", () => {
    expect(readPalette({ colors: ["#000000"] })).toBeUndefined();
    expect(readPalette({ colors: [...classic.colors.slice(0, 5), "red"] })).toBeUndefined();
    expect(readPalette({ colors: classic.colors.map((c) => c.toUpperCase()) })).toEqual({
      id: "custom",
      name: "Custom",
      colors: classic.colors,
    });
    expect(readPalette(null)).toBeUndefined();
  });

  it("gives a notebook without one the classic colours", () => {
    expect(paletteOf(emptyDocument())).toBe(DEFAULT_PALETTE);
  });
});

describe("swapColor", () => {
  it("moves a palette colour to the new one in its place, keeping its alpha", () => {
    expect(swapColor(classic.colors[1], classic.colors, ocean.colors)).toBe(ocean.colors[1]);
    expect(swapColor(`${classic.colors[2]}4d`, classic.colors, ocean.colors)).toBe(
      `${ocean.colors[2]}4d`,
    );
    expect(swapColor(classic.colors[1].toUpperCase(), classic.colors, ocean.colors)).toBe(
      ocean.colors[1],
    );
  });

  it("leaves any other colour alone", () => {
    expect(swapColor("#123456", classic.colors, ocean.colors)).toBe("#123456");
    expect(swapColor("", classic.colors, ocean.colors)).toBe("");
  });
});

describe("SetNotebookPalette", () => {
  it("recolours ink, shape fills, text and boxes, and nothing else", () => {
    const doc = notebook();
    const command = new SetNotebookPalette(ocean);
    command.apply(doc);
    const [a, b, c] = doc.pages[0].strokes;
    const t = doc.pages[0].textBoxes[0];
    expect(a.color).toBe(ocean.colors[0]);
    expect(b.color).toBe(ocean.colors[1]);
    expect(b.fill).toBe(`${ocean.colors[2]}4d`);
    expect(c.color).toBe("#123456");
    expect(t.color).toBe(ocean.colors[0]);
    expect(t.fill).toBe(ocean.colors[4]);
    expect(t.border?.color).toBe(ocean.colors[3]);
    expect(doc.palette).toEqual(ocean);
    expect(command.recolored).toBe(6);
  });

  it("is undone exactly, the palette key included", () => {
    const doc = notebook();
    const before = JSON.stringify(doc);
    const command = new SetNotebookPalette(ocean);
    command.apply(doc);
    command.invert(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("can set the palette without recolouring", () => {
    const doc = notebook();
    new SetNotebookPalette(ocean, false).apply(doc);
    expect(doc.pages[0].strokes[0].color).toBe(classic.colors[0]);
    expect(doc.palette?.id).toBe("ocean");
  });

  it("chains: ocean to sunset recolours from ocean", () => {
    const doc = notebook();
    new SetNotebookPalette(ocean).apply(doc);
    new SetNotebookPalette(PALETTES[2]).apply(doc);
    expect(doc.pages[0].strokes[1].color).toBe(PALETTES[2].colors[1]);
  });
});

describe("a notebook's palette saved", () => {
  it("survives a save, and a notebook without one has none", () => {
    const doc = notebook();
    new SetNotebookPalette(ocean).apply(doc);
    expect(decodeDocument(encodeDocument(doc)).palette).toEqual(ocean);
    expect(decodeDocument(encodeDocument(notebook())).palette).toBeUndefined();
  });
});
