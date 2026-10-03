/** Source PDFs and converted SVGs remain PDF content, with raster annotation overlays. */
import {
  BlendMode,
  PDFDocument,
  degrees,
  rgb,
  type PDFPage,
  type PDFEmbeddedPage,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
} from "pdf-lib";
import { uncroppedBox } from "../canvas/image-crop";
import { fromImageLocal, rotationOf } from "../canvas/image-geometry";
import { removeUnusedPdfObjects } from "./pdf-resources";
import type { ImageElement, Page } from "../model/document";
import { POINTS_PER_PAGE_PX, type PdfImagePage } from "./pdf-writer";

export interface PdfAnnotationRaster {
  png: Uint8Array;
  multiply?: boolean;
}

export type PdfAnnotation =
  PdfAnnotationRaster | { pdf: Uint8Array; key?: string; image?: ImageElement };

export class PdfComposer {
  private readonly documents = new Map<string, Promise<PDFDocument>>();
  private readonly svgEmbedded = new Map<string, PDFEmbeddedPage>();
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

  async addImage(page: PdfImagePage, overlay?: () => AsyncIterable<PdfAnnotation>): Promise<void> {
    const target = this.output.addPage([page.widthPt, page.heightPt]);
    const image = await this.output.embedJpg(page.jpeg);
    target.drawImage(image, { width: page.widthPt, height: page.heightPt });
    if (overlay) await this.addLayers(target, overlay());
  }

  /** Fails clearly if a source is missing/unreadable, never silently flattens it. */
  async addPdf(page: Page, overlay: () => AsyncIterable<PdfAnnotation>): Promise<void> {
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
    await this.addLayers(target, overlay());
  }

  private async addLayers(target: PDFPage, layers: AsyncIterable<PdfAnnotation>): Promise<void> {
    const { width, height } = target.getSize();
    for await (const layer of layers) {
      if ("pdf" in layer) {
        let embedded = layer.key ? this.svgEmbedded.get(layer.key) : undefined;
        if (!embedded) {
          const source = await PDFDocument.load(layer.pdf);
          embedded = await this.output.embedPage(source.getPage(0));
          if (layer.key) this.svgEmbedded.set(layer.key, embedded);
        }
        if (layer.image) {
          const image = layer.image;
          const point = (x: number, y: number) => {
            const p = fromImageLocal(image, { x, y });
            return { x: p.x * POINTS_PER_PAGE_PX, y: height - p.y * POINTS_PER_PAGE_PX };
          };
          const corners = [
            point(-image.w / 2, -image.h / 2),
            point(image.w / 2, -image.h / 2),
            point(image.w / 2, image.h / 2),
            point(-image.w / 2, image.h / 2),
          ];
          target.pushOperators(
            pushGraphicsState(),
            moveTo(corners[0].x, corners[0].y),
            ...corners.slice(1).map((p) => lineTo(p.x, p.y)),
            closePath(),
            clip(),
            endPath(),
          );
          const full = uncroppedBox(image);
          const origin = fromImageLocal(full, { x: -full.w / 2, y: full.h / 2 });
          target.drawPage(embedded, {
            x: origin.x * POINTS_PER_PAGE_PX,
            y: height - origin.y * POINTS_PER_PAGE_PX,
            width: full.w * POINTS_PER_PAGE_PX,
            height: full.h * POINTS_PER_PAGE_PX,
            rotate: degrees((-rotationOf(image) * 180) / Math.PI),
          });
          target.pushOperators(popGraphicsState());
        } else target.drawPage(embedded, { width, height });
      } else {
        const png = await this.output.embedPng(layer.png);
        target.drawImage(png, {
          width,
          height,
          ...(layer.multiply ? { blendMode: BlendMode.Multiply } : {}),
        });
      }
    }
  }

  async save(): Promise<Uint8Array> {
    await this.output.flush();
    removeUnusedPdfObjects(this.output);
    return this.output.save();
  }
}
