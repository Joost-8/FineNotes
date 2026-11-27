import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSystemClipboard,
  onSystemTextWritten,
  readSystemClipboard,
  writeSelectionText,
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
    holding(item(["image/heic"], { "image/heic": "heic bytes" }));
    const found = await readSystemClipboard();
    expect(found.kind).toBe("image");
    if (found.kind === "image") expect(found.file.type).toBe("image/heic");
  });

  it("takes an empty picture as none, and pastes the text beside it (Android)", async () => {
    holding(item(["image/png"]), item(["text/plain"], { "text/plain": "Fourier" }));
    expect(await readSystemClipboard()).toEqual({ kind: "text", text: "Fourier" });
  });

  it("pastes the text of an item whose picture is empty (Chromium keeps both in one item)", async () => {
    holding(item(["image/png", "text/plain"], { "text/plain": "Fourier" }));
    expect(await readSystemClipboard()).toEqual({ kind: "text", text: "Fourier" });
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

describe("writeSelectionText", () => {
  const selection = { text: "Formatted", html: "<strong>Formatted</strong>" };

  it("offers HTML and plain text together without invalidating the editable selection", async () => {
    const write = vi.fn(async () => undefined);
    const heard = vi.fn();
    const stop = onSystemTextWritten(heard);
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly formats: Record<string, Blob>) {}
      },
    );
    try {
      expect(await writeSelectionText(selection, () => true)).toBe(true);
      const [items] = write.mock.calls[0] as unknown as [{ formats: Record<string, Blob> }[]];
      expect(await items[0].formats["text/plain"].text()).toBe(selection.text);
      expect(await items[0].formats["text/html"].text()).toBe(selection.html);
      expect(heard).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("writes plain text only where a rich write pastes as nothing (Android)", async () => {
    const write = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    vi.stubGlobal("ClipboardItem", class {});
    expect(await writeSelectionText(selection, () => true, true)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(selection.text);
  });

  it("falls back to plain text only while the selection is still current", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await writeSelectionText(selection, () => true)).toBe(true);
    expect(await writeSelectionText(selection, () => false)).toBe(false);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(selection.text);
  });
});

describe("clearSystemClipboard", () => {
  it("empties the clipboard without telling the text listeners (the ink stays the fresher copy)", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const heard = vi.fn();
    const stop = onSystemTextWritten(heard);
    try {
      expect(await clearSystemClipboard()).toBe(true);
      expect(writeText).toHaveBeenCalledWith("");
      expect(heard).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("never rejects", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("no")) } });
    expect(await clearSystemClipboard()).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await clearSystemClipboard()).toBe(false);
  });
});
