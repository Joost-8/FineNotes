/**
 * The lasso's Screenshot puts a PNG on the system clipboard
 * (`writePngToClipboard`, `src/view/picture-clipboard.ts`): it hands the
 * promise of the pixels over at once, and says whether it got there.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { writePngToClipboard } = await import("../../src/view/picture-clipboard");

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

afterEach(() => vi.unstubAllGlobals());

describe("writePngToClipboard", () => {
  it("hands the clipboard an image/png item holding the promise, and reports success", async () => {
    const write = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const png = Promise.resolve(new Blob(["x"], { type: "image/png" }));
    expect(await writePngToClipboard(png)).toBe(true);
    const [items] = write.mock.calls[0] as unknown as [FakeClipboardItem[]];
    expect(items[0].items["image/png"]).toBe(png);
  });

  it("reports failure when the platform refuses, or has no clipboard to write to", async () => {
    const png = (): Promise<Blob> => Promise.resolve(new Blob(["x"]));
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.stubGlobal("navigator", {
      clipboard: { write: vi.fn(async () => Promise.reject(new Error("no"))) },
    });
    expect(await writePngToClipboard(png())).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await writePngToClipboard(png())).toBe(false);
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });
    vi.stubGlobal("ClipboardItem", undefined);
    expect(await writePngToClipboard(png())).toBe(false);
  });

  it("never leaves a failed drawing unhandled", async () => {
    vi.stubGlobal("navigator", {});
    const failed = Promise.reject(new Error("nothing to draw"));
    expect(await writePngToClipboard(failed)).toBe(false);
  });
});
