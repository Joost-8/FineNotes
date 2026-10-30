/**
 * `src/view/customize-toolbar-modal.ts`: the tools in their three places, on
 * the bar, in More tools and hidden, each change handed on at once.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../fakes/obsidian"));

import type { FakeEl } from "../fakes/obsidian";
import { CustomizeToolbarModal } from "../../src/view/customize-toolbar-modal";
import { type ToolbarLayout, defaultLayout } from "../../src/view/toolbar-layout";

function open(layout: ToolbarLayout = defaultLayout()) {
  const changes: ToolbarLayout[] = [];
  const modal = new CustomizeToolbarModal({} as never, layout, (next) => changes.push(next));
  modal.open();
  const body = modal.contentEl as unknown as FakeEl;
  /** Each section's item names, by its heading. */
  const lists = () => {
    const out: Record<string, string[]> = {};
    let heading = "";
    for (const child of body.find("goodobsidian-customize-body")?.children ?? []) {
      if (child.hasClass("goodobsidian-customize-label")) heading = child.text;
      else if (child.hasClass("goodobsidian-customize-list")) {
        out[heading] = child.findAll("goodobsidian-customize-name").map((el) => el.text);
      }
    }
    return out;
  };
  const rowOf = (name: string) =>
    body
      .findAll("goodobsidian-customize-row")
      .find((el) => el.find("goodobsidian-customize-name")?.text === name);
  return { modal, changes, lists, rowOf };
}

describe("Customize toolbar", () => {
  it("lists the tools in three places: the bar, More tools, and hidden", () => {
    const { modal, lists } = open({ ...defaultLayout(), off: ["record"] });
    expect((modal.titleEl as unknown as FakeEl).text).toBe("Customize toolbar");
    expect(lists()).toEqual({
      "On the toolbar": ["Lasso", "Pen", "Eraser", "Text", "Shapes", "Image", "PDF"],
      "In More tools": [
        "Hand",
        "Magnifier",
        "Stylus only",
        "Stickers",
        "Sticky notes",
        "Ruler",
        "Fill",
      ],
      Hidden: ["Record audio"],
    });
  });

  it("leaves out the Hidden section while nothing is hidden", () => {
    expect(Object.keys(open().lists())).toEqual(["On the toolbar", "In More tools"]);
  });

  it("moves a tool live: off the bar into More tools, then hidden, then back", () => {
    const { changes, lists, rowOf } = open();
    rowOf("Eraser")?.find("is-remove")?.dispatch("click");
    expect(changes.at(-1)).toEqual({
      bar: ["select", "pen", "text", "shape", "image", "pdf"],
      off: [],
    });
    rowOf("Eraser")?.find("is-off")?.dispatch("click");
    expect(changes.at(-1)?.off).toEqual(["eraser"]);
    expect(lists().Hidden).toEqual(["Eraser"]);
    rowOf("Eraser")?.find("is-add")?.dispatch("click");
    expect(lists()["In More tools"]?.[0]).toBe("Eraser");
    rowOf("Hand")?.find("is-add")?.dispatch("click");
    expect(changes.at(-1)?.bar.at(-1)).toBe("pan");
  });

  it("gives the pen no way off the bar", () => {
    const pen = open().rowOf("Pen");
    expect(pen?.find("is-remove")).toBeUndefined();
    expect(pen?.find("is-blank")).toBeDefined();
  });

  it("resets to the default bar with nothing hidden", () => {
    const { changes, modal } = open({ bar: ["pen", "pan"], off: ["record"] });
    const reset = (modal.contentEl as unknown as FakeEl).find("goodobsidian-customize-reset");
    reset?.dispatch("click");
    expect(changes.at(-1)).toEqual(defaultLayout());
  });
});
