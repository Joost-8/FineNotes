/**
 * The vault files Ask AI may look at, read into `VaultDoc`s for
 * `search_vault` and `read_note` (`recognition/vault-context.ts` decides
 * what is in scope and how it reads).
 *
 * A notebook is read as text: Home's kept text for it when that is still
 * the file's (page by page, with this device's PDF text and the transcript
 * server's file), else the text layer in its note. A PDF is the printed
 * text this device has read of it; one never read has none. A Markdown note
 * is its text.
 */

import { type App, TFile } from "obsidian";
import { assemblePages } from "../search/library-search";
import {
  type PageText,
  folderNotebookSidecarPath,
  transcriptSidecarPath,
  transcriptsByKey,
} from "../search/notebook-search";
import { readTextSection } from "../recognition/text-layer";
import {
  type AskVaultScope,
  MAX_NOTE_BYTES,
  MAX_SCANNED_FILES,
  type VaultDoc,
  inScope,
  noteText,
} from "../recognition/vault-context";
import {
  type NotebookTextRecord,
  loadNotebookTexts,
  loadPrinted,
  printedKey,
  vaultKeyOf,
} from "./search-store";

/** How long a read of the vault is reused: within one question, not across a day. */
const KEEP_MS = 20_000;

export class VaultContextSource {
  private kept: { at: number; key: string; docs: VaultDoc[] } | null = null;

  constructor(
    private readonly app: App,
    private readonly isNotebook: (file: TFile) => boolean,
  ) {}

  /** The files in scope, newest first, read as text. */
  async docs(notebookPath: string, scope: AskVaultScope): Promise<VaultDoc[]> {
    const key = `${notebookPath}\n${scope}`;
    const now = Date.now();
    if (this.kept && this.kept.key === key && now - this.kept.at < KEEP_MS) return this.kept.docs;
    const files = this.files(notebookPath, scope);
    const vault = vaultKeyOf(this.app);
    const [texts, printed] = await Promise.all([
      loadNotebookTexts(vault).catch(() => new Map<string, NotebookTextRecord>()),
      files.some((f) => f.extension === "pdf")
        ? loadPrinted(vault).catch(() => new Map<string, { stamp: string; text: string }>())
        : Promise.resolve(new Map<string, { stamp: string; text: string }>()),
    ]);
    const printedOf = (pdf: { path: string; page: number }): string | undefined => {
      const kept = printed.get(printedKey(pdf.path, pdf.page));
      const file = this.app.vault.getFileByPath(pdf.path);
      return kept && file && kept.stamp === `${file.stat.mtime}:${file.stat.size}`
        ? kept.text
        : undefined;
    };
    const docs: VaultDoc[] = [];
    for (const file of files) {
      try {
        const doc = await this.read(file, texts, printed, printedOf);
        if (doc) docs.push(doc);
      } catch {
        // A file that cannot be read now is left out of this search.
      }
    }
    this.kept = { at: now, key, docs };
    return docs;
  }

  /** The paths in scope, for finding the file `read_note` names. */
  paths(notebookPath: string, scope: AskVaultScope): string[] {
    return this.files(notebookPath, scope).map((f) => f.path);
  }

  private files(notebookPath: string, scope: AskVaultScope): TFile[] {
    if (scope === "off") return [];
    return this.app.vault
      .getFiles()
      .filter(
        (f) =>
          (f.extension === "md" || f.extension === "pdf") &&
          (f.extension !== "md" || f.stat.size <= MAX_NOTE_BYTES) &&
          inScope(f.path, notebookPath, scope),
      )
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, MAX_SCANNED_FILES);
  }

  private async read(
    file: TFile,
    texts: ReadonlyMap<string, NotebookTextRecord>,
    printed: ReadonlyMap<string, { stamp: string; text: string }>,
    printedOf: (pdf: { path: string; page: number }) => string | undefined,
  ): Promise<VaultDoc | null> {
    if (file.extension === "pdf") {
      const pages: PageText[] = [];
      const prefix = printedKey(file.path, 0).replace(/0$/, "");
      for (const key of printed.keys()) {
        if (!key.startsWith(prefix)) continue;
        const page = Number(key.slice(prefix.length));
        const text = Number.isInteger(page) ? printedOf({ path: file.path, page }) : undefined;
        if (text?.trim()) pages.push({ pageIndex: page - 1, sources: [{ kind: "pdf", text }] });
      }
      pages.sort((a, b) => a.pageIndex - b.pageIndex);
      // A PDF never read on this device is still found by its name.
      return { path: file.path, kind: "pdf", pages, paged: true };
    }
    if (this.isNotebook(file)) {
      const sidecar = await this.sidecar(file.path);
      const record = texts.get(file.path);
      if (record && record.mtime === file.stat.mtime && record.size === file.stat.size) {
        const pages = assemblePages(record.pages, {
          sidecar: sidecar ? transcriptsByKey(sidecar) : undefined,
          printed: printedOf,
        });
        return { path: file.path, kind: "notebook", pages, paged: true };
      }
      // Home has not read this notebook as it is now: its text layer, and the transcript server's file.
      const layer = readTextSection(await this.app.vault.cachedRead(file)) ?? "";
      const text = [layer, sidecar ?? ""].filter((t) => t.trim()).join("\n\n");
      return {
        path: file.path,
        kind: "notebook",
        pages: [{ pageIndex: 0, sources: text ? [{ kind: "handwriting", text }] : [] }],
        paged: false,
      };
    }
    const text = noteText(await this.app.vault.cachedRead(file));
    return {
      path: file.path,
      kind: "note",
      pages: [{ pageIndex: 0, sources: text ? [{ kind: "text", text }] : [] }],
      paged: false,
    };
  }

  private async sidecar(path: string): Promise<string | null> {
    for (const candidate of [transcriptSidecarPath(path), folderNotebookSidecarPath(path)]) {
      const file = candidate ? this.app.vault.getFileByPath(candidate) : null;
      if (file instanceof TFile) return this.app.vault.cachedRead(file);
    }
    return null;
  }
}
