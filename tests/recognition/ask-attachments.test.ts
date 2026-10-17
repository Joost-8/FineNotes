import { describe, expect, it } from "vitest";
import type { Backdrop } from "../../src/model/document";
import {
  ATTACH_ACCEPT,
  ATTACH_MAX_BYTES,
  attachKind,
  attachRefusal,
  attachmentBytes,
  attachmentFromBytes,
  fileNameOf,
  pdfsBehind,
  sameAttachment,
  sizeLabel,
} from "../../src/recognition/ask-attachments";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("attachments", () => {
  it("knows which files the AI can read", () => {
    expect(attachKind("Lecture 5.PDF")).toBe("pdf");
    expect(attachKind("photo.jpeg")).toBe("image");
    expect(attachKind("notes.md")).toBe("text");
    expect(attachKind("song.mp3")).toBeNull();
    expect(attachKind("README")).toBeNull();
    expect(ATTACH_ACCEPT.split(",")).toEqual(expect.arrayContaining([".pdf", ".png", ".md"]));
  });

  it("turns bytes into a PDF, a picture or text", () => {
    expect(attachmentFromBytes("a.pdf", bytes("%PDF"), "L/a.pdf")).toEqual({
      name: "a.pdf",
      mimeType: "application/pdf",
      base64: "JVBERg==",
      path: "L/a.pdf",
    });
    expect(attachmentFromBytes("b.JPG", bytes("x"))?.mimeType).toBe("image/jpeg");
    expect(attachmentFromBytes("c.md", bytes("# Héllo"))).toEqual({
      name: "c.md",
      mimeType: "text/plain",
      text: "# Héllo",
    });
    expect(attachmentFromBytes("d.zip", bytes("x"))).toBeNull();
  });

  it("measures files as they travel", () => {
    expect(
      attachmentBytes({ name: "a.pdf", mimeType: "application/pdf", base64: "JVBERg==" }),
    ).toBe(6);
    expect(attachmentBytes({ name: "c.md", mimeType: "text/plain", text: "é" })).toBe(2);
    expect(sizeLabel(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(sizeLabel(10)).toBe("1 KB");
  });

  it("refuses a file twice, or past the chat's limit", () => {
    const a = { name: "a.pdf", mimeType: "application/pdf", base64: "AAAA", path: "x/a.pdf" };
    const sameName = { ...a, path: "y/a.pdf" };
    expect(sameAttachment(a, { ...a })).toBe(true);
    expect(sameAttachment(a, sameName)).toBe(false);
    expect(sameAttachment({ ...a, path: undefined }, { ...a, path: undefined })).toBe(true);
    expect(attachRefusal(a, [a])).toMatch(/already attached/);
    expect(attachRefusal(a, [])).toBeNull();
    const big = { name: "big.md", mimeType: "text/plain", text: "x".repeat(ATTACH_MAX_BYTES) };
    expect(attachRefusal(a, [big])).toMatch(/too big/);
  });

  it("finds the notebook's PDFs behind the picked pages", () => {
    const pdf = (path: string, page: number): Backdrop => ({ kind: "pdf", path, page });
    const backdrops: Backdrop[] = [
      { kind: "blank" } as Backdrop,
      pdf("L/Week 2.pdf", 0),
      pdf("L/Week 2.pdf", 1),
      pdf("L/Week 3.pdf", 0),
    ];
    expect(pdfsBehind(backdrops, [4, 1, 3, 2, 9])).toEqual([
      { path: "L/Week 2.pdf", pages: [2, 3] },
      { path: "L/Week 3.pdf", pages: [4] },
    ]);
    expect(pdfsBehind(backdrops, [1])).toEqual([]);
    expect(fileNameOf("L/Week 2.pdf")).toBe("Week 2.pdf");
    expect(fileNameOf("top.pdf")).toBe("top.pdf");
  });
});
