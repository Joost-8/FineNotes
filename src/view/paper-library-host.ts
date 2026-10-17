/**
 * "My templates" against the vault: the library's PDFs in the templates
 * folder's `Papers` folder (`model/paper-library.ts`), their page sizes, and
 * bringing in more, from the device or from the vault. A picture becomes a
 * one-page PDF on the way in (`import/image-pdf.ts`), drawn through a canvas
 * first so a photo's EXIF turn is the one the user saw.
 */

import { type App, FuzzySuggestModal, Notice, type TFile, normalizePath } from "obsidian";
import { picturePdf, rgbFromRgba } from "../import/image-pdf";
import type { PageGeometry, PdfBackdrop } from "../model/document";
import {
  MAX_PAPER_BYTES,
  type PaperEntry,
  isPaperSource,
  paperFileKind,
  paperBackdrop,
  paperEntries,
  paperGeometry,
  paperName,
  papersFolderOf,
} from "../model/paper-library";
import { imageMimeOf, loadImage, pickImageFile, releaseCanvas } from "./image-import";
import { measurePdfPages } from "./pdf-pages";
import type { PaperLibraryHost } from "./template-picker";

/** What the system file picker offers. */
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
/** A picture's longest side in the PDF, in pixels: sharp on any iPad, never huge. */
const MAX_PICTURE_SIDE = 3000;
/** The width previews are drawn at, in page px: only the shape matters. */
const PREVIEW_PAGE_WIDTH = 600;

export class VaultPaperLibrary implements PaperLibraryHost {
  /** Page sizes by library file, kept while its size and time are unchanged. */
  private readonly sizes = new Map<string, { stamp: string; entries: PaperEntry[] }>();

  constructor(
    private readonly app: App,
    /** The templates folder, as set now. */
    private readonly templateFolder: () => string,
    /** Paint a page with `backdrop` as a thumbnail. */
    private readonly paintPage: (
      canvas: HTMLCanvasElement,
      backdrop: PdfBackdrop,
      geometry: PageGeometry,
      cssWidth: number,
    ) => void,
    /** Open the community gallery; true when it added papers. */
    browse?: () => Promise<boolean>,
  ) {
    if (browse) this.browseCommunity = browse;
  }

  browseCommunity?: () => Promise<boolean>;

  get folder(): string {
    return normalizePath(papersFolderOf(this.templateFolder()));
  }

  async list(): Promise<PaperEntry[]> {
    const prefix = `${this.folder}/`;
    const files = this.app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(prefix) && file.extension.toLowerCase() === "pdf")
      .sort((a, b) => a.basename.localeCompare(b.basename));
    const out: PaperEntry[] = [];
    for (const file of files) {
      const stamp = `${file.stat.size}:${file.stat.mtime}`;
      const known = this.sizes.get(file.path);
      if (known?.stamp === stamp) {
        out.push(...known.entries);
        continue;
      }
      try {
        const entries = paperEntries(
          file.path,
          await measurePdfPages(await this.app.vault.readBinary(file)),
        );
        this.sizes.set(file.path, { stamp, entries });
        out.push(...entries);
      } catch {
        // A PDF that cannot be read is left out, not shown broken.
      }
    }
    return out;
  }

  paint(canvas: HTMLCanvasElement, entry: PaperEntry, cssWidth: number): void {
    this.paintPage(
      canvas,
      paperBackdrop(entry.path, entry.page),
      paperGeometry(entry, PREVIEW_PAGE_WIDTH),
      cssWidth,
    );
  }

  async importFile(host: HTMLElement): Promise<boolean> {
    const file = await pickImageFile(host, false, ACCEPT);
    if (!file) return false;
    return this.add(await file.arrayBuffer(), file.name, file.type);
  }

  importFromVault(): Promise<boolean> {
    return new Promise((resolve) => {
      let picked = false;
      const modal = new PaperSourceSuggestModal(this.app, this.folder, (file) => {
        picked = true;
        void this.app.vault
          .readBinary(file)
          .then((bytes) => this.add(bytes, file.name, ""))
          .then(resolve, () => resolve(false));
      });
      const close = modal.onClose.bind(modal);
      // Closing without a pick settles too (the pick lands before close).
      modal.onClose = () => {
        close();
        window.setTimeout(() => {
          if (!picked) resolve(false);
        }, 0);
      };
      modal.open();
    });
  }

  /** Keep a PDF made here (a page saved as a template) in the library, as `name`. */
  addPdf(bytes: Uint8Array, name: string): Promise<boolean> {
    const copy = bytes.slice();
    return this.add(copy.buffer, `${name}.pdf`, "application/pdf");
  }

  /** Keep a downloaded file (a gallery template) in the library, if it is a PDF or picture. */
  addFile(bytes: ArrayBuffer, fileName: string): Promise<boolean> {
    return this.add(bytes, fileName, "");
  }

  /**
   * Save `bytes` (a PDF, or a picture made into one) in the library. What
   * the bytes are decides, never the name: anything but a PDF, PNG, JPEG or
   * WebP is refused (`paperFileKind`), and so is anything too large.
   */
  private async add(bytes: ArrayBuffer, name: string, label: string): Promise<boolean> {
    try {
      if (bytes.byteLength > MAX_PAPER_BYTES) throw new Error("the file is larger than 40 MB");
      const kind = paperFileKind(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16)));
      if (!kind) throw new Error("only PDF, PNG, JPEG and WebP files can be templates");
      const pdf = kind === "pdf" ? new Uint8Array(bytes) : await pictureAsPdf(bytes, label);
      const pages = await measurePdfPages(pdf.slice().buffer);
      if (pages.length === 0) throw new Error("it has no pages");
      const folder = this.folder;
      if (!this.app.vault.getFolderByPath(folder)) {
        await this.app.vault.createFolder(folder).catch(() => undefined);
      }
      const path = this.freePath(folder, paperName(name));
      await this.app.vault.createBinary(path, pdf.slice().buffer);
      new Notice(
        pages.length === 1
          ? `FineNotes: "${paperName(name)}" is in My templates.`
          : `FineNotes: the ${pages.length} pages of "${paperName(name)}" are in My templates.`,
      );
      return true;
    } catch (error) {
      new Notice(
        `FineNotes: couldn't add that as a template — ${String((error as Error).message ?? error)}`,
      );
      return false;
    }
  }

  private freePath(folder: string, stem: string): string {
    for (let n = 1; ; n++) {
      const path = normalizePath(`${folder}/${n === 1 ? stem : `${stem} ${n}`}.pdf`);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
    }
  }
}

/** A picture as a one-page PDF: a photo as JPEG, anything else as exact pixels. */
async function pictureAsPdf(bytes: ArrayBuffer, label: string): Promise<Uint8Array> {
  const mime = imageMimeOf(bytes, label);
  const loaded = await loadImage(bytes, mime);
  const k = Math.min(1, MAX_PICTURE_SIDE / Math.max(loaded.width, loaded.height));
  const width = Math.max(1, Math.round(loaded.width * k));
  const height = Math.max(1, Math.round(loaded.height * k));
  const canvas = createEl("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this device could not draw the picture");
    // See-through parts land on white, as on paper.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(loaded.img, 0, 0, width, height);
    if (mime === "image/jpeg") {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (blob) {
        return picturePdf({
          width,
          height,
          data: new Uint8Array(await blob.arrayBuffer()),
          format: "jpeg",
        });
      }
    }
    const rgb = rgbFromRgba(ctx.getImageData(0, 0, width, height).data);
    return picturePdf({ width, height, data: rgb, format: "rgb" });
  } finally {
    loaded.release();
    releaseCanvas(canvas);
  }
}

/** "From vault…": the vault's PDFs and pictures, outside the library itself. */
class PaperSourceSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly library: string,
    private readonly onPick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Find a PDF or picture to use as a template…");
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => isPaperSource(file.extension) && !file.path.startsWith(`${this.library}/`))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}
