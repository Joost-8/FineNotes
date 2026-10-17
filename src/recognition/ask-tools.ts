/**
 * The notebook tools Claude can use while answering in Ask: read pages,
 * search the notebook, add a text box or a page, go to a page, and put a
 * drawing on a page. Claude calls them by itself in the middle of an answer
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
] as const;

/** A tool call, its input checked. */
export type AskToolCall =
  | { tool: "read_pages"; pages: number[] }
  | { tool: "search_notebook"; query: string }
  | { tool: "add_text_box"; page: number; text: string }
  | { tool: "add_page"; after: number }
  | { tool: "go_to_page"; page: number }
  | { tool: "insert_drawing"; page: number; svg: string; title: string };

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
  }
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
