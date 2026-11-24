/**
 * PDF composition with pdf-lib: a PDF backdrop's page stays PDF content, with
 * the annotations laid over it; any other page is a JPEG, or (vector ink) a
 * layered page — a JPEG of what lies under the ink, the ink as vector paths
 * (`./vector-ink`), and a transparent PNG of what lies over it.
 */
import {
  BlendMode,
  PDFDocument,
  PDFName,
  type PDFPage,
  type PDFRef,
  degrees,
  rgb,
  type PDFEmbeddedPage,
} from "pdf-lib";
import { type Page, pdfFrameOf } from "../model/document";
import { POINTS_PER_PAGE_PX, type PdfImagePage } from "./pdf-writer";
import type { VectorInk } from "./vector-ink";

export interface PdfAnnotationRaster {
  png: Uint8Array;
  multiply?: boolean;
}

/** One layer of a page, bottom first: a raster, or the page's ink as vectors. */
export type PdfLayer =
  | PdfAnnotationRaster
  | { jpeg: Uint8Array }
  | {
      ink: VectorInk;
      /**
       * The size of the space the ink is drawn in, y down, filling the page:
       * a recorded canvas's device px (`./pdf-canvas`). Absent: page px.
       */
      box?: [number, number];
    };

export class PdfComposer {
  private readonly documents = new Map<string, Promise<PDFDocument>>();
  private readonly embedded = new Map<string, PDFEmbeddedPage>();
  /** Resource names this composer has given, so none repeats on a page. */
  private names = 0;

  private constructor(
    private readonly output: PDFDocument,
    private readonly readPdf: ((path: string) => Promise<ArrayBuffer>) | null,
  ) {}

  static async create(
    title: string,
    readPdf: ((path: string) => Promise<ArrayBuffer>) | null = null,
    subject?: string,
  ): Promise<PdfComposer> {
    const output = await PDFDocument.create();
    output.setTitle(title);
    if (subject) output.setSubject(subject);
    output.setProducer("FineNotes");
    output.setCreationDate(new Date());
    return new PdfComposer(output, readPdf);
  }

  async addImage(page: PdfImagePage): Promise<void> {
    const target = this.output.addPage([page.widthPt, page.heightPt]);
    const image = await this.output.embedJpg(page.jpeg);
    target.drawImage(image, { width: page.widthPt, height: page.heightPt });
  }

  /** A page of `widthPt` × `heightPt` points made of `layers`, bottom first, each filling it. */
  async addLayered(
    widthPt: number,
    heightPt: number,
    layers: AsyncIterable<PdfLayer> | Iterable<PdfLayer>,
  ): Promise<void> {
    if (!(widthPt > 0 && heightPt > 0 && Number.isFinite(widthPt * heightPt))) {
      throw new Error("A page has no size");
    }
    const target = this.output.addPage([widthPt, heightPt]);
    for await (const layer of layers) await this.drawLayer(target, widthPt, heightPt, layer);
  }

  /** Fails clearly if a source is missing/unreadable, never silently flattens it. */
  async addPdf(page: Page, overlay: () => AsyncIterable<PdfLayer>): Promise<void> {
    const backdrop = page.backdrop;
    if (backdrop.kind !== "pdf") throw new Error("A PDF backdrop is required");
    if (!this.readPdf) throw new Error("PDF source reader unavailable");
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
      // Fitted into the page, or into its frame on a page widened with Add space.
      // PDF points have y up: the frame's top in page px is its bottom here.
      const frame = pdfFrameOf(backdrop, page.geometry);
      const fw = frame.width * POINTS_PER_PAGE_PX;
      const fh = frame.height * POINTS_PER_PAGE_PX;
      const fx = frame.x * POINTS_PER_PAGE_PX;
      const fy = h - (frame.y + frame.height) * POINTS_PER_PAGE_PX;
      const scale = Math.min(fw / (rotated ? height : width), fh / (rotated ? width : height));
      const x = fx + (fw - (rotated ? height : width) * scale) / 2;
      const y = fy + (fh - (rotated ? width : height) * scale) / 2;
      // /Rotate is clockwise in PDF viewers; drawing operators rotate counterclockwise.
      target.drawPage(embedded, {
        x: x + (rotation === 180 || rotation === 270 ? (rotated ? height : width) * scale : 0),
        y: y + (rotation === 90 || rotation === 180 ? (rotated ? width : height) * scale : 0),
        xScale: scale,
        yScale: scale,
        rotate: degrees(-rotation),
      });
    }
    // Rasters go in pdf-lib's own content stream until a vector layer opens one of ours:
    // that stream sits under every later one, so after that every layer goes in one of ours.
    let own = false;
    for await (const layer of overlay()) {
      if (!own && "png" in layer) {
        const image = await this.output.embedPng(layer.png);
        target.drawImage(image, {
          width: w,
          height: h,
          ...(layer.multiply ? { blendMode: BlendMode.Multiply } : {}),
        });
        continue;
      }
      own = true;
      await this.drawLayer(target, w, h, layer);
    }
  }

  save(): Promise<Uint8Array> {
    return this.output.save();
  }

  private name(kind: string): string {
    return `Fn${kind}${this.names++}`;
  }

  /**
   * Draw a layer over everything on `target` so far, in a content stream of
   * its own: pdf-lib's drawing methods all append to the page's first one,
   * which would put a later raster under the ink.
   */
  private async drawLayer(target: PDFPage, w: number, h: number, layer: PdfLayer): Promise<void> {
    const context = this.output.context;
    const ops: string[] = ["q"];
    if ("ink" in layer) {
      const { ink, box } = layer;
      if (!ink.ops) return;
      const rename = new Map<string, string>();
      for (const [name, state] of ink.states) {
        const own = this.name("Gs");
        rename.set(name, own);
        target.node.setExtGState(
          PDFName.of(own),
          context.register(
            context.obj({
              Type: "ExtGState",
              CA: state.alpha,
              ca: state.alpha,
              BM: state.blend,
            }),
          ),
        );
      }
      for (const [name, group] of ink.groups) {
        const own = this.name("Ink");
        rename.set(name, own);
        const [x0, y0, x1, y1] = group.bbox;
        const form = context.flateStream(group.ops, {
          Type: "XObject",
          Subtype: "Form",
          BBox: [x0, y0, x1, y1],
          Group: { Type: "Group", S: "Transparency" },
        });
        target.node.setXObject(PDFName.of(own), context.register(form));
      }
      const sx = box ? w / box[0] : POINTS_PER_PAGE_PX;
      const sy = box ? h / box[1] : POINTS_PER_PAGE_PX;
      // y down: the top-left is (0, h) in points.
      ops.push(`${sx} 0 0 ${-sy} 0 ${h} cm`);
      ops.push(
        rename.size === 0
          ? ink.ops
          : ink.ops.replace(/\/((?:Gs|Ink)\d+) (gs|Do)/g, (all, name: string, op: string) => {
              const own = rename.get(name);
              return own ? `/${own} ${op}` : all;
            }),
      );
    } else {
      let ref: PDFRef;
      if ("jpeg" in layer) ref = (await this.output.embedJpg(layer.jpeg)).ref;
      else ref = (await this.output.embedPng(layer.png)).ref;
      const own = this.name("Im");
      target.node.setXObject(PDFName.of(own), ref);
      if ("png" in layer && layer.multiply) {
        const gs = this.name("Gs");
        target.node.setExtGState(
          PDFName.of(gs),
          context.register(context.obj({ Type: "ExtGState", BM: "Multiply" })),
        );
        ops.push(`/${gs} gs`);
      }
      ops.push(`${w} 0 0 ${h} 0 0 cm`, `/${own} Do`);
    }
    ops.push("Q");
    target.node.addContentStream(context.register(context.flateStream(ops.join("\n"))));
  }
}
