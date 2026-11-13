/**
 * Whether pasted text is clearly Markdown, so the text box it lands in reads
 * it as Markdown (discussion #107). Pure: no DOM, no Obsidian.
 *
 * Only clear signals count, so prose never flips a box:
 * - a heading line (`# Title`), unless the text reads as code, where `# ` is
 *   a comment;
 * - a list: two or more lines starting `- `, `* `, `+ ` or `1. ` (one such
 *   line is as often a dash in prose, or a numbered heading from a PDF);
 * - otherwise at least two different constructs among `**bold**`,
 *   `[link](url)`, a code fence and a table (a header row over `|---|`).
 *
 * Lines inside a code fence count for nothing but the fence itself.
 */

const HEADING = /^ {0,3}#{1,6}[ \t]+\S/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])[ \t]+\S/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const BOLD = /(?:\*\*|__)(?=\S)[^\n]*?\S(?:\*\*|__)/;
const LINK = /\[[^\]\n]+\]\([^)\s]+(?:\s+"[^"\n]*")?\)/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
/** Lines a programmer writes and a Markdown writer does not. */
const CODE_LINE =
  /(?:[;{}]\s*$)|^\s*(?:def|class|import|from|return|const|let|var|function|if|for|while|echo|export)\b[^\n]*[(:=;{]|^\s*[A-Za-z_$][\w$.]*\s*[+\-*/]?=\s*\S/;

export function looksLikeMarkdown(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  let fence = false;
  let heading = false;
  let listItems = 0;
  let codeLines = 0;
  let table = false;
  const prose: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      // A fence counts once it is closed: an opening alone may be a stray.
      if (inFence) fence = true;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    prose.push(line);
    if (HEADING.test(line)) heading = true;
    else if (LIST_ITEM.test(line)) listItems++;
    if (CODE_LINE.test(line)) codeLines++;
    if (i > 0 && TABLE_RULE.test(line) && lines[i - 1].includes("|") && !FENCE.test(lines[i - 1])) {
      table = true;
    }
  }
  if (heading && codeLines < 2) return true;
  if (listItems >= 2) return true;
  const body = prose.join("\n");
  const constructs = [fence, table, BOLD.test(body), LINK.test(body)].filter(Boolean).length;
  return constructs >= 2;
}
