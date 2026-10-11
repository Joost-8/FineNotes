/**
 * Per-page transcriptions inside the text layer's managed section.
 *
 * `text-layer.ts` owns the `<!--goodobsidian-text-->` markers and guarantees
 * nothing outside them is ever touched. This module decides what goes
 * *inside*: one entry per transcribed page, in page order, each under a
 * `### Page N` heading so that Obsidian's search lands next to the right page
 * (contracts/api.md §1b — the reason the notebook layout exists):
 *
 *     ### Page 2
 *     <!--goodobsidian-page p2 1x9k3a-->
 *     …the transcription…
 *
 * The comment line carries the page's id and a hash of what was on the page
 * when it was transcribed, so "Transcribe whole notebook" can skip pages that
 * have not changed without a field in the model. Headings are renumbered on
 * every write, because pages move. A page read by the on-device recogniser
 * says so (`<!--goodobsidian-page p2 1x9k3a device-->`): its text keeps the
 * page searchable until a transcription replaces it, and transcribing does
 * not skip it.
 *
 * A section written before 0.5 has no page comments; it was a transcription of
 * page 1 (the old code only ever read `firstPage`), and is adopted as such.
 *
 * The section ends with the notebook's handwritten links, when it has any
 * (FineNotes#20), so Obsidian's backlinks and graph see them:
 *
 *     ### Links
 *     <!--goodobsidian-links-->
 *     - [[Signals#FIR filters]]
 *     - <https://en.wikipedia.org/wiki/Finite_impulse_response>
 *
 * The list is rewritten from the notebook on every save; transcription
 * writes leave it where it is, at the end.
 *
 * No DOM, no Obsidian.
 */

import type { Page } from "../model/document";
import { externalUrl, isExternalTarget } from "../model/links";
import { readTextSection, writeTextSection } from "./text-layer";

/** The comment that opens the links list at the end of the section. */
export const LINKS_MARKER = "<!--goodobsidian-links-->";
const LINKS_HEADING = "### Links";

/**
 * A section split into what comes before its links list and the list
 * itself (from its heading, or its marker, to the end; "" when there is none).
 */
export function splitLinkIndex(section: string): { rest: string; links: string } {
  const lines = section.replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((line) => line.trim() === LINKS_MARKER);
  if (at < 0) return { rest: section, links: "" };
  const start = at > 0 && lines[at - 1].trim() === LINKS_HEADING ? at - 1 : at;
  return {
    rest: lines.slice(0, start).join("\n").trimEnd(),
    links: lines.slice(start).join("\n").trim(),
  };
}

/** The links list for these targets, or "" for none. */
export function formatLinkIndex(targets: readonly string[]): string {
  if (targets.length === 0) return "";
  const items = targets.map((target) =>
    isExternalTarget(target) ? `- <${externalUrl(target)}>` : `- [[${target}]]`,
  );
  return [LINKS_HEADING, LINKS_MARKER, ...items].join("\n");
}

/** A section with its links list replaced by one for these targets. */
export function writeLinkIndex(section: string | null, targets: readonly string[]): string {
  const rest = splitLinkIndex(section ?? "").rest.trim();
  const links = formatLinkIndex(targets);
  return [rest, links].filter((part) => part !== "").join("\n\n");
}

/**
 * A note body with its links list brought up to date with the notebook's
 * link targets: unchanged (the same string) when it already is, so a save
 * of a notebook without links never adds an empty block.
 */
export function syncLinkIndex(body: string, targets: readonly string[]): string {
  const section = readTextSection(body);
  const current = splitLinkIndex(section ?? "").links;
  if (current === formatLinkIndex(targets)) return body;
  return writeTextSection(body, writeLinkIndex(section, targets));
}

export interface PageTranscript {
  /** Page key (see {@link pageKeys}). */
  key: string;
  /** Content hash when transcribed; "" when unknown (adopted legacy text). */
  hash: string;
  text: string;
  /** Read by the on-device recogniser, not transcribed. */
  device?: true;
}

export interface ParsedTranscripts {
  /** Anything inside the section before the first page entry. */
  preamble: string;
  entries: PageTranscript[];
  /** The section had text but no page comments (written before 0.5). */
  legacy: boolean;
}

const MARKER_RE = /^<!--goodobsidian-page (\S+) ([0-9a-z]*)( device)?-->$/;
const HEADING_RE = /^#{1,6} Page \d+$/;

/**
 * A stable key per page: its id, or `id~2`, `id~3`… for a repeat. Page ids
 * are only unique per file (contracts/api.md §1b), and an import can repeat
 * one; keying on the bare id would pour two pages' text into one entry.
 */
export function pageKeys(pages: readonly { id: string }[]): string[] {
  const seen = new Map<string, number>();
  return pages.map((page) => {
    const n = (seen.get(page.id) ?? 0) + 1;
    seen.set(page.id, n);
    return n === 1 ? page.id : `${page.id}~${n}`;
  });
}

function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Read the entries out of a managed section's inner text. */
export function parsePageTranscripts(raw: string | null): ParsedTranscripts {
  // The links list at the end is no page's text.
  const section = raw === null ? null : splitLinkIndex(raw).rest;
  if (!section || !section.trim()) return { preamble: "", entries: [], legacy: false };
  const lines = section.replace(/\r\n?/g, "\n").split("\n");

  // Each entry starts at its heading when one sits right above its comment.
  const starts: Array<{
    start: number;
    body: number;
    key: string;
    hash: string;
    device: boolean;
  }> = [];
  lines.forEach((line, i) => {
    const match = MARKER_RE.exec(line.trim());
    if (!match) return;
    const headed = i > 0 && HEADING_RE.test(lines[i - 1].trim());
    starts.push({
      start: headed ? i - 1 : i,
      body: i + 1,
      key: decodeKey(match[1]),
      hash: match[2],
      device: match[3] !== undefined,
    });
  });
  if (starts.length === 0) return { preamble: section.trim(), entries: [], legacy: true };

  const entries = starts.map((s, n) => ({
    key: s.key,
    hash: s.hash,
    ...(s.device ? { device: true as const } : {}),
    text: lines
      .slice(s.body, n + 1 < starts.length ? starts[n + 1].start : lines.length)
      .join("\n")
      .trim(),
  }));
  return { preamble: lines.slice(0, starts[0].start).join("\n").trim(), entries, legacy: false };
}

/**
 * Hash each transcribed page was transcribed at, by key. Pages only read on
 * the device are left out: to a transcription they are not done yet.
 */
export function transcriptHashes(section: string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of parsePageTranscripts(section).entries) {
    if (!entry.device) map.set(entry.key, entry.hash);
  }
  return map;
}

/** Every page entry's hash and whether it was read on the device, by key. */
export function transcriptSources(
  section: string | null,
): Map<string, { hash: string; device: boolean }> {
  const map = new Map<string, { hash: string; device: boolean }>();
  for (const entry of parsePageTranscripts(section).entries) {
    map.set(entry.key, { hash: entry.hash, device: entry.device === true });
  }
  return map;
}

export interface TranscriptUpdate {
  key: string;
  /** Blank removes the page's entry. */
  text: string;
  hash: string;
  /** Read by the on-device recogniser. */
  device?: boolean;
}

/**
 * Apply `updates` to a section and write it back in page order, headings
 * renumbered. Entries whose page no longer exists are dropped; a legacy
 * section is adopted as page 1's. Returns the new inner text — "" when
 * nothing is left, which `writeTextSection` turns into "no section".
 */
export function updatePageTranscripts(
  section: string | null,
  keys: readonly string[],
  updates: readonly TranscriptUpdate[],
): string {
  const parsed = parsePageTranscripts(section);
  const links = splitLinkIndex(section ?? "").links;
  const byKey = new Map<string, PageTranscript>();
  let preamble = parsed.preamble;
  if (parsed.legacy) {
    if (keys.length > 0) byKey.set(keys[0], { key: keys[0], hash: "", text: parsed.preamble });
    preamble = "";
  }
  for (const entry of parsed.entries) {
    const prior = byKey.get(entry.key);
    // A key written twice (hand edits) keeps both texts rather than losing one.
    byKey.set(
      entry.key,
      prior ? { ...entry, text: `${prior.text}\n\n${entry.text}`.trim() } : entry,
    );
  }
  for (const update of updates) {
    const text = update.text.trim();
    const device = update.device === true ? { device: true as const } : {};
    if (text) byKey.set(update.key, { key: update.key, hash: update.hash, text, ...device });
    else byKey.delete(update.key);
  }

  const blocks: string[] = preamble ? [preamble] : [];
  keys.forEach((key, index) => {
    const entry = byKey.get(key);
    if (!entry || !entry.text) return;
    blocks.push(
      `### Page ${index + 1}\n<!--goodobsidian-page ${encodeURIComponent(key)} ${entry.hash}${entry.device ? " device" : ""}-->\n${entry.text}`,
    );
  });
  // The links list stays at the end; it is rewritten on save, not here.
  if (links) blocks.push(links);
  return blocks.join("\n\n");
}

/**
 * FNV-1a over everything a page transcription reads: strokes (ids and
 * quantized points), typed text boxes and the paper. Base 36, lower case —
 * the alphabet the page comment accepts.
 */
export function pageContentHash(page: Page): string {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  const mixText = (s: string): void => {
    mix(s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  for (const stroke of page.strokes) {
    mixText(stroke.id);
    mix(stroke.pts.length);
    for (const v of stroke.pts) mix(Math.round(v * 100));
  }
  for (const box of page.textBoxes) {
    mixText(box.text);
    for (const v of [box.x, box.y, box.w, box.fontSize]) mix(Math.round(v));
  }
  mixText(JSON.stringify(page.backdrop));
  return (h >>> 0).toString(36);
}

/** Whether a page has anything a transcription could read. */
export function hasTranscribableContent(page: Page): boolean {
  return page.strokes.length > 0 || page.textBoxes.some((box) => box.text.trim() !== "");
}

/** Whether a page has anything to ask about (a PDF slide counts, ink or not). */
export function hasAskableContent(page: Page): boolean {
  return hasTranscribableContent(page) || page.images.length > 0 || page.backdrop.kind === "pdf";
}
