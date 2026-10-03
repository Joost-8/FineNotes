import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { blankPage, type Stroke } from "../../src/model/document";
import { LIGHT_PAPER } from "../../src/canvas/backdrop";

vi.mock("../../src/view/svg-export", () => ({ renderSvgPdf: vi.fn() }));
vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/canvas/renderer", () => ({
  renderPageThumbnail: vi.fn((canvas: HTMLCanvasElement) => {
    canvas.width = 8;
    canvas.height = 8;
  }),
}));
const { renderPageThumbnail } = await import("../../src/canvas/renderer");
const { exportPagesToPdf } = await import("../../src/view/pdf-export");
const jpg = readFileSync(new URL("../export/fixtures/white.jpg", import.meta.url));
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=",
    "base64",
  ),
);
const sources = {
  pdf: null,
  images: null,
  paper: LIGHT_PAPER,
  usePressure: false,
  highlighterAlpha: 0.3,
};
const pdfPage = () => ({
  ...blankPage("p1"),
  backdrop: { kind: "pdf" as const, path: "Lecture.pdf", page: 0 },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("createEl", () => ({
    width: 0,
    height: 0,
    toBlob: (callback: (blob: Blob) => void, mime: string) =>
      callback(new Blob([mime === "image/png" ? png : jpg], { type: mime })),
  }));
});
afterEach(() => vi.unstubAllGlobals());
async function source() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText("Original PDF text", { font });
  return (await doc.save()).slice().buffer as ArrayBuffer;
}
describe("existing PDF export integration", () => {
  it("composes PDF source with annotation layers alongside ordinary pages", async () => {
    const page = pdfPage();
    page.textBoxes.push({
      id: "t1",
      x: 10,
      y: 10,
      w: 200,
      text: "Notebook text",
      fontSize: 16,
      color: "#000",
    });
    page.strokes = [
      { id: "s1", tool: "highlighter", color: "#ff0", size: 10, pts: [0, 0, 0.5, 50, 50, 0.5] },
      { id: "s2", tool: "pen", color: "#000", size: 3, pts: [0, 0, 0.5, 50, 50, 0.5] },
    ] as Stroke[];
    const readPdf = vi.fn(source);
    const onProgress = vi.fn();
    const bytes = await exportPagesToPdf(
      [page, blankPage("p2")],
      { ...sources, readPdf },
      { title: "Notebook", onProgress },
    );
    const result = await PDFDocument.load(bytes);
    expect(result.getPageCount()).toBe(2);
    expect(readPdf).toHaveBeenCalledWith("Lecture.pdf");
    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(
      vi.mocked(renderPageThumbnail).mock.calls.map((call) => call[5].transparent ?? false),
    ).toEqual([true, true, true, false]);
    expect(
      vi
        .mocked(renderPageThumbnail)
        .mock.calls.map((call) => call[1].strokes.map((stroke) => stroke.id)),
    ).toEqual([[], ["s1"], ["s2"], []]);
  });
  it("keeps an unannotated PDF page entirely vector without rasterizing its backdrop", async () => {
    const bytes = await exportPagesToPdf(
      [pdfPage()],
      { ...sources, readPdf: source },
      { title: "PDF" },
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(renderPageThumbnail).not.toHaveBeenCalled();
  });
  it("retains the existing ordinary-page export without needing source PDF access", async () => {
    const bytes = await exportPagesToPdf([blankPage("p1")], sources, { title: "Plain" });
    expect(Buffer.from(bytes.subarray(0, 8)).toString()).toBe("%PDF-1.4");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("stops on missing PDF sources rather than exporting a placeholder", async () => {
    await expect(
      exportPagesToPdf(
        [pdfPage()],
        {
          ...sources,
          readPdf: async () => {
            throw new Error("Missing PDF source");
          },
        },
        { title: "Missing" },
      ),
    ).rejects.toThrow("Missing PDF source");
    expect(renderPageThumbnail).not.toHaveBeenCalled();
  });
  it("honors cancellation before rendering and checks after the final page", async () => {
    await expect(
      exportPagesToPdf(
        [pdfPage()],
        { ...sources, readPdf: source },
        { title: "Stop", cancelled: () => true },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    let cancelled = false;
    vi.mocked(renderPageThumbnail).mockImplementationOnce((canvas) => {
      canvas.width = canvas.height = 8;
      cancelled = true;
    });
    await expect(
      exportPagesToPdf([blankPage("p1")], sources, { title: "Stop", cancelled: () => cancelled }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("SVG export integration", () => {
  it.each([true, false])("keeps SVG vector layers on PDF/ordinary pages (%s)", async (backdrop) => {
    const { renderSvgPdf } = await import("../../src/view/svg-export");
    const page = backdrop ? pdfPage() : blankPage();
    page.images = ["photo.png", "art.SVG", "top.jpg"].map((path, i) => ({
      id: String(i),
      path,
      x: 10,
      y: 10,
      w: 100,
      h: 100,
    }));
    const converted = new Uint8Array(await source());
    vi.mocked(renderSvgPdf).mockResolvedValue(converted);
    const original = new ArrayBuffer(10);
    const readSvg = vi.fn(async () => original);
    const output = await exportPagesToPdf(
      [page],
      { ...sources, readPdf: source, readSvg },
      { title: "Vectors" },
    );
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
    expect(readSvg).toHaveBeenCalledExactlyOnceWith("art.SVG");
    expect(renderSvgPdf).toHaveBeenCalledWith(original, "art.SVG");
    const painted = vi
      .mocked(renderPageThumbnail)
      .mock.calls.map((c) => c[1].images.map((i) => i.path));
    expect(painted).toEqual(
      backdrop ? [["photo.png"], ["top.jpg"]] : [[], ["photo.png"], ["top.jpg"]],
    );
  });
  it("converts and reads each SVG source once across repeated placements and pages", async () => {
    const { renderSvgPdf } = await import("../../src/view/svg-export");
    vi.mocked(renderSvgPdf).mockResolvedValue(new Uint8Array(await source()));
    const page = blankPage();
    page.images = [0, 1].map((i) => ({
      id: String(i),
      path: "art.svg",
      x: i * 20,
      y: 0,
      w: 10,
      h: 10,
    }));
    const readSvg = vi.fn(async () => new ArrayBuffer(10));
    await exportPagesToPdf(
      [page, { ...page, id: "p2" }],
      { ...sources, readSvg },
      { title: "Shared" },
    );
    expect(readSvg).toHaveBeenCalledOnce();
    expect(renderSvgPdf).toHaveBeenCalledOnce();
  });
  it("fails clearly without SVG source access or when conversion fails", async () => {
    const page = blankPage();
    page.images.push({ id: "i", path: "art.svg", x: 0, y: 0, w: 10, h: 10 });
    await expect(exportPagesToPdf([page], sources, { title: "SVG" })).rejects.toThrow(
      "SVG source reader unavailable",
    );
    const { renderSvgPdf } = await import("../../src/view/svg-export");
    vi.mocked(renderSvgPdf).mockRejectedValue(new Error("Unsupported SVG"));
    await expect(
      exportPagesToPdf(
        [page],
        { ...sources, readSvg: async () => new ArrayBuffer(0) },
        { title: "SVG" },
      ),
    ).rejects.toThrow("Unsupported SVG");
  });
});
