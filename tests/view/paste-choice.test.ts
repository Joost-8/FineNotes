import { describe, expect, it } from "vitest";
import {
  PASTED_TEXT_ROOM,
  cleanPastedText,
  clipboardHidSomething,
  inkFirst,
  isPictureFile,
  pastedTextOrigin,
  pickClipboardType,
} from "../../src/view/paste-choice";

describe("inkFirst", () => {
  it("pastes the plugin's clipboard without asking the system's while the app was not left", () => {
    expect(inkFirst(true, false)).toBe(true);
  });

  it("asks the system clipboard once the app was left, or when there is no ink", () => {
    expect(inkFirst(true, true)).toBe(false);
    expect(inkFirst(false, false)).toBe(false);
    expect(inkFirst(false, true)).toBe(false);
  });
});

describe("pickClipboardType", () => {
  it("prefers a picture over the text that comes with it", () => {
    expect(pickClipboardType(["text/plain", "image/png"])).toEqual({
      kind: "image",
      type: "image/png",
    });
    expect(pickClipboardType(["text/html", "image/jpeg", "image/png"])).toEqual({
      kind: "image",
      type: "image/png",
    });
  });

  it("reads any picture type a page shows, whatever its case", () => {
    expect(pickClipboardType(["IMAGE/GIF"])).toEqual({ kind: "image", type: "image/gif" });
    expect(pickClipboardType(["image/webp"])).toEqual({ kind: "image", type: "image/webp" });
    expect(pickClipboardType(["image/svg+xml"])).toEqual({ kind: "image", type: "image/svg+xml" });
  });

  it("falls back to plain text", () => {
    expect(pickClipboardType(["text/html", "text/plain"])).toEqual({
      kind: "text",
      type: "text/plain",
    });
  });

  it("takes any other picture type, after the web formats (discussion #112)", () => {
    expect(pickClipboardType(["image/heic", "web application/x-goodnotes"])).toEqual({
      kind: "image",
      type: "image/heic",
    });
    expect(pickClipboardType(["image/tiff", "image/jpeg"])).toEqual({
      kind: "image",
      type: "image/jpeg",
    });
    expect(pickClipboardType(["text/plain", "IMAGE/TIFF"])).toEqual({
      kind: "image",
      type: "image/tiff",
    });
  });

  it("finds nothing in HTML alone, another app's own type, or nothing", () => {
    expect(pickClipboardType(["text/html"])).toBeNull();
    expect(pickClipboardType(["web application/x-goodnotes"])).toBeNull();
    expect(pickClipboardType([])).toBeNull();
  });
});

describe("clipboardHidSomething", () => {
  it("is true when an item came with no types: an iPad photo (discussion #112)", () => {
    expect(clipboardHidSomething([[]])).toBe(true);
    expect(clipboardHidSomething([["text/html"], []])).toBe(true);
  });

  it("is false for an empty clipboard, or items whose types were all shown", () => {
    expect(clipboardHidSomething([])).toBe(false);
    expect(clipboardHidSomething([["text/html"]])).toBe(false);
  });
});

describe("isPictureFile", () => {
  it("trusts a file's type", () => {
    expect(isPictureFile("image/png", "x.txt")).toBe(true);
    expect(isPictureFile("IMAGE/HEIC", "")).toBe(true);
    expect(isPictureFile("application/pdf", "scan.png")).toBe(false);
  });

  it("goes by the name for an untyped file", () => {
    expect(isPictureFile("", "IMG_0042.HEIC")).toBe(true);
    expect(isPictureFile("", "photo.jpeg")).toBe(true);
    expect(isPictureFile("", "notes.pdf")).toBe(false);
    expect(isPictureFile("", "")).toBe(false);
  });
});

describe("cleanPastedText", () => {
  it("makes every line break a \\n and drops trailing spaces", () => {
    expect(cleanPastedText("one  \r\ntwo\rthree\t\n")).toBe("one\ntwo\nthree");
  });

  it("keeps indentation, inner blank lines and tabs as spaces", () => {
    expect(cleanPastedText("\n\n  a\n\n\tb\n\n")).toBe("  a\n\n    b");
  });

  it("is empty when only whitespace was copied", () => {
    expect(cleanPastedText(" \n\t \r\n  ")).toBe("");
    expect(cleanPastedText("")).toBe("");
  });
});

describe("pastedTextOrigin", () => {
  const page = { width: 800, height: 1100 };

  it("starts the box at the press", () => {
    expect(pastedTextOrigin({ x: 100, y: 300 }, page)).toEqual({ x: 100, y: 300 });
  });

  it("moves it left so it keeps room to the page's right edge", () => {
    expect(pastedTextOrigin({ x: 790, y: 300 }, page)).toEqual({
      x: page.width - PASTED_TEXT_ROOM,
      y: 300,
    });
  });

  it("keeps it on the page", () => {
    expect(pastedTextOrigin({ x: -20, y: -5 }, page)).toEqual({ x: 0, y: 0 });
    expect(pastedTextOrigin({ x: 10, y: 5000 }, page)).toEqual({ x: 10, y: 1100 });
  });

  it("starts at the left edge on a page narrower than the room", () => {
    expect(pastedTextOrigin({ x: 100, y: 10 }, { width: 200, height: 300 })).toEqual({
      x: 0,
      y: 10,
    });
  });
});
