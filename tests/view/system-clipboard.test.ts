import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onSystemTextWritten,
  readSystemClipboard,
  writeSystemText,
} from "../../src/view/system-clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("writeSystemText", () => {
  it("writes the text and then tells every listener", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const heard = vi.fn();
    const stop = onSystemTextWritten(heard);
    await writeSystemText("Fourier transform");
    expect(writeText).toHaveBeenCalledWith("Fourier transform");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    await writeSystemText("again");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("tells no one when the write is refused", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("no")) } });
    const heard = vi.fn();
    const stop = onSystemTextWritten(heard);
    await expect(writeSystemText("x")).rejects.toThrow();
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it("rejects where there is no clipboard", async () => {
    vi.stubGlobal("navigator", {});
    await expect(writeSystemText("x")).rejects.toThrow();
  });
});

describe("readSystemClipboard", () => {
  const item = (types: string[], data: Record<string, string> = {}) => ({
    types,
    getType: (type: string) => Promise.resolve(new Blob([data[type] ?? ""], { type })),
  });
  const holding = (...items: ReturnType<typeof item>[]) =>
    vi.stubGlobal("navigator", { clipboard: { read: () => Promise.resolve(items) } });

  it("reads a HEIC photo as a picture (discussion #112)", async () => {
    holding(item(["image/heic"]));
    const found = await readSystemClipboard();
    expect(found.kind).toBe("image");
    if (found.kind === "image") expect(found.file.type).toBe("image/heic");
  });

  it("says something was kept from the page when an item has no types (iPad Photos)", async () => {
    holding(item([]));
    expect(await readSystemClipboard()).toEqual({ kind: "hidden" });
  });

  it("is empty for a clipboard holding nothing, or only HTML", async () => {
    holding();
    expect(await readSystemClipboard()).toEqual({ kind: "empty" });
    holding(item(["text/html"], { "text/html": "<b>x</b>" }));
    expect(await readSystemClipboard()).toEqual({ kind: "empty" });
  });

  it("still takes text when another item came without types", async () => {
    holding(item([]), item(["text/plain"], { "text/plain": "hello" }));
    expect(await readSystemClipboard()).toEqual({ kind: "text", text: "hello" });
  });
});
