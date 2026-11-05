import { describe, expect, it } from "vitest";
import { deflateToBase64 } from "../../src/model/compress";
import {
  claimsNotebook,
  dataUrlToBytes,
  extractBlock,
  fitInto,
  isNotebookName,
  jpegBytesToDataUrl,
  linkTarget,
  parseImage,
  parseStroke,
  parseThumbnailPage,
  readNotebookText,
  readThumbnailPage,
  thumbnailHash,
} from "../../src/model/folder-thumbnail";

/** A notebook note as FineNotes writes it: a title, then the data block. */
function note(doc: unknown, label = "goodobsidian"): string {
  return `# Title\n\n%%${label}\nv2:${deflateToBase64(JSON.stringify(doc))}\n%%\n`;
}

describe("the data block", () => {
  it("is found under the current label and the one before 0.2.0", () => {
    expect(extractBlock("text\n%%goodobsidian\nv2:abc\n%%\nmore")).toBe("v2:abc");
    expect(extractBlock("text\n%%inkedmark\nv1:abc\n%%\n")).toBe("v1:abc");
    expect(extractBlock("no block here")).toBeNull();
    expect(extractBlock("%%comment%%")).toBeNull();
  });
});

describe("reading a notebook's text (search)", () => {
  it("collects every page's text boxes, one per line, and its PDF backdrop", () => {
    const text = note({
      pages: [
        { textBoxes: [{ text: "First" }, { text: "  " }, { text: "Second" }, { text: 5 }, null] },
        { backdrop: { kind: "pdf", path: "Books/Atlas.pdf", page: 2.4 } },
        "not a page",
        { backdrop: { kind: "pdf", path: "", page: 1 }, textBoxes: [{ text: "x" }] },
      ],
    });
    expect(readNotebookText(text)).toEqual([
      { text: "First\nSecond" },
      { text: "", pdf: { path: "Books/Atlas.pdf", page: 2 } },
      { text: "" },
      { text: "x" },
    ]);
  });

  it("gives null for anything that is not a readable notebook", () => {
    expect(readNotebookText("plain note")).toBeNull();
    expect(readNotebookText("%%goodobsidian\nnot-versioned\n%%\n")).toBeNull();
    expect(readNotebookText("%%goodobsidian\nv2:!!!not base64!!!\n%%\n")).toBeNull();
    expect(readNotebookText(note({ pages: "none" }))).toBeNull();
    expect(readNotebookText(note([1, 2]))).toBeNull();
  });
});

describe("reading a notebook's first page (thumbnail)", () => {
  it("reads the paper, pictures and strokes of the first page only", () => {
    const text = note({
      view: { width: 900 },
      pages: [
        {
          geometry: { width: 1000, height: 1400 },
          backdrop: { kind: "squared", paperColor: "#fffbe6", color: "#aabbcc", spacing: 30 },
          images: [{ path: "pic.png", x: 10, y: 20, w: 200, h: 100 }],
          strokes: [{ pts: [100, 200, 255, 300, 400, 0], color: "#ff0000", size: 3, tool: "pen" }],
        },
        { strokes: [{ pts: [1, 1, 1] }] },
      ],
    });
    const page = readThumbnailPage(text);
    expect(page).toMatchObject({
      width: 1000,
      height: 1400,
      ruling: "squared",
      paperColor: "#fffbe6",
      ruleColor: "#aabbcc",
      spacing: 30,
    });
    expect(page?.images).toHaveLength(1);
    expect(page?.strokes).toEqual([
      { color: "#ff0000", size: 3, highlighter: false, pts: [1, 2, 1, 3, 4, 0], shape: false },
    ]);
  });

  it("shows a PDF page as the backdrop, in place of the ruling", () => {
    const page = parseThumbnailPage({
      pages: [{ backdrop: { kind: "pdf", path: "a.pdf", page: 3, paperColor: "#000000" } }],
    });
    expect(page?.pdf).toEqual({ path: "a.pdf", page: 3 });
    expect(page?.ruling).toBe("blank");
    expect(page?.paperColor).toBe("#ffffff");
  });

  it("takes the view's width and the default height when the page has no geometry", () => {
    expect(parseThumbnailPage({ view: { width: 800 }, pages: [{}] })).toMatchObject({
      width: 800,
      height: 1448,
    });
    expect(parseThumbnailPage({ pages: [{}] })).toMatchObject({ width: 1024, height: 1448 });
    expect(parseThumbnailPage({ pages: [{ geometry: { width: -5, height: 0 } }] })).toMatchObject({
      width: 1024,
      height: 1448,
    });
  });

  it("gives null when there is no first page", () => {
    expect(parseThumbnailPage(null)).toBeNull();
    expect(parseThumbnailPage({ pages: [] })).toBeNull();
    expect(parseThumbnailPage({ pages: [7] })).toBeNull();
    expect(readThumbnailPage("plain")).toBeNull();
    expect(readThumbnailPage("%%goodobsidian\nvx:abc\n%%\n")).toBeNull();
  });

  it("reads a version written with a suffix, such as v2+beta", () => {
    const body = deflateToBase64(JSON.stringify({ pages: [{}] }));
    expect(readThumbnailPage(`%%goodobsidian\nv2+x:${body}\n%%\n`)).not.toBeNull();
  });
});

describe("a stroke", () => {
  it("has its points as hundredths and its pressure as 0 to 255", () => {
    expect(
      parseStroke({
        pts: [150, 250, 51],
        color: "#123456",
        size: 4,
        tool: "highlighter",
        shape: "line",
      }),
    ).toEqual({
      color: "#123456",
      size: 4,
      highlighter: true,
      pts: [1.5, 2.5, 0.2],
      shape: true,
    });
  });

  it("drops a trailing partial point and zeroes bad numbers", () => {
    expect(parseStroke({ pts: [100, 100, 255, 100, 100] })?.pts).toEqual([1, 1, 1]);
    expect(parseStroke({ pts: [Number.NaN, "x", 255] })?.pts).toEqual([0, 0, 1]);
  });

  it("has defaults for colour and size, and is null without points", () => {
    expect(parseStroke({ pts: [], size: -1 })).toMatchObject({ color: "#111111", size: 2 });
    expect(parseStroke({})).toBeNull();
    expect(parseStroke(null)).toBeNull();
  });
});

describe("a picture", () => {
  it("is a path with its place, size, turn, flips and crop", () => {
    expect(
      parseImage({
        path: "pic.png",
        x: 1,
        y: 2,
        w: 30,
        h: 40,
        rotation: 0.5,
        crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
        flipX: true,
        front: true,
        opacity: 0.5,
      }),
    ).toEqual({
      path: "pic.png",
      x: 1,
      y: 2,
      w: 30,
      h: 40,
      rotation: 0.5,
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
      flipX: true,
      flipY: false,
      front: true,
      opacity: 0.5,
      sticky: undefined,
    });
  });

  it("has sizes of at least one, opacity of 1 unless between 0 and 1, and ignores a bad crop", () => {
    const image = parseImage({
      path: "a",
      w: 0,
      h: -4,
      opacity: 2,
      crop: { x: 0, y: 0, w: 0, h: 1 },
    });
    expect(image).toMatchObject({ w: 1, h: 1, opacity: 1, crop: undefined });
    expect(parseImage({ path: "a" })).toMatchObject({ w: 100, h: 100 });
  });

  it("can be a sticky note, which has no crop", () => {
    expect(
      parseImage({ sticky: { color: "#ffee99" }, crop: { x: 0, y: 0, w: 1, h: 1 } }),
    ).toMatchObject({
      sticky: "#ffee99",
      path: "",
      crop: undefined,
    });
  });

  it("is nothing without a path or a sticky colour", () => {
    expect(parseImage({ x: 1 })).toBeNull();
    expect(parseImage("pic.png")).toBeNull();
  });
});

describe("fitInto", () => {
  it("scales a page to fit and centres it", () => {
    expect(fitInto({ width: 100, height: 200 }, { width: 100, height: 100 })).toEqual({
      fit: 0.5,
      dx: 25,
      dy: 0,
    });
    expect(fitInto({ width: 200, height: 100 }, { width: 100, height: 100 })).toEqual({
      fit: 0.5,
      dx: 0,
      dy: 25,
    });
  });
});

describe("thumbnail files", () => {
  it("are named by a stable 16 character fingerprint", () => {
    const hash = thumbnailHash("2:Physics.notebook.md:1700000000000");
    expect(hash).toBe(thumbnailHash("2:Physics.notebook.md:1700000000000"));
    expect(hash).not.toBe(thumbnailHash("2:Physics.notebook.md:1700000000001"));
    expect(hash).toMatch(/^[0-9a-f-]{9,17}$/);
  });

  it("round-trip a JPEG through a data URL", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3]);
    const url = jpegBytesToDataUrl(bytes.buffer);
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect([...new Uint8Array(dataUrlToBytes(url))]).toEqual([...bytes]);
  });

  it("round-trip more bytes than one slice holds", () => {
    const bytes = new Uint8Array(20000).map((_, i) => i % 251);
    expect([...new Uint8Array(dataUrlToBytes(jpegBytesToDataUrl(bytes.buffer)))]).toEqual([
      ...bytes,
    ]);
  });
});

describe("what is a notebook", () => {
  it("is named .notebook.md or .page.md, or claimed by its frontmatter", () => {
    expect(isNotebookName("Physics.notebook.md")).toBe(true);
    expect(isNotebookName("Sketch.PAGE.md")).toBe(true);
    expect(isNotebookName("Note.md")).toBe(false);
    expect(isNotebookName("Physics.notebook")).toBe(false);
    expect(claimsNotebook(true)).toBe(true);
    expect(claimsNotebook("true")).toBe(true);
    expect(claimsNotebook("yes")).toBe(false);
    expect(claimsNotebook(undefined)).toBe(false);
  });

  it("links to a file by its name, without a heading or a size", () => {
    expect(linkTarget("Photo.png#page=2")).toBe("Photo.png");
    expect(linkTarget("Photo.png|300")).toBe("Photo.png");
    expect(linkTarget("  Photo.png  ")).toBe("Photo.png");
  });
});
