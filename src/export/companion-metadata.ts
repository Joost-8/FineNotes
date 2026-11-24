/** Ownership travels invisibly inside the PDF's Subject metadata. */
import { PDFDocument } from "pdf-lib";
import { validCompanionId } from "../model/companion-pdf";

const PREFIX = "FineNotes companion ";

export function companionPdfSubject(id: string): string {
  if (!validCompanionId(id)) throw new Error("Invalid companion identity");
  return PREFIX + id;
}

export async function companionPdfIdentity(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const pdf = await PDFDocument.load(bytes);
    const subject = pdf.getSubject();
    if (!subject?.startsWith(PREFIX)) return null;
    const id = subject.slice(PREFIX.length);
    return validCompanionId(id) ? id : null;
  } catch {
    return null;
  }
}

export async function stampCompanionPdfSubject(
  bytes: ArrayBuffer,
  id: string,
): Promise<Uint8Array> {
  const subject = companionPdfSubject(id);
  const pdf = await PDFDocument.load(bytes);
  pdf.setSubject(subject);
  return pdf.save();
}
