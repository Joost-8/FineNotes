/** PDF composition only: source pages remain PDF content; annotations are PNG overlays. */
import { BlendMode, PDFDocument, degrees, rgb, type PDFEmbeddedPage } from "pdf-lib";
import type { Page } from "../model/document";
import { POINTS_PER_PAGE_PX, type PdfImagePage } from "./pdf-writer";

export interface PdfAnnotationRaster {
  png: Uint8Array;
  multiply?: boolean;
}

export class PdfComposer {
  private readonly documents = new Map<string, Promise<PDFDocument>>();
  private readonly embedded = new Map<string, PDFEmbeddedPage>();

  private constructor(
    private readonly output: PDFDocument,
    private readonly readPdf: (path: string) => Promise<ArrayBuffer>,
  ) {}

  static async create(
    title: string,
    readPdf: (path: string) => Promise<ArrayBuffer>,
  ): Promise<PdfComposer> {
    const output = await PDFDocument.create();
    output.setTitle(title);
    output.setProducer("FineNotes");
    output.setCreationDate(new Date());
    return new PdfComposer(output, readPdf);
  }

  async addImage(page: PdfImagePage): Promise<void> {
    const target = this.output.addPage([page.widthPt, page.heightPt]);
    const image = await this.output.embedJpg(page.jpeg);
    target.drawImage(image, { width: page.widthPt, height: page.heightPt });
  }

  /** Fails clearly if a source is missing/unreadable, never silently flattens it. */
  async addPdf(page: Page, overlay: () => AsyncIterable<PdfAnnotationRaster>): Promise<void> {
    const backdrop = page.backdrop;
    if (backdrop.kind !== "pdf") throw new Error("A PDF backdrop is required");
    let source = this.documents.get(backdrop.path);
    if (!source) {
      source = this.readPdf(backdrop.path).then((bytes) => PDFDocument.load(bytes));
      this.documents.set(backdrop.path, source);
    }
    const original = (await source).getPages()[backdrop.page];
    if (!original) throw new Error(`Missing page ${backdrop.page + 1} in ${backdrop.path}`);
    const media = original.getMediaBox();
    const crop = original.getCropBox();
    // PDF viewers clip to the intersection of CropBox and MediaBox.
    const left = Math.max(media.x, crop.x);
    const bottom = Math.max(media.y, crop.y);
    const right = Math.min(media.x + media.width, crop.x + crop.width);
    const top = Math.min(media.y + media.height, crop.y + crop.height);
    const width = right - left;
    const height = top - bottom;
    if (!(width > 0 && height > 0)) throw new Error("PDF page has an empty crop box");
    const rotation = ((original.getRotation().angle % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error("Unsupported PDF page rotation");
    const rotated = rotation === 90 || rotation === 270;
    const w = page.geometry.width * POINTS_PER_PAGE_PX;
    const h = page.geometry.height * POINTS_PER_PAGE_PX;
    if (!(w > 0 && h > 0 && Number.isFinite(w * h))) throw new Error("A page has no size");
    const target = this.output.addPage([w, h]);
    target.drawRectangle({ width: w, height: h, color: rgb(1, 1, 1) });
    if (original.node.Contents()) {
      const key = JSON.stringify([backdrop.path, backdrop.page]);
      let embedded = this.embedded.get(key);
      if (!embedded) {
        embedded = await this.output.embedPage(original, { left, bottom, right, top });
        this.embedded.set(key, embedded);
      }
      const scale = Math.min(w / (rotated ? height : width), h / (rotated ? width : height));
      const x = (w - (rotated ? height : width) * scale) / 2;
      const y = (h - (rotated ? width : height) * scale) / 2;
      // /Rotate is clockwise in PDF viewers; drawing operators rotate counterclockwise.
      target.drawPage(embedded, {
        x: x + (rotation === 180 || rotation === 270 ? (rotated ? height : width) * scale : 0),
        y: y + (rotation === 90 || rotation === 180 ? (rotated ? width : height) * scale : 0),
        xScale: scale,
        yScale: scale,
        rotate: degrees(-rotation),
      });
    }
    for await (const layer of overlay()) {
      const png = await this.output.embedPng(layer.png);
      target.drawImage(png, {
        width: w,
        height: h,
        ...(layer.multiply ? { blendMode: BlendMode.Multiply } : {}),
      });
    }
  }

  save(): Promise<Uint8Array> {
    return this.output.save();
  }
}
