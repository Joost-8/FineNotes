/**
 * Add space beside a page: a page added sideways. The page grows to the left
 * or the right by a strip of paper with a template of its own
 * ({@link Page.sidePapers}), chosen as a page's template is in Add Page.
 *
 * The page's own paper or PDF stays the size it was and where it was: its
 * backdrop keeps a frame ({@link PdfBackdrop.frame}) that it is drawn in, so
 * it is not stretched or re-fitted to the wider page. Space on the left moves
 * everything on the page right by as much, the frame and the side papers
 * included, so ink stays on the words it was written over.
 *
 * One command, so one undo takes that strip away again.
 *
 * PURE: no DOM.
 */

import type { Command } from "./commands";
import type {
  Backdrop,
  InkDocument,
  Page,
  PageGeometry,
  SidePaper,
  SyntheticBackdrop,
} from "./document";
import { pdfFrameOf } from "./document";
import { TranslateElements } from "./selection-commands";

export type SpaceSide = "left" | "right";

/** The page's own paper's size: what "keep the current page's size" adds beside it. */
export function sideSpaceWidth(page: Page): number {
  return pdfFrameOf(page.backdrop, page.geometry).width;
}

/**
 * How wide a side paper of `geometry` is beside `page`: that paper's shape at
 * the page's height (a strip runs the page's full height).
 */
export function sidePaperWidth(page: Page, geometry: PageGeometry): number {
  if (!(geometry.width > 0 && geometry.height > 0)) return sideSpaceWidth(page);
  return Math.round((geometry.width * page.geometry.height) / geometry.height);
}

/** The page as it was before any space was added: what a new page after it takes. */
export function unwidenedGeometry(page: Page): PageGeometry {
  if (!page.backdrop.frame) return page.geometry;
  return { width: page.backdrop.frame.width, height: page.geometry.height };
}

/** A backdrop without the frame a widened page keeps it in: for a new page made from it. */
export function withoutFrame<T extends Backdrop>(backdrop: T): T {
  if (!backdrop.frame) return backdrop;
  const { frame: _frame, ...rest } = backdrop;
  return rest as T;
}

export class AddPageSpace implements Command {
  readonly label = "Add space";
  private previous: {
    geometry: PageGeometry;
    backdrop: Backdrop;
    sidePapers: SidePaper[] | undefined;
    comments: number[];
    sections: number[];
  } | null = null;
  private moved: TranslateElements | null = null;
  private readonly width: number;

  constructor(
    private readonly page: Page,
    private readonly side: SpaceSide,
    private readonly paper: SyntheticBackdrop,
    width?: number,
  ) {
    this.width = width !== undefined && width > 0 ? width : sideSpaceWidth(page);
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    // By identity, like the other page commands: ids can repeat within a file.
    const page = this.page;
    if (!doc.pages.includes(page)) return;
    const added = this.width;
    this.previous = {
      geometry: page.geometry,
      backdrop: page.backdrop,
      sidePapers: page.sidePapers,
      comments: (page.comments ?? []).map((comment) => comment.x),
      sections: (page.sections ?? []).map((section) => section.x),
    };
    const dx = this.side === "left" ? added : 0;

    // The page's own paper or PDF keeps where it is now, so the wider page does not stretch it.
    const frame = pdfFrameOf(page.backdrop, page.geometry);
    page.backdrop = { ...page.backdrop, frame: { ...frame, x: frame.x + dx } };
    const strip: SidePaper = {
      x: this.side === "left" ? 0 : page.geometry.width,
      width: added,
      backdrop: withoutFrame({ ...this.paper }),
    };
    const moved = (page.sidePapers ?? []).map((paper) => ({ ...paper, x: paper.x + dx }));
    page.sidePapers = this.side === "left" ? [strip, ...moved] : [...moved, strip];
    page.geometry = { ...page.geometry, width: page.geometry.width + added };

    if (dx === 0) return;
    this.moved = new TranslateElements(
      page.id,
      {
        strokes: [...page.strokes],
        images: [...page.images],
        textBoxes: [...page.textBoxes],
        tables: [...(page.tables ?? [])],
        graphs: [...(page.graphs ?? [])],
      },
      dx,
      0,
    );
    this.moved.apply(doc);
    for (const comment of page.comments ?? []) comment.x += dx;
    for (const section of page.sections ?? []) section.x += dx;
  }

  invert(doc: InkDocument): void {
    const page = this.page;
    const previous = this.previous;
    if (!previous || !doc.pages.includes(page)) return;
    this.moved?.invert(doc);
    this.moved = null;
    (page.comments ?? []).forEach((comment, i) => {
      comment.x = previous.comments[i] ?? comment.x;
    });
    (page.sections ?? []).forEach((section, i) => {
      section.x = previous.sections[i] ?? section.x;
    });
    page.geometry = previous.geometry;
    page.backdrop = previous.backdrop;
    if (previous.sidePapers === undefined) delete page.sidePapers;
    else page.sidePapers = previous.sidePapers;
    this.previous = null;
  }
}
