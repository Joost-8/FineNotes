/**
 * The notebook tools the AI can use while answering in Ask: read pages,
 * search the notebook, add a text box, a table, a page or a practice page,
 * go to a page, put a drawing on a page, mark an area or pin a comment, and
 * organise the notebook (titles, contents and its whole outline, bookmarks,
 * page order), and take back what it changed. Claude calls them by itself in the middle of an answer
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

import { t, tn } from "../i18n/translate";
import { ASK_MAX_PAGES } from "./ai-chat";
import { isRecord } from "./llm-request";
import { MAX_NOTE_CHARS, MAX_READ_CHARS } from "./vault-context";
import { MAX_OUTLINE_ENTRIES, type OutlineEntry } from "../model/outline-edit";

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
    name: "search_vault",
    description:
      "Find the user's other notes, notebooks and PDFs that mention some words: names, Markdown text, " +
      "transcribed handwriting, text boxes and PDF text already read on this device. Searches the folders " +
      "the user allows, never this notebook (use search_notebook). Returns paths with the words around each " +
      "match. Use it when the question needs something outside this notebook.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_note",
    description:
      "Read one of the user's other notes, notebooks or PDFs as text, by the path search_vault gave (or a " +
      "note's name). A notebook comes as its transcribed handwriting and text boxes, page by page. Long " +
      `files come ${MAX_READ_CHARS} characters at a time; "from" reads on.`,
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file's path in the vault, or its name." },
        from: {
          type: "integer",
          minimum: 0,
          description: "Character to start at, for reading on in a long file. Default 0.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "finenotes_help",
    description:
      "Look up FineNotes itself: what it can do, how, and where each thing is (toolbar, pens, shapes, " +
      "lasso, pages, Home, PDFs, import, export, recordings, maths, gestures, keyboard shortcuts, " +
      "settings, AI). Returns entries from its handbook with the path through the app, and links that " +
      "open a tip or setting. Use it for any question about using FineNotes, before answering.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What the user wants to know or do, in a few words.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "linked_notes",
    description:
      "List the notes this notebook links to and the notes that link to it: connections the user made " +
      "themselves, often the best place to look first. Returns paths to pass to read_note.",
    input_schema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["both", "to", "from"],
          description: "Links from this notebook (to), to it (from), or both. Default both.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_note",
    description:
      "Write a new Markdown note beside this notebook: a summary, flashcards, a to-do list, definitions, " +
      "or what you pulled out of several notes. Never changes a note you did not write in this chat. Use it " +
      `when the user asks to put something in a note. At most ${MAX_NOTE_CHARS} characters.`,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The note's title, which becomes its file name." },
        text: {
          type: "string",
          description: "The note's Markdown, without the title as a heading.",
        },
        replace: {
          type: "boolean",
          description:
            "Rewrite the note of this title you wrote earlier in this chat, to correct it. Only those.",
        },
      },
      required: ["title", "text"],
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
    name: "read_outline",
    description:
      "Read the notebook's outline (its contents): every entry in order, with its page, its level " +
      "(1 a chapter, 2 a section of it, 3 a part of that) and whether it is a page's title or a heading " +
      "inside a page. Also names the PDFs behind the pages and lists each one's own outline (its " +
      "bookmarks), where it has one. Read it before changing the outline.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "set_outline",
    description:
      "Write the notebook's outline in one step that the user can undo: chapters, sections and parts. " +
      "Each entry is a page, a title, a level (1 to 3, default 1) and `y`, how far down the page it " +
      "starts (0 top to 1 bottom, default 0). An entry at the top of a page becomes the page's title; " +
      "any other is a heading inside the page. With `replace` true, the outline becomes exactly these " +
      "entries (read_outline first, and keep what should stay; no entries clears it); without it, " +
      "they are added to what is there. For an outline of a PDF, use its own outline from " +
      "read_outline when it has one, or read its pages.",
    input_schema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          maxItems: MAX_OUTLINE_ENTRIES,
          items: {
            type: "object",
            properties: {
              page: pageNumber,
              title: { type: "string" },
              level: { type: "integer", minimum: 1, maximum: 3 },
              y: fraction,
            },
            required: ["page", "title"],
            additionalProperties: false,
          },
        },
        replace: { type: "boolean" },
      },
      required: ["entries"],
      additionalProperties: false,
    },
  },
  {
    name: "undo_changes",
    description:
      "Take back changes you made to the notebook in this chat. Each change has a number (results " +
      'say "change 3", and your earlier answers list theirs). Give the numbers, or leave `changes` ' +
      "out to take back everything your latest answer that changed the notebook did. Only your own " +
      "changes are taken back: when the user has edited what one touched since, nothing is changed " +
      "and the result says which pages; then tell the user.",
    input_schema: {
      type: "object",
      properties: {
        changes: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1 },
      },
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
  | { tool: "search_vault"; query: string }
  | { tool: "read_note"; path: string; from: number }
  | { tool: "linked_notes"; direction: "both" | "to" | "from" }
  | { tool: "finenotes_help"; query: string }
  | { tool: "create_note"; title: string; text: string; replace: boolean }
  | { tool: "add_text_box"; page: number; text: string }
  | { tool: "add_page"; after: number }
  | { tool: "go_to_page"; page: number }
  | { tool: "insert_drawing"; page: number; svg: string; title: string }
  | { tool: "set_page_title"; page: number; title: string }
  | { tool: "add_section"; page: number; title: string; y: number }
  | { tool: "bookmark_page"; page: number; bookmarked: boolean }
  | { tool: "read_outline" }
  | { tool: "set_outline"; entries: OutlineEntry[]; replace: boolean }
  | { tool: "undo_changes"; changes: number[] }
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
    case "search_vault": {
      const query = text("query");
      return query ? { tool: "search_vault", query: query.trim() } : { error: '"query" is empty.' };
    }
    case "read_note": {
      const path = text("path");
      if (!path) return { error: '"path" is empty.' };
      const from = args.from;
      if (from !== undefined && (typeof from !== "number" || !Number.isInteger(from) || from < 0)) {
        return { error: '"from" must be a whole number, 0 or more.' };
      }
      return { tool: "read_note", path: path.trim(), from: from ?? 0 };
    }
    case "finenotes_help": {
      const query = text("query");
      return query
        ? { tool: "finenotes_help", query: query.trim() }
        : { error: '"query" is empty.' };
    }
    case "linked_notes": {
      const direction = args.direction ?? "both";
      if (direction !== "both" && direction !== "to" && direction !== "from") {
        return { error: '"direction" must be "both", "to" or "from".' };
      }
      return { tool: "linked_notes", direction };
    }
    case "create_note": {
      const title = text("title");
      if (!title) return { error: '"title" is empty.' };
      const body = text("text");
      if (!body) return { error: '"text" is empty.' };
      if (body.length > MAX_NOTE_CHARS) {
        return { error: `The note is too long (at most ${MAX_NOTE_CHARS} characters).` };
      }
      return {
        tool: "create_note",
        title: title.trim(),
        text: body.trim(),
        replace: args.replace === true,
      };
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
    case "read_outline":
      return { tool: "read_outline" };
    case "set_outline":
      return outlineCall(args, totalPages);
    case "undo_changes": {
      if (args.changes === undefined) return { tool: "undo_changes", changes: [] };
      const raw = Array.isArray(args.changes) ? (args.changes as unknown[]) : [];
      const changes = [...new Set(raw)].filter(
        (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1,
      );
      if (changes.length === 0 || changes.length !== new Set(raw).size) {
        return { error: '"changes" must be change numbers (1, 2, 3…), or left out.' };
      }
      return { tool: "undo_changes", changes: changes.sort((a, b) => a - b) };
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
      return t("ai.tool.reading", { pages: pagesWord(call.pages) });
    case "search_notebook":
      return t("ai.tool.searching", { query: call.query });
    case "search_vault":
      return t("ai.tool.searchingVault", { query: call.query });
    case "read_note":
      return t("ai.tool.readingNote", { name: noteName(call.path) });
    case "linked_notes":
      return t("ai.tool.lookingAtLinks");
    case "finenotes_help":
      return t("ai.tool.lookingUpHelp", { query: call.query });
    case "create_note":
      return t("ai.tool.makingNote", { title: call.title });
    case "add_text_box":
      return t("ai.tool.writing", { page: call.page });
    case "add_page":
      return t("ai.tool.addingPage");
    case "go_to_page":
      return t("ai.tool.goingTo", { page: call.page });
    case "insert_drawing":
      return t("ai.tool.drawing", { page: call.page });
    case "set_page_title":
      return t("ai.tool.titling", { page: call.page });
    case "add_section":
      return t("ai.tool.addingSection", { title: call.title });
    case "bookmark_page":
      return t(call.bookmarked ? "ai.tool.bookmarking" : "ai.tool.unbookmarking", {
        page: call.page,
      });
    case "move_page":
      return t("ai.tool.moving", { page: call.page });
    case "read_outline":
      return t("ai.tool.readingOutline");
    case "set_outline":
      return t("ai.tool.writingOutline");
    case "undo_changes":
      return t("ai.tool.undoing");
    case "add_table":
      return t("ai.tool.makingTable", { page: call.page });
    case "add_practice_page":
      return t("ai.tool.makingPractice");
    case "mark_area":
      return t("ai.tool.marking", { page: call.page });
    case "add_comment":
      return t("ai.tool.commenting", { page: call.page });
  }
}

/** `set_outline`'s entries, each checked; or every entry that is wrong, so all are fixed at once. */
function outlineCall(
  args: Record<string, unknown>,
  totalPages: number,
): AskToolCall | { error: string } {
  if (!Array.isArray(args.entries)) return { error: '"entries" must be a list of entries.' };
  const raw = args.entries as unknown[];
  if (raw.length > MAX_OUTLINE_ENTRIES) {
    return { error: `At most ${MAX_OUTLINE_ENTRIES} entries in one call.` };
  }
  const replace = args.replace === true;
  if (raw.length === 0 && !replace) {
    return {
      error: '"entries" is empty: give at least one, or replace: true to clear the outline.',
    };
  }
  const entries: OutlineEntry[] = [];
  const wrong: string[] = [];
  raw.forEach((item, i) => {
    const entry = isRecord(item) ? item : {};
    const where = `Entry ${i + 1}`;
    const at = entry.page;
    if (typeof at !== "number" || !Number.isInteger(at) || at < 1 || at > totalPages) {
      wrong.push(`${where}: "page" must be a page from 1 to ${totalPages}.`);
      return;
    }
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) {
      wrong.push(`${where}: "title" is empty.`);
      return;
    }
    const level = entry.level ?? 1;
    if (level !== 1 && level !== 2 && level !== 3) {
      wrong.push(`${where}: "level" must be 1, 2 or 3.`);
      return;
    }
    let y: number | undefined;
    if (entry.y !== undefined) {
      const value = fractionOf(entry.y);
      if (value === null) {
        wrong.push(`${where}: "y" must be a number from 0 to 1.`);
        return;
      }
      y = value;
    }
    entries.push(y === undefined ? { page: at, title, level } : { page: at, title, level, y });
  });
  if (wrong.length > 0) return { error: wrong.join("\n") };
  return { tool: "set_outline", entries, replace };
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

/** A path or link as the chat names it: the file's name without its extensions. */
function noteName(path: string): string {
  const bare = path.replace(/^\[\[|\]\]$/g, "").replace(/[|#].*$/, "");
  return bare.slice(bare.lastIndexOf("/") + 1).replace(/\.(notebook|page|ink)\.md$|\.md$/i, "");
}

/** "page 3", "pages 2, 5 and 7". */
function pagesWord(pages: readonly number[]): string {
  const list =
    pages.length <= 1
      ? pages.join("")
      : t("ai.list.and", {
          head: pages.slice(0, -1).join(", "),
          last: pages[pages.length - 1] ?? "",
        });
  return tn("ai.ask.pagesPhrase", pages.length, { list });
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
