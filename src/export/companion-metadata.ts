/**
 * A Companion PDF's Subject: `FineNotes companion <notebook id> <content hash>`.
 * It says which notebook the PDF belongs to and which content it shows, and
 * travels with the PDF to every device.
 *
 * Reading it never parses the PDF: `readCompanionSubject` finds the trailer's
 * /Info reference in the last bytes, then that object, and decodes its
 * /Subject string. This works because a Subject is only ever written with
 * the Info dictionary in the clear (`useObjectStreams: false` in
 * `pdf-composer.ts` and in `stampCompanionPdfSubject`); a PDF whose Info is
 * compressed into an object stream reads as having no Subject, which means
 * "not ours", the safe answer.
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

/** How far from the end the trailer (or the cross-reference stream's dictionary) is looked for. */
const TAIL_BYTES = 64 * 1024;

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let out = "";
  const step = 8192;
  for (let at = from; at < to; at += step) {
    out += String.fromCharCode(...bytes.subarray(at, Math.min(to, at + step)));
  }
  return out;
}

function isSpace(byte: number | undefined): boolean {
  return (
    byte === undefined ||
    byte === 0x20 ||
    byte === 0x0a ||
    byte === 0x0d ||
    byte === 0x09 ||
    byte === 0x0c ||
    byte === 0x00
  );
}

/** The last place `pattern` starts in `bytes`, standing alone (not part of a longer number). */
function lastIndexOfToken(bytes: Uint8Array, pattern: Uint8Array): number {
  outer: for (let at = bytes.length - pattern.length; at >= 0; at--) {
    for (let i = 0; i < pattern.length; i++) if (bytes[at + i] !== pattern[i]) continue outer;
    if (isSpace(bytes[at - 1])) return at;
  }
  return -1;
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

/**
 * Where object `num` starts, from the classic cross-reference tables (the
 * newest first, then each `/Prev`): a few small reads, wherever the object
 * is in the file. `null` for a PDF with a cross-reference stream, or any
 * table this cannot follow; the caller then searches for the object.
 */
function offsetFromXref(bytes: Uint8Array, start: number, num: number): number | null {
  const visited = new Set<number>();
  let at = start;
  while (at >= 0 && at < bytes.length && !visited.has(at)) {
    visited.add(at);
    let text = latin1(bytes, at, Math.min(bytes.length, at + 64));
    if (!text.startsWith("xref")) return null;
    let cursor = at + 4;
    for (;;) {
      text = latin1(bytes, cursor, Math.min(bytes.length, cursor + 64));
      const header = /^\s*(\d+)\s+(\d+)[ \t]*\r?\n/.exec(text);
      if (!header) break;
      const first = Number(header[1]);
      const count = Number(header[2]);
      const entries = cursor + header[0].length;
      if (num >= first && num < first + count) {
        const entry = latin1(
          bytes,
          entries + (num - first) * XREF_ENTRY,
          entries + (num - first + 1) * XREF_ENTRY,
        );
        const found = /^(\d{10}) (\d{5}) n/.exec(entry);
        return found ? Number(found[1]) : null;
      }
      cursor = entries + count * XREF_ENTRY;
    }
    const trailer = latin1(bytes, cursor, Math.min(bytes.length, cursor + 4096));
    if (!/^\s*trailer/.test(trailer)) return null;
    const prev = /\/Prev\s+(\d+)/.exec(trailer.slice(0, trailer.indexOf(">>") + 2));
    if (!prev) return null;
    at = Number(prev[1]);
  }
  return null;
}

/** Whether object `num gen` starts at `at`. */
function objectAt(bytes: Uint8Array, at: number, head: string): boolean {
  return (
    at >= 0 &&
    latin1(bytes, at, Math.min(bytes.length, at + head.length + 2))
      .trimStart()
      .startsWith(head)
  );
}

/**
 * The Companion Subject of a PDF's bytes, read from its trailer and Info
 * dictionary only. `null` when the PDF has none, or its Info is compressed.
 */
export function readCompanionSubject(input: ArrayBuffer | Uint8Array): CompanionPdfMeta | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const tail = latin1(bytes, Math.max(0, bytes.length - TAIL_BYTES), bytes.length);
  const refs = [...tail.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R/g)];
  const ref = refs[refs.length - 1];
  if (!ref) return null;
  const head = `${ref[1]} ${ref[2]} obj`;
  const startxref = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  const fromXref = startxref ? offsetFromXref(bytes, Number(startxref[1]), Number(ref[1])) : null;
  const at =
    fromXref !== null && objectAt(bytes, fromXref, head)
      ? fromXref
      : lastIndexOfToken(bytes, new TextEncoder().encode(head));
  if (at < 0) return null;
  // An Info dictionary is small; a few kilobytes hold it whole.
  const text = latin1(bytes, at, Math.min(bytes.length, at + 16 * 1024));
  const end = text.indexOf("endobj");
  return parseCompanionSubject(subjectIn(end < 0 ? text : text.slice(0, end)));
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
