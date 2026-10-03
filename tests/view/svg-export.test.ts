import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POINTS_PER_PAGE_PX } from "../../src/export/pdf-writer";

const mocks = vi.hoisted(() => ({
  sanitize: vi.fn(),
  convert: vi.fn(),
  load: vi.fn(),
  release: vi.fn(),
  construct: vi.fn(),
  output: vi.fn(),
}));
vi.mock("dompurify", () => ({ default: { sanitize: mocks.sanitize } }));
vi.mock("svg2pdf.js", () => ({ svg2pdf: mocks.convert }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(options: unknown) {
      mocks.construct(options);
    }
    output = mocks.output;
  },
}));
vi.mock("../../src/view/image-import", () => ({ loadImage: mocks.load }));
const { renderSvgPdf } = await import("../../src/view/svg-export");
class Element {
  localName = "svg";
  attrs: Record<string, string> = {};
  children: Element[] = [];
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  appendChild(child: Element) {
    this.children.push(child);
  }
}
let invalid: boolean;
let unsupported: boolean;
let original: Element;
beforeEach(() => {
  vi.clearAllMocks();
  invalid = false;
  unsupported = false;
  original = new Element();
  vi.stubGlobal(
    "DOMParser",
    class {
      parseFromString() {
        return {
          documentElement: original,
          querySelector: (selector: string) => (selector === "parsererror" ? invalid : unsupported),
        };
      }
    },
  );
  vi.stubGlobal("document", { createElementNS: () => new Element() });
  mocks.sanitize.mockReturnValue({ firstElementChild: original });
  mocks.load.mockResolvedValue({ width: 100, height: 80, release: mocks.release });
  mocks.output.mockReturnValue(new Uint8Array([1, 2]).buffer);
  mocks.convert.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
const image = { id: "i", path: "art.svg", x: 20, y: 30, w: 200, h: 160 };
describe("SVG export adapter", () => {
  it("converts a sanitized vector source once at its intrinsic size with compressed compact coordinates", async () => {
    const bytes = new ArrayBuffer(10);
    const result = await renderSvgPdf(bytes, image.path);
    expect(result).toEqual(new Uint8Array([1, 2]));
    expect(mocks.sanitize).toHaveBeenCalledWith(original, {
      USE_PROFILES: { svg: true },
      RETURN_DOM_FRAGMENT: true,
    });
    const root = mocks.convert.mock.calls[0][0] as Element;
    expect(root.attrs.viewBox).toBe("0 0 100 80");
    expect(root.children).toEqual([original]);
    expect(original.attrs).toEqual({ x: "0", y: "0", width: "100", height: "80" });
    expect(mocks.construct).toHaveBeenCalledWith({
      orientation: "landscape",
      unit: "pt",
      format: [100 * POINTS_PER_PAGE_PX, 80 * POINTS_PER_PAGE_PX],
      compress: true,
      floatPrecision: 5,
    });
    expect(mocks.convert.mock.calls[0][2]).toMatchObject({ loadExternalStyleSheets: false });
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("supports uncropped landscape placements and releases the decoder when conversion fails", async () => {
    mocks.convert.mockRejectedValue(new Error("conversion failed"));
    await expect(renderSvgPdf(new ArrayBuffer(0), image.path)).rejects.toThrow("conversion failed");
    const root = mocks.convert.mock.calls[0][0] as Element;
    expect(root.attrs.viewBox).toBe("0 0 100 80");
    expect(mocks.construct.mock.calls[0][0].orientation).toBe("landscape");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("fits oversized SVG source pages without clipping their viewBox", async () => {
    mocks.load.mockResolvedValue({ width: 100000, height: 200000, release: mocks.release });
    await renderSvgPdf(new ArrayBuffer(0), image.path);
    const root = mocks.convert.mock.calls[0][0] as Element;
    expect(root.attrs.viewBox).toBe("0 0 100000 200000");
    expect(mocks.construct.mock.calls[0][0].format[0]).toBeCloseTo(7200);
    expect(mocks.construct.mock.calls[0][0].format[1]).toBeCloseTo(14400);
  });
  it.each(["parser", "root", "unsupported", "empty"])(
    "rejects %s inputs before decoding or converting",
    async (kind) => {
      invalid = kind === "parser";
      unsupported = kind === "unsupported";
      if (kind === "root") original.localName = "html";
      if (kind === "empty") mocks.sanitize.mockReturnValue({ firstElementChild: null });
      await expect(renderSvgPdf(new ArrayBuffer(0), image.path)).rejects.toThrow(/SVG/);
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.convert).not.toHaveBeenCalled();
    },
  );
});
