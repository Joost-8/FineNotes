/**
 * The lasso's Screenshot puts a PNG on the system clipboard
 * (`writePngToClipboard`, `src/view/picture-clipboard.ts`): it hands the
 * promise of the pixels over at once, and says whether it got there.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/view/image-import", () => ({
  decodeToCanvas: vi.fn(),
  releaseCanvas: vi.fn(),
}));
const { decodeToCanvas } = await import("../../src/view/image-import");
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

describe("editable selection clipboard matching", () => {
  it("matches re-encoded PNG pixels and rejects a different image", async () => {
    const { InkClipboard } = await import("../../src/model/clipboard");
    const { isOwnClipboardPng, pngPixelFingerprint } =
      await import("../../src/view/picture-clipboard");
    const selection = new InkClipboard();
    const original = new Blob(["original"], { type: "image/png" });
    const reencoded = new Blob(["re-encoded with a different byte length"], { type: "image/png" });
    const pixels = new Uint8ClampedArray([40, 80, 120, 255]);
    vi.mocked(decodeToCanvas).mockImplementation(async () => ({
      canvas: {
        width: 1,
        height: 1,
        getContext: () => ({ getImageData: () => ({ data: pixels }) }),
      } as unknown as HTMLCanvasElement,
      naturalWidth: 1,
      naturalHeight: 1,
    }));

    selection.put(
      {
        strokes: [{ id: "s1", tool: "pen", color: "#000000", size: 1, pts: [0, 0, 0.5] }],
        images: [],
        textBoxes: [],
      },
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    );
    const fingerprint = await pngPixelFingerprint(original);
    expect(fingerprint).toBeTruthy();
    selection.noteOwnPng(fingerprint!, selection.version);
    expect(original.size).not.toBe(reencoded.size);
    expect(await isOwnClipboardPng(selection, reencoded, true)).toBe(true);
    pixels[0] = 41;
    expect(await isOwnClipboardPng(selection, reencoded, true)).toBe(false);
  });
});
