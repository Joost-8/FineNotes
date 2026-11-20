/**
 * The tool bar on a PDF's tab beside the notes (`Toolbar.setPdfTab`): the
 * tool chest (More tools) goes when nothing it lists is of use there, rather
 * than opening on "Customize toolbar" under an empty divider; and Customize
 * toolbar opens on the notes, where every button of the bar is.
 */

import { describe, expect, it, vi } from "vitest";
import { type ToolbarLayout, defaultLayout, normalizeLayout } from "../../src/view/toolbar-layout";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");

type Fake = Record<string, unknown>;
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

/** A button that keeps its classes. */
function button() {
  const classes = new Set<string>();
  return {
    classes,
    toggleClass: (cls: string, on: boolean) => (on ? classes.add(cls) : classes.delete(cls)),
    hasClass: (cls: string) => classes.has(cls),
  };
}

/** A bar whose More tools menu lists `menu`: the only menu items with buttons here. */
function bar(menu: string[]) {
  const base = defaultLayout();
  const layout = normalizeLayout(
    {
      ...base,
      start: base.start.filter((id) => !menu.includes(id)),
      middle: base.middle.filter((id) => !menu.includes(id)),
      end: base.end.filter((id) => !menu.includes(id)),
    } as ToolbarLayout,
    new Set(),
  );
  const accessories = button();
  const items = new Map<string, ReturnType<typeof button>>();
  for (const id of ["pen", "eraser", "select", "text", ...menu]) items.set(id, button());
  const toolbar: Fake = Object.assign(Object.create(Toolbar.prototype) as object, {
    pdfTab: true,
    layoutNow: layout,
    barItems: items,
    accessoriesButton: accessories,
    itemRuns: new Map([...items.keys()].map((id) => [id, () => {}])),
  });
  return { toolbar, accessories, items };
}

describe("the tool chest on a PDF's tab", () => {
  it("goes when everything it lists stays with the notes", () => {
    const { toolbar, accessories, items } = bar(["sticker", "tape"]);
    run(toolbar, "syncPdfTabOff");
    expect(accessories.hasClass("is-pdf-tab-off")).toBe(true);
    expect(items.get("text")?.hasClass("is-pdf-tab-off")).toBe(true);
    expect(items.get("pen")?.hasClass("is-pdf-tab-off")).toBe(false);
  });

  it("stays when it lists something a PDF's tab can use", () => {
    const { toolbar, accessories } = bar(["sticker", "pan"]);
    run(toolbar, "syncPdfTabOff");
    expect(accessories.hasClass("is-pdf-tab-off")).toBe(false);
  });

  it("comes back on the notes", () => {
    const { toolbar, accessories } = bar(["sticker", "tape"]);
    run(toolbar, "syncPdfTabOff");
    toolbar.pdfTab = false;
    run(toolbar, "syncPdfTabOff");
    expect(accessories.hasClass("is-pdf-tab-off")).toBe(false);
  });
});

describe("Customize toolbar from a PDF's tab", () => {
  it("shows the notes first, and opens nothing if they could not be shown", () => {
    const leave = vi.fn();
    const toolbar: Fake = Object.assign(Object.create(Toolbar.prototype) as object, {
      pdfTab: true,
      editor: null,
      callbacks: { onLayout: vi.fn(), onLeavePdfTab: leave },
      closePopover: vi.fn(),
    });
    run(toolbar, "startCustomize");
    expect(leave).toHaveBeenCalledTimes(1);
    // Still on the PDF's tab: no editor was made.
    expect(toolbar.editor).toBeNull();
    expect(toolbar.closePopover).not.toHaveBeenCalled();
  });
});
