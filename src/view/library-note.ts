/**
 * A text note's pages on Home: read, laid out on pages
 * (note-page-render.ts) and drawn one at a time, for its cover (page 1)
 * and the preview's page strip.
 *
 * A note is read on the main thread: unlike a notebook it is a page or
 * two of Markdown with a few handwriting sections, and decoding it is the
 * note view's own `parseNoteFile`. Its layout is kept for two notes at a
 * time, until a file changes; pictures are decoded at the size a page
 * shows them and let go with the layout (to the garbage collector: a page
 * being drawn may still hold one).
 */

import type { App, TFile } from "obsidian";
import { parseNoteFile } from "../model/text-note-file";
import { INK_WIDTH, imageShare, type ImageBlock } from "../model/text-note";
import {
  type NoteLayout,
  type NotePicture,
  drawNotePage,
  layoutNote,
  noteLook,
} from "./note-page-render";

/** The longest side a picture is decoded at, device px: a page is drawn small. */
const PICTURE_PX = 900;

/** How many notes' layouts are kept at once. */
const KEPT = 2;

interface Kept {
  stamp: string;
  layout: NoteLayout;
}

export class TextNotePages {
  private readonly kept = new Map<string, Kept>();
  private laying: { path: string; stamp: string; done: Promise<Kept | null> } | null = null;

  constructor(
    private readonly app: App,
    /** Where to read the theme's fonts and accent from. */
    private readonly lookFrom: () => HTMLElement,
  ) {}

  /** The note laid out on pages; null when it cannot be read. */
  async layout(file: TFile): Promise<NoteLayout | null> {
    const stamp = `${file.stat.mtime}:${file.stat.size}`;
    const have = this.kept.get(file.path);
    if (have?.stamp === stamp) return have.layout;
    if (this.laying?.path === file.path && this.laying.stamp === stamp)
      return (await this.laying.done)?.layout ?? null;
    const done = this.lay(file, stamp);
    this.laying = { path: file.path, stamp, done };
    try {
      const kept = await done;
      if (kept) {
        this.kept.delete(file.path);
        this.kept.set(file.path, kept);
        while (this.kept.size > KEPT) {
          const oldest = this.kept.keys().next().value;
          if (oldest === undefined) break;
          this.kept.delete(oldest);
        }
      }
      return kept?.layout ?? null;
    } finally {
      if (this.laying?.done === done) this.laying = null;
    }
  }

  /** How many pages the note has; 0 when it cannot be read. */
  async count(file: TFile): Promise<number> {
    return (await this.layout(file))?.pages.length ?? 0;
  }

  /** Page `index` of the note drawn `cssWidth` CSS px wide, or null when it has no such page. */
  async render(file: TFile, index: number, cssWidth: number): Promise<HTMLCanvasElement | null> {
    const layout = await this.layout(file);
    if (!layout || index >= layout.pages.length) return null;
    const canvas = createEl("canvas");
    drawNotePage(canvas, layout, index, cssWidth, window.devicePixelRatio || 1, {
      palette: noteLook(this.lookFrom()).palette,
    });
    return canvas;
  }

  /** Let go of the kept notes and their pictures. */
  release(): void {
    this.kept.clear();
  }

  private async lay(file: TFile, stamp: string): Promise<Kept | null> {
    let text: string;
    try {
      text = await this.app.vault.cachedRead(file);
    } catch {
      return null;
    }
    let sequence = 0;
    // The note view's own ids: a page's first block is the one the note scrolls to.
    const { note } = parseNoteFile(text, () => `f${(++sequence).toString(36)}`);
    const pictures = new Map<string, NotePicture>();
    for (const block of note.blocks) {
      if (block.type !== "image") continue;
      const picture = await this.picture(block, file.path);
      if (picture) pictures.set(block.id, picture);
    }
    const ctx = createEl("canvas").getContext("2d");
    if (!ctx) return null;
    const { fonts } = noteLook(this.lookFrom());
    const layout = layoutNote(note, ctx, (block) => pictures.get(block.id) ?? null, fonts);
    return { stamp, layout };
  }

  /** A picture of the note, decoded small; null when its file is not in the vault or will not decode. */
  private async picture(block: ImageBlock, from: string): Promise<NotePicture | null> {
    const target =
      this.app.metadataCache.getFirstLinkpathDest(block.path, from) ??
      this.app.vault.getFileByPath(block.path);
    if (!target) return null;
    const image = new Image();
    image.decoding = "async";
    image.src = this.app.vault.getResourcePath(target);
    try {
      await image.decode();
    } catch {
      return null;
    }
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    if (!(w > 0 && h > 0)) return null;
    const width = INK_WIDTH * imageShare(block);
    const height = (width * h) / w;
    const fit = Math.min(1, PICTURE_PX / Math.max(w, h));
    // Drawn once into a small canvas: a photo is not kept decoded at full size.
    // (createImageBitmap's resizing drew SVG pictures blank in Chromium, and older iPadOS lacks it.)
    const small = createEl("canvas");
    small.width = Math.max(1, Math.round(w * fit));
    small.height = Math.max(1, Math.round(h * fit));
    const ctx = small.getContext("2d");
    if (!ctx) return { width, height, source: image };
    ctx.drawImage(image, 0, 0, small.width, small.height);
    image.src = "";
    return { width, height, source: small };
  }
}
