/**
 * Phase 7's page structure: a header and page numbers set once for the
 * notebook (`model/furniture`), page tabs (`model/page-tabs`), and a table's
 * header row (`ink/table-geometry`).
 */

import { describe, expect, it } from "vitest";
import { renderPageThumbnail } from "../../src/canvas/renderer";
import { tableHeaderRow, tableStrokes } from "../../src/ink/table-geometry";
import { type InkDocument, type Page, blankPage, emptyDocument } from "../../src/model/document";
import { SetFurniture, furnitureText, readFurniture } from "../../src/model/furniture";
import {
  SetPageTab,
  nextTabColor,
  pageTabs,
  readTabColor,
  tabLabel,
} from "../../src/model/page-tabs";
import { PALETTES, SetNotebookPalette } from "../../src/model/palette";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function notebook(): InkDocument {
  const doc = emptyDocument();
  const page = (id: string): Page => blankPage(id, { width: 400, height: 500 });
  doc.pages = [
    { ...page("cover"), backdrop: { kind: "cover-gradient", paperColor: "#1971c2" } },
    page("p1"),
    { ...page("p2"), title: "Week 2" },
    page("p3"),
  ];
  return doc;
}

describe("header and page numbers", () => {
  it("number pages from the first after the cover, and print nothing on the cover", () => {
    const doc = notebook();
    doc.furniture = { header: "{title} · {page}/{pages}", numbers: "right" };
    expect(furnitureText(doc, 0, "Biology")).toEqual({});
    expect(furnitureText(doc, 1, "Biology")).toEqual({
      header: "Biology · 1/3",
      footer: "1",
      align: "right",
    });
    expect(furnitureText(doc, 3, "Biology").footer).toBe("3");
  });

  it("print nothing without furniture, or for a page that is not there", () => {
    expect(furnitureText(notebook(), 1)).toEqual({});
    const doc = notebook();
    doc.furniture = { numbers: "center" };
    expect(furnitureText(doc, 9)).toEqual({});
  });

  it("read forgivingly, and say nothing when there is nothing to say", () => {
    expect(readFurniture({ header: "  x  ", numbers: "left" })).toEqual({ header: "x" });
    expect(readFurniture({ header: "a".repeat(200) })?.header).toHaveLength(80);
    expect(readFurniture({})).toBeUndefined();
    expect(readFurniture("x")).toBeUndefined();
  });

  it("are set and undone as one step, and saved", () => {
    const doc = notebook();
    const command = new SetFurniture({ numbers: "center", header: "{title}" });
    command.apply(doc);
    expect(decodeDocument(encodeDocument(doc)).furniture).toEqual({
      header: "{title}",
      numbers: "center",
    });
    command.invert(doc);
    expect("furniture" in doc).toBe(false);
  });

  it("are drawn on a thumbnail when given", () => {
    const drawn: string[] = [];
    const ctx = new Proxy(
      { fillText: (s: string) => void drawn.push(s) } as Record<string, unknown>,
      {
        get: (target, key) => (key in target ? target[key as string] : () => undefined),
        set: () => true,
      },
    );
    const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    renderPageThumbnail(canvas, notebook().pages[1], { paint: () => undefined }, 100, 1, {
      usePressure: false,
      furniture: { header: "Biology", footer: "1", align: "center" },
    });
    expect(drawn).toEqual(["Biology", "1"]);
  });
});

describe("page tabs", () => {
  it("take the notebook's colours in turn, skipping its ink colour", () => {
    const doc = notebook();
    new SetNotebookPalette(PALETTES[1], false).apply(doc);
    const first = nextTabColor(doc);
    expect(first).toBe(PALETTES[1].colors[1]);
    doc.pages[1].tab = first;
    expect(nextTabColor(doc)).toBe(PALETTES[1].colors[2]);
  });

  it("are listed in page order, labelled by title or number", () => {
    const doc = notebook();
    doc.pages[2].tab = "#e03131";
    doc.pages[3].tab = "#1971c2";
    expect(pageTabs(doc)).toEqual([
      { index: 2, color: "#e03131", label: "Week 2" },
      { index: 3, color: "#1971c2", label: "Page 4" },
    ]);
    expect(tabLabel(doc.pages[1], 1)).toBe("Page 2");
  });

  it("are added and taken off as one step, and saved; junk is dropped", () => {
    const doc = notebook();
    const page = doc.pages[1];
    const add = new SetPageTab(page, "#2F9E44");
    add.apply(doc);
    expect(page.tab).toBe("#2f9e44");
    expect(decodeDocument(encodeDocument(doc)).pages[1].tab).toBe("#2f9e44");
    add.invert(doc);
    expect("tab" in page).toBe(false);
    expect(readTabColor("green")).toBeUndefined();
  });
});

describe("a table's header row", () => {
  it("covers the first row exactly", () => {
    const strokes = tableStrokes({ x: 10, y: 20 }, { x: 310, y: 170 }, { rows: 3, cols: 2 }, 0.5);
    expect(tableHeaderRow(strokes)).toEqual([
      10, 20, 0.5, 310, 20, 0.5, 310, 70, 0.5, 10, 70, 0.5, 10, 20, 0.5,
    ]);
  });

  it("is the whole table when it has one row, and nothing for what is not a table", () => {
    const one = tableStrokes({ x: 0, y: 0 }, { x: 100, y: 40 }, { rows: 1, cols: 3 }, 0.5);
    expect(tableHeaderRow(one)?.[7]).toBe(40);
    expect(tableHeaderRow([])).toBeNull();
    expect(tableHeaderRow([{ shape: "line", pts: [0, 0, 0.5, 1, 1, 0.5] }])).toBeNull();
  });
});
