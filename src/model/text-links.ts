/**
 * Links inside a text box's text (FineNotes#20), written the way Obsidian
 * writes them: `[[Note]]`, `[[Note#Heading]]`, `[[Note|shown text]]`,
 * `[label](https://…)`, or a bare `https://…` or `www.…` address. The text
 * is stored as typed; while a box is not being edited, the view shows each
 * link as its shown text (brackets hidden, as Obsidian's reading view does)
 * in the accent colour, and a tap opens it.
 *
 * PURE: no DOM, no Obsidian.
 */

/** Whether a target is a web address (or another scheme) rather than a note in the vault. */
export function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || /^www\./i.test(target);
}

/** A target as found in the text: one trimmed line, or nothing. */
function targetOf(raw: string): string | undefined {
  const target = raw.replace(/\s+/g, " ").trim();
  return target === "" ? undefined : target;
}

/** A run of a box's text: plain, or a link with where it leads. */
export interface TextSegment {
  /** What is shown. */
  text: string;
  /** Where it leads, for a link. */
  target?: string;
}

// A wikilink, a markdown link, or a bare address. One line each.
const LINK_RE =
  /\[\[([^[\]\n]+?)\]\]|\[([^[\]\n]+)\]\(([^()\s]+)\)|((?:https?:\/\/|www\.)[^\s<>]+)/gi;

/** Punctuation that ends a sentence after an address, not the address itself. */
const TRAILING = /[.,;:!?'"]+$/;

/** A box's text as plain runs and links, in order. Text without links is one plain run. */
export function textSegments(raw: string): TextSegment[] {
  const out: TextSegment[] = [];
  const plain = (text: string): void => {
    if (text === "") return;
    const last = out[out.length - 1];
    if (last && last.target === undefined) last.text += text;
    else out.push({ text });
  };
  let at = 0;
  for (const match of raw.matchAll(LINK_RE)) {
    const start = match.index;
    let whole = match[0];
    let link: TextSegment | null = null;
    if (match[1] !== undefined) {
      const bar = match[1].indexOf("|");
      const target = targetOf(bar >= 0 ? match[1].slice(0, bar) : match[1]);
      const shown = (bar >= 0 ? match[1].slice(bar + 1) : match[1]).trim();
      if (target) link = { text: shown || target, target };
    } else if (match[2] !== undefined) {
      const target = targetOf(match[3]);
      if (target) link = { text: match[2], target };
    } else {
      // A bare address gives back the full stop or comma that ends its sentence,
      // and a closing bracket it did not open.
      let address = whole.replace(TRAILING, "");
      if (address.endsWith(")") && !address.includes("(")) address = address.slice(0, -1);
      address = address.replace(TRAILING, "");
      whole = address;
      link = { text: address, target: address };
    }
    plain(raw.slice(at, start));
    if (link) out.push(link);
    else plain(whole);
    at = start + whole.length;
  }
  plain(raw.slice(at));
  return out;
}

/** What a box shows when it is not being edited: its links as their shown text. */
export function displayText(raw: string): string {
  return textSegments(raw)
    .map((s) => s.text)
    .join("");
}

/** Whether a box's text has any link in it. */
export function hasTextLinks(raw: string): boolean {
  return textSegments(raw).some((s) => s.target !== undefined);
}

/** Where a box's links lead, once each, in order. */
export function textLinkTargets(raw: string): string[] {
  const out: string[] = [];
  for (const s of textSegments(raw)) if (s.target && !out.includes(s.target)) out.push(s.target);
  return out;
}

/**
 * A box's text with its note links pointed somewhere else: `rename` gives a
 * link's new target, or `undefined` to leave it. Only the target changes; a
 * wikilink keeps its shown text, a markdown link its label. A markdown link
 * whose new target cannot be written between its parentheses (a space in
 * the name) becomes a wikilink with the same label. Web addresses and
 * everything outside a link stay exactly as typed.
 */
export function renameTextLinks(
  raw: string,
  rename: (target: string) => string | undefined,
): string {
  const renamed = (text: string): string | undefined => {
    const target = targetOf(text);
    return target === undefined || isExternalTarget(target) ? undefined : rename(target);
  };
  return raw.replace(LINK_RE, (whole, wiki?: string, label?: string, href?: string) => {
    if (wiki !== undefined) {
      const bar = wiki.indexOf("|");
      const to = renamed(bar >= 0 ? wiki.slice(0, bar) : wiki);
      return to === undefined ? whole : `[[${to}${bar >= 0 ? wiki.slice(bar) : ""}]]`;
    }
    const to = label !== undefined && href !== undefined ? renamed(href) : undefined;
    if (to === undefined) return whole;
    return /^[^()\s]+$/.test(to) ? `[${label}](${to})` : `[[${to}|${label}]]`;
  });
}
