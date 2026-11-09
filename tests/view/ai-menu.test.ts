import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { AiMenuPopover } = await import("../../src/view/ai-menu");

/** The menu's element: its height depends on the width it was given, as wrapped rows do. */
function menuEl(wrappedHeight: number, unwrappedHeight: number) {
  const style: Record<string, string> = {};
  return {
    style,
    get offsetHeight() {
      return style.width ? wrappedHeight : unwrappedHeight;
    },
    setCssStyles(next: Record<string, string>) {
      Object.assign(style, next);
    },
  };
}

function place(el: ReturnType<typeof menuEl>): void {
  const menu = Object.create(AiMenuPopover.prototype) as {
    el: unknown;
    anchor: unknown;
    place(): void;
  };
  menu.el = el;
  menu.anchor = {
    getBoundingClientRect: () => ({ left: 100, right: 140, top: 60, bottom: 100 }),
    closest: () => null,
  };
  menu.place();
}

describe("AiMenuPopover.place", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("holds a menu that fits only before its rows wrap to the room below the button", () => {
    vi.stubGlobal("window", { innerWidth: 1180, innerHeight: 800 });
    const el = menuEl(720, 680);
    place(el);
    expect(el.style.top).toBe("106px");
    expect(el.style.maxHeight).toBe("686px");
  });

  it("replaces the cap of an earlier placement", () => {
    vi.stubGlobal("window", { innerWidth: 1180, innerHeight: 800 });
    const el = menuEl(300, 280);
    el.style.maxHeight = "120px";
    place(el);
    expect(el.style.width).toBe("320px");
    expect(el.style.maxHeight).toBe("686px");
  });
});
