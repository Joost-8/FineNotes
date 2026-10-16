/**
 * The welcome notebook a new user is offered the first time FineNotes runs
 * in a vault: a cover, three pages that show the tools and how to bring
 * notebooks over from Goodnotes or Notability, and a ruled page to try the
 * pen on. Aimed at people who have never used Obsidian.
 *
 * The words are printed text (`SyntheticBackdrop.printed`), part of the
 * paper, as on a practice file's cover: the user can write all over the
 * pages without erasing or moving the explanations. Unlike a practice file
 * it is an ordinary notebook, with every tool.
 *
 * PURE: no DOM, no Obsidian.
 */

import { wrapPrinted } from "../recognition/practice";
import type { AttachmentFolders, InkDocument, Page, PrintedText } from "./document";
import { buildNewDocument, DEFAULT_NOTEBOOK_CHOICES } from "./new-notebook";
import { templateBackdrop } from "./templates";

/** The welcome notebook's name, and the title on its cover. */
export const WELCOME_TITLE = "Welcome to FineNotes";

/**
 * Whether to greet the user: only on a vault that had no FineNotes settings
 * yet and holds no notebook. A second device of a synced vault has both, so
 * it is not greeted again.
 */
export function shouldShowWelcome(firstInstall: boolean, hasNotebooks: boolean): boolean {
  return firstInstall && !hasNotebooks;
}

/** A block of a page: an optional heading, then a paragraph or bullet points. */
interface Block {
  heading?: string;
  text?: string;
  bullets?: readonly string[];
}

interface TourPage {
  title: string;
  blocks: readonly Block[];
}

/** The pages after the cover, in order. Every claim here is in the README's How to use. */
export const WELCOME_PAGES: readonly TourPage[] = [
  {
    title: "The basics",
    blocks: [
      {
        text:
          "Write with your Apple Pencil or stylus. Your fingers scroll the pages, " +
          "and two fingers pinch to zoom.",
      },
      {
        heading: "The bar at the top",
        bullets: [
          "Left: the page thumbnails, search, AI, undo and redo.",
          "Middle: the tools. Lasso, pen, eraser, text box, shapes, pictures, PDFs " +
            "and recording.",
          "Right: add a page, export as PDF, More (⋯) and the notebook's settings.",
          "Tap a tool again to hide or show its options.",
        ],
      },
      {
        heading: "Pages",
        bullets: [
          "Add a page with + at the top, or by pulling past the last page.",
          "There is no save button: everything is saved as you write.",
          "Search (the magnifier) finds typed text and your handwriting.",
        ],
      },
    ],
  },
  {
    title: "Handy tricks",
    blocks: [
      {
        heading: "Draw and hold",
        text:
          "Draw a line, arrow, rectangle, circle, triangle, star or cloud and keep the " +
          "pen still. It snaps to a clean shape. Keep holding to move and resize it.",
      },
      {
        heading: "Scribble to erase",
        text: "Scribble back and forth over writing to rub it out.",
      },
      {
        heading: "Circle to select",
        text:
          "Draw a loop round something and lift, then press and hold the pen on the " +
          "loop. What it enclosed is selected, ready to drag.",
      },
      {
        heading: "PDFs and pictures",
        text:
          "Insert PDF puts lecture slides or a worksheet into the notebook, one page " +
          "each, to write on. Insert image adds photos, or scans a sheet of paper.",
      },
    ],
  },
  {
    title: "Your notebooks",
    blocks: [
      {
        text:
          "FineNotes runs inside Obsidian. Each notebook is a file in this vault, the " +
          "folder Obsidian keeps your notes in, on this device. No company holds your notes.",
      },
      {
        heading: "Finding them",
        bullets: [
          "Open Obsidian's sidebar (top left) to see every notebook and folder.",
          "The notebook button in the sidebar starts a new notebook.",
          "Or press and hold a folder and choose New notebook.",
        ],
      },
      {
        heading: "Bring your notes from another app",
        bullets: [
          "Goodnotes: in the library tap Select, pick notebooks or folders, tap Export " +
            "and choose the Goodnotes format. Several at once come as one .zip.",
          "Notability: share or export a note in the Note format.",
          "Save the file in Files, then in FineNotes choose New notebook, then " +
            "Import from another app. Your handwriting stays editable.",
          "Anything else, such as Apple Notes: share it as a PDF and bring it in with " +
            "Insert PDF. Its old ink is then part of the page and cannot be edited.",
        ],
      },
      {
        heading: "On more devices",
        text:
          "Sync this vault with Obsidian Sync, iCloud or any app that syncs a folder, " +
          "and your notebooks look the same everywhere.",
      },
    ],
  },
];

/** What the last page, the ruled one, says at its top. */
export const TRY_IT_TEXT =
  "Try it here: write, scribble something out, draw a circle and hold. This notebook " +
  "is yours to keep, change or delete.";

/** Layout, page px. Text starts below where the tool pill floats at fit zoom. */
const LEFT = 60;
const TOP = 200;
const TITLE_SIZE = 44;
const HEADING_SIZE = 28;
const BODY_SIZE = 22;
const LINE = 33;
const BULLET_INDENT = 28;
const INK = "#2b2b2b";
const MUTED = "#6b6b6b";

/** One tour page's printed lines, from the top. */
function printPage(tour: TourPage, width: number): PrintedText[] {
  const out: PrintedText[] = [];
  let y = TOP;
  out.push({ x: LEFT, y, text: tour.title, size: TITLE_SIZE, bold: true, color: INK });
  y += 30;
  for (const block of tour.blocks) {
    y += 40;
    if (block.heading) {
      out.push({ x: LEFT, y, text: block.heading, size: HEADING_SIZE, bold: true, color: INK });
      y += 40;
    }
    if (block.text) {
      for (const line of wrapPrinted(block.text, width, BODY_SIZE)) {
        out.push({ x: LEFT, y, text: line, size: BODY_SIZE, color: INK });
        y += LINE;
      }
    }
    for (const bullet of block.bullets ?? []) {
      wrapPrinted(bullet, width - BULLET_INDENT, BODY_SIZE).forEach((line, i) => {
        if (i === 0) out.push({ x: LEFT, y, text: "•", size: BODY_SIZE, color: MUTED });
        out.push({ x: LEFT + BULLET_INDENT, y, text: line, size: BODY_SIZE, color: INK });
        y += LINE;
      });
      y += 6;
    }
  }
  return out;
}

/**
 * The welcome notebook: the default new notebook's cover titled `title`,
 * the tour pages on blank paper, and a ruled page to try the pen on.
 */
export function buildWelcomeNotebook(
  title: string = WELCOME_TITLE,
  attachments?: AttachmentFolders,
): InkDocument {
  const doc = buildNewDocument({ ...DEFAULT_NOTEBOOK_CHOICES }, title, attachments);
  const cover = doc.pages[0];
  const geometry = { ...cover.geometry };
  const width = geometry.width - 2 * LEFT;
  const blank = templateBackdrop("blank", "white");
  const tour: Page[] = WELCOME_PAGES.map((page, i) => ({
    id: `p${i + 2}`,
    kind: "ink",
    geometry: { ...geometry },
    backdrop: { ...blank, printed: printPage(page, width) },
    strokes: [],
    images: [],
    textBoxes: [],
  }));
  // One line per rule, sitting on it as handwriting would (ruled-wide's pitch is 40).
  const tryIt = wrapPrinted(TRY_IT_TEXT, width, 18).map((text, i): PrintedText => ({
    x: LEFT,
    y: 40 * (i + 1) - 9,
    text,
    size: 18,
    color: MUTED,
  }));
  const ruled: Page = {
    id: `p${tour.length + 2}`,
    kind: "ink",
    geometry: { ...geometry },
    backdrop: { ...templateBackdrop("ruled-wide", "white"), printed: tryIt },
    strokes: [],
    images: [],
    textBoxes: [],
  };
  doc.pages = [cover, ...tour, ruled];
  return doc;
}
