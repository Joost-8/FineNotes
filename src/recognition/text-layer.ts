/**
 * The one block of a note's body that FineNotes writes: the text layer
 * (page transcriptions), fenced by two HTML comments that reading view does
 * not show. Everything else in the body is the user's. A write replaces the
 * block and may adjust the blank lines where it meets the prose, and touches
 * nothing further out. Pure: no DOM, no Obsidian.
 */

export const SECTION_OPEN = "<!--goodobsidian-text-->";
export const SECTION_CLOSE = "<!--/goodobsidian-text-->";

// Also matches the `inkedmark-text` markers a note written before 0.2.0
// carries; a write replaces the whole span, so the current markers come out.
const SECTION_RE =
  /\n*<!--(?:goodobsidian|inkedmark)-text-->\n?([\s\S]*?)\n?<!--\/(?:goodobsidian|inkedmark)-text-->\n?/;

/** What the block holds, or null when the note has no block. */
export function readTextSection(body: string): string | null {
  return SECTION_RE.exec(body)?.[1] ?? null;
}

/**
 * `body` with its block set to `text`. A note without a block gets one at
 * the end; a blank `text` takes the block out again.
 */
export function writeTextSection(body: string, text: string): string {
  const found = SECTION_RE.exec(body);
  const blank = text.trim() === "";
  if (!found) return blank ? body : appendBlock(body, text);
  const before = body.slice(0, found.index);
  const after = body.slice(found.index + found[0].length);
  return blank ? removeBlock(before, after) : replaceBlock(before, after, text);
}

function blockOf(text: string): string {
  return `${SECTION_OPEN}\n${text}\n${SECTION_CLOSE}`;
}

/** A new block goes one blank line below the prose, which loses its trailing whitespace. */
function appendBlock(body: string, text: string): string {
  const prose = body.replace(/\s+$/, "");
  return `${prose}${prose ? "\n\n" : ""}${blockOf(text)}\n`;
}

/**
 * The seams are written as they always have been, so a note that is saved
 * again comes out the same: one blank line above the block (the pattern took
 * the newlines there with it, so `before` never ends in one), and below it a
 * line break, plus one blank line if the user had left any. Inside the block,
 * runs of blank lines close up to one.
 */
function replaceBlock(before: string, after: string, text: string): string {
  const rest = after.replace(/^\n+/, "");
  const below = rest.length < after.length ? "\n\n" : "\n";
  return `${before}\n\n${blockOf(text).replace(/\n{3,}/g, "\n\n")}${below}${rest}`;
}

/** Where the block was, the prose on either side meets on a single line break. */
function removeBlock(before: string, after: string): string {
  const above = before.replace(/\s+$/, "");
  const below = after.replace(/^\s+/, "");
  return above ? `${above}\n${below}` : below;
}
