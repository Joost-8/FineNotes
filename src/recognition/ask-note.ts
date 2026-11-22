/**
 * Ask AI about a text note: what is sent with a question. The note goes as
 * its own Markdown (a text file), with each handwriting section as a
 * picture, as a notebook sends its pages; with every question, as it is
 * then, as a board sends what is on screen. PURE.
 */

import type { ChatFile, ChatTurn } from "./ai-chat";
import { encodeNote } from "../model/text-note-file";
import type { NoteBlock, TextNote } from "../model/text-note";

/** The system prompt for a question about a text note. */
export function buildNoteAskSystemPrompt(): string {
  return [
    "You are helping someone with their own note in Obsidian.",
    "Each question comes with the note as it is now: its text as a Markdown file, and each handwriting section in it as an image, in the order they appear (the text marks where each one is).",
    "Answer from what the note says; when you add something it does not say, say so. Answer in the language of the question, in concise markdown. Use $...$ LaTeX for mathematics.",
    "To draw something (a graph, a diagram, a labelled sketch), write a complete SVG document in a ```svg code block. Mermaid code blocks are drawn too.",
  ].join("\n");
}

/** How many handwriting sections a note has that hold ink. */
export function inkSectionCount(note: TextNote): number {
  return note.blocks.filter((block) => block.type === "ink" && block.strokes.length > 0).length;
}

/**
 * The note as the AI reads it: its Markdown, with each handwriting section
 * that holds ink replaced by a line naming its image (`[Handwriting 1:
 * image 1]`, counted as {@link inkSectionCount} counts), and empty ones left out.
 */
export function noteAskText(note: TextNote): string {
  let n = 0;
  const blocks: NoteBlock[] = [];
  for (const block of note.blocks) {
    if (block.type !== "ink") {
      blocks.push(block);
      continue;
    }
    if (block.strokes.length === 0) continue;
    n++;
    blocks.push({ type: "raw", id: block.id, text: `[Handwriting ${n}: image ${n}]` });
  }
  return encodeNote({ blocks }).trim();
}

/** The note as a file attached to a question. */
export function noteAskFile(name: string, note: TextNote): ChatFile {
  return { name, mimeType: "text/plain", text: noteAskText(note) };
}

/**
 * The conversation as it is sent: the note, as it is now, attached first
 * to the last question. Earlier questions keep what they were sent with,
 * so the note is not sent twice.
 */
export function withNoteContext(turns: readonly ChatTurn[], file: ChatFile): ChatTurn[] {
  const last = turns.length - 1;
  if (last < 0 || turns[last].role !== "user") return [...turns];
  const turn = turns[last];
  return [...turns.slice(0, last), { ...turn, files: [file, ...(turn.files ?? [])] }];
}
