/**
 * A text note as files that read anywhere: a plain Markdown copy, and its
 * plain text for the clipboard.
 *
 * In the note's own file (`text-note-file.ts`) a handwriting section is an
 * Obsidian comment holding a page document, and a graph its JSON: hidden
 * everywhere but in FineNotes. The copy shows each as a picture beside it
 * instead (the view draws them as PNGs), links pictures and recordings with
 * standard Markdown links rather than Obsidian's `![[…]]`, and puts a blank
 * line between paragraphs, so a reader that joins lines keeps them apart.
 *
 * PURE: no DOM, no Obsidian.
 */

import { encodeNote } from "./text-note-file";
import {
  type AudioBlock,
  type GraphBlock,
  type ImageBlock,
  type InkBlock,
  type NoteBlock,
  type TextNote,
  isList,
  listMarkers,
  runsText,
} from "./text-note";

/** Where the copy finds what it shows: each a path relative to the copy, or null to leave it out. */
export interface MarkdownAssets {
  /** A handwriting section's picture; `n` counts the sections with ink, from 1. */
  ink(block: InkBlock, n: number): string | null;
  /** A graph's picture; `n` counts the graphs, from 1. */
  graph(block: GraphBlock, n: number): string | null;
  /** A picture's file. */
  image(block: ImageBlock): string | null;
  /** A recording's file. */
  audio(block: AudioBlock): string | null;
}

/** The name a handwriting section's picture is saved under. */
export function inkPictureName(n: number): string {
  return `Handwriting ${n}.png`;
}

/** The name a graph's picture is saved under. */
export function graphPictureName(n: number): string {
  return `Graph ${n}.png`;
}

/** A path as a Markdown link target: each part percent-encoded, so spaces and brackets survive. */
export function markdownLink(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29")))
    .join("/");
}

/** `to` (a vault path) as seen from the folder `fromDir` (a vault path, "" for the root). */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const target = to.split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < target.length - 1 && from[shared] === target[shared]) {
    shared++;
  }
  return [...from.slice(shared).map(() => ".."), ...target.slice(shared)].join("/");
}

/** A file's name without its folders and extension: a picture's alt text. */
function stem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[[\]]/g, "");
}

/** How a run of blocks is grouped into one Markdown paragraph. */
function groupOf(block: NoteBlock): string | null {
  if (block.type !== "text") return null;
  if (isList(block.kind)) return "list";
  if (block.kind === "quote") return "quote";
  if (block.kind === "mono") return "mono";
  return null;
}

/** Whether a block is a paragraph with nothing in it: the copy's blank lines say that already. */
function isEmptyParagraph(block: NoteBlock): boolean {
  return block.type === "text" && !groupOf(block) && runsText(block.runs).trim() === "";
}

/** The note as plain Markdown, its sections and graphs as pictures from `assets`. */
export function noteMarkdown(note: TextNote, assets: MarkdownAssets): string {
  const parts: string[] = [];
  const blocks = note.blocks;
  let inks = 0;
  let graphs = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === "ink") {
      if (block.strokes.length === 0) continue;
      const link = assets.ink(block, ++inks);
      if (link) parts.push(`![Handwriting ${inks}](${markdownLink(link)})`);
      continue;
    }
    if (block.type === "graph") {
      const link = assets.graph(block, ++graphs);
      const name = block.spec.expressions.join(", ") || `Graph ${graphs}`;
      if (link) parts.push(`![${name.replace(/[[\]]/g, "")}](${markdownLink(link)})`);
      continue;
    }
    if (block.type === "image") {
      const link = assets.image(block);
      if (link) parts.push(`![${stem(block.path)}](${markdownLink(link)})`);
      continue;
    }
    if (block.type === "audio") {
      const link = assets.audio(block);
      const name = block.path.slice(block.path.lastIndexOf("/") + 1);
      parts.push(link ? `[${name.replace(/[[\]]/g, "")}](${markdownLink(link)})` : name);
      continue;
    }
    if (block.type === "raw") {
      if (block.text.trim()) parts.push(block.text);
      continue;
    }
    if (isEmptyParagraph(block)) continue;
    // A list, a quote or a code block is one paragraph of its consecutive lines.
    const group = groupOf(block);
    let j = i + 1;
    if (group) while (j < blocks.length && groupOf(blocks[j]) === group) j++;
    // A list restarts its numbers after anything that is not a list item, so the run counts as the note does.
    const text = encodeNote({ blocks: blocks.slice(i, j) });
    if (text.trim()) parts.push(text);
    i = j - 1;
  }
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

/** The note as plain text: what a paste into a message or a mail shows. */
export function notePlainText(note: TextNote): string {
  const lines: string[] = [];
  const markers = listMarkers(note.blocks);
  note.blocks.forEach((block, i) => {
    if (block.type === "text") {
      const text = runsText(block.runs);
      const lead = "\t".repeat(block.indent ?? 0);
      if (block.kind === "check") lines.push(`${lead}${block.checked ? "☑" : "☐"} ${text}`);
      else if (block.kind === "bullet") lines.push(`${lead}• ${text}`);
      else if (block.kind === "dash") lines.push(`${lead}- ${text}`);
      else if (isList(block.kind)) lines.push(`${lead}${markers[i] ?? ""} ${text}`);
      else if (block.kind === "quote") lines.push(`> ${text}`);
      else lines.push(`${lead}${text}`);
      return;
    }
    if (block.type === "table") {
      for (const row of block.rows) lines.push(row.join("\t"));
      return;
    }
    // Handwriting as this device read it; nothing when it has not been read.
    if (block.type === "ink") {
      const read = block.reading?.text.trim();
      if (read) lines.push(...read.split("\n"));
      return;
    }
    if (block.type === "graph") {
      lines.push(...block.spec.expressions);
      return;
    }
    if (block.type === "raw") lines.push(block.text);
  });
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Where an export of the note `title` goes in `folder`: the copy's name,
 * free among `taken` (the names already in the folder), and the folder
 * beside it that holds its pictures, free too. Compared without case, as
 * the file systems a vault syncs to are.
 */
export function markdownTarget(
  title: string,
  taken: ReadonlySet<string>,
): { file: string; assets: string } {
  const base = title.trim() || "Note";
  const lower = new Set([...taken].map((name) => name.toLowerCase()));
  for (let n = 0; ; n++) {
    const name = n === 0 ? base : `${base} ${n}`;
    const file = `${name}.md`;
    const assets = `${name} files`;
    if (!lower.has(file.toLowerCase()) && !lower.has(assets.toLowerCase())) {
      return { file, assets };
    }
  }
}
