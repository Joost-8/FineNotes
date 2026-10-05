import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { prepareImageBytes, loadImage } = await import("../../src/view/image-import");
let fail: boolean;
let tags: string[];
const revoke = vi.fn();
const remove = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fail = false;
  tags = [];
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:svg");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
  vi.stubGlobal("createEl", (tag: string) => {
    tags.push(tag);
    return {
      naturalWidth: 100,
      naturalHeight: 80,
      removeAttribute: remove,
      onload: () => {},
      onerror: () => {},
      decode: async () => {},
      set src(_value: string) {
        queueMicrotask(() => (fail ? this.onerror() : this.onload()));
      },
    };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("original SVG import and decoding", () => {
  it("preserves SVG bytes and extension without making any raster canvas", async () => {
    const bytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>',
    ).buffer;
    const prepared = await prepareImageBytes(bytes, "image/svg+xml");
    expect(prepared.bytes).toBe(bytes);
    expect(prepared).toMatchObject({ mime: "image/svg+xml", ext: "svg", width: 100, height: 80 });
    expect(tags).toEqual(["img"]);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:svg");
    expect(remove).toHaveBeenCalledWith("src");
  });
  it("retains the blob URL until its vector source is released", async () => {
    const loaded = await loadImage(new ArrayBuffer(0), "image/svg+xml");
    expect(revoke).not.toHaveBeenCalled();
    loaded.release();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:svg");
  });
  it("revokes failed decodes", async () => {
    fail = true;
    await expect(loadImage(new ArrayBuffer(0), "image/svg+xml")).rejects.toThrow("decoded");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:svg");
  });
});
