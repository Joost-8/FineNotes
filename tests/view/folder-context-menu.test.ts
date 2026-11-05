/**
 * The Folders sidebar's menu on a folder or a note: its own items first, the
 * Rename and Delete that Obsidian and other plugins add taken out, the other
 * plugins' items kept, one menu at a time, and a tap on the button that
 * opened a menu closing it rather than opening another.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, WorkspaceLeaf, resetFakes } from "./fake-obsidian";
import { MemoryFolder } from "./memory-vault";
import { StubEl, installDomGlobals } from "./stub-dom";

class FakeItem {
  readonly dom = new StubEl("div", "menu-item");
  readonly titleEl = this.dom.createDiv("menu-item-title");
  title = "";
  icon = "";
  section = "";
  warning = false;
  click: () => void = () => {};
  setTitle(title: string): this {
    this.title = title;
    this.titleEl.setText(title);
    return this;
  }
  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }
  setSection(section: string): this {
    this.section = section;
    return this;
  }
  setWarning(warning: boolean): this {
    this.warning = warning;
    return this;
  }
  onClick(click: () => void): this {
    this.click = click;
    return this;
  }
}

class FakeMenu {
  static made: FakeMenu[] = [];
  readonly dom = new StubEl("div", "menu");
  items: FakeItem[] = [];
  hideCallback: (() => void) | undefined;
  shownAt: { x: number; y: number } | null = null;
  hidden = 0;
  constructor() {
    FakeMenu.made.push(this);
  }
  addItem(build: (item: FakeItem) => void): this {
    const item = new FakeItem();
    build(item);
    this.items.push(item);
    this.dom.appendChild(item.dom);
    return this;
  }
  addSeparator(): this {
    return this;
  }
  onHide(callback: () => void): void {
    this.hideCallback = callback;
  }
  showAtPosition(at: { x: number; y: number }): void {
    this.shownAt = at;
  }
  showAtMouseEvent(): void {
    this.shownAt = { x: 0, y: 0 };
  }
  hide(): void {
    this.hidden++;
    this.hideCallback?.();
    this.dom.remove();
  }
}

vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  Menu: FakeMenu,
}));

const { openFileMenu, closeMenus, showMenu, touchIsActive } =
  await import("../../src/view/folder-sidebar/context-menu");

const names = (menu: FakeMenu): string[] => menu.items.map((item) => item.title);

interface Harness {
  menuClicks: string[];
  controller: Record<string, unknown>;
  leaf: WorkspaceLeaf;
  folder: MemoryFolder;
  note: TFile;
  /** What other plugins add to a file menu. */
  extras: string[];
  listeners: Map<string, ((event: unknown) => void)[]>;
}

function harness(): Harness {
  const extras = ["Rename…", "Delete", "Reveal in navigation", "New notebook"];
  const menuClicks: string[] = [];
  const app = {
    workspace: {
      trigger(name: string, menu: FakeMenu, _file: unknown, source: string) {
        expect(name).toBe("file-menu");
        expect(source).toBe("file-explorer-context-menu");
        for (const title of extras) menu.addItem((item) => item.setTitle(title));
      },
    },
  };
  const controller = {
    app,
    isPinned: (path: string) => path === "Pinned",
    togglePinned: (path: string) => menuClicks.push(`pin:${path}`),
    startSubfolder: (path: string) => menuClicks.push(`sub:${path}`),
  };
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const win = (globalThis as unknown as { activeWindow: Record<string, unknown> }).activeWindow;
  win.addEventListener = (type: string, listener: (event: unknown) => void) =>
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  win.removeEventListener = (type: string, listener: (event: unknown) => void) =>
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter((each) => each !== listener),
    );
  return {
    menuClicks,
    controller,
    leaf: new WorkspaceLeaf(app),
    folder: new MemoryFolder("School/Maths"),
    note: new TFile("School/Cells.md"),
    extras,
    listeners,
  };
}

beforeEach(() => {
  resetFakes();
  FakeMenu.made = [];
  installDomGlobals(vi.stubGlobal.bind(vi));
});

afterEach(() => {
  closeMenus();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a folder's menu", () => {
  it("has Rename, New subfolder, Pin, Color and Delete first, in the sidebar's own section", () => {
    const h = harness();
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 5, y: 6 });
    const [menu] = FakeMenu.made as [FakeMenu];
    expect(names(menu).slice(0, 5)).toEqual([
      "Rename",
      "New subfolder",
      "Pin to top",
      "Color…",
      "Delete",
    ]);
    expect(menu.items.slice(0, 5).map((item) => item.section)).toEqual(Array(5).fill("fs"));
    expect(menu.items[4]?.warning).toBe(true);
    expect(menu.items[2]?.icon).toBe("pin");
    expect(menu.shownAt).toEqual({ x: 5, y: 6 });
  });

  it("leaves out the Rename and Delete that Obsidian adds, and keeps other plugins' items", () => {
    const h = harness();
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 0, y: 0 });
    const [menu] = FakeMenu.made as [FakeMenu];
    expect(names(menu)).toEqual([
      "Rename",
      "New subfolder",
      "Pin to top",
      "Color…",
      "Delete",
      "Reveal in navigation",
      "New notebook",
    ]);
    expect(menu.dom.querySelectorAll(".menu-item")).toHaveLength(7);
  });

  it("offers Unpin for a pinned folder", () => {
    const h = harness();
    const pinned = new MemoryFolder("Pinned");
    openFileMenu(h.controller as never, pinned as never, h.leaf as never, { x: 0, y: 0 });
    const [menu] = FakeMenu.made as [FakeMenu];
    expect(menu.items[2]).toMatchObject({ title: "Unpin from top", icon: "pin-off" });
    menu.items[2]?.click();
    expect(h.menuClicks).toEqual(["pin:Pinned"]);
  });

  it("uses the sidebar's own rename and new subfolder when it has them", () => {
    const h = harness();
    const rename = vi.fn();
    const newSubfolder = vi.fn();
    openFileMenu(
      h.controller as never,
      h.folder as never,
      h.leaf as never,
      { x: 0, y: 0 },
      {
        actions: { rename, newSubfolder },
      },
    );
    const [menu] = FakeMenu.made as [FakeMenu];
    menu.items[0]?.click();
    menu.items[1]?.click();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(newSubfolder).toHaveBeenCalledTimes(1);
    expect(h.menuClicks).toEqual([]);
  });

  it("starts a subfolder itself when nothing else does", () => {
    const h = harness();
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 0, y: 0 });
    const [menu] = FakeMenu.made as [FakeMenu];
    menu.items[1]?.click();
    expect(h.menuClicks).toEqual(["sub:School/Maths"]);
  });
});

describe("a note's menu", () => {
  it("is only what Obsidian and other plugins add: Rename and Delete stay", () => {
    const h = harness();
    openFileMenu(h.controller as never, h.note as never, h.leaf as never, { x: 0, y: 0 });
    const [menu] = FakeMenu.made as [FakeMenu];
    expect(names(menu)).toEqual(["Rename…", "Delete", "Reveal in navigation", "New notebook"]);
  });
});

describe("one menu at a time", () => {
  it("closes the open menu when another opens", () => {
    vi.useFakeTimers();
    const h = harness();
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 0, y: 0 });
    vi.advanceTimersByTime(500);
    openFileMenu(h.controller as never, h.note as never, h.leaf as never, { x: 0, y: 0 });
    expect(FakeMenu.made[0]?.hidden).toBe(1);
    expect(FakeMenu.made[1]?.hidden).toBe(0);
  });

  it("ignores a second request right behind the first (a touch's echo)", () => {
    const h = harness();
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 0, y: 0 });
    openFileMenu(h.controller as never, h.note as never, h.leaf as never, { x: 0, y: 0 });
    expect(FakeMenu.made).toHaveLength(1);
  });

  it("marks the page while a menu is open, and clears it when it closes", () => {
    const h = harness();
    const body = (globalThis as unknown as { activeDocument: { body: StubEl } }).activeDocument
      .body;
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 0, y: 0 });
    expect(body.hasClass("fs-menu-open")).toBe(true);
    expect(FakeMenu.made[0]?.dom.hasClass("fs-menu")).toBe(true);
    closeMenus();
    expect(body.hasClass("fs-menu-open")).toBe(false);
    expect(FakeMenu.made[0]?.hidden).toBe(1);
  });

  it("closes on Escape and on a tap outside, not on a tap inside", async () => {
    vi.useFakeTimers();
    const h = harness();
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1);
    const [menu] = FakeMenu.made as [FakeMenu];
    const press = (type: string, event: unknown) => {
      for (const listener of h.listeners.get(type) ?? []) listener(event);
    };
    press("pointerdown", { target: menu.items[0]?.dom });
    expect(menu.hidden).toBe(0);
    press("keydown", { key: "a" });
    expect(menu.hidden).toBe(0);
    press("keydown", { key: "Escape" });
    expect(menu.hidden).toBe(1);
    // Listeners are let go of with the menu.
    expect(h.listeners.get("keydown")).toEqual([]);
    vi.advanceTimersByTime(1000);
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1);
    press("pointerdown", { target: new StubEl("div") });
    expect(FakeMenu.made[1]?.hidden).toBe(1);
  });

  it("does not open again from the button that closed it a moment ago", async () => {
    vi.useFakeTimers();
    const h = harness();
    const button = new StubEl("div");
    openFileMenu(
      h.controller as never,
      h.folder as never,
      h.leaf as never,
      { x: 0, y: 0 },
      {
        anchor: button as never,
      },
    );
    await vi.advanceTimersByTimeAsync(1);
    // The tap on the button is outside the menu: it closes it ...
    for (const listener of h.listeners.get("pointerdown") ?? []) listener({ target: button });
    expect(FakeMenu.made[0]?.hidden).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    // ... and the click that follows must not open it again.
    openFileMenu(
      h.controller as never,
      h.folder as never,
      h.leaf as never,
      { x: 0, y: 0 },
      {
        anchor: button as never,
      },
    );
    expect(FakeMenu.made).toHaveLength(1);
    // Later, it opens as usual.
    await vi.advanceTimersByTimeAsync(1000);
    openFileMenu(
      h.controller as never,
      h.folder as never,
      h.leaf as never,
      { x: 0, y: 0 },
      {
        anchor: button as never,
      },
    );
    expect(FakeMenu.made).toHaveLength(2);
  });

  it("shows a dropdown menu of its own the same way", async () => {
    vi.useFakeTimers();
    const h = harness();
    const menu = new FakeMenu();
    const place = vi.fn();
    showMenu(menu as never, place);
    expect(place).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    closeMenus();
    expect(menu.hidden).toBe(1);
    expect(h.listeners.get("pointerdown")).toEqual([]);
  });
});

describe("touch", () => {
  it("is active after a menu was opened from a touch's position, for a little while", () => {
    vi.useFakeTimers();
    // What earlier tests left behind has run out.
    vi.advanceTimersByTime(5000);
    const h = harness();
    expect(touchIsActive()).toBe(false);
    openFileMenu(h.controller as never, h.folder as never, h.leaf as never, { x: 1, y: 1 });
    expect(touchIsActive()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(touchIsActive()).toBe(false);
  });
});
