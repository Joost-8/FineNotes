/**
 * The notebook tools the AI can use while answering in Ask: read pages,
 * search the notebook, add a text box, a table, a page or a practice page,
 * go to a page, put a drawing on a page, mark an area or pin a comment, and
 * organise the notebook (titles, contents, bookmarks, page order). Claude calls them by itself in the middle of an answer
 * (tool use, Anthropic Messages API); FineNotes runs each call and sends the
 * result back, until Claude answers in words.
 *
 * Here are the parts with no side effects: the tool definitions as the API
 * takes them, checking a call's input, reading the calls out of a reply,
 * and the line the chat shows for each. Running them is the view's.
 *
 * The definitions never change during a conversation: the API checks that
 * the tools are the same on every request of a turn that uses them, and the
 * prompt cache needs them unchanged too.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import { ASK_MAX_PAGES } from "./ai-chat";
import { isRecord } from "./llm-request";

/** Rounds of tool calls one question may take before the answer has to come. */
export const ASK_MAX_TOOL_ROUNDS = 8;

/** Longest text a text box written by Claude may hold, characters. */
const MAX_TEXT_BOX_CHARS = 4000;
/** Largest drawing Claude may place, characters of SVG. */
const MAX_SVG_CHARS = 200_000;

/** Most rows and columns a table from the AI may have. */
export const MAX_TABLE_ROWS = 30;
export const MAX_TABLE_COLS = 8;
/** Most questions on one practice page. */
export const MAX_PRACTICE_QUESTIONS = 8;

/** A position or size across a page: 0 is its left or top edge, 1 its right or bottom. */
const fraction = { type: "number", minimum: 0, maximum: 1 } as const;

const pageNumber = {
  type: "integer",
  minimum: 1,
  description: "1-based page number, as the user sees it in the notebook.",
} as const;

/** The tools, as the Anthropic Messages API takes them in `tools`. */
export const ASK_TOOLS = [
  {
    name: "read_pages",
    description:
      "Look at pages of the notebook as images: handwriting, typed text boxes, pictures and the paper. " +
      `Use it for pages the user did not attach, at most ${ASK_MAX_PAGES} per call.`,
    input_schema: {
      type: "object",
      properties: {
        pages: { type: "array", items: pageNumber, minItems: 1, maxItems: ASK_MAX_PAGES },
      },
      required: ["pages"],
      additionalProperties: false,
    },
  },
  {
    name: "search_notebook",
    description:
      "Find the pages that mention some words, in the notebook's transcribed handwriting and typed " +
      "text boxes. Returns page numbers with the words around each match. Handwriting that was never " +
      "transcribed is not searched; read the pages instead.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "add_text_box",
    description:
      "Write a typed text box on a page, near the top of it. Plain text: no markdown. The user can " +
      "move, edit or undo it.",
    input_schema: {
      type: "object",
      properties: { page: pageNumber, text: { type: "string" } },
      required: ["page", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "add_page",
    description:
      "Add an empty page, on the same paper as the page before it, after the given page. The user " +
      "can undo it. Returns the new page's number.",
    input_schema: {
      type: "object",
      properties: { after: pageNumber },
      required: ["after"],
      additionalProperties: false,
    },
  },
  {
    name: "go_to_page",
    description: "Show the user a page: the notebook scrolls to it.",
    input_schema: {
      type: "object",
      properties: { page: pageNumber },
      required: ["page"],
      additionalProperties: false,
    },
  },
  {
    name: "insert_drawing",
    description:
      "Put a drawing on a page as a picture: a complete SVG document (with a viewBox and a white " +
      "or transparent background), for graphs, diagrams, geometry or labelled sketches. It is " +
      "saved in the vault and placed in the middle of the page; the user can move, resize or undo it.",
    input_schema: {
      type: "object",
      properties: {
        page: pageNumber,
        svg: { type: "string", description: "The SVG document, starting with <svg." },
        title: { type: "string", description: "A short name for the picture's file." },
      },
      required: ["page", "svg"],
      additionalProperties: false,
    },
  },
  {
    name: "set_page_title",
    description:
      "Give a page a title in the notebook's contents (the Contents tab), or remove it with an " +
      "empty title. One line.",
    input_schema: {
      type: "object",
      properties: { page: pageNumber, title: { type: "string" } },
      required: ["page", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "add_section",
    description:
      "Add a heading inside a page to the notebook's contents, where a new topic starts on it. " +
      "`y` is how far down the page the topic starts, from 0 (top) to 1 (bottom).",
    input_schema: {
      type: "object",
      properties: { page: pageNumber, title: { type: "string" }, y: fraction },
      required: ["page", "title", "y"],
      additionalProperties: false,
    },
  },
  {
    name: "bookmark_page",
    description:
      "Bookmark a page (for example, one to review before an exam), or remove its bookmark.",
    input_schema: {
      type: "object",
      properties: { page: pageNumber, bookmarked: { type: "boolean" } },
      required: ["page", "bookmarked"],
      additionalProperties: false,
    },
  },
  {
    name: "move_page",
    description:
      "Move a page to another place in the notebook: `to` is the page number it will have after " +
      "the move. Only when the user asks to reorder.",
    input_schema: {
      type: "object",
      properties: { page: pageNumber, to: pageNumber },
      required: ["page", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "add_table",
    description:
      "Put a table on a page: `rows` holds each row's cells as text, every row the same length. " +
      "`header` makes the first row a header. `x`, `y` place its top-left corner and `width` its " +
      "width, as fractions of the page (0 to 1); by default it goes near the top, across most of " +
      "the page.",
    input_schema: {
      type: "object",
      properties: {
        page: pageNumber,
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          minItems: 1,
          maxItems: MAX_TABLE_ROWS,
        },
        header: { type: "boolean" },
        x: fraction,
        y: fraction,
        width: fraction,
      },
      required: ["page", "rows"],
      additionalProperties: false,
    },
  },
  {
    name: "add_practice_page",
    description:
      "Add a practice page after a page, on the same paper: a title and exam-style questions, " +
      "with room to answer under each. One undo step.",
    input_schema: {
      type: "object",
      properties: {
        after: pageNumber,
        title: { type: "string" },
        questions: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: MAX_PRACTICE_QUESTIONS,
        },
      },
      required: ["after", "questions"],
      additionalProperties: false,
    },
  },
  {
    name: "mark_area",
    description:
      "Mark part of a page in ink, to point at something written there: a circle or a box " +
      "around it, or a highlight over it. `x`, `y` are its top-left corner and `width`, `height` " +
      "its size, as fractions of the page (0 to 1), read off the page's image. With `comment`, a " +
      "comment is pinned beside the mark too.",
    input_schema: {
      type: "object",
      properties: {
        page: pageNumber,
        x: fraction,
        y: fraction,
        width: fraction,
        height: fraction,
        shape: { type: "string", enum: ["circle", "box", "highlight"] },
        comment: { type: "string" },
      },
      required: ["page", "x", "y", "width", "height", "shape"],
      additionalProperties: false,
    },
  },
  {
    name: "add_comment",
    description:
      "Pin a comment to a spot on a page: a short note the user opens by tapping its marker " +
      "(for example, where a step goes wrong). `x`, `y` are the spot, as fractions of the page " +
      "(0 to 1). It does not change the writing.",
    input_schema: {
      type: "object",
      properties: { page: pageNumber, x: fraction, y: fraction, text: { type: "string" } },
      required: ["page", "x", "y", "text"],
      additionalProperties: false,
    },
  },
] as const;

/** A tool call, its input checked. */
export type AskToolCall =
  | { tool: "read_pages"; pages: number[] }
  | { tool: "search_notebook"; query: string }
  | { tool: "add_text_box"; page: number; text: string }
  | { tool: "add_page"; after: number }
  | { tool: "go_to_page"; page: number }
  | { tool: "insert_drawing"; page: number; svg: string; title: string }
  | { tool: "set_page_title"; page: number; title: string }
  | { tool: "add_section"; page: number; title: string; y: number }
  | { tool: "bookmark_page"; page: number; bookmarked: boolean }
  | { tool: "move_page"; page: number; to: number }
  | {
      tool: "add_table";
      page: number;
      cells: string[][];
      header: boolean;
      x?: number;
      y?: number;
      width?: number;
    }
  | { tool: "add_practice_page"; after: number; title: string; questions: string[] }
  | {
      tool: "mark_area";
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      shape: "circle" | "box" | "highlight";
      comment: string;
    }
  | { tool: "add_comment"; page: number; x: number; y: number; text: string };

/** A `tool_use` block from a reply. */
export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

/** The `tool_use` blocks of a Messages reply, in order. */
export function toolUsesOf(reply: unknown): ToolUse[] {
  if (!isRecord(reply) || !Array.isArray(reply.content)) return [];
  const uses: ToolUse[] = [];
  for (const block of reply.content as unknown[]) {
    if (!isRecord(block) || block.type !== "tool_use") continue;
    if (typeof block.id !== "string" || typeof block.name !== "string") continue;
    uses.push({ id: block.id, name: block.name, input: block.input });
  }
  return uses;
}

/**
 * Check a call against the notebook (`totalPages`) and the limits. Resolves
 * to the call, or to what is wrong with it, said so the model can fix it.
 */
export function parseToolCall(
  name: string,
  input: unknown,
  totalPages: number,
): AskToolCall | { error: string } {
  const args = isRecord(input) ? input : {};
  const page = (key: string): number | string => {
    const value = args[key];
    if (typeof value !== "number" || !Number.isInteger(value))
      return `"${key}" must be a page number.`;
    if (value < 1 || value > totalPages) {
      return `There is no page ${value}: the notebook has ${totalPages} page${totalPages === 1 ? "" : "s"}.`;
    }
    return value;
  };
  const text = (key: string): string | null =>
    typeof args[key] === "string" && args[key].trim() ? args[key] : null;

  switch (name) {
    case "read_pages": {
      const raw = Array.isArray(args.pages) ? (args.pages as unknown[]) : [];
      const pages = [...new Set(raw)].filter(
        (p): p is number =>
          typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= totalPages,
      );
      if (pages.length === 0)
        return { error: `Give 1 to ${ASK_MAX_PAGES} pages between 1 and ${totalPages}.` };
      if (pages.length > ASK_MAX_PAGES)
        return { error: `At most ${ASK_MAX_PAGES} pages per call.` };
      return { tool: "read_pages", pages: pages.sort((a, b) => a - b) };
    }
    case "search_notebook": {
      const query = text("query");
      return query
        ? { tool: "search_notebook", query: query.trim() }
        : { error: '"query" is empty.' };
    }
    case "add_text_box": {
      const at = page("page");
      if (typeof at === "string") return { error: at };
      const body = text("text");
      if (!body) return { error: '"text" is empty.' };
      if (body.length > MAX_TEXT_BOX_CHARS) {
        return {
          error: `The text is too long for one box (at most ${MAX_TEXT_BOX_CHARS} characters).`,
        };
      }
      return { tool: "add_text_box", page: at, text: body.trim() };
    }
    case "add_page": {
      const after = page("after");
      return typeof after === "string" ? { error: after } : { tool: "add_page", after };
    }
    case "go_to_page": {
      const at = page("page");
      return typeof at === "string" ? { error: at } : { tool: "go_to_page", page: at };
    }
    case "insert_drawing": {
      const at = page("page");
      if (typeof at === "string") return { error: at };
      const svg = text("svg");
      if (!svg || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) {
        return { error: '"svg" must be an SVG document starting with <svg.' };
      }
      if (svg.length > MAX_SVG_CHARS) return { error: "The drawing is too large." };
      const title = (text("title") ?? "Drawing").trim().slice(0, 60);
      return { tool: "insert_drawing", page: at, svg: svg.trim(), title };
    }
    case "set_page_title": {
      const at = page("page");
      if (typeof at === "string") return { error: at };
      const title = typeof args.title === "string" ? args.title.trim() : "";
      return { tool: "set_page_title", page: at, title };
    }
    case "add_section": {
      const at = page("page");
      if (typeof at === "string") return { error: at };
      const title = text("title");
      if (!title) return { error: '"title" is empty.' };
      const y = fractionOf(args.y);
      if (y === null) return { error: '"y" must be a number from 0 to 1.' };
      return { tool: "add_section", page: at, title: title.trim(), y };
    }
    case "bookmark_page": {
      const at = page("page");
      if (typeof at === "string") return { error: at };
      if (typeof args.bookmarked !== "boolean")
        return { error: '"bookmarked" must be true or false.' };
      return { tool: "bookmark_page", page: at, bookmarked: args.bookmarked };
    }
    case "move_page": {
      const from = page("page");
      if (typeof from === "string") return { error: from };
      const to = page("to");
      if (typeof to === "string") return { error: to };
      if (from === to) return { error: `Page ${from} is already there.` };
      return { tool: "move_page", page: from, to };
    }
    case "add_table": {
      const at = page("page");
      if (typeof at === "string") return { error: at };
      const raw = Array.isArray(args.rows) ? (args.rows as unknown[]) : [];
      const rows = raw.map((row) =>
        Array.isArray(row)
          ? (row as unknown[]).map((cell) =>
              typeof cell === "string"
                ? cell.trim()
                : typeof cell === "number" || typeof cell === "boolean"
                  ? String(cell)
                  : "",
            )
          : [],
      );
      const cols = Math.max(0, ...rows.map((row) => row.length));
      if (rows.length === 0 || cols === 0)
        return { error: '"rows" must hold at least one row of cells.' };
      if (rows.length > MAX_TABLE_ROWS || cols > MAX_TABLE_COLS) {
        return { error: `At most ${MAX_TABLE_ROWS} rows and ${MAX_TABLE_COLS} columns.` };
      }
      // A short row is filled out with empty cells.
      const cells = rows.map((row) => [...row, ...Array<string>(cols - row.length).fill("")]);
      return {
        tool: "add_table",
        page: at,
        cells,
        header: args.header === true,
        x: fractionOf(args.x) ?? undefined,
        y: fractionOf(args.y) ?? undefined,
        width: fractionOf(args.width) ?? undefined,
      };
    }
    case "add_practice_page": {
      const after = page("after");
      if (typeof after === "string") return { error: after };
      const raw = Array.isArray(args.questions) ? (args.questions as unknown[]) : [];
      const questions = raw
        .filter((q): q is string => typeof q === "string" && q.trim() !== "")
        .map((q) => q.trim());
      if (questions.length === 0) return { error: '"questions" is empty.' };
      if (questions.length > MAX_PRACTICE_QUESTIONS) {
        return { error: `At most ${MAX_PRACTICE_QUESTIONS} questions on one page.` };
      }
      const title = typeof args.title === "string" ? args.title.trim() : "";
      return { tool: "add_practice_page", after, title, questions };
    }
    case "mark_area": {
      const at = page("page");
      if (typeof at === "string") return { error: at };
      const box = boxOf(args);
      if (typeof box === "string") return { error: box };
      const shape = args.shape;
      if (shape !== "circle" && shape !== "box" && shape !== "highlight") {
        return { error: '"shape" must be "circle", "box" or "highlight".' };
      }
      const comment = typeof args.comment === "string" ? args.comment.trim() : "";
      return { tool: "mark_area", page: at, ...box, shape, comment };
    }
    case "add_comment": {
      const at = page("page");
      if (typeof at === "string") return { error: at };
      const x = fractionOf(args.x);
      const y = fractionOf(args.y);
      if (x === null || y === null) return { error: '"x" and "y" must be numbers from 0 to 1.' };
      const body = text("text");
      if (!body) return { error: '"text" is empty.' };
      return { tool: "add_comment", page: at, x, y, text: body.trim() };
    }
    default:
      return { error: `There is no tool called ${name}.` };
  }
}

/** What the chat says while a call runs. */
export function toolStatus(call: AskToolCall): string {
  switch (call.tool) {
    case "read_pages":
      return `Reading ${pagesWord(call.pages)}…`;
    case "search_notebook":
      return `Searching for “${call.query}”…`;
    case "add_text_box":
      return `Writing on page ${call.page}…`;
    case "add_page":
      return "Adding a page…";
    case "go_to_page":
      return `Going to page ${call.page}…`;
    case "insert_drawing":
      return `Drawing on page ${call.page}…`;
    case "set_page_title":
      return `Titling page ${call.page}…`;
    case "add_section":
      return `Adding “${call.title}” to the contents…`;
    case "bookmark_page":
      return `${call.bookmarked ? "Bookmarking" : "Unbookmarking"} page ${call.page}…`;
    case "move_page":
      return `Moving page ${call.page}…`;
    case "add_table":
      return `Making a table on page ${call.page}…`;
    case "add_practice_page":
      return "Making a practice page…";
    case "mark_area":
      return `Marking page ${call.page}…`;
    case "add_comment":
      return `Commenting on page ${call.page}…`;
  }
}

/** A number from 0 to 1 (a little past either edge is let in, at the edge); null when it is not one. */
function fractionOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < -0.05 || value > 1.05) return null;
  return Math.min(1, Math.max(0, value));
}

/** A box given as fractions of the page, kept on it; or what is wrong with it. */
function boxOf(
  args: Record<string, unknown>,
): { x: number; y: number; width: number; height: number } | string {
  const x = fractionOf(args.x);
  const y = fractionOf(args.y);
  const width = fractionOf(args.width);
  const height = fractionOf(args.height);
  if (x === null || y === null || width === null || height === null) {
    return '"x", "y", "width" and "height" must be numbers from 0 to 1.';
  }
  if (width <= 0 || height <= 0) return "The area is empty: give it a width and a height.";
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

/** "page 3", "pages 2, 5 and 7". */
function pagesWord(pages: readonly number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  return `pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
}

/** Search hits as the model reads them: page numbers and the words around each match. */
export function searchResultText(
  query: string,
  hits: ReadonlyArray<{ page: number; snippets: readonly string[] }>,
): string {
  if (hits.length === 0) return `Nothing in the notebook's text matches “${query}”.`;
  return hits
    .slice(0, 20)
    .map((hit) => `Page ${hit.page}:\n${hit.snippets.map((s) => `- …${s}…`).join("\n")}`)
    .join("\n\n");
}
