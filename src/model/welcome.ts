/**
 * The "Welcome to FineNotes" notebook a first install opens with: the usual
 * cover, then a few pages that show what the plugin does, each with room to
 * try it. Pure. Everything on the pages is an ordinary text box, so the
 * notebook can be written in, cleared or deleted like any other.
 */

import type { InkDocument, Page, TextBoxElement } from "./document";
import { buildNewDocument, DEFAULT_NOTEBOOK_CHOICES } from "./new-notebook";

export const WELCOME_TITLE = "Welcome to FineNotes";

/** One page: a heading, then short paragraphs, then room to try. */
interface WelcomePage {
  heading: string;
  lines: string[];
}

export const WELCOME_PAGES: readonly WelcomePage[] = [
  {
    heading: "Write on the page",
    lines: [
      "Pick the pen in the toolbar and write anywhere on this page, with an Apple Pencil, a stylus, a finger or the mouse.",
      "Next to it: the highlighter and the eraser. Tap a tool again for its colours, its size slider and its options.",
      "Double-tap the page with two fingers to undo, or with three to redo.",
      "Try it on the lines below.",
    ],
  },
  {
    heading: "Shapes, lasso and text",
    lines: [
      "Draw a line, a circle, a rectangle or an arrow and keep the pen still at the end: it snaps to a clean shape.",
      "The lasso selects ink, pictures and text so you can move, resize, recolour or copy them.",
      "In the pen's options, turn on Scribble to erase and Circle to lasso to do both without changing tools.",
      "The text box tool (T) adds typed text; the picture tool adds images, a scan or a photo.",
    ],
  },
  {
    heading: "Pages and paper",
    lines: [
      "Pull past the last page, or use the + in the toolbar, to add a page and choose its paper: lined, squared, dotted, planners, music and more.",
      "The page thumbnails show every page. From a page's options you can bookmark it, duplicate it or give it a title for the contents.",
      "Pinch to zoom. Every page keeps its size on every device, so your ink lands in the same place on your iPad, phone and laptop.",
    ],
  },
  {
    heading: "Bring your notes along",
    lines: [
      "Right-click a folder and choose Import notebook… to bring notebooks over from Goodnotes, Notability, Noteful, Xournal++, Saber, reMarkable or Supernote, or any app's PDF.",
      "Open a PDF from your vault as a notebook to write on its pages, and export any notebook as a PDF.",
      "A notebook is an ordinary file in your vault: it syncs, links and searches like the rest of your notes.",
      "This notebook is yours: write in it, clear it, or delete it when you are done.",
    ],
  },
];

/** Page px from the edge to the text. */
const MARGIN = 72;
const HEADING_SIZE = 42;
const BODY_SIZE = 26;
/** Space under the heading, and between paragraphs, in page px. */
const HEADING_GAP = 30;
const PARAGRAPH_GAP = 18;
/** Average glyph width as a share of the font size, to estimate wrapped lines. */
const GLYPH = 0.5;
const LINE_HEIGHT = 1.25;
const HEADING_COLOR = "#1f2933";
const BODY_COLOR = "#3e4c59";

/**
 * The welcome notebook: a cover titled {@link WELCOME_TITLE}, then one page
 * per entry of {@link WELCOME_PAGES} on lined paper.
 */
export function buildWelcomeNotebook(): InkDocument {
  const doc = buildNewDocument(
    { ...DEFAULT_NOTEBOOK_CHOICES, ruling: "ruled-wide" },
    WELCOME_TITLE,
  );
  // [cover, paper]: the paper page is the template for every welcome page.
  const [cover, paper] = doc.pages;
  let box = 0;
  const pages: Page[] = WELCOME_PAGES.map((content, index) => {
    const page: Page = structuredClone(paper);
    page.id = `p${index + 2}`;
    const width = page.geometry.width - 2 * MARGIN;
    let y = MARGIN;
    const text = (words: string, size: number, color: string, bold: boolean): TextBoxElement => {
      const tb: TextBoxElement = {
        id: `w${++box}`,
        x: MARGIN,
        y,
        w: width,
        text: words,
        color,
        fontSize: size,
      };
      if (bold) tb.bold = true;
      y += estimateHeight(words, size, width);
      return tb;
    };
    page.textBoxes.push(text(content.heading, HEADING_SIZE, HEADING_COLOR, true));
    y += HEADING_GAP;
    for (const line of content.lines) {
      page.textBoxes.push(text(line, BODY_SIZE, BODY_COLOR, false));
      y += PARAGRAPH_GAP;
    }
    return page;
  });
  doc.pages = [cover, ...pages];
  return doc;
}

/** Roughly how tall `text` wraps to in a box `width` wide. */
export function estimateHeight(text: string, size: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (size * GLYPH)));
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  return Math.ceil(lines * size * LINE_HEIGHT);
}
