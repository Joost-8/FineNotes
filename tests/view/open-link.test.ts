/**
 * Where a tapped link goes (a text box's link, or linked ink): a page of the
 * open notebook scrolls there in place, as Goodnotes' page links do; any
 * other link opens in a new tab, and a web address in the browser.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { InkView } = await import("../../src/view/ink-view");

const NOTEBOOK = "Imported/Lectures.notebook.md";

function viewWith(pageCount: number) {
  const goToPage = vi.fn();
  const openLinkText = vi.fn(() => Promise.resolve());
  const members = {
    file: { path: NOTEBOOK },
    surface: { document: { pages: Array.from({ length: pageCount }, () => ({})) }, goToPage },
    app: {
      workspace: { openLinkText },
      metadataCache: {
        getFirstLinkpathDest: (path: string) =>
          path === "Lectures.notebook" ? { path: NOTEBOOK } : { path: `${path}.md` },
      },
    },
  };
  const view = Object.create(InkView.prototype) as Record<string, unknown>;
  for (const [key, value] of Object.entries(members)) {
    Object.defineProperty(view, key, { value, writable: true, configurable: true });
  }
  const open = (target: string): void =>
    (view as unknown as { openInkLink(target: string): void }).openInkLink(target);
  return { open, goToPage, openLinkText };
}

describe("opening a link", () => {
  it("scrolls to a page of this notebook instead of opening it again", () => {
    const { open, goToPage, openLinkText } = viewWith(5);
    open("#page=3");
    open("Lectures.notebook#page=4");
    expect(goToPage.mock.calls).toEqual([
      [2, true],
      [3, true],
    ]);
    expect(openLinkText).not.toHaveBeenCalled();
  });

  it("opens other notes, and pages past the end, as Obsidian does", () => {
    const { open, goToPage, openLinkText } = viewWith(5);
    open("Other#page=2");
    open("Lectures.notebook#page=9");
    open("Signals#FIR filters");
    expect(goToPage).not.toHaveBeenCalled();
    expect(openLinkText.mock.calls).toEqual([
      ["Other#page=2", NOTEBOOK, true],
      ["Lectures.notebook#page=9", NOTEBOOK, true],
      ["Signals#FIR filters", NOTEBOOK, true],
    ]);
  });
});
