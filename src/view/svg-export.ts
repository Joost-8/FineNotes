/** Browser SVG conversion; composition and annotation ordering remain in the existing exporter. */
import { POINTS_PER_PAGE_PX } from "../export/pdf-writer";
import { loadImage } from "./image-import";

const NS = "http://www.w3.org/2000/svg";

/** No canvas flattening: unsupported SVG effects fail rather than silently disappearing. */
export async function renderSvgPdf(bytes: ArrayBuffer, path: string): Promise<Uint8Array> {
  const parsed = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg")
    throw new Error(`Invalid SVG — ${path}`);
  if (parsed.querySelector("filter, foreignObject, animate, animateTransform, animateMotion, set"))
    throw new Error(`SVG filters, HTML and animation cannot be exported as vectors — ${path}`);
  // These browser-only libraries are needed only when exporting an SVG.
  const [{ default: DOMPurify }, { jsPDF }, { svg2pdf }] = await Promise.all([
    import("dompurify"),
    import("jspdf"),
    import("svg2pdf.js"),
  ]);
  const fragment = DOMPurify.sanitize(parsed.documentElement, {
    USE_PROFILES: { svg: true },
    RETURN_DOM_FRAGMENT: true,
  });
  const original = fragment.firstElementChild;
  if (!original) throw new Error(`Invalid SVG — ${path}`);
  const loaded = await loadImage(bytes, "image/svg+xml");
  try {
    const root = document.createElementNS(NS, "svg");
    root.setAttribute("width", String(loaded.width));
    root.setAttribute("height", String(loaded.height));
    root.setAttribute("viewBox", `0 0 ${loaded.width} ${loaded.height}`);
    original.setAttribute("x", "0");
    original.setAttribute("y", "0");
    original.setAttribute("width", String(loaded.width));
    original.setAttribute("height", String(loaded.height));
    root.appendChild(original);
    // PDF pages are limited to 200 inches; fit large SVG sources without clipping.
    const fit = Math.min(1, 14400 / (Math.max(loaded.width, loaded.height) * POINTS_PER_PAGE_PX));
    const width = loaded.width * POINTS_PER_PAGE_PX * fit;
    const height = loaded.height * POINTS_PER_PAGE_PX * fit;
    const pdf = new jsPDF({
      orientation: width > height ? "landscape" : "portrait",
      unit: "pt",
      compress: true,
      floatPrecision: 5,
      format: [width, height],
    });
    await svg2pdf(root, pdf, {
      width,
      height,
      loadExternalStyleSheets: false,
      loadImages: /^data:image\/(?:png|jpeg);base64,/i,
    });
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    loaded.release();
  }
}
