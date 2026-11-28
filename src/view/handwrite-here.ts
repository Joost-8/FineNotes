/**
 * "Handwrite here" for Markdown notes:
 * 1. The note's notebook: the one its blocks already use, else the notebook
 *    named after the note in Obsidian's attachment folder for it, made on
 *    first use (one file per page per device, as every new notebook is).
 *    "Handwrite here (choose notebook…)" picks another instead.
 * 2. A short, transparent `hw-<8 hex>` page is added to it.
 * 3. `![[Notebook#id=hw-…]]` goes in at the cursor, and opens for writing.
 */

import { type Editor, MarkdownView, Notice, TFile, addIcon, normalizePath } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { t } from "../i18n/translate";
import { emptyDocument, type Page } from "../model/document";
import { devicePagesNotebookText } from "../model/device-pages-writer";
import {
  INLINE_SKETCH_PREFIX,
  createInlineSketchPage,
  findLinkedNotebookInMarkdown,
  reusableNoteNotebook,
} from "../model/inline-sketch";
import { cleanTitle, newNoteBody, stripInkSuffix } from "../model/new-notebook";
import { HandwriteBlocksModal, InlineNotebookPickerModal } from "./handwrite-modals";
import { type BlockTarget, blockTarget, followHandwriteNotebook } from "../model/handwrite-blocks";
import { embedInsertion } from "./page-embed-model";
import { editClosedNotebook, notebookIsOpen, readClosedNotebook } from "./notebook-transaction";
import { EmbedInlineEditor, type EmbedInlineEditRequest } from "./embed-inline-editor";
import { closeAnyInlineEditor, closeInlineEditorIn } from "./inline-editor-registry";

const HANDWRITE_HERE_ICON = "finenotes-handwrite-here";
const HANDWRITE_HERE_SVG =
  '<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 5.5H10M4 19H20"/>' +
  '<path d="M8 15.5L8.9 12.2L15.4 5.7A1.7 1.7 0 0 1 17.8 8.1L11.3 14.6Z"/>' +
  "</g>";

let iconRegistered = false;

function ensureHandwriteIcon(): void {
  if (iconRegistered || typeof addIcon !== "function") return;
  iconRegistered = true;
  addIcon(HANDWRITE_HERE_ICON, HANDWRITE_HERE_SVG);
}

function newSketchId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return INLINE_SKETCH_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

async function ensureFolder(plugin: GoodObsidianPlugin, folder: string): Promise<void> {
  if (!folder || plugin.app.vault.getFolderByPath(folder)) return;
  try {
    await plugin.app.vault.createFolder(folder);
  } catch {
    /* Made meanwhile by something else. */
  }
}

/**
 * The notebook named `name` in the note's attachment folder: the one there
 * already, or a new one holding `initialPage`.
 */
async function notebookFor(
  plugin: GoodObsidianPlugin,
  sourcePath: string,
  name: string,
  initialPage: Page,
): Promise<{ file: TFile; created: boolean }> {
  const { app } = plugin;
  const base = cleanTitle(stripInkSuffix(name)) || t("notebooks.handwrite.blockName");
  const fileName = `${base}.notebook.md`;
  // Obsidian's own rule for where this note's attachments go; it answers with
  // a free name, so the one already there is looked for beside it first.
  const available = normalizePath(
    await app.fileManager.getAvailablePathForAttachment(fileName, sourcePath),
  );
  const folder = parentOf(available);
  const existing = app.vault.getFileByPath(
    normalizePath(folder ? `${folder}/${fileName}` : fileName),
  );
  if (existing && plugin.isInkFile(existing) && (await isNotesOwn(plugin, existing, sourcePath))) {
    return { file: existing, created: false };
  }
  // Someone's own notebook of that name, or another note's: a free name beside it.
  await ensureFolder(plugin, folder);
  const doc = emptyDocument(plugin.settings.paperWidth);
  doc.pages = [initialPage];
  // Made as every new notebook is: one file per page per device (#274).
  const body = newNoteBody(base, new Date().toISOString());
  const file = await app.vault.create(available, devicePagesNotebookText(body, doc));
  return { file, created: true };
}

/**
 * Whether `file` is the notebook Handwrite here made for the note at
 * `sourcePath`: only blocks in it, and no other note embeds it.
 */
async function isNotesOwn(
  plugin: GoodObsidianPlugin,
  file: TFile,
  sourcePath: string,
): Promise<boolean> {
  let pages: readonly Pick<Page, "id">[];
  try {
    pages = (await readClosedNotebook(plugin.app, file, plugin.settings.paperWidth)).pages;
  } catch {
    return false;
  }
  const links = plugin.app.metadataCache.resolvedLinks ?? {};
  const linking = Object.keys(links).filter((note) => (links[note]?.[file.path] ?? 0) > 0);
  return reusableNoteNotebook(pages, linking, sourcePath);
}

async function resolveBackingNotebook(
  plugin: GoodObsidianPlugin,
  source: TFile,
  markdown: string,
  pick: boolean,
  initialPage: Page,
): Promise<{ file: TFile; created: boolean } | null> {
  const { app, settings } = plugin;
  const linked = findLinkedNotebookInMarkdown(markdown);
  const linkedDest = linked ? app.metadataCache.getFirstLinkpathDest(linked, source.path) : null;
  const currentNotebook = linkedDest instanceof TFile ? linkedDest : null;
  const noteName = cleanTitle(stripInkSuffix(source.basename)) || source.basename;
  const where = (): BlockTarget =>
    blockTarget(settings, {
      choose: pick,
      linked: currentNotebook?.path ?? null,
      exists: (path) => app.vault.getFileByPath(path) !== null,
    });

  let target = where();
  if (target.kind === "first-use") {
    // Asked until the user confirms with Continue; dismissing cancels without saving the flag.
    const picked = await HandwriteBlocksModal.choose(app);
    if (picked === null) return null;
    if (picked === "one") {
      const choice = await InlineNotebookPickerModal.pick(app, {
        defaultCreateName: t("notebooks.handwrite.blockName"),
        placeholder: t("notebooks.handwrite.pickFixedPlaceholder"),
      });
      if (!choice) return null;
      settings.handwriteBlocks = "one";
      settings.handwriteBlocksChosen = true;
      if (choice.kind === "existing") {
        settings.handwriteNotebook = choice.file.path;
        await plugin.saveSettings();
      } else {
        const made = await notebookFor(plugin, source.path, choice.name, initialPage);
        settings.handwriteNotebook = made.file.path;
        await plugin.saveSettings();
        return made;
      }
    } else {
      settings.handwriteBlocks = picked;
      settings.handwriteBlocksChosen = true;
      await plugin.saveSettings();
    }
    target = where();
  }
  if (target.kind === "fixed-missing") {
    // Said, never silent: blocks go to each note's own notebook from now on.
    new Notice(t("notebooks.handwrite.fixedMissing"));
    settings.handwriteBlocks = "note";
    settings.handwriteNotebook = "";
    await plugin.saveSettings();
    target = where();
  }
  switch (target.kind) {
    case "notebook": {
      const file = app.vault.getFileByPath(target.path);
      if (file) return { file, created: false };
      return notebookFor(plugin, source.path, noteName, initialPage);
    }
    case "pick": {
      const choice = await InlineNotebookPickerModal.pick(app, {
        defaultCreateName: noteName,
        currentNotebook,
        placeholder: t("notebooks.handwrite.pickPlaceholder"),
      });
      if (!choice) return null;
      if (choice.kind === "existing") return { file: choice.file, created: false };
      return notebookFor(plugin, source.path, choice.name, initialPage);
    }
    default:
      return notebookFor(plugin, source.path, noteName, initialPage);
  }
}

export async function insertInlineHandwriting(
  plugin: GoodObsidianPlugin,
  editor: Editor,
  source: TFile,
  options?: { pick?: boolean },
): Promise<void> {
  const pageId = newSketchId();
  const sketchPage = createInlineSketchPage(pageId, {
    transparent: true,
    width: plugin.settings.paperWidth,
    backdrop: plugin.settings.inlineLastBackdrop,
  });

  const resolved = await resolveBackingNotebook(
    plugin,
    source,
    editor.getValue(),
    options?.pick === true,
    sketchPage,
  );
  if (!resolved) return;
  const { file: notebook, created } = resolved;

  if (!created) {
    if (notebookIsOpen(plugin.app, notebook)) {
      new Notice(t("notebooks.handwrite.errCloseBeforeInsert"));
      return;
    }
    await editClosedNotebook(plugin.app, notebook, plugin.settings.paperWidth, (doc) => {
      doc.pages.push(sketchPage);
    });
  }

  const link = plugin.app.fileManager.generateMarkdownLink(notebook, source.path, `#id=${pageId}`);
  const cursor = editor.getCursor();
  const lineText = editor.getLine(cursor.line);
  const before = lineText.slice(0, cursor.ch);
  const after = lineText.slice(cursor.ch);
  const above = cursor.line > 0 ? editor.getLine(cursor.line - 1) : "";
  const below = cursor.line + 1 < editor.lineCount() ? editor.getLine(cursor.line + 1) : "";
  const insertion = embedInsertion(link, before, after, above, below);
  editor.replaceRange(insertion, cursor);

  plugin.activateInlineEmbed(notebook, pageId);
}

/** What the notebook embeds need to open an editor over a block, and close it again. */
export function inlineEditorHost(plugin: GoodObsidianPlugin): {
  openInlineEditor: (req: {
    slotEl: HTMLElement;
    file: TFile;
    page: Page;
    pageNumber: number;
    sourcePath: string;
    onClosed: () => void;
  }) => void;
  closeInlineEditor: (slotEl?: HTMLElement) => void;
} {
  return {
    openInlineEditor: ({ slotEl, file, page, pageNumber, sourcePath, onClosed }) => {
      const req: EmbedInlineEditRequest = {
        plugin,
        app: plugin.app,
        slotEl,
        notebookFile: file,
        pageId: page.id,
        pageNumber,
        sourcePath,
        onClosed,
      };
      void new EmbedInlineEditor(req).start();
    },
    closeInlineEditor: (slotEl) => {
      void (slotEl ? closeInlineEditorIn(slotEl) : closeAnyInlineEditor());
    },
  };
}

export function registerHandwriteHere(plugin: GoodObsidianPlugin): void {
  ensureHandwriteIcon();
  let inserting = false;
  const run = (editor: Editor, file: TFile, pick: boolean): void => {
    if (inserting) return;
    inserting = true;
    void insertInlineHandwriting(plugin, editor, file, { pick })
      .catch((error: unknown) => {
        new Notice(
          t("notebooks.handwrite.errInsertFailed", {
            error:
              error instanceof Error ? error.message : t("notebooks.handwrite.errInsertFallback"),
          }),
        );
      })
      .finally(() => {
        inserting = false;
      });
  };

  plugin.addCommand({
    id: "handwrite-here",
    name: t("notebooks.handwrite.command"),
    icon: HANDWRITE_HERE_ICON,
    editorCheckCallback: (checking, editor, ctx) => {
      const file = ctx.file;
      if (!file || plugin.isInkFile(file)) return false;
      if (checking) return true;
      run(editor, file, false);
      return true;
    },
  });

  plugin.addCommand({
    id: "handwrite-here-choose",
    name: t("notebooks.handwrite.commandChoose"),
    icon: HANDWRITE_HERE_ICON,
    editorCheckCallback: (checking, editor, ctx) => {
      const file = ctx.file;
      if (!file || plugin.isInkFile(file)) return false;
      if (checking) return true;
      run(editor, file, true);
      return true;
    },
  });

  // The notebook of "One notebook for everything" is followed when it moves.
  plugin.registerEvent(
    plugin.app.vault.on("rename", (file, oldPath) => {
      if (followHandwriteNotebook(plugin.settings, oldPath, file.path)) void plugin.saveSettings();
    }),
  );

  // Plugin off: an open block saves and closes, and lets go of its canvases.
  plugin.register(() => void closeAnyInlineEditor());

  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor, info) => {
      const file = info instanceof MarkdownView ? info.file : info.file;
      if (!file || plugin.isInkFile(file)) return;
      menu.addItem((item) =>
        item
          .setTitle(t("notebooks.handwrite.command"))
          .setIcon(HANDWRITE_HERE_ICON)
          .onClick(() => run(editor, file, false)),
      );
    }),
  );
}
