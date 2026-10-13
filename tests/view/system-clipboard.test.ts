import { afterEach, describe, expect, it, vi } from "vitest";
import { onSystemTextWritten, writeSystemText } from "../../src/view/system-clipboard";

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
