/** Ownership and content hash travel invisibly inside the PDF's Subject metadata. */
import { PDFDocument } from "pdf-lib";
import { validCompanionId } from "../model/companion-pdf";

const PREFIX = "FineNotes companion ";
const HASH_RE = /^[a-f0-9]{16}$/;

export interface CompanionPdfMeta {
  id: string;
  contentHash: string | null;
}

export function companionPdfSubject(id: string, contentHash?: string): string {
  if (!validCompanionId(id)) throw new Error("Invalid companion identity");
  if (contentHash && HASH_RE.test(contentHash)) {
    return `${PREFIX}${id} ${contentHash}`;
  }
  return PREFIX + id;
}

export async function companionPdfMeta(bytes: ArrayBuffer): Promise<CompanionPdfMeta | null> {
  try {
    const pdf = await PDFDocument.load(bytes);
    const subject = pdf.getSubject();
    if (!subject?.startsWith(PREFIX)) return null;
    const parts = subject.slice(PREFIX.length).trim().split(/\s+/);
    const id = parts[0] ?? "";
    if (!validCompanionId(id)) return null;
    const rawHash = parts[1];
    const contentHash = rawHash && HASH_RE.test(rawHash) ? rawHash : null;
    return { id, contentHash };
  } catch {
    return null;
  }
}

export async function companionPdfIdentity(bytes: ArrayBuffer): Promise<string | null> {
  return (await companionPdfMeta(bytes))?.id ?? null;
}

export async function stampCompanionPdfSubject(
  bytes: ArrayBuffer,
  id: string,
  contentHash?: string,
): Promise<Uint8Array> {
  const subject = companionPdfSubject(id, contentHash);
  const pdf = await PDFDocument.load(bytes);
  pdf.setSubject(subject);
  return pdf.save();
}
