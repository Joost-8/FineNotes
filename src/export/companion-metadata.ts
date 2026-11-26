/**
 * A Companion PDF's Subject: `FineNotes companion <notebook id> <content hash>`.
 * It says which notebook the PDF belongs to and which content it shows, and
 * travels with the PDF to every device.
 *
 * Reading it never parses the PDF: `readCompanionSubject` follows
 * `startxref` through the classic cross-reference tables (newest first),
 * takes /Info from the newest trailer that names one, looks that object up
 * in the same tables, and decodes its /Subject string. Anything else (a
 * cross-reference stream, a table it cannot follow, an object it cannot
 * find) reads as having no Subject, which means "not ours", the safe answer:
 * a PDF another tool rewrote is never taken for this notebook's, and never
 * overwritten. FineNotes writes its Subject with the Info dictionary and the
 * tables in the clear (`useObjectStreams: false` in `pdf-composer.ts` and
 * in `stampCompanionPdfSubject`).
 */
import { PDFDocument } from "pdf-lib";
import { CompanionError, validCompanionHash, validCompanionId } from "../model/companion-pdf";

const PREFIX = "FineNotes companion ";

export interface CompanionPdfMeta {
  id: string;
  contentHash: string | null;
}

export function companionPdfSubject(id: string, contentHash?: string): string {
  if (!validCompanionId(id)) throw new CompanionError("export");
  return validCompanionHash(contentHash) ? `${PREFIX}${id} ${contentHash}` : PREFIX + id;
}

/** The notebook id and content hash a Subject names, or `null` for any other Subject. */
export function parseCompanionSubject(subject: string | null | undefined): CompanionPdfMeta | null {
  if (!subject?.startsWith(PREFIX)) return null;
  const [id = "", hash] = subject.slice(PREFIX.length).trim().split(/\s+/);
  if (!validCompanionId(id)) return null;
  return { id, contentHash: validCompanionHash(hash) ? hash : null };
}

/** How far from the end `startxref` is looked for. */
const TAIL_BYTES = 4 * 1024;

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let out = "";
  const step = 8192;
  for (let at = from; at < to; at += step) {
    out += String.fromCharCode(...bytes.subarray(at, Math.min(to, at + step)));
  }
  return out;
}

/** The text of a PDF string: a literal `(…)` with its escapes, or hex `<…>`; UTF-16 when it says so. */
function decodePdfString(raw: string): string | null {
  let bytes: number[] = [];
  if (raw.startsWith("<")) {
    const hex = raw.slice(1, raw.indexOf(">")).replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
    const even = hex.length % 2 ? `${hex}0` : hex;
    for (let i = 0; i < even.length; i += 2) bytes.push(parseInt(even.slice(i, i + 2), 16));
  } else if (raw.startsWith("(")) {
    let depth = 0;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === "\\") {
        const n = raw[++i];
        const escapes: Record<string, number> = {
          n: 10,
          r: 13,
          t: 9,
          b: 8,
          f: 12,
          "(": 40,
          ")": 41,
          "\\": 92,
        };
        if (n === undefined) break;
        if (n in escapes) bytes.push(escapes[n]);
        else if (/[0-7]/.test(n)) {
          let oct = n;
          while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? "")) oct += raw[++i];
          bytes.push(parseInt(oct, 8) & 0xff);
        } else if (n === "\r" || n === "\n") {
          if (n === "\r" && raw[i + 1] === "\n") i++;
        } else bytes.push(n.charCodeAt(0));
        continue;
      }
      if (c === "(") {
        depth++;
        if (depth === 1) continue;
      } else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
      bytes.push(c.charCodeAt(0) & 0xff);
    }
  } else return null;
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    bytes = bytes.slice(2);
    let text = "";
    for (let i = 0; i + 1 < bytes.length; i += 2)
      text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return text;
  }
  return String.fromCharCode(...bytes);
}

/** The PDF string that follows `/Subject` in a dictionary's text, or `null`. */
function subjectIn(dict: string): string | null {
  const at = dict.lastIndexOf("/Subject");
  if (at < 0) return null;
  const rest = dict.slice(at + "/Subject".length).trimStart();
  if (rest.startsWith("<") && !rest.startsWith("<<")) {
    const end = rest.indexOf(">");
    return end < 0 ? null : decodePdfString(rest.slice(0, end + 1));
  }
  if (rest.startsWith("(")) return decodePdfString(rest);
  return null;
}

/** One cross-reference entry is 20 bytes: `oooooooooo ggggg n` and an end of line. */
const XREF_ENTRY = 20;

/** One classic cross-reference section: where its subsections are, and its trailer's text. */
interface XrefSection {
  subsections: Array<{ first: number; count: number; entries: number }>;
  trailer: string;
}

/**
 * The classic cross-reference sections from `start`, newest first,
 * following each trailer's /Prev. `null` when `start` does not lead to a
 * classic table, or a table cannot be read.
 */
function xrefChain(bytes: Uint8Array, start: number): XrefSection[] | null {
  const chain: XrefSection[] = [];
  const visited = new Set<number>();
  let at = start;
  for (;;) {
    if (at < 0 || at >= bytes.length || visited.has(at)) return null;
    visited.add(at);
    if (!latin1(bytes, at, Math.min(bytes.length, at + 8)).startsWith("xref")) return null;
    const subsections: XrefSection["subsections"] = [];
    let cursor = at + 4;
    for (;;) {
      const text = latin1(bytes, cursor, Math.min(bytes.length, cursor + 64));
      const header = /^\s*(\d+)\s+(\d+)[ \t]*\r?\n/.exec(text);
      if (!header) break;
      const entries = cursor + header[0].length;
      subsections.push({ first: Number(header[1]), count: Number(header[2]), entries });
      cursor = entries + Number(header[2]) * XREF_ENTRY;
    }
    const tail = latin1(bytes, cursor, Math.min(bytes.length, cursor + 4096));
    const trailer = /^\s*trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(tail)?.[1];
    if (trailer === undefined) return null;
    chain.push({ subsections, trailer });
    const prev = /\/Prev\s+(\d+)/.exec(trailer);
    if (!prev) return chain;
    at = Number(prev[1]);
  }
}

/**
 * Where object `num` starts, from the newest section that lists it.
 * `null` when none does, or the newest entry says it was freed.
 */
function offsetIn(bytes: Uint8Array, chain: XrefSection[], num: number): number | null {
  for (const section of chain) {
    for (const { first, count, entries } of section.subsections) {
      if (num < first || num >= first + count) continue;
      const at = entries + (num - first) * XREF_ENTRY;
      const entry = /^(\d{10}) (\d{5}) ([nf])/.exec(latin1(bytes, at, at + XREF_ENTRY));
      return entry && entry[3] === "n" ? Number(entry[1]) : null;
    }
  }
  return null;
}

/**
 * The Companion Subject of a PDF's bytes, read through its cross-reference
 * tables and Info dictionary only. `null` when the PDF has none, or it
 * cannot be read that way.
 */
export function readCompanionSubject(input: ArrayBuffer | Uint8Array): CompanionPdfMeta | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const tail = latin1(bytes, Math.max(0, bytes.length - TAIL_BYTES), bytes.length);
  const startxref = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!startxref) return null;
  const chain = xrefChain(bytes, Number(startxref[1]));
  if (!chain) return null;
  let info: RegExpExecArray | null = null;
  for (const section of chain) {
    info = /\/Info\s+(\d+)\s+(\d+)\s+R/.exec(section.trailer);
    if (info) break;
  }
  if (!info) return null;
  const at = offsetIn(bytes, chain, Number(info[1]));
  if (at === null) return null;
  // An Info dictionary is small; a few kilobytes hold it whole.
  const text = latin1(bytes, at, Math.min(bytes.length, at + 16 * 1024));
  const head = new RegExp(`^\\s*${info[1]}\\s+${info[2]}\\s+obj\\b`).exec(text);
  if (!head) return null;
  const end = text.indexOf("endobj");
  return parseCompanionSubject(subjectIn(text.slice(head[0].length, end < 0 ? undefined : end)));
}

/**
 * The same PDF with its Subject set: used once, when a PDF the user just
 * exported becomes the notebook's companion (the user's own tap).
 */
export async function stampCompanionPdfSubject(
  bytes: ArrayBuffer | Uint8Array,
  id: string,
  contentHash: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  pdf.setSubject(companionPdfSubject(id, contentHash));
  return pdf.save({ useObjectStreams: false });
}
