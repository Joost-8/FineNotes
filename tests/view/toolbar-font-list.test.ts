/**
 * `src/view/toolbar.ts` — the Text tool's font list (FineNotes#165). The
 * device's fonts arrive after the menu opened; the popover must be placed
 * and held to its room again once they are in, or the long list runs past
 * the view's bottom, which clips it, with nothing to scroll.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

let resolveFonts: (families: string[]) => void = () => undefined;
vi.mock("../../src/view/device-fonts", () => ({
  deviceFamilies: () =>
    new Promise<string[]>((resolve) => {
      resolveFonts = resolve;
    }),
  hasFamily: () => true,
}));

const { Toolbar } = await import("../../src/view/toolbar");
const { DEFAULT_TEXT_STYLE } = await import("../../src/model/text-style");

/** Just enough of an element for the font menu. */
class FakeEl {
  children: FakeEl[] = [];
  styles: Record<string, string> = {};
  text: string;
  isConnected = true;
  constructor(text = "") {
    this.text = text;
  }
  get childElementCount(): number {
    return this.children.length;
  }
  createDiv(opts?: { text?: string }): FakeEl {
    const child = new FakeEl(opts?.text ?? "");
    this.children.push(child);
    return child;
  }
  createEl(_tag: string, opts?: { text?: string }): FakeEl {
    return this.createDiv(opts);
  }
  createSpan(opts?: { text?: string }): FakeEl {
    return this.createDiv(opts);
  }
  empty(): void {
    this.children = [];
  }
  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.styles, styles);
  }
  setCssProps(): void {}
  toggleClass(): void {}
  addClass(): void {}
  setAttribute(): void {}
  addEventListener(): void {}
  remove(): void {
    this.isConnected = false;
  }
}

describe("the font list (FineNotes#165)", () => {
  it("is placed again once the device's fonts have filled it", async () => {
    const popover = new FakeEl();
    popover.styles.maxHeight = "180px";
    const anchor = new FakeEl();
    const body = new FakeEl();
    /** How many rows the list held each time the popover was placed. */
    const placedWith: number[] = [];
    const list = (): FakeEl | undefined => body.children[1];
    const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state: { textStyle: DEFAULT_TEXT_STYLE },
      textTarget: null,
      deviceFonts: null,
      popover: null,
      popoverKind: null,
      callbacks: {},
      openPopover(this: { popover: FakeEl }) {
        this.popover = popover;
        return body;
      },
      keepPopoverInside: () => placedWith.push(list()?.childElementCount ?? 0),
      keepPopoverAboveKeyboard: () => undefined,
    }) as unknown as {
      toggleTextPopover(kind: string, anchor: unknown, render: (body: unknown) => void): void;
      renderTextFonts(body: unknown): void;
    };

    toolbar.toggleTextPopover("font", anchor, (b) => toolbar.renderTextFonts(b));
    const before = list()?.childElementCount ?? 0;
    expect(placedWith).toEqual([before]);
    // The cap an earlier, shorter fill left is not read back as its height.
    expect(popover.styles.maxHeight).toBe("");

    popover.styles.maxHeight = "180px";
    resolveFonts(Array.from({ length: 200 }, (_, i) => `Font ${String(i).padStart(3, "0")}`));
    await Promise.resolve();
    await Promise.resolve();

    const after = list()?.childElementCount ?? 0;
    expect(after).toBeGreaterThan(before + 150);
    // Placed a second time, with the device's fonts already in the list.
    expect(placedWith).toEqual([before, after]);
    expect(popover.styles.maxHeight).toBe("");
  });

  it("is not placed again once the menu has closed", async () => {
    const body = new FakeEl();
    let placed = 0;
    const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state: { textStyle: DEFAULT_TEXT_STYLE },
      textTarget: null,
      deviceFonts: null,
      popoverRefit: () => placed++,
      callbacks: {},
    }) as unknown as { renderTextFonts(body: unknown): void };
    toolbar.renderTextFonts(body);
    body.children[1]!.isConnected = false;
    resolveFonts(["Agency FB", "Arial"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(placed).toBe(0);
  });
});
