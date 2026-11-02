/**
 * `obsidian://finenotes?do=…`: what a link from the Shortcuts app (or a
 * bookmark, or a launcher on a computer) asks FineNotes to do.
 *
 * - `do=new` — a notebook with the last notebook choices; `name` and
 *   `folder` optional (the new-notebook folder unless given).
 * - `do=pdf&file=Inbox/Lecture.pdf` — a notebook from a PDF in the vault,
 *   beside it, opened at its first page. A shortcut that has just saved the
 *   file passes its vault path; `.pdf` may be left off, and a bare name is
 *   looked for anywhere in the vault.
 *
 * Obsidian itself reads `vault`, and opens that vault first.
 */

/** The `obsidian://` action. Protocol actions are one name per plugin. */
export const FINENOTES_LINK_ACTION = "finenotes";

export type LinkRequest =
  | { do: "new"; name: string; folder?: string }
  | { do: "pdf"; file: string }
  | { do: "unknown"; what: string };

/** Obsidian hands a protocol handler the query as plain strings. */
export function parseFinenotesLink(
  params: Readonly<Record<string, string | undefined>>,
): LinkRequest {
  const what = (params.do ?? "").trim().toLowerCase();
  if (what === "new") {
    const folder = cleanPath(params.folder ?? "");
    return { do: "new", name: (params.name ?? "").trim(), ...(folder ? { folder } : {}) };
  }
  if (what === "pdf") {
    const file = cleanPath(params.file ?? "");
    return file ? { do: "pdf", file } : { do: "unknown", what: "pdf without a file" };
  }
  return { do: "unknown", what: what || "nothing" };
}

/** A vault path as a shortcut may write it: backslashes, a leading slash, spaces round it. */
function cleanPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/** The paths `file` may mean, in the order to try them. */
export function pdfCandidates(file: string): string[] {
  return /\.pdf$/i.test(file) ? [file] : [file, `${file}.pdf`];
}

/**
 * For a bare name (no folder), the vault PDF it means: the newest of that
 * name, since a shortcut has usually just saved it. `null` for a path with a
 * folder, which must match exactly, or when nothing has the name.
 */
export function pdfByName(
  file: string,
  pdfs: ReadonlyArray<{ path: string; name: string; mtime: number }>,
): string | null {
  if (file.includes("/")) return null;
  const names = new Set(pdfCandidates(file).map((name) => name.toLowerCase()));
  let best: { path: string; mtime: number } | null = null;
  for (const pdf of pdfs) {
    if (!names.has(pdf.name.toLowerCase())) continue;
    if (!best || pdf.mtime > best.mtime) best = pdf;
  }
  return best?.path ?? null;
}
