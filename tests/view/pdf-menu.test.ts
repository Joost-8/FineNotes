import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, WorkspaceLeaf } from "./fake-obsidian";
import type * as ImageMenuModule from "../../src/view/image-menu";
import type { ImageMenuEntry } from "../../src/view/image-menu";
const state = vi.hoisted(() => ({
  menus: [] as Array<{
    entries: readonly ImageMenuEntry[];
    title: string;
    isOpen: boolean;
    close: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/view/image-menu", async (original) => {
  const actual = await original<typeof ImageMenuModule>();
  return {
    ...actual,
    ImageMenuPopover: class {
      isOpen = true;
      close = vi.fn(() => {
        this.isOpen = false;
      });
      constructor(
        _anchor: unknown,
        public entries: readonly ImageMenuEntry[],
        _context: unknown,
        public title: string,
      ) {
        state.menus.push(this);
      }
    },
  };
});
const { InkView } = await import("../../src/view/ink-view");
const { DEFAULT_SETTINGS } = await import("../../src/settings");
beforeEach(() => {
  state.menus.length = 0;
});
function setup() {
  const view = new InkView(new WorkspaceLeaf({}) as never, { settings: DEFAULT_SETTINGS } as never);
  const internal = view as unknown as {
    file: TFile;
    openImageMenu(anchor: HTMLElement, pdf?: boolean): void;
    isProtected(): boolean;
  };
  internal.file = new TFile("Lecture.notebook.md", 100);
  return { view, internal, anchor: {} as HTMLElement };
}
describe("PDF toolbar menu", () => {
  it("offers file and vault choices through the existing popover", () => {
    const { view, internal, anchor } = setup();
    const importPdf = vi.spyOn(view, "importPdf").mockImplementation(() => {});
    internal.openImageMenu(anchor, true);
    const menu = state.menus[0];
    expect(menu.title).toBe("Insert PDF");
    expect(menu.entries.map((entry) => entry.label)).toEqual(["From files", "From vault"]);
    menu.entries[0].run({} as never);
    menu.entries[1].run({} as never);
    expect(importPdf.mock.calls).toEqual([[], [true]]);
  });
  it("closes on a second tap and switches between image and PDF menus", () => {
    const { internal, anchor } = setup();
    internal.openImageMenu(anchor, true);
    internal.openImageMenu(anchor, true);
    expect(state.menus).toHaveLength(1);
    expect(state.menus[0].close).toHaveBeenCalledOnce();
    internal.openImageMenu(anchor, true);
    internal.openImageMenu({} as HTMLElement);
    expect(state.menus[1].close).toHaveBeenCalledOnce();
    expect(state.menus[2].title).toBe("Insert image");
    expect(state.menus[2].entries.map((entry) => entry.label)).not.toContain("From files");
  });
  it("does not open an import menu for a protected notebook", () => {
    const { internal, anchor } = setup();
    vi.spyOn(internal, "isProtected").mockReturnValue(true);
    internal.openImageMenu(anchor, true);
    expect(state.menus).toHaveLength(0);
  });
});
