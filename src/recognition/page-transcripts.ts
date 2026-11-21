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
 * The section ends with the notebook's links, handwritten and typed in text
 * boxes, when it has any (FineNotes#20), so Obsidian's backlinks, outgoing
 * links and graph see them:
 *
 *     ### Links
 *     <!--goodobsidian-links-->
 *     - [[Signals#FIR filters]] <!--1k9z0qa-->
 *     - <https://en.wikipedia.org/wiki/Finite_impulse_response>
 *
 * The list is rewritten from the notebook on save, only when it differs;
 * transcription writes leave it where it is, at the end. Each note link
 * carries a key: a hash of the target as the notebook stores it. When a note
 * or heading it leads to is renamed, Obsidian rewrites the link in this list
 * like any other, and the key tells which of the notebook's links it was,
 * so the notebook adopts the new target when it next loads
 * (`renamedLinkTargets`). A list written by 2.0.0 has no keys, and is read
 * by position: it was written from the same notebook, in the same order.
 *
 * No DOM, no Obsidian.
 */

import type { Page, TextBoxElement } from "../model/document";
import { drawnBounds } from "../model/board";
import { externalUrl, isExternalTarget, normalizeLinkTarget } from "../model/links";
import { readTextSection, writeTextSection } from "./text-layer";

/** The comment that opens the links list at the end of the section. */
export const LINKS_MARKER = "<!--goodobsidian-links-->";
const LINKS_HEADING = "### Links";
/**
 * The comment that opens the checklist (2.5), which sits between the page
 * entries and the links list (`recognition/task-index.ts`).
 */
export const TASKS_MARKER = "<!--goodobsidian-tasks-->";
export const TASKS_HEADING = "### Tasks";

/** Where a list at the section's end starts (its heading, or its marker), or -1. */
function listStart(lines: readonly string[], marker: string, heading: string): number {
  const at = lines.findIndex((line) => line.trim() === marker);
  if (at < 0) return -1;
  return at > 0 && lines[at - 1].trim() === heading ? at - 1 : at;
}

/** A section's lines, and where its checklist and its links list start (-1: none). */
function trailingLists(section: string): { lines: string[]; tasks: number; links: number } {
  const lines = section.replace(/\r\n?/g, "\n").split("\n");
  return {
    lines,
    tasks: listStart(lines, TASKS_MARKER, TASKS_HEADING),
    links: listStart(lines, LINKS_MARKER, LINKS_HEADING),
  };
}

/**
 * A section split into what comes before its lists (the checklist and the
 * links list) and the links list itself (from its heading, or its marker, to
 * the end or the checklist; "" when there is none).
 */
export function splitLinkIndex(section: string): { rest: string; links: string } {
  const { lines, tasks, links } = trailingLists(section);
  if (tasks < 0 && links < 0) return { rest: section, links: "" };
  const first = tasks < 0 ? links : links < 0 ? tasks : Math.min(tasks, links);
  return {
    rest: lines.slice(0, first).join("\n").trimEnd(),
    links:
      links < 0
        ? ""
        : lines
            .slice(links, tasks > links ? tasks : undefined)
            .join("\n")
            .trim(),
  };
}

/** A section's checklist, from its heading or marker to the links list or the end; "" for none. */
export function splitTaskIndex(section: string): string {
  const { lines, tasks, links } = trailingLists(section);
  if (tasks < 0) return "";
  return lines
    .slice(tasks, links > tasks ? links : undefined)
    .join("\n")
    .trim();
}

/** A section with its checklist replaced by `tasks` ("" removes it), before the links list. */
export function writeTaskIndex(section: string | null, tasks: string): string {
  const { rest, links } = splitLinkIndex(section ?? "");
  return [rest.trim(), tasks.trim(), links].filter((part) => part !== "").join("\n\n");
}

/**
 * The key a note link is listed under: FNV-1a over the target as the
 * notebook stores it, base 36.
 */
export function linkKey(target: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < target.length; i++) {
    h ^= target.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The links list for these targets, or "" for none. */
export function formatLinkIndex(targets: readonly string[]): string {
  if (targets.length === 0) return "";
  const items = targets.map((target) =>
    isExternalTarget(target)
      ? `- <${externalUrl(target)}>`
      : `- [[${target}]] <!--${linkKey(target)}-->`,
  );
  return [LINKS_HEADING, LINKS_MARKER, ...items].join("\n");
}

/** One item of a links list as it is on disk now. */
export interface ListedLink {
  /** Where it leads now: a note link's target, or a web address. */
  target: string;
  external: boolean;
  /** The key written beside a note link. */
  key?: string;
}

const NOTE_ITEM_RE = /^- \[\[(.*)\]\](?:\s*<!--([0-9a-z]+)-->)?$/;
const WEB_ITEM_RE = /^- <(.*)>$/;

/**
 * The items of a section's links list, in order. A line that is not an
 * item (a hand edit) is left out, and so is an alias, should one have been
 * added to a note link.
 */
export function readLinkIndex(section: string | null): ListedLink[] {
  const out: ListedLink[] = [];
  for (const raw of splitLinkIndex(section ?? "").links.split("\n")) {
    const line = raw.trim();
    const note = NOTE_ITEM_RE.exec(line);
    const web = note ? null : WEB_ITEM_RE.exec(line);
    if (note) {
      const target = normalizeLinkTarget(`[[${note[1]}]]`);
      const key = note[2] ? { key: note[2] } : {};
      if (target !== undefined) out.push({ target, external: false, ...key });
    } else if (web) out.push({ target: web[1], external: true });
  }
  return out;
}

/** Whether a target read back from the list can stand in a box's `[[…]]`, and in the list again. */
function adoptable(target: string): boolean {
  return !isExternalTarget(target) && !/[[\]]/.test(target);
}

/**
 * The note links Obsidian renamed in the list since the notebook wrote it:
 * each of `targets` (the notebook's own, as `linkTargets` gives them) whose
 * item now leads somewhere else, mapped to where. Nothing is guessed: a key
 * two targets share, or that two items carry with different targets,
 * renames neither; a list without keys counts only when it lines up with
 * `targets` item for item, web links included.
 */
export function renamedLinkTargets(
  section: string | null,
  targets: readonly string[],
): Map<string, string> {
  const renames = new Map<string, string>();
  const items = readLinkIndex(section);
  const adopt = (from: string, to: string): void => {
    if (to !== from && !isExternalTarget(from) && adoptable(to)) renames.set(from, to);
  };

  if (!items.some((item) => item.key !== undefined)) {
    // Written by 2.0.0: by position.
    if (items.length !== targets.length) return renames;
    const lined = targets.every((target, i) =>
      isExternalTarget(target)
        ? items[i].external && items[i].target === externalUrl(target)
        : !items[i].external,
    );
    if (lined) targets.forEach((target, i) => adopt(target, items[i].target));
    return renames;
  }

  // Where each key leads now, and how many of the notebook's targets have it.
  const listed = new Map<string, Set<string>>();
  for (const { key, target } of items) {
    if (key !== undefined) listed.set(key, (listed.get(key) ?? new Set()).add(target));
  }
  const owners = new Map<string, number>();
  const notes = targets.filter((target) => !isExternalTarget(target));
  for (const key of notes.map(linkKey)) owners.set(key, (owners.get(key) ?? 0) + 1);
  for (const target of notes) {
    const key = linkKey(target);
    const now = listed.get(key);
    if (owners.get(key) === 1 && now?.size === 1) adopt(target, [...now][0]);
  }
  return renames;
}

/** A section with its links list replaced by one for these targets. */
export function writeLinkIndex(section: string | null, targets: readonly string[]): string {
  const rest = splitLinkIndex(section ?? "").rest.trim();
  const tasks = splitTaskIndex(section ?? "");
  const links = formatLinkIndex(targets);
  return [rest, tasks, links].filter((part) => part !== "").join("\n\n");
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
  /** Typed by a person (FineNotes#265): a machine never replaces it. */
  typed?: true;
  /**
   * A hash of the text as a machine wrote it ({@link transcriptTextHash}).
   * Text that no longer matches it was edited by a person. Absent on
   * entries written before 2.11: those count as the machine's.
   */
  textHash?: string;
  /**
   * A machine transcription that arrived for a page whose text is a
   * person's: kept beside it, for the person to compare and choose
   * ({@link choosePageTranscript}), never written over it.
   */
  pending?: { hash: string; text: string };
}

/**
 * The line under a page's marker with what the marker cannot say (2.11):
 *
 *     <!--goodobsidian-meta typed t=1x9k3a new=1x9k3b~Encoded%20text-->
 *
 * A separate comment rather than more words on the marker, so a FineNotes
 * from before it, reading the marker with its stricter pattern, still finds
 * every page and keeps this line as part of the page's text.
 */
const META_RE = /^<!--goodobsidian-meta((?: \S+)*)-->$/;

/** A hash of a transcription's text, to tell later whether a person changed it. */
export function transcriptTextHash(text: string): string {
  let h = 0x811c9dc5;
  const clean = text.replace(/\r\n?/g, "\n").trim();
  for (let i = 0; i < clean.length; i++) {
    h ^= clean.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Whether an entry's text is a person's: typed, or a machine's text edited since. */
export function isPersonsTranscript(entry: PageTranscript): boolean {
  if (entry.typed) return true;
  return entry.textHash !== undefined && entry.textHash !== transcriptTextHash(entry.text);
}

type Meta = Pick<PageTranscript, "typed" | "textHash" | "pending">;

function readMeta(line: string): Meta | null {
  const match = META_RE.exec(line.trim());
  if (!match) return null;
  const meta: Meta = {};
  for (const token of match[1].trim().split(" ")) {
    if (token === "typed") meta.typed = true;
    else if (token.startsWith("t=")) meta.textHash = token.slice(2);
    else if (token.startsWith("new=")) {
      const [hash, encoded] = token.slice(4).split("~");
      const text = decodeKey(encoded ?? "");
      if (text.trim()) meta.pending = { hash: hash ?? "", text };
    }
  }
  return meta;
}

function writeMeta(entry: PageTranscript): string {
  const tokens: string[] = [];
  if (entry.typed) tokens.push("typed");
  if (entry.textHash) tokens.push(`t=${entry.textHash}`);
  if (entry.pending) {
    tokens.push(`new=${entry.pending.hash}~${encodeURIComponent(entry.pending.text)}`);
  }
  return tokens.length > 0 ? `<!--goodobsidian-meta ${tokens.join(" ")}-->\n` : "";
}

/** One page's block in the section: heading, marker, meta line and text. */
function entryBlock(entry: PageTranscript, index: number): string {
  const marker = `<!--goodobsidian-page ${encodeURIComponent(entry.key)} ${entry.hash}${entry.device ? " device" : ""}-->`;
  return `### Page ${index + 1}\n${marker}\n${writeMeta(entry)}${entry.text}`;
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

  const entries = starts.map((s, n): PageTranscript => {
    const body = lines.slice(s.body, n + 1 < starts.length ? starts[n + 1].start : lines.length);
    const meta = body.length > 0 ? readMeta(body[0]) : null;
    return {
      key: s.key,
      hash: s.hash,
      ...(s.device ? { device: true as const } : {}),
      ...(meta ?? {}),
      text: (meta ? body.slice(1) : body).join("\n").trim(),
    };
  });
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
  /** Typed by a person: replaces whatever is there, a person's text included. */
  typed?: boolean;
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
  exact?: PageTranscript,
): string {
  const parsed = parsePageTranscripts(section);
  const links = splitLinkIndex(section ?? "").links;
  const tasks = splitTaskIndex(section ?? "");
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
  if (exact) byKey.set(exact.key, exact);
  for (const update of updates) {
    const text = update.text.trim();
    const prior = byKey.get(update.key);
    if (update.typed) {
      if (text) byKey.set(update.key, { key: update.key, hash: update.hash, text, typed: true });
      else byKey.delete(update.key);
      continue;
    }
    // A machine never writes over a person's text (FineNotes#265): a reading
    // on the device is dropped, a transcription waits beside it to be chosen.
    // The page's hash moves on either way, so the page is not sent again.
    if (prior && isPersonsTranscript(prior)) {
      if (update.device) continue;
      const same = !text || text === prior.text.trim();
      byKey.set(update.key, {
        ...prior,
        hash: update.hash,
        pending: same ? undefined : { hash: update.hash, text },
      });
      continue;
    }
    const device = update.device === true ? { device: true as const } : {};
    if (text) {
      byKey.set(update.key, {
        key: update.key,
        hash: update.hash,
        text,
        ...device,
        textHash: transcriptTextHash(text),
      });
    } else byKey.delete(update.key);
  }

  const blocks: string[] = preamble ? [preamble] : [];
  keys.forEach((key, index) => {
    const entry = byKey.get(key);
    if (!entry || !entry.text) return;
    blocks.push(entryBlock(entry, index));
  });
  // The checklist and the links list stay at the end; they are rewritten on save, not here.
  if (tasks) blocks.push(tasks);
  if (links) blocks.push(links);
  return blocks.join("\n\n");
}

/**
 * Settle a page that has a transcription waiting beside a person's text:
 * `"mine"` keeps the person's text and drops the new one; `"new"` takes the
 * new one, which is then the machine's text like any other.
 */
export function choosePageTranscript(
  section: string | null,
  keys: readonly string[],
  key: string,
  choice: "mine" | "new",
): string {
  const parsed = parsePageTranscripts(section);
  const entry = parsed.entries.find((e) => e.key === key);
  const pending = entry?.pending;
  if (!entry || !pending) return section ?? "";
  const chosen: PageTranscript =
    choice === "mine"
      ? { ...entry, pending: undefined }
      : { key, hash: pending.hash, text: pending.text, textHash: transcriptTextHash(pending.text) };
  // Typed through the normal write, so headings, links and the checklist stay as they are.
  return updatePageTranscripts(
    section === null ? null : withoutEntry(section, entry, keys),
    keys,
    [],
    chosen,
  );
}

/** The section without `entry`'s block, re-read so the entry can be put back changed. */
function withoutEntry(section: string, entry: PageTranscript, keys: readonly string[]): string {
  const others = parsePageTranscripts(section).entries.filter((e) => e.key !== entry.key);
  const links = splitLinkIndex(section).links;
  const tasks = splitTaskIndex(section);
  const preamble = parsePageTranscripts(section).preamble;
  const blocks: string[] = preamble ? [preamble] : [];
  keys.forEach((key, index) => {
    const other = others.find((e) => e.key === key);
    if (other && other.text) blocks.push(entryBlock(other, index));
  });
  if (tasks) blocks.push(tasks);
  if (links) blocks.push(links);
  return blocks.join("\n\n");
}

/** Where a page's transcription came from, as the Files tab says it. */
export type TranscriptSource = "ai" | "device" | "typed" | "edited";

/** One page's transcription, for the Files tab. */
export interface PageTranscriptView {
  key: string;
  /** 0-based page index. */
  page: number;
  text: string;
  source: TranscriptSource;
  /** A new transcription waiting beside a person's text. */
  pending?: string;
}

/** Every transcribed page, in page order, for the Files tab's Transcripts. */
export function pageTranscriptViews(
  section: string | null,
  keys: readonly string[],
): PageTranscriptView[] {
  const entries = new Map(parsePageTranscripts(section).entries.map((e) => [e.key, e]));
  const views: PageTranscriptView[] = [];
  keys.forEach((key, page) => {
    const entry = entries.get(key);
    if (!entry || !entry.text) return;
    const source: TranscriptSource = entry.typed
      ? "typed"
      : isPersonsTranscript(entry)
        ? "edited"
        : entry.device
          ? "device"
          : "ai";
    views.push({
      key,
      page,
      text: entry.text,
      source,
      ...(entry.pending ? { pending: entry.pending.text } : {}),
    });
  });
  return views;
}

/**
 * FNV-1a over everything a page transcription reads: strokes (ids and
 * quantized points), typed text boxes, the paper, and the tables, graphs,
 * equations and pictures the page shows. Base 36, lower case — the alphabet
 * the page comment accepts.
 *
 * The last four were missing until FineNotes#265's review: a page whose
 * table was edited stayed "up to date". They are mixed in only when a page
 * has them, so a page without them keeps the hash it was recorded with and
 * is not sent again.
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
  const shown = [page.tables, page.graphs, page.equations, page.images];
  for (const elements of shown) {
    if (!elements || elements.length === 0) continue;
    for (const element of elements) mixText(JSON.stringify(element));
  }
  return (h >>> 0).toString(36);
}

/** At most this many pages go out in one automatic transcription; the rest wait for the next. */
export const AUTO_TRANSCRIBE_MAX_PAGES = 3;

/**
 * Which of the pages changed since the last automatic transcription go out
 * now (`now`, in page order, at most `max`) and which wait for the next
 * quiet moment (`later`). A page deleted meanwhile is dropped. Automatic
 * transcription reads the pages that were written on, not whichever page is
 * in view when the wait runs out.
 */
export function autoTranscriptionBatch(
  changed: ReadonlySet<string>,
  pageIds: readonly string[],
  max = AUTO_TRANSCRIBE_MAX_PAGES,
): { now: string[]; later: string[] } {
  const waiting = pageIds.filter((id) => changed.has(id));
  return { now: waiting.slice(0, max), later: waiting.slice(max) };
}

/** Paper kept below the lowest writing when a page is cut for transcription, page px. */
export const AI_CROP_MARGIN = 48;
/** A cut that would save less than this share of the page is not worth making. */
export const AI_CROP_MIN_SAVING = 0.15;

/**
 * How much of a page, from its top, a transcription needs to see: down to
 * the lowest writing, text, table or picture, plus a margin; `null` for the
 * whole page. Image tokens grow with pixels, so a page written to halfway
 * costs about half (the image keeps the whole page's scale, see
 * `renderPageForAi`). Only the bottom is cut: the paper's lines stay where
 * they are under the ink. A PDF page is never cut, as its printed text may
 * be read too.
 */
export function transcriptionCropHeight(
  page: Page,
  textHeight?: (text: TextBoxElement) => number,
): number | null {
  if (page.backdrop.kind === "pdf") return null;
  const drawn = drawnBounds(page, textHeight);
  if (!drawn) return null;
  const { height } = page.geometry;
  const keep = Math.min(height, Math.ceil(Math.max(0, drawn.maxY) + AI_CROP_MARGIN));
  return keep <= height * (1 - AI_CROP_MIN_SAVING) ? keep : null;
}

/** Whether a page has anything a transcription could read. */
export function hasTranscribableContent(page: Page): boolean {
  return page.strokes.length > 0 || page.textBoxes.some((box) => box.text.trim() !== "");
}

/** Whether a page has anything to ask about (a PDF slide counts, ink or not). */
export function hasAskableContent(page: Page): boolean {
  return hasTranscribableContent(page) || page.images.length > 0 || page.backdrop.kind === "pdf";
}
