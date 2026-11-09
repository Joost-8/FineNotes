/**
 * The words a notebook already holds, for reading one of its pages
 * (EXP-T57's page words, confirmed on whole pages in EXP-PCONFIRM): the
 * notebook's title and the text of its OTHER pages, as Grape read them or
 * as they were transcribed. Handwriting repeats the notebook's own terms
 * (CSMA/CA, coprime, student-course), which no general word list has.
 *
 * The page being read is always left out: its own earlier reading would
 * only teach the decoder its own mistakes.
 *
 * A port of research/handwriting-rig/t5_context.py's `clean` and `entries`
 * and pc_eval.mjs's `tokens`, so the list is the one measured.
 *
 * PURE: no DOM, no Obsidian.
 */

/** Words shorter than this are not favoured (too many chance matches). */
export const PAGE_WORD_MIN_LENGTH = 3;

/** The comment that opens a page's entry in a notebook's text block (page-transcripts.ts). */
const MARK = /<!--goodobsidian-page (\S+) [a-z0-9]+( device)?-->/g;

/** Markdown and LaTeX to plain written text, roughly (`t5_context.clean`). */
export function plainTranscript(text: string): string {
  let t = text.replace(/\[sketch:[^\]]*\]/g, " ");
  t = t.replace(/\[\[[^\]|]*\|?([^\]]*)\]\]/g, "$1");
  t = t.replace(/\\(text|mathrm|mathbf|operatorname)\{([^}]*)\}/g, "$2");
  t = t.replace(/\\[a-zA-Z]+/g, " ");
  t = t.replace(/[$*_`#>{}\\]/g, " ");
  return t
    .split(/\r\n|[\n\r\v\f\x85\u2028\u2029]/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !l.startsWith("<!--"))
    .join("\n");
}

function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Page key → plain text of each page entry in a note (a notebook's body, or
 * a transcript file beside it), as `t5_context.entries` reads them: from a
 * page comment to the next one, cut at the next "Page N" heading and at the
 * block's end.
 */
export function pageEntries(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const marks = [...md.matchAll(MARK)];
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? md.length) : md.length;
    let body = md.slice(start, end);
    body = body.split(/\n#{2,3} Page \d+/)[0];
    body = body.split("<!--/goodobsidian-text-->")[0];
    out.set(decodeKey(m[1]), plainTranscript(body));
  });
  return out;
}

/** The words of `texts` (a letter, then letters or digits) of at least `PAGE_WORD_MIN_LENGTH`, lower case, once each. */
export function wordsOf(texts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const w of text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
      if (w.length >= PAGE_WORD_MIN_LENGTH) out.add(w.toLowerCase());
    }
  }
  return [...out];
}

/**
 * The page words for reading page `key` of a notebook: its title, and every
 * other page's entry in `notes` (the notebook's own body, then any
 * transcript file beside it).
 */
export function pageWords(title: string, notes: readonly string[], key: string): string[] {
  const texts = [title];
  for (const md of notes) {
    for (const [k, text] of pageEntries(md)) if (k !== key) texts.push(text);
  }
  return wordsOf(texts);
}
