/**
 * Ask AI and the notebook's PDF tabs (#263): the lecture PDFs kept beside
 * the notes. The model is told which tabs there are and which one the user
 * was reading, and reads a tab's pages with `read_pdf_tab`: their printed
 * text, and a picture of the pages that have little text (a diagram, a
 * scanned slide), so a question about "this slide" can be answered.
 *
 * Here are the parts with no side effects: the prompt lines, finding the tab
 * a call names, the page range a call may read, and the text it returns.
 * Reading the PDF is the view's.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

/** A PDF tab as Ask sees it. */
export interface AskPdfTab {
  /** The tab's name on the strip. */
  label: string;
  /** The PDF's path in the vault. */
  path: string;
  /** Its page count; 0 when the PDF is missing. */
  pages: number;
}

/** The tab the user had in front of them when they opened Ask. */
export interface AskPdfReading {
  label: string;
  /** 1-based page of the PDF. */
  page: number;
}

/** Most pages one `read_pdf_tab` call reads as text. */
export const PDF_TAB_MAX_TEXT_PAGES = 12;
/** Most pages of one call sent as pictures as well. */
export const PDF_TAB_MAX_IMAGES = 3;
/** A page with fewer printed characters than this is sent as a picture too. */
export const PDF_TAB_SPARSE_CHARS = 200;
/** Most characters one call returns; the rest is read on with `from`. */
export const PDF_TAB_MAX_CHARS = 24_000;

/** The tool, as the Anthropic Messages API takes it in `tools`. */
export const READ_PDF_TAB_TOOL = {
  name: "read_pdf_tab",
  description:
    "Read pages of one of the PDFs kept in tabs beside the notebook's notes (lecture slides, papers, " +
    "textbooks): their printed text, and a picture of each page with little text (diagrams, scans). " +
    `At most ${PDF_TAB_MAX_TEXT_PAGES} pages per call. Use it whenever the question is about the ` +
    "material in those tabs; the user cannot attach those pages themselves.",
  input_schema: {
    type: "object",
    properties: {
      tab: { type: "string", description: "The tab's name, as listed, or the PDF's path." },
      from: { type: "integer", minimum: 1, description: "First page to read, 1-based. Default 1." },
      to: {
        type: "integer",
        minimum: 1,
        description: `Last page to read. Default: ${PDF_TAB_MAX_TEXT_PAGES - 1} pages after "from".`,
      },
    },
    required: ["tab"],
    additionalProperties: false,
  },
} as const;

/** A `read_pdf_tab` call, its input checked. */
export interface ReadPdfTabCall {
  tool: "read_pdf_tab";
  tab: string;
  from: number;
  to?: number;
}

/** Check a `read_pdf_tab` call's input. Resolves to the call or to what is wrong. */
export function parseReadPdfTab(args: Record<string, unknown>): ReadPdfTabCall | { error: string } {
  const tab = typeof args.tab === "string" ? args.tab.trim() : "";
  if (!tab) return { error: '"tab" is empty.' };
  const whole = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1;
  if (args.from !== undefined && !whole(args.from))
    return { error: '"from" must be a page number, 1 or more.' };
  if (args.to !== undefined && !whole(args.to))
    return { error: '"to" must be a page number, 1 or more.' };
  const from = args.from ?? 1;
  const to = args.to;
  if (to !== undefined && to < from) return { error: '"to" comes before "from".' };
  return to === undefined
    ? { tool: "read_pdf_tab", tab, from }
    : { tool: "read_pdf_tab", tab, from, to };
}

/**
 * The tab a call names: by its label or its path, ignoring case, then by
 * the start of a label. `null` when none or more than one fits.
 */
export function findPdfTab(tabs: readonly AskPdfTab[], name: string): AskPdfTab | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const exact = tabs.filter(
    (tab) =>
      tab.label.toLowerCase() === wanted ||
      tab.path.toLowerCase() === wanted ||
      fileName(tab.path).toLowerCase() === wanted,
  );
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const started = tabs.filter((tab) => tab.label.toLowerCase().startsWith(wanted));
  return started.length === 1 ? (started[0] ?? null) : null;
}

/** The pages a call reads, clamped to the PDF and to the per-call limit; `null` past its end. */
export function pdfTabRange(
  call: ReadPdfTabCall,
  pages: number,
): { from: number; to: number } | null {
  if (pages < 1 || call.from > pages) return null;
  const last = Math.min(pages, call.from + PDF_TAB_MAX_TEXT_PAGES - 1);
  return { from: call.from, to: Math.min(call.to ?? last, last) };
}

/** Which of the pages read are sent as pictures too: the sparse ones, first few. */
export function pagesToPicture(texts: ReadonlyArray<{ page: number; text: string }>): number[] {
  return texts
    .filter((entry) => entry.text.replace(/\s+/g, "").length < PDF_TAB_SPARSE_CHARS)
    .slice(0, PDF_TAB_MAX_IMAGES)
    .map((entry) => entry.page);
}

/** What the model hears when no tab fits the name it gave. */
export function unknownTabText(tabs: readonly AskPdfTab[], name: string): string {
  if (tabs.length === 0) return "This notebook has no PDF tabs.";
  return `No single PDF tab is called “${name}”. The tabs are: ${tabs.map((tab) => `“${tab.label}”`).join(", ")}.`;
}

/**
 * The text a call returns: each page's printed text under its number, cut
 * at {@link PDF_TAB_MAX_CHARS}, and which pages come as pictures after it.
 */
export function pdfTabText(
  tab: AskPdfTab,
  texts: ReadonlyArray<{ page: number; text: string }>,
  pictured: readonly number[],
): string {
  const head = `“${tab.label}” (${tab.path}), ${tab.pages} page${tab.pages === 1 ? "" : "s"}.`;
  const parts: string[] = [head];
  let used = head.length;
  let stoppedAt: number | null = null;
  for (const { page, text } of texts) {
    const body = text.trim() || "(no printed text on this page)";
    const block = `\n\n--- Page ${page} ---\n${body}`;
    if (used + block.length > PDF_TAB_MAX_CHARS && parts.length > 1) {
      stoppedAt = page;
      break;
    }
    const room = PDF_TAB_MAX_CHARS - used;
    parts.push(block.length > room ? `${block.slice(0, room)}…` : block);
    used += Math.min(block.length, room);
  }
  if (stoppedAt !== null) parts.push(`\n\n(Cut for length: read on with from: ${stoppedAt}.)`);
  const last = texts[texts.length - 1]?.page ?? 0;
  if (stoppedAt === null && last > 0 && last < tab.pages) {
    parts.push(`\n\n(Pages ${last + 1} to ${tab.pages} are not read yet.)`);
  }
  if (pictured.length > 0) {
    parts.push(
      `\n\nPictures of page${pictured.length === 1 ? "" : "s"} ${pictured.join(", ")} follow, in that order.`,
    );
  }
  return parts.join("");
}

/**
 * The lines the system prompt gets about the tabs: their names and sizes,
 * and the page the user was reading. Empty when the notebook has none, so
 * the prompt of a notebook without tabs is unchanged.
 */
export function pdfTabsPrompt(tabs: readonly AskPdfTab[], reading: AskPdfReading | null): string {
  if (tabs.length === 0) return "";
  const list = tabs
    .map((tab) =>
      tab.pages > 0
        ? `- “${tab.label}” (${tab.pages} page${tab.pages === 1 ? "" : "s"})`
        : `- “${tab.label}” (missing from the vault)`,
    )
    .join("\n");
  const lines = [
    "PDFs kept in tabs beside this notebook's notes (read them with read_pdf_tab):",
    list,
  ];
  if (reading) {
    lines.push(
      `The user opened this chat while reading page ${reading.page} of “${reading.label}”: ` +
        "“this slide”, “this page” or “here” most likely means that page.",
    );
  }
  return lines.join("\n");
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
