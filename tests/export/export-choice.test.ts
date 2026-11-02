import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMATS,
  exportFormatOf,
  exportOpening,
  exportSummary,
  exportTarget,
  extensionOf,
  formatLabel,
  mimeTypeOf,
  pageImageName,
  savedText,
} from "../../src/export/export-choice";

const none = new Set<string>();

describe("export formats", () => {
  it("offers PDF, PNG and JPG, in that order", () => {
    expect(EXPORT_FORMATS.map(formatLabel)).toEqual(["PDF", "PNG", "JPG"]);
  });

  it("reads a stored format, and PDF for anything else", () => {
    expect(exportFormatOf("png")).toBe("png");
    expect(exportFormatOf("jpg")).toBe("jpg");
    expect(exportFormatOf(undefined)).toBe("pdf");
    expect(exportFormatOf("gif")).toBe("pdf");
    expect(exportFormatOf("toString")).toBe("pdf");
  });

  it("names each format's extension and type", () => {
    expect(EXPORT_FORMATS.map(extensionOf)).toEqual([".pdf", ".png", ".jpg"]);
    expect(EXPORT_FORMATS.map(mimeTypeOf)).toEqual(["application/pdf", "image/png", "image/jpeg"]);
  });
});

describe("exportTarget", () => {
  it("writes a PDF as one file, whatever the page count", () => {
    expect(exportTarget("Biology.ink", [0, 1, 2], 3, "pdf", none)).toEqual({
      kind: "file",
      name: "Biology.pdf",
    });
    expect(exportTarget("Biology", [1, 2], 3, "pdf", none)).toEqual({
      kind: "file",
      name: "Biology (pages 2-3).pdf",
    });
  });

  it("writes one page as one picture, named as the PDF would be", () => {
    expect(exportTarget("Biology", [2], 12, "png", none)).toEqual({
      kind: "file",
      name: "Biology (page 3).png",
    });
    expect(exportTarget("Biology", [0], 1, "jpg", none)).toEqual({
      kind: "file",
      name: "Biology.jpg",
    });
  });

  it("puts several pictures into a new folder, one per page", () => {
    expect(exportTarget("Biology", [4, 1, 6], 12, "png", none)).toEqual({
      kind: "folder",
      folder: "Biology (pages 5,2,7) PNG",
      names: ["Biology page 05.png", "Biology page 02.png", "Biology page 07.png"],
    });
    expect(exportTarget("Biology", [0, 1, 2], 3, "jpg", none)).toEqual({
      kind: "folder",
      folder: "Biology JPG",
      names: ["Biology page 1.jpg", "Biology page 2.jpg", "Biology page 3.jpg"],
    });
  });

  it("never reuses a name already taken, file or folder", () => {
    const taken = new Set(["Biology.pdf", "biology png", "Biology (page 3).jpg"]);
    expect(exportTarget("Biology", [0, 1], 2, "pdf", taken)).toEqual({
      kind: "file",
      name: "Biology 1.pdf",
    });
    expect(exportTarget("Biology", [0, 1], 2, "png", taken)).toMatchObject({
      folder: "Biology PNG 1",
    });
    expect(exportTarget("Biology", [2], 5, "jpg", taken)).toEqual({
      kind: "file",
      name: "Biology (page 3) 1.jpg",
    });
  });
});

describe("pageImageName", () => {
  it("pads the page number to the notebook's last page", () => {
    expect(pageImageName("Biology", 2, 9, "png")).toBe("Biology page 3.png");
    expect(pageImageName("Biology", 2, 10, "png")).toBe("Biology page 03.png");
    expect(pageImageName("Biology", 41, 120, "jpg")).toBe("Biology page 042.jpg");
  });

  it("sanitises the title and never leaves it empty", () => {
    expect(pageImageName("a/b:c", 0, 1, "png")).not.toMatch(/[/:]/);
    expect(pageImageName("", 0, 1, "png")).toBe("Notebook page 1.png");
  });

  it("never pads short of the page's own number", () => {
    expect(pageImageName("Biology", 11, 3, "png")).toBe("Biology page 12.png");
  });
});

describe("exportOpening", () => {
  it("opens on the whole notebook when nothing was chosen", () => {
    expect(exportOpening(undefined, 12, 4)).toEqual({ preset: false, scope: "all", chosen: [4] });
    expect(exportOpening([], 12, 4)).toEqual({ preset: false, scope: "all", chosen: [4] });
  });

  it("opens on the page itself for a single page", () => {
    expect(exportOpening(undefined, 1, 0)).toEqual({
      preset: false,
      scope: "current",
      chosen: [0],
    });
  });

  it("shows pages chosen beforehand without asking for them again", () => {
    expect(exportOpening([4, 1, 6], 12, 0)).toEqual({
      preset: true,
      scope: "custom",
      chosen: [4, 1, 6],
    });
  });

  it("drops chosen pages that no longer exist, and repeats", () => {
    expect(exportOpening([3, 20, -1, 1.5, 3, 0], 12, 0).chosen).toEqual([3, 0]);
    expect(exportOpening([20], 12, 5)).toEqual({ preset: false, scope: "all", chosen: [5] });
  });
});

describe("exportSummary", () => {
  const file = { kind: "file" as const, name: "Biology.pdf" };

  it("says the count, the file and where, for the whole notebook", () => {
    const pages = [0, 1, 2];
    expect(
      exportSummary({
        pages,
        picked: false,
        target: file,
        format: "pdf",
        folder: null,
        noun: "notebook",
      }),
    ).toBe("3 pages, saved as “Biology.pdf” next to this notebook.");
    expect(
      exportSummary({
        pages: [0],
        picked: false,
        target: file,
        format: "pdf",
        folder: "Exports",
        noun: "page",
      }),
    ).toBe("1 page, saved as “Biology.pdf” in “Exports”.");
  });

  it("names picked pages, and their order when it is not the notebook's", () => {
    const base = { target: file, format: "pdf" as const, folder: null, noun: "notebook" };
    expect(exportSummary({ ...base, pages: [1, 4, 6], picked: true })).toBe(
      "3 pages (2, 5, 7), saved as “Biology.pdf” next to this notebook.",
    );
    expect(exportSummary({ ...base, pages: [4, 1], picked: true })).toBe(
      "2 pages (5, 2, in that order), saved as “Biology.pdf” next to this notebook.",
    );
  });

  it("says how many pictures go into which folder, in any order", () => {
    const target = exportTarget("Biology", [4, 1], 12, "png", none);
    expect(
      exportSummary({
        pages: [4, 1],
        picked: true,
        target,
        format: "png",
        folder: null,
        noun: "notebook",
      }),
    ).toBe(
      "2 pages (5, 2), saved as 2 PNG images in “Biology (pages 5,2) PNG” next to this notebook.",
    );
  });
});

describe("savedText", () => {
  it("names the one file, or counts the pictures in their folder", () => {
    expect(savedText(["Exports/Biology.pdf"], "Exports/Biology.pdf")).toBe(
      "Saved “Exports/Biology.pdf”.",
    );
    expect(savedText(["F/a.png", "F/b.png"], "F")).toBe("Saved 2 images in “F”.");
  });
});
